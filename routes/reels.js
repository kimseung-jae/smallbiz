const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const { getSampleFiles } = require('./sampleMedia');
const { serializeUpload } = require('../lib/requestQueue');
const { pickFormatAndCaptions } = require('../lib/reelsFormat');

// Render 무료 플랜(RAM 512MB)에서 1080x1920은 물론 720x1280도 "Ran out of memory (used over
// 512MB)"로 인스턴스가 죽는 걸 이벤트 로그로 직접 확인했다 — 한 단계 더 낮춰서 여유를 둔다.
// 540x960도 세로 숏폼(릴스/쇼츠)에서 체감 화질 차이는 크지 않다.
const WIDTH = 540;
const HEIGHT = 960;
const FPS = 30;
// crf 20으로 낮춰봤다가(기본 23) 실제로 502/503이 재현돼서 되돌림 — 릴스 한 건에 ffmpeg를
// 여러 번(컷마다 + xfade + 엔딩카드 + 최종 합성) 호출하는데, crf를 낮추면 그 전체에 걸쳐
// 비트레이트/인코딩 부하가 같이 늘어나 Render 무료 서버(512MB RAM, 약한 CPU)에서 감당이 안 됐다.
// 화질보다 "항상 만들어지는 것"이 더 중요하므로 기본값으로 복귀.
const ENCODE_ARGS = ['-preset', 'veryfast', '-threads', '1'];
// Render에 올라가는 ffmpeg-static 리눅스 바이너리는 drawtext 필터가 빠져있어서
// ("No such filter: 'drawtext'") 자막을 sharp로 그린 투명 PNG를 overlay 필터로 합성한다.
const MUSIC_DIR = path.join(__dirname, '..', 'music');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// 호출 하나가 비정상적으로 오래 걸리면(끊긴 요청, 잘못된 입력 등) 강제 종료한다 — 안 그러면
// 클라이언트/Render 게이트웨이는 이미 타임아웃돼서 떠났는데 ffmpeg 프로세스만 서버에 계속
// 남아 메모리를 붙들고 있다가, 다음 요청들과 겹치면서 OOM으로 서버 전체가 죽는 걸 유발할 수 있다.
const FFMPEG_TIMEOUT_MS = 60000;
// xfade는 겹치는 구간만큼 전체 길이가 짧아진다(클립 N개, 겹침 t초 → N개 합쳐지며 (N-1)*t만큼 감소).
// 포맷 JSON의 구간 길이는 이 감소분까지 감안해서 최종 길이가 12~15초에 들어오도록 잡혀 있다.
const XFADE_DURATION = 0.4;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 50, timeout: FFMPEG_TIMEOUT_MS, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
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

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 폰트별 고정폭이 아니라서 대략치 — 한글/전각 문자는 넓게, 영문/숫자는 좁게 잡아 텍스트 너비를 추정한다.
function approxTextWidth(str, fontSize) {
  let width = 0;
  for (const ch of String(str)) {
    if (ch === ' ') width += fontSize * 0.28;
    else if (ch.codePointAt(0) > 0x2e7f) width += fontSize * 0.98;
    else width += fontSize * 0.58;
  }
  return width;
}

// AI가 글자 수 제한을 살짝 넘기거나, 공백 없이 긴 한글 단어 하나로 와도 화면 밖으로 잘리거나
// 칩 밖으로 삐져나오지 않도록 폰트 크기를 줄여서 항상 maxWidth 안에 들어오게 만든다.
function fitFontSize(text, baseFontSize, maxWidth, minFontSize = 22) {
  let fontSize = baseFontSize;
  while (fontSize > minFontSize && approxTextWidth(text, fontSize) > maxWidth) {
    fontSize -= 2;
  }
  return fontSize;
}

// 인스타 스토리/릴스 특유의 "맨 위 진행 바"(알약 모양 세그먼트, 현재 컷까지 채워짐) — 지금
// 구간(segment) 안에서 몇 번째 컷인지 한눈에 보이게 해서 슬라이드쇼가 아니라 "스토리"처럼 보이게 한다.
function buildProgressSegments(cutIndex, cutCount) {
  if (!cutCount || cutCount < 2) return '';
  const margin = 20;
  const gap = 8;
  const barHeight = 5;
  const barY = 22;
  const totalWidth = WIDTH - margin * 2;
  const segWidth = (totalWidth - gap * (cutCount - 1)) / cutCount;

  return Array.from({ length: cutCount }, (_, j) => {
    const x = margin + j * (segWidth + gap);
    const filled = j <= cutIndex;
    return `<rect x="${x}" y="${barY}" width="${segWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="#fff" opacity="${filled ? 0.95 : 0.3}" />`;
  }).join('');
}

