import {
  createSearchIndex,
  groupComparisons,
  pickSuggestionTerms,
  searchTermsDetailed,
} from "./search.js?v=6";
import { selectMandarinVoice, waitForMandarinVoice } from "./speech.js?v=6";
import { initializeLearning } from "./learning.js?v=6";

const RELEASE_REVISION = "6";
const DATA_URL = "./data/dictionary.json?v=6";
const DATA_BASE_URL = new URL(DATA_URL, window.location.href);
const MANDARIN_AUDIO_URL = "./data/mandarin-audio.json?v=6";
const MANDARIN_AUDIO_BASE_URL = new URL(MANDARIN_AUDIO_URL, window.location.href);
const AUDIO_CACHE = "mandarin-taigi-audio-20260713-2014_20260626";
const OFFICIAL_ENTRY_URL = "https://sutian.moe.edu.tw/zh-hant/su/";
const AUDIO_PACKS = {
  taigi: { sizeMb: 16, label: "台語遊戲語音" },
  mandarin: { sizeMb: 39, label: "華語單字朗讀" },
};

const elements = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#query"),
  accent: document.querySelector("#accent"),
  submit: document.querySelector("#search-submit"),
  status: document.querySelector("#search-status"),
  results: document.querySelector("#results"),
  suggestions: document.querySelector("#suggestions"),
  suggestionList: document.querySelector("#suggestion-list"),
  shuffleSuggestions: document.querySelector("#shuffle-suggestions"),
  termCount: document.querySelector("#term-count"),
  comparisonCount: document.querySelector("#comparison-count"),
  audioCount: document.querySelector("#audio-count"),
  mandarinAudioCount: document.querySelector("#mandarin-audio-count"),
  sourceDate: document.querySelector("#source-date"),
  downloadTaigiAudio: document.querySelector("#download-taigi-audio"),
  downloadMandarinAudio: document.querySelector("#download-mandarin-audio"),
  cancelAudioDownload: document.querySelector("#cancel-audio-download"),
  clearOfflineAudio: document.querySelector("#clear-offline-audio"),
  offlineStatus: document.querySelector("#offline-status"),
  installApp: document.querySelector("#install-app"),
  audioDock: document.querySelector("#audio-dock"),
  audioTitle: document.querySelector("#audio-title"),
  audioSource: document.querySelector("#audio-source"),
  audio: document.querySelector("#audio-player"),
  stopAudio: document.querySelector("#stop-audio"),
};

const state = {
  dictionary: null,
  index: [],
  mandarinAudioEntries: {},
  taigiAudioUrls: [],
  mandarinAudioUrls: [],
  activeQuery: "",
  mandarinVoice: null,
  mandarinSpeechState: "checking",
  mandarinSpeechRequest: 0,
  audioDownload: null,
  deferredInstallPrompt: null,
  learning: null,
  appReady: false,
  serviceWorkerCompatibility: navigator.serviceWorker?.controller ? "checking" : "none",
};

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function makeElement(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) node.setAttribute(name, value);
  }
  return node;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
}

function sourceEntryLink(termId) {
  return `${OFFICIAL_ENTRY_URL}${encodeURIComponent(termId)}/`;
}

function resolveAudioUrl(audioPath) {
  return new URL(audioPath, DATA_BASE_URL).href;
}

function resolveMandarinAudioUrl(audioPath) {
  return new URL(audioPath, MANDARIN_AUDIO_BASE_URL).href;
}

function updateMandarinSpeechButton(button) {
  if (state.mandarinSpeechState === "ready") {
    button.textContent = "聽華語（本機）";
    button.disabled = false;
    button.dataset.speechState = "ready";
    button.title = "使用這台裝置提供的本機華語聲音";
  } else if (state.mandarinSpeechState === "checking") {
    button.textContent = "檢查華語聲音…";
    button.disabled = true;
    button.dataset.speechState = "checking";
    button.title = "正在檢查這台裝置是否提供本機華語聲音";
  } else {
    button.textContent = "此裝置無華語聲音";
    button.disabled = true;
    button.dataset.speechState = "unavailable";
    button.title = "這個詞沒有教育部詞目朗讀，且這台裝置沒有提供可用的華語聲音";
  }
}

function updateMandarinSpeechButtons() {
  for (const button of document.querySelectorAll("button[data-mandarin-speech]")) {
    updateMandarinSpeechButton(button);
  }
}

