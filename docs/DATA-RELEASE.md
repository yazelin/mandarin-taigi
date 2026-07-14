# 台語詞庫 CDN、快取與資料發布手冊

這份文件是維護者與 Agent 的正式交接規格。產生 JSON 不等於完成發布；任何資料更新都必須走完整流程。

## 目前正式契約

| 項目 | 目前值 |
|---|---|
| App shell release | `15` |
| Dictionary data release | `13` |
| CDN data commit | `413c34bc2e4406e1ac5a81f148d84667e3830831` |
| Canonical core | `./data/dictionary-core.json?v=13` |
| Canonical details | `./data/dictionary-details.json?v=13` |
| Canonical Mandarin index | `./data/mandarin-audio.json?v=13` |
| Data cache | `mandarin-taigi-data-v13` |
| Runtime data fingerprint | `0be87056530c176b4409` |
| Mandarin source version | `2014_20260626` |
| Audio cache | `mandarin-taigi-audio-20260713-2014_20260626` |
| Core SHA-256 | `d4b3e0eaab096da4bcb3dd9039d0da002ce3f3e2dea88f3c1e6f643e02c35fd2` |
| Details SHA-256 | `1bbd15c5507d3fdfb10f6959b819ff566307aa2478b09d6b8466c0e32cb3fd1f` |
| Mandarin index SHA-256 | `51a069a04824adc6dd2f9466527ddaf24bdd95e20691df7bfd74b4bfe1eaee87` |

`PRIMARY_DATA_BASE` 故意不指向 HEAD。它指向最後一次改變目前三份資料的 immutable commit；後續只改 UI 時必須保持不動。

## 載入與信任模型

每份資料都使用同一個同源 canonical key，順序固定為：

1. `mandarin-taigi-data-v13` 中已驗證的 canonical response。
2. 過渡期的 `mandarin-taigi-shell-v13` legacy response。
3. jsDelivr 上 exact-commit 的精確檔案 URL。
4. 同源 GitHub Pages canonical URL 作最後備援。

`data-loader.js` 解析並呼叫資料 validator，成功後才把原始 bytes 存入 canonical key。CDN request 使用 `credentials: "omit"` 與 `referrerPolicy: "no-referrer"`。查詢存在 URL fragment，固定 CDN request 不包含使用者查詢。

Service Worker 只能 cache-first 讀取 `DATA_CACHE`；cache miss 時不得把網路 JSON 直接寫入，否則會繞過 core/details revision 配對及 Mandarin index 驗證。

## 為什麼使用完整 commit SHA

正式路徑不得使用 `@main`、branch、短 SHA、`@latest` 或可移動 tag：它們可能延遲更新，三個檔案也可能在不同時間命中不同版本。完整 40 字元 commit 才能重現完全相同的 bytes。

可以另建 release tag 供人閱讀，但 runtime identity 仍使用 commit SHA。已被 pin 的 commit 不得 amend、rebase、squash 或 force-push。若內容有錯，建立新的 data commit 與新的 data release，不要改寫舊 identity。

本 repo 含大量語音，jsDelivr package／directory endpoint 可能拒絕整包。只使用三個已驗證的精確 JSON 檔案 URL，不把 `assets/audio/` 或 `assets/mandarin-audio/` 改走 GitHub CDN。

## 兩套版本的更新矩陣

| 變更 | Shell release/cache/query | Data URL/cache | CDN pin | Audio cache |
|---|---|---|---|---|
| 只改 HTML、CSS、JS、測試或文件 | 升版（純文件且不影響 Pages runtime 可不升） | 保持 | 保持 | 保持 |
| core/details/Mandarin index bytes 改變 | 升版 | 升 data release | 換成 data commit A | 依音檔判斷 |
| 只新增或更換音檔，JSON 路徑／metadata 也改變 | 升版 | 升 data release | 換 pin | 升版 |
| 只修 README／Agent 手冊 | 不必 | 保持 | 保持 | 保持 |

Shell 升版時必須同步 `app.js`、`sw.js`、`index.html`、`learning.js` 的 release 常數、shell cache 與所有 module／manifest query。UI-only release 絕對不能清除或重新命名仍相同的 data cache。

## 完整資料發布流程

### 1. 產生並檢查資料

依 README 與 `scripts/README.md` 重建：

