// Pure quiz and learning-progress logic. Keep this module free of DOM and storage access.

export const QUIZ_OPTION_COUNT = 4;
export const MASTER_BOX = 3;

const MIN_HAN_LENGTH = 1;
const MAX_HAN_LENGTH = 5;
const HAN_TEXT = /^[\p{Script=Han}]+$/u;

// Substring denylist for a family-friendly public quiz. Parenthesized annotations
// and punctuation are rejected separately by the Han-only text check.
export const QUIZ_TEXT_DENYLIST = Object.freeze([
  "三字經",
  "早死",
  "絕子絕孫",
  "夭壽",
  "夭壽仔",
  "操他媽",
  "幹你娘",
  "幹恁娘",
  "膣屄",
  "姦夫",
  "妓女",
  "妓院",
  "娼妓",
  "性病",
  "性交",
  "交媾",
  "做愛",
  "自慰",
  "夢遺",
  "精液",
  "陰莖",
  "陰囊",
  "睪丸",
  "性愛",
  "色情",
  "強姦",
  "精子",
  "肛門",
  "胸罩",
  "一堆屎",
  "乳房",
  "月經",
  "月經布",
  "陰陽人",
  "半陰陽仔",
  "𡳞",
  "𡳞鳥",
  "𡳞脬",
  "𡳞核",
]);

const DENIED_TEXT = new Set(QUIZ_TEXT_DENYLIST);

function containsDeniedText(value) {
  return [...DENIED_TEXT].some((denied) => value.includes(denied));
}

