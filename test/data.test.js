import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = resolve(repositoryRoot, "data/dictionary.json");
const dictionary = JSON.parse(readFileSync(dataPath, "utf8"));

test("generated dictionary metadata matches its rows", () => {
  assert.equal(dictionary.metadata.term_count, dictionary.terms.length);
  assert.equal(
    dictionary.metadata.comparison_count,
    dictionary.terms.reduce((total, term) => total + term.comparisons.length, 0),
  );
  assert.equal(new Set(dictionary.terms.map((term) => term.id)).size, dictionary.terms.length);
});

test("every emitted audio reference exists and unique count matches metadata", () => {
  const audioPaths = new Set();
  let referenceCount = 0;
  for (const term of dictionary.terms) {
    for (const comparison of term.comparisons) {
      if (!comparison.audio) continue;
      referenceCount += 1;
      const absolutePath = resolve(dirname(dataPath), comparison.audio);
      assert.equal(existsSync(absolutePath), true, `missing ${comparison.audio}`);
      audioPaths.add(absolutePath);
    }
  }
  assert.equal(referenceCount, dictionary.metadata.audio_comparison_count);
  assert.equal(audioPaths.size, dictionary.metadata.audio_file_count);
});

test("known official comparison is present without generated fallback text", () => {
  const hospital = dictionary.terms.find((term) => term.mandarin === "醫院");
  assert.ok(hospital);
  assert.ok(hospital.comparisons.some((comparison) => comparison.hanji === "病院"));
  assert.ok(hospital.comparisons.some((comparison) => comparison.romanization === "i-sing-kuán"));
});
