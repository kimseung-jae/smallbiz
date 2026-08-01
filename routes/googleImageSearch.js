const express = require('express');
const axios = require('axios');
const { filterRelevantImages } = require('../lib/imageRelevance');
const router = express.Router();

// 구글 프로그래밍 가능 검색엔진(Custom Search JSON API)의 이미지 검색.
// 네이버/다음 이미지 검색과 같은 성격(웹 전체 검색)이라 "실제 웹 이미지" 탭에 세 번째 소스로 추가.
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CSE_ID) {
    return res.json({
      needsApiKey: true,
      message: '구글 API 키가 없어서 구글 이미지 검색을 못 해요. .env에 GOOGLE_API_KEY / GOOGLE_CSE_ID를 추가해주세요.',
    });
  }

  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: process.env.GOOGLE_API_KEY,
        cx: process.env.GOOGLE_CSE_ID,
        q: query,
        searchType: 'image',
        num: 10,
        safe: 'active',
      },
      timeout: 8000,
    });

    const images = (response.data.items || []).map((item) => ({
      title: item.title || query,
      imageUrl: item.link,
      thumbnailUrl: item.image?.thumbnailLink || item.link,
      width: item.image?.width,
      height: item.image?.height,
    }));

    res.json({ images: filterRelevantImages(images, query) });
  } catch (err) {
    console.error('google image search error:', err.response?.data || err.message);
    res.status(500).json({ error: '구글 이미지 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
