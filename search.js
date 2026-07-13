const COMBINING_MARKS = /\p{M}+/gu;
const SPACING = /[\s\-_]+/g;
const FRIENDLY_SUGGESTIONS = new Set([
  "醫院",
  "護士",
  "學校",
  "老師",
  "飛機",
  "廁所",
  "市場",
  "麵粉",
  "豆腐",
  "西瓜",
  "香蕉",
  "柳丁",
  "芒果",
  "蘋果",
  "蚊子",
  "蝴蝶",
  "青蛙",
  "小鴨",
  "鴿子",
  "祖父",
  "祖母",
  "男孩子",
  "女孩子",
  "溫度計",
  "麥芽糖",
  "火爐",
  "米苔目",
  "眼睛",
  "鼻子",
  "帽子",
  "桌子",
  "湯匙",
  "茶杯",
  "水果",
  "饅頭",
  "麵包",
  "茶葉",
  "汽車",
  "腳踏車",
  "車站",
  "醫生",
  "下雨",
  "秋天",
  "冬天",
  "早上",
  "中午",
  "晚上",
]);

export function normalizeText(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase("zh-Hant-TW").trim();
}

export function normalizeRomanization(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[’'·.]/g, "")
    .replace(SPACING, " ")
    .trim();
}

export function createSearchIndex(terms = []) {
  return terms.map((term) => {
    const comparisons = Array.isArray(term.comparisons) ? term.comparisons : [];
    return {
      term,
      mandarin: normalizeText(term.mandarin),
      hanji: comparisons.map((item) => normalizeText(item.hanji)),
      romanization: comparisons.map((item) => normalizeRomanization(item.romanization)),
      accents: comparisons.map((item) => normalizeText(item.accent)),
    };
  });
}

function fieldScore(field, query, scores) {
  if (!field || !query) return 0;
  if (field === query) return scores.exact;
  if (field.startsWith(query)) return scores.prefix;
  if (field.includes(query)) return scores.contains;
  return 0;
}

export function searchTerms(index, query, options = {}) {
  const textQuery = normalizeText(query);
  const romanQuery = normalizeRomanization(query);
  const accent = normalizeText(options.accent || "");
  const limit = Number.isInteger(options.limit) ? options.limit : 40;

  if (!textQuery) return [];

  const matches = [];
  for (const item of index) {
    if (accent && !item.accents.includes(accent)) continue;

    let score = fieldScore(item.mandarin, textQuery, {
      exact: 1200,
      prefix: 900,
      contains: 650,
    });

    for (const hanji of item.hanji) {
      score = Math.max(
        score,
        fieldScore(hanji, textQuery, { exact: 1100, prefix: 820, contains: 600 }),
      );
    }

    for (const romanization of item.romanization) {
      score = Math.max(
        score,
        fieldScore(romanization, romanQuery, { exact: 1050, prefix: 780, contains: 560 }),
      );
    }

    for (const itemAccent of item.accents) {
      score = Math.max(
        score,
        fieldScore(itemAccent, textQuery, { exact: 300, prefix: 220, contains: 150 }),
      );
    }

    if (score > 0) matches.push({ term: item.term, score });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.term.mandarin.localeCompare(b.term.mandarin, "zh-Hant-TW"))
    .slice(0, limit)
    .map(({ term }) => term);
}

export function groupComparisons(comparisons = [], accent = "") {
  const selectedAccent = normalizeText(accent);
  const groups = new Map();

  for (const comparison of comparisons) {
    if (selectedAccent && normalizeText(comparison.accent) !== selectedAccent) continue;
    const key = [comparison.hanji, comparison.romanization, comparison.audio || ""].join("\u0000");
    const existing = groups.get(key);
    if (existing) {
      if (!existing.accents.includes(comparison.accent)) existing.accents.push(comparison.accent);
      continue;
    }
    groups.set(key, { ...comparison, accents: [comparison.accent] });
  }

  return [...groups.values()];
}

export function pickSuggestionTerms(terms = [], count = 4, random = Math.random) {
  const candidates = terms.filter((term) => {
    const word = normalizeText(term.mandarin);
    const hasOfficialAudio = (term.comparisons || []).some((comparison) => Boolean(comparison.audio));
    return /^[\p{Script=Han}]{2,5}$/u.test(word) && hasOfficialAudio;
  });
  const friendlyCandidates = candidates.filter((term) => FRIENDLY_SUGGESTIONS.has(term.mandarin));
  const pool = friendlyCandidates.length ? friendlyCandidates : candidates;
  const wanted = Math.max(0, Math.min(Number.isInteger(count) ? count : 4, pool.length));

  for (let index = 0; index < wanted; index += 1) {
    const value = Number(random());
    const normalizedRandom = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
    const pickedIndex = index + Math.floor(normalizedRandom * (pool.length - index));
    [pool[index], pool[pickedIndex]] = [pool[pickedIndex], pool[index]];
  }

  return pool.slice(0, wanted);
}
