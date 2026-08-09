/**
 * ThreadFrame 取文代理（Cloudflare Worker）
 *
 * 網頁沒辦法直接讀 Threads 貼文：Threads 的任何端點都沒有開放跨網域，
 * 貼文頁本身又是 JS 算繪的空殼。這支 Worker 在伺服器端用爬蟲 UA 取得
 * 伺服器算繪版本，解析出作者、內文、統計與圖片，再帶著 CORS 標頭回傳。
 *
 * 圖片也必須經過這裡轉一手 —— cdninstagram 不給 CORS 標頭，前端若直接
 * 載入，canvas 會被污染（tainted），匯出時 toBlob 會直接丟 SecurityError。
 *
 * 位址是公開的（寫死在前端當預設值），所以有兩道保護：
 * 來源網域白名單，以及每 IP 速率限制。
 */

const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const POST_HOSTS = new Set(["threads.com", "www.threads.com", "threads.net", "www.threads.net"]);

/** 圖片只放行 Meta 自家的 CDN，否則這支 Worker 會變成任何人都能用的開放代理。 */
const IMAGE_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

/**
 * 只有這些網頁能從瀏覽器呼叫；其他站台嵌入時瀏覽器會直接擋在 CORS。
 *
 * gariber.studio 底下一律放行 —— app 已經搬到 threadsframe.gariber.studio，
 * 白名單若只寫死單一位址，日後換子網域就會被自己擋掉且不易察覺。
 */
const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?gariber\.studio$/i;

const ALLOWED_ORIGINS = new Set([
  "https://gariber.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
]);

function originAllowed(origin) {
  return ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGIN_RE.test(origin);
}

const RATE_LIMIT = 60; // 每個 IP 每分鐘的請求上限
const RATE_WINDOW_MS = 60_000;

/**
 * 速率限制。Worker 是無狀態的，這份計數只存在單一 isolate 的記憶體裡，
 * 因此是「盡力而為」而非精確配額 —— 擋得住單點狂打，擋不住分散式濫用。
 * 綁定 KV（環境變數 RATE）之後會改用 KV 計數，跨 isolate 才會準確。
 */
const hits = new Map();

function tooManyRequests(ip) {
  const now = Date.now();

  // 順手清掉過期的項目，避免長時間執行的 isolate 記憶體一直長大。
  if (hits.size > 5000) {
    for (const [key, slot] of hits) if (now > slot.reset) hits.delete(key);
  }

  const slot = hits.get(ip);
  if (!slot || now > slot.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_LIMIT;
}

/**
 * 沒有 Origin 標頭的請求（curl、健康檢查）一律放行並回 `*`；
 * 有 Origin 的一定是瀏覽器發的，必須在白名單內。
 */
function corsFor(origin) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(body, status, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors, ...extra },
  });
}