- `data/dictionary-core.json`
- `data/dictionary-details.json`
- `data/mandarin-audio.json`（來源有變更時）
- `assets/audio/`、`assets/mandarin-audio/`（精確配對或來源有變更時）

先執行：

```bash
npm test
python3 -m unittest discover -s test -p 'test_*.py'
sha256sum data/dictionary-core.json data/dictionary-details.json data/mandarin-audio.json
```

同步核對 metadata、README、首頁容量、`learning.js`、OG SVG／PNG、`DATA-LICENSE.md` 與相關測試。不要把舊統計留在社群圖卡或說明文字。

### 2. 建立不可改寫的 data commit A

只在資料與必要音檔已定稿後提交：

```bash
git add data/ assets/audio/ assets/mandarin-audio/
git commit -m "data: refresh Taigi dictionary"
DATA_COMMIT="$(git rev-parse HEAD)"
test "${#DATA_COMMIT}" -eq 40
```

此後不得 amend A。先不要單獨 push，避免舊 App 的 Pages fallback 在 A、B 之間讀到新資料。

### 3. 建立引用 A 的 shell commit B

在 `app.js` 同步：

- 三個 canonical `?v=<DATA_RELEASE>`。
- `PRIMARY_DATA_BASE` 的完整 `DATA_COMMIT`。
- `DATA_CACHE`。
- core 內的 `DATA_REVISION`。
- Mandarin index 改變時的 `MANDARIN_AUDIO_SOURCE_VERSION`。
- 音檔內容或來源改變時的 `AUDIO_CACHE` 與容量文字。

在 `sw.js` 同步 `DATA_CACHE`、三個 `RUNTIME_DATA_FILES`、必要的 `AUDIO_CACHE`，並升 shell release。`LEGACY_DATA_CACHE` 是 v13 遷移橋；data release 不再是 13 時，必須移除或重新設計該橋，不能把舊 v13 bytes 搬進新 data cache。

再同步：

- `index.html`、`learning.js` 與所有 shell query。
- `test/ui.test.js`、`test/sw.test.js`、`test/data-loader.test.js`、`test/offline.test.js`。
- 資料／Mandarin／SEO 測試、README、本文件目前值及社群圖卡。

確認 B 沒有再次改動 A 的資料：

```bash
git diff --exit-code "$DATA_COMMIT" -- data/dictionary-core.json data/dictionary-details.json data/mandarin-audio.json
npm test
python3 -m unittest discover -s test -p 'test_*.py'
```

提交 B 後一次 push A、B。若 A 的 SHA 改變，必須重新更新 pin；不可留下指向不存在或不同內容的 SHA。

### 4. Push 後驗證 CDN 與 Pages

```bash
curl -fsSL "https://cdn.jsdelivr.net/gh/yazelin/mandarin-taigi@${DATA_COMMIT}/data/dictionary-core.json" -o /tmp/taigi-core.cdn.json
curl -fsSL "https://cdn.jsdelivr.net/gh/yazelin/mandarin-taigi@${DATA_COMMIT}/data/dictionary-details.json" -o /tmp/taigi-details.cdn.json
curl -fsSL "https://cdn.jsdelivr.net/gh/yazelin/mandarin-taigi@${DATA_COMMIT}/data/mandarin-audio.json" -o /tmp/taigi-mandarin.cdn.json
cmp data/dictionary-core.json /tmp/taigi-core.cdn.json
cmp data/dictionary-details.json /tmp/taigi-details.cdn.json
cmp data/mandarin-audio.json /tmp/taigi-mandarin.cdn.json
```

等待 Pages 與 CI 成功，再以 cache-busting query 下載正式站三檔並 `cmp`。最後用全新 profile 驗證首次載入、本機 cache keys、斷網重開、查詞與挑戰；另從上一個 PWA release 驗證升級。

## 失敗與 rollback

- CDN 失敗：保持 pin，確認 Pages fallback；不要臨時改成 `@main`。
- 新資料驗證失敗：建立新的修正 data commit／data release，不改寫舊 commit。
- CacheStorage 寫入失敗：保留已載入 bytes 供「重試儲存」，不可為了重試再次下載。
- v13 legacy 搬移任一檔失敗：保留整個 legacy cache；只有三檔都安全存在新 cache 才可刪除。
- Web 儲存仍可能因使用者清除網站資料、無痕模式或瀏覽器空間政策被移除；UI 不得宣稱絕對永久。
