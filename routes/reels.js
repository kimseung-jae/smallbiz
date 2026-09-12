const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const { getSampleFiles } = require('./sampleMedia');
const { restyleImageAsAnimation, callAI, hasAIKey } = require('../lib/aiClient');

// Render 무료 플랜(RAM 512MB)에서 1080x1920 인코딩이 메모리를 넘겨 서버 전체가 죽는 문제가 있어
// 해상도를 낮추고 인코딩 부하를 줄임 (720x1280도 SNS 릴스용으로 충분한 화질)
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 30;
const ENCODE_ARGS = ['-preset', 'veryfast', '-threads', '1'];
// Render에 올라가는 ffmpeg-static 리눅스 바이너리는 drawtext 필터가 빠져있어서
// ("No such filter: 'drawtext'") 자막을 sharp로 그린 투명 PNG를 overlay 필터로 합성한다.
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

// 폰트별 고정폭이 아니라서 대략치 — 한글/전각 문자는 넓게, 영문/숫자는 좁게 잡아 칩 너비를 추정한다.
function approxTextWidth(str, fontSize) {
  let width = 0;
  for (const ch of String(str)) {
    if (ch === ' ') width += fontSize * 0.28;
    else if (ch.codePointAt(0) > 0x2e7f) width += fontSize * 0.98;
    else width += fontSize * 0.58;
  }
  return width;
}

