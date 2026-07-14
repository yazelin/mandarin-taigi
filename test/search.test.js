import test from "node:test";
import assert from "node:assert/strict";

import {
  createSearchIndex,
  groupComparisons,
  normalizeRomanization,
  pickSuggestionTerms,
  searchTerms,
  searchTermsDetailed,
} from "../search.js";
import { selectMandarinVoice } from "../speech.js";

const terms = [
  {
    id: 1,
    mandarin: "醫院",
    comparisons: [
      { accent: "鹿港偏泉腔", hanji: "病院", romanization: "pǐnn-ǐnn", audio: "assets/audio/1.mp3" },
      { accent: "三峽偏泉腔", hanji: "病院", romanization: "pīnn-īnn", audio: "assets/audio/2.mp3" },
      { accent: "鹿港偏泉腔", hanji: "醫生館", romanization: "i-sing-kuán" },
    ],
  },
  {
    id: 2,
    mandarin: "朋友",
    comparisons: [{ accent: "臺南混合腔", hanji: "朋友", romanization: "pîng-iú" }],
  },
];

const index = createSearchIndex(terms);

test("normalizes tone marks and separators in Tailo", () => {
  assert.equal(normalizeRomanization("PǏNN-ǏNN"), "pinn inn");
  assert.equal(normalizeRomanization("pinn7-inn7"), "pinn inn");
  assert.equal(normalizeRomanization("pinn inn"), "pinn inn");
});

test("finds a term by Mandarin, Hanji, and tone-insensitive Tailo", () => {
  assert.equal(searchTerms(index, "醫院")[0].mandarin, "醫院");
  assert.equal(searchTerms(index, "病院")[0].mandarin, "醫院");
  assert.equal(searchTerms(index, "pinn-inn")[0].mandarin, "醫院");
  assert.equal(searchTerms(index, "pinn7-inn7")[0].mandarin, "醫院");
});

test("filters results by accent", () => {
  assert.equal(searchTerms(index, "醫院", { accent: "鹿港偏泉腔" }).length, 1);
  assert.equal(searchTerms(index, "醫院", { accent: "臺南混合腔" }).length, 0);
});

test("only scores comparison rows from the selected accent", () => {
  const crossAccentIndex = createSearchIndex([
    {
      id: 3,
      mandarin: "丈夫",
      comparisons: [
        { accent: "甲腔", hanji: "翁", romanization: "ang" },
        { accent: "乙腔", hanji: "先生", romanization: "sin-senn" },
      ],
    },
  ]);

  assert.equal(searchTerms(crossAccentIndex, "先生", { accent: "甲腔" }).length, 0);
  assert.equal(searchTerms(crossAccentIndex, "sin-senn", { accent: "甲腔" }).length, 0);
  assert.equal(searchTerms(crossAccentIndex, "丈夫", { accent: "甲腔" })[0].mandarin, "丈夫");
  assert.equal(searchTerms(crossAccentIndex, "先生", { accent: "乙腔" })[0].mandarin, "丈夫");
});

test("does not score accent labels as search text", () => {
  assert.deepEqual(searchTerms(index, "鹿港偏泉腔"), []);
});

test("returns detailed comparison matches, total count, and truncation state", () => {
  const detailed = searchTermsDetailed(index, "病院", { accent: "三峽偏泉腔" });

  assert.equal(detailed.total, 1);
  assert.equal(detailed.truncated, false);
  assert.equal(detailed.results[0].term, terms[0]);
  assert.equal(detailed.results[0].match.mandarin, false);
  assert.deepEqual(detailed.results[0].match.comparisons, [
    {
      index: 1,
      comparison: terms[0].comparisons[1],
      fields: ["hanji"],
      score: 1100,
    },
  ]);

  const repeatedMatchIndex = createSearchIndex([
    terms[0],
    {
      id: 4,
      mandarin: "診療所",
      comparisons: [{ accent: "臺南混合腔", hanji: "病院", romanization: "pēnn-īnn" }],
    },
  ]);
  const limited = searchTermsDetailed(repeatedMatchIndex, "病院", { limit: 1 });
  assert.equal(limited.results.length, 1);
  assert.equal(limited.total, 2);
  assert.equal(limited.truncated, true);
});

test("groups only identical comparison records and keeps accent labels", () => {
  const grouped = groupComparisons([
    { accent: "甲腔", hanji: "病院", romanization: "pīnn-īnn", audio: "same.mp3" },
    { accent: "乙腔", hanji: "病院", romanization: "pīnn-īnn", audio: "same.mp3" },
    { accent: "丙腔", hanji: "病院", romanization: "pǐnn-ǐnn", audio: "other.mp3" },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].accents, ["甲腔", "乙腔"]);
});

test("random suggestions only include real short Han terms with official audio", () => {
  const candidates = [
    ...terms,
    {
      id: 3,
      mandarin: "沒有音檔",
      comparisons: [{ accent: "臺北偏泉腔", hanji: "無", romanization: "bô" }],
    },
    {
      id: 4,
      mandarin: "too-long",
      comparisons: [{ accent: "臺北偏泉腔", hanji: "長", romanization: "tn̂g", audio: "long.mp3" }],
    },
    {
      id: 5,
      mandarin: "上吊",
      comparisons: [{ accent: "臺北偏泉腔", hanji: "吊頷", romanization: "tiàu-ām", audio: "5.mp3" }],
    },
  ];
  const selected = pickSuggestionTerms(candidates, 4, () => 0);
  assert.deepEqual(selected.map((term) => term.mandarin), ["醫院"]);
});

test("selects a Taiwanese Mandarin voice and never mistakes Cantonese for Mandarin", () => {
  const taiwaneseMandarin = { lang: "zh-TW", name: "臺灣華語", localService: true };
  assert.equal(
    selectMandarinVoice([
      { lang: "en-US", name: "English", localService: true },
      { lang: "zh-CN", name: "普通話", localService: true },
      taiwaneseMandarin,
    ]),
    taiwaneseMandarin,
  );
  assert.equal(selectMandarinVoice([{ lang: "zh-HK", name: "粵語", localService: true }]), null);
  assert.equal(
    selectMandarinVoice([{ lang: "zh-TW", name: "遠端華語", localService: false }]),
    null,
    "remote voices must not receive words under the local-only privacy promise",
  );
});
