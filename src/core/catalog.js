// What each model is good at, so «Automático» can pick the CHEAPEST model that still does the task WELL.
// Scores go from 1 to 10 per kind of task. They are initial estimates by model family (public benchmarks
// and experience); `node scripts/router-bench.mjs` measures them on real OpenCrew tasks and the results
// replace these numbers (src/core/catalog-scores.json). Prices come from usage.js (editable per model).
import measured from './catalog-scores.json' with { type: 'json' };

export const SKILLS = ['chat', 'writing', 'research', 'code', 'reasoning', 'vision'];

// [name pattern, scores {chat, writing, research, code, reasoning, vision}, extra]
// extra.longContext: above this many input tokens the provider charges `factor` times more.
const FAMILIES = [
  [/opus/i, { chat: 10, writing: 10, research: 10, code: 10, reasoning: 10, vision: 9 }],
  [/sonnet-5/i, { chat: 9, writing: 9, research: 9, code: 9, reasoning: 9, vision: 9 }],
  [/sonnet/i, { chat: 9, writing: 9, research: 8, code: 9, reasoning: 8, vision: 8 }],
  [/haiku-5/i, { chat: 8, writing: 7, research: 7, code: 7, reasoning: 6, vision: 7 }, { longContext: { tokens: 100_000, factor: 5 } }],
  [/haiku/i, { chat: 7, writing: 6, research: 6, code: 6, reasoning: 5, vision: 6 }],
  [/gemini.*pro/i, { chat: 9, writing: 9, research: 9, code: 9, reasoning: 9, vision: 9 }],
  [/gemini.*(flash-lite|lite)/i, { chat: 7, writing: 6, research: 6, code: 5, reasoning: 5, vision: 6 }],
  [/gemini.*flash/i, { chat: 8, writing: 7, research: 7, code: 7, reasoning: 7, vision: 8 }],
  [/gpt-5.*nano/i, { chat: 6, writing: 5, research: 5, code: 5, reasoning: 5, vision: 5 }],
  [/gpt-5.*mini/i, { chat: 7, writing: 7, research: 7, code: 7, reasoning: 7, vision: 7 }],
  [/gpt-5/i, { chat: 9, writing: 9, research: 9, code: 9, reasoning: 9, vision: 8 }],
  [/gpt-4o-mini/i, { chat: 6, writing: 6, research: 5, code: 5, reasoning: 5, vision: 6 }],
  [/gpt-4o|gpt-4\.1/i, { chat: 8, writing: 8, research: 7, code: 7, reasoning: 7, vision: 8 }],
  [/grok.*(fast|mini)/i, { chat: 7, writing: 6, research: 6, code: 6, reasoning: 6, vision: 5 }],
  [/grok/i, { chat: 8, writing: 8, research: 8, code: 8, reasoning: 8, vision: 6 }],
];
// Unknown models: guess from their size words.
const BY_TIER = {
  small: { chat: 5, writing: 5, research: 4, code: 4, reasoning: 4, vision: 4 },
  mid: { chat: 7, writing: 6, research: 6, code: 6, reasoning: 6, vision: 5 },
  large: { chat: 8, writing: 8, research: 8, code: 8, reasoning: 8, vision: 6 },
};

export function profileOf(model, tier = 'mid') {
  const hit = FAMILIES.find(([re]) => re.test(model));
  const scores = { ...(hit ? hit[1] : BY_TIER[tier]), ...(measured[model] || {}) };
  return { scores, known: !!hit || !!measured[model], ...(hit?.[2] || {}) };
}

// Minimum score a task needs, by kind and difficulty (1 easy · 2 normal · 3 hard). This is the promise
// «never worse for the user»: a cheaper model is only used when it reaches this level.
export const FLOOR = {
  chat: [5, 6, 8],
  writing: [6, 7, 8],
  research: [6, 7, 8],
  code: [6, 7, 9],
  reasoning: [6, 8, 9],
  vision: [6, 7, 8],
};
