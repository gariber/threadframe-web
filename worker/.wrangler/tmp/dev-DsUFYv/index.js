var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
var POST_HOSTS = /* @__PURE__ */ new Set(["threads.com", "www.threads.com", "threads.net", "www.threads.net"]);
var IMAGE_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
var ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?gariber\.studio$/i;
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://gariber.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173"
]);
function originAllowed(origin) {
  return ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGIN_RE.test(origin);
}
__name(originAllowed, "originAllowed");
var RATE_LIMIT = 60;
var RATE_WINDOW_MS = 6e4;
var hits = /* @__PURE__ */ new Map();
function tooManyRequests(ip) {
  const now = Date.now();
  if (hits.size > 5e3) {
    for (const [key, slot2] of hits) if (now > slot2.reset) hits.delete(key);
  }
  const slot = hits.get(ip);
  if (!slot || now > slot.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_LIMIT;
}
__name(tooManyRequests, "tooManyRequests");
function corsFor(origin) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
}
__name(corsFor, "corsFor");
function json(body, status, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors, ...extra }
  });
}
__name(json, "json");
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
__name(sliceObject, "sliceObject");
function codeFromUrl(url) {
  const m = /\/post\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}
__name(codeFromUrl, "codeFromUrl");
function refusedByThreads(url) {
  try {
    return new URL(url).searchParams.get("error") === "invalid_post";
  } catch {
    return false;
  }
}
__name(refusedByThreads, "refusedByThreads");
var MAX_SCAN = 60;
var MAX_COMMENTS = 6;
var POST_KEYS = ['"post":{', '"media":{', '"node":{'];
var MAX_OBJECT_CHARS = 3e5;
var MAX_CANDIDATES = 400;
var CAPTION_WINDOW = 3e4;
function scanPosts(html) {
  const found = [];
  for (const key of POST_KEYS) {
    let from = 0;
    for (let n = 0; n < MAX_CANDIDATES; n++) {
      const at = html.indexOf(key, from);
      if (at === -1) break;
      from = at + key.length;
      const start = at + key.length - 1;
      const caption = html.indexOf('"caption"', start);
      if (caption === -1 || caption - start > CAPTION_WINDOW) continue;
      const raw = sliceObject(html, start);
      if (!raw || raw.length > MAX_OBJECT_CHARS) continue;
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!obj?.user?.username || obj?.caption === void 0) continue;
      found.push({ at, obj });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const posts = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { obj } of found) {
    if (posts.length >= MAX_SCAN) break;
    if (obj.code) {
      if (seen.has(obj.code)) continue;
      seen.add(obj.code);
    }
    posts.push(obj);
  }
  return posts;
}
__name(scanPosts, "scanPosts");
function splitThread(posts, wantedCode) {
  if (!wantedCode || posts.length === 0) return { main: null, comments: [], exact: false };
  const at = posts.findIndex((p) => p.code === wantedCode);
  if (at === -1) return { main: null, comments: [], exact: false };
  return { main: posts[at], comments: posts.slice(at + 1), exact: true };
}
__name(splitThread, "splitThread");
function toComment(post) {
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
    image: pickImage(first, CELL_WIDTH)
  };
}
__name(toComment, "toComment");
function topComments(posts) {
  return posts.map(toComment).sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, MAX_COMMENTS);
}
__name(topComments, "topComments");
var FULL_WIDTH = 1080;
var CELL_WIDTH = 540;
function uncropped(node, list) {
  const w = node?.original_width;
  const h = node?.original_height;
  if (!w || !h) return list;
  const want = w / h;
  const same = list.filter((c) => c.height && Math.abs(c.width / c.height - want) / want < 0.02);
  return same.length > 0 ? same : list;
}
__name(uncropped, "uncropped");
function pickImage(node, minWidth) {
  const list = node?.image_versions2?.candidates;
  if (!Array.isArray(list)) return null;
  const usable = uncropped(
    node,
    list.filter((c) => c?.url && c?.width)
  );
  if (usable.length === 0) return null;
  const enough = usable.filter((c) => c.width >= minWidth).sort((a, b) => a.width - b.width);
  if (enough.length > 0) return enough[0].url;
  return usable.sort((a, b) => b.width - a.width)[0].url;
}
__name(pickImage, "pickImage");
function mediaCount(post) {
  return Array.isArray(post.carousel_media) ? post.carousel_media.length : 1;
}
__name(mediaCount, "mediaCount");
function collectImages(post) {
  const out = [];
  if (Array.isArray(post.carousel_media)) {
    post.carousel_media.forEach((node, index) => {
      const url = pickImage(node, index === 0 ? FULL_WIDTH : CELL_WIDTH);
      if (url) out.push(url);
    });
  } else {
    const url = pickImage(post, FULL_WIDTH);
    if (url) out.push(url);
  }
  return out.slice(0, 4);
}
__name(collectImages, "collectImages");
function topicName(post) {
  const value = post?.text_post_app_info?.tag_header?.display_name;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
__name(topicName, "topicName");
async function handlePost(target, cors) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad_url", message: "\u9019\u4E0D\u662F\u4E00\u500B\u7DB2\u5740" }, 400, cors);
  }
  if (!POST_HOSTS.has(parsed.hostname)) {
    return json({ error: "not_threads", message: "\u53EA\u63A5\u53D7 Threads \u7684\u8CBC\u6587\u9023\u7D50" }, 400, cors);
  }
  let exact = null;
  let exactComments = [];
  let finalUrl = parsed.toString();
  let lastStatus = 0;
  let refused = false;
  let backoff = 0;
  let retriedForLikes = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    backoff = 600 * (attempt + 1);
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "user-agent": CRAWLER_UA,
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml"
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
      cf: attempt === 0 ? { cacheTtl: 300, cacheEverything: true } : { cacheTtl: 0, cacheEverything: false }
    });
    lastStatus = upstream.status;
    if (!upstream.ok) continue;
    if (refusedByThreads(upstream.url)) {
      refused = true;
      continue;
    }
    const wantedCode = codeFromUrl(upstream.url);
    if (!wantedCode) continue;
    const found = splitThread(scanPosts(await upstream.text()), wantedCode);
    if (!found.main) continue;
    if (found.exact) {
      const better = typeof found.main.like_count === "number";
      if (!exact || better && typeof exact.like_count !== "number") {
        exact = found.main;
        exactComments = found.comments;
        finalUrl = upstream.url;
      }
      if (typeof exact.like_count === "number" || retriedForLikes) break;
      retriedForLikes = true;
      backoff = 0;
    }
  }
  const post = exact;
  const comments = exactComments;
  if (!post) {
    if (lastStatus && lastStatus !== 200) {
      return json(
        {
          error: "upstream",
          status: lastStatus,
          message: "Threads \u9019\u6B21\u6C92\u6709\u56DE\u61C9\uFF08\u8A66\u4E86 3 \u6B21\uFF09\u3002\u901A\u5E38\u662F\u66AB\u6642\u9650\u6D41\uFF0C\u7A0D\u7B49\u4E00\u4E0B\u518D\u6309\u4E00\u6B21\u5C31\u597D\u3002"
        },
        502,
        cors
      );
    }
    if (refused) {
      return json(
        {
          error: "post_unavailable",
          /*
           * 開頭直接點名「敏感或成人內容」—— 這是實務上最常見的成因，也是使用者
           * 最需要立刻認出來的一種：貼文在自己登入的手機上看得好好的，只有這裡讀
           * 不到，不講清楚就會一直以為是服務壞了。
           *
           * 但不能寫成斷言。Threads 對「內容受限」「已刪除」「短碼根本不存在」回的
           * 轉址完全一樣，分不出來，所以其餘可能性要補在後面，免得使用者貼錯連結時
           * 被帶去找不存在的分級問題。
           */
          message: "\u9019\u5247\u8CBC\u6587\u88AB Threads \u5224\u5B9A\u70BA\u654F\u611F\u6216\u6210\u4EBA\u5167\u5BB9\uFF0C\u672A\u767B\u5165\u8B80\u4E0D\u5230\uFF0C\u56E0\u6B64\u7121\u6CD5\u81EA\u52D5\u5E36\u5165\u5361\u7247\u3002\uFF08\u8CBC\u6587\u5DF2\u522A\u9664\u3001\u79C1\u4EBA\u5E33\u865F\u6216\u9023\u7D50\u6709\u8AA4\u4E5F\u6703\u662F\u540C\u6A23\u7D50\u679C\uFF0CThreads \u4E0D\u5340\u5206\u3002\uFF09\u8ACB\u6539\u6210\u76F4\u63A5\u8907\u88FD\u8CBC\u6587\u6587\u5B57\u8CBC\u4E0A\u4F86\uFF0C\u5716\u7247\u5F9E\u76F8\u7C3F\u9078\u3002"
        },
        404,
        cors
      );
    }
    return json(
      {
        error: "not_found",
        message: "\u6293\u5230\u4E86\u9801\u9762\u537B\u8B80\u4E0D\u51FA\u8CBC\u6587\u5167\u5BB9\uFF0CThreads \u53EF\u80FD\u6539\u4E86\u9801\u9762\u7D50\u69CB\u3002\u53EF\u4EE5\u5148\u6539\u7528\u8907\u88FD\u8CBC\u6587\u6587\u5B57\u8CBC\u4E0A\u3002"
      },
      404,
      cors
    );
  }
  const info = post.text_post_app_info ?? {};
  return json(
    {
      url: finalUrl.split("?")[0],
      username: post.user?.username ?? "",
      name: post.user?.full_name || post.user?.username || "",
      topic: topicName(post),
      verified: Boolean(post.user?.is_verified),
      avatar: post.user?.profile_pic_url ?? null,
      text: post.caption?.text ?? "",
      takenAt: post.taken_at ?? null,
      likes: post.like_count ?? null,
      replies: info.direct_reply_count ?? post.reply_count ?? null,
      reposts: info.repost_count ?? null,
      shares: info.reshare_count ?? null,
      images: collectImages(post),
      mediaCount: mediaCount(post),
      comments: topComments(comments)
    },
    200,
    cors,
    { "cache-control": "public, max-age=300" }
  );
}
__name(handlePost, "handlePost");
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
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  if (!upstream.ok) return json({ error: "upstream", status: upstream.status }, 502, cors);
  const headers = new Headers(cors);
  headers.set("content-type", upstream.headers.get("content-type") ?? "image/jpeg");
  headers.set("cache-control", "public, max-age=86400");
  return new Response(upstream.body, { headers });
}
__name(handleImage, "handleImage");
var src_default = {
  async fetch(request) {
    const origin = request.headers.get("origin");
    if (origin && !originAllowed(origin)) {
      return json({ error: "origin_not_allowed" }, 403, corsFor(null));
    }
    const cors = corsFor(origin);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (tooManyRequests(ip)) {
      return json(
        { error: "rate_limited", message: "\u8ACB\u6C42\u592A\u983B\u7E41\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002" },
        429,
        cors,
        { "retry-after": "60" }
      );
    }
    const url = new URL(request.url);
    const img = url.searchParams.get("img");
    if (img) return handleImage(img, cors);
    const target = url.searchParams.get("url");
    if (target) return handlePost(target, cors);
    return json({ ok: true, usage: "?url=<threads \u8CBC\u6587\u7DB2\u5740> \u6216 ?img=<\u5716\u7247\u7DB2\u5740>" }, 200, cors);
  }
};

// ../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Yl8mcl/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Yl8mcl/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