// 자막을 영상 크기(WIDTH x HEIGHT)와 같은 투명 PNG에 그려서 ffmpeg overlay 필터로 얹는다.
// 포맷(JSON)이 지정한 위치(top/center/bottom)·글자 크기로 알약 모양 칩 하나를 그린다. 긴 텍스트는
// fitFontSize로 미리 줄여 받으므로 칩/화면 밖으로 잘리거나 겹치는 일이 없다.
function buildCaptionOverlay(rawText, { cutIndex, cutCount, position = 'bottom', fontSize = 46, label } = {}) {
  const text = stripEmoji(String(rawText || '')).trim();
  const progressBar = buildProgressSegments(cutIndex, cutCount);
  if (!text) {
    if (!progressBar) return null;
    return sharp(Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${progressBar}</svg>`)).png().toBuffer();
  }

  const chipPaddingX = 28;
  const maxWidth = WIDTH - 60 - chipPaddingX * 2;
  const fitted = fitFontSize(text, fontSize, maxWidth);
  const chipPaddingY = Math.round(fitted * 0.35);
  const chipHeight = fitted * 1.15 + chipPaddingY * 2;
  const chipWidth = Math.min(WIDTH - 60, approxTextWidth(text, fitted) + chipPaddingX * 2);
  const chipX = (WIDTH - chipWidth) / 2;

  // 트렌드 캡션 배치: bottom은 화면 중하단(약 62% 지점), top은 상단 진행 바 아래, center는 정중앙.
  const anchorY = position === 'top' ? HEIGHT * 0.17 : position === 'center' ? HEIGHT * 0.5 : HEIGHT * 0.62;
  const chipY = anchorY - chipHeight / 2;
  const textBaseline = chipY + chipHeight / 2 + fitted * 0.33;

  const labelSvg = label
    ? `<text x="${WIDTH / 2}" y="${chipY - 16}" font-size="26" font-weight="800" letter-spacing="2" fill="#ffd23f" text-anchor="middle">${escapeXml(label)}</text>`
    : '';

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
  ${labelSvg}
  <rect x="${chipX}" y="${chipY}" width="${chipWidth}" height="${chipHeight}" rx="${chipHeight / 2}" fill="url(#chipGradient)" filter="url(#chipShadow)" />
  <text x="${WIDTH / 2}" y="${textBaseline}" font-size="${fitted}" font-weight="800" letter-spacing="-0.5" fill="#14161a" text-anchor="middle">${escapeXml(text)}</text>
  ${progressBar}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// 훅 구간(0~1.5초) 전용 카드 — 사진 없이 큰 글씨 한 줄(또는 공백 없는 긴 단어라면 두 줄)로 시선을
// 붙잡는다. 화면 폭을 넘는 길이면 fitFontSize로 줄이고, 그래도 넘치면 가운데에서 두 줄로 쪼갠다.
function buildHookCard(rawText, { fontSize = 64 } = {}) {
  const text = stripEmoji(String(rawText || '')).trim();
  const maxWidth = WIDTH - 80;
  let fitted = fitFontSize(text, fontSize, maxWidth, 34);
  let lines = [text];
  if (approxTextWidth(text, fitted) > maxWidth && text.length > 1) {
    const mid = Math.ceil(text.length / 2);
    lines = [text.slice(0, mid), text.slice(mid)];
    const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b), '');
    fitted = fitFontSize(longest, fontSize, maxWidth, 28);
  }

  const centerX = WIDTH / 2;
  const centerY = HEIGHT * 0.46;
  const lineHeight = fitted * 1.2;
  const totalHeight = lines.length * lineHeight;
  const firstBaseline = centerY - totalHeight / 2 + fitted * 0.85;
  const textSvg = lines
    .map((line, i) => `<text x="${centerX}" y="${firstBaseline + i * lineHeight}" font-size="${fitted}" font-weight="800" letter-spacing="-1" fill="#fff" text-anchor="middle">${escapeXml(line)}</text>`)
    .join('');
  const accentY = centerY - totalHeight / 2 - 28;

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: 'Noto Sans KR', sans-serif; }
    </style>
    <linearGradient id="hookBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b1d22" />
      <stop offset="100%" stop-color="#101114" />
    </linearGradient>
    <linearGradient id="hookAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#ff8a3d" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#hookBg)" />
  <rect x="${centerX - 70}" y="${accentY}" width="140" height="5" rx="2.5" fill="url(#hookAccent)" />
  ${textSvg}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// 마지막에 붙는 브랜드 엔딩 카드 — 가게명/주소와 함께 포맷이 지정한 CTA 문구를 넣어 영상이
// 그냥 사진 슬라이드쇼가 아니라 실제 홍보 영상처럼 마무리되게 한다. drawtext가 없는 환경이라
// 포스터/자막과 동일하게 sharp로 그린 PNG를 한 장의 "컷"으로 취급해 나머지 컷들과 함께 xfade한다.
function buildEndCard({ storeName, address, cta }) {
  const centerX = WIDTH / 2;
  const nameMaxWidth = WIDTH - 100;
  const nameSize = fitFontSize(storeName || '', 54, nameMaxWidth, 30);
  const addressSize = 26;
  const ctaSize = 32;

  const ctaLabel = escapeXml(stripEmoji(cta || '').trim());
  const ctaChipWidth = Math.min(WIDTH - 100, approxTextWidth(ctaLabel, ctaSize) * 1.05 + 64);
  const ctaChipHeight = ctaSize * 1.15 + 36;
  const ctaChipY = HEIGHT * 0.66;

  const nameY = HEIGHT * 0.46;
  const addressY = nameY + nameSize * 0.9;

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: 'Noto Sans KR', sans-serif; }
    </style>
    <linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b1d22" />
      <stop offset="100%" stop-color="#101114" />
    </linearGradient>
    <linearGradient id="accentGradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#ff8a3d" />
    </linearGradient>
    <filter id="endShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.35" />
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGradient)" />
  <rect x="${centerX - 60}" y="${nameY - nameSize - 28}" width="120" height="4" rx="2" fill="url(#accentGradient)" />
  <text x="${centerX}" y="${nameY}" font-size="${nameSize}" font-weight="800" letter-spacing="-1" fill="#fff" text-anchor="middle">${escapeXml(storeName || '')}</text>
  ${address ? `<text x="${centerX}" y="${addressY}" font-size="${addressSize}" font-weight="500" fill="rgba(255,255,255,0.6)" text-anchor="middle">${escapeXml(address)}</text>` : ''}
  <rect x="${centerX - ctaChipWidth / 2}" y="${ctaChipY}" width="${ctaChipWidth}" height="${ctaChipHeight}" rx="${ctaChipHeight / 2}" fill="url(#accentGradient)" filter="url(#endShadow)" />
  <text x="${centerX}" y="${ctaChipY + ctaChipHeight / 2 + ctaSize * 0.33}" font-size="${ctaSize}" font-weight="800" letter-spacing="-0.5" fill="#14161a" text-anchor="middle">${ctaLabel}</text>
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

// 업로드된 사진 풀에서 포맷의 각 photo-cuts 구간에 쓸 사진을 나눠 배정한다. 전체 구간에 걸쳐
// 순환 커서를 하나만 써서, 사진이 충분하면(before-after처럼 구간이 여러 개여도) 구간마다 다른
// 사진이 가고, 부족하면 자연스럽게 앞에서부터 반복된다.
function selectPhotosForSegments(files, format, cutCounts) {
  const assignment = {};
  let cursor = 0;
  for (const seg of format.segments) {
    if (seg.type !== 'photo-cuts') continue;
    const n = cutCounts[seg.id];
    assignment[seg.id] = Array.from({ length: n }, () => {
      const file = files[cursor % files.length];
      cursor += 1;
      return file;
    });
  }
  return assignment;
}

// 포맷 정의 + 채워진 문구 + 사진 배정을 실제 ffmpeg 호출 순서(클립 하나하나)로 펼친다.
function buildClipSpecs(format, captions, cutCounts, photoAssignment, { storeName, address }) {
  const specs = [];
  for (const seg of format.segments) {
    if (seg.type === 'hook') {
      specs.push({ kind: 'hook', duration: seg.duration, transition: seg.transition, text: captions[seg.id], captionCfg: seg.caption });
    } else if (seg.type === 'photo-cuts') {
      const n = cutCounts[seg.id];
      const perClipDuration = seg.duration / n;
      const photos = photoAssignment[seg.id];
      const segCaptions = captions[seg.id] || [];
      for (let i = 0; i < n; i++) {
        specs.push({
          kind: 'photo',
          duration: perClipDuration,
          transition: seg.transition,
          file: photos[i],
          text: segCaptions[i],
          captionCfg: seg.caption,
          cutIndex: i,
          cutCount: n,
        });
      }
    } else if (seg.type === 'endcard') {
      // 엔딩 카드는 가게명이 있어야 의미가 있다(주소/CTA가 가게명 없이는 어색하다) — 없으면 통째로 생략.
      if (!storeName || !storeName.trim()) continue;
      specs.push({
        kind: 'endcard',
        duration: seg.duration,
        transition: seg.transition,
        storeName: storeName.trim(),
        address: (address || '').trim(),
        cta: seg.endCard.cta,
      });
    }
  }
  return specs;
}

module.exports = (upload) => {
  const router = express.Router();

  // 릴스는 사진마다 영상 인코딩 + xfade까지 같이 해야 해서 다른 기능(포스터/포토툰/카드뉴스,
  // 전부 사진 합성만 함)보다 훨씬 무겁다. 5~6장으로 실제 테스트해보니 Render 무료 서버에서
  // 메모리/시간 둘 다 감당이 안 돼서(자세한 경위는 아래 xfade 주석 참고), 업로드는 6장까지
  // 받더라도 릴스에 실제로 쓰는 건 앞 4장까지만으로 제한한다 — 이 선에서는 안정적으로 확인됨.
  const MAX_REELS_PHOTOS = 4;

  // 포맷 템플릿(JSON) + 채워진 문구 + 사진들을 받아 실제 mp4 파일을 만든다. 라우트 핸들러와
  // (AI 호출 없이 포맷을 직접 지정해서 돌리는) 테스트 스크립트가 공유해서 쓴다.
  async function generateReelsVideo({ files, storeName, address, mood, formatResult }) {
    const { format, captions, cutCounts, formatId } = formatResult;
    const photoAssignment = selectPhotosForSegments(files, format, cutCounts);
    const specs = buildClipSpecs(format, captions, cutCounts, photoAssignment, { storeName, address });

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
    const clipPaths = [];
    const clipDurations = [];

    try {
      for (let idx = 0; idx < specs.length; idx++) {
        const spec = specs[idx];
        const clipPath = path.join(workDir, `clip_${idx}.mp4`);

        if (spec.kind === 'hook') {
          const pngPath = path.join(workDir, `hook_${idx}.png`);
          fs.writeFileSync(pngPath, await buildHookCard(spec.text, { fontSize: spec.captionCfg.fontSize }));
          const zoomExpr = 'min(zoom+0.0012,1.06)';
          await run([
            '-y', '-loop', '1', '-i', pngPath,
            '-t', String(spec.duration),
            '-vf', `zoompan=z='${zoomExpr}':d=${Math.round(FPS * spec.duration)}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
            '-an', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', ...ENCODE_ARGS,
            clipPath,
          ]);
        } else if (spec.kind === 'endcard') {
          const pngPath = path.join(workDir, `endcard_${idx}.png`);
          fs.writeFileSync(pngPath, await buildEndCard({ storeName: spec.storeName, address: spec.address, cta: spec.cta }));
          const zoomExpr = 'min(zoom+0.0012,1.08)';
          await run([
            '-y', '-loop', '1', '-i', pngPath,
            '-t', String(spec.duration),
            '-vf', `zoompan=z='${zoomExpr}':d=${Math.round(FPS * spec.duration)}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
            '-an', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', ...ENCODE_ARGS,
            clipPath,
          ]);
        } else {
          const file = spec.file;
          const isVideo = file.mimetype.startsWith('video/');

          const overlayBuffer = await buildCaptionOverlay(spec.text, {
            cutIndex: spec.cutIndex,
            cutCount: spec.cutCount,
            position: spec.captionCfg.position,
            fontSize: spec.captionCfg.fontSize,
            label: spec.captionCfg.label,
          });
          let captionOverlayPath = null;
          if (overlayBuffer) {
            captionOverlayPath = path.join(workDir, `caption_${idx}.png`);
            fs.writeFileSync(captionOverlayPath, overlayBuffer);
          }

          // eq로 살짝 쨍하게(채도/대비) 색보정 — 이미 하는 스케일/크롭 필터 체인에 얹는 것뿐이라
          // 추가 인코딩 비용이 거의 없다.
          const colorGrade = 'eq=saturation=1.18:contrast=1.08:brightness=0.02';
          const baseFilter = isVideo
            ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},${colorGrade}`
            : (() => {
                const zoomExpr = idx % 2 === 0 ? 'min(zoom+0.0025,1.3)' : 'if(lte(zoom,1.0),1.3,max(1.0,zoom-0.0025))';
                return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='${zoomExpr}':d=${Math.round(FPS * spec.duration)}:s=${WIDTH}x${HEIGHT}:fps=${FPS},${colorGrade}`;
              })();

          const args = ['-y'];
          if (isVideo) {
            args.push('-i', file.path);
          } else {
            args.push('-loop', '1', '-i', file.path);
          }
          if (captionOverlayPath) args.push('-i', captionOverlayPath);
          args.push('-t', String(spec.duration));
          if (captionOverlayPath) {
            args.push('-filter_complex', `[0:v]${baseFilter}[base];[base][1:v]overlay=0:0[v]`, '-map', '[v]');
          } else {
            args.push('-vf', baseFilter, '-map', '0:v');
          }
          args.push('-an', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', ...ENCODE_ARGS, clipPath);

          await run(args);
        }

        clipPaths.push(clipPath);
        clipDurations.push(spec.duration);
      }

      // 컷끼리 뚝뚝 끊기지 않도록 concat 대신 xfade로 크로스페이드/트렌디한 전환을 준다. 전환
      // 종류는 포맷(JSON)이 "들어가는 구간" 기준으로 고정해 두었으므로 컷마다 무작위로 섞지 않는다.
      //
      // 주의: 한 번의 filter_complex에 N개 클립을 전부 넣는 방식은 Render에서 "Ran out of memory
      // (used over 512MB)"로 인스턴스 자체가 죽는 걸 이벤트 로그로 직접 확인했다 — 그래서 두
      // 클립씩만 순차적으로 합치는 방식(ffmpeg N-1번 호출, 항상 스트림 2개만 동시 디코딩)을 쓴다.
      let baseVideoPath;
      let totalDuration;

      if (clipPaths.length === 1) {
        baseVideoPath = clipPaths[0];
        totalDuration = clipDurations[0];
      } else {
        let accPath = clipPaths[0];
        totalDuration = clipDurations[0];

        for (let i = 1; i < clipPaths.length; i++) {
          const offset = totalDuration - XFADE_DURATION;
          const transition = specs[i].transition;
          const stepOutPath = path.join(workDir, `xfade_step_${i}.mp4`);

          await run([
            '-y', '-i', accPath, '-i', clipPaths[i],
            '-filter_complex', `[0:v][1:v]xfade=transition=${transition}:duration=${XFADE_DURATION}:offset=${offset}[v]`,
            '-map', '[v]',
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264', ...ENCODE_ARGS,
            stepOutPath,
          ]);

          totalDuration = offset + clipDurations[i];
          accPath = stepOutPath;
        }

        baseVideoPath = accPath;
      }

      const outName = `reels-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp4`;
      const outPath = path.join(OUTPUT_DIR, outName);

      // 자막은 이미 컷마다 구워 넣었으므로, 마지막 단계는 비디오를 다시 필터링할 필요 없이
      // 배경음악만 입히면 된다 — 비디오는 재인코딩 없이 그대로 복사해서 Render 부하를 줄인다.
      const musicPath = pickMusic(mood);
      const fadeOutStart = Math.max(0, totalDuration - 1.5);
      const audioFilter = musicPath ? `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=1.5` : null;

      await run([
        '-y', '-i', baseVideoPath,
        ...(musicPath
          ? ['-stream_loop', '-1', '-i', musicPath]
          : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']),
        '-map', '0:v', '-map', '1:a',
        ...(audioFilter ? ['-af', audioFilter] : []),
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-t', String(totalDuration),
        outPath,
      ]);

      return { outPath, outName, totalDuration, hasMusic: !!musicPath, formatId };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  router.post('/', serializeUpload(upload.array('photos', 6), async (req, res) => {
    const { mood, useSample, storeName, address, category, features } = req.body;
    const uploadedFiles = useSample === 'true' ? getSampleFiles(4) : req.files;

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: '사진/영상을 최소 1개 이상 업로드해야 합니다.' });
    }
    const files = uploadedFiles.slice(0, MAX_REELS_PHOTOS);
    const trimmedCount = uploadedFiles.length - files.length;

    try {
      const formatResult = await pickFormatAndCaptions({ storeName, category, features, photoCount: files.length });
      const { outName, hasMusic } = await generateReelsVideo({ files, storeName, address, mood, formatResult });

      res.json({
        url: `/output/${outName}`,
        hasMusic,
        formatId: formatResult.formatId,
        trimmedNote: trimmedCount > 0
          ? `릴스는 서버 안정성을 위해 최대 ${MAX_REELS_PHOTOS}장까지만 사용돼요. 앞 ${MAX_REELS_PHOTOS}장으로 만들었어요.`
          : null,
      });
    } catch (err) {
      console.error('reels generation error:', err.message, err.stderr || '');
      res.status(500).json({ error: '릴스 생성 중 오류가 발생했습니다.', detail: err.stderr || err.message });
    } finally {
      for (const f of uploadedFiles) {
        if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
    }
  }));

  router.generateReelsVideo = generateReelsVideo;
  return router;
};
