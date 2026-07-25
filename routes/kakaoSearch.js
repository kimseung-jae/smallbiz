const express = require('express');
const axios = require('axios');
const router = express.Router();

// 카카오 로컬 API(키워드 검색) — 상호명으로 검색하되, 좌표를 주면 그 위치 기준 거리순으로 정렬됨.
router.get('/', async (req, res) => {
  const { query } = req.query;
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.KAKAO_REST_API_KEY) {
    return res.json({ needsApiKey: true, message: '카카오 REST API 키가 없어요.' });
  }

  const params = { query, size: 10 };
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    params.x = lng;
    params.y = lat;
    params.sort = 'distance';
  }

  try {
    const response = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      params,
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
      timeout: 8000,
    });

    const places = (response.data.documents || []).map((doc) => ({
      name: doc.place_name,
      category: doc.category_name,
      address: doc.road_address_name || doc.address_name,
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      distance: doc.distance ? Number(doc.distance) : null,
    }));

    res.json({ places });
  } catch (err) {
    console.error('kakao search error:', err.response?.data || err.message);
    res.status(500).json({ error: '카카오 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