function setMandarinVoice(voice) {
  state.mandarinVoice = voice;
  state.mandarinSpeechState = voice ? "ready" : "unavailable";
  updateMandarinSpeechButtons();
}

async function initializeMandarinSpeech() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setMandarinVoice(null);
    return;
  }

  const synthesis = window.speechSynthesis;
  setMandarinVoice(await waitForMandarinVoice(synthesis));
  if (typeof synthesis.addEventListener === "function") {
    synthesis.addEventListener("voiceschanged", () => setMandarinVoice(selectMandarinVoice(synthesis.getVoices())));
  }
}

function speakMandarin(text) {
  const synthesis = window.speechSynthesis;
  const voice = selectMandarinVoice(synthesis?.getVoices?.() || []) || state.mandarinVoice;
  if (!synthesis || !voice || typeof SpeechSynthesisUtterance === "undefined") {
    setMandarinVoice(null);
    setStatus("這個詞沒有教育部詞目朗讀，而且這台裝置也沒有可用的華語聲音。", "error");
    return;
  }

  const request = ++state.mandarinSpeechRequest;
  synthesis.cancel();
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();
  elements.audio.hidden = true;
  elements.audioTitle.textContent = `${text}（華語）`;
  elements.audioSource.textContent = "這台裝置提供的本機華語聲音";
  elements.audioDock.hidden = false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang || "zh-TW";

  let started = false;
  const startTimeout = window.setTimeout(() => {
    if (request !== state.mandarinSpeechRequest || started) return;
    synthesis.cancel();
    elements.audioDock.hidden = true;
    setStatus("華語聲音沒有開始播放；請確認 Chrome 或作業系統已安裝華語語音。", "error");
  }, 4000);

  utterance.onstart = () => {
    if (request !== state.mandarinSpeechRequest) return;
    started = true;
    window.clearTimeout(startTimeout);
    setStatus(`正在用裝置聲音朗讀華語「${text}」。`, "success");
  };
  utterance.onend = () => {
    if (request !== state.mandarinSpeechRequest) return;
    window.clearTimeout(startTimeout);
    elements.audioDock.hidden = true;
    setStatus(`華語「${text}」播放完畢。`, "success");
  };
  utterance.onerror = (event) => {
    if (request !== state.mandarinSpeechRequest) return;
    window.clearTimeout(startTimeout);
    elements.audioDock.hidden = true;
    setStatus(`華語聲音無法播放（${event.error || "裝置語音錯誤"}）。`, "error");
  };

  synthesis.speak(utterance);
}

async function playOfficialMandarin(term, entry) {
  state.mandarinSpeechRequest += 1;
  window.speechSynthesis?.cancel();
  const pronunciation = [entry.bopomofo, entry.pinyin].filter(Boolean).join("・");
  elements.audioTitle.textContent = pronunciation ? `${term.mandarin}（${pronunciation}）` : term.mandarin;
  elements.audioSource.textContent = "教育部《國語辭典簡編本》單字屬性朗讀";
  elements.audio.hidden = false;
  elements.audio.src = resolveMandarinAudioUrl(entry.audio);
  elements.audioDock.hidden = false;
  try {
    await elements.audio.play();
    setStatus(`正在播放教育部華語單字「${term.mandarin}」的官方發音。`, "success");
  } catch {
    setStatus("華語官方音檔目前無法播放，請稍後重試。", "error");
  }
}

async function playTaigi(term, comparison) {
  if (!comparison.audio) return;
  state.mandarinSpeechRequest += 1;
  window.speechSynthesis?.cancel();
  const audioUrl = resolveAudioUrl(comparison.audio);
  elements.audioTitle.textContent = `${term.mandarin} → ${comparison.hanji}（${comparison.romanization}）`;
  elements.audioSource.textContent = "教育部《臺灣台語常用詞辭典》詞條音檔";
  elements.audio.hidden = false;
  elements.audio.src = audioUrl;
  elements.audioDock.hidden = false;
  try {
    await elements.audio.play();
    setStatus("正在播放教育部臺灣台語詞條音檔。", "success");
  } catch {
    setStatus("音檔目前無法播放，請稍後重試。", "error");
  }
}

