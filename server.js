require('dotenv').config();
require('./fontSetup');
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 또는 영상 파일만 업로드할 수 있습니다.'));
    }
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(outputDir));

app.use('/api/generate-text', require('./routes/generateText'));
app.use('/api/store-intro', require('./routes/storeIntro'));
app.use('/api/place-search', require('./routes/placeSearch'));
app.use('/api/naver-local-search', require('./routes/naverLocalSearch'));
app.use('/api/nearby-places', require('./routes/nearbyPlaces'));
app.use('/api/kakao-nearby', require('./routes/kakaoNearby'));
app.use('/api/kakao-search', require('./routes/kakaoSearch'));
app.use('/api/review-reply', require('./routes/reviewReply'));
app.use('/api/image-search', require('./routes/imageSearch'));
app.use('/api/pexels-search', require('./routes/pexelsSearch'));
app.use('/api/daum-image-search', require('./routes/daumImageSearch'));
app.use('/api/google-image-search', require('./routes/googleImageSearch'));
app.use('/api/image-proxy', require('./routes/imageProxy'));
app.use('/api/blog-post-draft', require('./routes/blogPostDraft'));
app.use('/api/reels', require('./routes/reels')(upload));
app.use('/api/debug-restyle', require('./routes/debugRestyle')(upload));
app.use('/api/webtoon', require('./routes/webtoon')(upload));
app.use('/api/illustration-comic', require('./routes/illustrationComic')(upload));
app.use('/api/card-news', require('./routes/cardNews')(upload));
app.use('/api/poster', require('./routes/poster')(upload));

app.use((err, req, res, next) => {
  console.error('request error:', err.message);
  res.status(400).json({ error: err.message || '요청 처리 중 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`한을 플랫폼 서버 실행 중: http://localhost:${PORT}`);
});
