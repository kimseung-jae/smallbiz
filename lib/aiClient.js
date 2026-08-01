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

// OPENROUTER_API_KEY가 있으면 그쪽을 우선 사용하고, 없으면 ANTHROPIC_API_KEY로 직접 호출
async function callAI(prompt, maxTokens = 1500) {
  if (process.env.OPENROUTER_API_KEY) return callOpenRouter(prompt, maxTokens);
  return callAnthropic(prompt, maxTokens);
}

module.exports = { callAI, hasAIKey };
