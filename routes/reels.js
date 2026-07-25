const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getSampleFiles } = require('./sampleMedia');

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const CLIP_SECONDS = 3;
// macOS 시스템 폰트 대신 리포에 번들된 폰트를 써야 리눅스 서버(Render)에서도 자막이 그려짐
const KOREAN_FONT = path.join(__dirname, '..', 'fonts', 'NotoSansKR-VF.ttf');
const MUSIC_DIR = path.join(__dirname, '..', 'music');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// AppleSDGothicNeo (used for drawtext) has no emoji glyphs — strip them so they
// don't render as missing-glyph boxes in the video.
function stripEmoji(text) {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/[ \t]{2,}/g, ' ');
}

function wrapText(text, maxChars = 16) {
  const words = stripEmoji(text).replace(/\r/g, '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.join('\n');
}

function pickMusic(mood) {
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => f.toLowerCase().endsWith('.mp3'));
  const matched = mood ? files.filter((f) => f.toLowerCase().startsWith(mood.toLowerCase())) : [];
  const pool = matched.length ? matched : files;
  if (!pool.length) return null;
  return path.join(MUSIC_DIR, pool[Math.floor(Math.random() * pool.length)]);
}

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.array('photos', 6), async (req, res) => {
    const { caption, mood, useSample } = req.body;
    const files = useSample === 'true' ? getSampleFiles(4) : req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: '사진/영상을 최소 1개 이상 업로드해야 합니다.' });
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
    const clipPaths = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const clipPath = path.join(workDir, `clip_${i}.mp4`);
        const isVideo = files[i].mimetype.startsWith('video/');

        if (isVideo) {
          await run([
            '-y',
            '-i', files[i].path,
            '-t', String(CLIP_SECONDS),
            '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS}`,
            '-an',
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264',
            clipPath,
          ]);
        } else {
          const zoomExpr = i % 2 === 0 ? 'min(zoom+0.0015,1.2)' : 'if(lte(zoom,1.0),1.2,max(1.0,zoom-0.0015))';
          await run([
            '-y',
            '-loop', '1',
            '-i', files[i].path,
            '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='${zoomExpr}':d=${FPS * CLIP_SECONDS}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
            '-t', String(CLIP_SECONDS),
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264',
            clipPath,
          ]);
        }
        clipPaths.push(clipPath);
      }

      const listPath = path.join(workDir, 'list.txt');
      fs.writeFileSync(listPath, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

      const concatPath = path.join(workDir, 'concat.mp4');
      await run(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath]);

      const outName = `reels-${Date.now()}.mp4`;
      const outPath = path.join(OUTPUT_DIR, outName);

      const captionText = wrapText(caption || '', 16);
      const captionPath = path.join(workDir, 'caption.txt');
      fs.writeFileSync(captionPath, captionText || ' ');

      const drawtext = `drawtext=fontfile=${KOREAN_FONT}:textfile=${captionPath}:fontcolor=white:fontsize=56:line_spacing=14:box=1:boxcolor=black@0.55:boxborderw=24:x=(w-text_w)/2:y=h-th-140`;

      const musicPath = pickMusic(mood);
      const args = ['-y', '-i', concatPath];

      if (musicPath) {
        args.push('-stream_loop', '-1', '-i', musicPath);
      } else {
        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      }

      // 주의: '-shortest'는 이 filter_complex(비디오만 필터링 + 오디오 직접 매핑) 조합에서
      // 오디오 트랙이 0바이트로 누락되는 ffmpeg 버그가 있어 대신 정확한 길이를 '-t'로 명시한다.
      const totalDuration = CLIP_SECONDS * files.length;
      args.push(
        '-filter_complex', `[0:v]${drawtext}[v]`,
        '-map', '[v]',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-t', String(totalDuration),
        '-pix_fmt', 'yuv420p',
        outPath,
      );

      await run(args);

      res.json({ url: `/output/${outName}`, hasMusic: !!musicPath });
    } catch (err) {
      console.error('reels generation error:', err.message, err.stderr || '');
      res.status(500).json({ error: '릴스 생성 중 오류가 발생했습니다.', detail: err.stderr || err.message });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      for (const f of files) {
        if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
    }
  });

  return router;
};
