const express = require('express');
const axios = require('axios');
const router = express.Router();

function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '');
}

// 네이버 검색 오픈API(이미지 검색) — 매장명/키워드로 웹에 있는 관련 이미지를 찾아준다.
// 사장님이 직접 찍은 사진이 부족할 때 참고/보완용으로 사용.
router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return res.json({
      needsApiKey: true,
      message: '네이버 검색 API 키가 없어서 이미지 검색을 못 해요.',
    });
  }

  try {
    const response = await axios.get('https://openapi.naver.com/v1/search/image', {
      params: { query, display: 12, sort: 'sim', filter: 'medium' },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
    });

    const images = (response.data.items || []).map((item) => ({
      title: stripHtml(item.title),
      imageUrl: item.link,
      thumbnailUrl: item.thumbnail,
      width: item.sizewidth,
      height: item.sizeheight,
    }));

    res.json({ images });
  } catch (err) {
    console.error('image search error:', err.response?.data || err.message);
    res.status(500).json({ error: '이미지 검색 중 오류가 발생했습니다.', detail: err.message });
  }
});

module.exports = router;
