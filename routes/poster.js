const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { getSampleFiles } = require('./sampleMedia');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const WIDTH = 1080;
const HEIGHT = 1350;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapLines(text, maxChars) {
  const words = String(text || '').replace(/\r/g, '').split(/\s+/).filter(Boolean);
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
  return lines;
}

// 폰트별 고정폭이 아니라서 대략치 — 한글/전각 문자는 넓게, 영문/숫자는 좁게 잡아 배지·라인 폭을 추정한다.
function approxTextWidth(str, fontSize) {
  let width = 0;
  for (const ch of String(str)) {
    if (ch === ' ') width += fontSize * 0.28;
    else if (ch.codePointAt(0) > 0x2e7f) width += fontSize * 0.98;
    else width += fontSize * 0.58;
  }
  return width;
}

function textTspans(lines, x, lineHeight) {
  return lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
}

// 배지(가게명)/미터(주소)는 세 레이아웃 모두 동일하게 좌상단에 놓는다 — 템플릿마다 달라지는 건
// 헤드라인/부제 텍스트 블록의 위치와 배경 처리뿐이다.
function buildBadgeAndMeta({ storeName, address }) {
  let badgeSvg = '';
  let metaSvg = '';
  let metaBottom = 54;

  if (storeName) {
    const badgeHeight = 64;
    const badgeTextSize = 30;
    const textWidth = approxTextWidth(storeName, badgeTextSize) * 1.05; // 굵은 글씨라 살짝 여유
    const badgeWidth = 18 + 12 + 10 + textWidth + 24;
    const badgeY = 54;
    const dotCx = 54 + 18 + 6;
    const dotCy = badgeY + badgeHeight / 2;

    badgeSvg = `
      <rect x="54" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="rgba(255,255,255,0.96)" />
      <circle cx="${dotCx}" cy="${dotCy}" r="6" fill="url(#dotGradient)" />
      <text x="${54 + 18 + 12 + 10}" y="${dotCy + badgeTextSize * 0.34}" font-size="${badgeTextSize}" font-weight="800" letter-spacing="-0.3" fill="#14161a">${escapeXml(storeName)}</text>
    `;
    metaBottom = badgeY + badgeHeight + 16;
  }

  // 실제 평점 데이터가 없어서 별점(★★★★★)은 사실과 다른 표시였다 — 빼고 주소만 배지로 남긴다.
  if (address) {
    const metaHeight = 40;
    const addressWidth = approxTextWidth(address, 18);
    const metaWidth = 16 + addressWidth + 16;
    const metaY = metaBottom;
    const textBaseline = metaY + metaHeight / 2 + 18 * 0.35;

    metaSvg = `
      <rect x="54" y="${metaY}" width="${metaWidth}" height="${metaHeight}" rx="${metaHeight / 2}" fill="rgba(0,0,0,0.4)" />
      <text x="${54 + 16}" y="${textBaseline}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.92)">${escapeXml(address)}</text>
    `;
  }

  return { badgeSvg, metaSvg };
}

function svgDefs() {
  return `
  <defs>
    <style>
      text { font-family: 'Noto Sans KR', sans-serif; }
    </style>
    <linearGradient id="overlayGradient" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.92" />
      <stop offset="26%" stop-color="#000" stop-opacity="0.62" />
      <stop offset="50%" stop-color="#000" stop-opacity="0.02" />
      <stop offset="100%" stop-color="#000" stop-opacity="0.38" />
    </linearGradient>
    <linearGradient id="overlayGradientCenter" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.5" />
      <stop offset="40%" stop-color="#000" stop-opacity="0.35" />
      <stop offset="60%" stop-color="#000" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#000" stop-opacity="0.5" />
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="0%" stop-color="#000" stop-opacity="0" />
      <stop offset="65%" stop-color="#000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000" stop-opacity="0.55" />
    </radialGradient>
    <linearGradient id="dotGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#ff8a3d" />
    </linearGradient>
    <linearGradient id="dividerGradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#fff" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#ff8a3d" />
    </linearGradient>
    <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity="0.55" />
    </filter>
  </defs>`;
}

function svgFrame() {
  return `
  <rect x="22" y="22" width="${WIDTH - 44}" height="${HEIGHT - 44}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2" />
  <rect x="28" y="28" width="${WIDTH - 56}" height="${HEIGHT - 56}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1" />`;
}

