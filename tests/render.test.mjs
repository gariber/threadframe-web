/**
 * 卡片排版的回歸測試。
 *
 * render.ts 是這個專案的核心，改動頻繁，卻沒有任何自動檢查 —— 唯一的
 * 發現方式是部署後用眼睛看，而排版壞掉往往只差幾十像素，眼睛不一定抓得到。
 *
 * 這裡刻意**不比對截圖**。CI 與開發機的字體不同，同一段文字的寬高就差幾
 * 像素，整張圖比對會一直假性失敗；一個常常無故變紅的測試等於沒有測試。
 * 改成用純色測試圖，從畫布像素找出每個色塊的座標，直接驗證排版規則本身：
 * 同排等高、右緣對齊、落單獨佔整排。這些跟字體無關。
 *
 * 也刻意不連 Threads。樣本貼文會被刪除或被擋在登入牆外（實際發生過），
 * 靠網路的測試遲早會因為與程式無關的原因而失敗。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const DIST = resolve(import.meta.dirname, "../dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

if (!existsSync(join(DIST, "index.html"))) {
  throw new Error("找不到 dist/index.html —— 請先跑 npm run build");
}

/** 直接靜態服務 dist/，不必為了測試多裝一支開發伺服器。 */
function serveDist() {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const file = join(DIST, path === "/" ? "index.html" : decodeURIComponent(path));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/**
 * 純色測試圖。顏色彼此差很遠，才能在畫布上靠像素值分辨是哪一張，
 * 不會被 JPEG 之類的壓縮誤差混淆（這裡用 PNG，但仍留了容差）。
 */
const SWATCHES = [
  { key: "A", rgb: [226, 87, 76], w: 800, h: 1200 }, // 直
  { key: "B", rgb: [45, 140, 240], w: 1200, h: 675 }, // 橫
  { key: "C", rgb: [63, 185, 132], w: 900, h: 900 }, // 方
  { key: "D", rgb: [240, 165, 0], w: 700, h: 1100 }, // 直
];

async function makeSwatches(page) {
  return page.evaluate(
    (specs) =>
      specs.map((s) => {
        const c = document.createElement("canvas");
        c.width = s.w;
        c.height = s.h;
        const x = c.getContext("2d");
        x.fillStyle = `rgb(${s.rgb.join(",")})`;
        x.fillRect(0, 0, s.w, s.h);
        return c.toDataURL("image/png");
      }),
    SWATCHES,
  );
}

/** 從畫布像素找出每個測試色的外接矩形。 */
async function cellBoxes(page, count) {
  return page.evaluate(
    ({ specs, count }) => {
      const c = document.querySelector("#canvas");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const boxes = {};

      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          for (const s of specs.slice(0, count)) {
            // 容差涵蓋圓角邊緣的反鋸齒與縮放取樣。
            if (
              Math.abs(data[i] - s.rgb[0]) <= 12 &&
              Math.abs(data[i + 1] - s.rgb[1]) <= 12 &&
              Math.abs(data[i + 2] - s.rgb[2]) <= 12
            ) {
              const b = (boxes[s.key] ??= { x0: x, y0: y, x1: x, y1: y });
              if (x < b.x0) b.x0 = x;
              if (x > b.x1) b.x1 = x;
              if (y < b.y0) b.y0 = y;
              if (y > b.y1) b.y1 = y;
              break;
            }
          }
        }
      }

      for (const b of Object.values(boxes)) {
        b.w = b.x1 - b.x0 + 1;
        b.h = b.y1 - b.y0 + 1;
      }
      return boxes;
    },
    { specs: SWATCHES, count },
  );
}

/**
 * 透過假的取文服務帶入一則貼文，回傳各色塊在畫布上的座標。
 *
 * `shown` 是卡片上會畫幾張，`total` 是原貼文宣稱有幾則媒體（total > shown
 * 就是「+N」的情境）。
 */
async function renderWith(page, shown, total = shown) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  fakePost = fakeWorkerPost({ images: swatchUrls(shown), mediaCount: total });

  await page.goto(`${origin}?worker=${encodeURIComponent(fakeWorker)}`, { waitUntil: "load" });
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
  await page.fill("#intake", "https://www.threads.com/@someone/post/FakeCode");
  await page.evaluate(() => document.querySelector("#apply").click());

  // 圖片是逐張補上的，等畫布高度穩定下來再量。
  await page.waitForFunction(
    () => document.querySelector("#canvas").height > 400,
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(1500);

  const boxes = await cellBoxes(page, shown);
  return { boxes, errors };
}

