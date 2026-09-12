const express = require('express');
const { fetchDaumImages } = require('./daumImageSearch');
const { fetchNaverImages } = require('./imageSearch');
const { fetchGoogleImages } = require('./googleImageSearch');
const { classifyRelevantImages } = require('../lib/aiClient');
const router = express.Router();

// 다음/네이버/구글 이미지 검색을 한 번에 호출해서 합치고, AI로 실제 이 가게와 관련된 사진인지
// 한 번 더 걸러서 돌려준다 — 프런트는 탭 전환·소스별 요청 없이 이 엔드포인트 하나만 부르면 된다.
router.post('/', async (req, res) => {
  const { storeName, address, category } = req.body;
  if (!storeName) return res.status(400).json({ error: '매장명이 필요합니다.' });

  // 주소가 있으면 지역명을 붙여서 검색어를 더 구체적으로 만듦 (관련도 향상)
  const regionHint = address ? String(address).split(' ').slice(0, 2).join(' ') : '';
  const query = regionHint ? `${storeName} ${regionHint}` : storeName;

  const [daumRes, naverRes, googleRes] = await Promise.allSettled([
    fetchDaumImages(query),
    fetchNaverImages(query),
    fetchGoogleImages(query),
  ]);

  const pick = (r) => (r.status === 'fulfilled' && !r.value.needsApiKey) ? (r.value.images || []) : [];
  let images = [...pick(daumRes), ...pick(naverRes), ...pick(googleRes)].slice(0, 20);

  // 실제로 사진을 보고 이 가게와 관련 있는지 한 번 더 검수한다 — 키가 없거나 실패하면 그대로 둔다.
  const keepIndexes = await classifyRelevantImages(images, { storeName, category });
  if (keepIndexes && keepIndexes.length) {
    images = keepIndexes.map((i) => images[i]);
  }

  res.json({ images, query });
});

module.exports = router;
