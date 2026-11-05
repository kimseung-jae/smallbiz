const fs = require('fs');
const path = require('path');
const { callAI, hasAIKey } = require('./aiClient');

const FORMATS_DIR = path.join(__dirname, '..', 'templates', 'reels');

function loadFormats() {
  return fs
    .readdirSync(FORMATS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FORMATS_DIR, f), 'utf8')));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// 사진 장수에 맞춰 포맷의 각 photo-cuts 구간이 실제로 몇 컷이 될지 정한다 — 사진이 구간의
// 최소 컷 수보다 적으면 최소치까지 반복해서 채우고(selectPhotosForSegment), 최대 컷 수보다
// 많으면 그중 최대치만 골라 쓴다.
function resolveCutCounts(format, photoCount) {
  const counts = {};
  for (const seg of format.segments) {
    if (seg.type === 'photo-cuts') counts[seg.id] = clamp(photoCount, seg.cutCount.min, seg.cutCount.max);
  }
  return counts;
}

function truncate(text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
}

function fallbackHook(storeName, category) {
  return category ? `${category} 가볼까` : `${storeName || '여기'} 가볼까`;
}

// AI 키가 없거나 호출이 실패해도 항상 뭔가는 만들어지도록 하는 결정론적 폴백 — 기본적으로
// 범용 포맷(hook-list)을 쓰고, 문구는 가게명/업종으로 간단한 템플릿 문장을 채운다.
function fallbackResult(formats, photoCount, { storeName, category }, formatId = 'hook-list') {
  const format = formats.find((f) => f.id === formatId) || formats.find((f) => f.id === 'hook-list') || formats[0];
  const cutCounts = resolveCutCounts(format, photoCount);
  const captions = {};
  for (const seg of format.segments) {
    if (seg.type === 'hook') {
      captions[seg.id] = truncate(fallbackHook(storeName, category), seg.caption.maxChars);
    } else if (seg.type === 'photo-cuts') {
      const n = cutCounts[seg.id];
      captions[seg.id] = Array.from({ length: n }, (_, i) => truncate(`포인트 ${i + 1}`, seg.caption.maxChars));
    }
  }
  return { formatId: format.id, format, cutCounts, captions };
}

// 가게 정보를 보고 3개 포맷 중 하나를 고르고, 그 포맷의 구간별 문구(훅/컷 캡션)만 JSON으로
// 채워 받는다. 사진 수에 따라 구간별 실제 컷 수가 달라지므로, 프롬프트에도 그 수를 정확히
// 알려주고 AI가 그 개수만큼만 문구를 채우게 한다.
async function pickFormatAndCaptions({ storeName, category, features, photoCount }) {
  const formats = loadFormats();

  if (!hasAIKey()) {
    return fallbackResult(formats, photoCount, { storeName, category });
  }

  const formatsForPrompt = formats.map((f) => {
    const cutCounts = resolveCutCounts(f, photoCount);
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      segments: f.segments
        .filter((s) => s.type !== 'endcard')
        .map((s) => ({
          id: s.id,
          maxChars: s.caption.maxChars,
          count: s.type === 'photo-cuts' ? cutCounts[s.id] : 1,
          label: s.caption.label || undefined,
        })),
    };
  });

  const prompt = `당신은 대기업 광고 캠페인을 다뤄온 15년 차 카피라이터입니다. 지금은 동네 소상공인 사장님의 홍보 릴스(짧은 세로 영상) 자막을 써주고 있습니다.
가게명: ${storeName || ''}
업종/특징: ${category || ''} ${features || ''}

아래 3개의 릴스 포맷 중 이 가게에 가장 잘 어울리는 것을 하나 고르고, 그 포맷의 각 구간에 들어갈 문구를 채워주세요.

${JSON.stringify(formatsForPrompt, null, 2)}

규칙:
- "hook" 구간 문구는 count가 1이며, 지정된 maxChars 이내로 시선을 사로잡는 한 줄 후킹 카피로 작성하세요.
- 그 외 구간(사진 컷) 문구는 지정된 count 개수만큼 배열로, 각각 지정된 maxChars 이내로 작성하세요. label이 "BEFORE"/"AFTER"인 구간은 그 의미에 맞는 톤으로 작성하세요.
- 영상 마지막에는 가게명·주소와 "지금 바로 방문해보세요" 문구가 담긴 엔딩 카드가 자동으로 따로 붙으니, 여기 문구에는 "방문하세요/오세요" 같은 직접적인 CTA를 넣지 마세요.
- 진부한 표현("정성을 다해", "고객님을 위해") 대신 구체적이고 생생한 표현을 쓰세요.

반드시 아래 JSON 형식으로만 응답하세요(키는 각 구간의 id). 다른 설명은 붙이지 마세요.
{"formatId": "hook-list", "captions": {"hook": "...", "cuts": ["...", "..."]}}`;

  try {
    const text = await callAI(prompt, 800);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답을 파싱하지 못했습니다.');
    const parsed = JSON.parse(jsonMatch[0]);

    const format = formats.find((f) => f.id === parsed.formatId) || formats[0];
    const cutCounts = resolveCutCounts(format, photoCount);
    const captions = {};
    for (const seg of format.segments) {
      if (seg.type === 'hook') {
        const filled = truncate(parsed.captions?.[seg.id], seg.caption.maxChars);
        captions[seg.id] = filled || truncate(fallbackHook(storeName, category), seg.caption.maxChars);
      } else if (seg.type === 'photo-cuts') {
        const n = cutCounts[seg.id];
        const raw = Array.isArray(parsed.captions?.[seg.id]) ? parsed.captions[seg.id] : [];
        captions[seg.id] = Array.from({ length: n }, (_, i) => truncate(raw[i], seg.caption.maxChars) || `포인트 ${i + 1}`);
      }
    }
    return { formatId: format.id, format, cutCounts, captions };
  } catch (err) {
    console.error('reels pickFormatAndCaptions error, falling back:', err.message);
    return fallbackResult(formats, photoCount, { storeName, category });
  }
}

// AI를 거치지 않고 특정 포맷을 강제로 지정해 결과를 만든다 — 세 포맷 모두를 같은 사진으로
// 비교 확인할 때(테스트 스크립트) 쓴다.
function forceFormatResult(formatId, photoCount, { storeName, category } = {}) {
  const formats = loadFormats();
  return fallbackResult(formats, photoCount, { storeName, category }, formatId);
}

module.exports = { loadFormats, resolveCutCounts, pickFormatAndCaptions, forceFormatResult };
