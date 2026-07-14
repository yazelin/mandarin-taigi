import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeLearning } from "../learning.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

test("learning module stays importable as an isolated feature boundary", () => {
  assert.equal(typeof initializeLearning, "function");
});

test("homepage exposes all learning routes and split offline audio controls", () => {
  const html = read("index.html");
  for (const route of ["dictionary", "challenge", "wrongbook", "flashcards", "about"]) {
    assert.ok(html.includes(`data-app-view="${route}"`), route);
  }
  for (const id of [
    "learning-view",
    "install-app",
    "download-taigi-audio",
    "download-mandarin-audio",
    "cancel-audio-download",
    "clear-offline-audio",
    "dictionary-load-status",
    "dictionary-load-progress",
    "retry-dictionary-load",
  ]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.includes("下載完整台語語音（約 186 MB）"));
  assert.equal(html.includes("16 MB"), false);
  assert.equal(html.includes('id="download-audio"'), false);
});

test("app and worker agree on the persistent audio cache name", () => {
  const appCache = read("app.js").match(/const AUDIO_CACHE = "([^"]+)"/)?.[1];
  const workerCache = read("sw.js").match(/const AUDIO_CACHE = "([^"]+)"/)?.[1];
  const sourceDate = JSON.parse(read("data/dictionary-core.json")).m.source_updated.replaceAll("-", "");
  const mandarinSource = JSON.parse(read("data/mandarin-audio.json")).metadata.source_version;
  assert.ok(appCache);
  assert.equal(workerCache, appCache);
  assert.ok(appCache.includes(sourceDate), "audio cache must include the dictionary source date");
  assert.ok(appCache.endsWith(mandarinSource), "audio cache must include the Mandarin audio source version");
});

test("full audio download keeps its app and worker reliability guardrails", () => {
  const app = read("app.js");
  const worker = read("sw.js");
  const appHeader = app.match(/const BULK_DOWNLOAD_HEADER = "([^"]+)"/)?.[1];
  const workerHeader = worker.match(/const BULK_DOWNLOAD_HEADER = "([^"]+)"/)?.[1];

  assert.equal(workerHeader, appHeader);
  assert.ok(app.includes("navigator.storage?.estimate?.()"));
  assert.ok(app.includes("window.confirm("));
  assert.ok(app.includes("failedBatches >= 3"));
  assert.ok(app.includes("canDownloadOfflineAudio(state.serviceWorkerCompatibility)"));
  assert.ok(worker.includes("request.headers.get(BULK_DOWNLOAD_HEADER)"));
});

test("install manifest provides direct challenge and wrongbook shortcuts", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === "./#challenge"));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === "./#wrongbook"));
});

test("HTML and every module edge use one versioned release URL", () => {
  const html = read("index.html");
  const app = read("app.js");
  const learning = read("learning.js");
  const worker = read("sw.js");
  const appRelease = app.match(/const RELEASE_REVISION = "([^"]+)"/)?.[1];
  const workerRelease = worker.match(/const RELEASE_REVISION = "([^"]+)"/)?.[1];
  assert.equal(appRelease, "12");
  assert.equal(workerRelease, appRelease);
  assert.match(html, /styles\.css\?v=12/);
  assert.match(html, /app\.js\?v=12/);
  for (const module of ["search", "speech", "learning", "offline", "dictionary-data"]) {
    assert.ok(app.includes(`./${module}.js?v=12`), module);
  }
  assert.ok(learning.includes("./quiz.js?v=12"));
  assert.ok(app.includes("./data/dictionary-core.json?v=12"));
  assert.ok(app.includes("./data/dictionary-details.json?v=12"));
  assert.ok(app.includes("./data/mandarin-audio.json?v=12"));
  assert.equal(app.includes("./data/dictionary.json"), false);
  assert.ok(app.includes('register("./sw.js")'));
  assert.ok(app.includes('type: "GET_RELEASE"'));
  assert.ok(worker.includes('type !== "GET_RELEASE"'));
});

test("text progress stays separate from optional audio status and has honest states", () => {
  const html = read("index.html");
  const app = read("app.js");
  assert.ok(html.includes('id="dictionary-load"'));
  assert.ok(html.includes('id="offline-status"'));
  assert.ok(app.includes("核心詞庫已可查"));
  assert.ok(app.includes("完整文字詞庫與離線服務已準備完成"));
  assert.ok(app.includes("選用的語音包不在這個進度內"));
  assert.ok(app.includes("state.detailsCached"));
  assert.ok(app.includes('compatibility === "current" || compatibility === "installed"'));
  assert.ok(app.includes("lastAnnouncedProgress"));
  assert.match(app, /state\.coreCachePromise = cacheValidatedResponse[\s\S]{0,200}registerServiceWorker\(\)/);
  assert.ok(html.includes('id="dictionary-load-live"'));
  assert.ok(html.indexOf('id="dictionary-load-progress"') < html.indexOf('id="dictionary-load-live"'));
});
