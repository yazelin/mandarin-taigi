function normalizeLanguage(language = "") {
  return language.trim().toLowerCase().replaceAll("_", "-");
}

function mandarinLanguageRank(language) {
  const normalized = normalizeLanguage(language);
  if (normalized === "zh-tw" || normalized.startsWith("zh-hant-tw")) return 0;
  if (normalized === "zh-hant" || normalized.startsWith("zh-hant-")) return 1;
  if (
    normalized === "zh-cn" ||
    normalized.startsWith("zh-hans") ||
    normalized === "zh-sg" ||
    normalized.startsWith("cmn-")
  ) {
    return 2;
  }
  if (normalized === "zh") return 3;
  return Number.POSITIVE_INFINITY;
}

export function selectMandarinVoice(voices = []) {
  return (
    voices
      .map((voice, index) => ({
        voice,
        index,
        rank: mandarinLanguageRank(voice?.lang),
      }))
      .filter((candidate) => Number.isFinite(candidate.rank) && candidate.voice?.localService === true)
      .sort((left, right) =>
        left.rank - right.rank || left.index - right.index,
      )[0]?.voice || null
  );
}

export function waitForMandarinVoice(synthesis, timeoutMs = 2000) {
  if (!synthesis || typeof synthesis.getVoices !== "function") return Promise.resolve(null);

  const findVoice = () => selectMandarinVoice(synthesis.getVoices());
  const immediate = findVoice();
  if (immediate) return Promise.resolve(immediate);
  if (typeof synthesis.addEventListener !== "function") return Promise.resolve(null);

  return new Promise((resolve) => {
    let timer;
    const finish = (voice) => {
      clearTimeout(timer);
      synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(voice);
    };
    const handleVoicesChanged = () => {
      const voice = findVoice();
      if (voice) finish(voice);
    };

    synthesis.addEventListener("voiceschanged", handleVoicesChanged);
    timer = setTimeout(() => finish(findVoice()), timeoutMs);
  });
}
