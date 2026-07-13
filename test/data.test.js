import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pickSuggestionTerms } from "../search.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = resolve(repositoryRoot, "data/dictionary.json");
const dictionary = JSON.parse(readFileSync(dataPath, "utf8"));
const mandarinAudioPath = resolve(repositoryRoot, "data/mandarin-audio.json");
const mandarinAudio = JSON.parse(readFileSync(mandarinAudioPath, "utf8"));

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

test("homepage can always draw four valid examples from the generated dictionary", () => {
  const suggestions = pickSuggestionTerms(dictionary.terms, 4, () => 0.25);
  assert.equal(suggestions.length, 4);
  assert.equal(new Set(suggestions.map((term) => term.mandarin)).size, 4);
  for (const term of suggestions) {
    assert.ok(dictionary.terms.includes(term));
    assert.ok(term.comparisons.some((comparison) => comparison.audio));
  }
});

test("every official Mandarin audio entry is an exact dictionary headword with an unchanged WAV", () => {
  const dictionaryWords = new Set(dictionary.terms.map((term) => term.mandarin));
  const entries = Object.entries(mandarinAudio.entries);
  assert.equal(entries.length, mandarinAudio.metadata.audio_file_count);
  assert.equal(entries.length, 98);

  const audioPaths = new Set();
  for (const [word, entry] of entries) {
    assert.ok(dictionaryWords.has(word), `unknown Mandarin headword ${word}`);
    assert.equal([...word].length, 1, `official word recording must be a single character: ${word}`);
    assert.ok(entry.bopomofo);
    assert.ok(entry.pinyin);
    const absolutePath = resolve(dirname(mandarinAudioPath), entry.audio);
    const header = readFileSync(absolutePath).subarray(0, 12);
    assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(header.subarray(8, 12).toString("ascii"), "WAVE");
    audioPaths.add(absolutePath);
  }
  assert.equal(audioPaths.size, entries.length);
});
