require('dotenv').config();
require('./fontSetup');
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { closeBrowser } = require('./lib/browser');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

// output/ 폴더가 결과물을 계속 쌓기만 하고 지우지 않아 디스크가 차는 문제 —
// 서버 시작 시 한 번, 그 뒤 1시간마다 만들어진 지 2시간 지난 파일을 지운다.
const OUTPUT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
function cleanupOldOutputFiles() {
  let files;
  try {
    files = fs.readdirSync(outputDir);
  } catch (err) {
    console.error('output 폴더 정리 중 오류:', err.message);
    return;
  }

  const now = Date.now();
  for (const name of files) {
    const filePath = path.join(outputDir, name);
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > OUTPUT_MAX_AGE_MS) {
        fs.rmSync(filePath, { force: true });
      }
    } catch (err) {
      console.error(`output 파일 정리 중 오류(${name}):`, err.message);
    }
  }
}
cleanupOldOutputFiles();
setInterval(cleanupOldOutputFiles, 60 * 60 * 1000);

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
app.use('/api/reels-kinetic', require('./routes/reelsKinetic')(upload));
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

// 서버가 꺼질 때(배포 플랫폼의 재시작/스케일다운 포함) 재사용 중이던 puppeteer 브라우저도 같이 닫는다.
process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