async function playQuizAudio(candidate, { reveal = false } = {}) {
  if (!candidate?.audio) return false;
  state.mandarinSpeechRequest += 1;
  window.speechSynthesis?.cancel();
  elements.audio.pause();
  elements.audioTitle.textContent = reveal
    ? `${candidate.hanji}（${candidate.romanization}）`
    : "台語詞語挑戰";
  elements.audioSource.textContent = "教育部《臺灣台語常用詞辭典》詞條音檔";
  elements.audio.hidden = false;
  elements.audio.src = resolveAudioUrl(candidate.audio);
  elements.audioDock.hidden = false;
  try {
    await elements.audio.play();
    return true;
  } catch {
    return false;
  }
}

function comparisonKey(comparison) {
  return [comparison.hanji, comparison.romanization, comparison.audio || ""].join("\u0000");
}

function renderComparison(term, comparison, { matched = false } = {}) {
  const row = makeElement("article", {
    className: matched ? "comparison comparison--matched" : "comparison",
  });
  const words = makeElement("div", { className: "comparison__words" });
  words.append(
    makeElement("strong", { className: "comparison__hanji", text: comparison.hanji }),
    makeElement("span", {
      className: "comparison__tailo",
      text: comparison.romanization,
      attributes: { lang: "nan-Latn" },
    }),
  );
  if (matched) {
    words.prepend(makeElement("span", { className: "match-badge", text: "符合查詢" }));
  }

  const accents = makeElement("ul", {
    className: "accent-list",
    attributes: { "aria-label": "收錄腔口" },
  });
  for (const accent of comparison.accents) {
    const item = makeElement("li", { className: "accent-tag", text: accent });
    accents.append(item);
  }

  const actions = makeElement("div", { className: "comparison__actions" });
  if (comparison.audio) {
    const play = makeElement("button", {
      className: "button button--audio",
      text: "聽台語",
      attributes: { type: "button", "aria-label": `聽台語「${comparison.hanji}」的官方發音` },
    });
    play.addEventListener("click", () => playTaigi(term, comparison));
    actions.append(play);
  } else {
    actions.append(makeElement("span", { className: "audio-unavailable", text: "此筆無精確配對音檔" }));
  }

  if (comparison.term_id) {
    const source = makeElement("a", {
      className: "source-link",
      text: "教育部原詞條 ↗",
      attributes: {
        href: sourceEntryLink(comparison.term_id),
        target: "_blank",
        rel: "noreferrer",
      },
    });
    actions.append(source);
  }

  row.append(words, accents, actions);
  return row;
}

function renderTerm(term, accent, match = { mandarin: false, comparisons: [] }) {
  const card = makeElement("article", { className: "result-card" });
  const header = makeElement("header", { className: "result-card__header" });
  const titleGroup = makeElement("div");
  titleGroup.append(
    makeElement("span", { className: "eyebrow", text: "華語詞目" }),
    makeElement("h2", { className: "result-card__title", text: term.mandarin }),
  );
  const officialMandarin = state.mandarinAudioEntries[term.mandarin];
  const speak = makeElement("button", { className: "button button--secondary" });
  const speechNote = makeElement("p", { className: "result-card__speech-note" });
  if (officialMandarin) {
    speak.textContent = "聽華語（教育部）";
    speak.setAttribute("type", "button");
    speak.setAttribute("aria-label", `聽華語「${term.mandarin}」的教育部官方單字屬性朗讀`);
    speak.addEventListener("click", () => playOfficialMandarin(term, officialMandarin));
    speechNote.textContent = `教育部官方單字屬性朗讀：${[officialMandarin.bopomofo, officialMandarin.pinyin]
      .filter(Boolean)
      .join("・")}`;
  } else {
    speak.textContent = "檢查華語聲音…";
    speak.setAttribute("type", "button");
    speak.setAttribute("data-mandarin-speech", "device");
    speak.setAttribute("aria-label", `聽華語「${term.mandarin}」（使用本機裝置聲音）`);
    speak.addEventListener("click", () => speakMandarin(term.mandarin));
    speechNote.textContent = "本站僅使用教育部單字屬性朗讀；多字詞只使用裝置內建的本機語音。";
    updateMandarinSpeechButton(speak);
  }
  titleGroup.append(speechNote);
  header.append(titleGroup, speak);

  const comparisonList = makeElement("div", { className: "comparison-list" });
  const matchedKeys = new Set((match.comparisons || []).map(({ comparison }) => comparisonKey(comparison)));
  const groups = groupComparisons(term.comparisons, accent).sort(
    (left, right) => Number(matchedKeys.has(comparisonKey(right))) - Number(matchedKeys.has(comparisonKey(left))),
  );
  for (const comparison of groups) {
    comparisonList.append(
      renderComparison(term, comparison, { matched: matchedKeys.has(comparisonKey(comparison)) }),
    );
  }

  card.append(header, comparisonList);
  return card;
}

