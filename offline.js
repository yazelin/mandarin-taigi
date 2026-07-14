export function classifyServiceWorkerReply(
  reply,
  { controlled = false, releaseRevision = "", audioCache = "" } = {},
) {
  if (!reply || typeof reply !== "object") return "unverified";
  if (reply.release !== releaseRevision || reply.audioCache !== audioCache) return "outdated";
  return controlled ? "current" : "installed";
}

export function canDownloadOfflineAudio(compatibility) {
  return compatibility === "current" || compatibility === "installed";
}
