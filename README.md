# ThreadFrame 手機版

把 Threads 貼文排版成可下載的分享圖。這是 [ThreadFrame Chrome 擴充功能](https://chromewebstore.google.com/detail/kobbonidbbkkapfmomclplnogpmamiai) 的手機版 —— 一個可以加到主畫面的 PWA。

## 為什麼手機版不能自動帶入貼文

擴充功能是 content script，跑在 threads.com 頁面裡，直接讀你正在看的那則貼文的 DOM，所以能自動同步作者、頭像、內文、留言。**網頁做不到這件事** —— 它不能讀別的網站的 DOM，只能發 HTTP 請求，而 Threads 沒有任何對瀏覽器開放跨網域的入口：

| 入口 | 結果 |
| --- | --- |
| `graph.facebook.com/…/oembed_threads` | 400，需要 app token 與權限審核 |
| `www.threads.com/oembed` | 302，沒有公開 JSON |
| `/@user/post/CODE/embed` | 200 有內容，但回應沒有 `Access-Control-Allow-Origin` |
| 貼文頁 HTML | 內容需登入態；profile 頁是 JS 算繪，初始 HTML 沒有貼文資料 |

要自動帶入就必須架一台伺服器代抓，那會讓貼文內容經過第三方主機，也會隨 Meta 改版而失效。這個版本選擇不走那條路：**內容由你貼上，排版在本機完成。**

好處是它永遠不會因為對方改版而壞掉，而且「資料不離開裝置」是真的 —— 沒有任何後端可以送。

## 用法

1. 在 Threads 上複製貼文（長按 → 複製連結，或直接選取文字複製）
2. 貼進 App 的貼上區，按「帶入卡片」—— 名稱、帳號、時間、統計數字會盡量自動拆解
3. 每個欄位都能手動修，頭像和貼文圖片從相簿選
4. 挑背景、調排版，按「存成圖片」

裝到主畫面後也能從 Threads 的分享選單直接分享過來（Web Share Target，Android 支援；iOS 目前不支援分享目標，用複製貼上）。

## 功能

- 14 種內建漸層底圖 ＋ 自訂底圖
- 留白、文字尺寸、圓角、底板透明度、底板色、文字色
- 比例：直式 4:5 / 方形 / 自動高度
- 顯示切換：頭像、互動統計、時間、貼文圖片、原始網址
- 遮蔽作者身分（名稱、帳號、頭像一起蓋掉）
- 1–4 張貼文圖片，完整顯示不裁切
- 輸出固定 1080px 寬，與裝置螢幕無關

## 開發

```sh
npm install
npm run dev      # 開發伺服器
npm run build    # 型別檢查 + 打包到 dist/
npm run preview  # 預覽打包結果
npm run icons    # 重新產生 public/icons/*.png
```

算繪走 Canvas 2D（`src/render.ts`），不是 DOM 截圖 —— 輸出尺寸才能固定，也避開 `html2canvas` 那類方案在 iOS Safari 上的光柵化失敗。

## 隱私

沒有後端。貼文內容、圖片、自訂底圖都只在瀏覽器記憶體裡，重新整理就消失；只有排版偏好會寫進 `localStorage`。
