const COMBINING_MARKS = /\p{M}+/gu;
const SPACING = /[\s\-_]+/g;
const TONE_NUMBER = /([a-z])(?:[1-9])(?=$|[\s\-_])/g;
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
    .replace(TONE_NUMBER, "$1")
    .replace(/[’'·.]/g, "")
    .replace(SPACING, " ")
    .trim();
}

function dictionaryCollections(input, explicitCommonEntries = []) {
  if (Array.isArray(input)) {
    return {
      terms: input,
      commonEntries: Array.isArray(explicitCommonEntries) ? explicitCommonEntries : [],
    };
  }
  return {
    terms: Array.isArray(input?.terms) ? input.terms : [],
    commonEntries: Array.isArray(input?.common_entries) ? input.common_entries : [],
  };
}

function commonRomanizations(value = "") {
  return String(value)
    .split("/")
    .map(normalizeRomanization)
    .filter(Boolean);
}

function comparisonIndexItem(term) {
    const comparisons = Array.isArray(term.comparisons) ? term.comparisons : [];
    const indexedComparisons = comparisons.map((comparison, index) => ({
      index,
      comparison,
      accent: normalizeText(comparison.accent),
      hanji: normalizeText(comparison.hanji),
      romanization: normalizeRomanization(comparison.romanization),
    }));
    return {
      term,
      common: null,
      display: term.mandarin,
      mandarin: normalizeText(term.mandarin),
      comparisons: indexedComparisons,
      hanji: indexedComparisons.map((item) => item.hanji),
      romanization: indexedComparisons.map((item) => item.romanization),
      accents: indexedComparisons.map((item) => item.accent),
    };
}

export function createSearchIndex(input = [], explicitCommonEntries = []) {
  const { terms, commonEntries } = dictionaryCollections(input, explicitCommonEntries);
  const index = terms.map(comparisonIndexItem);
  const comparisonByMandarin = new Map();
  for (const item of index) {
    if (!comparisonByMandarin.has(item.mandarin)) comparisonByMandarin.set(item.mandarin, item);
  }

  for (const common of commonEntries) {
    if (!common || typeof common !== "object") continue;
    const hanji = normalizeText(common.hanji);
    const romanizations = commonRomanizations(common.romanization);
    if (!hanji || romanizations.length === 0) continue;

    const existing = comparisonByMandarin.get(hanji);
    if (existing && !existing.common) {
      existing.common = common;
      existing.commonHanji = hanji;
      existing.commonRomanizations = romanizations;
      continue;
    }

    index.push({
      term: null,
      common,
      display: common.hanji,
      mandarin: hanji,
      commonHanji: hanji,
      commonRomanizations: romanizations,
      comparisons: [],
      hanji: [],
      romanization: [],
      accents: [],
    });
  }

  return index;
}

function fieldScore(field, query, scores) {
  if (!field || !query) return 0;
  if (field === query) return scores.exact;
  if (field.startsWith(query)) return scores.prefix;
  if (field.includes(query)) return scores.contains;
  return 0;
}

export function searchTermsDetailed(index, query, options = {}) {
  const textQuery = normalizeText(query);
  const romanQuery = normalizeRomanization(query);
  const accent = normalizeText(options.accent || "");
  const limit = Number.isInteger(options.limit) ? options.limit : 40;

  if (!textQuery) return { results: [], total: 0, truncated: false };

  const matches = [];
  for (const item of index) {
    if (accent && !item.accents.includes(accent)) continue;

    const mandarinScore = fieldScore(item.mandarin, textQuery, {
      exact: 1200,
      prefix: 900,
      contains: 650,
    });
    const commonHanjiScore = accent
      ? 0
      : fieldScore(item.commonHanji, textQuery, {
          exact: 1150,
          prefix: 850,
          contains: 625,
        });
    const commonRomanizationScore = accent
      ? 0
      : Math.max(
          0,
          ...(item.commonRomanizations || []).map((romanization) =>
            fieldScore(romanization, romanQuery, {
              exact: 1050,
              prefix: 780,
              contains: 560,
            }),
          ),
        );
    const commonScore = Math.max(commonHanjiScore, commonRomanizationScore);
    let score = Math.max(mandarinScore, commonScore);
    const comparisonMatches = [];

    for (const comparison of item.comparisons) {
      if (accent && comparison.accent !== accent) continue;

      const hanjiScore = fieldScore(comparison.hanji, textQuery, {
        exact: 1100,
        prefix: 820,
        contains: 600,
      });
      const romanizationScore = fieldScore(comparison.romanization, romanQuery, {
        exact: 1050,
        prefix: 780,
        contains: 560,
      });
      const comparisonScore = Math.max(hanjiScore, romanizationScore);

      if (comparisonScore > 0) {
        comparisonMatches.push({
          index: comparison.index,
          comparison: comparison.comparison,
          fields: [
            ...(hanjiScore > 0 ? ["hanji"] : []),
            ...(romanizationScore > 0 ? ["romanization"] : []),
          ],
          score: comparisonScore,
        });
        score = Math.max(score, comparisonScore);
      }
    }

    if (score > 0) {
      matches.push({
        term: item.term,
        common: item.common,
        display: item.display,
        score,
        match: {
          mandarin: mandarinScore > 0,
          common:
            commonScore > 0
              ? {
                  fields: [
                    ...(commonHanjiScore > 0 ? ["hanji"] : []),
                    ...(commonRomanizationScore > 0 ? ["romanization"] : []),
                  ],
                  score: commonScore,
                }
              : null,
          comparisons: comparisonMatches,
        },
      });
    }
  }

  matches.sort(
    (a, b) => b.score - a.score || a.display.localeCompare(b.display, "zh-Hant-TW"),
  );
  const results = matches.slice(0, limit);
  return {
    results,
    total: matches.length,
    truncated: results.length < matches.length,
  };
}

export function searchTerms(index, query, options = {}) {
  return searchTermsDetailed(index, query, options).results.map(({ term, common }) =>
    term || {
      kind: "common",
      id: `common:${common.id}`,
      mandarin: common.hanji,
      comparisons: [],
      common,
    },
  );
}

export function commonMatchesComparison(common, comparison) {
  return Boolean(
    common &&
      comparison &&
      String(common.id || "") === String(comparison.term_id || "") &&
      common.hanji === comparison.hanji &&
      common.romanization === comparison.romanization,
  );
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