/**
 * 數某個色塊右下角有多少像素「不是該色塊的顏色」。
 *
 * 不能改用「數深色像素」判斷藥丸：藥丸是半透明黑壓在測試圖上，混色後的結果
 * 未必夠深 —— 壓在藍色 (45,140,240) 上時藍通道仍有 108。異色比對才可靠。
 */
async function countForeign(page, box, rgb) {
  return page.evaluate(
    ({ box, rgb }) => {
      const c = document.querySelector("#canvas");
      const x0 = Math.round(box.x0 + box.w * 0.5);
      const y0 = Math.round(box.y0 + box.h * 0.5);
      const d = c.getContext("2d").getImageData(x0, y0, box.x1 - x0 + 1, box.y1 - y0 + 1).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs(d[i] - rgb[0]) > 20 ||
          Math.abs(d[i + 1] - rgb[1]) > 20 ||
          Math.abs(d[i + 2] - rgb[2]) > 20
        ) {
          n++;
        }
      }
      return n;
    },
    { box, rgb },
  );
}

/** CRC-32，PNG 每個區塊都要。 */
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * 產生一張純色 PNG。
 *
 * 自己編碼而不是抓現成的圖：測試不能連網（樣本會消失），也不該為了幾張色塊
 * 多裝一個影像套件。PNG 的純色情況很單純 —— 每條掃描線前面補一個 0 當濾波器
 * 標記，整包 deflate 就完成了。
 */
function pngSolid(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 這一輪要讓假的取文服務回什麼。測試在導頁前設定它。
 *
 * 全部改走取文這條路，是因為介面上的手動控制項（圖片數目、圖片上傳）會隨著
 * 精簡而消失，靠它們驅動的測試每次都得跟著改。取文是這個 app 真正的主線，
 * 綁在它上面才穩。
 */
let fakePost = null;

function fakeWorkerPost(overrides = {}) {
  return {
    url: "https://www.threads.com/@someone/post/FakeCode",
    username: "someone",
    name: "Someone",
    topic: null,
    avatar: null,
    text: "假的取文結果",
    takenAt: 1787000000,
    likes: 42,
    replies: 1,
    reposts: 2,
    shares: 3,
    images: [],
    comments: [],
    ...overrides,
  };
}

/**
 * 假的取文服務。
 *
 * 必須跑在另一個 port：app 會把「跟自己同一個 host」的位址判定成本站網址而
 * 拒絕採用。用 localhost 而不是 127.0.0.1，因為驗證只放行 https 或 localhost。
 *
 * 有了它，取文與貼留言連結這兩條路都能離線測 —— 不必真的連 Threads，測試也
 * 不會因為某則樣本貼文被刪掉而壞掉。
 */
function serveFakeWorker() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const img = url.searchParams.get("img");

    if (img) {
      // 圖片網址裡帶著色塊代號，回傳對應的純色 PNG。
      const key = /swatch-([A-D])/.exec(img)?.[1] ?? "A";
      const spec = SWATCHES.find((s) => s.key === key) ?? SWATCHES[0];
      res.writeHead(200, {
        "content-type": "image/png",
        "access-control-allow-origin": "*",
      });
      res.end(pngSolid(spec.w, spec.h, spec.rgb));
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(fakePost ?? fakeWorkerPost()));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** 產生 n 個帶色塊代號的假圖片網址。 */
function swatchUrls(n) {
  return SWATCHES.slice(0, n).map((s) => `https://cdn.test/swatch-${s.key}.png`);
}

const server = await serveDist();
const fake = await serveFakeWorker();
const fakeWorker = `http://localhost:${fake.address().port}`;
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  // CI 與這個容器的 Playwright 版本未必對得上內建路徑，允許外部指定。
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

test.after(async () => {
  await browser.close();
  server.close();
  fake.close();
});

test("單張維持原比例、不裁切，且佔滿內容寬度", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 1);
  await page.close();

  assert.deepEqual(errors, []);
  const a = boxes.A;
  assert.ok(a, "找不到第一張圖");

  // 800x1200 的直圖以 contain 放進整個內容寬度，比例必須維持。
  const ratio = a.h / a.w;
  assert.ok(Math.abs(ratio - 1200 / 800) < 0.02, `單張比例跑掉：${ratio.toFixed(3)}`);
});

