const express = require('express');
const axios = require('axios');
const router = express.Router();

function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// 네이버 검색 오픈API(블로그 검색) 결과를 AI가 읽고 "한 줄 소개" 후보를 뽑아주는 라우트.
// 실제 별점/방문자리뷰 API는 존재하지 않으므로, 블로그 포스트를 근사치 소스로 사용한다.
// 스크래핑이 아니라 공식 API만 사용 — 네이버 ToS/구조 변경에 영향받지 않도록.
router.post('/', async (req, res) => {
  const { storeName } = req.body;
  if (!storeName || !storeName.trim()) {
    return res.status(400).json({ error: '매장명이 필요합니다.' });
  }

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return res.json({
      needsApiKey: true,
      message: '네이버 검색 API 키가 설정되지 않아 블로그 후기를 가져올 수 없어요. .env에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 추가해주세요.',
    });
  }

  try {
    const blogRes = await axios.get('https://openapi.naver.com/v1/search/blog.json', {
      params: { query: storeName, display: 5, sort: 'sim' },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
    });

    const items = blogRes.data.items || [];
    if (!items.length) {
      return res.json({ candidates: [], message: '관련 블로그 포스트를 찾지 못했어요. 직접 입력해주세요.' });
    }

    const snippets = items.map((item) => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
    }));

    if (!process.env.ANTHROPIC_API_KEY) {
      // AI 요약 없이, 원문 스니펫을 그대로 후보로 제공
      const candidates = snippets.slice(0, 3).map((s) => s.description).filter(Boolean);
      return res.json({ candidates, source: 'blog-raw' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const snippetBlock = snippets
      .map((s, i) => `${i + 1}. ${s.title} - ${s.description}`)
      .join('\n');

    const prompt = `아래는 "${storeName}"에 대한 네이버 블로그 포스트 검색 결과입니다.

${snippetBlock}

이 내용을 참고해서, 이 가게를 홍보하는 콘텐츠에 쓸 "한 줄 소개" 후보를 3개 만들어주세요.
각 후보는 대표메뉴/강점/분위기 중 하나에 초점을 맞춘 한 문장(40자 이내)이어야 합니다.
블로그에 없는 사실을 지어내지 말고, 실제 언급된 내용만 반영하세요.

반드시 아래 JSON 형식으로만 응답하세요.
{
  "candidates": ["...", "...", "..."]
}`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const candidates = snippets.slice(0, 3).map((s) => s.description).filter(Boolean);
      return res.json({ candidates, source: 'blog-raw-fallback' });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ candidates: parsed.candidates || [], source: 'blog-ai' });
  } catch (err) {
    console.error('store-intro error:', err.message);
    res.status(500).json({ error: '블로그 후기를 가져오는 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
