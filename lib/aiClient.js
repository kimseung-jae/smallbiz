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

// 이미지 생성 모델은 수십 초씩 걸릴 때가 있어 응답이 없으면 무한정 기다리게 된다 —
// 사진 여러 장을 병렬로 돌릴 때 한 장이 느려지면 전체 요청이 같이 늘어지는 걸 막기 위한 상한선.
const IMAGE_AI_TIMEOUT_MS = 45000;

// 사진 한 장을 주어진 프롬프트대로 AI가 다시 그려준다(이미지→이미지, OpenRouter 경유).
// OpenRouter의 이미지 생성 모델(예: google/gemini-2.5-flash-image)만 지원 — 텍스트 전용 모델로는 불가능.
// 실패하면 예외를 던진다 — 호출부가 컷별로 성공/실패를 구분해야 하는 경우(Promise.allSettled 등)를 위해서다.
async function restyleImageWithPrompt(imageBuffer, mimeType, prompt) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY가 설정되지 않았습니다.');

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
// 한 번에 판별한다. OpenRouter 비전 모델 1회 호출로 후보 전체를 같이 심사해서 비용을 아낀다.
// 키가 없거나 호출이 실패하면 null을 반환해서 호출부가 기존 텍스트 기반 필터로 대체하게 한다.
async function classifyRelevantImages(images, { storeName, category }) {
  if (!process.env.OPENROUTER_API_KEY || !images.length) return null;

  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
  const content = [
    {
      type: 'text',
      text: `당신은 소상공인 홍보용으로 쓸 사진을 고르는 검수자입니다.
가게명: ${storeName}
업종: ${category || '알 수 없음'}

아래는 번호가 매겨진 이미지 후보들입니다. 이 중 실제로 이 가게의 음식/메뉴/매장 내외부(간판, 실내, 테이블, 요리)로
쓸 수 있는 사진의 번호만 골라주세요. 뉴스 캡처, 지도 화면, 로고/아이콘, 스크린샷, 전혀 무관한 인물사진,
다른 업종 사진은 전부 제외하세요. 애매하면 제외하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{"keepIndexes": [0, 2, 5]}`,
    },
  ];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `이미지 ${i}:` });
    content.push({ type: 'image_url', image_url: { url: img.thumbnailUrl } });
  });

  try {
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
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.keepIndexes)) return null;
    return parsed.keepIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < images.length);
  } catch (err) {
    console.error('classifyRelevantImages error:', err.message);
    return null;
  }
}

module.exports = {
  callAI,
  hasAIKey,
  hasImageAIKey,
  restyleImageAsAnimation,
  restyleImageWithPrompt,
  classifyRelevantImages,
};
