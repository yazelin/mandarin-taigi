import test from "node:test";
import assert from "node:assert/strict";

import { createSearchIndex, groupComparisons, normalizeRomanization, searchTerms } from "../search.js";

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
  assert.equal(normalizeRomanization("pinn inn"), "pinn inn");
});

test("finds a term by Mandarin, Hanji, and tone-insensitive Tailo", () => {
  assert.equal(searchTerms(index, "醫院")[0].mandarin, "醫院");
  assert.equal(searchTerms(index, "病院")[0].mandarin, "醫院");
  assert.equal(searchTerms(index, "pinn-inn")[0].mandarin, "醫院");
});

test("filters results by accent", () => {
  assert.equal(searchTerms(index, "醫院", { accent: "鹿港偏泉腔" }).length, 1);
  assert.equal(searchTerms(index, "醫院", { accent: "臺南混合腔" }).length, 0);
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
