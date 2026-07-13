import { createSearchIndex, groupComparisons, searchTerms } from "./search.js";

const DATA_URL = "./data/dictionary.json";
const DATA_BASE_URL = new URL(DATA_URL, window.location.href);
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
  termCount: document.querySelector("#term-count"),
  comparisonCount: document.querySelector("#comparison-count"),
  audioCount: document.querySelector("#audio-count"),
  sourceDate: document.querySelector("#source-date"),
  offlineButton: document.querySelector("#download-audio"),
  offlineStatus: document.querySelector("#offline-status"),
  audioDock: document.querySelector("#audio-dock"),
  audioTitle: document.querySelector("#audio-title"),
  audio: document.querySelector("#audio-player"),
  stopAudio: document.querySelector("#stop-audio"),
};

const state = {
  dictionary: null,
  index: [],
  audioUrls: [],
  activeQuery: "",
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

function speakMandarin(text) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setStatus("這台裝置沒有提供瀏覽器國語朗讀功能。", "error");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.lang.toLowerCase().startsWith("zh-tw"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  setStatus(`正在用裝置聲音朗讀華語「${text}」。`, "success");
}

async function playTaigi(term, comparison) {
  if (!comparison.audio) return;
  const audioUrl = resolveAudioUrl(comparison.audio);
  elements.audioTitle.textContent = `${term.mandarin} → ${comparison.hanji}（${comparison.romanization}）`;
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
  const speak = makeElement("button", {
    className: "button button--secondary",
    text: "聽華語",
    attributes: { type: "button", "aria-label": `聽華語「${term.mandarin}」（使用裝置聲音）` },
  });
  speak.addEventListener("click", () => speakMandarin(term.mandarin));
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

async function downloadOfflineAudio() {
  if (!("caches" in window)) {
    elements.offlineStatus.textContent = "這個瀏覽器不支援離線音檔儲存。";
    return;
  }
  elements.offlineButton.disabled = true;
  const cache = await caches.open(AUDIO_CACHE);
  let completed = 0;
  let failed = 0;
  const urls = state.audioUrls.map(resolveAudioUrl);

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
      elements.offlineStatus.textContent = `正在儲存發音：${completed} / ${urls.length}`;
    }
  }

  for (let index = 0; index < urls.length; index += 8) {
    await Promise.all(urls.slice(index, index + 8).map(cacheOne));
  }

  elements.offlineButton.disabled = false;
  elements.offlineStatus.textContent = failed
    ? `已儲存 ${urls.length - failed} 個發音，${failed} 個失敗；可再按一次重試。`
    : `完成：${urls.length} 個官方發音已可離線播放。`;
}

async function loadDictionary() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dictionary = await response.json();
    if (!Array.isArray(dictionary.terms)) throw new Error("詞庫格式不正確");

    state.dictionary = dictionary;
    state.index = createSearchIndex(dictionary.terms);
    state.audioUrls = collectAudioUrls(dictionary.terms);
    populateAccents(dictionary.terms);

    const metadata = dictionary.metadata || {};
    elements.termCount.textContent = formatNumber(metadata.term_count ?? dictionary.terms.length);
    elements.comparisonCount.textContent = formatNumber(
      metadata.comparison_count ?? dictionary.terms.reduce((sum, term) => sum + term.comparisons.length, 0),
    );
    elements.audioCount.textContent = formatNumber(metadata.audio_file_count ?? state.audioUrls.length);
    elements.sourceDate.textContent = metadata.source_updated || metadata.generated_at || "依官方下載資料";
    elements.offlineButton.textContent = `下載 ${formatNumber(state.audioUrls.length)} 個離線發音`;
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
