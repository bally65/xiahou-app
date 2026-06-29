# 蝦猴採集 PWA — 安裝到手機(Android + iPad/iPhone)

這是一個 **PWA(漸進式網頁 App)**:不必上架商店,放到一個 **HTTPS 網址**,手機瀏覽器打開 →「加到主畫面」就變成可離線使用的 App。相機/GPS **必須 HTTPS**(或 localhost)才能用。

## 檔案(全部在 `app/` 資料夾)
`index.html · app.js · sw.js · manifest.webmanifest · icon-192.png · icon-512.png · vendor/jsQR.js`
→ 整個資料夾一起部署即可(純靜態,無後端)。

## 最快上線(免費 HTTPS,擇一)

### A. GitHub Pages(免費、穩定)
1. 開一個 repo(可設 Private),把 `app/` 裡的檔案放到 repo 根目錄(或 `docs/`)。
2. Settings → Pages → Branch = main、資料夾選根目錄(或 /docs)→ Save。
3. 幾分鐘後得到 `https://<你的帳號>.github.io/<repo>/` → 手機開這個網址。

### B. Netlify / Cloudflare Pages(拖拉即部署)
- Netlify:登入 → 「Add new site → Deploy manually」→ 把 `app/` 資料夾**拖進去** → 得到 `https://xxx.netlify.app`。
- Cloudflare Pages 類似,也免費、有 HTTPS。

### C. 本機測試(同一台電腦)
`cd app && python3 -m http.server 5599` → 電腦瀏覽器開 `http://localhost:5599`(localhost 允許相機)。手機要連同一網路且需 HTTPS,故手機測試請用 A/B。

## 手機安裝(加到主畫面)
- **Android(Chrome)**:開網址 → 右上 ⋮ →「安裝應用程式 / 加到主畫面」。
- **iPad / iPhone(Safari,iOS 必須用 Safari)**:開網址 → 分享鈕 →「加入主畫面」。
- 裝好後從主畫面圖示開啟 = 全螢幕、可離線。**首次需連網**載入一次(之後離線可用)。

## 權限
首次拍照會問**相機**、首次拍照記點會問**定位** → 都要「允許」。iOS 定位請選「使用 App 期間」。

## 注意
- 資料只存在**手機本機(IndexedDB)**;請定期用「⬇️ 匯出全部備份(JSON)」下載備份。**雲端自動上傳是下一版**(需 Supabase/R2 後端帳號)。
- iOS 若長期不開、清快取可能清掉本機資料 → 養成**拍完當天匯出備份**習慣;裝成主畫面 App 較不會被清。
- QR 掃描、4 角點比例尺、tap 標註、離線儲存皆已內建可離線。