// 템플릿 1: 하단정렬 (기존 레이아웃) — 헤드라인/부제가 사진 하단에 왼쪽 정렬로 깔린다.
function buildBottomLayout({ storeName, address, headlineLines, headlineSize, subtextLines }) {
  const subtextSize = 30;
  const subtextLineHeight = subtextSize * 1.4;
  const headlineLineHeight = headlineSize * 1.18;
  const dividerGap = 26 + 20; // margin-top + margin-bottom around the 1px divider

  const headlineHeight = headlineLines.length * headlineLineHeight;
  const subtextHeight = subtextLines.length ? subtextLines.length * subtextLineHeight : 0;
  const totalHeight = headlineHeight + dividerGap + subtextHeight;

  const textBlockBottom = HEIGHT - 74;
  const headlineTop = textBlockBottom - totalHeight;
  const headlineBaseline = headlineTop + headlineSize * 0.88;
  const dividerY = headlineTop + headlineHeight + 26;
  const subtextBaseline = dividerY + 20 + subtextSize * 0.88;

  const { badgeSvg, metaSvg } = buildBadgeAndMeta({ storeName, address });

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${svgDefs()}

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#overlayGradient)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)" />
  ${svgFrame()}

  ${badgeSvg}
  ${metaSvg}

  <text x="56" y="${headlineBaseline}" font-size="${headlineSize}" font-weight="800" letter-spacing="-1" fill="#fff" filter="url(#textShadow)">${textTspans(headlineLines, 56, headlineLineHeight)}</text>

  <line x1="56" y1="${dividerY}" x2="${WIDTH - 56}" y2="${dividerY}" stroke="url(#dividerGradient)" stroke-width="1" />

  ${subtextLines.length ? `<text x="56" y="${subtextBaseline}" font-size="${subtextSize}" font-weight="500" fill="rgba(255,255,255,0.88)" filter="url(#textShadow)">${textTspans(subtextLines, 56, subtextLineHeight)}</text>` : ''}

  <rect x="0" y="${HEIGHT - 10}" width="${WIDTH}" height="10" fill="url(#barGradient)" />
</svg>
  `;
}

// 템플릿 2: 중앙정렬 — 헤드라인/부제가 사진 정중앙에 가운데 정렬로 놓인다.
function buildCenterLayout({ storeName, address, headlineLines, headlineSize, subtextLines }) {
  const subtextSize = 30;
  const subtextLineHeight = subtextSize * 1.4;
  const headlineLineHeight = headlineSize * 1.18;
  const dividerGap = 26 + 20;

  const headlineHeight = headlineLines.length * headlineLineHeight;
  const subtextHeight = subtextLines.length ? subtextLines.length * subtextLineHeight : 0;
  const totalHeight = headlineHeight + dividerGap + subtextHeight;

  const centerX = WIDTH / 2;
  const headlineTop = (HEIGHT - totalHeight) / 2;
  const headlineBaseline = headlineTop + headlineSize * 0.88;
  const dividerY = headlineTop + headlineHeight + 26;
  const subtextBaseline = dividerY + 20 + subtextSize * 0.88;
  const dividerWidth = 140;

  const { badgeSvg, metaSvg } = buildBadgeAndMeta({ storeName, address });

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${svgDefs()}

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#overlayGradientCenter)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)" />
  ${svgFrame()}

  ${badgeSvg}
  ${metaSvg}

  <text x="${centerX}" y="${headlineBaseline}" font-size="${headlineSize}" font-weight="800" letter-spacing="-1" fill="#fff" text-anchor="middle" filter="url(#textShadow)">${textTspans(headlineLines, centerX, headlineLineHeight)}</text>

  <line x1="${centerX - dividerWidth / 2}" y1="${dividerY}" x2="${centerX + dividerWidth / 2}" y2="${dividerY}" stroke="url(#dividerGradient)" stroke-width="1" />

  ${subtextLines.length ? `<text x="${centerX}" y="${subtextBaseline}" font-size="${subtextSize}" font-weight="500" fill="rgba(255,255,255,0.88)" text-anchor="middle" filter="url(#textShadow)">${textTspans(subtextLines, centerX, subtextLineHeight)}</text>` : ''}

  <rect x="0" y="${HEIGHT - 10}" width="${WIDTH}" height="10" fill="url(#barGradient)" />
</svg>
  `;
}

// 템플릿 3: 상단 컬러띠 — 화면 위쪽에 불투명한 컬러 띠를 깔고 그 안에 헤드라인/부제를 넣어,
// 사진 아래쪽은 가리지 않고 그대로 보여준다.
function buildTopBandLayout({ storeName, address, headlineLines, headlineSize, subtextLines }) {
  const subtextSize = 28;
  const subtextLineHeight = subtextSize * 1.4;
  const headlineLineHeight = headlineSize * 1.18;
  const dividerGap = 22 + 18;
  const bandPaddingTop = 54;
  const bandPaddingBottom = 40;

  const headlineHeight = headlineLines.length * headlineLineHeight;
  const subtextHeight = subtextLines.length ? subtextLines.length * subtextLineHeight : 0;
  const textHeight = headlineHeight + dividerGap + subtextHeight;

  const badgeReserve = storeName ? 64 + 16 : 0;
  const bandHeight = bandPaddingTop + badgeReserve + textHeight + bandPaddingBottom;

  const headlineTop = bandPaddingTop + badgeReserve;
  const headlineBaseline = headlineTop + headlineSize * 0.88;
  const dividerY = headlineTop + headlineHeight + 22;
  const subtextBaseline = dividerY + 18 + subtextSize * 0.88;

  const { badgeSvg } = buildBadgeAndMeta({ storeName, address: '' });
  // 주소는 띠 밖(사진 위, 띠 바로 아래)에 별도로 작게 표시한다 — 띠 안에 다 넣으면 너무 빽빽해진다.
  const addressBelowBand = address
    ? `<text x="56" y="${bandHeight + 40}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.92)" filter="url(#textShadow)">${escapeXml(address)}</text>`
    : '';

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${svgDefs()}

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)" />
  ${svgFrame()}

  <rect x="0" y="0" width="${WIDTH}" height="${bandHeight}" fill="#14161a" />
  <rect x="0" y="${bandHeight - 6}" width="${WIDTH}" height="6" fill="url(#barGradient)" />

  ${badgeSvg}
  ${addressBelowBand}

  <text x="56" y="${headlineBaseline}" font-size="${headlineSize}" font-weight="800" letter-spacing="-1" fill="#fff">${textTspans(headlineLines, 56, headlineLineHeight)}</text>

  <line x1="56" y1="${dividerY}" x2="${WIDTH - 56}" y2="${dividerY}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />

  ${subtextLines.length ? `<text x="56" y="${subtextBaseline}" font-size="${subtextSize}" font-weight="500" fill="rgba(255,255,255,0.75)">${textTspans(subtextLines, 56, subtextLineHeight)}</text>` : ''}
