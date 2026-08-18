# ThreadsFrame 取文代理

讓 ThreadsFrame 可以「貼上連結 → 自動帶入內容」的中繼服務。

## 為什麼需要它

網頁沒辦法直接讀 Threads 貼文：

- Threads 的所有端點都沒有回傳 `Access-Control-Allow-Origin`，瀏覽器一律擋下
- 貼文頁本身是 JS 算繪的空殼，抓回來也沒有內容
- 官方 oEmbed 需要 app token 與權限審核

但 Threads **會對爬蟲 UA 提供伺服器算繪版本**（連結預覽就是靠這個）。這支 Worker 在伺服器端
用爬蟲 UA 取得該版本，解析出作者、話題、內文、統計與圖片，再帶著 CORS 標頭回傳給前端。

圖片也必須經過這裡轉一手 —— `cdninstagram.com` 不給 CORS 標頭，前端若直接載入，
canvas 會被污染（tainted），匯出時 `toBlob` 會直接丟 `SecurityError`。

## 部署

需要一個 Cloudflare 帳號（免費方案就夠，這支服務不用 KV、D1 或任何密鑰）。

### 從自己的電腦

```sh
cd worker
npx wrangler login     # 開瀏覽器授權，只需一次
npx wrangler deploy
```

### 從 GitHub Actions（手機上也能部署）

`wrangler login` 要開瀏覽器授權，在雲端容器或手機上都跑不了。改用 API token 之後
`.github/workflows/deploy-worker.yml` 就會在 `worker/` 有改動並推上 `main` 時自動部署，
也可以在 Actions 分頁手動觸發。

設定一次即可，全程在瀏覽器完成：

1. Cloudflare 控制台 → My Profile → API Tokens → Create Token，
   套用 **Edit Cloudflare Workers** 範本，建立後複製那串 token（只會顯示一次）
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret，
   名稱 `CLOUDFLARE_API_TOKEN`，值貼上剛才那串
3. 帳號不只一個時再加一個 `CLOUDFLARE_ACCOUNT_ID`；只有一個帳號就不必，
   wrangler 會自己推斷

沒設 token 之前這個 workflow 會**跳過**部署而不是失敗 —— 免得在還沒設定的期間
每次改 worker 都留一個紅叉，久了真正的失敗也跟著被忽略。

部署完會印出網址，長得像：

```
https://threadframe-fetch.<你的帳號>.workers.dev
```

把它填進 app 的「自動帶入 → 取文服務網址」，按「測試連線」確認正常即可。
設定只存在該裝置的 localStorage，不會寫進程式碼。

手機上不想打長網址的話，可以直接開：

```
https://<你的 app 網址>/?worker=https://threadframe-fetch.<你的帳號>.workers.dev
```

開啟後設定會自動存起來，網址列的參數會被清掉。

## 端點

| 請求 | 回應 |
| --- | --- |
| `GET /` | `{"ok":true}` — 供前端測試連線 |
| `GET /?url=<threads 貼文網址>` | 貼文 JSON |
| `GET /?img=<圖片網址>` | 轉送圖片並補上 CORS 標頭 |

貼文 JSON 的欄位：`url`、`username`、`name`、`topic`、`verified`、`avatar`、`text`、`takenAt`、
`likes`、`replies`、`reposts`、`shares`、`images`、`comments`。

`comments` 是後加的欄位，**舊版部署不會回傳它** —— 前端把它當選用欄位，
沒有就退回留言手動輸入。完整規格見 [API.md](API.md)。

## 限制與注意事項

- **這不再是「資料不離開裝置」**。啟用後，你貼上的連結會送到這支服務去取內容。
  它由你自己部署、自己掌控，但性質上已經與純本機不同。app 的設定畫面也有寫明。
- **依賴 Meta 的頁面結構**。Threads 改版時解析會失效，Worker 會回傳
  `not_found` 並附上說明，前端會提示改用手動貼上，不會直接壞掉。
- **讀不到私人帳號的貼文**。爬蟲 UA 拿到的與一般人看到的公開內容相同。
- **可能遇到速率限制**。個人使用的量級通常不會碰到，但大量請求可能被 Meta 擋。
- 圖片代理有主機白名單（只放行 `cdninstagram.com` 與 `fbcdn.net`），
  避免這支 Worker 變成任何人都能用的開放代理。
