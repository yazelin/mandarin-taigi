# 國台語詞語對照

一個不需登入、不需 API key、可在 GitHub Pages 離線使用的華語／臺灣台語詞語對照工具。

線上版：https://yazelin.github.io/mandarin-taigi/

## 這個版本提供什麼

- 可用華語詞目、臺灣台語漢字或臺羅搜尋。
- 顯示教育部資料中的臺灣台語漢字、臺羅與 10 種腔口標示。
- 只有漢字與臺羅都能精確對上官方詞條時，才提供教育部原始發音。
- 網站與詞庫首次載入後可離線查詢；音檔可按需快取或一次下載。
- 純靜態網站，沒有後端、帳號、追蹤碼或第三方 AI 呼叫。
- 大按鈕、鍵盤焦點與清楚的播放狀態，方便長輩與觸控操作。

這是詞語對照辭典，不是任意句子的 AI 翻譯器，也不是完整文字轉語音服務。沒有收錄的詞不會用模型猜答案。Chrome 新聞長文朗讀是另一個獨立專案：[taigi-news-reader](https://github.com/yazelin/taigi-news-reader)。

## 官方資料與授權

文字與音檔來自中華民國教育部《臺灣台語常用詞辭典》：

- [官方辭典](https://sutian.moe.edu.tw/zh-hant/)
- [資料下載頁](https://sutian.moe.edu.tw/zh-hant/siongkuantsuguan/)
- [版權聲明](https://sutian.moe.edu.tw/zh-hant/piantsip/pankhuan-singbing/)
- [音檔說明](https://sutian.moe.edu.tw/zh-hant/piantsip/imtong-suatbing/)

辭典文字與音檔採 CC BY-ND 3.0 TW。本 repo 只做格式轉換與搜尋呈現，未修改資料或錄音；網站不是教育部官方服務。細節見 [DATA-LICENSE.md](DATA-LICENSE.md)。程式碼採 MIT License，這個授權不涵蓋教育部資料及音檔。

## 本機執行

```bash
npm test
npm run serve
```

開啟 http://localhost:4173/。Service Worker 需要透過 `localhost` 或 HTTPS 才能工作。

## 重新產生詞庫

不把數百 MB 的官方來源壓縮檔提交進 Git。先下載到暫存位置，再用標準庫腳本產生 JSON，並只抽出可精確配對的 MP3：

```bash
curl -L -o /tmp/kautian.ods https://sutian.moe.edu.tw/media/senn/ods/kautian.ods
curl -L -o /tmp/sutiau-mp3.zip https://sutian.moe.edu.tw/media/senn/sutiau-mp3.zip
python3 scripts/build_dictionary.py \
  /tmp/kautian.ods \
  data/dictionary.json \
  --audio-zip /tmp/sutiau-mp3.zip \
  --audio-output assets/audio \
  --source-updated 2026-07-13
python3 -m unittest discover -s test -p 'test_*.py'
```

轉換只保留官方原文、建立表格間關聯，並以漢字＋臺羅完全相等做音檔配對；不做模糊比對或內容改寫。

## 與 wish-pool #26 的關係

這個 repo 是「正宗台灣國語與台語語音系統（網頁版）」的第一個正確里程碑：先交付基本、可離線、無金鑰的詞語與唸法對照。原願望中的任意文字／文件輸入與完整雙語 TTS 尚未完成，因此不能把這個版本當作整個願望結案。