// 자막을 영상 크기(WIDTH x HEIGHT)와 같은 투명 PNG에 그려서 ffmpeg overlay 필터로 얹는다.
// 요즘 릴스/쇼츠 자막 트렌드(굵은 폰트 + 문구별 컬러 칩, 화면 중하단 배치)를 따라
// 한 줄씩 개별 알약 모양 칩으로 그린다 — 큰 박스 하나에 다 몰아넣지 않는다.
function buildCaptionOverlay(captionText) {
  const lines = captionText.split('\n').filter(Boolean);
  if (!lines.length) return null;

  const fontSize = 46;
  const chipPaddingX = 28;
  const chipPaddingY = 16;
  const chipHeight = fontSize * 1.15 + chipPaddingY * 2;
  const lineGap = 14;
  const totalHeight = lines.length * chipHeight + (lines.length - 1) * lineGap;
  // 화면 맨 아래가 아니라 중하단(위에서 약 62~72% 지점)에 오도록 — 트렌드 캡션 배치와 동일
  const startY = HEIGHT * 0.62 - totalHeight / 2;

  const chips = lines
    .map((line, i) => {
      const chipWidth = Math.min(WIDTH - 60, approxTextWidth(line, fontSize) * 1.05 + chipPaddingX * 2);
      const chipX = (WIDTH - chipWidth) / 2;
      const chipY = startY + i * (chipHeight + lineGap);
      const textBaseline = chipY + chipHeight / 2 + fontSize * 0.33;
      return `
        <rect x="${chipX}" y="${chipY}" width="${chipWidth}" height="${chipHeight}" rx="${chipHeight / 2}" fill="url(#chipGradient)" filter="url(#chipShadow)" />
        <text x="${WIDTH / 2}" y="${textBaseline}" font-size="${fontSize}" font-weight="800" letter-spacing="-0.5" fill="#14161a" text-anchor="middle">${escapeXml(line)}</text>
      `;
    })
    .join('');

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: 'Noto Sans KR', sans-serif; }
    </style>
    <linearGradient id="chipGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#ff8a3d" />
    </linearGradient>
    <filter id="chipShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.35" />
    </filter>
  </defs>
  ${chips}
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

  // 컷마다 다른 자막이 자동으로 채워지도록, 가게명/업종/한줄소개로 컷 수만큼 짧은 자막을 만들어주는 엔드포인트.
  // 메인 생성 흐름에서 사용자가 아무것도 입력하지 않아도 조용히 호출된다 — 키가 없거나 실패하면
  // 호출부가 기존처럼 caption 하나로 통일해서 쓰도록 필요한 정보만 응답한다.
  router.post('/captions', async (req, res) => {
    const { storeName, category, features, cutCount } = req.body;
    const count = Math.max(1, Math.min(6, Number(cutCount) || 1));

    if (!storeName) {
      return res.status(400).json({ error: '매장명이 필요합니다.' });
    }
    if (!hasAIKey()) {
      return res.json({ needsApiKey: true });
    }

    const prompt = `당신은 소상공인 홍보 릴스(짧은 세로 영상) 자막을 쓰는 카피라이터입니다.
가게명: ${storeName}
업종/특징: ${category || ''} ${features || ''}

이 릴스는 총 ${count}컷입니다. 각 컷에 들어갈 짧은 자막을 정확히 ${count}개 만들어주세요.
- 각 자막은 16자 이내로 짧고 강렬하게
- 순서대로 가게 소개 → 메뉴/특징 → 방문 유도 흐름이 되게

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{"captions": ["...", "..."]}`;

    try {
      const text = await callAI(prompt, 500);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(502).json({ error: 'AI 응답을 파싱하지 못했습니다.' });
      const parsed = JSON.parse(jsonMatch[0]);
      const captions = Array.isArray(parsed.captions) ? parsed.captions.slice(0, count) : [];
      res.json({ captions });
    } catch (err) {
      console.error('reels captions error:', err.message);
      res.status(500).json({ error: '자막 생성 중 오류가 발생했습니다.', detail: err.message });
    }
  });

  router.post('/', upload.array('photos', 6), async (req, res) => {
    const { caption, mood, useSample } = req.body;
    const files = useSample === 'true' ? getSampleFiles(4) : req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: '사진/영상을 최소 1개 이상 업로드해야 합니다.' });
    }

    // captions[i]가 있으면 컷마다 다른 자막을 쓰고, 없으면 기존처럼 caption 하나를 전체 영상에 쓴다.
    let perCutCaptions = [];
    try {
      perCutCaptions = JSON.parse(req.body.captions || '[]');
    } catch {
      perCutCaptions = [];
    }
    const usePerCutCaptions = Array.isArray(perCutCaptions) && perCutCaptions.some((c) => c && c.trim());

    // 사진이 1장이면 3초, 6장이면 18초로 들쭉날쭉하던 것을 사진 장수에 맞춰 컷 길이를 2~4초 사이에서
    // 자동으로 정해서 전체 길이가 대략 12~15초 안에 들어오게 맞춘다.
    const clipSeconds = Math.min(4, Math.max(2, 15 / files.length));

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
    const clipPaths = [];

    try {
      // 사진은 AI로 따뜻한 애니메이션/일러스트 느낌으로 다시 그려서 쓸 수도 있지만(restyleImageAsAnimation),
      // 릴스는 이미 사진마다 영상 인코딩(zoompan/xfade)까지 같이 하기 때문에 AI 변환(사진당 수십 초)까지
      // 더해지면 Render 무료 서버 사양을 넘어서 502로 죽는 걸 실제로 확인했다 — 릴스는 신뢰성이 더
      // 중요하므로 꺼둔다. AI 그림체 변환은 영상 인코딩이 없는 "AI 일러스트 만화" 쪽에서만 쓴다.
      const shouldAnimate = false;
      const sourcePaths = await Promise.all(files.map(async (file, i) => {
        if (!shouldAnimate || !file.mimetype.startsWith('image/')) return file.path;
        const restyled = await restyleImageAsAnimation(fs.readFileSync(file.path), file.mimetype);
        if (!restyled) return file.path;
        const animatedPath = path.join(workDir, `animated_${i}.png`);
        fs.writeFileSync(animatedPath, restyled);
        return animatedPath;
      }));

      for (let i = 0; i < files.length; i++) {
        const clipPath = path.join(workDir, `clip_${i}.mp4`);
        const sourcePath = sourcePaths[i];
        const isVideo = files[i].mimetype.startsWith('video/');

        // 컷별 자막(captions[i])이 있으면 이 컷을 만드는 단계에서 바로 구워 넣는다 —
        // 그래야 뒤에서 xfade로 컷끼리 전환할 때 자막도 같이 자연스럽게 전환된다.
        let captionOverlayPath = null;
        if (usePerCutCaptions) {
          const cutCaptionText = wrapText(perCutCaptions[i] || '', 16);
          const overlayBuffer = await buildCaptionOverlay(cutCaptionText);
          if (overlayBuffer) {
            captionOverlayPath = path.join(workDir, `cut_caption_${i}.png`);
            fs.writeFileSync(captionOverlayPath, overlayBuffer);
          }
        }

        const baseFilter = isVideo
          ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS}`
          : (() => {
              const zoomExpr = i % 2 === 0 ? 'min(zoom+0.0015,1.2)' : 'if(lte(zoom,1.0),1.2,max(1.0,zoom-0.0015))';
              return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='${zoomExpr}':d=${Math.round(FPS * clipSeconds)}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
            })();

        const args = ['-y'];
        if (isVideo) {
          args.push('-i', sourcePath);
        } else {
          args.push('-loop', '1', '-i', sourcePath);
        }
        if (captionOverlayPath) args.push('-i', captionOverlayPath);
        args.push('-t', String(clipSeconds));
        if (captionOverlayPath) {
          args.push('-filter_complex', `[0:v]${baseFilter}[base];[base][1:v]overlay=0:0[v]`, '-map', '[v]');
        } else {
          args.push('-vf', baseFilter, '-map', '0:v');
        }
        args.push('-an', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', ...ENCODE_ARGS, clipPath);

        await run(args);
        clipPaths.push(clipPath);
      }

      // 컷끼리 뚝뚝 끊기지 않도록 concat 대신 xfade로 크로스페이드 전환을 준다. 매번 같은 fade만
      // 쓰면 슬라이드쇼 같은 인상이 강해서, 요즘 릴스/쇼츠에서 흔히 쓰는 전환들을 컷마다 돌아가며 섞는다.
      // xfade는 겹치는 구간만큼 전체 길이가 짧아지므로(클립 N개, 겹침 t초 → N*clipSeconds-(N-1)*t)
      // 최종 길이도 그에 맞춰 다시 계산해야 한다.
      const XFADE_DURATION = 0.4;
      const TRANSITIONS = ['fade', 'circleopen', 'zoomin', 'slideup', 'wiperight'];
      let baseVideoPath;
      let totalDuration;

      if (clipPaths.length === 1) {
        baseVideoPath = clipPaths[0];
        totalDuration = clipSeconds;
      } else {
        const xfadeArgs = ['-y'];
        for (const p of clipPaths) xfadeArgs.push('-i', p);

        const filterParts = [];
        let prevLabel = '0:v';
        totalDuration = clipSeconds;
        for (let i = 1; i < clipPaths.length; i++) {
          const offset = i * (clipSeconds - XFADE_DURATION);
          const outLabel = i === clipPaths.length - 1 ? 'xfinal' : `x${i}`;
          const transition = TRANSITIONS[(i - 1) % TRANSITIONS.length];
          filterParts.push(`[${prevLabel}][${i}:v]xfade=transition=${transition}:duration=${XFADE_DURATION}:offset=${offset}[${outLabel}]`);
          prevLabel = outLabel;
          totalDuration += clipSeconds - XFADE_DURATION;
        }

        xfadeArgs.push(
          '-filter_complex', filterParts.join(';'),
          '-map', '[xfinal]',
          '-pix_fmt', 'yuv420p',
          '-c:v', 'libx264', ...ENCODE_ARGS,
        );
        baseVideoPath = path.join(workDir, 'xfade.mp4');
        xfadeArgs.push(baseVideoPath);
        await run(xfadeArgs);
      }

      const outName = `reels-${Date.now()}.mp4`;
      const outPath = path.join(OUTPUT_DIR, outName);

      // 컷별 자막을 이미 각 클립에 구웠으면 전체 영상에 또 얹지 않는다.
      let overlayBuffer = null;
      if (!usePerCutCaptions) {
        const captionText = wrapText(caption || '', 16);
        overlayBuffer = await buildCaptionOverlay(captionText);
      }

      const args = ['-y', '-i', baseVideoPath]; // input 0: video
      let overlayIndex = null;
      if (overlayBuffer) {
        const overlayPath = path.join(workDir, 'caption.png');
        fs.writeFileSync(overlayPath, overlayBuffer);
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

      // 배경음악이 뚝 끊기지 않도록 시작 1초 페이드인, 끝 1.5초 페이드아웃을 준다.
      const fadeOutStart = Math.max(0, totalDuration - 1.5);
      const audioFilter = musicPath ? `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=1.5` : null;

      // 주의: '-shortest'는 이 filter_complex(비디오만 필터링 + 오디오 직접 매핑) 조합에서
      // 오디오 트랙이 0바이트로 누락되는 ffmpeg 버그가 있어 대신 정확한 길이를 '-t'로 명시한다.
      args.push(
        ...(overlayIndex !== null
          ? ['-filter_complex', `[0:v][${overlayIndex}:v]overlay=0:0[v]`, '-map', '[v]']
          : ['-map', '0:v']),
        '-map', `${audioIndex}:a`,
        ...(audioFilter ? ['-af', audioFilter] : []),
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
