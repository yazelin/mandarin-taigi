import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = readFileSync(resolve(repositoryRoot, "sw.js"), "utf8");
const scope = "https://example.test/mandarin-taigi/";
const shellCache = "mandarin-taigi-shell-v14";
const dataCache = "mandarin-taigi-data-v13";
const legacyShellCache = "mandarin-taigi-shell-v13";
const audioCache = "mandarin-taigi-audio-20260713-2014_20260626";

function cacheKey(input) {
  const url = new URL(typeof input === "string" ? input : input.url);
  url.hash = "";
  return url.href;
}

function createWorker(fetchImplementation, { openFails = false, putFails = false, putFailure = null } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const puts = [];
  const fetchCalls = [];
  let clientsClaimed = false;

  const getStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };

  const cacheFor = (name) => ({
    async match(request) {
      const response = getStore(name).get(cacheKey(request));
      return response?.clone();
    },
    async put(request, response) {
      const key = cacheKey(request);
      if (putFails || putFailure?.({ name, key })) {
        throw Object.assign(new Error("cache quota unavailable"), { name: "QuotaExceededError" });
      }
      puts.push({ name, key });
      getStore(name).set(key, response.clone());
    },
    async delete(request) {
      return getStore(name).delete(cacheKey(request));
    },
  });

  const caches = {
    async open(name) {
      if (openFails) throw new Error("CacheStorage unavailable");
      getStore(name);
      return cacheFor(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };

  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: {
      async claim() {
        clientsClaimed = true;
      },
    },
    async skipWaiting() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };

  const context = vm.createContext({
    self,
    caches,
    URL,
    Request,
    Response,
    Headers,
    fetch: async (...args) => {
      fetchCalls.push(args);
      return fetchImplementation(...args);
    },
  });
  vm.runInContext(workerSource, context, { filename: "sw.js" });

  return {
    stores,
    puts,
    fetchCalls,
    get clientsClaimed() {
      return clientsClaimed;
    },
    seed(name, url, body, init) {
      getStore(name).set(cacheKey(url), new Response(body, init));
    },
    cached(name, url) {
      return getStore(name).get(cacheKey(url));
    },
    async cachedText(name, url) {
      const response = getStore(name).get(cacheKey(url));
      return response ? response.clone().text() : undefined;
    },
    async dispatchFetch(url, { mode = "cors", method = "GET", headers = {} } = {}) {
      const lifetimePromises = [];
      let responsePromise;
      const event = {
        request: { url, mode, method, headers: new Headers(headers) },
        respondWith(value) {
          responsePromise = Promise.resolve(value);
        },
        waitUntil(value) {
          lifetimePromises.push(Promise.resolve(value));
        },
      };

      listeners.get("fetch")(event);
      assert.ok(responsePromise, `worker did not handle ${url}`);
      const response = await responsePromise;
      await Promise.all(lifetimePromises);
      return response;
    },
    async dispatchActivate() {
      const lifetimePromises = [];
      listeners.get("activate")({
        waitUntil(value) {
          lifetimePromises.push(Promise.resolve(value));
        },
      });
      await Promise.all(lifetimePromises);
    },
    async dispatchInstall() {
      const lifetimePromises = [];
      listeners.get("install")({
        waitUntil(value) {
          lifetimePromises.push(Promise.resolve(value));
        },
      });
      await Promise.all(lifetimePromises);
    },
    dispatchMessage(data) {
      let reply;
      listeners.get("message")({
        data,
        ports: [{ postMessage(value) { reply = value; } }],
      });
      return reply;
    },
  };
}

test("the v14 document and shell assets stay on one immutable release", async (t) => {
  const indexUrl = `${scope}index.html`;

  await t.test("app navigation uses its installed document without mixing in a deployment", async () => {
    const worker = createWorker(async () =>
      new Response("new deployment", { headers: { "content-type": "text/html" } }),
    );
    worker.seed(shellCache, indexUrl, "installed shell", { headers: { "content-type": "text/html" } });

    const response = await worker.dispatchFetch(scope, { mode: "navigate" });

    assert.equal(await response.text(), "installed shell");
    assert.equal(worker.fetchCalls.length, 0);
    assert.equal(worker.puts.length, 0);
  });

  await t.test("a missing or unavailable cache still allows online navigation", async () => {
    const worker = createWorker(async () =>
      new Response("network shell", { headers: { "content-type": "text/html" } }),
      { openFails: true },
    );

    const response = await worker.dispatchFetch(`${scope}index.html`, { mode: "navigate" });

    assert.equal(await response.text(), "network shell");
    assert.equal(worker.fetchCalls.length, 1);
  });

  await t.test("another path never receives the app fallback", async () => {
    const worker = createWorker(async () =>
      new Response("host 404", { status: 404, headers: { "content-type": "text/html" } }),
    );
    worker.seed(shellCache, indexUrl, "installed shell", { headers: { "content-type": "text/html" } });

    const response = await worker.dispatchFetch(`${scope}missing`, { mode: "navigate" });

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "host 404");
    assert.equal(worker.puts.length, 0);
  });
});

