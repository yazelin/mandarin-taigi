import {
  MASTER_BOX,
  buildQuizPool,
  buildQuizRound,
  currentWrongCandidates,
  isMastered,
  nextLearningProgress,
} from "./quiz.js?v=13";

const STORE_KEY = "mandarin-taigi-learning-v1";
const STORE_VERSION = 1;
const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;

function makeElement(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) node.setAttribute(name, value);
  }
  return node;
}

function makeButton(text, className = "button button--secondary") {
  return makeElement("button", { text, className, attributes: { type: "button" } });
}

function defaultStore() {
  return { version: STORE_VERSION, items: {}, sessions: [] };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.floor(number), maximum) : 0;
}

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
    if (parsed?.version === STORE_VERSION && isRecord(parsed.items)) {
      const items = Object.fromEntries(
        Object.entries(parsed.items)
          .filter(([id, progress]) => id.length <= 500 && isRecord(progress))
          .slice(0, 5000)
          .map(([id, progress]) => [
            id,
            {
              box: Math.max(1, Math.min(MASTER_BOX, storedInteger(progress.box, MASTER_BOX) || 1)),
              attempts: storedInteger(progress.attempts, 100000),
              correct: storedInteger(progress.correct, 100000),
              wrong: storedInteger(progress.wrong, 100000),
              streak: storedInteger(progress.streak, 100000),
              ...(typeof progress.lastAnsweredAt === "string"
                ? { lastAnsweredAt: progress.lastAnsweredAt.slice(0, 100) }
                : {}),
            },
          ]),
      );
      const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : [])
        .filter(isRecord)
        .slice(-30)
        .map((item) => {
          const total = storedInteger(item.total, 100);
          return {
            date: typeof item.date === "string" ? item.date.slice(0, 100) : "",
            score: Math.min(storedInteger(item.score, 100), total),
            total,
            pattern: (Array.isArray(item.pattern) ? item.pattern : [])
              .slice(0, total)
              .map((result) => (result ? 1 : 0)),
          };
        });
      return { version: STORE_VERSION, items, sessions };
    }
  } catch {
    // Corrupt or unavailable storage falls back to a clean local profile.
  }
  return defaultStore();
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function shuffle(values, random = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const picked = Math.floor(Math.min(Math.max(Number(random()) || 0, 0), 0.999999999) * (index + 1));
    [copy[index], copy[picked]] = [copy[picked], copy[index]];
  }
  return copy;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
}

function masteryDots(progress = {}) {
  const dots = makeElement("span", {
    className: "mastery-dots",
    attributes: { "aria-label": `熟練度 ${Math.max(1, progress.box || 1)} / ${MASTER_BOX}` },
  });
  for (let box = 1; box <= MASTER_BOX; box += 1) {
    dots.append(makeElement("i", { className: box <= (progress.box || 1) ? "on" : "" }));
  }
  return dots;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("圖卡產生失敗"))), "image/png");
  });
}

