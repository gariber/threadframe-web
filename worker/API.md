# ThreadFrame 取文代理 — 介面規格

實作在 [`src/index.js`](src/index.js)，單一檔案、零外部相依、184 行。
這份文件描述的是**實際部署中的行為**，不是計畫。

部署位址由使用者自行決定（Cloudflare Worker），前端把它存在 localStorage
的 `threadframe.worker`，沒有寫死在程式碼裡。

---

## 為什麼需要它

Threads 的所有端點都不回 `Access-Control-Allow-Origin`，瀏覽器一律擋下；
貼文頁本身是 JS 算繪的空殼，抓回來也沒有內容；官方 oEmbed 需要 app token
與權限審核（實測 `graph.facebook.com/…/oembed_threads` 回 400）。

但 Threads **會對爬蟲 UA 提供伺服器算繪版本**（連結預覽用的就是這份），
裡面內嵌了完整的貼文 JSON。Worker 做兩件事：換 UA 取得該版本並解析，
以及補上 CORS 標頭。

---

## 端點

三個，全部走 `GET`，都在同一個路徑上用 query 參數區分。

### `GET /`

健康檢查。前端的「測試連線」用它判斷網址填對了沒有。

```json
{ "ok": true, "usage": "?url=<threads 貼文網址> 或 ?img=<圖片網址>" }
```

### `GET /?url=<貼文網址>`

取得貼文資料。網址需 URL-encode。

接受的連結型態（`hostname` 必須是 `threads.com` / `www.threads.com` /
`threads.net` / `www.threads.net`，其餘一律 400）：

| 型態 | 例 |
| --- | --- |
| 網頁版網址列 | `/@user/post/CODE` |
| 舊短連結 | `/t/CODE` |
| 手機 app「複製連結」 | `/share/CODE` |
| 少數情況 | `/p/CODE` |

成功回應 `200`，附 `access-control-allow-origin: *` 與
`cache-control: public, max-age=300`：

```jsonc
{
  "url": "https://www.threads.com/@_fy_1005/post/DbgSoa2AXY_",  // 正規化後的貼文網址，query 已去除
  "username": "_fy_1005",     // string，帳號（不含 @）
  "name": "渢乙",              // string，顯示名稱；沒有時退回 username
  "verified": false,          // boolean
  "avatar": "https://…",      // string | null，頭像原始網址（需經 ?img= 代理才能用於 canvas）
  "text": "12年前在…",         // string，保留原始換行與空行
  "takenAt": 1785602450,      // number | null，Unix 秒
  "likes": 740,               // number | null
  "replies": 9,               // number | null
  "reposts": 12,              // number | null
  "shares": 18,               // number | null
  "images": ["https://…"]     // string[]，最多 4 張，原始網址（同樣需經 ?img= 代理）
}
```

數值欄位在來源缺該欄時為 `null`，不是 `0` —— 呼叫端才分得出「沒有這個數字」
與「數字是零」。`text` 保留原始換行與空行。

### `GET /?img=<圖片網址>`

轉送圖片並補上 CORS 標頭。**這條路徑不是為了省事，是必要的**：
`cdninstagram.com` 不回 CORS 標頭，前端若直接載入，canvas 會被污染
（tainted），匯出時 `toBlob` / `toDataURL` 會丟 `SecurityError`。

回應為圖片本體，`content-type` 沿用上游，附
`access-control-allow-origin: *` 與 `cache-control: public, max-age=86400`。

前端載入時必須設 `img.crossOrigin = "anonymous"`，否則即使有 CORS 標頭
canvas 一樣會被污染。

---

## 錯誤

一律回 JSON，含 `error` 代碼與可直接顯示給使用者的 `message`。

| HTTP | `error` | 情境 |
| --- | --- | --- |
| 400 | `bad_url` | 參數不是合法網址 |
| 400 | `not_threads` | 主機不在 Threads 白名單 |
| 403 | `host_not_allowed` | `?img=` 的主機不是 Meta CDN |
| 404 | `not_found` | 有回應但解析不到貼文：私人帳號、已刪除，或 Threads 改版 |
| 405 | `method_not_allowed` | 非 GET |
| 502 | `upstream` | 重試 3 次仍拿不到回應，另附 `status` 欄位帶上游狀態碼 |

`404` 與 `502` 的區分是刻意的：前者是這則貼文的問題，後者是暫時性的，
訊息會請使用者稍後再試。