test("an offline hash view falls back to the cached single-page app", async () => {
  const worker = createWorker(async () => {
    throw new TypeError("offline");
  });
  worker.seed(shellCache, `${scope}index.html`, "offline quiz", {
    headers: { "content-type": "text/html" },
  });

  const response = await worker.dispatchFetch(`${scope}#quiz`, { mode: "navigate" });

  assert.equal(await response.text(), "offline quiz");
});

test("validated v13 dictionary data is served cache-first from its stable data cache", async () => {
  const dataUrl = `${scope}data/dictionary-core.json?v=13`;
  const worker = createWorker(async () => new Response('{"version":2}'));
  worker.seed(dataCache, dataUrl, '{"version":1,"validated":true}', {
    headers: { "content-type": "application/json" },
  });

  const response = await worker.dispatchFetch(dataUrl);
  assert.equal(await response.text(), '{"version":1,"validated":true}');
  assert.equal(await worker.cachedText(dataCache, dataUrl), '{"version":1,"validated":true}');
  assert.equal(worker.fetchCalls.length, 0);
});

test("uncached v13 dictionary data is not persisted before app validation", async () => {
  const dataUrl = `${scope}data/dictionary-details.json?v=13`;
  const worker = createWorker(async () => new Response('{"unvalidated":true}', {
    headers: { "content-type": "application/json" },
  }));

  const response = await worker.dispatchFetch(dataUrl);
  assert.equal(await response.text(), '{"unvalidated":true}');
  assert.equal(worker.cached(dataCache, dataUrl), undefined);
  assert.equal(worker.fetchCalls.length, 1);
});

test("install caches only the v14 app shell and never downloads dictionary payloads", async () => {
  const worker = createWorker(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
      return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
    }
    return new Response("asset", { headers: { "content-type": "application/octet-stream" } });
  });

  await worker.dispatchInstall();

  const rootCall = worker.fetchCalls.find(([request]) => new URL(request.url).pathname.endsWith("mandarin-taigi/"));
  assert.equal(rootCall[0].cache, "reload");
  assert.equal(
    worker.fetchCalls.some(([request]) => /\/data\/(?:dictionary-(?:core|details)|mandarin-audio)\.json/.test(request.url)),
    false,
  );
  assert.ok(worker.cached(shellCache, `${scope}app.js?v=14`));
  assert.ok(worker.cached(shellCache, `${scope}data-loader.js?v=14`));
});

test("audio is cached on demand and served cache-first", async () => {
  const audioUrl = `${scope}assets/audio/123.mp3`;
  const worker = createWorker(async () => new Response("network audio", { status: 200 }));

  const first = await worker.dispatchFetch(audioUrl);
  assert.equal(await first.text(), "network audio");
  assert.equal(await worker.cachedText(audioCache, audioUrl), "network audio");

  const second = await worker.dispatchFetch(audioUrl);
  assert.equal(await second.text(), "network audio");
  assert.equal(worker.fetchCalls.length, 1);
});

test("bulk audio bypasses runtime caching so the app is the only cache writer", async () => {
  const audioUrl = `${scope}assets/audio/123.mp3`;
  const worker = createWorker(async () => new Response("bulk audio", { status: 200 }));

  const response = await worker.dispatchFetch(audioUrl, {
    headers: { "x-mandarin-taigi-bulk-download": "1" },
  });

  assert.equal(await response.text(), "bulk audio");
  assert.equal(worker.puts.length, 0);
  assert.equal(worker.fetchCalls.length, 1);
});