test("兩張並排：同高、右緣對齊、中間留一道縫", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 2);
  await page.close();

  assert.deepEqual(errors, []);
  const [a, b] = [boxes.A, boxes.B];
  assert.ok(a && b, "兩張圖沒有都畫出來");

  assert.ok(Math.abs(a.y0 - b.y0) <= 2, "同排的上緣沒有對齊");
  assert.ok(Math.abs(a.h - b.h) <= 2, `同排高度不一致：${a.h} vs ${b.h}`);
  // 直圖較窄、橫圖較寬 —— 這正是「依方向分配寬度」的重點。
  assert.ok(b.w > a.w, "橫圖沒有比直圖寬");

  const gap = b.x0 - a.x1;
  assert.ok(gap > 0 && gap < 20, `格與格之間的縫不合理：${gap}px`);
});

test("三張：兩張一排，落單的獨佔整排", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 3);
  await page.close();

  assert.deepEqual(errors, []);
  const [a, b, c] = [boxes.A, boxes.B, boxes.C];
  assert.ok(a && b && c, "三張圖沒有都畫出來");

  assert.ok(Math.abs(a.y0 - b.y0) <= 2, "第一排上緣沒有對齊");
  assert.ok(c.y0 > a.y1, "第三張沒有換到下一排");

  // 落單那張要橫跨整個內容寬度：左緣對齊第一張、右緣對齊第二張。
  assert.ok(Math.abs(c.x0 - a.x0) <= 2, "落單的左緣沒有對齊");
  assert.ok(Math.abs(c.x1 - b.x1) <= 2, "落單的右緣沒有對齊");
  assert.ok(c.w > a.w && c.w > b.w, "落單那張沒有獨佔整排");
});

test("四張：兩排各兩張，每排右緣都齊平", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 4);
  await page.close();

  assert.deepEqual(errors, []);
  const [a, b, c, d] = [boxes.A, boxes.B, boxes.C, boxes.D];
  assert.ok(a && b && c && d, "四張圖沒有都畫出來");

  assert.ok(Math.abs(a.y0 - b.y0) <= 2, "第一排上緣沒有對齊");
  assert.ok(Math.abs(c.y0 - d.y0) <= 2, "第二排上緣沒有對齊");
  assert.ok(c.y0 > a.y1, "第二排沒有換行");

  // 兩排的左右緣都要落在同樣的位置，卡片才不會看起來歪掉。
  assert.ok(Math.abs(a.x0 - c.x0) <= 2, "兩排的左緣沒有對齊");
  assert.ok(Math.abs(b.x1 - d.x1) <= 2, "兩排的右緣沒有對齊");

  // 方圖（C）比直圖（D）寬，同排等高。
  assert.ok(Math.abs(c.h - d.h) <= 2, `第二排高度不一致：${c.h} vs ${d.h}`);
  assert.ok(c.w > d.w, "方圖沒有比直圖寬");
});

test("原貼文比畫得出來的多時，最後一格要標 +N", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  // 上傳 4 張但只顯示 2 張 —— 等同自動帶入時原貼文有 4 則、卡片只畫 2 則。
  const { boxes, errors } = await renderWith(page, 2, 4);

  const badge = await countForeign(page, boxes.B, SWATCHES[1].rgb);
  await page.close();

  assert.deepEqual(errors, []);
  // 那一區原本是整片純色，出現成片異色只可能是那顆藥丸。
  assert.ok(badge > 500, `最後一格右下角沒看到 +N 藥丸（異色像素 ${badge}）`);
});

test("原貼文張數與顯示張數相同時不該出現 +N", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 2, 2);

  const badge = await countForeign(page, boxes.B, SWATCHES[1].rgb);
  await page.close();

  assert.deepEqual(errors, []);
  assert.ok(badge < 100, `沒有東西被藏起來卻畫了 +N（異色像素 ${badge}）`);
});

/**
 * 那條從貼文頭像連到留言頭像的細線，只在「貼了留言連結」時才該出現。
 *
 * 它是在說「我要分享的是這則回覆」。自動帶入的熱門留言只是附帶資訊，畫了線
 * 反而像在強調它 —— 多數卡片上會變成多餘的裝飾，這是實際用起來的回饋。
 */
