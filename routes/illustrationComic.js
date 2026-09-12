const express = require('express');
const path = require('path');
const fs = require('fs');
const { getSampleFiles } = require('./sampleMedia');
const { getBrowser } = require('../lib/browser');
const { hasImageAIKey, restyleImageWithPrompt } = require('../lib/aiClient');
const { serializeUpload } = require('../lib/requestQueue');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'illustration-panel.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const LAYOUTS = {
  2: { cols: '1fr', rows: '600px 460px', areas: `"p1" "p2"` },
  3: { cols: '1.15fr 1fr', rows: '500px 500px', areas: `"p1 p2" "p1 p3"` },
  4: { cols: '1fr 1fr 1fr', rows: '560px 380px', areas: `"p1 p1 p1" "p2 p3 p4"` },
};

const STYLE_PROMPTS = {
  mizumaru: `이 사진 속 소재(사람, 음식, 사물, 공간)만 참고해서, 아래 규칙을 전부 지키는 아주 단순한 손그림 낙서 일러스트로 새로 그려주세요. 사진처럼 정교하게 그리면 안 됩니다.

그림 규칙 (전부 반드시 지킬 것):
1. 선: 굵기가 일정한 검은 잉크 선 하나로만 윤곽을 그리세요. 선이 살짝 삐뚤빼뚤해도 좋습니다.
2. 색: 파스텔톤 3~4가지 색만 평평한 단색으로 칠하세요. 그라데이션, 그림자, 하이라이트, 입체 음영 표현을 절대 넣지 마세요.
3. 디테일 생략: 재료의 결·질감·작은 글자·자잘한 무늬는 그리지 말고, 하나의 단순한 색 덩어리나 도형으로 뭉뚱그려 표현하세요. 예를 들어 고기 조각을 하나하나 그리지 말고 둥글넓적한 갈색 덩어리 하나로, 자갈 바닥을 하나하나 그리지 말고 그냥 밋밋한 회색 면으로 표현하세요.
4. 배경: 중요하지 않은 배경 요소는 과감히 비우거나, 아주 단순한 형태 한두 개로만 표시하세요.
5. 전체 느낌: 정교한 디지털 페인팅이나 애니메이션 배경 원화처럼 보이면 안 됩니다. 잡지 에세이 옆에 슥슥 그린 듯한 가벼운 손낙서처럼 보여야 합니다.

중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 그림만 그려주세요.`,
  watercolor: `이 사진을 참고해서, 은은하게 번지는 수채화 일러스트로 다시 그려주세요.
스타일 특징: 투명한 수채 물감의 번짐과 얼룩, 부드러운 색 경계, 종이 질감, 잔잔하고 따뜻한 파스텔 색조.
중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 일러스트 그림만 그려주세요. 원본 사진의 구도와 소재(사람/사물/공간)는 유지하되, 그림체만 위 스타일로 바꿔주세요.`,
  pen: `이 사진을 참고해서, 가는 펜으로 그린 흑백 펜 드로잉(선화) 일러스트로 다시 그려주세요.
스타일 특징: 촘촘한 해칭·크로스해칭 선으로 명암을 표현, 뚜렷한 윤곽선, 잉크 느낌의 질감, 스케치북에 그린 듯한 손그림 느낌.
중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 일러스트 그림만 그려주세요. 원본 사진의 구도와 소재(사람/사물/공간)는 유지하되, 그림체만 위 스타일로 바꿔주세요.`,
  pastelAnime: `이 사진을 참고해서, 파스텔톤 애니메이션풍 일러스트로 다시 그려주세요.
스타일 특징: 깔끔한 셀 애니메이션 라인, 부드러운 파스텔 색감의 셀 쉐이딩, 큼직하고 또렷한 눈매 표현, 화사하고 사랑스러운 분위기.
중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 일러스트 그림만 그려주세요. 원본 사진의 구도와 소재(사람/사물/공간)는 유지하되, 그림체만 위 스타일로 바꿔주세요.`,
  manga: `이 사진을 참고해서, 일본 순정/소년만화 단행본 스타일의 흑백 망가(漫画) 일러스트로 다시 그려주세요.
스타일 특징: 굵고 또렷한 잉크 윤곽선, 스크린톤(망점) 패턴으로 표현한 명암과 그림자, 강약이 뚜렷한 선(가는 선과 굵은 선의 대비), 인물이 있다면 크고 반짝이는 눈과 뾰족한 헤어라인 실루엣, 배경에는 속도감을 주는 집중선이나 효과선을 살짝 곁들여도 좋음, 전체적으로 흑백(그레이스케일) 톤.
중요: 이미지 안에 글자, 텍스트, 말풍선을 절대 넣지 마세요. 오직 일러스트 그림만 그려주세요. 원본 사진의 구도와 소재(사람/사물/공간)는 유지하되, 그림체만 위 스타일로 바꿔주세요.`,
};
const DEFAULT_STYLE = 'mizumaru';

