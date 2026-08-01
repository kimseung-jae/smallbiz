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
// 주의: ★(U+2605)는 코드포인트상 "좁은 문자" 구간에 들어가지만 실제로는 한글만큼 넓게 렌더링돼서
// 별도로 넓은 문자 취급하지 않으면 뒤따르는 요소(구분선/주소)와 겹쳐 보인다.
function approxTextWidth(str, fontSize) {
  let width = 0;
  for (const ch of String(str)) {
    if (ch === ' ') width += fontSize * 0.28;
    else if (ch === '★' || ch === '☆') width += fontSize * 1.05;
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

function buildOverlaySvg({ storeName, address, headlineLines, headlineSize, subtextLines }) {
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

  if (storeName || address) {
    const metaHeight = 40;
    const starWidth = approxTextWidth('★★★★★', 20) * 1.1;
    const addressWidth = address ? approxTextWidth(address, 18) : 0;
    const metaWidth = 16 + starWidth + (address ? 12 + 14 + addressWidth : 0) + 16;
    const metaY = metaBottom;
    const textBaseline = metaY + metaHeight / 2 + 20 * 0.35;

    metaSvg = `
      <rect x="54" y="${metaY}" width="${metaWidth}" height="${metaHeight}" rx="${metaHeight / 2}" fill="rgba(0,0,0,0.4)" />
      <text x="${54 + 16}" y="${textBaseline}" font-size="20" letter-spacing="2" fill="#ffd23f">★★★★★</text>
      ${address ? `
        <line x1="${54 + 16 + starWidth + 12}" y1="${metaY + 8}" x2="${54 + 16 + starWidth + 12}" y2="${metaY + metaHeight - 8}" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
        <text x="${54 + 16 + starWidth + 12 + 14}" y="${textBaseline}" font-size="18" font-weight="600" fill="rgba(255,255,255,0.92)">${escapeXml(address)}</text>
      ` : ''}
    `;
  }

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
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
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#overlayGradient)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)" />

  <rect x="22" y="22" width="${WIDTH - 44}" height="${HEIGHT - 44}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2" />
  <rect x="28" y="28" width="${WIDTH - 56}" height="${HEIGHT - 56}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1" />

  ${badgeSvg}
  ${metaSvg}

  <text x="56" y="${headlineBaseline}" font-size="${headlineSize}" font-weight="800" letter-spacing="-1" fill="#fff" filter="url(#textShadow)">${textTspans(headlineLines, 56, headlineLineHeight)}</text>

  <line x1="56" y1="${dividerY}" x2="${WIDTH - 56}" y2="${dividerY}" stroke="url(#dividerGradient)" stroke-width="1" />

  ${subtextLines.length ? `<text x="56" y="${subtextBaseline}" font-size="${subtextSize}" font-weight="500" fill="rgba(255,255,255,0.88)" filter="url(#textShadow)">${textTspans(subtextLines, 56, subtextLineHeight)}</text>` : ''}

  <rect x="0" y="${HEIGHT - 10}" width="${WIDTH}" height="10" fill="url(#barGradient)" />
</svg>
  `;
}

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.single('photo'), async (req, res) => {
    const { storeName, headline, subtext, address, useSample } = req.body;
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
        storeName: storeName || '',
        address: address || '',
        headlineLines,
        headlineSize,
        subtextLines,
      });

      const photoBuffer = await sharp(imagePath)
        .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
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
