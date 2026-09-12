const { callAI, hasAIKey } = require('./aiClient');

// kinetic 스타일이 요구하는 대본 형식:
//   { hook, highlight, lines[], closing }
// hook 은 훅 구간에 크게 뜨는 한 줄, lines 는 사진마다 한 줄씩 붙는 자막이다.

const HOOK_MAX = 12;
const LINE_MAX = 16;

function clean(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

// 한 줄 소개를 쉼표·중점 기준으로 잘라 자막 후보를 만든다.
function splitIntro(intro) {
  return clean(intro)
    .split(/[,·/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 글자 수로 무작정 자르면 "숯불로만 굽습니다" 가 "숯불로만 굽습" 이 된다.
// 어절 경계까지만 살리고, 첫 어절부터 한도를 넘을 때만 글자 단위로 자른다.
function trimTo(str, max) {
  const s = clean(str);
  if (s.length <= max) return s;

  const words = s.split(' ');
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }

  return out || s.slice(0, max).trim();
}

// 강조할 어절을 고른다. 모델이 hook 에 없는 단어를 주는 경우가 있어서 그대로 믿지 않는다.
// 쓸 수 없으면 마지막 어절을 강조한다 — 노란 강조가 아예 없으면 이 스타일의 특징이 사라진다.
function pickHighlight(hook, candidate) {
  const words = clean(hook).split(' ').filter(Boolean);
  if (words.length < 2) return '';

  const wanted = clean(candidate);
  if (wanted && words.some((w) => w.includes(wanted))) return wanted;

  return words[words.length - 1];
}

// AI 키가 없을 때 쓰는 규칙 기반 대본. 저장소의 다른 AI 기능과 같은 방식이다.
function buildFallbackScript({ storeName, intro, photoCount }) {
  const parts = splitIntro(intro);
  const first = parts[0] || clean(intro) || '오늘도 정성껏 준비했습니다';

  // 훅은 첫 구절에서 가장 앞 두 어절만 쓴다. 길면 훅의 힘이 빠진다.
  const words = first.split(' ').filter(Boolean);
  const hook = trimTo(words.slice(0, 2).join(' ') || first, HOOK_MAX);
  const highlight = words.length > 1 ? words[words.length - 1] : '';

  const pool = parts.length ? parts : [first];
  const lines = [];
  for (let i = 0; i < Math.max(1, photoCount); i++) {
    lines.push(trimTo(pool[i % pool.length], LINE_MAX));
  }

  return {
    hook,
    highlight: pickHighlight(hook, highlight),
    lines,
    closing: clean(storeName) || '우리 가게',
    fallback: true,
  };
}

async function buildReelScript({ storeName, intro, address, photoCount }) {
  const count = Math.max(1, photoCount || 1);

  if (!hasAIKey()) {
    return buildFallbackScript({ storeName, intro, photoCount: count });
  }

  const prompt = `당신은 숏폼 영상 카피를 쓰는 카피라이터입니다. 동네 가게의 인스타그램 릴스에 넣을 자막을 씁니다.

가게명: ${storeName}
${address ? `위치: ${address}\n` : ''}한 줄 소개: ${intro}
사진 장수: ${count}장

릴스는 소리 없이 보는 사람이 많아서 자막이 사실상 내레이션입니다. 아래 조건을 지켜주세요.

- hook: 영상 첫 2초에 크게 뜨는 한 줄. ${HOOK_MAX}자 이내. 가게명을 넣지 마세요. 손님이 왜 이 가게에 가야 하는지가 한눈에 들어와야 합니다. "정성을 다해", "고객님을 위해" 같은 진부한 표현은 쓰지 마세요.
- highlight: hook 안에 실제로 들어 있는 어절 하나. 그 어절만 노란색으로 강조됩니다. 강조할 만한 것이 없으면 빈 문자열.
- lines: 사진마다 한 줄씩, 정확히 ${count}개. 각 ${LINE_MAX}자 이내. 메뉴, 조리 방식, 분위기처럼 구체적인 사실을 씁니다. 문장부호로 끝내지 마세요.
- closing: 마지막에 남길 가게 이름. 보통 가게명 그대로.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 붙이지 마세요.
{
  "hook": "...",
  "highlight": "...",
  "lines": ["...", "..."],
  "closing": "..."
}`;

  try {
    const text = await callAI(prompt, 700);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 형식이 아님');

    const parsed = JSON.parse(match[0]);
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter(Boolean) : [];
    if (!parsed.hook || !lines.length) throw new Error('필수 항목 누락');

    // 길이 제한은 모델을 믿지 않고 여기서 한 번 더 자른다.
    const hook = trimTo(parsed.hook, HOOK_MAX);
    const highlight = clean(parsed.highlight);

    return {
      hook,
      highlight: pickHighlight(hook, highlight),
      lines: Array.from({ length: count }, (_, i) => trimTo(lines[i % lines.length], LINE_MAX)),
      closing: clean(parsed.closing) || clean(storeName),
      fallback: false,
    };
  } catch (err) {
    console.error('reel script error:', err.message);
    return buildFallbackScript({ storeName, intro, photoCount: count });
  }
}

module.exports = { buildReelScript, buildFallbackScript };
