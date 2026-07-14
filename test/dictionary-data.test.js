import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyDictionaryDetails, decodeDictionaryCore } from "../dictionary-data.js";
import { createSearchIndex, searchTermsDetailed } from "../search.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePayload = JSON.parse(readFileSync(resolve(root, "data/dictionary-core.json"), "utf8"));
const detailsPayload = JSON.parse(readFileSync(resolve(root, "data/dictionary-details.json"), "utf8"));

function resultKeys(index, query, accent = "") {
  return searchTermsDetailed(index, query, { accent, limit: 1000 }).results.map((result) =>
    result.term ? `term:${result.term.id}` : `common:${result.common.id}`,
  );
}

test("core alone preserves every current search field and result", () => {
  const decoded = decodeDictionaryCore(corePayload);
  const coreIndex = createSearchIndex(decoded.dictionary);
  const before = [
    resultKeys(coreIndex, "醫院"),
    resultKeys(coreIndex, "病院"),
    resultKeys(coreIndex, "pīnn-īnn"),
    resultKeys(coreIndex, "想像"),
    resultKeys(coreIndex, "sióng-siōng"),
    resultKeys(coreIndex, "醫院", "臺南混合腔"),
  ];

  applyDictionaryDetails(decoded.dictionary, detailsPayload, decoded.runtime);
  const completeIndex = createSearchIndex(decoded.dictionary);
  const after = [
    resultKeys(completeIndex, "醫院"),
    resultKeys(completeIndex, "病院"),
    resultKeys(completeIndex, "pīnn-īnn"),
    resultKeys(completeIndex, "想像"),
    resultKeys(completeIndex, "sióng-siōng"),
    resultKeys(completeIndex, "醫院", "臺南混合腔"),
  ];
  assert.deepEqual(after, before);
  assert.ok(before.every((results) => results.length > 0));
});

test("mixed or incomplete details are rejected before mutating core", () => {
  for (const mutate of [
    (payload) => { payload.r = "stale-revision"; },
    (payload) => { payload.n[3] += 1; },
    (payload) => { payload.c.pop(); },
  ]) {
    const decoded = decodeDictionaryCore(corePayload);
    const details = structuredClone(detailsPayload);
    mutate(details);
    const before = JSON.stringify(decoded.dictionary);
    assert.throws(() => applyDictionaryDetails(decoded.dictionary, details, decoded.runtime));
    assert.equal(JSON.stringify(decoded.dictionary), before);
  }
});

test("runtime fingerprint and declared coverage match the generated payload", () => {
  const decoded = decodeDictionaryCore(corePayload);
  assert.equal(detailsPayload.r, decoded.runtime.revision);
  assert.deepEqual(detailsPayload.n.map(Number), decoded.runtime.counts);
  assert.equal(corePayload.d, readFileSync(resolve(root, "data/dictionary-details.json")).byteLength);
});