function updateSearchLocation(query = "", accent = "") {
  const url = new URL(window.location.href);
  // Search state lives in the fragment so queries are not sent to the static host.
  url.searchParams.delete("q");
  url.searchParams.delete("accent");
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (accent) params.set("accent", accent);
  url.hash = params.size ? `dictionary?${params}` : "dictionary";
  history.replaceState(null, "", url);
}

function runSearch(query, { updateUrl = true, limit = 40 } = {}) {
  if (!state.dictionary) return;
  const cleanQuery = query.trim();
  state.activeQuery = cleanQuery;
  elements.results.replaceChildren();

  if (!cleanQuery) {
    setStatus("輸入一個華語、台語漢字或臺羅詞語開始查詢。", "");
    if (updateUrl) updateSearchLocation();
    return;
  }

  const accent = elements.accent.value;
  const search = searchTermsDetailed(state.index, cleanQuery, { accent, limit });
  if (search.results.length === 0) {
    const empty = makeElement("div", { className: "empty-state" });
    empty.append(
      makeElement("h2", { text: "目前找不到直接對照" }),
      makeElement("p", {
        text: "這個版本只呈現教育部已收錄的華台詞彙比較，不會用 AI 猜答案。可換短一點的詞再試。",
      }),
    );
    elements.results.append(empty);
    setStatus(`找不到「${cleanQuery}」的直接對照。`, "error");
  } else {
    const fragment = document.createDocumentFragment();
    for (const result of search.results) fragment.append(renderTerm(result.term, accent, result.match));
    elements.results.append(fragment);
    if (search.truncated) {
      const more = makeElement("button", {
        className: "button button--secondary results__more",
        text: `顯示更多（共 ${formatNumber(search.total)} 個）`,
        attributes: { type: "button" },
      });
      more.addEventListener("click", () => runSearch(cleanQuery, { updateUrl: false, limit: limit + 40 }));
      elements.results.append(more);
      setStatus(
        `共找到 ${formatNumber(search.total)} 個華語詞目，先顯示前 ${formatNumber(search.results.length)} 個。`,
        "success",
      );
    } else {
      setStatus(`找到 ${formatNumber(search.total)} 個華語詞目。`, "success");
    }
  }

  if (updateUrl) {
    updateSearchLocation(cleanQuery, accent);
  }
}

function applyDictionaryLocation({ allowLegacy = false } = {}) {
  if (!state.dictionary) return;
  const rawHash = window.location.hash.slice(1);
  const [route, hashQuery = ""] = rawHash.split("?", 2);
  if (rawHash && route !== "dictionary") return;

  const hashParams = route === "dictionary" ? new URLSearchParams(hashQuery) : new URLSearchParams();
  const legacyParams = allowLegacy ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const usesHashParams = hashParams.has("q") || hashParams.has("accent");
  const params = usesHashParams ? hashParams : legacyParams;
  const requestedAccent = params.get("accent") || "";
  elements.accent.value = [...elements.accent.options].some((option) => option.value === requestedAccent)
    ? requestedAccent
    : "";
  const requestedQuery = params.get("q")?.trim() || "";
  elements.input.value = requestedQuery;
  if (requestedQuery) {
    runSearch(requestedQuery, { updateUrl: allowLegacy && !usesHashParams });
  } else if (state.activeQuery) {
    runSearch("", { updateUrl: false });
  }
}

function populateAccents(terms) {
  const accents = new Set();
  for (const term of terms) {
    for (const comparison of term.comparisons || []) {
      if (comparison.accent) accents.add(comparison.accent);
    }
  }
  for (const accent of [...accents].sort((a, b) => a.localeCompare(b, "zh-Hant-TW"))) {
    elements.accent.append(makeElement("option", { text: accent, attributes: { value: accent } }));
  }
}

