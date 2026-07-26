const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const { getSampleFiles } = require('./sampleMedia');

// Render 무료 플랜(RAM 512MB)에서 1080x1920 인코딩이 메모리를 넘겨 서버 전체가 죽는 문제가 있어
// 해상도를 낮추고 인코딩 부하를 줄임 (720x1280도 SNS 릴스용으로 충분한 화질)
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 30;
const CLIP_SECONDS = 3;
const ENCODE_ARGS = ['-preset', 'veryfast', '-threads', '1'];
// Render에 올라가는 ffmpeg-static 리눅스 바이너리는 drawtext 필터가 빠져있어서
// ("No such filter: 'drawtext'") 자막을 sharp로 그린 투명 PNG를 overlay 필터로 합성한다.
const FONT_BASE64 = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'NotoSansKR-VF.ttf')).toString('base64');
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

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 자막을 영상 크기(WIDTH x HEIGHT)와 같은 투명 PNG에 그려서 ffmpeg overlay 필터로 얹는다.
function buildCaptionOverlay(captionText) {
  const lines = captionText.split('\n').filter(Boolean);
  if (!lines.length) return null;

  const fontSize = 40;
  const lineHeight = fontSize * 1.25;
  const paddingY = 20;
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const boxWidth = WIDTH - 80;
  const boxX = (WIDTH - boxWidth) / 2;
  const boxY = HEIGHT - boxHeight - 100;
  const firstBaseline = boxY + paddingY + fontSize * 0.85;
  const tspans = lines
    .map((line, i) => `<tspan x="${WIDTH / 2}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face { font-family: 'Noto Sans KR'; src: url(data:font/ttf;base64,${FONT_BASE64}); }
      text { font-family: 'Noto Sans KR', sans-serif; }
    </style>
  </defs>
  <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="12" fill="rgba(0,0,0,0.55)" />
  <text x="${WIDTH / 2}" y="${firstBaseline}" font-size="${fontSize}" font-weight="700" fill="#fff" text-anchor="middle">${tspans}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
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
            '-c:v', 'libx264', ...ENCODE_ARGS,
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
            '-c:v', 'libx264', ...ENCODE_ARGS,
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
      const overlayPromise = buildCaptionOverlay(captionText);

      const args = ['-y', '-i', concatPath]; // input 0: video
      let overlayIndex = null;
      if (overlayPromise) {
        const overlayPath = path.join(workDir, 'caption.png');
        fs.writeFileSync(overlayPath, await overlayPromise);
        args.push('-i', overlayPath);
        overlayIndex = 1;
      }

      const audioIndex = overlayIndex === null ? 1 : 2;
      const musicPath = pickMusic(mood);
      if (musicPath) {
        args.push('-stream_loop', '-1', '-i', musicPath);
      } else {
        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      }

      // 주의: '-shortest'는 이 filter_complex(비디오만 필터링 + 오디오 직접 매핑) 조합에서
      // 오디오 트랙이 0바이트로 누락되는 ffmpeg 버그가 있어 대신 정확한 길이를 '-t'로 명시한다.
      const totalDuration = CLIP_SECONDS * files.length;
      args.push(
        ...(overlayIndex !== null
          ? ['-filter_complex', `[0:v][${overlayIndex}:v]overlay=0:0[v]`, '-map', '[v]']
          : ['-map', '0:v']),
        '-map', `${audioIndex}:a`,
        '-c:v', 'libx264', ...ENCODE_ARGS,
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
