import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MASTER_BOX,
  QUIZ_TEXT_DENYLIST,
  buildQuizPool,
  buildQuizRound,
  currentWrongCandidates,
  isMastered,
  nextLearningProgress,
} from "../quiz.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dictionary = JSON.parse(
  readFileSync(resolve(repositoryRoot, "data/dictionary.json"), "utf8"),
);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function comparison(termId, audio, hanji, romanization, accent = "臺南混合腔") {
  return { term_id: termId, audio, hanji, romanization, accent };
}

test("builds a large safe pool from the generated dictionary", () => {
  const pool = buildQuizPool(dictionary.terms);
  const answers = new Set(pool.map((candidate) => candidate.answer));

  assert.ok(pool.length >= 500, `expected hundreds of candidates, received ${pool.length}`);
  assert.ok(answers.size >= 500, `expected hundreds of answers, received ${answers.size}`);
  assert.equal(new Set(pool.map((candidate) => candidate.id)).size, pool.length);
  assert.equal(answers.has("老師"), false, "an answer involved in ambiguous audio must be excluded");
  assert.equal(answers.has("妓院"), false, "explicit-content denylist must be applied");

  for (const candidate of pool) {
    assert.match(candidate.answer, /^[\p{Script=Han}]{1,5}$/u);
    assert.match(candidate.hanji, /^[\p{Script=Han}]{1,5}$/u);
    assert.ok(candidate.audio);
    assert.ok(candidate.romanization);
    assert.ok(candidate.term_id);
    assert.equal(
      QUIZ_TEXT_DENYLIST.some(
        (denied) => candidate.answer.includes(denied) || candidate.hanji.includes(denied),
      ),
      false,
      `${candidate.answer} / ${candidate.hanji} contains denied quiz text`,
    );
    assert.deepEqual(candidate.accents, [...new Set(candidate.accents)].sort());
  }
});

test("detects ambiguity before validation, excludes every affected answer, and deduplicates accents", () => {
  const safeDuplicate = {
    id: "1",
    mandarin: "蘋果",
    comparisons: [
      comparison("apple", "apple.mp3", "蘋果", "phông-kó", "甲腔"),
      comparison("apple", "apple.mp3", "蘋果", "phông-kó", "乙腔"),
      comparison("apple", "apple.mp3", "蘋果", "phông-kó", "甲腔"),
    ],
  };
  const ambiguousWithInvalidMeaning = [
    {
      id: "2",
      mandarin: "老師",
      comparisons: [
        comparison("teacher", "shared.mp3", "先生", "sian-sinn"),
        comparison("teacher-2", "teacher.mp3", "教員", "kàu-uân"),
      ],
    },
    {
      id: "3",
      mandarin: "丈夫（稱呼）",
      comparisons: [comparison("husband", "shared.mp3", "先生", "sian-sinn")],
    },
  ];
  const ambiguousForm = [
    {
      id: "4",
      mandarin: "甲詞",
      comparisons: [comparison("a", "a.mp3", "同音", "tông-im")],
    },
    {
      id: "5",
      mandarin: "乙詞",
      comparisons: [comparison("b", "b.mp3", "同音", "tông-im")],
    },
  ];
  const rejectedContent = [
    {
      id: "6",
      mandarin: "妓院",
      comparisons: [comparison("adult", "adult.mp3", "酒家", "tsiú-ka")],
    },
    {
      id: "7",
      mandarin: "收音機",
      comparisons: [comparison("latin", "latin.mp3", "la-jí-ooh", "la-jí-ooh")],
    },
  ];

  const terms = [safeDuplicate, ...ambiguousWithInvalidMeaning, ...ambiguousForm, ...rejectedContent];
  const pool = buildQuizPool(terms);

  assert.equal(pool.length, 1);
  assert.equal(pool[0].answer, "蘋果");
  assert.deepEqual(pool[0].accents, ["乙腔", "甲腔"].sort());
  assert.equal(pool.some((candidate) => candidate.answer === "老師"), false);

  const reversed = terms
    .map((term) => ({ ...term, comparisons: [...term.comparisons].reverse() }))
    .reverse();
  assert.deepEqual(buildQuizPool(reversed), pool, "pool and stable IDs must not depend on row order");
});

test("draws ten non-repeating questions with four unique options", () => {
  const pool = buildQuizPool(dictionary);
  const round = buildQuizRound(pool, 10, seededRandom(20260714));

  assert.equal(round.length, 10);
  assert.equal(new Set(round.map((question) => question.id)).size, 10);
  assert.equal(new Set(round.map((question) => question.correctAnswer)).size, 10);

  for (const question of round) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(question.options.includes(question.correctAnswer));
    assert.equal(question.options[question.correctIndex], question.correctAnswer);
  }
});

test("seeded rounds are deterministic and prefer same-length distractors", () => {
  const pool = ["甲乙", "丙丁", "戊己", "庚辛", "壬癸", "子丑"].map((answer, index) => ({
    id: `candidate-${index}`,
    answer,
    mandarin: answer,
    term_id: String(index),
    audio: `${index}.mp3`,
    hanji: `天地`,
    romanization: `test-${index}`,
    accents: ["測試腔"],
  }));

  const first = buildQuizRound(pool, 3, seededRandom(42));
  const second = buildQuizRound([...pool].reverse(), 3, seededRandom(42));
  assert.deepEqual(first, second);
  for (const question of first) {
    assert.ok(question.options.every((option) => [...option].length === 2));
  }
});

test("updates Leitner progress immutably and returns only current wrong candidates", () => {
  const original = { box: 1, attempts: 0, correct: 0, wrong: 0, starred: true };
  const once = nextLearningProgress(original, true, "2026-07-14T01:00:00Z");
  const mastered = nextLearningProgress(once, true, "2026-07-14T01:01:00Z");
  const missed = nextLearningProgress(mastered, false, "2026-07-14T01:02:00Z");
  const recovering = nextLearningProgress(missed, true, "2026-07-14T01:03:00Z");

  assert.deepEqual(original, { box: 1, attempts: 0, correct: 0, wrong: 0, starred: true });
  assert.equal(once.box, 2);
  assert.equal(once.starred, true);
  assert.equal(mastered.box, MASTER_BOX);
  assert.equal(isMastered(mastered), true);
  assert.equal(isMastered(MASTER_BOX), true);
  assert.equal(missed.box, 1);
  assert.equal(missed.wrong, 1);
  assert.equal(missed.streak, 0);
  assert.equal(recovering.box, 2);
  assert.equal(isMastered(recovering), false);

  const pool = [{ id: "missed" }, { id: "recovering" }, { id: "mastered" }, { id: "new" }];
  const progress = { missed, recovering, mastered };
  assert.deepEqual(
    currentWrongCandidates(pool, progress).map((candidate) => candidate.id),
    ["missed", "recovering"],
  );
  assert.deepEqual(
    currentWrongCandidates(pool, new Map(Object.entries(progress))).map((candidate) => candidate.id),
    ["missed", "recovering"],
  );
});
