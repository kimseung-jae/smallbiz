const express = require('express');
const axios = require('axios');
const { callAI, hasAIKey } = require('../lib/aiClient');
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

// AI 요약 없이(폴백) 쓸 때, 블로그 원문 특유의 지저분한 흔적(해시태그 잔뜩, "-끝-", 어중간한 "...")을
// 정리해서 한 줄 소개로 쓸 만한 형태로 다듬는다.
function cleanSnippet(text, maxLength = 90) {
  let s = String(text || '').trim();
  s = s.replace(/(#[^\s#]+\s*){2,}/g, '').trim(); // 해시태그 나열 구간 제거
  s = s.replace(/^-+\s*끝\s*-+/, '').trim(); // "-끝-" 같은 블로그 장식 문구 제거
  s = s.replace(/\.{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim(); // 문장 중간/끝의 "..." 말줄임표 전부 제거

  if (s.length > maxLength) {
    const cut = s.slice(0, maxLength);
    const lastEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    if (lastEnd > maxLength * 0.4) {
      s = cut.slice(0, lastEnd + 1);
    } else {
      const lastSpace = cut.lastIndexOf(' ');
      s = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
    }
  }
  return s.trim();
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

    if (!hasAIKey()) {
      // AI 요약 없이, 정리된 스니펫을 후보로 제공 (해시태그/말줄임표 등 제거)
      const candidates = snippets
        .map((s) => cleanSnippet(s.description))
        .filter((s) => s.length >= 5);
      return res.json({ candidates: candidates.slice(0, 3), source: 'blog-raw' });
    }

    const snippetBlock = snippets
      .map((s, i) => `${i + 1}. ${s.title} - ${s.description}`)
      .join('\n');

    const prompt = `아래는 "${storeName}"에 대한 네이버 블로그 포스트 검색 결과입니다.

${snippetBlock}

이 내용을 참고해서 두 가지를 만들어주세요.
1. candidates: 이 가게를 홍보하는 콘텐츠에 쓸 "한 줄 소개" 후보 3개. 각 후보는 대표메뉴/강점/분위기 중 하나에 초점을 맞춘 한 문장(40자 이내).
2. combined: 위 후보들이 담고 있는 여러 강점(대표메뉴, 이벤트/서비스, 공간/규모 등)을 하나로 자연스럽게 종합한 한 줄 소개 (50자 내외, 나열식이 아니라 매끄러운 한 문장으로).

블로그에 없는 사실을 지어내지 말고, 실제 언급된 내용만 반영하세요.

반드시 아래 JSON 형식으로만 응답하세요.
{
  "candidates": ["...", "...", "..."],
  "combined": "..."
}`;

    const text = await callAI(prompt, 500);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const candidates = snippets
        .map((s) => cleanSnippet(s.description))
        .filter((s) => s.length >= 5);
      return res.json({ candidates: candidates.slice(0, 3), source: 'blog-raw-fallback' });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ candidates: parsed.candidates || [], combined: parsed.combined || null, source: 'blog-ai' });
  } catch (err) {
    console.error('store-intro error:', err.message);
    res.status(500).json({ error: '블로그 후기를 가져오는 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
