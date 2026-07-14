const CACHE_PREFIX = "mandarin-taigi-";
const RELEASE_REVISION = "8";
// Bump this cache name and every ?v= release URL together.
const SHELL_CACHE = "mandarin-taigi-shell-v8";
// Keep this in sync with app.js and include both official audio source versions.
const AUDIO_CACHE = "mandarin-taigi-audio-20260713-2014_20260626";
const BULK_DOWNLOAD_HEADER = "x-mandarin-taigi-bulk-download";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=8",
  "./app.js?v=8",
  "./search.js?v=8",
  "./speech.js?v=8",
  "./quiz.js?v=8",
  "./learning.js?v=8",
  "./offline.js?v=8",
  "./manifest.webmanifest?v=8",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./data/dictionary.json?v=8",
  "./data/mandarin-audio.json?v=8",
];

const SCOPE_URL = new URL(self.registration.scope);
const ROOT_URL = SCOPE_URL.href;
const INDEX_URL = new URL("index.html", SCOPE_URL).href;
const SHELL_URLS = new Set(
  SHELL_FILES.map((path) => urlWithoutSearchOrHash(new URL(path, SCOPE_URL))),
);

function urlWithoutSearchOrHash(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
}

function isAppDocumentUrl(url) {
  const cleanUrl = urlWithoutSearchOrHash(url);
  return cleanUrl === ROOT_URL || cleanUrl === INDEX_URL;
}

function isHtmlResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().split(";", 1)[0].trim() === "text/html";
}

function isCacheableResponse(response) {
  // Cache.put rejects partial (206) responses.
  return response.ok && response.status !== 206;
}

function isCacheableShellResponse(url, response) {
  if (!isCacheableResponse(response)) return false;
  return !isAppDocumentUrl(url) || isHtmlResponse(response);
}

function isDataRequest(url) {
  return url.pathname.startsWith(new URL("data/", SCOPE_URL).pathname) && url.pathname.endsWith(".json");
}

function isAudioRequest(url) {
  const taigiAudioPath = new URL("assets/audio/", SCOPE_URL).pathname;
  const mandarinAudioPath = new URL("assets/mandarin-audio/", SCOPE_URL).pathname;
  return url.pathname.startsWith(taigiAudioPath) || url.pathname.startsWith(mandarinAudioPath);
}

function isShellRequest(url) {
  return SHELL_URLS.has(urlWithoutSearchOrHash(url));
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);

  await Promise.all(
    SHELL_FILES.map(async (path) => {
      const url = new URL(path, SCOPE_URL);
      const request = new Request(url, { cache: "reload" });
      const response = await fetch(request);

      if (!isCacheableShellResponse(url, response)) {
        throw new Error(`Refusing to precache invalid response for ${url.href}`);
      }

      await cache.put(request, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  // Keep an update waiting until older tabs close. This prevents a newly claimed
  // worker from pairing its cache with JavaScript that is already running.
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== AUDIO_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "GET_RELEASE") return;
  event.ports?.[0]?.postMessage({ release: RELEASE_REVISION, audioCache: AUDIO_CACHE });
});

async function matchBestEffort(cacheName, request) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function putBestEffort(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Runtime caching must never turn a valid network response into an error.
  }
}

function keepAlive(event, promise) {
  event.waitUntil(Promise.resolve(promise).catch(() => {}));
}

async function handleNavigation(request, url) {
  if (!isAppDocumentUrl(url)) return fetch(request);

  // Each worker serves the document and modules from one immutable shell version.
  // Versioned module URLs let the previous production worker safely load this
  // release's HTML while an older installed version is still controlling a tab.
  const cached =
    (await matchBestEffort(SHELL_CACHE, INDEX_URL)) ||
    (await matchBestEffort(SHELL_CACHE, ROOT_URL));
  return cached || fetch(request, { cache: "no-cache" });
}

async function networkFirstData(event, request) {

  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (isCacheableResponse(response)) {
      keepAlive(event, putBestEffort(SHELL_CACHE, request, response.clone()));
    }
    return response;
  } catch (error) {
    const cached = await matchBestEffort(SHELL_CACHE, request);
    if (cached) return cached;
    throw error;
  }
}

async function rangedResponse(request, response) {
  const range = request.headers?.get?.("range");
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return response;

  const bytes = await response.arrayBuffer();
  const length = bytes.byteLength;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) {
    start = Math.max(0, length - end);
    end = length - 1;
  } else {
    start ??= 0;
    end = end === null ? length - 1 : Math.min(end, length - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= length) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${length}` },
    });
  }

  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  headers.set("content-range", `bytes ${start}-${end}/${length}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

async function cacheFirstAudio(event, request) {
  const cached = await matchBestEffort(AUDIO_CACHE, request.url);
  if (cached) return rangedResponse(request, cached);

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    keepAlive(event, putBestEffort(AUDIO_CACHE, request.url, response.clone()));
  } else if (response.status === 206) {
    // Do not block first playback on a second, full-file request. Keep that cache
    // fill in the fetch-event lifetime and return the requested range immediately.
    keepAlive(
      event,
      (async () => {
        try {
          const fullResponse = await fetch(new Request(request.url, { cache: "no-cache" }));
          if (isCacheableResponse(fullResponse)) {
            await putBestEffort(AUDIO_CACHE, request.url, fullResponse);
          }
        } catch {
          // The range response remains usable online if the background fill fails.
        }
      })(),
    );
  }
  return response;
}

async function cacheFirstShell(request) {
  const cached = await matchBestEffort(SHELL_CACHE, request);
  return cached || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin) return;

  if (isAudioRequest(url)) {
    // app.js writes bulk downloads to this cache itself so it can report quota,
    // cancellation, and retry status without writing every response twice.
    if (request.headers.get(BULK_DOWNLOAD_HEADER) === "1") {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith(cacheFirstAudio(event, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (isShellRequest(url)) {
    event.respondWith(cacheFirstShell(request));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(networkFirstData(event, request));
  }
});