function normalizeValue(value) {
  return value == null ? "" : String(value).normalize("NFKC").trim();
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isReasonableHanText(value) {
  const length = [...value].length;
  return (
    length >= MIN_HAN_LENGTH &&
    length <= MAX_HAN_LENGTH &&
    HAN_TEXT.test(value) &&
    !containsDeniedText(value)
  );
}

function addMapping(map, key, answer) {
  if (!key || !answer) return;
  const answers = map.get(key) || new Set();
  answers.add(answer);
  map.set(key, answers);
}

function ambiguousKeys(map) {
  return new Set(
    [...map.entries()].filter(([, answers]) => answers.size > 1).map(([key]) => key),
  );
}

function formKey(hanji, romanization) {
  return hanji && romanization ? `${hanji}\u0000${romanization}` : "";
}

// Reversible encoding avoids hash collisions while producing a localStorage-safe ID.
function encodeIdPart(value) {
  return [...value]
    .map((character) =>
      /^[A-Za-z0-9-]$/.test(character)
        ? character
        : `_${character.codePointAt(0).toString(16)}_`,
    )
    .join("");
}

function candidateId(candidate) {
  const source = candidate.term_id || candidate.audio;
  return `taigi:${[source, candidate.audio, candidate.hanji, candidate.romanization]
    .map(encodeIdPart)
    .join(":")}`;
}

function inputTerms(input) {
  if (Array.isArray(input)) return input;
  return Array.isArray(input?.terms) ? input.terms : [];
}

function inputCommonEntries(input) {
  return Array.isArray(input?.common_entries) ? input.common_entries : [];
}

/**
 * Build safe, audio-first quiz candidates from dictionary terms.
 *
 * Ambiguity is calculated before content validation: a valid-looking answer cannot
 * remain in the pool merely because the other meaning has a parenthesized note.
 */
export function buildQuizPool(input = []) {
  const rows = [];
  const answersByAudio = new Map();
  const answersByForm = new Map();

  for (const term of inputTerms(input)) {
    if (!term || typeof term !== "object") continue;
    if (term.kind && term.kind !== "comparison") continue;
    const answer = normalizeValue(term.mandarin);
    const comparisons = Array.isArray(term.comparisons) ? term.comparisons : [];

    for (const comparison of comparisons) {
      if (!comparison || typeof comparison !== "object") continue;
      const audio = normalizeValue(comparison.audio);
      if (!audio) continue;

      const hanji = normalizeValue(comparison.hanji);
      const romanization = normalizeValue(comparison.romanization);
      const row = {
        answer,
        audio,
        hanji,
        romanization,
        accent: normalizeValue(comparison.accent),
        term_id: normalizeValue(comparison.term_id),
      };
      rows.push(row);
      addMapping(answersByAudio, audio, answer);
      addMapping(answersByForm, formKey(hanji, romanization), answer);
    }
  }

  for (const common of inputCommonEntries(input)) {
    if (!common || typeof common !== "object") continue;
    if (common.kind && common.kind !== "common") continue;
    const answer = normalizeValue(common.hanji);
    const audio = normalizeValue(common.audio);
    if (!audio) continue;

    const hanji = normalizeValue(common.hanji);
    const romanization = normalizeValue(common.romanization);
    const row = {
      answer,
      audio,
      hanji,
      romanization,
      accent: "",
      term_id: normalizeValue(common.id),
    };
    rows.push(row);
    addMapping(answersByAudio, audio, answer);
    addMapping(answersByForm, formKey(hanji, romanization), answer);
  }

  const ambiguousAudio = ambiguousKeys(answersByAudio);
  const ambiguousForm = ambiguousKeys(answersByForm);
  const answersInAmbiguousAudio = new Set();
  for (const audio of ambiguousAudio) {
    for (const answer of answersByAudio.get(audio)) answersInAmbiguousAudio.add(answer);
  }

  const groups = new Map();
  for (const row of rows) {
    if (
      ambiguousAudio.has(row.audio) ||
      answersInAmbiguousAudio.has(row.answer) ||
      ambiguousForm.has(formKey(row.hanji, row.romanization)) ||
      !isReasonableHanText(row.answer) ||
      !isReasonableHanText(row.hanji) ||
      !row.romanization
    ) {
      continue;
    }

    const key = [row.answer, row.audio, row.hanji, row.romanization].join("\u0000");
    const existing = groups.get(key);
    if (existing) {
      if (row.accent) existing.accents.add(row.accent);
      if (row.term_id) existing.termIds.add(row.term_id);
      continue;
    }

    groups.set(key, {
      answer: row.answer,
      audio: row.audio,
      hanji: row.hanji,
      romanization: row.romanization,
      accents: new Set(row.accent ? [row.accent] : []),
      termIds: new Set(row.term_id ? [row.term_id] : []),
    });
  }

  const candidates = [];
  for (const group of groups.values()) {
    const termIds = [...group.termIds].sort(compareText);
    const candidate = {
      answer: group.answer,
      mandarin: group.answer,
      term_id: termIds[0] || null,
      audio: group.audio,
      hanji: group.hanji,
      romanization: group.romanization,
      accents: [...group.accents].sort(compareText),
    };
    candidates.push({ id: candidateId(candidate), ...candidate });
  }

  return candidates.sort((left, right) => compareText(left.id, right.id));
}

function randomIndex(length, rng) {
  const value = Number(rng());
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
  return Math.floor(normalized * length);
}

function shuffled(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const picked = randomIndex(index + 1, rng);
    [copy[index], copy[picked]] = [copy[picked], copy[index]];
  }
  return copy;
}

function answerLength(answer) {
  return [...answer].length;
}

function distractorsFor(question, answers, rng) {
  const wantedLength = answerLength(question.answer);
  const buckets = new Map();

  for (const answer of answers) {
    if (answer === question.answer) continue;
    // A visible Hanji can be shown after answering; avoid using it as a competing
    // Mandarin choice whenever the pool has enough alternatives.
    const conflictsWithPrompt = answer === question.hanji ? 1 : 0;
    const distance = Math.abs(answerLength(answer) - wantedLength);
    const score = conflictsWithPrompt * 100 + distance;
    const bucket = buckets.get(score) || [];
    bucket.push(answer);
    buckets.set(score, bucket);
  }

  const selected = [];
  for (const score of [...buckets.keys()].sort((left, right) => left - right)) {
    selected.push(...shuffled(buckets.get(score).sort(compareText), rng));
    if (selected.length >= QUIZ_OPTION_COUNT - 1) break;
  }
  return selected.slice(0, QUIZ_OPTION_COUNT - 1);
}

