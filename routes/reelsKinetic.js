const express = require('express');
const { buildReelScript } = require('../lib/reelScript');
const { renderKineticReel } = require('../lib/kineticRenderer');
const { getSampleFiles } = require('./sampleMedia');

// kinetic 스타일 릴스. 기존 /api/reels 와 별개로 동작하므로 이 경로가 실패해도
// 지금 쓰고 있는 릴스 생성은 영향을 받지 않는다.
//
// 주의: Remotion 렌더는 내부에서 헤드리스 크롬을 띄운다. 웹 서버와 같은 프로세스에서
// 돌리면 메모리가 적은 환경(Render 무료 플랜 512MB)에서 서버 전체가 함께 죽을 수 있다.
// docs/reel-style-kinetic.md 에 적은 대로, 작업 큐와 워커로 분리한 뒤에 쓰는 것이 맞다.
module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.array('photos', 6), async (req, res) => {
    const { storeName, intro, address, mood, scale } = req.body;

    const uploaded = (req.files || []).map((f) => f.path);
    const photoPaths = uploaded.length ? uploaded : getSampleFiles(3).map((f) => f.path);

    if (!photoPaths.length) {
      return res.status(400).json({ error: '사진을 1장 이상 올려주세요.' });
    }
    if (!storeName) {
      return res.status(400).json({ error: '매장명을 입력해주세요.' });
    }

    try {
      const script = await buildReelScript({
        storeName,
        intro: intro || '',
        address,
        photoCount: photoPaths.length,
      });

      const result = await renderKineticReel({
        photoPaths,
        script,
        storeName,
        address,
        mood,
        scale: scale ? Number(scale) : 1,
      });

      res.json({
        url: `/output/${result.fileName}`,
        style: 'kinetic',
        durationInFrames: result.durationInFrames,
        script,
      });
    } catch (err) {
      console.error('reels-kinetic error:', err.message);
      res.status(500).json({ error: '릴스 생성 중 오류가 발생했습니다.', detail: err.message });
    }
  });

  return router;
};
