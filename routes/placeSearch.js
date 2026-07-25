const express = require('express');
const axios = require('axios');
const router = express.Router();

// 네이버 지오코딩(주소 전용)이 매장명으로는 못 찾을 때의 폴백.
// OpenStreetMap Nominatim은 키/가입 없이 바로 되고, 상호명 검색도 어느 정도 커버함.
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      headers: {
        'User-Agent': 'hanul-platform/1.0 (small-business marketing tool)',
        'Accept-Language': 'ko',
      },
      params: { q: query, format: 'json', limit: 5, countrycodes: 'kr' },
    });

    const places = response.data.map((r) => ({
      name: r.display_name.split(',')[0],
      address: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));

    res.json({ places });
  } catch (err) {
    console.error('place search fallback error:', err.message);
    res.status(500).json({ error: '위치 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
