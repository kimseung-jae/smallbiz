const express = require('express');
const axios = require('axios');
const router = express.Router();

// Overpass API(OSM) — 위경도 반경 내 음식점/카페/상점을 무료로 검색. 키/가입 불필요.
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(parseInt(req.query.radius, 10) || 1200, 3000);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat, lng 파라미터가 필요합니다.' });
  }

  const query = `
    [out:json][timeout:15];
    (
      node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bakery)$"]["name"](around:${radius},${lat},${lng});
      node["shop"]["name"](around:${radius},${lat},${lng});
    );
    out body 40;
  `;

  // 공용 Overpass 서버는 가끔 과부하로 4xx/5xx를 반환하므로, 여러 미러를 순서대로 재시도한다.
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  let lastErr;
  for (const mirror of MIRRORS) {
    try {
      const response = await axios.post(
        mirror,
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 12000,
        },
      );

      const seen = new Set();
      const places = [];
      for (const el of response.data.elements || []) {
        const name = el.tags && el.tags.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        places.push({
          name,
          category: (el.tags.amenity || el.tags.shop || '').replace(/_/g, ' '),
          lat: el.lat,
          lng: el.lon,
        });
      }

      return res.json({ places });
    } catch (err) {
      lastErr = err;
      console.error(`nearby places error (${mirror}):`, err.message);
      // 다음 미러로 계속 시도
    }
  }

  res.status(500).json({ error: '주변 가게 검색 중 오류가 발생했습니다.', detail: lastErr?.message });
});

module.exports = router;