function collectAudioUrls(terms) {
  return [
    ...new Set(
      terms.flatMap((term) => (term.comparisons || []).map((comparison) => comparison.audio).filter(Boolean)),
    ),
  ];
}

function renderSuggestions() {
  const suggestions = pickSuggestionTerms(state.dictionary?.terms || [], 4);
  const fragment = document.createDocumentFragment();
  for (const term of suggestions) {
    fragment.append(
      makeElement("button", {
        text: term.mandarin,
        attributes: { type: "button", "data-query": term.mandarin },
      }),
    );
  }
  elements.suggestionList.replaceChildren(fragment);
  elements.shuffleSuggestions.disabled = suggestions.length === 0;
}

function audioPackUrls(kind) {
  return kind === "taigi" ? state.taigiAudioUrls : state.mandarinAudioUrls;
}

function serviceWorkerBlocksAudioDownload() {
  return ["checking", "outdated"].includes(state.serviceWorkerCompatibility);
}

function serviceWorkerStatusMessage() {
  if (state.serviceWorkerCompatibility === "checking") return "正在確認離線版本，請稍候…";
  if (state.serviceWorkerCompatibility === "outdated") {
    return "網站已更新。請關閉所有本站分頁後重新開啟，再下載離線語音包。";
  }
  return "";
}

function queryControllerRelease(controller, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => finish(event.data);
    try {
      controller.postMessage({ type: "GET_RELEASE" }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function detectServiceWorkerCompatibility() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) {
    state.serviceWorkerCompatibility = "none";
  } else {
    state.serviceWorkerCompatibility = "checking";
    setAudioDownloadControls(Boolean(state.audioDownload));
    const reply = await queryControllerRelease(controller);
    if (controller !== navigator.serviceWorker?.controller) return;
    state.serviceWorkerCompatibility =
      reply?.release === RELEASE_REVISION && reply?.audioCache === AUDIO_CACHE ? "current" : "outdated";
  }
  setAudioDownloadControls(Boolean(state.audioDownload));
  updateOfflineAudioState();
}

function setAudioDownloadControls(running) {
  const waitingForUpdate = serviceWorkerBlocksAudioDownload();
  elements.downloadTaigiAudio.disabled = running || waitingForUpdate || state.taigiAudioUrls.length === 0;
  elements.downloadMandarinAudio.disabled = running || waitingForUpdate || state.mandarinAudioUrls.length === 0;
  elements.clearOfflineAudio.disabled = running || waitingForUpdate;
  elements.cancelAudioDownload.hidden = !running;
}

async function updateOfflineAudioState(message = "") {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cachedUrls = new Set((await cache.keys()).map((request) => request.url));
    const taigiCount = state.taigiAudioUrls.filter((url) => cachedUrls.has(url)).length;
    const mandarinCount = state.mandarinAudioUrls.filter((url) => cachedUrls.has(url)).length;
    elements.clearOfflineAudio.hidden = taigiCount + mandarinCount === 0;
    elements.downloadTaigiAudio.textContent =
      taigiCount === state.taigiAudioUrls.length && taigiCount > 0
        ? `台語遊戲語音已下載（${formatNumber(taigiCount)} 個）`
        : `下載台語遊戲語音包（約 ${AUDIO_PACKS.taigi.sizeMb} MB）`;
    elements.downloadMandarinAudio.textContent =
      mandarinCount === state.mandarinAudioUrls.length && mandarinCount > 0
        ? `華語單字朗讀已下載（${formatNumber(mandarinCount)} 個）`
        : `下載華語單字朗讀（約 ${AUDIO_PACKS.mandarin.sizeMb} MB）`;
    const workerMessage = serviceWorkerStatusMessage();
    if (workerMessage) {
      elements.offlineStatus.textContent = workerMessage;
    } else if (message) {
      elements.offlineStatus.textContent = message;
    } else if (taigiCount + mandarinCount > 0) {
      elements.offlineStatus.textContent = `已離線：${formatNumber(taigiCount)} 個台語、${formatNumber(
        mandarinCount,
      )} 個華語官方發音。`;
    } else {
      elements.offlineStatus.textContent = "詞庫文字會自動離線；教育部官方音檔需另行下載。";
    }
  } catch {
    const workerMessage = serviceWorkerStatusMessage();
    if (workerMessage) elements.offlineStatus.textContent = workerMessage;
    else if (message) elements.offlineStatus.textContent = message;
  }
}