async function createScoreCard(session) {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器不支援圖卡");

  context.fillStyle = "#fbfaf4";
  context.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
  context.fillStyle = "#1f5b4f";
  context.fillRect(0, 0, SHARE_WIDTH, 34);

  context.fillStyle = "#17312b";
  context.font = '800 38px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText("國 ↔ 台｜詞語對照", 74, 100);
  context.font = '900 64px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText("台語詞語隨機挑戰", 74, 190);

  context.fillStyle = "#1f5b4f";
  context.font = '900 150px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText(`${session.score}/${session.total}`, 70, 375);

  const blockSize = 54;
  const gap = 16;
  const startX = 650;
  const startY = 260;
  session.results.forEach((result, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    context.fillStyle = result.correct ? "#1f5b4f" : "#a33d2d";
    context.fillRect(
      startX + column * (blockSize + gap),
      startY + row * (blockSize + gap),
      blockSize,
      blockSize,
    );
    context.fillStyle = "#ffffff";
    context.font = '900 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    context.textAlign = "center";
    context.fillText(
      result.correct ? "✓" : "×",
      startX + column * (blockSize + gap) + blockSize / 2,
      startY + row * (blockSize + gap) + 39,
    );
  });
  context.textAlign = "start";

  context.fillStyle = "#52665f";
  context.font = '700 30px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText(
    session.total === 10
      ? "每局完全隨機 10 題・官方台語發音"
      : `錯題隨機重考 ${session.total} 題・官方台語發音`,
    74,
    490,
  );
  context.font = '650 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText("yazelin.github.io/mandarin-taigi/", 74, 550);
  context.fillStyle = "#f2b94b";
  context.fillRect(74, 574, 520, 10);
  return canvasBlob(canvas);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initializeLearning({ dictionary, playAudio, sourceEntryLink }) {
  const view = document.querySelector("#learning-view");
  const dictionaryViews = [...document.querySelectorAll(".dictionary-view")];
  const navLinks = [...document.querySelectorAll("[data-app-view]")];
  const pool = buildQuizPool(dictionary);
  const answerCount = new Set(pool.map((candidate) => candidate.answer)).size;
  const candidateById = new Map(pool.map((candidate) => [candidate.id, candidate]));
  let store = loadStore();
  let session = null;
  let flashcards = [];
  let flashcardIndex = 0;
  let shareBlob = null;
  let storageNotice = "";

  function persistStore() {
    const saved = saveStore(store);
    storageNotice = saved ? "" : "進度無法保存；這次操作只在目前頁面有效，請檢查瀏覽器儲存空間。";
    return saved;
  }

  function appendStorageNotice(parent) {
    if (!storageNotice) return;
    parent.append(
      makeElement("p", {
        className: "learning-storage-warning",
        text: storageNotice,
        attributes: { role: "status", "aria-live": "polite" },
      }),
    );
  }

  function updateNav(route) {
    for (const link of navLinks) {
      const active = link.dataset.appView === route;
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  function showDictionary() {
    for (const section of dictionaryViews) section.hidden = false;
    view.hidden = true;
    updateNav("dictionary");
    if (window.location.hash.startsWith("#dictionary")) window.scrollTo({ top: 0 });
  }

  function showLearning(route) {
    for (const section of dictionaryViews) section.hidden = true;
    view.hidden = false;
    updateNav(route);
    if (route === "wrongbook") renderWrongbook();
    else if (route === "flashcards") startFlashcards();
    else renderChallengeHome();
    window.requestAnimationFrame(() => {
      view.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    });
  }

  function showAbout() {
    for (const section of dictionaryViews) section.hidden = section.id !== "about";
    view.hidden = true;
    updateNav("about");
    const about = document.querySelector("#about");
    window.requestAnimationFrame(() => {
      about?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    });
  }

  function routeFromHash() {
    const route = window.location.hash.slice(1).split("?", 1)[0];
    if (["challenge", "wrongbook", "flashcards"].includes(route)) showLearning(route);
    else if (route === "about") showAbout();
    else showDictionary();
  }

  for (const link of navLinks) {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("href") !== window.location.hash) return;
      event.preventDefault();
      routeFromHash();
    });
  }

  function learningStats() {
    const records = Object.entries(store.items).filter(([id]) => candidateById.has(id));
    const practiced = records.filter(([, progress]) => (progress.attempts || 0) > 0).length;
    const mastered = records.filter(([, progress]) => isMastered(progress)).length;
    const wrong = currentWrongCandidates(pool, store.items).length;
    const best = Math.max(
      0,
      ...store.sessions
        .filter((item) => Number(item.total) === 10)
        .map((item) => Number(item.score) || 0),
    );
    return { practiced, mastered, wrong, best };
  }

  function appendStats(card) {
    const stats = learningStats();
    const grid = makeElement("div", { className: "learning-stats", attributes: { "aria-label": "學習統計" } });
    for (const [value, label] of [
      [stats.practiced, "練過詞語"],
      [stats.wrong, "待複習"],
      [stats.mastered, "已掌握"],
      [stats.best ? `${stats.best}/10` : "—", "最佳成績"],
    ]) {
      const item = makeElement("div", { className: "learning-stat" });
      item.append(
        makeElement("strong", { text: typeof value === "number" ? formatNumber(value) : String(value) }),
        makeElement("span", { text: label }),
      );
      grid.append(item);
    }
    card.append(grid);
  }

  function renderChallengeHome() {
    session = null;
    shareBlob = null;
    const shell = makeElement("div", { className: "learning-shell" });
    const card = makeElement("section", { className: "learning-card" });
    card.append(
      makeElement("p", { className: "eyebrow", text: "聽聲音・揣意思" }),
      makeElement("h1", { text: "台語詞語隨機挑戰" }),
      makeElement("p", {
        className: "learning-lead",
        text: `每局從 ${formatNumber(answerCount)} 種可唯一判定的華語意思，完全隨機抽 10 題；題目與答案不重複。`,
      }),
    );
    appendStats(card);
    appendStorageNotice(card);
    const start = makeButton("開始隨機 10 題", "button button--primary");
    start.addEventListener("click", () => startChallenge());
    const wrong = makeButton("看錯題本");
    wrong.addEventListener("click", () => (window.location.hash = "#wrongbook"));
    const actions = makeElement("div", { className: "learning-actions" });
    actions.append(start, wrong);
    card.append(
      actions,
      makeElement("p", {
        className: "learning-muted",
        text: "不計時、不登入。答錯會自動留在這台裝置；連續答對兩次就視為掌握。未下載時需連網播放新題，播放過的音檔會快取；下載約 108 MB 完整台語語音後可完整離線遊玩。",
      }),
    );
    shell.append(card);
    view.replaceChildren(shell);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  function startChallenge(sourcePool = pool, count = 10) {
    const questions = buildQuizRound(sourcePool, Math.min(count, sourcePool.length));
    if (questions.length === 0) {
      renderChallengeHome();
      return;
    }
    session = { questions, index: 0, results: [], score: 0, total: questions.length };
    renderQuestion();
  }

  function renderQuestion(answered = null) {
    const question = session.questions[session.index];
    const shell = makeElement("div", { className: "learning-shell" });
    const card = makeElement("section", { className: "learning-card" });
    const head = makeElement("div", { className: "quiz-head" });
    head.append(
      makeElement("strong", { text: `第 ${session.index + 1} / ${session.total} 題` }),
      makeElement("span", { className: "learning-muted", text: `目前 ${session.score} 分` }),
    );
    const progress = makeElement("div", {
      className: "quiz-progress",
      attributes: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": String(session.total),
        "aria-valuenow": String(session.index + 1),
        "aria-label": "答題進度",
      },
    });
    progress.append(makeElement("span", { attributes: { style: `width:${((session.index + 1) / session.total) * 100}%` } }));

    const prompt = makeElement("div", { className: "quiz-prompt" });
    prompt.append(makeElement("p", { className: "learning-muted", text: "聽這個台語詞，選出華語意思" }));
    const listen = makeButton(answered ? "再聽一次" : "▶ 聽台語", "quiz-audio-button");
    const audioStatus = makeElement("p", {
      className: "quiz-hint",
      attributes: { role: "status", "aria-live": "polite" },
    });
    listen.addEventListener("click", async () => {
      listen.disabled = true;
      audioStatus.textContent = "正在播放…";
      const played = await playAudio(question, { reveal: Boolean(answered) });
      audioStatus.textContent = played ? "可重播；聽完再選答案。" : "音檔無法播放，可用下方臺羅提示作答。";
      listen.disabled = false;
    });
    prompt.append(listen, audioStatus);
    if (!answered) {
      const hint = makeButton("顯示臺羅提示", "text-button");
      hint.addEventListener("click", () => {
        audioStatus.textContent = question.romanization;
        audioStatus.lang = "nan-Latn";
        hint.remove();
      });
      prompt.append(hint);
    }

    const options = makeElement("div", { className: "quiz-options", attributes: { "aria-label": "四個華語選項" } });
    for (const option of question.options) {
      const button = makeButton(option, "quiz-option");
      if (answered) {
        button.disabled = true;
        if (option === question.correctAnswer) button.classList.add("is-correct");
        if (option === answered.selected && !answered.correct) button.classList.add("is-wrong");
      } else {
        button.addEventListener("click", () => answerQuestion(question, option));
      }
      options.append(button);
    }

    card.append(head, progress, prompt, options);
    if (answered) card.append(answerFeedback(question, answered));
    appendStorageNotice(card);
    shell.append(card);
    view.replaceChildren(shell);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  function answerQuestion(question, selected) {
    const correct = selected === question.correctAnswer;
    store.items[question.id] = nextLearningProgress(
      store.items[question.id],
      correct,
      new Date().toISOString(),
    );
    persistStore();
    session.results.push({ id: question.id, correct, selected });
    if (correct) session.score += 1;
    renderQuestion({ selected, correct });
  }

  function answerFeedback(question, answered) {
    const feedback = makeElement("div", {
      className: "quiz-feedback",
      attributes: { "data-correct": String(answered.correct), role: "status", "aria-live": "polite" },
    });
    feedback.append(
      makeElement("p", {
        className: "quiz-feedback__result",
        text: answered.correct ? "答對了！" : `答錯了，正解是「${question.correctAnswer}」。`,
      }),
      makeElement("p", { className: "quiz-feedback__word", text: `${question.hanji}＝${question.correctAnswer}` }),
      makeElement("p", {
        className: "quiz-feedback__tailo",
        text: question.romanization,
        attributes: { lang: "nan-Latn" },
      }),
      makeElement("p", {
        className: "learning-muted",
        text: question.accents.length ? `收錄腔口：${question.accents.join("、")}` : "教育部官方詞條音檔",
      }),
    );
    if (question.term_id) {
      feedback.append(
        makeElement("a", {
          text: "教育部原詞條 ↗",
          attributes: { href: sourceEntryLink(question.term_id), target: "_blank", rel: "noopener noreferrer" },
        }),
      );
    }
    const next = makeButton(session.index + 1 < session.total ? "下一題" : "看成績", "button button--primary");
    next.addEventListener("click", () => {
      session.index += 1;
      if (session.index < session.total) renderQuestion();
      else finishChallenge();
    });
    const actions = makeElement("div", { className: "learning-actions" });
    actions.append(next);
    feedback.append(actions);
    return feedback;
  }

  function finishChallenge() {
    store.sessions.push({
      date: new Date().toISOString(),
      score: session.score,
      total: session.total,
      pattern: session.results.map((result) => (result.correct ? 1 : 0)),
    });
    store.sessions = store.sessions.slice(-30);
    const saved = persistStore();

    const shell = makeElement("div", { className: "learning-shell" });
    const card = makeElement("section", { className: "learning-card" });
    card.append(
      makeElement("p", { className: "eyebrow", text: "挑戰完成" }),
      makeElement("h1", { text: "這局的成績" }),
      makeElement("p", { className: "result-score", text: `${session.score}/${session.total}` }),
    );
    const grid = makeElement("div", { className: "answer-grid", attributes: { "aria-label": "每題答題結果" } });
    session.results.forEach((result, index) =>
      grid.append(
        makeElement("span", {
          text: result.correct ? "✓" : "×",
          attributes: {
            "data-correct": String(result.correct),
            "aria-label": `第 ${index + 1} 題${result.correct ? "答對" : "答錯"}`,
            title: `第 ${index + 1} 題${result.correct ? "答對" : "答錯"}`,
          },
        }),
      ),
    );
    card.append(grid);

    const actions = makeElement("div", { className: "learning-actions" });
    const share = makeButton("準備分享圖卡…", "button button--primary");
    share.disabled = true;
    const again = makeButton("再挑戰 10 題");
    again.addEventListener("click", () => startChallenge());
    const review = makeButton("複習答錯詞語");
    review.addEventListener("click", () => (window.location.hash = "#flashcards"));
    actions.append(share, again, review);
    const shareStatus = makeElement("p", {
      className: "share-status",
      text: saved ? "成績與錯題只保存在這台裝置。" : "無法保存進度；可能是瀏覽器儲存空間已滿。",
      attributes: { role: "status", "aria-live": "polite" },
    });
    card.append(actions, shareStatus);
    shell.append(card);
    view.replaceChildren(shell);

    createScoreCard(session)
      .then((blob) => {
        shareBlob = blob;
        share.disabled = false;
        share.textContent = "分享成績圖卡";
      })
      .catch(() => {
        share.textContent = "圖卡無法產生";
        shareStatus.textContent = "這個瀏覽器目前無法產生成績圖卡。";
      });
    share.addEventListener("click", () => shareScore(shareStatus));
  }

  async function shareScore(status) {
    if (!shareBlob) return;
    const text = `我在台語詞語隨機挑戰答對 ${session.score}/${session.total} 題，你也來試試！`;
    const url = `${window.location.origin}${window.location.pathname}#challenge`;
    try {
      if (typeof File === "function" && navigator.share && navigator.canShare) {
        const file = new File([shareBlob], "taigi-challenge-score.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "台語詞語隨機挑戰", text, url, files: [file] });
          status.textContent = "分享完成。";
          return;
        }
      }
      downloadBlob(shareBlob, "taigi-challenge-score.png");
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(`${text} ${url}`);
          copied = true;
        }
      } catch {
        // Saving the image is still a useful fallback when clipboard access is denied.
      }
      status.textContent = copied
        ? "圖卡已儲存，挑戰文字與連結也已複製。"
        : "圖卡已儲存；分享時請自行附上挑戰網址。";
    } catch (error) {
      if (error.name !== "AbortError") status.textContent = "分享沒有完成，可再試一次。";
    }
  }

  function renderWrongbook() {
    const wrong = currentWrongCandidates(pool, store.items);
    const shell = makeElement("div", { className: "learning-shell" });
    const card = makeElement("section", { className: "learning-card" });
    card.append(
      makeElement("p", { className: "eyebrow", text: "只存在這台裝置" }),
      makeElement("h1", { text: "錯題本" }),
      makeElement("p", {
        className: "learning-lead",
        text: "答錯過、尚未掌握的詞會留在這裡；之後連續答對兩次就自動移出。",
      }),
    );
    appendStorageNotice(card);
    if (wrong.length === 0) {
      const empty = makeElement("div", { className: "learning-empty" });
      empty.append(makeElement("strong", { text: "目前沒有待複習的詞。" }));
      card.append(empty);
    } else {
      const actions = makeElement("div", { className: "learning-actions" });
      const cards = makeButton("用學習卡複習", "button button--primary");
      cards.addEventListener("click", () => (window.location.hash = "#flashcards"));
      actions.append(cards);
      const uniqueWrongAnswers = new Set(wrong.map((candidate) => candidate.answer)).size;
      if (uniqueWrongAnswers >= 4) {
        const retryCount = Math.min(10, uniqueWrongAnswers);
        const retry = makeButton(`隨機重考 ${retryCount} 題`);
        retry.addEventListener("click", () => startChallenge(wrong, retryCount));
        actions.append(retry);
      }
      card.append(actions);
      const list = makeElement("ul", { className: "wrong-list" });
      for (const candidate of wrong) {
        const item = makeElement("li", { className: "wrong-list__item" });
        const copy = makeElement("div");
        copy.append(
          makeElement("strong", { text: `${candidate.hanji}＝${candidate.answer}` }),
          makeElement("span", {
            text: candidate.romanization,
            attributes: { lang: "nan-Latn" },
          }),
        );
        item.append(copy, masteryDots(store.items[candidate.id]));
        list.append(item);
      }
      card.append(list);
    }

    const dataActions = makeElement("div", { className: "learning-actions" });
    const exportButton = makeButton("匯出學習紀錄");
    exportButton.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
      downloadBlob(blob, "mandarin-taigi-learning.json");
    });
    const clear = makeButton("清除學習紀錄");
    clear.addEventListener("click", () => {
      if (!window.confirm("清除這台裝置上的成績、錯題與學習卡進度？")) return;
      const clearedStore = defaultStore();
      if (saveStore(clearedStore)) {
        store = clearedStore;
        storageNotice = "";
      } else {
        storageNotice = "學習紀錄未能清除；瀏覽器沒有允許本站修改本機儲存資料。";
      }
      renderWrongbook();
    });
    dataActions.append(exportButton, clear);
    card.append(dataActions);
    shell.append(card);
    view.replaceChildren(shell);
  }

  function startFlashcards() {
    flashcards = shuffle(currentWrongCandidates(pool, store.items));
    flashcardIndex = 0;
    renderFlashcard(false);
  }

  function renderFlashcard(revealed) {
    const shell = makeElement("div", { className: "learning-shell" });
    const card = makeElement("section", { className: "learning-card flashcard" });
    if (flashcards.length === 0 || flashcardIndex >= flashcards.length) {
      card.append(
        makeElement("p", { className: "eyebrow", text: "錯題學習卡" }),
        makeElement("h1", { text: flashcards.length ? "這輪複習完成" : "目前沒有學習卡" }),
        makeElement("p", {
          className: "learning-lead",
          text: flashcards.length ? "回到錯題本看看哪些詞已經掌握。" : "隨機挑戰答錯的詞，會自動出現在這裡。",
        }),
      );
      appendStorageNotice(card);
      const actions = makeElement("div", { className: "learning-actions" });
      const challenge = makeButton("開始隨機挑戰", "button button--primary");
      challenge.addEventListener("click", () => (window.location.hash = "#challenge"));
      const wrongbook = makeButton("回錯題本");
      wrongbook.addEventListener("click", () => (window.location.hash = "#wrongbook"));
      actions.append(challenge, wrongbook);
      card.append(actions);
      shell.append(card);
      view.replaceChildren(shell);
      return;
    }

    const candidate = flashcards[flashcardIndex];
    card.append(
      makeElement("p", { className: "eyebrow", text: `錯題學習卡 ${flashcardIndex + 1} / ${flashcards.length}` }),
    );
    appendStorageNotice(card);
    const face = makeElement("div", { className: revealed ? "flashcard__back" : "flashcard__front" });
    if (revealed) {
      face.append(
        makeElement("span", { className: "flashcard__answer", text: candidate.answer }),
        makeElement("strong", { text: candidate.hanji }),
        makeElement("span", {
          className: "flashcard__tailo",
          text: candidate.romanization,
          attributes: { lang: "nan-Latn" },
        }),
        makeElement("span", { className: "learning-muted", text: candidate.accents.join("、") }),
      );
    } else {
      const listen = makeButton("▶ 聽台語", "quiz-audio-button");
      const status = makeElement("span", { className: "learning-muted", attributes: { role: "status" } });
      listen.addEventListener("click", async () => {
        status.textContent = (await playAudio(candidate)) ? "可再聽一次" : "音檔無法播放";
      });
      face.append(
        listen,
        makeElement("span", {
          className: "flashcard__tailo",
          text: candidate.romanization,
          attributes: { lang: "nan-Latn" },
        }),
        status,
      );
    }
    card.append(face);
    const actions = makeElement("div", { className: "learning-actions" });
    if (!revealed) {
      const reveal = makeButton("翻面看答案", "button button--primary");
      reveal.addEventListener("click", () => renderFlashcard(true));
      actions.append(reveal);
    } else {
      const again = makeButton("還不熟");
      again.addEventListener("click", () => rateFlashcard(candidate, false));
      const remembered = makeButton("記得", "button button--primary");
      remembered.addEventListener("click", () => rateFlashcard(candidate, true));
      actions.append(again, remembered);
    }
    card.append(actions);
    shell.append(card);
    view.replaceChildren(shell);
  }

  function rateFlashcard(candidate, remembered) {
    store.items[candidate.id] = nextLearningProgress(
      store.items[candidate.id],
      remembered,
      new Date().toISOString(),
    );
    persistStore();
    flashcardIndex += 1;
    renderFlashcard(false);
  }

  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();
  return { pool, getStore: () => store, route: routeFromHash };
}
