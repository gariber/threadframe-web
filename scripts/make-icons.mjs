// 產生 app 圖示。純 Node 寫 PNG，避免為了幾張圖示多裝一個影像套件。
// 用法：npm run icons
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SIZES = [16, 32, 48, 128, 180, 512];
const SS = 4; // 超取樣倍率，用來取得平滑邊緣

const INK = [23, 18, 15];
const PAPER = [243, 239, 232];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 圓角矩形的內部判定。 */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** 以 0–1 座標描述圖示，之後依尺寸放大。 */
function sample(u, v) {
  // 外框（相框）
  const outer = inRoundRect(u, v, 0.2, 0.2, 0.6, 0.6, 0.13);
  const inner = inRoundRect(u, v, 0.27, 0.27, 0.46, 0.46, 0.08);
  if (outer && !inner) return PAPER;
  // 內部兩條文字線
  if (inner) {
    const bar1 = v > 0.4 && v < 0.465 && u > 0.35 && u < 0.65;
    const bar2 = v > 0.53 && v < 0.595 && u > 0.35 && u < 0.57;
    if (bar1 || bar2) return PAPER;
  }
  return INK;
}

mkdirSync(OUT, { recursive: true });

for (const size of SIZES) {
  const big = size * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = sample((x * SS + sx + 0.5) / big, (y * SS + sy + 0.5) / big);
          r += pr;
          g += pg;
          b += pb;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
  writeFileSync(join(OUT, `icon${size}.png`), png(size, size, out));
  console.log(`icon${size}.png`);
}
