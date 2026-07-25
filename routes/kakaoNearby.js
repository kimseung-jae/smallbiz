const express = require('express');
const axios = require('axios');
const router = express.Router();

// 카카오 로컬 API(카테고리 검색) — 좌표+반경 내 음식점/카페를 검색. 무료, 카드 등록 불필요.
// 카테고리 코드: FD6=음식점, CE7=카페
const CATEGORY_CODES = ['FD6', 'CE7'];

router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(parseInt(req.query.radius, 10) || 1200, 20000);
  const sort = req.query.sort === 'accuracy' ? 'accuracy' : 'distance';

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat, lng 파라미터가 필요합니다.' });
  }

  if (!process.env.KAKAO_REST_API_KEY) {
    return res.json({
      needsApiKey: true,
      message: '카카오 REST API 키가 없어서 주변 가게 검색을 못 해요. .env에 KAKAO_REST_API_KEY를 추가해주세요 (무료, developers.kakao.com).',
    });
  }

  try {
    const results = await Promise.all(
      CATEGORY_CODES.map((code) =>
        axios.get('https://dapi.kakao.com/v2/local/search/category.php', {
          params: { category_group_code: code, x: lng, y: lat, radius, sort, size: 15 },
          headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
          timeout: 8000,
        }),
      ),
    );

    const seen = new Set();
    const places = [];
    for (const r of results) {
      for (const doc of r.data.documents || []) {
        if (seen.has(doc.place_name)) continue;
        seen.add(doc.place_name);
        places.push({
          name: doc.place_name,
          category: doc.category_name,
          address: doc.road_address_name || doc.address_name,
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
          distance: doc.distance ? Number(doc.distance) : null,
        });
      }
    }

    res.json({ places });
  } catch (err) {
    console.error('kakao nearby error:', err.response?.data || err.message);
    res.status(500).json({ error: '카카오 주변 가게 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
