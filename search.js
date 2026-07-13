const COMBINING_MARKS = /\p{M}+/gu;
const SPACING = /[\s\-_]+/g;

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
