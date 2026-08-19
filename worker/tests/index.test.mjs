import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

let requestId = 0;

function post(code, username, text = username, topic = null) {
  return {
    code,
    user: { username, full_name: username, profile_pic_url: null },
    caption: { text },
    taken_at: 1,
    like_count: 1,
    text_post_app_info: topic === null ? {} : { tag_header: { display_name: topic } },
  };
}

function page(posts) {
  return posts.map((item) => `<script>{"post":${JSON.stringify(item)}}</script>`).join("");
}

/**
 * 2026-08 起 Threads 改用另一組 Relay 查詢算繪貼文頁：主貼文掛在 `media`、
 * 底下的留言掛在 `node`，整頁一個 `post` 都沒有。
 */
function relayPage(main, comments = []) {
  return (
    `<script>{"data":{"media":${JSON.stringify(main)}}}</script>` +
    comments.map((c) => `<script>{"edges":[{"node":${JSON.stringify(c)}}]}</script>`).join("")
  );
}

function relayUpstream(url, main, comments) {
  return { status: 200, ok: true, url, text: async () => relayPage(main, comments) };
}

function upstream(url, posts) {
  return {
    status: 200,
    ok: true,
    url,
    text: async () => page(posts),
  };
}

async function fetchPost(target, responses) {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let calls = 0;

  globalThis.fetch = async () => responses[Math.min(calls++, responses.length - 1)];
  // 失敗路徑會重試三次；測試不需要真的等 600ms / 1200ms。
  globalThis.setTimeout = (callback, _delay, ...args) => {
    callback(...args);
    return 0;
  };

  try {
    const response = await worker.fetch(
      new Request(`https://worker.test/?url=${encodeURIComponent(target)}`, {
        headers: { "cf-connecting-ip": `worker-test-${requestId++}` },
      }),
    );
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("有效 share 短鏈仍只回傳短碼精確匹配的貼文", async () => {
  const target = "https://www.threads.com/share/F5T4vM3xy/";
  const result = await fetchPost(target, [
    upstream("https://www.threads.com/@foodlove_0810/post/Db579SgE2br", [
      post("unrelated", "wrong_user", "錯誤貼文", "錯誤話題"),
      post("Db579SgE2br", "foodlove_0810", "正確貼文", "喜劇開場"),
    ]),
  ]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.username, "foodlove_0810");
  assert.equal(result.body.topic, "喜劇開場");
  assert.equal(result.body.url, "https://www.threads.com/@foodlove_0810/post/Db579SgE2br");
  assert.equal(result.calls, 1);
});

test("直接貼文連結仍可精確命中", async () => {
  const target = "https://www.threads.com/@foodlove_0810/post/Db579SgE2br";
  const result = await fetchPost(target, [
    upstream(target, [post("Db579SgE2br", "foodlove_0810", "正確貼文")]),
  ]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.username, "foodlove_0810");
  assert.equal(result.body.topic, null);
  assert.equal(result.calls, 1);
});

test("空白話題會正規化為 null", async () => {
  const target = "https://www.threads.com/@target/post/TopicCode";
  const result = await fetchPost(target, [
    upstream(target, [post("TopicCode", "target", "正文", "   ")]),
  ]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.topic, null);
  assert.equal(result.body.text, "正文");
});

test("型別錯誤的話題不會污染回應", async () => {
  const target = "https://www.threads.com/@target/post/TopicCode";
  const malformed = post("TopicCode", "target", "正文");
  malformed.text_post_app_info.tag_header = { display_name: 123 };
  const result = await fetchPost(target, [upstream(target, [malformed])]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.topic, null);
  assert.equal(result.body.text, "正文");
});

test("第一次頁面不含目標時會重試，第二次精確命中後成功", async () => {
  const target = "https://www.threads.com/share/retry-example/";
  const result = await fetchPost(target, [
    upstream("https://www.threads.com/?error=invalid_post", [post("home", "wrong_user")]),
    upstream("https://www.threads.com/@target/post/ExpectedCode", [
      post("ExpectedCode", "target", "重試後的正確貼文"),
    ]),
  ]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.username, "target");
  assert.equal(result.calls, 2);
});

test("share 短鏈落到 invalid_post 首頁時不得回傳首頁第一則貼文", async () => {
  const target = "https://www.threads.com/share/HjMtRxQTP/";
  const home = upstream("https://www.threads.com/?error=invalid_post", [
    post("homepage-item", "qainhua._229", "首頁推薦貼文"),
  ]);
  const result = await fetchPost(target, [home, home, home]);

  assert.equal(result.response.status, 404);
  assert.equal(result.body.error, "post_unavailable");
  assert.equal(result.calls, 3);
});

test("頁面有其他貼文但沒有目標短碼時不得使用 fallback", async () => {
  const target = "https://www.threads.com/@target/post/ExpectedCode";
  const wrongPage = upstream(target, [post("DifferentCode", "wrong_user", "不是目標貼文")]);
  const result = await fetchPost(target, [wrongPage, wrongPage, wrongPage]);

  assert.equal(result.response.status, 404);
  assert.equal(result.body.error, "not_found");
  assert.equal(result.calls, 3);
});

/*
 * 這兩個失敗長得很像，成因卻完全相反：一個是 Threads 明講不給看（敏感內容、
 * 私人帳號、已刪除），使用者只能改走手動貼上；另一個是抓到頁面卻挖不出資料，
 * 代表該來修這支 Worker 了。共用一組錯誤碼與訊息的話，兩邊都會被誤判。
 */
test("Threads 拒絕存取與解析失敗要分成不同的錯誤碼與訊息", async () => {
  const refusedPage = upstream("https://www.threads.com/?error=invalid_post", []);
  const refused = await fetchPost("https://www.threads.com/share/Restricted/", [
    refusedPage,
    refusedPage,
    refusedPage,
  ]);

  const target = "https://www.threads.com/@target/post/ExpectedCode";
  const emptyPage = upstream(target, []);
  const unparsable = await fetchPost(target, [emptyPage, emptyPage, emptyPage]);

  assert.equal(refused.body.error, "post_unavailable");
  assert.equal(unparsable.body.error, "not_found");
  assert.notEqual(refused.body.message, unparsable.body.message);

  // 被擋下來時不能推給「Threads 改了頁面結構」—— 那會把使用者引去找不存在的故障。
  assert.ok(!refused.body.message.includes("頁面結構"));
  assert.ok(refused.body.message.includes("登入"));

  // 最常見的成因要明講出來，使用者才認得出「不是服務壞了」。
  assert.ok(refused.body.message.includes("敏感"));
  // 但不能只押這一種 —— 已刪除與連結有誤回的是一模一樣的轉址。
  assert.ok(refused.body.message.includes("刪除"));

  // 反過來，真的解析不出來時就該明講可能是頁面結構變了。
  assert.ok(unparsable.body.message.includes("頁面結構"));
});

/*
 * 這一組守著的是實際發生過的線上故障：同一則貼文下午還是 `post` 結構、
 * 晚上就換成 `media`/`node`，只認 `post` 的版本會整個讀不出來，而且錯誤
 * 訊息會誤導成「Threads 改了頁面結構」——那時它確實改了，但我們該跟上。
 */
test("新的 media/node 結構也要讀得出貼文與留言", async () => {
  const target = "https://www.threads.com/@teddy/post/RelayCode";
  const main = post("RelayCode", "teddy", "主貼文", "Joeman");
  const result = await fetchPost(target, [
    relayUpstream(target, main, [post("c1", "someone", "第一則留言"), post("c2", "other", "第二則留言")]),
  ]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.username, "teddy");
  assert.equal(result.body.text, "主貼文");
  assert.equal(result.body.topic, "Joeman");
  assert.equal(result.body.comments.length, 2);
  assert.equal(result.calls, 1);
});

test("新結構同樣不得在短碼對不上時拿別則交差", async () => {
  const target = "https://www.threads.com/@teddy/post/WantedCode";
  const wrong = relayUpstream(target, post("OtherCode", "someone", "不是目標貼文"), []);
  const result = await fetchPost(target, [wrong, wrong, wrong]);

  assert.equal(result.response.status, 404);
  assert.equal(result.body.error, "not_found");
  assert.equal(result.calls, 3);
});

test("同一則貼文在新舊兩種鍵下各嵌一份時只算一則", async () => {
  const target = "https://www.threads.com/@teddy/post/DupCode";
  const item = post("DupCode", "teddy", "只該出現一次");
  const mixed = {
    status: 200,
    ok: true,
    url: target,
    text: async () => page([item]) + relayPage(item, []),
  };
  const result = await fetchPost(target, [mixed]);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.username, "teddy");
  // 去重失效的話這一份會被當成自己的留言。
  assert.equal(result.body.comments.length, 0);
});
