/**
 * ThreadFrame 取文代理（Cloudflare Worker）
 *
 * 網頁沒辦法直接讀 Threads 貼文：Threads 的任何端點都沒有開放跨網域，
 * 貼文頁本身又是 JS 算繪的空殼。這支 Worker 在伺服器端用爬蟲 UA 取得
 * 伺服器算繪版本，解析出作者、內文、統計與圖片，再帶著 CORS 標頭回傳。
 *
 * 圖片也必須經過這裡轉一手 —— cdninstagram 不給 CORS 標頭，前端若直接
 * 載入，canvas 會被污染（tainted），匯出時 toBlob 會直接丟 SecurityError。
 */

const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const POST_HOSTS = new Set(["threads.com", "www.threads.com", "threads.net", "www.threads.net"]);

/** 圖片只放行 Meta 自家的 CDN，否則這支 Worker 會變成任何人都能用的開放代理。 */
const IMAGE_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
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

/**
 * 頁面裡會嵌入很多段 JSON，第一個同時具備 user.username 與 caption 的
 * post 物件就是主貼文（留言的 post 物件排在它後面）。
 */
function findPost(html) {
  let from = 0;
  for (;;) {
    const i = html.indexOf('"post":{', from);
    if (i === -1) return null;
    from = i + 8;
    const raw = sliceObject(html, i + 7);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj?.user?.username && obj?.caption !== undefined) return obj;
    } catch {
      // 這一段被截斷或不是合法 JSON，換下一個候選。
    }
  }
}

/**
 * candidates[0] 是最大的那張（常見 1500px 以上）。卡片輸出寬度固定 1080px，
 * 多圖時每格更只有 540px，傳最大張純粹是浪費頻寬 —— 挑剛好夠用的即可。
 */
function pickImage(node) {
  const list = node?.image_versions2?.candidates;
  if (!Array.isArray(list)) return null;

  const usable = list.filter((c) => c?.url && c?.width);
  if (usable.length === 0) return null;

  const enough = usable.filter((c) => c.width >= 1080).sort((a, b) => a.width - b.width);
  if (enough.length > 0) return enough[0].url;
  return usable.sort((a, b) => b.width - a.width)[0].url;
}

function collectImages(post) {
  const out = [];
  const push = (node) => {
    const url = pickImage(node);
    if (url) out.push(url);
  };
  if (Array.isArray(post.carousel_media)) post.carousel_media.forEach(push);
  else push(post);
  return out.slice(0, 4);
}

async function handlePost(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad_url", message: "這不是一個網址" }, 400);
  }
  if (!POST_HOSTS.has(parsed.hostname)) {
    return json({ error: "not_threads", message: "只接受 Threads 的貼文連結" }, 400);
  }

  // Threads 偶爾會短暫限流或回傳沒有內嵌資料的精簡頁面，重試幾次就會拿到。
  // 一次失敗就放棄的話，使用者看到的會是隨機失敗。
  let post = null;
  let finalUrl = parsed.toString();
  let lastStatus = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));

    const upstream = await fetch(parsed.toString(), {
      headers: {
        "user-agent": CRAWLER_UA,
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      // 同一則貼文短時間內重複開啟時走 Cloudflare 邊緣快取，
      // 省掉再抓一次那份近 900KB 的 HTML。
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    lastStatus = upstream.status;
    if (!upstream.ok) continue;

    const found = findPost(await upstream.text());
    if (found) {
      post = found;
      finalUrl = upstream.url;
      break;
    }
  }

  if (!post) {
    if (lastStatus && lastStatus !== 200) {
      return json(
        {
          error: "upstream",
          status: lastStatus,
          message: "Threads 這次沒有回應（試了 3 次）。通常是暫時限流，稍等一下再按一次就好。",
        },
        502,
      );
    }
    // 鎖帳號、已刪除，或 Threads 換了頁面結構時會走到這裡。
    return json(
      {
        error: "not_found",
        message: "讀不到這則貼文。可能是私人帳號、已刪除，或 Threads 改了頁面結構。",
      },
      404,
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
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

async function handleImage(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad_url" }, 400);
  }
  if (!IMAGE_HOST_RE.test(parsed.hostname)) {
    return json({ error: "host_not_allowed" }, 403);
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "user-agent": CRAWLER_UA, accept: "image/*" },
    // 圖片內容不會變，放心讓邊緣快取久一點。
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!upstream.ok) return json({ error: "upstream", status: upstream.status }, 502);

  const headers = new Headers(CORS);
  headers.set("content-type", upstream.headers.get("content-type") ?? "image/jpeg");
  headers.set("cache-control", "public, max-age=86400");
  return new Response(upstream.body, { headers });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const url = new URL(request.url);
    const img = url.searchParams.get("img");
    if (img) return handleImage(img);

    const target = url.searchParams.get("url");
    if (target) return handlePost(target);

    return json({ ok: true, usage: "?url=<threads 貼文網址> 或 ?img=<圖片網址>" });
  },
};
