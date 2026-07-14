# Repository agent instructions

在修改詞庫、快取、CDN、Service Worker、語音資產或版本號以前，必須完整閱讀
[`docs/DATA-RELEASE.md`](docs/DATA-RELEASE.md)。對話紀錄不是發布規格，該文件才是此 repo 的長期交接依據。

## 不可破壞的規則

- App shell 與 dictionary data 是兩套版本。純 UI／程式更新只升 shell，不得順手更換 data URL、`DATA_CACHE` 或 CDN pin。
- 正式 CDN URL 只能使用完整 40 字元 commit SHA。不得使用短 SHA、`@main`、其他 branch、`@latest` 或可移動 tag。
- CDN 回應必須先通過 schema、revision、筆數及音檔路徑驗證，才能以同源 canonical URL 寫入 `DATA_CACHE`。Service Worker 不得直接保存未驗證 JSON。
- CDN pin 必須指向已包含最終資料的 data commit。建立 pin 後不得 amend、rebase、squash 或 force-push 改寫該 commit。
- 資料發布使用兩個本機 commit：A 是最終資料，B 才引用 A 的完整 SHA；A、B 一起 push，避免 Pages fallback 與舊 App 短暫不相容。
- `LEGACY_DATA_CACHE`／`LEGACY_DATA_CACHES` 是 shell-v13 → data-v13 的一次性相容橋，不是一般資料版號。下一次 data release 必須依手冊重新評估或移除。
- 音檔 cache 與文字 data cache 分開。只有音檔 bytes、來源版本或同 URL 內容改變時才升 `AUDIO_CACHE`。
- 不可手動改寫教育部原文或生成 JSON；使用 `scripts/` 建置器，並保留舊版仍可能引用的音檔。

## 完成條件

- 執行 `npm test` 與 `python3 -m unittest discover -s test -p 'test_*.py'`。
- 依手冊驗證 pinned commit、工作樹、CDN 與 GitHub Pages 的每一份資料 bytes 相同。
- 用全新瀏覽器驗證首次載入，再斷網重開；資料更新另須驗證舊版升級路徑。
- 同步 README、畫面容量／統計、OG 圖卡、測試與本手冊的「目前正式契約」。