---

## 行為細節

### 重試

`?url=` 最多嘗試 3 次，間隔 0 / 400ms / 800ms。以下兩種情況都會重試：

- 上游回非 2xx（短暫限流）
- 上游回 200 但頁面裡找不到內嵌資料（偶爾會拿到精簡版頁面）

沒有重試的話，同一條連結會時好時壞，使用者看到的是隨機失敗。

### 快取

| 對象 | 機制 | TTL |
| --- | --- | --- |
| Threads 頁面（子請求） | `cf: { cacheTtl, cacheEverything }` | 300 秒 |
| 圖片（子請求） | `cf: { cacheTtl, cacheEverything }` | 86400 秒 |
| 回給前端的 JSON | `cache-control` 標頭 | 300 秒 |
| 回給前端的圖片 | `cache-control` 標頭 | 86400 秒 |

**沒有使用 Cache API（`caches.default`）**。

### Rate limit

**沒有實作。** 沒有計數、沒有配額、沒有驗證。任何知道網址的人都能呼叫。

保護只有兩道主機白名單：`?url=` 限 Threads 網域，`?img=` 限
`cdninstagram.com` 與 `fbcdn.net`（正則 `/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i`）。
後者是為了避免這支 Worker 變成任何人都能用的開放圖片代理。

如果要公開分享這個部署位址，rate limit 得另外加。

### 圖片尺寸

`image_versions2.candidates[0]` 是最大張（常見 1500px 以上）。實作會挑
**寬度 ≥ 1080 之中最小的那一張**，都不到 1080 時取最大。卡片輸出寬度固定
1080px、多圖時每格僅 540px，傳最大張純粹浪費頻寬。

輪播貼文取 `carousel_media` 各項，單圖取貼文本身，**最多 4 張**。

### 解析方式

在 HTML 裡掃 `"post":{`，用括號配對切出完整 JSON 物件後 `JSON.parse`，
取第一個同時具備 `user.username` 與 `caption` 的物件（留言的 post 物件
排在主貼文之後）。解析成本實測約 10ms，不是瓶頸。

欄位對應：

| 輸出 | 來源 |
| --- | --- |
| `likes` | `post.like_count` |
| `replies` | `text_post_app_info.direct_reply_count` ?? `post.reply_count` |
| `reposts` | `text_post_app_info.repost_count` |
| `shares` | `text_post_app_info.reshare_count` |
| `text` | `post.caption.text` |
| `takenAt` | `post.taken_at` |

### 使用的 UA

```
Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
```

實測 Twitterbot、WhatsApp、Discordbot 也能讓 share 連結解析成正規貼文網址並
取得 OG meta，但**只有 Googlebot 那份回應含完整內嵌 JSON**（其餘是精簡頁面，
約 100KB，只有 OG 標籤）。`facebookexternalhit` 會被導向登入頁，不可用。

---

## 效能實測

| 項目 | 實測 |
| --- | --- |
| Threads 伺服器回應 | **1.1–1.7 秒** |
| 回應大小 | 約 650–900 KB |
| 解析 | 約 10 ms |
| 圖片（每張，經代理） | 0.27–0.93 秒 |

值得注意：把請求換成 55KB 的 `/embed` 頁面，耗時**仍是 1.19 秒**——
瓶頸是 Threads 自己的回應時間，不是傳輸量，減少 payload 幫不上忙。

這也是手機網頁追不上擴充功能與 X 版的原因：X 有公開的輕量 JSON 端點
（`cdn.syndication.twimg.com`）可讓瀏覽器直接呼叫，Threads 沒有對應的東西，
必須多繞 Worker 一趟，圖片還要再繞一趟。

---

## 已知限制

- **讀不到私人帳號的貼文**。爬蟲 UA 取得的內容與未登入者看到的公開內容相同。
- **依賴 Meta 的頁面結構**。Threads 改版時 `findPost` 會失效，回 `404 not_found`，
  前端提示改用手動貼上，不會整個壞掉。
- **留言抓不到**。內嵌 JSON 裡有留言結構，但目前沒有解析；前端的留言一律手動輸入。
- **影片只取封面圖**。輪播中的影片項目會取 `image_versions2` 的封面，不取影片本身。
- **不再是「資料完全不離開裝置」**。啟用後貼文連結會送到這支服務。
