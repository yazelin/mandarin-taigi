import test from "node:test";
import assert from "node:assert/strict";

import { canDownloadOfflineAudio, classifyServiceWorkerReply } from "../offline.js";

const expected = {
  releaseRevision: "8",
  audioCache: "mandarin-taigi-audio-current",
};

test("a verified active worker allows first-load downloads before it controls the page", () => {
  const reply = { release: "8", audioCache: expected.audioCache };
  assert.equal(classifyServiceWorkerReply(reply, { ...expected, controlled: false }), "installed");
  assert.equal(canDownloadOfflineAudio("installed"), true);
});

test("a verified controller allows downloads", () => {
  const reply = { release: "8", audioCache: expected.audioCache };
  assert.equal(classifyServiceWorkerReply(reply, { ...expected, controlled: true }), "current");
  assert.equal(canDownloadOfflineAudio("current"), true);
});

test("old, silent, and unavailable workers stay blocked", () => {
  assert.equal(
    classifyServiceWorkerReply(
      { release: "7", audioCache: expected.audioCache },
      { ...expected, controlled: true },
    ),
    "outdated",
  );
  assert.equal(classifyServiceWorkerReply(null, { ...expected, controlled: false }), "unverified");
  for (const status of ["checking", "outdated", "unverified", "none"]) {
    assert.equal(canDownloadOfflineAudio(status), false, status);
  }
});