function toBase64(filePath) {
  const ext = path.extname(filePath).slice(1) || 'jpeg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return { mime, data: fs.readFileSync(filePath).toString('base64') };
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// OpenRouter 경유로 그림체를 바꾼다 — 이미 릴스 사진 스타일 변환에 쓰던 것과 같은 키(OPENROUTER_API_KEY)라
// 구글 Gemini 직접 호출(별도 결제/크레딧)보다 이미 설정된 키를 그대로 활용할 수 있다.
async function generateIllustration(filePath, stylePrompt) {
  const { mime, data } = toBase64(filePath);
  const buffer = Buffer.from(data, 'base64');
  return restyleImageWithPrompt(buffer, mime, stylePrompt);
}

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', serializeUpload(upload.array('photos', 6), async (req, res) => {
    if (!hasImageAIKey()) {
      return res.json({
        needsApiKey: true,
        message: 'AI 이미지 생성 키가 설정되지 않아 AI 일러스트 만화를 만들 수 없어요. .env에 OPENROUTER_API_KEY를 추가해주세요. 그 전까지는 "포토툰" 모드(/api/webtoon)를 이용해주세요.',
      });
    }

    const { storeName, address, useSample, style } = req.body;
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

    const stylePrompt = STYLE_PROMPTS[style] || STYLE_PROMPTS[DEFAULT_STYLE];

    let page;
    const tempPaths = [];
    try {
      const count = Math.min(files.length, 4);
      const layout = LAYOUTS[count];
      const inputFiles = files.slice(0, count);

      // 컷 하나가 실패(모델 오류/타임아웃)해도 전체가 에러로 끝나지 않도록 allSettled로 동시 호출하고,
      // 실패한 컷은 원본 사진을 그대로 써서 나머지는 정상적으로 만들어지게 한다.
      const results = await Promise.allSettled(
        inputFiles.map((f) => generateIllustration(f.path, stylePrompt)),
      );

      const replacedIndexes = [];
      let quotaExhausted = false;
      const panelsHtml = results
        .map((result, i) => {
          let dataUri;
          if (result.status === 'fulfilled') {
            const buf = result.value;
            const tempPath = path.join(OUTPUT_DIR, `_tmp-illust-${Date.now()}-${i}.png`);
            fs.writeFileSync(tempPath, buf);
            tempPaths.push(tempPath);
            dataUri = `data:image/png;base64,${buf.toString('base64')}`;
          } else {
            const reasonMessage = result.reason?.message || '';
            console.error(`illustration comic panel ${i} failed, using original photo:`, reasonMessage);
            if (/429|quota|credit|RESOURCE_EXHAUSTED/i.test(reasonMessage)) quotaExhausted = true;
            replacedIndexes.push(i);
            const { mime, data } = toBase64(inputFiles[i].path);
            dataUri = `data:${mime};base64,${data}`;
          }

          const caption = escapeHtml(captions[i] || '');
          const bubblePos = i % 2 === 0 ? 'top' : 'bottom';
          const bubbleHtml = caption ? `<div class="bubble ${bubblePos}">${caption}</div>` : '';
          return `<div class="panel" style="grid-area: p${i + 1};"><img src="${dataUri}" />${bubbleHtml}</div>`;
        })
        .join('\n');

      const titleBar = storeName
        ? `<div class="title-bar">
            <div class="store-name">${escapeHtml(storeName)}</div>
            ${address ? `<div class="store-address">${escapeHtml(address)}</div>` : ''}
          </div>`
        : '';

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
      const outName = `illustcomic-${Date.now()}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      await pageEl.screenshot({ path: outPath });

      res.json({
        url: `/output/${outName}`,
        replacedIndexes,
        quotaMessage: quotaExhausted
          ? 'OpenRouter 크레딧이 부족해서 일부 컷은 원본 사진으로 대체됐어요. https://openrouter.ai/credits 에서 잔액을 확인해주세요.'
          : null,
      });
    } catch (err) {
      console.error('illustration comic error:', err.response?.data || err.message);
      res.status(500).json({
        error: 'AI 일러스트 만화 생성 중 오류가 발생했습니다.',
        detail: err.response?.data?.error?.message || err.message,
      });
    } finally {
      if (page) await page.close();
      if (files) {
        for (const f of files) if (!f.isSample) fs.rm(f.path, { force: true }, () => {});
      }
      for (const p of tempPaths) fs.rm(p, { force: true }, () => {});
    }
  }));

  return router;
};
