async function callAnthropic(prompt, maxTokens) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

// OpenRouter는 하나의 키로 여러 모델(Claude 포함)을 OpenAI 호환 형식으로 호출하게 해주는 프록시 서비스
async function callOpenRouter(prompt, maxTokens) {
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
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
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 오류 (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function hasAIKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
}

function hasImageAIKey() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

// OPENROUTER_API_KEY가 있으면 그쪽을 우선 사용하고, 없으면 ANTHROPIC_API_KEY로 직접 호출
async function callAI(prompt, maxTokens = 1500) {
  if (process.env.OPENROUTER_API_KEY) return callOpenRouter(prompt, maxTokens);
  return callAnthropic(prompt, maxTokens);
}

// 업로드한 사진 한 장을 AI로 애니메이션/일러스트 느낌으로 다시 그려준다(이미지→이미지).
// OpenRouter의 이미지 생성 모델(예: google/gemini-2.5-flash-image)만 지원 — 텍스트 전용 모델로는 불가능.
// 실패하면 null을 반환해서 호출부가 원본 사진으로 자연스럽게 대체하도록 한다.
async function restyleImageAsAnimation(imageBuffer, mimeType) {
  if (!process.env.OPENROUTER_API_KEY) return null;

  const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

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
            {
              type: 'text',
              text: '이 사진을 따뜻하고 귀여운 2D 애니메이션/일러스트 스타일로 다시 그려줘. 구도와 피사체(음식, 매장, 사람 등)는 사진과 최대한 똑같이 유지하고, 부드러운 색감과 손그림 느낌만 더해줘. 텍스트나 워터마크는 넣지 마.',
            },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        }],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const resultDataUri = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!resultDataUri) return null;
    const base64 = resultDataUri.split(',')[1];
    return base64 ? Buffer.from(base64, 'base64') : null;
  } catch (err) {
    console.error('restyleImageAsAnimation error:', err.message);
    return null;
  }
}

module.exports = { callAI, hasAIKey, hasImageAIKey, restyleImageAsAnimation };
