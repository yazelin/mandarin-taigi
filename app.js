import { createSearchIndex, groupComparisons, pickSuggestionTerms, searchTerms } from "./search.js";
import { selectMandarinVoice, waitForMandarinVoice } from "./speech.js";

const DATA_URL = "./data/dictionary.json";
const DATA_BASE_URL = new URL(DATA_URL, window.location.href);
const MANDARIN_AUDIO_URL = "./data/mandarin-audio.json";
const MANDARIN_AUDIO_BASE_URL = new URL(MANDARIN_AUDIO_URL, window.location.href);
const AUDIO_CACHE = "mandarin-taigi-audio-v1";
const OFFICIAL_ENTRY_URL = "https://sutian.moe.edu.tw/zh-hant/su/";

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
  offlineButton: document.querySelector("#download-audio"),
  offlineStatus: document.querySelector("#offline-status"),
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
    button.textContent = "聽華語（裝置）";
    button.disabled = false;
    button.dataset.speechState = "ready";
    button.title = "使用 Chrome 或裝置提供的華語聲音";
  } else if (state.mandarinSpeechState === "checking") {
    button.textContent = "檢查華語聲音…";
    button.disabled = true;
    button.dataset.speechState = "checking";
    button.title = "正在檢查 Chrome 或裝置是否提供華語聲音";
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
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang || "zh-TW";

  let started = false;
  const startTimeout = window.setTimeout(() => {
    if (request !== state.mandarinSpeechRequest || started) return;
    synthesis.cancel();
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
    setStatus(`華語「${text}」播放完畢。`, "success");
  };
  utterance.onerror = (event) => {
    if (request !== state.mandarinSpeechRequest) return;
    window.clearTimeout(startTimeout);
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
  elements.audio.src = audioUrl;
  elements.audioDock.hidden = false;
  try {
    await elements.audio.play();
    setStatus("正在播放教育部臺灣台語詞條音檔。", "success");
  } catch {
    setStatus("音檔目前無法播放，請稍後重試。", "error");
  }
}

function renderComparison(term, comparison) {
  const row = makeElement("article", { className: "comparison" });
  const words = makeElement("div", { className: "comparison__words" });
  words.append(
    makeElement("strong", { className: "comparison__hanji", text: comparison.hanji }),
    makeElement("span", { className: "comparison__tailo", text: comparison.romanization }),
  );

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

function renderTerm(term, accent) {
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
    speak.setAttribute("aria-label", `聽華語「${term.mandarin}」（使用裝置聲音）`);
    speak.addEventListener("click", () => speakMandarin(term.mandarin));
    speechNote.textContent = "本站僅使用教育部單字屬性朗讀；多字詞改用 Chrome／裝置語音。";
    updateMandarinSpeechButton(speak);
  }
  titleGroup.append(speechNote);
  header.append(titleGroup, speak);

  const comparisonList = makeElement("div", { className: "comparison-list" });
  const groups = groupComparisons(term.comparisons, accent);
  for (const comparison of groups) comparisonList.append(renderComparison(term, comparison));

  card.append(header, comparisonList);
  return card;
}

function runSearch(query, { updateUrl = true } = {}) {
  if (!state.dictionary) return;
  const cleanQuery = query.trim();
  state.activeQuery = cleanQuery;
  elements.results.replaceChildren();

  if (!cleanQuery) {
    setStatus("輸入一個華語、台語漢字或臺羅詞語開始查詢。", "");
    if (updateUrl) history.replaceState(null, "", window.location.pathname);
    return;
  }

  const accent = elements.accent.value;
  const matches = searchTerms(state.index, cleanQuery, { accent, limit: 40 });
  if (matches.length === 0) {
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
    for (const term of matches) fragment.append(renderTerm(term, accent));
    elements.results.append(fragment);
    setStatus(`找到 ${formatNumber(matches.length)} 個華語詞目。`, "success");
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("q", cleanQuery);
    if (accent) url.searchParams.set("accent", accent);
    else url.searchParams.delete("accent");
    history.replaceState(null, "", url);
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

async function downloadOfflineAudio() {
  if (!("caches" in window)) {
    elements.offlineStatus.textContent = "這個瀏覽器不支援離線音檔儲存。";
    return;
  }
  elements.offlineButton.disabled = true;
  const cache = await caches.open(AUDIO_CACHE);
  let completed = 0;
  let failed = 0;
  const urls = [...state.taigiAudioUrls, ...state.mandarinAudioUrls];

  async function cacheOne(url) {
    try {
      if (!(await cache.match(url))) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(String(response.status));
        await cache.put(url, response);
      }
    } catch {
      failed += 1;
    } finally {
      completed += 1;
      elements.offlineStatus.textContent = `正在儲存官方發音：${completed} / ${urls.length}`;
    }
  }

  for (let index = 0; index < urls.length; index += 8) {
    await Promise.all(urls.slice(index, index + 8).map(cacheOne));
  }

  elements.offlineButton.disabled = false;
  elements.offlineStatus.textContent = failed
    ? `已儲存 ${urls.length - failed} 個官方發音，${failed} 個失敗；可再按一次重試。`
    : `完成：${state.taigiAudioUrls.length} 個台語與 ${state.mandarinAudioUrls.length} 個華語官方發音已可離線播放。`;
}

async function loadDictionary() {
  try {
    const [response, mandarinAudioResponse] = await Promise.all([fetch(DATA_URL), fetch(MANDARIN_AUDIO_URL)]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!mandarinAudioResponse.ok) throw new Error(`華語音檔索引 HTTP ${mandarinAudioResponse.status}`);
    const dictionary = await response.json();
    const mandarinAudio = await mandarinAudioResponse.json();
    if (!Array.isArray(dictionary.terms)) throw new Error("詞庫格式不正確");
    if (!mandarinAudio.entries || typeof mandarinAudio.entries !== "object") {
      throw new Error("華語音檔索引格式不正確");
    }

    state.dictionary = dictionary;
    state.mandarinAudioEntries = mandarinAudio.entries;
    state.index = createSearchIndex(dictionary.terms);
    state.taigiAudioUrls = collectAudioUrls(dictionary.terms).map(resolveAudioUrl);
    state.mandarinAudioUrls = Object.values(mandarinAudio.entries)
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
    elements.offlineButton.textContent = `下載教育部官方發音（${formatNumber(
      state.taigiAudioUrls.length,
    )} 台語＋${formatNumber(state.mandarinAudioUrls.length)} 華語）`;
    elements.input.disabled = false;
    elements.accent.disabled = false;
    elements.submit.disabled = false;
    setStatus("詞庫準備完成。輸入詞語就可以查。", "success");

    const params = new URLSearchParams(window.location.search);
    const requestedAccent = params.get("accent");
    if (requestedAccent && [...elements.accent.options].some((option) => option.value === requestedAccent)) {
      elements.accent.value = requestedAccent;
    }
    const requestedQuery = params.get("q");
    if (requestedQuery) {
      elements.input.value = requestedQuery;
      runSearch(requestedQuery, { updateUrl: false });
    }
  } catch (error) {
    setStatus(`詞庫載入失敗：${error.message}。請重新整理頁面。`, "error");
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(elements.input.value);
});

elements.accent.addEventListener("change", () => {
  if (state.activeQuery) runSearch(state.activeQuery);
});

elements.suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-query]");
  if (!button) return;
  elements.input.value = button.dataset.query;
  runSearch(button.dataset.query);
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.shuffleSuggestions.addEventListener("click", renderSuggestions);

elements.offlineButton.addEventListener("click", downloadOfflineAudio);
elements.stopAudio.addEventListener("click", () => {
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();
  elements.audioDock.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

loadDictionary();
initializeMandarinSpeech();
