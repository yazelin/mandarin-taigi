import test from "node:test";
import assert from "node:assert/strict";

import { canDownloadOfflineAudio, classifyServiceWorkerReply } from "../offline.js";

const expected = {
  releaseRevision: "15",
  audioCache: "mandarin-taigi-audio-20260713-2014_20260626",
};

test("a verified v15 worker allows first-load downloads before it controls the page", () => {
  const reply = { release: "15", audioCache: expected.audioCache };
  assert.equal(classifyServiceWorkerReply(reply, { ...expected, controlled: false }), "installed");
  assert.equal(canDownloadOfflineAudio("installed"), true);
});

test("a verified controller allows downloads", () => {
  const reply = { release: "15", audioCache: expected.audioCache };
  assert.equal(classifyServiceWorkerReply(reply, { ...expected, controlled: true }), "current");
  assert.equal(canDownloadOfflineAudio("current"), true);
});

test("old, silent, and unavailable workers stay blocked", () => {
  assert.equal(
    classifyServiceWorkerReply(
      { release: "14", audioCache: expected.audioCache },
      { ...expected, controlled: true },
    ),
    "outdated",
  );
  assert.equal(classifyServiceWorkerReply(null, { ...expected, controlled: false }), "unverified");
  for (const status of ["checking", "outdated", "unverified", "none"]) {
    assert.equal(canDownloadOfflineAudio(status), false, status);
  }
});
