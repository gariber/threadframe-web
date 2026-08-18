# ThreadsFrame 取文代理 — 介面規格

實作在 [`src/index.js`](src/index.js)，單一檔案、零外部相依。
這份文件描述的是**實際部署中的行為**，不是計畫。

前端寫死了一個預設位址（`src/config.ts` 的 `DEFAULT_WORKER`），
localStorage 的 `threadframe.worker` 可以覆蓋它，存空字串則停用自動帶入。
因為位址公開，Worker 有來源白名單與速率限制（見下方）。

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

成功回應 `200`，附 `access-control-allow-origin`（回填實際 Origin）與
`cache-control: public, max-age=300`：

```jsonc
{
  "url": "https://www.threads.com/@_fy_1005/post/DbgSoa2AXY_",  // 正規化後的貼文網址，query 已去除
  "username": "_fy_1005",     // string，帳號（不含 @）
  "name": "渢乙",              // string，顯示名稱；沒有時退回 username
  "topic": "喜劇開場",         // string | null，Threads 話題；與正文分開
  "verified": false,          // boolean
  "avatar": "https://…",      // string | null，頭像原始網址（需經 ?img= 代理才能用於 canvas）
  "text": "12年前在…",         // string，保留原始換行與空行
  "takenAt": 1785602450,      // number | null，Unix 秒
  "likes": 740,               // number | null
  "replies": 9,               // number | null
  "reposts": 12,              // number | null
  "shares": 18,               // number | null
  "images": ["https://…"],    // string[]，最多 4 張，原始網址（同樣需經 ?img= 代理）
  "comments": [               // 最多 6 則，依讚數由高到低（見「留言的挑選」）
    {
      "username": "alice",    // string
      "name": "渢乙",          // string，顯示名稱；沒有時退回 username
      "avatar": "https://…",  // string | null，同樣需經 ?img= 代理
      "text": "推",            // string
      "likes": 12,            // number | null
      "takenAt": 1785602450,  // number | null，Unix 秒
      "image": "https://…"    // string | null，留言自己帶的圖，只取第一張
    }
  ]
}
```

數值欄位在來源缺該欄時為 `null`，不是 `0` —— 呼叫端才分得出「沒有這個數字」
與「數字是零」。`text` 保留原始換行與空行。

`topic` 取自目標貼文的 `text_post_app_info.tag_header.display_name`；沒有話題時為
`null`。它不是從 caption 或 hashtag 猜出來的，因此不會把正文的一部分重複畫進標題。

`comments` 是後加的欄位，**舊版部署不會回傳它**，呼叫端要能接受它不存在
（前端的型別標成選用）。留言也不保證抓得到：拿到不含留言的頁面變體時會是空陣列。

### `GET /?img=<圖片網址>`

轉送圖片並補上 CORS 標頭。**這條路徑不是為了省事，是必要的**：
`cdninstagram.com` 不回 CORS 標頭，前端若直接載入，canvas 會被污染
（tainted），匯出時 `toBlob` / `toDataURL` 會丟 `SecurityError`。

回應為圖片本體，`content-type` 沿用上游，附 `access-control-allow-origin`
（回填實際 Origin）與 `cache-control: public, max-age=86400`。

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
| 404 | `post_unavailable` | Threads 把貼文頁轉到 `?error=invalid_post`：敏感內容、私人帳號或已刪除 |
| 404 | `not_found` | 抓到貼文頁卻解析不出內容，通常代表 Threads 改版 |
| 403 | `origin_not_allowed` | 帶了 `Origin` 但不在來源白名單 |
| 405 | `method_not_allowed` | 非 GET |
| 429 | `rate_limited` | 超過每 IP 每分鐘 60 次，附 `retry-after: 60` |
| 502 | `upstream` | 重試 3 次仍拿不到回應，另附 `status` 欄位帶上游狀態碼 |

`404` 與 `502` 的區分是刻意的：前者是這則貼文的問題，後者是暫時性的，
訊息會請使用者稍後再試。

兩種 `404` 也要分開看。`post_unavailable` 是 Threads 明講不給未登入的人讀，
重試與改程式都沒有用，只能請使用者改走手動貼上；`not_found` 是頁面抓到了卻
挖不出資料，那才是該來修這支 Worker 的訊號。實測「內容受限」與「短碼不存在」
轉到的網址一模一樣，Threads 不區分，所以 `post_unavailable` 的訊息只能兩種都提。

---

## 行為細節

### 重試

`?url=` 最多嘗試 3 次，間隔 0 / 600ms / 1200ms。以下兩種情況都會重試：

- 上游回非 2xx（短暫限流）
- 上游回 200 但頁面裡找不到內嵌資料（偶爾會拿到精簡版頁面）

沒有重試的話，同一條連結會時好時壞，使用者看到的是隨機失敗。

**只有第一次走邊緣快取，重試一律繞過。** 失敗的回應也會被存進快取，
照著快取重試等於把同一個錯誤再讀兩次 —— 三次嘗試實際上只嘗試了一次，
而且在那 300 秒內每一次請求都會撞到同一份失敗。症狀是「連按幾次都失敗，
過幾分鐘卻自己好了」。

### 快取

| 對象 | 機制 | TTL |
| --- | --- | --- |
| Threads 頁面（子請求） | `cf: { cacheTtl, cacheEverything }` | 300 秒 |
| 圖片（子請求） | `cf: { cacheTtl, cacheEverything }` | 86400 秒 |
| 回給前端的 JSON | `cache-control` 標頭 | 300 秒 |
| 回給前端的圖片 | `cache-control` 標頭 | 86400 秒 |

