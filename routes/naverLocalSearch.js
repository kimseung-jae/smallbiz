const express = require('express');
const axios = require('axios');
const router = express.Router();

function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '');
}

// 네이버 검색 오픈API(지역검색) — 상호명으로 실제 업체 정보(주소/카테고리/전화)를 찾는 전용 API.
// 지오코딩(주소 전용)이나 OSM(커버리지 부족)으로는 못 찾는 상호명 검색을 해결해줌.
// 무료 즉시발급 (developers.naver.com) — 결제 필요 없음.
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return res.json({
      needsApiKey: true,
      message: '네이버 검색 API 키가 없어서 상호명 검색을 못 해요. .env에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 추가해주세요 (무료, developers.naver.com).',
    });
  }

  try {
    const response = await axios.get('https://openapi.naver.com/v1/search/local.json', {
      params: { query, display: 5, sort: 'random' },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
    });

    const places = (response.data.items || []).map((item) => ({
      name: stripHtml(item.title),
      category: item.category,
      address: item.roadAddress || item.address,
      telephone: item.telephone || null,
      // 네이버 지역검색은 좌표를 KATECH 좌표계(TM128)로 주기 때문에 지도 표시엔 별도 변환이 필요함 —
      // 여기서는 위치 확인용으로 주소 텍스트만 쓰고, 지도 마커는 이 주소를 다시 지오코딩해서 찍는다.
      mapx: item.mapx,
      mapy: item.mapy,
    }));

    res.json({ places });
  } catch (err) {
    console.error('naver local search error:', err.response?.data || err.message);
    res.status(500).json({ error: '네이버 지역검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
