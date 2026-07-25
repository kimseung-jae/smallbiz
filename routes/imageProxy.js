const express = require('express');
const axios = require('axios');
const router = express.Router();

// 검색 결과 이미지 URL은 외부 도메인이라 브라우저에서 바로 fetch()하면 CORS로 막힌다.
// 서버가 대신 받아와서(같은 출처로) 넘겨주는 프록시. SSRF 방지를 위해 http(s)만, 사설/내부 주소는 차단.
const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1)/i;

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url 파라미터가 필요합니다.' });

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: '올바르지 않은 URL입니다.' });
  }

  if (!/^https?:$/.test(parsed.protocol) || BLOCKED_HOSTS.test(parsed.hostname)) {
    return res.status(400).json({ error: '허용되지 않는 URL입니다.' });
  }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: 15 * 1024 * 1024, // 15MB 제한
      headers: { 'User-Agent': 'Mozilla/5.0 (hanul-platform image proxy)' },
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: '이미지가 아닌 응답입니다.' });
    }

    res.set('Content-Type', contentType);
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('image proxy error:', err.message);
    res.status(500).json({ error: '이미지를 가져오지 못했습니다.', detail: err.message });
  }
});

module.exports = router;