/**
 * Draw an exact-size round with unique answers and four unique choices per item.
 */
export function buildQuizRound(pool, count = 10, rng = Math.random) {
  if (!Array.isArray(pool)) throw new TypeError("pool must be an array");
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative integer");
  }
  if (typeof rng !== "function") throw new TypeError("rng must be a function");
  if (count === 0) return [];

  const candidatesByAnswer = new Map();
  for (const candidate of pool) {
    if (!candidate || typeof candidate !== "object") continue;
    const answer = normalizeValue(candidate.answer || candidate.mandarin);
    if (!answer) continue;
    const candidates = candidatesByAnswer.get(answer) || [];
    candidates.push(candidate);
    candidatesByAnswer.set(answer, candidates);
  }

  const answers = [...candidatesByAnswer.keys()].sort(compareText);
  if (answers.length < QUIZ_OPTION_COUNT) {
    throw new RangeError(`quiz needs at least ${QUIZ_OPTION_COUNT} distinct answers`);
  }
  if (answers.length < count) {
    throw new RangeError(`quiz has only ${answers.length} distinct answers for ${count} questions`);
  }

  const selectedAnswers = shuffled(answers, rng).slice(0, count);
  return selectedAnswers.map((answer) => {
    const matchingCandidates = [...candidatesByAnswer.get(answer)].sort((left, right) =>
      compareText(normalizeValue(left.id), normalizeValue(right.id)),
    );
    const source = matchingCandidates[randomIndex(matchingCandidates.length, rng)];
    const question = { ...source, answer, mandarin: answer };
    const distractors = distractorsFor(question, answers, rng);
    const options = shuffled([answer, ...distractors], rng);

    return {
      ...question,
      correctAnswer: answer,
      options,
      correctIndex: options.indexOf(answer),
    };
  });
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function learningBox(value) {
  return Math.max(1, Math.min(MASTER_BOX, nonNegativeInteger(value, 1)));
}

/**
 * Return the next immutable Leitner progress record. Pass answeredAt from the UI
 * when a last-answer timestamp should be stored; no clock or storage is read here.
 */
export function nextLearningProgress(current = {}, wasCorrect, answeredAt) {
  if (typeof wasCorrect !== "boolean") throw new TypeError("wasCorrect must be a boolean");
  const previous = current && typeof current === "object" ? current : {};
  const box = learningBox(previous.box);
  const next = {
    ...previous,
    box: wasCorrect ? Math.min(MASTER_BOX, box + 1) : 1,
    attempts: nonNegativeInteger(previous.attempts) + 1,
    correct: nonNegativeInteger(previous.correct) + (wasCorrect ? 1 : 0),
    wrong: nonNegativeInteger(previous.wrong) + (wasCorrect ? 0 : 1),
    streak: wasCorrect ? nonNegativeInteger(previous.streak) + 1 : 0,
  };
  if (answeredAt !== undefined) next.lastAnsweredAt = answeredAt;
  return next;
}

export function isMastered(progressOrBox) {
  const value =
    progressOrBox && typeof progressOrBox === "object"
      ? progressOrBox.box
      : progressOrBox;
  return learningBox(value) >= MASTER_BOX;
}

/** Return candidates that were answered incorrectly and are not mastered yet. */
export function currentWrongCandidates(pool = [], progressById = {}) {
  if (!Array.isArray(pool)) return [];
  const progressFor =
    progressById instanceof Map
      ? (id) => progressById.get(id)
      : (id) => (progressById && typeof progressById === "object" ? progressById[id] : undefined);

  return pool.filter((candidate) => {
    const progress = progressFor(candidate?.id);
    return nonNegativeInteger(progress?.wrong) > 0 && !isMastered(progress);
  });
}