**沒有使用 Cache API（`caches.default`）**。

### 來源限制與 rate limit

位址是公開的（寫死在前端當預設值），所以有四道保護：

| 保護 | 內容 |
| --- | --- |
| 來源白名單 | 帶 `Origin` 的請求必須來自 `gariber.github.io` 或 localhost，否則 403 `origin_not_allowed`。沒有 `Origin` 的（curl、瀏覽器直接開網址）放行，方便健康檢查與除錯 |
| 速率限制 | 每 IP 每分鐘 60 次，超過回 429 `rate_limited` 並附 `retry-after: 60` |
| 貼文主機白名單 | `?url=` 只接受 Threads 網域，否則 400 |
| 圖片主機白名單 | `?img=` 只接受 `cdninstagram.com` 與 `fbcdn.net`（正則 `/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i`），避免變成開放圖片代理 |

CORS 回應會回填實際的 `Origin` 而不是 `*`，並帶 `vary: Origin`。

**速率限制是盡力而為，不是精確配額。** Worker 無狀態，計數存在單一 isolate
的記憶體裡，跨 isolate 不共享 —— 擋得住單點狂打，擋不住分散式濫用。
要精確配額得綁 KV 或 Durable Objects。

### 圖片尺寸

`image_versions2.candidates` 什麼尺寸都有（實測 150 到 2268 都見過）。實作挑
**寬度 ≥ 需求之中最小的那一張**，都不到需求時取最大。需求依用途分兩級：

| 圖片 | 需求寬度 | 理由 |
| --- | --- | --- |
| 單圖貼文、輪播的第一張 | 1080 | 卡片輸出寬度固定 1080px，可能單獨佔滿整個寬度 |
| 輪播的第二張以後 | 540 | 只會出現在格狀排列裡，每格最寬是一半，三欄時只有三分之一 |

輪播第一張維持大張，是因為使用者可以把「圖片數目」設成 1，那時它會佔滿卡片。

實測差距不小：某則三圖貼文全部取 1080 是 **433KB**，改成第一張 1080、其餘 640
之後是 **213KB**（省 51%），而第二、三張實際只畫到約 320px 寬，看不出差別。

輪播貼文取 `carousel_media` 各項，單圖取貼文本身，**最多 4 張**。

### 解析方式

分兩步，解析成本實測約 10ms，不是瓶頸。

`scanPosts`：在 HTML 裡掃 `"post":{`，用括號配對切出完整 JSON 物件後
`JSON.parse`，收下同時具備 `user.username` 與 `caption` 的物件，維持頁面順序，
以 `code` 去重（同一則會在討論串本體、預載資料、推薦區各嵌一份），最多 60 個。

`splitThread`：**主貼文永遠排在最前面、留言排在後面**，而物件本身沒有
`parent` / `reply` 之類的欄位可用 —— 順序是唯一的線索。因此比對網址短碼找出
主體，排在它後面的全部視為它的留言；短碼對不上時退回第一個並回報
`exact: false`，由外層決定要不要重試（見「重試」）。

貼留言的連結時，主體是那則留言，`comments` 則是它後面的回覆 —— 不是原 PO
底下的其他留言。

### 留言的挑選

`comments` **依讚數由高到低排序後才截斷**，不是照頁面順序取前幾則。

這一步必須在 Worker 做。實測某則貼文掃出 59 則留言，讚數最高的那則（55 讚）
排在頁面順序的第 8 位 —— 照順序取前 6 則會整個漏掉它，而前端只收得到這份
清單，它自己再怎麼排也救不回沒送出去的那些。

留言的 `image` 只取第一張，尺寸取 ≥540（卡片上畫得比貼文小）。整組輪播攤開
會把卡片撐得很長，留言區要保持精簡。

欄位對應：

| 輸出 | 來源 |
| --- | --- |
| `likes` | `post.like_count` |
| `replies` | `text_post_app_info.direct_reply_count` ?? `post.reply_count` |
| `reposts` | `text_post_app_info.repost_count` |
| `shares` | `text_post_app_info.reshare_count` |
| `text` | `post.caption.text` |
| `topic` | `post.text_post_app_info.tag_header.display_name` |
| `takenAt` | `post.taken_at` |
| `comments[].name` | `user.full_name` ?? `user.username` |
| `comments[].avatar` | `user.profile_pic_url` |
| `comments[].likes` | `post.like_count` |

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

- **讀不到需要登入才看得到的貼文**。爬蟲 UA 取得的內容與未登入者看到的公開內容相同，
  因此私人帳號、已刪除，以及**被判定為敏感內容**的貼文都讀不到 —— 後者在登入的
  瀏覽器裡看得好好的，未登入卻整則 302 到 `?error=invalid_post`，連內文與統計都拿不到。
  這類一律回 `404 post_unavailable`。
- **依賴 Meta 的頁面結構**。Threads 改版時 `scanPosts` 會失效，回 `404 not_found`，
  前端提示改用手動貼上，不會整個壞掉。
- **留言只能靠順序判斷**。內嵌的 post 物件沒有指回父貼文的欄位，只能用「排在主體
  之後」當作留言。Threads 若改變區塊順序，帶出來的留言就可能不是那一則的；
  前端的留言欄位一律可以改寫或刪除。
- **留言不含巢狀回覆的層級**。回覆的回覆一樣攤平在同一串裡，看不出縮排關係。
- **影片只取封面圖**。輪播中的影片項目會取 `image_versions2` 的封面，不取影片本身。
- **不再是「資料完全不離開裝置」**。啟用後貼文連結會送到這支服務。
