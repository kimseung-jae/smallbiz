#!/usr/bin/env node
// kinetic 스타일 릴스를 로컬에서 만들어 보는 스크립트.
// 서버를 띄우지 않고 결과물만 빠르게 확인할 때 쓴다.
//
//   node scripts/render-kinetic.js \
//     --photos sample/1.jpg,sample/2.jpg \
//     --store "안마을돼지불백" \
//     --intro "20년 전통 숯불향 돼지불백, 밑반찬 무한 리필" \
//     --mood calm

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { buildReelScript } = require('../lib/reelScript');
const { renderKineticReel } = require('../lib/kineticRenderer');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.photos) {
    console.error('--photos 에 사진 경로를 쉼표로 구분해 넘겨주세요.');
    process.exit(1);
  }

  const photoPaths = args.photos.split(',').map((p) => path.resolve(p.trim()));
  for (const p of photoPaths) {
    if (!fs.existsSync(p)) {
      console.error(`사진을 찾을 수 없습니다: ${p}`);
      process.exit(1);
    }
  }

  const storeName = args.store || '우리 가게';
  const intro = args.intro || '';

  console.log('대본을 만드는 중...');
  const script = args.hook
    ? {
        hook: args.hook,
        highlight: args.highlight || '',
        lines: (args.lines || '').split('|').filter(Boolean),
        closing: storeName,
      }
    : await buildReelScript({
        storeName,
        intro,
        address: args.address,
        photoCount: photoPaths.length,
      });

  console.log(JSON.stringify(script, null, 2));
  console.log('\n렌더링 시작...');

  const started = Date.now();
  let lastPercent = -1;

  const result = await renderKineticReel({
    photoPaths,
    script,
    storeName,
    address: args.address,
    mood: args.mood,
    scale: args.scale ? Number(args.scale) : 1,
    onProgress: ({ progress }) => {
      const percent = Math.round(progress * 100);
      if (percent !== lastPercent && percent % 10 === 0) {
        lastPercent = percent;
        process.stdout.write(`  ${percent}%\n`);
      }
    },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n완성: ${result.outputPath}`);
  console.log(`${result.durationInFrames} 프레임 / 렌더 ${seconds}초`);
}

main().catch((err) => {
  console.error('렌더 실패:', err.message);
  process.exit(1);
});
