const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');
const ffmpegPath = require('ffmpeg-static');
const { getSampleFiles } = require('./sampleMedia');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'webtoon-panel.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const LAYOUTS = {
  2: { cols: '1fr', rows: '600px 460px', areas: `"p1" "p2"` },
  3: { cols: '1.15fr 1fr', rows: '500px 500px', areas: `"p1 p2" "p1 p3"` },
  4: { cols: '1fr 1fr 1fr', rows: '560px 380px', areas: `"p1 p1 p1" "p2 p3 p4"` },
};

function extractVideoFrame(videoPath) {
  return new Promise((resolve, reject) => {
    const framePath = `${videoPath}.frame.jpg`;
    execFile(
      ffmpegPath,
      ['-y', '-i', videoPath, '-ss', '00:00:00.5', '-frames:v', '1', framePath],
      (err) => (err ? reject(err) : resolve(framePath)),
    );
  });
}

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

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.array('photos', 6), async (req, res) => {
    const { storeName, useSample } = req.body;
    const files = useSample === 'true' ? getSampleFiles(4) : req.files;
    let captions = [];
    try {
      captions = JSON.parse(req.body.captions || '[]');
    } catch {
      captions = [];
    }

    if (!files || files.length < 2) {
      return res.status(400).json({ error: '만화 생성에는 사진/영상이 최소 2개 필요합니다.' });
    }

    let browser;
    const extractedFrames = [];
    try {
      const count = Math.min(files.length, 4);
      const layout = LAYOUTS[count];

      const panelImagePaths = [];
      for (let i = 0; i < count; i++) {
        const file = files[i];
        if (file.mimetype.startsWith('video/')) {
          const framePath = await extractVideoFrame(file.path);
          extractedFrames.push(framePath);
          panelImagePaths.push(framePath);
        } else {
          panelImagePaths.push(file.path);
        }
      }

      const panelsHtml = panelImagePaths
        .map((imgPath, i) => {
          const dataUri = toDataUri(imgPath);
          const caption = escapeHtml(captions[i] || '');
          const bubblePos = i % 2 === 0 ? 'top' : 'bottom';
          const bubbleHtml = caption ? `<div class="bubble ${bubblePos}">${caption}</div>` : '';
          const rotation = i === 0 ? -1.8 : i % 2 === 0 ? -2.2 : 2.2;
          const stickerHtml = i === 0 ? `<div class="sticker">PICK!</div>` : '';
          return `<div class="panel" style="grid-area: p${i + 1}; transform: rotate(${rotation}deg);"><img src="${dataUri}" />${bubbleHtml}${stickerHtml}</div>`;
        })
        .join('\n');

      const titleBar = storeName ? `<div class="title-bar">${escapeHtml(storeName)}</div>` : '';

      let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
      html = html
        .replace('__GRID_COLS__', layout.cols)
        .replace('__GRID_ROWS__', layout.rows)
        .replace('__GRID_AREAS__', layout.areas)
        .replace('__TITLE_BAR__', titleBar)
        .replace('__PANELS__', panelsHtml);

      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 100 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pageEl = await page.$('.page');
      const outName = `webtoon-${Date.now()}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      await pageEl.screenshot({ path: outPath });

      res.json({ url: `/output/${outName}` });
    } catch (err) {
      console.error('webtoon generation error:', err.message);
      res.status(500).json({ error: '만화 생성 중 오류가 발생했습니다.', detail: err.message });
    } finally {
      if (browser) await browser.close();
      if (files) {
        for (const f of files) if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
      for (const framePath of extractedFrames) fs.rm(framePath, { force: true }, () => {});
    }
  });

  return router;
};
