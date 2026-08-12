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
  assert.equal(result.body.error, "not_found");
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