async function downloadOfflineAudio(kind) {
  if (!("caches" in window)) {
    elements.offlineStatus.textContent = "這個瀏覽器不支援離線音檔儲存。";
    return;
  }
  if (state.audioDownload) return;
  if (serviceWorkerBlocksAudioDownload()) {
    elements.offlineStatus.textContent = serviceWorkerStatusMessage();
    return;
  }
  const pack = AUDIO_PACKS[kind];
  const urls = audioPackUrls(kind);
  if (urls.length === 0) {
    elements.offlineStatus.textContent = "音檔索引尚未準備完成，請稍後再試。";
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  const task = { cancelled: false, outOfSpace: false, controllers: new Set() };
  state.audioDownload = task;
  setAudioDownloadControls(true);
  let completed = 0;
  let failed = 0;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cachedUrls = new Set((await cache.keys()).map((request) => request.url));

    async function cacheOne(url) {
      const controller = new AbortController();
      task.controllers.add(controller);
      try {
        if (!cachedUrls.has(url) && !task.cancelled) {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error(String(response.status));
          await cache.put(url, response);
          cachedUrls.add(url);
        }
      } catch (error) {
        if (error.name === "QuotaExceededError") {
          task.outOfSpace = true;
          task.cancelled = true;
          failed += 1;
          for (const activeController of task.controllers) activeController.abort();
        } else if (error.name !== "AbortError") {
          failed += 1;
        }
      } finally {
        task.controllers.delete(controller);
        completed += 1;
        elements.offlineStatus.textContent = task.cancelled
          ? `正在取消${pack.label}下載…`
          : `正在儲存${pack.label}：${formatNumber(completed)} / ${formatNumber(urls.length)}`;
      }
    }

    for (let index = 0; index < urls.length && !task.cancelled; index += 6) {
      await Promise.all(urls.slice(index, index + 6).map(cacheOne));
    }

    const finalMessage = task.outOfSpace
      ? `儲存空間不足，${pack.label}下載已停止；已完成的檔案仍可離線使用。`
      : task.cancelled
      ? "已取消下載；已完成的檔案仍可離線使用。"
      : failed
        ? `已儲存 ${formatNumber(urls.length - failed)} 個${pack.label}，${formatNumber(failed)} 個失敗；可再按一次重試。`
        : `完成：${formatNumber(urls.length)} 個${pack.label}已可離線使用。`;
    await updateOfflineAudioState(finalMessage);
  } catch {
    elements.offlineStatus.textContent = `${pack.label}無法儲存，請確認瀏覽器空間後再試。`;
  } finally {
    state.audioDownload = null;
    setAudioDownloadControls(false);
  }
}

