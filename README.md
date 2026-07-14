# 國台語詞語對照

一個不需登入、不需 API key、可在 GitHub Pages 離線使用的華語／臺灣台語詞語對照工具。

線上版：https://yazelin.github.io/mandarin-taigi/

分享連結時會使用 `assets/og-image.png` 的 1200 × 630 Open Graph 圖卡；首頁也包含 canonical、Open Graph、Twitter Card、JSON-LD 與 sitemap metadata。

## 這個版本提供什麼

- 可用華語詞目、臺灣台語漢字或臺羅搜尋；除官方「詞彙比較」外，也完整納入 5,548 筆「臺華共同詞」。
- 臺羅搜尋接受聲調符號或數字調，例如 `pīnn-īnn`、`pinn7-inn7` 都能找到「醫院」。
- 顯示教育部資料中的臺灣台語漢字、臺羅與 10 種腔口標示。
- 只有漢字與臺羅都能精確對上官方詞條時，才提供教育部原始台語發音。
- 98 個精確對上的單字詞優先使用教育部《國語辭典簡編本》原始「單字屬性聲音」WAV；未收錄的多字詞只使用裝置內建的本機華語 voice。
- 每局從完整詞庫中可唯一判定的候選完全隨機抽 10 題「聽台語猜華語」四選一；題目與正確答案不重複，歧義詞不會拿來硬判單一答案。
- 答錯詞語會存在本機錯題本，並可用學習卡複習；同一詞連續答對兩次視為掌握。
- 完成挑戰可產生不洩題的 PNG 成績圖卡；支援系統分享時直接分享，不支援時下載圖卡並嘗試複製文字連結。
- 網站與詞庫首次載入後可離線查詢；6,607 個台語 MP3（約 108 MB）與 98 個華語 WAV（約 39 MB）會嘗試在播放後快取，也可各自一次下載以確保完整離線播放。
- 裝置找不到可用華語 voice，或播放未真正開始時，會停用或明確報錯，不再假裝已播放。
- 純靜態網站，沒有後端、帳號、追蹤碼或第三方 AI 呼叫；成績、錯題與學習卡只存在這台裝置。
- 大按鈕、鍵盤焦點與清楚的播放狀態，方便長輩與觸控操作。

這是詞語對照辭典，不是任意句子的 AI 翻譯器，也不是完整文字轉語音服務。沒有收錄的詞不會用模型猜答案。Chrome 新聞長文朗讀是另一個獨立專案：[taigi-news-reader](https://github.com/yazelin/taigi-news-reader)。

同類服務與互動設計也參考了 [iTaigi 愛台語](https://itaigi.tw/)；本站沒有取用或重製其資料。

## 官方資料與授權

華台詞語對照與台語音檔來自中華民國教育部《臺灣台語常用詞辭典》：

- [官方辭典](https://sutian.moe.edu.tw/zh-hant/)
- [資料下載頁](https://sutian.moe.edu.tw/zh-hant/siongkuantsuguan/)
- [版權聲明](https://sutian.moe.edu.tw/zh-hant/piantsip/pankhuan-singbing/)
- [音檔說明](https://sutian.moe.edu.tw/zh-hant/piantsip/imtong-suatbing/)

98 個華語單字音來自中華民國教育部（Ministry of Education, R.O.C.）《國語辭典簡編本》（版本 `2014_20260626`）：

- [官方辭典](https://dict.concised.moe.edu.tw/)
- [公眾授權資料下載](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/dict_concised_download.html)
- [完整使用說明](licenses/conciseddict-usage.pdf)

兩種官方資料表與音檔皆採 CC BY-ND 3.0 TW。本 repo 將它們整合成同一份可搜尋詞庫，只做格式轉換、精確配對與搜尋呈現；錄音保持原始位元組，沒有轉碼、裁切或串接，網站也不是教育部官方服務。細節見 [DATA-LICENSE.md](DATA-LICENSE.md)。程式碼採 MIT License，這個授權不涵蓋教育部資料及音檔。

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

轉換只保留官方原文、建立表格間關聯，將「詞彙比較」與「臺華共同詞」完整整合進同一份 schema，並保留每筆來源類型；再以漢字＋臺羅完全相等做音檔配對，不做模糊比對或內容改寫。

華語官方音檔需另下載《國語辭典簡編本》文字 ZIP（約 7 MB）與單字音 WAV ZIP（約 1.5 GB）。解壓文字 XLSX 後，腳本只抽出本站 98 個精確單字詞的官方首要讀音，約 39 MB；多字詞的「釋義朗讀」不會冒充詞目發音：

```bash
curl -L -o /tmp/dict-concised.zip \
  https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/download/dict_concised_2014_20260626.zip
curl -L -o /tmp/dict-concised-word-audio.zip \
  https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/download/dict_concised_music_word_2014_20260626.zip
unzip /tmp/dict-concised.zip -d /tmp/dict-concised
python3 scripts/build_mandarin_audio.py \
  data/dictionary.json \
  /tmp/dict-concised/dict_concised_2014_20260626.xlsx \
  /tmp/dict-concised-word-audio.zip \
  data/mandarin-audio.json \
  assets/mandarin-audio \
  --source-version 2014_20260626
```

## 與 wish-pool #26 的關係

這個 repo 是「正宗台灣國語與台語語音系統（網頁版）」的第一個正確里程碑：先交付基本、可離線、無金鑰的詞語與唸法對照。原願望中的任意文字／文件輸入與完整雙語 TTS 尚未完成，因此不能把這個版本當作整個願望結案。