/** 從 index 位置的 '{' 開始做括號配對，取出完整 JSON 物件字串。 */
function sliceObject(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 從貼文網址取出短碼，例如 /@user/post/DbgSoa2AXY_ → DbgSoa2AXY_ */
function codeFromUrl(url) {
  const m = /\/post\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

/** 一頁裡最多收這麼多個 post 物件就停手，避免長討論串拖慢回應。 */
const MAX_SCAN = 60;

/** 回應裡最多帶幾則留言。前端最多展示 3 則，多給一點讓使用者有得挑。 */
const MAX_COMMENTS = 6;

/**
 * 掃出頁面裡所有的 post 物件，維持頁面出現的順序。
 *
 * 同一則貼文會在頁面的不同區塊各嵌一份（討論串本體、預載資料、推薦區），
 * 因此以 `code` 去重 —— 不去重的話留言清單會出現整排重複。
 */
function scanPosts(html) {
  const posts = [];
  const seen = new Set();
  let from = 0;

  while (posts.length < MAX_SCAN) {
    const i = html.indexOf('"post":{', from);
    if (i === -1) break;
    from = i + 8;

    const raw = sliceObject(html, i + 7);
    if (!raw) continue;

    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      // 這一段被截斷或不是合法 JSON，換下一個候選。
      continue;
    }
    if (!obj?.user?.username || obj?.caption === undefined) continue;

    if (obj.code) {
      if (seen.has(obj.code)) continue;
      seen.add(obj.code);
    }
    posts.push(obj);
  }

  return posts;
}

/**
 * 把掃到的貼文切成「主體」與「它的留言」。
 *
 * 頁面會把整串討論都嵌進來，而且**主貼文永遠排在最前面、留言排在後面**。
 * 因此不能直接取第一個 —— 貼留言的連結時會拿到原 PO 的文。
 * 改成比對網址裡的短碼，找不到才退回第一個（例如網址沒有 /post/ 片段）。
 *
 * 留言只能靠順序判斷：物件本身沒有 parent / reply 之類的欄位可用，
 * 排在主體後面的就是它的留言。
 */
function splitThread(posts, wantedCode) {
  if (posts.length === 0) return { main: null, comments: [], exact: false };

  const at = wantedCode ? posts.findIndex((p) => p.code === wantedCode) : 0;
  const index = at === -1 ? 0 : at;

  return { main: posts[index], comments: posts.slice(index + 1), exact: at !== -1 };
}

/** 留言只留下畫進卡片會用到的欄位。 */
function toComment(post) {
  // 留言的圖片在卡片上畫得比貼文小，540 就夠；只取第一張 ——
  // 留言區要保持精簡，把整組輪播攤開會把卡片撐得很長。
  const first = Array.isArray(post.carousel_media) ? post.carousel_media[0] : post;
  const info = post.text_post_app_info ?? {};

  return {
    username: post.user?.username ?? "",
    name: post.user?.full_name || post.user?.username || "",
    avatar: post.user?.profile_pic_url ?? null,
    text: post.caption?.text ?? "",
    likes: post.like_count ?? null,
    // 留言在 Threads 上同樣有完整的四項互動，卡片要畫得像就得一起帶出來。
    replies: info.direct_reply_count ?? null,
    reposts: info.repost_count ?? null,
    shares: info.reshare_count ?? null,
    takenAt: post.taken_at ?? null,
    image: pickImage(first, CELL_WIDTH),
  };
}

/**
 * 留言依讚數由高到低取前幾則。
 *
 * 頁面順序不等於重要性 —— 實測某則貼文讚數最高的留言排在第 8 位，
 * 照順序取前 6 則會整個漏掉它。排序必須在這裡做：前端只收得到這份清單，
 * 它自己再排也救不回沒送出去的那些。
 */
function topComments(posts) {
  return posts
    .map(toComment)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, MAX_COMMENTS);
}

/** 卡片輸出寬度固定 1080px，單張圖片會佔滿整個寬度。 */
const FULL_WIDTH = 1080;

/**
 * 多張時排成格狀，每格最寬是一半（兩欄）—— 三欄時只有三分之一。
 * 取 540 涵蓋最寬的情況，再大就是傳了看不出來的像素。
 */
const CELL_WIDTH = 540;

/**
 * candidates 裡什麼尺寸都有（150 到 2268 都見過），挑**剛好夠用**的那張：
 * 寬度 ≥ 需求之中最小的一張，都不到就取最大。
 *
 * 這裡差很多 —— 實測同一張圖 1080px 是 180KB、640px 只有 72KB，
 * 而它在三張的格狀排列裡實際只畫到 320px 寬。
 */
function pickImage(node, minWidth) {
  const list = node?.image_versions2?.candidates;
  if (!Array.isArray(list)) return null;

  const usable = list.filter((c) => c?.url && c?.width);
  if (usable.length === 0) return null;

  const enough = usable.filter((c) => c.width >= minWidth).sort((a, b) => a.width - b.width);
  if (enough.length > 0) return enough[0].url;
  return usable.sort((a, b) => b.width - a.width)[0].url;
}

function collectImages(post) {
  const out = [];

  if (Array.isArray(post.carousel_media)) {
    post.carousel_media.forEach((node, index) => {
      // 第一張仍可能單獨佔滿卡片（使用者把「圖片數目」設成 1），維持大張；
      // 其餘只會出現在格狀排列裡，拿大張純粹是浪費頻寬。
      const url = pickImage(node, index === 0 ? FULL_WIDTH : CELL_WIDTH);
      if (url) out.push(url);
    });
  } else {
    const url = pickImage(post, FULL_WIDTH);
    if (url) out.push(url);
  }

  return out.slice(0, 4);
}