test("a cached full audio file satisfies byte-range playback offline", async () => {
  const audioUrl = `${scope}assets/audio/range.mp3`;
  const worker = createWorker(async () => {
    throw new TypeError("offline");
  });
  worker.seed(audioCache, audioUrl, "0123456789", {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });

  const response = await worker.dispatchFetch(audioUrl, {
    headers: { range: "bytes=2-5" },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
  assert.equal(worker.fetchCalls.length, 0);
});

test("cached versioned shell assets are immutable for the worker lifetime", async () => {
  const appUrl = `${scope}app.js?v=14`;
  const worker = createWorker(async () => new Response("new app", { status: 200 }));
  worker.seed(shellCache, appUrl, "old app", { status: 200 });

  const response = await worker.dispatchFetch(appUrl);

  assert.equal(await response.text(), "old app");
  assert.equal(await worker.cachedText(shellCache, appUrl), "old app");
  assert.equal(worker.fetchCalls.length, 0);
});

test("runtime cache failures never hide successful network responses", async (t) => {
  for (const [label, options] of [
    ["CacheStorage open", { openFails: true }],
    ["cache put", { putFails: true }],
  ]) {
    await t.test(label, async () => {
      const worker = createWorker(
        async () => new Response("network audio", { headers: { "content-type": "audio/mpeg" } }),
        options,
      );
      const response = await worker.dispatchFetch(`${scope}assets/audio/runtime.mp3`);
      assert.equal(await response.text(), "network audio");
    });
  }
});

test("activation migrates all three legacy v13 payloads before deleting the old shell", async () => {
  const worker = createWorker(async () => new Response("unused"));
  const legacyPayloads = [
    ["dictionary-core.json", '{"core":true}'],
    ["dictionary-details.json", '{"details":true}'],
    ["mandarin-audio.json", '{"audio":true}'],
  ];
  for (const [file, body] of legacyPayloads) {
    worker.seed(legacyShellCache, `${scope}data/${file}?v=13`, body, {
      headers: { "content-type": "application/json" },
    });
  }
  worker.seed("mandarin-taigi-shell-v4", `${scope}old.js`, "old");
  worker.seed(shellCache, `${scope}app.js?v=14`, "current");
  worker.seed("mandarin-taigi-audio-v0", `${scope}assets/audio/old.mp3`, "old audio");
  worker.seed(audioCache, `${scope}assets/audio/current.mp3`, "current audio");
  worker.seed("another-app-cache", `${scope}other`, "other");

  await worker.dispatchActivate();

  for (const [file, body] of legacyPayloads) {
    assert.equal(await worker.cachedText(dataCache, `${scope}data/${file}?v=13`), body);
  }
  assert.deepEqual(
    [...worker.stores.keys()].sort(),
    ["another-app-cache", audioCache, dataCache, shellCache].sort(),
  );
  assert.equal(worker.clientsClaimed, true);
});

test("activation preserves the legacy shell if even one v13 payload cannot migrate", async () => {
  const failedKey = `${scope}data/dictionary-details.json?v=13`;
  const worker = createWorker(async () => new Response("unused"), {
    putFailure: ({ name, key }) => name === dataCache && key === failedKey,
  });
  for (const file of ["dictionary-core.json", "dictionary-details.json", "mandarin-audio.json"]) {
    worker.seed(legacyShellCache, `${scope}data/${file}?v=13`, `{\"file\":\"${file}\"}`, {
      headers: { "content-type": "application/json" },
    });
  }

  await worker.dispatchActivate();

  assert.equal(worker.stores.has(legacyShellCache), true);
  assert.equal(await worker.cachedText(legacyShellCache, failedKey), '{"file":"dictionary-details.json"}');
  assert.equal(worker.clientsClaimed, true);
});

test("worker reports its v14 shell and stable v13 data cache through the update handshake", () => {
  const worker = createWorker(async () => new Response("unused"));
  const reply = worker.dispatchMessage({ type: "GET_RELEASE" });
  assert.equal(reply.release, "14");
  assert.equal(reply.audioCache, audioCache);
  assert.equal(reply.dataCache, dataCache);
  assert.equal(worker.dispatchMessage({ type: "UNKNOWN" }), undefined);
});

test("all v14 modules, including the local-first loader, are part of the install shell", () => {
  for (const module of ["app", "search", "speech", "quiz", "learning", "offline", "dictionary-data", "data-loader"]) {
    assert.match(workerSource, new RegExp(`"\\.\\/${module}\\.js\\?v=14"`), module);
  }
});

test("worker recognizes the unchanged v13 data URLs but never precaches them in the shell", () => {
  const shellList = workerSource.match(/const SHELL_FILES = \[([\s\S]*?)\];/)?.[1] || "";
  const runtimeList = workerSource.match(/const RUNTIME_DATA_FILES = \[([\s\S]*?)\];/)?.[1] || "";
  assert.equal(shellList.includes("dictionary-core.json"), false);
  assert.equal(shellList.includes("dictionary-details.json"), false);
  assert.equal(shellList.includes("mandarin-audio.json"), false);
  assert.ok(runtimeList.includes("dictionary-core.json?v=13"));
  assert.ok(runtimeList.includes("dictionary-details.json?v=13"));
  assert.ok(runtimeList.includes("mandarin-audio.json?v=13"));
  assert.match(workerSource, /const DATA_CACHE = "mandarin-taigi-data-v13"/);
  assert.match(workerSource, /const LEGACY_DATA_CACHE = "mandarin-taigi-shell-v13"/);
});
