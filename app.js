import {
  commonMatchesComparison,
  createSearchIndex,
  groupComparisons,
  pickSuggestionTerms,
  searchTermsDetailed,
} from "./search.js?v=11";
import { selectMandarinVoice, waitForMandarinVoice } from "./speech.js?v=11";
import { initializeLearning } from "./learning.js?v=11";
import { canDownloadOfflineAudio, classifyServiceWorkerReply } from "./offline.js?v=11";

const RELEASE_REVISION = "11";
const DATA_URL = "./data/dictionary.json?v=11";
const DATA_BASE_URL = new URL(DATA_URL, window.location.href);
const MANDARIN_AUDIO_URL = "./data/mandarin-audio.json?v=11";
const MANDARIN_AUDIO_BASE_URL = new URL(MANDARIN_AUDIO_URL, window.location.href);
const AUDIO_CACHE = "mandarin-taigi-audio-20260713-2014_20260626";
const BULK_DOWNLOAD_HEADER = "x-mandarin-taigi-bulk-download";
const OFFICIAL_ENTRY_URL = "https://sutian.moe.edu.tw/zh-hant/su/";
const AUDIO_PACKS = {
  taigi: { sizeMb: 186, label: "完整台語語音" },
  mandarin: { sizeMb: 108, label: "華語單字朗讀" },
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
  taigiAudioBytes: 0,
  mandarinAudioUrls: [],
  activeQuery: "",
  mandarinVoice: null,
  mandarinSpeechState: "checking",
  mandarinSpeechRequest: 0,
  audioDownload: null,
  deferredInstallPrompt: null,
  learning: null,
  appReady: false,
  serviceWorkerCompatibility: "serviceWorker" in navigator ? "checking" : "none",
  serviceWorkerCheck: 0,
  serviceWorkerRegistration: null,
};

const watchedRegistrations = new WeakSet();
const watchedWorkers = new WeakSet();

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

