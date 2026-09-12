const express = require('express');
const path = require('path');
const fs = require('fs');
const { getSampleFiles } = require('./sampleMedia');
const { callAI, hasAIKey } = require('../lib/aiClient');
const { getBrowser } = require('../lib/browser');
const { serializeUpload } = require('../lib/requestQueue');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'cardnews-panel.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function toDataUri(filePath) {
  const ext = path.extname(filePath).slice(1) || 'jpeg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function extractVideoFrame(videoPath) {
  const { execFile } = require('child_process');
  const ffmpegPath = require('ffmpeg-static');
  return new Promise((resolve, reject) => {
    const framePath = `${videoPath}.frame.jpg`;
    execFile(ffmpegPath, ['-y', '-i', videoPath, '-ss', '00:00:00.5', '-frames:v', '1', framePath],
      (err) => (err ? reject(err) : resolve(framePath)));
  });
}

module.exports = (upload) => {
  const router = express.Router();

  // 슬라이드별 문구를 사용자가 다 직접 쓰지 않아도 되도록, 가게명/업종/특징으로
  // 슬라이드 수에 맞는 문구를 한 번에 만들어주는 엔드포인트 (routes/generateText.js의 AI 문구 생성과 동일한 callAI 사용)
  router.post('/captions', async (req, res) => {
    const { storeName, category, features, slideCount } = req.body;
    const count = Math.max(1, Math.min(6, Number(slideCount) || 1));

    if (!storeName) {
      return res.status(400).json({ error: '매장명이 필요합니다.' });
    }

    if (!hasAIKey()) {
      return res.json({
        needsApiKey: true,
        message: 'AI 문구 생성 키가 없어서 슬라이드 문구를 자동으로 만들 수 없어요. 직접 입력해주세요.',
      });
    }

    const prompt = `당신은 소상공인 홍보 카드뉴스를 만드는 카피라이터입니다.
가게명: ${storeName}
업종/특징: ${category || ''} ${features || ''}

카드뉴스는 총 ${count}장입니다. 각 장에 들어갈 짧은 문구를 정확히 ${count}개 만들어주세요.
- 1번째 문구는 표지에 들어갈 강렬한 한 줄 (12자 내외)
${count > 1 ? '- 마지막 문구는 방문을 유도하는 한 줄\n' : ''}${count > 2 ? '- 중간 문구들은 메뉴/특징/강점을 하나씩 소개하는 한 줄 (16자 내외)\n' : ''}
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
      console.error('card-news captions error:', err.message);
      res.status(500).json({ error: '문구 생성 중 오류가 발생했습니다.', detail: err.message });
    }
  });

  router.post('/', serializeUpload(upload.array('photos', 6), async (req, res) => {
    const { storeName, headline, address, ctaText, useSample } = req.body;
    const files = useSample === 'true' ? getSampleFiles(4) : req.files;
    // captions[i]는 i번째 슬라이드(사진) 전용 문구 — 사용자가 슬라이드별로 직접 입력/수정한 값
    let captions = [];
    try {
      captions = JSON.parse(req.body.captions || '[]');
    } catch {
      captions = [];
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: '사진이 최소 1개 이상 필요합니다.' });
    }

    let page;
    const extractedFrames = [];
    const outUrls = [];
    try {
      const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080 });

      const count = files.length;

      for (let i = 0; i < count; i++) {
        const file = files[i];
        let imagePath = file.path;
        if (file.mimetype.startsWith('video/')) {
          const framePath = await extractVideoFrame(file.path);
          extractedFrames.push(framePath);
          imagePath = framePath;
        }

        const isCover = i === 0;
        const isLast = i === count - 1 && count > 1;

        let overlay, contentHtml, pageBadge;
        const storeBadge = storeName ? `<div class="store-badge">${escapeHtml(storeName)}</div>` : '';
        pageBadge = `<div class="page-badge">${i + 1}/${count}</div>`;

        if (isCover) {
          overlay = 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.35) 100%)';
          const wrapped = wrapText(captions[0] || headline || storeName || '', 12);
          contentHtml = `
            <div class="content">
              <div class="headline">${escapeHtml(wrapped)}</div>
              <div class="accent"></div>
            </div>`;
        } else if (isLast) {
          overlay = 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.65))';
          contentHtml = `
            <div class="content center">
              <div class="headline">${escapeHtml(storeName || '')}</div>
              <div class="accent center"></div>
              ${address ? `<div class="caption">${escapeHtml(address)}</div>` : ''}
              ${captions[i] ? `<div class="caption">${escapeHtml(captions[i])}</div>` : ''}
              <div class="cta-btn">${escapeHtml(ctaText || '지금 방문해보세요')}</div>
            </div>`;
        } else {
          overlay = 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.05) 50%)';
          const caption = captions[i] || '';
          contentHtml = `
            <div class="content">
              ${caption ? `<div class="caption" style="font-size:36px; font-weight:700;">${escapeHtml(wrapText(caption, 16))}</div>` : ''}
            </div>`;
        }

        let html = template
          .replace('__PHOTO__', `<img src="${toDataUri(imagePath)}" />`)
          .replace('__OVERLAY__', overlay)
          .replace('__HEADLINE_SIZE__', isCover ? '72' : '48')
          .replace('__PAGE_BADGE__', pageBadge)
          .replace('__STORE_BADGE__', isCover || isLast ? '' : storeBadge)
          .replace('__CONTENT__', contentHtml);

        await page.setContent(html, { waitUntil: 'networkidle0' });
        const outName = `cardnews-${Date.now()}-${i}.png`;
        const outPath = path.join(OUTPUT_DIR, outName);
        await page.screenshot({ path: outPath });
        outUrls.push(`/output/${outName}`);
      }

      res.json({ urls: outUrls });
    } catch (err) {
      console.error('card news generation error:', err.message);
      res.status(500).json({ error: '카드뉴스 생성 중 오류가 발생했습니다.', detail: err.message });
    } finally {
      if (page) await page.close();
      if (files) {
        for (const f of files) if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
      for (const framePath of extractedFrames) fs.rm(framePath, { force: true }, () => {});
    }
  }));

  return router;
};
