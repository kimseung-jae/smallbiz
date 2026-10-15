const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'remotion', 'index.js');
const PUBLIC_DIR = path.join(ROOT, 'remotion', 'public');
const FONT_SRC = path.join(ROOT, 'fonts', 'NotoSansKR-VF.ttf');
const MUSIC_DIR = path.join(ROOT, 'music');
const OUTPUT_DIR = path.join(ROOT, 'output');

// Remotion 의 staticFile() 은 publicDir 한 곳만 본다. 폰트와 음악을 거기로 모아둔다.
// (remotion/public 은 빌드 산출물이라 .gitignore 에 있다)
function ensurePublicDir() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const fontDest = path.join(PUBLIC_DIR, 'NotoSansKR-VF.ttf');
  if (!fs.existsSync(fontDest) && fs.existsSync(FONT_SRC)) {
    fs.copyFileSync(FONT_SRC, fontDest);
  }

  if (fs.existsSync(MUSIC_DIR)) {
    for (const file of fs.readdirSync(MUSIC_DIR)) {
      if (!file.endsWith('.mp3')) continue;
      const dest = path.join(PUBLIC_DIR, file);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(MUSIC_DIR, file), dest);
    }
  }
}

// 분위기 태그(bright_/calm_/trendy_)로 배경음악을 고른다 — music/README.md 의 규칙과 같다.
function pickMusic(mood) {
  if (!mood || !fs.existsSync(MUSIC_DIR)) return null;
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => f.endsWith('.mp3'));
  return files.find((f) => f.startsWith(`${mood}_`)) || null;
}

// 사진은 1080 폭으로 줄여서 data URI 로 넘긴다.
// 원본을 그대로 넘기면 inputProps 가 수십 MB 로 불어나 렌더가 느려진다.
async function toDataUri(filePath) {
  const buffer = await sharp(filePath)
    .rotate()
    .resize({ width: 1080, height: 1920, fit: 'cover', withoutEnlargement: false })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

let bundlePromise = null;

// 번들은 한 번만 만들어 재사용한다. 매번 만들면 요청마다 webpack 이 돈다.
function getBundle() {
  if (!bundlePromise) {
    const { bundle } = require('@remotion/bundler');
    ensurePublicDir();
    bundlePromise = bundle({
      entryPoint: ENTRY,
      publicDir: PUBLIC_DIR,
      onProgress: () => {},
    }).catch((err) => {
      bundlePromise = null; // 실패하면 다음 요청에서 다시 시도할 수 있게 비운다
      throw err;
    });
  }
  return bundlePromise;
}

/**
 * kinetic 스타일 릴스를 렌더링한다.
 * @param {object} options
 * @param {string[]} options.photoPaths 사진 파일 경로 (1장 이상)
 * @param {object} options.script { hook, highlight, lines[], closing }
 * @param {string} options.storeName
 * @param {string} [options.address]
 * @param {string} [options.mood] bright | calm | trendy
 * @param {number} [options.scale] 1 이면 1080x1920, 0.667 이면 720x1280
 * @returns {Promise<{ outputPath: string, fileName: string, durationInFrames: number }>}
 */
async function renderKineticReel({
  photoPaths,
  script,
  storeName,
  address,
  mood,
  scale = 1,
  onProgress,
}) {
  if (!photoPaths || !photoPaths.length) {
    throw new Error('사진이 최소 1장 필요합니다.');
  }

  const { selectComposition, renderMedia } = require('@remotion/renderer');

  const serveUrl = await getBundle();
  const photos = [];
  for (const file of photoPaths) {
    photos.push(await toDataUri(file));
  }

  const inputProps = {
    photos,
    script,
    storeName,
    address: address || '',
    music: pickMusic(mood),
  };

  const composition = await selectComposition({
    serveUrl,
    id: 'KineticReel',
    inputProps,
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fileName = `reels-kinetic-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    outputLocation: outputPath,
    inputProps,
    imageFormat: 'jpeg',
    jpegQuality: 88,
    scale,
    // 메모리가 적은 환경에서 동시에 여러 크롬 탭을 띄우면 죽는다.
    concurrency: Math.max(1, Math.min(2, os.cpus().length - 1)),
    onProgress: onProgress || (() => {}),
  });

  return {
    outputPath,
    fileName,
    durationInFrames: composition.durationInFrames,
  };
}

module.exports = { renderKineticReel, pickMusic, ensurePublicDir };
