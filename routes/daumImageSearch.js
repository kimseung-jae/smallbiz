const express = require('express');
const axios = require('axios');
const { filterRelevantImages } = require('../lib/imageRelevance');
const router = express.Router();

// 다음(Daum) 검색 API의 이미지 검색 — 카카오가 다음을 인수해서 카카오 REST API 키로 바로 사용 가능.
// 네이버 이미지 검색과 같은 성격(웹 전체 검색)이라 둘을 합쳐서 "실제 웹 이미지" 후보로 제공.
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.KAKAO_REST_API_KEY) {
    return res.json({ needsApiKey: true, message: '카카오 REST API 키가 없어서 다음 이미지 검색을 못 해요.' });
  }

  try {
    const response = await axios.get('https://dapi.kakao.com/v2/search/image', {
      params: { query, size: 30, sort: 'accuracy' },
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
      timeout: 8000,
    });

    const images = (response.data.documents || []).map((doc) => ({
      title: doc.display_sitename || query,
      imageUrl: doc.image_url,
      thumbnailUrl: doc.thumbnail_url,
      width: doc.width,
      height: doc.height,
    }));

    res.json({ images: filterRelevantImages(images, query).slice(0, 12) });
  } catch (err) {
    console.error('daum image search error:', err.response?.data || err.message);
    res.status(500).json({ error: '다음 이미지 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
