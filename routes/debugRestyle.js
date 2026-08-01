const express = require('express');
const fs = require('fs');

// 임시 디버그용 — restyleImageAsAnimation이 라이브 서버에서 왜 실패하는지 원인 파악용.
module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'photo required' });

    const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
    const dataUri = `data:${req.file.mimetype};base64,${fs.readFileSync(req.file.path).toString('base64')}`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hanul-platform.onrender.com',
          'X-Title': 'Sosanggongin-Ttalkkak',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Restyle this photo as a warm 2D animation illustration, keep composition.' },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          }],
          modalities: ['image', 'text'],
        }),
      });

      const status = response.status;
      const text = await response.text();
      fs.rm(req.file.path, { force: true }, () => {});
      res.json({ hasKey: !!process.env.OPENROUTER_API_KEY, model, status, bodyPreview: text.slice(0, 500) });
    } catch (e) {
      res.json({ hasKey: !!process.env.OPENROUTER_API_KEY, model, error: e.message, stack: e.stack });
    }
  });

  return router;
};
