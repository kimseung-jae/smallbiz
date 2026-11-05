// 개발자용 1회성 검증 스크립트 — AI 키 없이, 세 릴스 포맷(hook-list/before-after/menu-spotlight)을
// 같은 가게 사진 세트로 전부 만들어 output/ 에 저장하고, 각 영상에서 1초 간격으로 프레임을 뽑아
// 자막이 잘리거나 겹치지 않는지 직접 눈으로 확인할 수 있게 한다.
//
// 실행: node scripts/testReelsFormats.js [프레임을 뽑을 디렉토리]
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { loadFormats, resolveCutCounts } = require('../lib/reelsFormat');

const reelsRouterFactory = require('../routes/reels');
const router = reelsRouterFactory({ array: () => (req, res, next) => next() });

const STORE_NAME = '하늘카페';
const ADDRESS = '서울시 성동구 왕십리로 123';

const SCRATCH_DIR = path.join(require('os').tmpdir(), 'reels-format-test');
const PHOTOS_DIR = path.join(SCRATCH_DIR, 'photos');
const FRAMES_ROOT = process.argv[2] || path.join(SCRATCH_DIR, 'frames');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// 실제 업로드 사진이 없으니, 매장 사진 4장(외관/내부/메뉴 2종)을 흉내 낸 합성 이미지를 만든다 —
// 컷마다 색이 달라야 프레임을 눈으로 구분하기 쉽다.
async function buildSamplePhotos() {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const shots = [
    { name: 'exterior.png', color: '#6b4f3b', label: '외관' },
    { name: 'interior.png', color: '#a97c50', label: '내부' },
    { name: 'menu1.png', color: '#c9a14a', label: '크루아상' },
    { name: 'menu2.png', color: '#4a6fa5', label: '아메리카노' },
  ];
  const files = [];
  for (const shot of shots) {
    const svg = `<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="1350" fill="${shot.color}" />
      <text x="540" y="700" font-size="70" fill="#fff" text-anchor="middle" font-family="sans-serif">${shot.label}</text>
    </svg>`;
    const filePath = path.join(PHOTOS_DIR, shot.name);
    await sharp(Buffer.from(svg)).png().toFile(filePath);
    files.push({ path: filePath, mimetype: 'image/png', isSample: true });
  }
  return files;
}

// 글자 수 제한을 꽉 채운, 공백 없는 최악의 경우 문구로 자막 잘림/겹침을 적극적으로 스트레스 테스트한다.
function stressCaptions(format, cutCounts) {
  const captions = {};
  for (const seg of format.segments) {
    if (seg.type === 'hook') {
      captions[seg.id] = '매콤달콤한인생맛집'.slice(0, seg.caption.maxChars);
    } else if (seg.type === 'photo-cuts') {
      const n = cutCounts[seg.id];
      const pool = ['크루아상이기가막혀요', '아메리카노향이좋아요', '분위기가완전예술이에요', '사장님이친절해요'];
      captions[seg.id] = Array.from({ length: n }, (_, i) => pool[i % pool.length].slice(0, seg.caption.maxChars));
    }
  }
  return captions;
}

async function extractFrames(videoPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  await run(['-y', '-i', videoPath, '-vf', 'fps=1', path.join(outDir, 'frame_%02d.png')]);
  return fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort();
}

async function ffprobeDuration(videoPath) {
  // ffprobe가 ffmpeg-static에는 없으니, ffmpeg -i 의 stderr에서 Duration을 파싱한다.
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-i', videoPath], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      const text = stderr || (err && err.stderr) || '';
      const match = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (!match) return resolve(null);
      const [, h, m, s] = match;
      resolve(Number(h) * 3600 + Number(m) * 60 + Number(s));
    });
  });
}

async function main() {
  const photos = await buildSamplePhotos();
  const formats = loadFormats();

  console.log(`사진 ${photos.length}장(합성)으로 포맷 ${formats.length}개를 생성합니다.\n`);

  for (const format of formats) {
    const cutCounts = resolveCutCounts(format, photos.length);
    const captions = stressCaptions(format, cutCounts);
    const formatResult = { formatId: format.id, format, cutCounts, captions };

    console.log(`[${format.id}] 컷 수:`, cutCounts, ' 문구:', captions);

    const { outPath, outName, totalDuration } = await router.generateReelsVideo({
      files: photos,
      storeName: STORE_NAME,
      address: ADDRESS,
      mood: '',
      formatResult,
    });

    const actualDuration = await ffprobeDuration(outPath);
    console.log(`  -> ${outName} (계산된 길이 ${totalDuration.toFixed(2)}s, 실측 ${actualDuration?.toFixed(2)}s)`);

    const frameDir = path.join(FRAMES_ROOT, format.id);
    const frames = await extractFrames(outPath, frameDir);
    console.log(`  -> 프레임 ${frames.length}장 추출: ${frameDir}`);
  }

  console.log(`\n완료. 영상은 output/ 에, 프레임은 ${FRAMES_ROOT} 에 저장됐습니다.`);
}

main().catch((err) => {
  console.error('테스트 실패:', err.message, err.stderr || '');
  process.exit(1);
});
