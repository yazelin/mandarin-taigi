import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");

test("agent instructions point to the complete data release contract", () => {
  const agents = read("AGENTS.md");
  const readme = read("README.md");
  assert.ok(agents.includes("docs/DATA-RELEASE.md"));
  assert.ok(agents.includes("完整 40 字元 commit SHA"));
  assert.ok(agents.includes("A、B 一起 push"));
  assert.ok(readme.includes("docs/DATA-RELEASE.md"));
});

test("documented Taigi delivery identity matches the runtime constants", () => {
  const app = read("app.js");
  const worker = read("sw.js");
  const contract = read("docs/DATA-RELEASE.md");
  const primaryBase = app.match(/const PRIMARY_DATA_BASE = "([^"]+)"/)?.[1] || "";
  const pin = primaryBase.match(/@([0-9a-f]{40})\/$/)?.[1] || "";
  const appDataCache = app.match(/const DATA_CACHE = "([^"]+)"/)?.[1] || "";
  const workerDataCache = worker.match(/const DATA_CACHE = "([^"]+)"/)?.[1] || "";
  const shellRelease = app.match(/const RELEASE_REVISION = "([^"]+)"/)?.[1] || "";
  const canonicalUrls = ["CORE_DATA_URL", "DETAILS_DATA_URL", "MANDARIN_AUDIO_URL"].map(
    (name) => app.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1] || "",
  );
  const dataVersions = canonicalUrls.map((url) => new URL(url, "https://example.test/").searchParams.get("v"));

  assert.match(primaryBase, /^https:\/\/cdn\.jsdelivr\.net\/gh\/yazelin\/mandarin-taigi@[0-9a-f]{40}\/$/);
  assert.equal(new Set(dataVersions).size, 1);
  assert.equal(appDataCache, workerDataCache);
  for (const value of [pin, appDataCache, shellRelease, ...canonicalUrls]) assert.ok(contract.includes(value), value);
  assert.equal(/@(main|master|latest)\//.test(primaryBase), false);
});

test("documented Taigi payload hashes and CDN-size guard match deployed files", () => {
  const app = read("app.js");
  const contract = read("docs/DATA-RELEASE.md");
  const pin = app.match(/const PRIMARY_DATA_BASE = "[^"@]+@([0-9a-f]{40})\//)?.[1] || "";
  for (const path of [
    "data/dictionary-core.json",
    "data/dictionary-details.json",
    "data/mandarin-audio.json",
  ]) {
    const current = readFileSync(resolve(root, path));
    const pinned = execFileSync("git", ["show", `${pin}:${path}`], {
      cwd: root,
      encoding: null,
      maxBuffer: 25_000_000,
    });
    assert.ok(pinned.equals(current), `${path} differs from pinned commit ${pin}`);
    assert.ok(contract.includes(sha256(path)), `${path} SHA-256 must be documented`);
    assert.ok(statSync(resolve(root, path)).size < 20_000_000, `${path} exceeds jsDelivr's file limit`);
  }
});
