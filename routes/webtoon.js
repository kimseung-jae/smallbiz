const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getSampleFiles } = require('./sampleMedia');
const { callAI, hasAIKey } = require('../lib/aiClient');
const { getBrowser } = require('../lib/browser');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'webtoon-panel.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const LAYOUTS = {
  2: { cols: '1fr', rows: '600px 460px', areas: `"p1" "p2"` },
  3: { cols: '1.15fr 1fr', rows: '500px 500px', areas: `"p1 p2" "p1 p3"` },
  4: { cols: '1fr 1fr 1fr', rows: '560px 380px', areas: `"p1 p1 p1" "p2 p3 p4"` },
  5: { cols: '1fr 1fr', rows: '480px 380px 380px', areas: `"p1 p1" "p2 p3" "p4 p5"` },
  6: { cols: '1fr 1fr', rows: '400px 400px 400px', areas: `"p1 p2" "p3 p4" "p5 p6"` },
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

  // 말풍선 대사(captions)를 사용자가 다 직접 입력하지 않아도 되도록, 가게명/업종/한줄소개로
  // 컷 수만큼 짧은 대사를 한 번에 만들어주는 엔드포인트
  router.post('/captions', async (req, res) => {
    const { storeName, category, features, panelCount } = req.body;
    const count = Math.max(1, Math.min(6, Number(panelCount) || 1));

    if (!storeName) {
      return res.status(400).json({ error: '매장명이 필요합니다.' });
    }

    if (!hasAIKey()) {
      return res.json({
        needsApiKey: true,
        message: 'AI 문구 생성 키가 없어서 말풍선 대사를 자동으로 만들 수 없어요. 직접 입력해주세요.',
      });
    }

    const prompt = `당신은 소상공인 홍보 포토툰(사진 만화)의 말풍선 대사를 쓰는 카피라이터입니다.
가게명: ${storeName}
업종/특징: ${category || ''} ${features || ''}

이 포토툰은 총 ${count}컷입니다. 각 컷 말풍선에 들어갈 짧은 대사를 정확히 ${count}개 만들어주세요.
- 각 대사는 12자 이내로 짧고 재미있게
- 사장님이나 손님이 실제로 말하는 듯한 말투(반말/구어체 가능)
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
      console.error('webtoon captions error:', err.message);
      res.status(500).json({ error: '대사 생성 중 오류가 발생했습니다.', detail: err.message });
    }
  });

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

    let page;
    const extractedFrames = [];
    try {
      const count = Math.min(files.length, 6);
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

      const browser = await getBrowser();
      page = await browser.newPage();
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
      if (page) await page.close();
      if (files) {
        for (const f of files) if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
      for (const framePath of extractedFrames) fs.rm(framePath, { force: true }, () => {});
    }
  });

  return router;
};
