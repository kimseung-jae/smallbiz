const express = require('express');
const { callAI, hasAIKey } = require('../lib/aiClient');
const router = express.Router();

function tag(str) {
  const clean = String(str || '').split(/[·(),&]/)[0].trim();
  return clean.replace(/\s+/g, '');
}

// Strip a trailing unmatched "(" fragment, e.g. "액세서리(머리끈" -> "액세서리"
function closeParens(str) {
  const opens = (str.match(/\(/g) || []).length;
  const closes = (str.match(/\)/g) || []).length;
  return opens > closes ? str.replace(/\([^)]*$/, '').trim() : str;
}

// Split on commas that are not inside parentheses, so "액세서리(머리끈, 브로치)" stays whole.
function splitFeatures(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(str || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '·') && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

// Template-based fallback so the demo always produces usable copy even with
// no ANTHROPIC_API_KEY configured — not a live AI call, just rule-based text.
function buildFallbackContent({ storeName, category, features, purpose, region }) {
  const featureList = splitFeatures(features);
  const firstFeature = closeParens(featureList[0] || category);
  const secondFeature = closeParens(featureList[1] || '');
  const storeTag = tag(storeName);
  const categoryTag = tag(category);
  const regionTag = tag(region || '');
  const goal = purpose || '신규 고객 유치';
  const regionPrefix = region ? `${region}에서 발견한 ` : '';
  const regionTagStr = regionTag ? ` #${regionTag}` : '';

  const sns_captions = [
    `${storeName}에서 만나는 ${category} ✨ ${firstFeature}까지, 지금 확인해보세요! #${storeTag}${regionTagStr} #${categoryTag}`,
    `${goal}! ${storeName}의 ${firstFeature}, 이번 기회에 만나보세요 🙌 #소상공인 #${storeTag}`,
    secondFeature
      ? `${regionPrefix}${storeName} 🌿 ${firstFeature}, ${secondFeature} #${storeTag}${regionTagStr}`
      : `${regionPrefix}${storeName} 🌿 ${firstFeature} #${storeTag}${regionTagStr}`,
  ];

  const blog_post = `${region ? `${region}에 위치한 ` : ''}${storeName}은 ${category} 전문점입니다.\n\n${features}\n\n${goal}를 위해 정성껏 준비했습니다. ${storeName}에서 특별한 경험을 만나보세요.`;

  const flyer_text = `${storeName}\n${firstFeature}`;

  return { sns_captions, blog_post, flyer_text, fallback: true };
}

router.post('/', async (req, res) => {
  const { storeName, category, features, purpose, region, reviewSnippets } = req.body;

  if (!storeName || !category || !features) {
    return res.status(400).json({ error: '가게명, 업종, 메뉴/특징은 필수입니다.' });
  }

  if (!hasAIKey()) {
    return res.json(buildFallbackContent({ storeName, category, features, purpose, region }));
  }

  const reviewBlock = Array.isArray(reviewSnippets) && reviewSnippets.length
    ? `\n\n참고할 기존 리뷰/후기 스니펫 (실제 손님 반응, 톤 참고용):\n${reviewSnippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '';

  const prompt = `당신은 대한민국 소상공인을 위한 홍보 카피라이터입니다. 아래 가게 정보를 바탕으로 홍보 콘텐츠를 만들어주세요.

가게명: ${storeName}
${region ? `지역: ${region}\n` : ''}업종: ${category}
메뉴/특징: ${features}
홍보 목적: ${purpose || '신규 고객 유치'}${reviewBlock}

다음 3가지를 만들어주세요:
1. sns_captions: 인스타그램/네이버 감성의 짧은 홍보 문구 2~3개 (해시태그 포함, 각각 3문장 이내)
2. blog_post: 검색 노출에 유리한 블로그용 상세 소개글 1개 (500자 내외, 소제목 포함 가능)
3. flyer_text: 전단지/포스터용 임팩트 있는 짧은 카피 1개 (한 줄 헤드라인 + 부제 형태)

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{
  "sns_captions": ["...", "..."],
  "blog_post": "...",
  "flyer_text": "..."
}`;

  try {
    const text = await callAI(prompt, 1500);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'AI 응답을 파싱하지 못했습니다.', raw: text });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('generate-text error:', err.message);
    res.status(500).json({ error: '문구 생성 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