</svg>
  `;
}

const TEMPLATES = {
  bottom: buildBottomLayout,
  center: buildCenterLayout,
  'top-band': buildTopBandLayout,
};

function buildOverlaySvg({ templateId, ...rest }) {
  const builder = TEMPLATES[templateId] || TEMPLATES.bottom;
  return builder(rest);
}

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.single('photo'), async (req, res) => {
    const { storeName, headline, subtext, address, templateId, focusY: focusYRaw, useSample } = req.body;
    const file = useSample === 'true' ? getSampleFiles(1)[0] : req.file;

    if (!file) return res.status(400).json({ error: '사진이 필요합니다.' });
    if (!headline || !headline.trim()) {
      if (!file.isSample) fs.rm(file.path, { force: true }, () => {});
      return res.status(400).json({ error: '포스터 헤드라인 문구가 필요합니다.' });
    }

    try {
      let imagePath = file.path;
      if (file.mimetype.startsWith('video/')) {
        const { execFile } = require('child_process');
        const ffmpegPath = require('ffmpeg-static');
        const framePath = `${file.path}.frame.jpg`;
        await new Promise((resolve, reject) => {
          execFile(
            ffmpegPath,
            ['-y', '-i', file.path, '-ss', '00:00:00.5', '-frames:v', '1', framePath],
            (err) => (err ? reject(err) : resolve()),
          );
        });
        imagePath = framePath;
      }

      const headlineLines = wrapLines(headline, 12);
      const wrappedLength = headlineLines.join('').length;
      const headlineSize = wrappedLength > 20 ? 68 : wrappedLength > 12 ? 80 : 96;
      const subtextLines = subtext && subtext.trim() ? wrapLines(subtext, 22) : [];

      const overlaySvg = buildOverlaySvg({
        templateId: templateId || '',
        storeName: storeName || '',
        address: address || '',
        headlineLines,
        headlineSize,
        subtextLines,
      });

      // focusY(0~1)가 오면 사용자가 고른 세로 위치로 직접 크롭하고, 없으면 기존처럼
      // sharp의 attention(자동 피사체 감지) 크롭을 그대로 쓴다 — 간판/음식이 잘릴 때만 수동으로 바꾸는 용도.
      const focusY = focusYRaw !== undefined && focusYRaw !== ''
        ? Math.min(1, Math.max(0, Number(focusYRaw)))
        : null;

      let photoPipeline;
      if (focusY === null || Number.isNaN(focusY)) {
        photoPipeline = sharp(imagePath).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' });
      } else {
        const { width: srcWidth, height: srcHeight } = await sharp(imagePath).metadata();
        const scale = Math.max(WIDTH / srcWidth, HEIGHT / srcHeight);
        const scaledWidth = Math.round(srcWidth * scale);
        const scaledHeight = Math.round(srcHeight * scale);
        const left = Math.round((scaledWidth - WIDTH) / 2);
        const maxTop = Math.max(0, scaledHeight - HEIGHT);
        const top = Math.round(maxTop * focusY);

        photoPipeline = sharp(imagePath)
          .resize(scaledWidth, scaledHeight)
          .extract({ left, top, width: WIDTH, height: HEIGHT });
      }

      const photoBuffer = await photoPipeline
        .modulate({ brightness: 0.98, saturation: 1.2 })
        .linear(1.1, -12.75) // CSS contrast(1.1)에 대응하는 근사치
        .toBuffer();

      const outName = `poster-${Date.now()}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);

      await sharp(photoBuffer)
        .composite([{ input: Buffer.from(overlaySvg) }])
        .png()
        .toFile(outPath);

      res.json({ url: `/output/${outName}` });
    } catch (err) {
      console.error('poster generation error:', err.message);
      res.status(500).json({ error: '포스터 생성 중 오류가 발생했습니다.', detail: err.message });
    } finally {
      if (file && !file.isSample) fs.rm(file.path, { force: true }, () => {});
    }
  });

  return router;
};
