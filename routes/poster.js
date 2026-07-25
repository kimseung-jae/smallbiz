const express = require('express');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { getSampleFiles } = require('./sampleMedia');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'poster.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function toDataUri(filePath) {
  const ext = path.extname(filePath).slice(1) || 'jpeg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wrapText(text, maxChars) {
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
  return lines.join('\n');
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

    let browser;
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

      const wrappedHeadline = wrapText(headline, 12);
      const headlineSize = wrappedHeadline.length > 20 ? 68 : wrappedHeadline.length > 12 ? 80 : 96;

      let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
      html = html
        .replace('__PHOTO__', toDataUri(imagePath))
        .replace('__HEADLINE_SIZE__', String(headlineSize))
        .replace('__HEADLINE__', escapeHtml(wrappedHeadline))
        .replace(
          '__STORE_BADGE__',
          storeName ? `<div class="store-badge"><span class="dot"></span>${escapeHtml(storeName)}</div>` : '',
        )
        .replace(
          '__STORE_META__',
          storeName || address
            ? `<div class="store-meta"><span class="star-rating">★★★★★</span>${address ? `<span class="address-text">${escapeHtml(address)}</span>` : ''}</div>`
            : '',
        )
        .replace(
          '__SUBTEXT__',
          subtext && subtext.trim()
            ? `<div class="subtext">${escapeHtml(wrapText(subtext, 22))}</div>`
            : '',
        );

      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1350 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const outName = `poster-${Date.now()}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      await page.screenshot({ path: outPath });

      res.json({ url: `/output/${outName}` });
    } catch (err) {
      console.error('poster generation error:', err.message);
      res.status(500).json({ error: '포스터 생성 중 오류가 발생했습니다.', detail: err.message });
    } finally {
      if (browser) await browser.close();
      if (file && !file.isSample) fs.rm(file.path, { force: true }, () => {});
    }
  });

  return router;
};
