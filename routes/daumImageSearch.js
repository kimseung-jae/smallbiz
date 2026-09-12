const express = require('express');
const axios = require('axios');
const { filterRelevantImages } = require('../lib/imageRelevance');
const router = express.Router();

// 다음(Daum) 검색 API의 이미지 검색 — 카카오가 다음을 인수해서 카카오 REST API 키로 바로 사용 가능.
// 네이버 이미지 검색과 같은 성격(웹 전체 검색)이라 셋을 합쳐서 "실제 웹 이미지" 후보로 제공.
async function fetchDaumImages(query) {
  if (!process.env.KAKAO_REST_API_KEY) return { needsApiKey: true, images: [] };

  const response = await axios.get('https://dapi.kakao.com/v2/search/image', {
    params: { query, size: 30, sort: 'accuracy' },
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    timeout: 8000,
  });

  // 주의: display_sitename이 없다고 title을 query로 채우면 관련도 필터(제목에 검색어 포함 여부)가
  // 항상 통과돼버려 사실상 무필터가 된다 — 빈 문자열로 둬서 필터가 정직하게 동작하게 한다.
  const images = (response.data.documents || []).map((doc) => ({
    title: doc.display_sitename || '',
    imageUrl: doc.image_url,
    thumbnailUrl: doc.thumbnail_url,
    width: doc.width,
    height: doc.height,
  }));

  return { images: filterRelevantImages(images, query).slice(0, 12) };
}

router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  try {
    const result = await fetchDaumImages(query);
    if (result.needsApiKey) {
      return res.json({ needsApiKey: true, message: '카카오 REST API 키가 없어서 다음 이미지 검색을 못 해요.' });
    }
    res.json(result);
  } catch (err) {
    console.error('daum image search error:', err.response?.data || err.message);
    res.status(500).json({ error: '다음 이미지 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
module.exports.fetchDaumImages = fetchDaumImages;
