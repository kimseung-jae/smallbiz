const express = require('express');
const router = express.Router();

// 한글 받침 유무에 따라 올바른 조사를 골라줌 — "OO을(를)" 같은 어색한 표기 대신 자연스러운 문장을 위해
function hasBatchim(word) {
  const lastChar = String(word || '').trim().slice(-1);
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return true;
  return (code - 0xac00) % 28 !== 0;
}
function josa(word, withBatchim, withoutBatchim) {
  return hasBatchim(word) ? withBatchim : withoutBatchim;
}

// 사장님이 "본인 명의"로 직접 올리는 블로그 홍보 원고를 만들어주는 라우트.
// 손님인 척 위장한 가짜 후기가 아니라, 사장님 본인 목소리로 쓰는 매장 소개 콘텐츠임을
// 프롬프트/폴백 문구 모두에서 명확히 한다.
function buildFallbackPost({ storeName, category, features, address }) {
  const name = storeName || '저희 가게';
  const eul = josa(name, '을', '를');
  const eun = josa(name, '은', '는');
  const featuresText = features || '정성을 다해 준비한 메뉴들';
  const ro = josa(featuresText, '으로', '로');

  const body = `안녕하세요, ${name} 사장입니다 :)

오늘은 저희 ${name}${eul} 직접 소개해드리려고 이렇게 글을 씁니다.

■ 매장 소개
${name}${eun} ${category ? `${category} 전문점으로,` : ''} ${featuresText}${ro} 손님들을 맞이하고 있습니다.

■ 대표 메뉴
${features || '저희 매장의 대표 메뉴들을 소개합니다.'}
한 분 한 분 정성껏 준비하는 마음으로 만들고 있으니, 방문하시면 그 정성을 느끼실 수 있을 거예요.

■ 매장 위치 및 안내
${address ? `${address}에 위치해 있습니다.` : '매장 위치는 지도를 참고해주세요.'} 처음 방문하시는 분들도 편하게 찾아오실 수 있도록 안내해드리고 있으니, 언제든 편하게 문의해주세요.

■ 마치며
직접 운영하는 입장에서, 저희 매장을 찾아주시는 모든 분들께 늘 감사한 마음뿐입니다. 앞으로도 한결같은 마음으로 손님들을 맞이하겠습니다. 이 글을 보고 방문해주신다면 정말 반갑게 맞이하겠습니다. 감사합니다 :)`;

  return { title: `[${name}] 사장이 직접 소개하는 우리 가게 이야기`, body, fallback: true };
}

router.post('/', async (req, res) => {
    const { storeName, category, features, address } = req.body;
    if (!storeName || !storeName.trim()) {
      return res.status(400).json({ error: '매장명이 필요합니다.' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json(buildFallbackPost({ storeName, category, features, address }));
    }

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = `당신은 "${storeName}"을 운영하는 사장님입니다. 본인 명의 블로그(네이버 블로그 등)에 직접 올릴 매장 소개 홍보 포스트를 써주세요.

가게명: ${storeName}
${category ? `업종: ${category}\n` : ''}${features ? `대표메뉴/강점: ${features}\n` : ''}${address ? `위치: ${address}\n` : ''}

중요한 조건:
- 반드시 "사장님이 본인 매장을 직접 소개하는" 시점과 말투로 쓸 것. "손님으로 방문했다가 우연히 발견한 맛집" 같은, 제3자/손님 시점으로 위장하는 문장은 절대 쓰지 말 것 (이건 허위 후기로 오해될 수 있어 금지).
- 실제 네이버 블로거들이 많이 쓰는 감성적이고 상세한 문체(소제목 구성, 친근한 존댓말, 이모티콘 약간)를 쓰되, 시점은 항상 "저희 가게", "제가 운영하는" 등 사장님 본인 시점 유지
- 반드시 "■ 매장 소개", "■ 대표 메뉴", "■ 매장 위치 및 안내", "■ 마치며" 같은 형태로 "■ 섹션제목"을 각 문단 맨 앞에 붙여서 구분할 것 (프론트에서 이 마커로 섹션을 파싱해서 예쁘게 표시함)
- 800~1200자 분량
- 조사를 붙일 때 "OO을(를)"처럼 괄호 표기를 쓰지 말고, 받침 유무에 맞는 자연스러운 조사(을/를, 은/는, 으로/로 등)를 정확히 골라서 쓸 것

반드시 아래 JSON 형식으로만 응답하세요.
{
  "title": "...",
  "body": "..."
}`;

      const msg = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json(buildFallbackPost({ storeName, category, features, address }));
      }
      const parsed = JSON.parse(jsonMatch[0]);
      res.json({ title: parsed.title, body: parsed.body });
    } catch (err) {
      console.error('blog-post-draft error:', err.message);
      res.json(buildFallbackPost({ storeName, category, features, address }));
    }
});

module.exports = router;
