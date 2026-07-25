const express = require('express');
const router = express.Router();

// 주의: 짧은 한 글자짜리 키워드(예: '짜')는 '진짜'처럼 무관한 단어에 우연히 포함되어
// 오탐지를 일으킬 수 있어, 실제 부정적 맥락에서만 쓰이는 더 긴 표현을 사용한다.
const NEGATIVE_KEYWORDS = [
  '별로', '맛없', '실망', '불친절', '최악', '더러워', '더러웠',
  '비싸요', '비쌌', '짜요', '짜서', '너무 짜', '싱거워', '싱거웠',
  '다시는', '불만', '환불', '늦었', '늦게', '너무 늦',
];

function detectSentiment(review) {
  const text = String(review || '');
  const negHit = NEGATIVE_KEYWORDS.some((k) => text.includes(k));
  if (negHit) return 'negative';
  return 'positive';
}

// 한글 받침 유무에 따라 올바른 조사를 골라줌 — "OO을(를)" 같은 어색한 표기 대신 자연스러운 문장을 위해
function hasBatchim(word) {
  const lastChar = String(word || '').trim().slice(-1);
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return true; // 한글 음절이 아니면(영문/숫자 등) 받침 있는 쪽 기본값
  return (code - 0xac00) % 28 !== 0;
}
function josa(word, withBatchim, withoutBatchim) {
  return hasBatchim(word) ? withBatchim : withoutBatchim;
}

// 규칙 기반 폴백 — Claude 키 없어도 바로 쓸 수 있는, 최대한 친절하고 감사한 마음을 담은 답글 템플릿
function buildFallbackReplies(storeName, sentiment) {
  const name = storeName || '저희 가게';
  const eul = josa(name, '을', '를');
  const eun = josa(name, '은', '는');

  const positiveTemplates = [
    () => `안녕하세요, ${name}입니다! 소중한 후기 남겨주셔서 정말 감사합니다 ㅎㅎ 맛있게 드셨다니 저희도 너무 기쁘네요~~ 앞으로도 한결같은 맛과 정성으로 보답하는 ${name}${eun} 되겠습니다. 다음에도 또 찾아주세요! 항상 감사한 마음으로 준비하고 있겠습니다 :)`,
    () => `${name}${eul} 이용해주셔서 진심으로 감사합니다! 좋게 봐주시니 저희가 더 힘이 나네요 ㅠㅠ 앞으로도 손님들께 만족드릴 수 있도록 더 열심히 하겠습니다. 다음에 오실 땐 더 맛있게, 더 친절하게 모시겠습니다! 항상 건강하시고 좋은 일만 가득하시길 바라요~`,
    () => `이렇게 좋은 후기 남겨주셔서 너무너무 감사드립니다! ${name} 사장 올림입니다 :) 손님 덕분에 오늘 하루 힘이 났어요. 앞으로도 초심 잃지 않고 정성껏 준비하겠습니다. 또 뵙는 날까지 건강 챙기시고, 다음에 오시면 더 신경 써서 모시겠습니다. 항상 감사한 마음뿐입니다!`,
  ];

  const negativeTemplates = [
    () => `안녕하세요, ${name}입니다. 먼저 기대에 못 미친 점 진심으로 죄송한 마음 전합니다. 그럼에도 이렇게 귀한 시간 내어 말씀 남겨주셔서 정말 감사드려요. 남겨주신 말씀 무겁게 받아들이고 바로 개선하도록 하겠습니다. 다음엔 꼭 만족하실 수 있도록 더 신경 쓰겠습니다, 감사합니다.`,
    () => `${name} 사장입니다. 불편을 드려 정말 죄송합니다. 말씀해주신 부분은 저희가 놓친 부분이라 생각하고 바로바로 고쳐나가겠습니다. 이렇게 솔직하게 말씀해주신 것도 정말 감사한 일이라 생각합니다. 다시 한번 기회 주신다면 더 나은 모습으로 보답하겠습니다, 진심으로 감사드려요.`,
    () => `소중한 의견 남겨주셔서 진심으로 감사합니다. 기대에 미치지 못해 많이 죄송한 마음입니다. 말씀해주신 내용 꼼꼼히 확인해서 다음엔 이런 일이 없도록 신경 쓰겠습니다. ${name}${eul} 믿고 다시 한번 찾아주신다면, 그때는 꼭 만족하실 수 있게 정성을 다하겠습니다. 진심으로 죄송하고, 또 감사합니다.`,
  ];

  const pool = sentiment === 'negative' ? negativeTemplates : positiveTemplates;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((fn) => fn());
}

router.post('/', async (req, res) => {
  const { storeName, review } = req.body;
  if (!review || !review.trim()) {
    return res.status(400).json({ error: '리뷰 내용이 필요합니다.' });
  }

  const sentiment = detectSentiment(review);

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ replies: buildFallbackReplies(storeName, sentiment), fallback: true, sentiment });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `당신은 "${storeName || '소상공인 매장'}"을 운영하는 사장님입니다. 아래 고객 리뷰에 대한 답글을 작성해주세요.

고객 리뷰: "${review}"

조건:
- 사장님이 직접 쓴 것처럼 정성스럽고, 최대한 친절하고 감사한 마음이 듬뿍 느껴지는 말투 (반말 금지, 존댓말)
- 불만 리뷰라도 진심 어린 사과와 함께 "그래도 이렇게 말씀해주셔서 감사하다"는 마음을 반드시 담을 것
- 리뷰 내용에 구체적으로 반응할 것
- 너무 딱딱하지 않게, 사람 냄새 나는 문장으로 (약간의 감탄사나 이모티콘 ㅎㅎ/ㅠㅠ/:) 정도는 괜찮음)
- 매장명에 조사를 붙일 때 "OO을(를)"처럼 괄호 표기를 쓰지 말고, 받침 유무에 맞는 자연스러운 조사(을/를, 은/는 등)를 정확히 골라서 쓸 것
- 서로 다른 톤의 답글 3개를 만들 것 (예: 담백한 버전, 조금 더 살가운 버전, 짧고 간결한 버전)
- 각 답글은 3~5문장 이내

반드시 아래 JSON 형식으로만 응답하세요.
{
  "replies": ["...", "...", "..."]
}`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ replies: buildFallbackReplies(storeName, sentiment), fallback: true, sentiment });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ replies: parsed.replies || [], sentiment });
  } catch (err) {
    console.error('review-reply error:', err.message);
    res.json({ replies: buildFallbackReplies(storeName, sentiment), fallback: true, sentiment });
  }
});

module.exports = router;
