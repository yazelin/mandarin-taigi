import test from "node:test";
import assert from "node:assert/strict";

import {
  commonMatchesComparison,
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

test("finds official common headwords by Hanji and every Tailo reading", () => {
  const commonEntries = [
    {
      kind: "common",
      id: "22317",
      hanji: "想像",
      romanization: "sióng-siōng",
      type: "臺華共同詞",
      category: "心理活動",
      audio: "assets/audio/22317(1).mp3",
    },
    {
      kind: "common",
      id: "10000",
      hanji: "問題",
      romanization: "būn-tê/būn-tuê",
      type: "臺華共同詞",
      category: "",
      audio: "assets/audio/10000(1).mp3",
    },
  ];
  const commonIndex = createSearchIndex({ terms, common_entries: commonEntries });

  const imagination = searchTermsDetailed(commonIndex, "想像");
  assert.equal(imagination.total, 1);
  assert.equal(imagination.results[0].term, null);
  assert.equal(imagination.results[0].common, commonEntries[0]);
  assert.deepEqual(imagination.results[0].match.common.fields, ["hanji"]);
  assert.equal(searchTerms(commonIndex, "siong2-siong7")[0].mandarin, "想像");
  assert.equal(searchTerms(commonIndex, "bun-te")[0].mandarin, "問題");
  assert.equal(searchTerms(commonIndex, "bun-tue")[0].mandarin, "問題");
  assert.equal(searchTerms(commonIndex, "想像", { accent: "臺南混合腔" }).length, 0);
});

test("merges a common headword with the same Mandarin comparison result", () => {
  const sharedFriend = {
    kind: "common",
    id: "20000",
    hanji: "朋友",
    romanization: "pîng-iú",
    type: "臺華共同詞",
    category: "稱謂",
  };
  const combinedIndex = createSearchIndex({ terms, common_entries: [sharedFriend] });
  const result = searchTermsDetailed(combinedIndex, "朋友");

  assert.equal(result.total, 1);
  assert.equal(result.results[0].term, terms[1]);
  assert.equal(result.results[0].common, sharedFriend);
  assert.equal(
    commonMatchesComparison(sharedFriend, {
      term_id: "20000",
      hanji: "朋友",
      romanization: "pîng-iú",
    }),
    true,
  );
  assert.equal(
    commonMatchesComparison(sharedFriend, {
      term_id: "different",
      hanji: "朋友",
      romanization: "pîng-iú",
    }),
    false,
  );
});

test("ranks an exact common headword before a different comparison meaning", () => {
  const busComparison = {
    kind: "comparison",
    id: "300",
    mandarin: "公共汽車",
    comparisons: [{ accent: "臺南混合腔", hanji: "公車", romanization: "kong-tshia" }],
  };
  const commonBus = {
    kind: "common",
    id: "301",
    hanji: "公車",
    romanization: "kong-tshia",
    type: "臺華共同詞",
    category: "交通",
  };
  const ranked = searchTermsDetailed(
    createSearchIndex({ terms: [busComparison], common_entries: [commonBus] }),
    "公車",
  );

  assert.equal(ranked.total, 2);
  assert.equal(ranked.results[0].common, commonBus);
  assert.equal(ranked.results[0].term, null);
  assert.equal(ranked.results[1].term, busComparison);
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
