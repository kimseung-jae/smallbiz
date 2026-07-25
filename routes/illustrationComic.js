const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { getSampleFiles } = require('./sampleMedia');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'illustration-panel.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const LAYOUTS = {
  2: { cols: '1fr', rows: '600px 460px', areas: `"p1" "p2"` },
  3: { cols: '1.15fr 1fr', rows: '500px 500px', areas: `"p1 p2" "p1 p3"` },
  4: { cols: '1fr 1fr 1fr', rows: '560px 380px', areas: `"p1 p1 p1" "p2 p3 p4"` },
};

const STYLE_PROMPT = `이 사진을 참고해서, 무라카미 하루키 에세이 삽화로 유명한 안자이 미즈마루(安西水丸) 화풍에 대한 오마주 일러스트로 다시 그려주세요.
스타일 특징: 단순하고 담백한 펜 선, 두껍지 않은 윤곽선, 파스텔톤의 은은한 색감, 여백을 살린 미니멀한 구도, 손그림 느낌의 살짝 삐뚤빼뚤한 라인, 유머러스하고 따뜻한 분위기.
중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 일러스트 그림만 그려주세요. 원본 사진의 구도와 소재(사람/사물/공간)는 유지하되, 그림체만 위 스타일로 바꿔주세요.`;

function toBase64(filePath) {
  const ext = path.extname(filePath).slice(1) || 'jpeg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return { mime, data: fs.readFileSync(filePath).toString('base64') };
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateIllustration(filePath) {
  const { mime, data } = toBase64(filePath);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await axios.post(url, {
    contents: [{
      parts: [
        { text: STYLE_PROMPT },
        { inline_data: { mime_type: mime, data } },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }, { headers: { 'Content-Type': 'application/json' } });

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData || p.inline_data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) throw new Error('제미나이가 이미지를 반환하지 않았습니다.');
  return Buffer.from(inline.data, 'base64');
}

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.array('photos', 6), async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        needsApiKey: true,
        message: '제미나이 API 키가 설정되지 않아 AI 일러스트 만화를 만들 수 없어요. .env에 GEMINI_API_KEY를 추가해주세요. 그 전까지는 "포토툰" 모드(/api/webtoon)를 이용해주세요.',
      });
    }

    const { storeName, useSample } = req.body;
    const files = useSample === 'true' ? getSampleFiles(4) : req.files;
    let captions = [];
    try {
      captions = JSON.parse(req.body.captions || '[]');
    } catch {
      captions = [];
    }

    if (!files || files.length < 2) {
      return res.status(400).json({ error: 'AI 일러스트 만화 생성에는 사진이 최소 2개 필요합니다.' });
    }

    let browser;
    const tempPaths = [];
    try {
      const count = Math.min(files.length, 4);
      const layout = LAYOUTS[count];
      const inputFiles = files.slice(0, count);

      const illustrationBuffers = await Promise.all(
        inputFiles.map((f) => generateIllustration(f.path)),
      );

      const panelsHtml = illustrationBuffers
        .map((buf, i) => {
          const tempPath = path.join(OUTPUT_DIR, `_tmp-illust-${Date.now()}-${i}.png`);
          fs.writeFileSync(tempPath, buf);
          tempPaths.push(tempPath);

          const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
          const caption = escapeHtml(captions[i] || '');
          const bubblePos = i % 2 === 0 ? 'top' : 'bottom';
          const bubbleHtml = caption ? `<div class="bubble ${bubblePos}">${caption}</div>` : '';
          return `<div class="panel" style="grid-area: p${i + 1};"><img src="${dataUri}" />${bubbleHtml}</div>`;
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
      const outName = `illustcomic-${Date.now()}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      await pageEl.screenshot({ path: outPath });

      res.json({ url: `/output/${outName}` });
    } catch (err) {
      console.error('illustration comic error:', err.response?.data || err.message);
      res.status(500).json({
        error: 'AI 일러스트 만화 생성 중 오류가 발생했습니다.',
        detail: err.response?.data?.error?.message || err.message,
      });
    } finally {
      if (browser) await browser.close();
      if (files) {
        for (const f of files) if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
      for (const p of tempPaths) fs.rm(p, { force: true }, () => {});
    }
  });

  return router;
};
