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

  // Render 공용 IP가 Overpass 공개 서버들한테 자주 429(rate limit)를 받는다 — 이건 카카오 결과로
  // 이미 보완되는 보조 소스일 뿐이라, 호출부가 어차피 Promise.allSettled로 무시하는 걸 굳이
  // 500/에러 로그로 시끄럽게 만들지 않고 빈 결과로 조용히 넘긴다.
  console.error('nearby places: all mirrors failed, returning empty:', lastErr?.message);
  res.json({ places: [] });
});

module.exports = router;
