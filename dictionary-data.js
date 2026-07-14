const RUNTIME_SCHEMA_VERSION = 1;
const AUDIO_PREFIX = "../assets/audio/";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}格式不正確`);
  return value;
}

function requireIndex(value, length, label) {
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new Error(`${label}索引超出範圍`);
  }
  return value;
}

export function decodeDictionaryCore(payload) {
  if (
    !payload ||
    payload.v !== RUNTIME_SCHEMA_VERSION ||
    typeof payload.r !== "string" ||
    !Array.isArray(payload.n) ||
    payload.n.length !== 4 ||
    typeof payload.m !== "object"
  ) {
    throw new Error("核心詞庫版本不相容");
  }
  const accents = requireArray(payload.a, "腔口表");
  const terms = requireArray(payload.t, "核心詞目").map((row) => {
    if (!Array.isArray(row) || row.length !== 4) throw new Error("核心詞目格式不正確");
    const comparisons = requireArray(row[3], "核心腔口資料").map((comparison) => {
      if (!Array.isArray(comparison) || comparison.length !== 3) {
        throw new Error("核心腔口資料格式不正確");
      }
      return {
        accent: accents[requireIndex(comparison[0], accents.length, "腔口")],
        hanji: String(comparison[1] || ""),
        romanization: String(comparison[2] || ""),
      };
    });
    return {
      kind: row[2] ? "sense" : "comparison",
      id: String(row[0] || ""),
      mandarin: String(row[1] || ""),
      comparisons,
    };
  });
  const commonEntries = requireArray(payload.c, "核心共同詞").map((row) => {
    if (!Array.isArray(row) || row.length !== 3) throw new Error("核心共同詞格式不正確");
    return {
      kind: "common",
      id: String(row[0] || ""),
      hanji: String(row[1] || ""),
      romanization: String(row[2] || ""),
    };
  });
  const comparisonCount = terms.reduce((total, term) => total + term.comparisons.length, 0);
  const expectedCounts = payload.n.map(Number);
  const metadataCounts = [
    Number(payload.m.term_count),
    Number(payload.m.common_entry_count),
    Number(payload.m.comparison_count),
  ];
  if (
    expectedCounts.some((value) => !Number.isInteger(value) || value < 0) ||
    expectedCounts[0] !== terms.length ||
    expectedCounts[1] !== commonEntries.length ||
    expectedCounts[2] !== comparisonCount ||
    metadataCounts.some((value, index) => Number.isFinite(value) && value !== expectedCounts[index])
  ) {
    throw new Error("核心詞庫筆數不完整");
  }
  return {
    dictionary: {
      metadata: payload.m,
      terms,
      common_entries: commonEntries,
    },
    detailsBytes: Math.max(0, Number(payload.d) || 0),
    runtime: { revision: payload.r, counts: expectedCounts },
  };
}

export function applyDictionaryDetails(dictionary, payload, runtime) {
  if (!payload || payload.v !== RUNTIME_SCHEMA_VERSION) {
    throw new Error("完整詞庫版本不相容");
  }
  if (
    !runtime ||
    payload.r !== runtime.revision ||
    !Array.isArray(payload.n) ||
    payload.n.length !== runtime.counts.length ||
    payload.n.some((value, index) => Number(value) !== runtime.counts[index])
  ) {
    throw new Error("核心與完整詞庫版本不一致");
  }
  const terms = requireArray(dictionary?.terms, "詞目");
  const commonEntries = requireArray(dictionary?.common_entries, "共同詞");
  const deferredTerms = requireArray(payload.t, "完整詞目");
  const deferredCommon = requireArray(payload.c, "完整共同詞");
  const seenTerms = new Set();
  const seenCommon = new Set();
  const audioFilenames = new Set();
  let deferredComparisonCount = 0;
  let comparisonAudioCount = 0;
  let commonAudioCount = 0;

  // Validate all references before mutating the live dictionary. A truncated or
  // mismatched details file therefore leaves the already-searchable core intact.
  for (const row of deferredTerms) {
    if (!Array.isArray(row) || row.length !== 2) throw new Error("完整詞目格式不正確");
    const termIndex = requireIndex(row[0], terms.length, "完整詞目");
    if (seenTerms.has(termIndex)) throw new Error("完整詞目重複");
    seenTerms.add(termIndex);
    const term = terms[termIndex];
    const seenComparisons = new Set();
    for (const comparisonRow of requireArray(row[1], "完整腔口資料")) {
      if (!Array.isArray(comparisonRow) || comparisonRow.length !== 3) {
        throw new Error("完整腔口資料格式不正確");
      }
      const comparisonIndex = requireIndex(comparisonRow[0], term.comparisons.length, "完整腔口資料");
      if (seenComparisons.has(comparisonIndex)) throw new Error("完整腔口資料重複");
      seenComparisons.add(comparisonIndex);
      deferredComparisonCount += 1;
      if (comparisonRow[2]) {
        comparisonAudioCount += 1;
        audioFilenames.add(String(comparisonRow[2]));
      }
    }
  }
  for (const row of deferredCommon) {
    if (!Array.isArray(row) || row.length !== 4) throw new Error("完整共同詞格式不正確");
    const commonIndex = requireIndex(row[0], commonEntries.length, "完整共同詞");
    if (seenCommon.has(commonIndex)) throw new Error("完整共同詞重複");
    seenCommon.add(commonIndex);
    if (row[3]) {
      commonAudioCount += 1;
      audioFilenames.add(String(row[3]));
    }
  }
  const audioCoverage = [
    [Number(dictionary.metadata.audio_comparison_count), comparisonAudioCount],
    [Number(dictionary.metadata.common_audio_entry_count), commonAudioCount],
    [Number(dictionary.metadata.audio_file_count), audioFilenames.size],
  ];
  if (
    deferredCommon.length !== runtime.counts[1] ||
    deferredComparisonCount !== runtime.counts[3] ||
    audioCoverage.some(([expected, actual]) => Number.isFinite(expected) && expected !== actual)
  ) {
    throw new Error("完整詞庫筆數不完整");
  }

  for (const [termIndex, comparisonRows] of deferredTerms) {
    for (const [comparisonIndex, termId, audioFilename] of comparisonRows) {
      const comparison = terms[termIndex].comparisons[comparisonIndex];
      if (termId) comparison.term_id = String(termId);
      if (audioFilename) comparison.audio = `${AUDIO_PREFIX}${audioFilename}`;
    }
  }
  for (const [commonIndex, type, category, audioFilename] of deferredCommon) {
    const entry = commonEntries[commonIndex];
    entry.type = String(type || "");
    entry.category = String(category || "");
    entry.audio = audioFilename ? `${AUDIO_PREFIX}${audioFilename}` : "";
  }
  return dictionary;
}