async function loadDictionary() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dictionary = await response.json();
    if (!Array.isArray(dictionary.terms)) throw new Error("詞庫格式不正確");

    let mandarinAudioEntries = {};
    let mandarinAudioWarning = "";
    try {
      const mandarinAudioResponse = await fetch(MANDARIN_AUDIO_URL);
      if (!mandarinAudioResponse.ok) throw new Error(`HTTP ${mandarinAudioResponse.status}`);
      const mandarinAudio = await mandarinAudioResponse.json();
      if (!mandarinAudio.entries || typeof mandarinAudio.entries !== "object") {
        throw new Error("格式不正確");
      }
      mandarinAudioEntries = mandarinAudio.entries;
    } catch {
      mandarinAudioWarning = "華語官方單字音檔暫時無法載入；查詞與台語發音仍可使用。";
    }

    state.dictionary = dictionary;
    state.mandarinAudioEntries = mandarinAudioEntries;
    state.index = createSearchIndex(dictionary.terms);
    state.taigiAudioUrls = collectAudioUrls(dictionary.terms).map(resolveAudioUrl);
    state.mandarinAudioUrls = Object.values(mandarinAudioEntries)
      .map((entry) => entry.audio)
      .filter(Boolean)
      .map(resolveMandarinAudioUrl);
    populateAccents(dictionary.terms);
    renderSuggestions();

    const metadata = dictionary.metadata || {};
    elements.termCount.textContent = formatNumber(metadata.term_count ?? dictionary.terms.length);
    elements.comparisonCount.textContent = formatNumber(
      metadata.comparison_count ?? dictionary.terms.reduce((sum, term) => sum + term.comparisons.length, 0),
    );
    elements.audioCount.textContent = formatNumber(metadata.audio_file_count ?? state.taigiAudioUrls.length);
    elements.mandarinAudioCount.textContent = formatNumber(state.mandarinAudioUrls.length);
    elements.sourceDate.textContent = metadata.source_updated || metadata.generated_at || "依官方下載資料";
    setAudioDownloadControls(false);
    updateOfflineAudioState();
    elements.input.disabled = false;
    elements.accent.disabled = false;
    elements.submit.disabled = false;
    setStatus(mandarinAudioWarning || "詞庫準備完成。輸入詞語就可以查。", mandarinAudioWarning ? "" : "success");

    state.learning = initializeLearning({
      dictionary,
      playAudio: playQuizAudio,
      sourceEntryLink,
    });
    state.appReady = true;
    if (!isStandalone()) elements.installApp.hidden = false;

    applyDictionaryLocation({ allowLegacy: true });
  } catch (error) {
    setStatus(`詞庫載入失敗：${error.message}。請重新整理頁面。`, "error");
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(elements.input.value);
  if (window.matchMedia("(max-width: 700px)").matches && elements.input.value.trim()) {
    window.requestAnimationFrame(() => elements.results.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
});

elements.input.addEventListener("input", () => {
  if (!elements.input.value.trim() && state.activeQuery) runSearch("");
});

elements.accent.addEventListener("change", () => {
  if (state.activeQuery) runSearch(state.activeQuery);
});

window.addEventListener("hashchange", () => applyDictionaryLocation());

elements.suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-query]");
  if (!button) return;
  elements.input.value = button.dataset.query;
  runSearch(button.dataset.query);
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.shuffleSuggestions.addEventListener("click", renderSuggestions);

elements.downloadTaigiAudio.addEventListener("click", () => downloadOfflineAudio("taigi"));
elements.downloadMandarinAudio.addEventListener("click", () => downloadOfflineAudio("mandarin"));
elements.cancelAudioDownload.addEventListener("click", () => {
  if (!state.audioDownload) return;
  state.audioDownload.cancelled = true;
  for (const controller of state.audioDownload.controllers) controller.abort();
});
elements.clearOfflineAudio.addEventListener("click", async () => {
  if (!("caches" in window)) return;
  if (state.audioDownload || serviceWorkerBlocksAudioDownload()) return;
  if (!window.confirm("清除已下載與播放過的離線語音？詞庫與學習紀錄會保留。")) return;
  try {
    await caches.delete(AUDIO_CACHE);
    await updateOfflineAudioState("離線語音已清除；詞庫與學習紀錄仍保留。");
  } catch {
    elements.offlineStatus.textContent = "離線語音目前無法清除，請稍後再試。";
  }
});
elements.stopAudio.addEventListener("click", () => {
  state.mandarinSpeechRequest += 1;
  window.speechSynthesis?.cancel();
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();
  elements.audio.hidden = false;
  elements.audioDock.hidden = true;
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function showInstallInstructions() {
  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
  elements.offlineStatus.textContent = isAppleMobile
    ? "iPhone／iPad：用 Safari 的分享按鈕，選擇「加入主畫面」。"
    : "請開啟瀏覽器選單，選擇「安裝應用程式」或「加到主畫面」。";
  const scrollToInstructions = () => {
    window.requestAnimationFrame(() =>
      document.querySelector(".offline-card")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      }),
    );
  };
  if (!window.location.hash.startsWith("#dictionary")) {
    window.addEventListener("hashchange", scrollToInstructions, { once: true });
    window.location.hash = "#dictionary";
  } else {
    scrollToInstructions();
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  if (state.appReady) elements.installApp.hidden = false;
  elements.installApp.textContent = "安裝 App";
});
window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  elements.installApp.hidden = true;
  elements.offlineStatus.textContent = "App 已安裝；下載台語遊戲語音包後即可完整離線挑戰。";
});
elements.installApp.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) {
    showInstallInstructions();
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice.catch(() => ({}));
  state.deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", detectServiceWorkerCompatibility);
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
      await detectServiceWorkerCompatibility();
    } catch {
      elements.offlineStatus.textContent = "離線功能目前無法啟用；查詞仍可使用。";
    }
  });
}

loadDictionary();
initializeMandarinSpeech();
