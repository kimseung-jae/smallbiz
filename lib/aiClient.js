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

// 구글 Gemini 직접 호출 — OpenRouter 없이도, 또는 OpenRouter 키가 문제가 생겨도 GEMINI_API_KEY만
// 있으면 바로 쓸 수 있게 하는 독립 경로다. OpenRouter와 달리 이 프로젝트가 가진 또 다른 키라서,
// 한쪽이 막혀도 전체 AI 기능이 같이 죽지 않도록 callAI/restyleImageWithPrompt에서 대체 수단으로 쓴다.
async function callGemini(prompt, maxTokens) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API 오류 (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

function hasAIKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
}

function hasImageAIKey() {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
}

// 텍스트 생성: OpenRouter -> Gemini -> Anthropic 순서로 시도한다. 키가 설정돼 있다는 것과 그
// 키가 실제로 유효하다는 것은 다른 얘기라서(인증 오류, 만료, 크레딧 소진 등), "설정돼 있으니 그걸로
// 끝"이 아니라 실패하면 다음 수단으로 자동으로 넘어가게 한다 — 어느 한 키가 말썽이어도 나머지
// 키가 살아있으면 AI 기능 전체가 죽지 않는다.
async function callAI(prompt, maxTokens = 1500) {
  const attempts = [];
  if (process.env.OPENROUTER_API_KEY) attempts.push(['OpenRouter', () => callOpenRouter(prompt, maxTokens)]);
  if (process.env.GEMINI_API_KEY) attempts.push(['Gemini', () => callGemini(prompt, maxTokens)]);
  if (process.env.ANTHROPIC_API_KEY) attempts.push(['Anthropic', () => callAnthropic(prompt, maxTokens)]);

  if (!attempts.length) throw new Error('설정된 AI 키가 없습니다.');

  let lastErr;
  for (const [name, fn] of attempts) {
    try {
      return await fn();
    } catch (err) {
      console.error(`callAI: ${name} 실패, 다음 수단으로 전환:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// 이미지 생성 모델은 수십 초씩 걸릴 때가 있어 응답이 없으면 무한정 기다리게 된다 —
// 사진 여러 장을 병렬로 돌릴 때 한 장이 느려지면 전체 요청이 같이 늘어지는 걸 막기 위한 상한선.
const IMAGE_AI_TIMEOUT_MS = 45000;

// OpenRouter 경유 이미지 재생성(이미지→이미지).
async function restyleImageWithOpenRouter(imageBuffer, mimeType, prompt) {
  const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(IMAGE_AI_TIMEOUT_MS),
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
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      }],
      modalities: ['image', 'text'],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter 이미지 생성 오류 (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const resultDataUri = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!resultDataUri) throw new Error('OpenRouter가 이미지를 반환하지 않았습니다.');
  const base64 = resultDataUri.split(',')[1];
  if (!base64) throw new Error('OpenRouter 응답에서 이미지 데이터를 읽지 못했습니다.');
  return Buffer.from(base64, 'base64');
}

// 구글 Gemini 직접 호출로 이미지 재생성 — OpenRouter가 안 될 때 쓰는 대체 경로.
async function restyleImageWithGemini(imageBuffer, mimeType, prompt) {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(IMAGE_AI_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } },
          ],
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini 이미지 생성 오류 (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData || p.inline_data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) throw new Error('Gemini가 이미지를 반환하지 않았습니다.');
  return Buffer.from(inline.data, 'base64');
}

// 사진 한 장을 주어진 프롬프트대로 AI가 다시 그려준다(이미지→이미지) — OpenRouter를 먼저 시도하고,
// 실패하면(인증 오류, 크레딧 소진 등) GEMINI_API_KEY가 있으면 그쪽으로 자동 전환한다. 텍스트와
// 마찬가지로 "키가 설정됨"과 "키가 지금 동작함"은 다르기 때문이다.
// 실패하면 예외를 던진다 — 호출부가 컷별로 성공/실패를 구분해야 하는 경우(Promise.allSettled 등)를 위해서다.
async function restyleImageWithPrompt(imageBuffer, mimeType, prompt) {
  const attempts = [];
  if (process.env.OPENROUTER_API_KEY) attempts.push(['OpenRouter', () => restyleImageWithOpenRouter(imageBuffer, mimeType, prompt)]);
  if (process.env.GEMINI_API_KEY) attempts.push(['Gemini', () => restyleImageWithGemini(imageBuffer, mimeType, prompt)]);

  if (!attempts.length) throw new Error('이미지 생성 가능한 AI 키(OPENROUTER_API_KEY 또는 GEMINI_API_KEY)가 설정되지 않았습니다.');

  let lastErr;
  for (const [name, fn] of attempts) {
    try {
      return await fn();
    } catch (err) {
      console.error(`restyleImageWithPrompt: ${name} 실패, 다음 수단으로 전환:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// 업로드한 사진 한 장을 AI로 애니메이션/일러스트 느낌으로 다시 그려준다(릴스용 고정 프롬프트).
// 실패하면 null을 반환해서 호출부가 원본 사진으로 자연스럽게 대체하도록 한다.
async function restyleImageAsAnimation(imageBuffer, mimeType) {
  try {
    return await restyleImageWithPrompt(
      imageBuffer,
      mimeType,
      '이 사진을 따뜻하고 귀여운 2D 애니메이션/일러스트 스타일로 다시 그려줘. 구도와 피사체(음식, 매장, 사람 등)는 사진과 최대한 똑같이 유지하고, 부드러운 색감과 손그림 느낌만 더해줘. 텍스트나 워터마크는 넣지 마.',
    );
  } catch (err) {
    console.error('restyleImageAsAnimation error:', err.message);
    return null;
  }
}

// 다음/네이버/구글 이미지 검색 결과에는 제목만으로 걸러지지 않는 무관한 사진(뉴스 캡처, 지도,
// 로고, 전혀 다른 업종 사진 등)이 자주 섞인다 — 실제로 사진을 "보고" 이 가게와 관련 있는지
// 한 번에 판별한다. 비전 모델 1회 호출로 후보 전체를 같이 심사해서 비용을 아낀다.
// 키가 없거나 호출이 실패하면 null을 반환해서 호출부가 기존 텍스트 기반 필터로 대체하게 한다.
async function classifyRelevantImages(images, { storeName, category }) {
  if ((!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) || !images.length) return null;

  const promptText = `당신은 소상공인 홍보용으로 쓸 사진을 고르는 검수자입니다.
가게명: ${storeName}
업종: ${category || '알 수 없음'}

아래는 번호가 매겨진 이미지 후보들입니다. 이 중 실제로 이 가게의 음식/메뉴/매장 내외부(간판, 실내, 테이블, 요리)로
쓸 수 있는 사진의 번호만 골라주세요. 뉴스 캡처, 지도 화면, 로고/아이콘, 스크린샷, 전혀 무관한 인물사진,
다른 업종 사진은 전부 제외하세요. 애매하면 제외하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{"keepIndexes": [0, 2, 5]}`;

  async function viaOpenRouter() {
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
    const content = [{ type: 'text', text: promptText }];
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `이미지 ${i}:` });
      content.push({ type: 'image_url', image_url: { url: img.thumbnailUrl } });
    });
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hanul-platform.onrender.com',
        'X-Title': 'Sosanggongin-Ttalkkak',
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 500 }),
    });
    if (!response.ok) throw new Error(`OpenRouter API 오류 (${response.status})`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async function viaGemini() {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const imageParts = await Promise.all(images.map(async (img) => {
      const res = await fetch(img.thumbnailUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get('content-type') || 'image/jpeg';
      return { inline_data: { mime_type: mimeType, data: buf.toString('base64') } };
    }));
    const parts = [{ text: promptText }];
    images.forEach((_, i) => {
      parts.push({ text: `이미지 ${i}:` });
      parts.push(imageParts[i]);
    });
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 500 } }),
      },
    );
    if (!response.ok) throw new Error(`Gemini API 오류 (${response.status})`);
    const data = await response.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }

  const attempts = [];
  if (process.env.OPENROUTER_API_KEY) attempts.push(['OpenRouter', viaOpenRouter]);
  if (process.env.GEMINI_API_KEY) attempts.push(['Gemini', viaGemini]);

  for (const [name, fn] of attempts) {
    try {
      const text = await fn();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.keepIndexes)) continue;
      return parsed.keepIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < images.length);
    } catch (err) {
      console.error(`classifyRelevantImages: ${name} 실패:`, err.message);
    }
  }
  return null;
}

module.exports = {
  callAI,
  hasAIKey,
  hasImageAIKey,
  restyleImageAsAnimation,
  restyleImageWithPrompt,
  classifyRelevantImages,
};