async function handlePost(target, cors) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad_url", message: "這不是一個網址" }, 400, cors);
  }
  if (!POST_HOSTS.has(parsed.hostname)) {
    return json({ error: "not_threads", message: "只接受 Threads 的貼文連結" }, 400, cors);
  }

  // Threads 偶爾會短暫限流或回傳沒有內嵌資料的精簡頁面，重試幾次就會拿到。
  // 一次失敗就放棄的話，使用者看到的會是隨機失敗。
  // exact = 短碼對得上的那則；fallback = 頁面裡的第一則（原貼文）。
  // 兩者分開存：短碼對不上時要再試一次，而不是拿原貼文交差 ——
  // Threads 偶爾會回傳不含該留言的頁面變體，直接接受就會靜靜地給錯貼文。
  let exact = null;
  let fallback = null;
  let exactComments = [];
  let fallbackComments = [];
  let finalUrl = parsed.toString();
  let lastStatus = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));

    const upstream = await fetch(parsed.toString(), {
      headers: {
        "user-agent": CRAWLER_UA,
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      /*
       * 第一次走 Cloudflare 邊緣快取：同一則貼文短時間內重複開啟時，
       * 省掉再抓一次那份近 900KB 的 HTML。
       *
       * 重試時一定要繞過快取。失敗的回應同樣會被存進去，照著快取重試
       * 等於把同一個錯誤再讀兩次 —— 「試了 3 次」實際上只試了一次，
       * 而且使用者接下來每次按都會撞到同一份，直到它過期為止。
       * 這正是「連按幾次都失敗，過幾分鐘卻好了」的成因。
       */
      cf:
        attempt === 0
          ? { cacheTtl: 300, cacheEverything: true }
          : { cacheTtl: 0, cacheEverything: false },
    });

    lastStatus = upstream.status;
    if (!upstream.ok) continue;

    // 短碼要取自轉址後的最終網址 —— /share/CODE 的 CODE 不是貼文短碼。
    const wantedCode = codeFromUrl(upstream.url);
    const found = splitThread(scanPosts(await upstream.text()), wantedCode);
    if (!found.main) continue;

    if (found.exact) {
      exact = found.main;
      exactComments = found.comments;
      finalUrl = upstream.url;
      break;
    }
    // 這次的頁面沒有目標那則，先記著再試一次。
    if (!fallback) {
      fallback = found.main;
      fallbackComments = found.comments;
      finalUrl = upstream.url;
    }
  }

  const post = exact ?? fallback;
  const comments = exact ? exactComments : fallbackComments;
  if (!post) {
    if (lastStatus && lastStatus !== 200) {
      return json(
        {
          error: "upstream",
          status: lastStatus,
          message: "Threads 這次沒有回應（試了 3 次）。通常是暫時限流，稍等一下再按一次就好。",
        },
        502,
        cors,
      );
    }
    // 鎖帳號、已刪除，或 Threads 換了頁面結構時會走到這裡。
    return json(
      {
        error: "not_found",
        message: "讀不到這則貼文。可能是私人帳號、已刪除，或 Threads 改了頁面結構。",
      },
      404,
      cors,
    );
  }

  const info = post.text_post_app_info ?? {};
  return json(
    {
      url: finalUrl.split("?")[0],
      username: post.user?.username ?? "",
      name: post.user?.full_name || post.user?.username || "",
      verified: Boolean(post.user?.is_verified),
      avatar: post.user?.profile_pic_url ?? null,
      text: post.caption?.text ?? "",
      takenAt: post.taken_at ?? null,
      likes: post.like_count ?? null,
      replies: info.direct_reply_count ?? post.reply_count ?? null,
      reposts: info.repost_count ?? null,
      shares: info.reshare_count ?? null,
      images: collectImages(post),
      comments: topComments(comments),
    },
    200,
    cors,
    { "cache-control": "public, max-age=300" },
  );
}

async function handleImage(target, cors) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad_url" }, 400, cors);
  }
  if (!IMAGE_HOST_RE.test(parsed.hostname)) {
    return json({ error: "host_not_allowed" }, 403, cors);
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "user-agent": CRAWLER_UA, accept: "image/*" },
    // 圖片內容不會變，放心讓邊緣快取久一點。
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!upstream.ok) return json({ error: "upstream", status: upstream.status }, 502, cors);

  const headers = new Headers(cors);
  headers.set("content-type", upstream.headers.get("content-type") ?? "image/jpeg");
  headers.set("cache-control", "public, max-age=86400");
  return new Response(upstream.body, { headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin");

    // 有 Origin 就一定是瀏覽器發的，必須在白名單內；
    // 沒有 Origin 的（curl、瀏覽器直接開網址）放行，方便健康檢查與除錯。
    if (origin && !originAllowed(origin)) {
      return json({ error: "origin_not_allowed" }, 403, corsFor(null));
    }

    const cors = corsFor(origin);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (tooManyRequests(ip)) {
      return json(
        { error: "rate_limited", message: "請求太頻繁，請稍後再試。" },
        429,
        cors,
        { "retry-after": "60" },
      );
    }

    const url = new URL(request.url);
    const img = url.searchParams.get("img");
    if (img) return handleImage(img, cors);

    const target = url.searchParams.get("url");
    if (target) return handlePost(target, cors);

    return json({ ok: true, usage: "?url=<threads 貼文網址> 或 ?img=<圖片網址>" }, 200, cors);
  },
};
