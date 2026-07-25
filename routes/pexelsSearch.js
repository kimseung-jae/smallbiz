const express = require('express');
const axios = require('axios');
const router = express.Router();

// Pexels API — 전문 사진작가들이 올린 고품질 무료 스톡사진 검색. 카드 등록 불필요.
// 주의: 실제 그 매장의 사진이 아니라 "분위기/카테고리"에 맞는 스톡사진임 (예: "카페", "한식집" 등으로 검색해야 잘 나옴).
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.PEXELS_API_KEY) {
    return res.json({
      needsApiKey: true,
      message: 'Pexels API 키가 없어서 이미지 검색을 못 해요. .env에 PEXELS_API_KEY를 추가해주세요 (무료, pexels.com/api).',
    });
  }

  try {
    const response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 12 },
      headers: { Authorization: process.env.PEXELS_API_KEY },
      timeout: 8000,
    });

    const images = (response.data.photos || []).map((photo) => ({
      title: photo.alt || query,
      imageUrl: photo.src.large,
      thumbnailUrl: photo.src.medium,
      photographer: photo.photographer,
      width: photo.width,
      height: photo.height,
    }));

    res.json({ images });
  } catch (err) {
    console.error('pexels search error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Pexels 이미지 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