async function railPixels(page) {
  return page.evaluate(() => {
    const c = document.querySelector("#canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    // 頭像那一欄的中心線；掃一條窄帶就夠，兩側都是留白。
    const avatarAxis = Math.round(c.width * 0.132);
    let n = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = avatarAxis - 6; x <= avatarAxis + 6; x++) {
        const i = (y * c.width + x) * 4;
        // 線比背景亮、比文字暗，而且是灰的（三個通道接近）。
        if (
          d[i] > 45 &&
          d[i] < 150 &&
          Math.abs(d[i] - d[i + 1]) < 14 &&
          Math.abs(d[i + 1] - d[i + 2]) < 14
        ) {
          n++;
        }
      }
    }
    return n;
  });
}

/** 帶入一則純文字貼文並顯示一則留言，留言內容由 fill 決定怎麼填。 */
async function withOneComment(page, fill) {
  // 這一組不看圖片，只要一則有內文的留言 —— 明確設定，才不會沿用上一個測試
  // 留下來的假回應。
  fakePost = fakeWorkerPost({ text: "貼連結帶進來的留言" });

  await page.goto(`${origin}?worker=${encodeURIComponent(fakeWorker)}`, { waitUntil: "load" });
  // 各區塊預設是收合的 <details>，不展開的話裡面的控制項點不到。
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
  // 貼文要夠長，貼文頭像與留言頭像之間才有一段距離 —— 太短的話接線只有
  // 幾十像素，量不出跟沒有線的差別。
  await page.fill(
    "#intake",
    ["接線測試", "@tester", "", "第一行內容", "第二行內容", "第三行內容", "第四行內容"].join("\n"),
  );
  await page.evaluate(() => document.querySelector("#apply").click());
  await page.waitForTimeout(600);

  await page.evaluate(() => document.querySelector("#add-comment").click());
  await fill(page);

  await page.evaluate(() => {
    const sel = document.querySelector("#s-comment-limit");
    sel.value = "1";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  return railPixels(page);
}

/*
 * 用「兩種情況的差」而不是絕對值。
 *
 * 頭像本身就落在那條軸線上（沒上傳頭像時畫的是字母圓底），絕對值會把圓圈
 * 一起數進去，兩邊都是一千多，判不出有沒有線。差值才乾淨：唯一的變因就是
 * 那條接線。
 */
test("串文接線只在貼了留言連結時出現", async () => {
  const manualPage = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const manual = await withOneComment(manualPage, async (p) => {
    await p.evaluate(() => {
      const area = document.querySelector(".comment-row textarea");
      area.value = "手動打的留言";
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  await manualPage.close();

  const linkedPage = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const linked = await withOneComment(linkedPage, async (p) => {
    await p.evaluate(() => {
      const input = document.querySelector(".comment-link input");
      input.value = "https://www.threads.com/@someone/post/FakeCode";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".comment-link button").click();
    });
    await p.waitForFunction(
      () => document.querySelector(".comment-row textarea")?.value?.includes("貼連結帶進來"),
      { timeout: 15000 },
    );
    await p.waitForTimeout(500);
  });
  await linkedPage.close();

  assert.ok(
    linked > manual + 200,
    `接線沒有隨「有沒有貼連結」改變（手動 ${manual}、貼連結 ${linked}）`,
  );
});

/*
 * 縮排跟接線一樣，只在貼了留言連結時才套用。
 *
 * 沒有這條測試的話，把縮排改回全域生效不會被抓到：上面幾項都是「沒有留言」
 * 的情境，那時本來就不縮排，圖片一樣滿版。要有留言、又沒貼連結，才驗得到。
 */
test("有留言但沒貼連結時，貼文圖片維持滿版", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const { boxes, errors } = await renderWith(page, 1);
  const before = boxes.A.w;

  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    document.querySelector("#add-comment").click();
    const area = document.querySelector(".comment-row textarea");
    area.value = "手動打的留言";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    const sel = document.querySelector("#s-comment-limit");
    sel.value = "1";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);

  const after = (await cellBoxes(page, 1)).A.w;
  await page.close();

  assert.deepEqual(errors, []);
  assert.ok(
    Math.abs(after - before) <= 2,
    `多了一則留言就把圖片縮窄了（${before} → ${after}）`,
  );
});