function renderComparison(
  term,
  comparison,
  { matched = false, tags = comparison.accents || [], tagsLabel = "收錄腔口" } = {},
) {
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
    attributes: { "aria-label": tagsLabel },
  });
  for (const tag of tags) {
    if (!tag) continue;
    const item = makeElement("li", { className: "accent-tag", text: tag });
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

function renderCommonComparison(common, matched = false) {
  return renderComparison(
    { mandarin: common.hanji },
    {
      hanji: common.hanji,
      romanization: common.romanization,
      audio: common.audio,
      term_id: common.id,
    },
    {
      matched,
      tags: ["臺華共同詞", common.category].filter(Boolean),
      tagsLabel: "詞目資料",
    },
  );
}

function renderCommonTerm(common, match = {}) {
  const card = makeElement("article", { className: "result-card" });
  const header = makeElement("header", { className: "result-card__header" });
  const titleGroup = makeElement("div");
  titleGroup.append(
    makeElement("span", { className: "eyebrow", text: "臺華共同詞" }),
    makeElement("h2", { className: "result-card__title", text: common.hanji }),
    makeElement("p", {
      className: "result-card__speech-note",
      text: "華語與台語共用相同詞形；教育部此類詞目不另列華語義項。",
    }),
  );
  header.append(titleGroup);

  const comparisonList = makeElement("div", { className: "comparison-list" });
  comparisonList.append(renderCommonComparison(common, Boolean(match.common || match.mandarin)));
  card.append(header, comparisonList);
  return card;
}

function renderTerm(
  term,
  accent,
  match = { mandarin: false, common: null, comparisons: [] },
  common = null,
) {
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
  const mergedCommon = !accent && common
    ? groups.find((comparison) => commonMatchesComparison(common, comparison))
    : null;
  if (common && !accent && !mergedCommon) {
    comparisonList.append(renderCommonComparison(common, Boolean(match.common)));
  }
  for (const comparison of groups) {
    const includesCommon = comparison === mergedCommon;
    comparisonList.append(
      renderComparison(term, comparison, {
        matched: matchedKeys.has(comparisonKey(comparison)) || (includesCommon && Boolean(match.common)),
        ...(term.kind === "sense"
          ? { tags: ["依教育部釋義對照"], tagsLabel: "資料來源" }
          : {}),
        ...(includesCommon
          ? {
              tags: [...comparison.accents, "臺華共同詞", common.category].filter(Boolean),
              tagsLabel: "收錄腔口與詞目資料",
            }
          : {}),
      }),
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
        text: "本站只呈現教育部已收錄的華台詞彙比較與臺華共同詞，不會用 AI 猜答案。可換短一點的詞再試。",
      }),
    );
    elements.results.append(empty);
    setStatus(`找不到「${cleanQuery}」的直接對照。`, "error");
  } else {
    const fragment = document.createDocumentFragment();
    for (const result of search.results) {
      fragment.append(
        result.term
          ? renderTerm(result.term, accent, result.match, result.common)
          : renderCommonTerm(result.common, result.match),
      );
    }
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
        `共找到 ${formatNumber(search.total)} 個詞目，先顯示前 ${formatNumber(search.results.length)} 個。`,
        "success",
      );
    } else {
      setStatus(`找到 ${formatNumber(search.total)} 個詞目。`, "success");
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

function collectCommonAudioUrls(entries) {
  return [...new Set((entries || []).map((entry) => entry.audio).filter(Boolean))];
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
  return !canDownloadOfflineAudio(state.serviceWorkerCompatibility);
}

function serviceWorkerStatusMessage() {
  if (state.serviceWorkerCompatibility === "checking") return "正在確認離線版本，請稍候…";
  if (state.serviceWorkerCompatibility === "outdated") {
    return "網站已更新；請完全關閉本站所有分頁與 App 後再開一次，下載按鈕就會啟用。";
  }
  if (state.serviceWorkerCompatibility === "installed") {
    return "離線服務已安裝，可直接下載；關閉本頁再開後即可完整離線播放。";
  }
  if (state.serviceWorkerCompatibility === "unverified") {
    return "目前無法確認離線服務版本；查詞仍可使用，請稍後再試。";
  }
  if (state.serviceWorkerCompatibility === "none") {
    return "離線功能目前無法啟用；查詞仍可使用。";
  }
  return "";
}

function queryWorkerRelease(worker, timeoutMs = 1500) {
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
      worker.postMessage({ type: "GET_RELEASE" }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

function watchServiceWorker(worker, registration) {
  if (!worker || watchedWorkers.has(worker)) return;
  watchedWorkers.add(worker);
  worker.addEventListener("statechange", () => {
    watchServiceWorker(registration.installing, registration);
    watchServiceWorker(registration.waiting, registration);
    watchServiceWorker(registration.active, registration);
    detectServiceWorkerCompatibility(registration);
  });
}

function watchServiceWorkerRegistration(registration) {
  if (!registration) return;
  state.serviceWorkerRegistration = registration;
  watchServiceWorker(registration.installing, registration);
  watchServiceWorker(registration.waiting, registration);
  watchServiceWorker(registration.active, registration);
  if (watchedRegistrations.has(registration)) return;
  watchedRegistrations.add(registration);
  registration.addEventListener("updatefound", () => {
    watchServiceWorker(registration.installing, registration);
    detectServiceWorkerCompatibility(registration);
  });
}

async function detectServiceWorkerCompatibility(registration = state.serviceWorkerRegistration) {
  const check = ++state.serviceWorkerCheck;
  const controller = navigator.serviceWorker?.controller || null;
  if (!registration) {
    try {
      registration = await navigator.serviceWorker?.getRegistration?.();
    } catch {
      registration = null;
    }
    if (check !== state.serviceWorkerCheck) return;
  }
  watchServiceWorkerRegistration(registration);

  const worker = controller || registration?.active || null;
  if (!worker) {
    state.serviceWorkerCompatibility = registration?.installing || registration?.waiting ? "checking" : "none";
    setAudioDownloadControls(Boolean(state.audioDownload));
    updateOfflineAudioState();
    return;
  }

  state.serviceWorkerCompatibility = "checking";
  setAudioDownloadControls(Boolean(state.audioDownload));
  updateOfflineAudioState();
  const reply = await queryWorkerRelease(worker);
  if (check !== state.serviceWorkerCheck) return;

  const latestController = navigator.serviceWorker?.controller || null;
  if (latestController !== controller || (!controller && worker !== registration?.active)) {
    detectServiceWorkerCompatibility(registration);
    return;
  }
  state.serviceWorkerCompatibility = classifyServiceWorkerReply(reply, {
    controlled: Boolean(controller),
    releaseRevision: RELEASE_REVISION,
    audioCache: AUDIO_CACHE,
  });
  setAudioDownloadControls(Boolean(state.audioDownload));
  updateOfflineAudioState();
}

function setAudioDownloadControls(running) {
  const waitingForUpdate = serviceWorkerBlocksAudioDownload();
  elements.downloadTaigiAudio.disabled = running || waitingForUpdate || state.taigiAudioUrls.length === 0;
  elements.downloadMandarinAudio.disabled = running || waitingForUpdate || state.mandarinAudioUrls.length === 0;
  elements.clearOfflineAudio.disabled = running;
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
        ? `完整台語語音已下載（${formatNumber(taigiCount)} 個）`
        : `下載完整台語語音（約 ${AUDIO_PACKS.taigi.sizeMb} MB）`;
    elements.downloadMandarinAudio.textContent =
      mandarinCount === state.mandarinAudioUrls.length && mandarinCount > 0
        ? `華語單字朗讀已下載（${formatNumber(mandarinCount)} 個）`
        : `下載華語單字朗讀（約 ${AUDIO_PACKS.mandarin.sizeMb} MB）`;
    const workerMessage = serviceWorkerStatusMessage();
    if (message) {
      elements.offlineStatus.textContent = message;
    } else if (workerMessage) {
      elements.offlineStatus.textContent = workerMessage;
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

  let cache;
  let cachedUrls;
  try {
    cache = await caches.open(AUDIO_CACHE);
    cachedUrls = new Set((await cache.keys()).map((request) => request.url));
  } catch {
    elements.offlineStatus.textContent = `${pack.label}無法儲存，請確認瀏覽器空間後再試。`;
    return;
  }

  const missingCount = urls.filter((url) => !cachedUrls.has(url)).length;
  if (missingCount === 0) {
    const message =
      state.serviceWorkerCompatibility === "installed"
        ? `${pack.label}已完整下載；完全關閉本頁再開後即可離線播放。`
        : `${pack.label}已完整下載。`;
    await updateOfflineAudioState(message);
    return;
  }

  const packBytes =
    kind === "taigi" && state.taigiAudioBytes > 0
      ? state.taigiAudioBytes
      : pack.sizeMb * 1_000_000;
  const estimatedBytes = Math.ceil((packBytes * missingCount) / urls.length);
  const safetyBytes = Math.max(1_000_000, Math.ceil(estimatedBytes * 0.1));
  try {
    const estimate = await navigator.storage?.estimate?.();
    const available = Number(estimate?.quota) - Number(estimate?.usage);
    if (Number.isFinite(available) && available < estimatedBytes + safetyBytes) {
      elements.offlineStatus.textContent = `可用儲存空間不足；尚需約 ${formatNumber(
        Math.ceil(estimatedBytes / 1_000_000),
      )} MB，請先釋放空間。`;
      return;
    }
  } catch {
    // Browsers without quota estimates still get CacheStorage's quota fallback.
  }

  const confirmed = window.confirm(
    `將下載約 ${formatNumber(Math.ceil(estimatedBytes / 1_000_000))} MB（${formatNumber(
      missingCount,
    )} 個檔案）。建議使用 Wi-Fi；可隨時取消並稍後續傳。要繼續嗎？`,
  );
  if (!confirmed) return;

  navigator.storage?.persist?.().catch(() => {});
  const task = {
    cancelled: false,
    networkInterrupted: false,
    outOfSpace: false,
    controllers: new Set(),
  };
  state.audioDownload = task;
  setAudioDownloadControls(true);
  let completed = 0;
  let failed = 0;
  try {
    async function cacheOne(url) {
      const controller = new AbortController();
      task.controllers.add(controller);
      let attempted = false;
      let saved = false;
      try {
        if (!cachedUrls.has(url) && !task.cancelled) {
          attempted = true;
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { [BULK_DOWNLOAD_HEADER]: "1" },
          });
          if (!response.ok) throw new Error(String(response.status));
          await cache.put(url, response);
          cachedUrls.add(url);
          saved = true;
        }
      } catch (error) {
        if (error?.name === "QuotaExceededError") {
          task.outOfSpace = true;
          task.cancelled = true;
          failed += 1;
          for (const activeController of task.controllers) activeController.abort();
        } else if (error?.name !== "AbortError") {
          failed += 1;
        }
      } finally {
        task.controllers.delete(controller);
        completed += 1;
        elements.offlineStatus.textContent = task.cancelled
          ? `正在取消${pack.label}下載…`
          : `正在儲存${pack.label}：${formatNumber(completed)} / ${formatNumber(urls.length)}`;
      }
      return { attempted, saved };
    }

    let failedBatches = 0;
    for (let index = 0; index < urls.length && !task.cancelled; index += 6) {
      const results = await Promise.all(urls.slice(index, index + 6).map(cacheOne));
      const attempted = results.filter((result) => result.attempted).length;
      const saved = results.filter((result) => result.saved).length;
      if (attempted > 0 && saved === 0) failedBatches += 1;
      else if (saved > 0) failedBatches = 0;

      if (!navigator.onLine || failedBatches >= 3) {
        task.networkInterrupted = true;
        task.cancelled = true;
      }
    }

    const savedFilesNote =
      state.serviceWorkerCompatibility === "installed"
        ? "已完成的檔案會保留；完全關閉本頁再開後即可離線播放。"
        : "已完成的檔案仍可離線使用。";
    const finalMessage = task.outOfSpace
      ? `儲存空間不足，${pack.label}下載已停止；${savedFilesNote}`
      : task.networkInterrupted
        ? `網路中斷，${pack.label}下載已暫停；恢復連線後再按一次即可續傳。`
        : task.cancelled
          ? `已取消下載；${savedFilesNote}`
          : failed
            ? `已儲存 ${formatNumber(urls.length - failed)} 個${pack.label}，${formatNumber(failed)} 個失敗；可再按一次重試。`
            : state.serviceWorkerCompatibility === "installed"
              ? `完成：${formatNumber(urls.length)} 個${pack.label}已下載；完全關閉本頁再開後即可離線播放。`
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
    if (!Array.isArray(dictionary.terms) || !Array.isArray(dictionary.common_entries)) {
      throw new Error("詞庫格式不正確");
    }

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
    state.index = createSearchIndex(dictionary);
    state.taigiAudioUrls = [
      ...new Set([
        ...collectAudioUrls(dictionary.terms),
        ...collectCommonAudioUrls(dictionary.common_entries),
      ]),
    ].map(resolveAudioUrl);
    state.taigiAudioBytes = Number(dictionary.metadata?.audio_pack_bytes) || 0;
    state.mandarinAudioUrls = Object.values(mandarinAudioEntries)
      .map((entry) => entry.audio)
      .filter(Boolean)
      .map(resolveMandarinAudioUrl);
    populateAccents(dictionary.terms);
    renderSuggestions();

    const metadata = dictionary.metadata || {};
    elements.termCount.textContent = formatNumber(
      metadata.searchable_headword_count ?? dictionary.terms.length + dictionary.common_entries.length,
    );
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
  if (state.audioDownload) return;
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
  elements.offlineStatus.textContent = "App 已安裝；下載完整台語語音後，查詞與挑戰皆可完整離線播放。";
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
  navigator.serviceWorker.addEventListener("controllerchange", () => detectServiceWorkerCompatibility());
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      watchServiceWorkerRegistration(registration);
      await detectServiceWorkerCompatibility(registration);
      navigator.serviceWorker.ready
        .then((readyRegistration) => {
          watchServiceWorkerRegistration(readyRegistration);
          detectServiceWorkerCompatibility(readyRegistration);
        })
        .catch(() => {});
    } catch {
      state.serviceWorkerCompatibility = "none";
      setAudioDownloadControls(Boolean(state.audioDownload));
      elements.offlineStatus.textContent = "離線功能目前無法啟用；查詞仍可使用。";
    }
  });
}

loadDictionary();
initializeMandarinSpeech();
