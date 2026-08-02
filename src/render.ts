import { findBackground, makeGradient } from "./backgrounds";
import type { Post, Style } from "./state";

/** 輸出寬度固定，與裝置螢幕寬度無關；預覽只是把同一張圖縮小顯示。 */
export const EXPORT_W = 1080;

const FONT_STACK =
  '"PingFang TC", "Noto Sans TC", "Hiragino Sans TC", "Microsoft JhengHei", system-ui, -apple-system, sans-serif';

export type Assets = {
  avatar: HTMLImageElement | null;
  images: HTMLImageElement[];
  bg: HTMLImageElement | null;
};

const CJK_RE = /[ᄀ-ᇿ⺀-鿿　-〿가-힯豈-﫿＀-￯]/;
/** 不該出現在行首的收尾標點。 */
const NO_LINE_START = "、。，．：；！？」』）》〉】〕｝”’,.:;!?)]}%";

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

/**
 * 中英混排斷行：CJK 逐字斷，拉丁文字整字斷，並尊重原文換行。
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    // 先切成「不可再拆的單位」：一個 CJK 字、一個拉丁單字、或一段空白。
    const tokens: string[] = [];
    let latin = "";
    for (const ch of paragraph) {
      if (CJK_RE.test(ch)) {
        if (latin) {
          tokens.push(latin);
          latin = "";
        }
        tokens.push(ch);
      } else if (/\s/.test(ch)) {
        if (latin) {
          tokens.push(latin);
          latin = "";
        }
        tokens.push(" ");
      } else {
        latin += ch;
      }
    }
    if (latin) tokens.push(latin);

    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (line !== "" && ctx.measureText(candidate).width > maxWidth) {
        // 避免收尾標點被擠到下一行行首。
        if (token.length === 1 && NO_LINE_START.includes(token)) {
          lines.push(candidate.trimEnd());
          line = "";
          continue;
        }
        lines.push(line.trimEnd());
        line = token === " " ? "" : token;
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }

  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 以 alpha 混一點文字色進去，用來畫次要文字與圖示。 */
function softInk(color: string, alpha: number): string {
  return hexToRgba(color, alpha);
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + s * 0.92);
  ctx.bezierCurveTo(x - s * 0.08, y + s * 0.55, x + s * 0.06, y + s * 0.05, x + s / 2, y + s * 0.32);
  ctx.bezierCurveTo(x + s * 0.94, y + s * 0.05, x + s * 1.08, y + s * 0.55, x + s / 2, y + s * 0.92);
  ctx.closePath();
}

function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.ellipse(x + s / 2, y + s * 0.45, s * 0.46, s * 0.38, 0, 0, Math.PI * 2);
  ctx.moveTo(x + s * 0.3, y + s * 0.78);
  ctx.lineTo(x + s * 0.22, y + s * 0.97);
  ctx.lineTo(x + s * 0.46, y + s * 0.8);
  ctx.closePath();
}

function repeatPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.12, y + s * 0.36);
  ctx.lineTo(x + s * 0.76, y + s * 0.36);
  ctx.moveTo(x + s * 0.6, y + s * 0.2);
  ctx.lineTo(x + s * 0.78, y + s * 0.36);
  ctx.lineTo(x + s * 0.6, y + s * 0.52);
  ctx.moveTo(x + s * 0.88, y + s * 0.66);
  ctx.lineTo(x + s * 0.24, y + s * 0.66);
  ctx.moveTo(x + s * 0.4, y + s * 0.5);
  ctx.lineTo(x + s * 0.22, y + s * 0.66);
  ctx.lineTo(x + s * 0.4, y + s * 0.82);
}

type Metrics = { height: number; draw: (ctx: CanvasRenderingContext2D, top: number) => void };

/**
 * 兩段式算繪：先量出內容高度決定畫布大小，再真正畫。
 * 這樣「自動高度」不會裁到內容，固定比例也能把內容垂直置中。
 */
function layout(
  ctx: CanvasRenderingContext2D,
  post: Post,
  style: Style,
  assets: Assets,
  contentW: number,
): Metrics {
  const ink = style.textColor;
  const size = style.textSize;
  const gap = Math.round(size * 0.7);
  const blocks: Metrics[] = [];

  const name = style.maskIdentity ? "匿名" : post.name.trim();
  const handle = style.maskIdentity ? "" : post.handle.trim();

  // ── 作者列 ─────────────────────────────────────────────
  if (name || handle || (style.showAvatar && assets.avatar) || style.showTime) {
    const avatarSize = Math.round(size * 1.75);
    const nameSize = Math.round(size * 0.95);
    const metaSize = Math.round(size * 0.8);
    const headH = Math.max(style.showAvatar ? avatarSize : 0, nameSize + metaSize + 6);

    blocks.push({
      height: headH,
      draw: (c, top) => {
        let x = 0;
        if (style.showAvatar) {
          const cy = top + headH / 2;
          c.save();
          c.beginPath();
          c.arc(x + avatarSize / 2, cy, avatarSize / 2, 0, Math.PI * 2);
          c.clip();
          if (assets.avatar && !style.maskIdentity) {
            drawCover(c, assets.avatar, x, cy - avatarSize / 2, avatarSize, avatarSize);
          } else {
            c.fillStyle = softInk(ink, 0.14);
            c.fillRect(x, cy - avatarSize / 2, avatarSize, avatarSize);
            if (!style.maskIdentity && name) {
              c.fillStyle = softInk(ink, 0.55);
              c.font = font(Math.round(avatarSize * 0.42), 600);
              c.textAlign = "center";
              c.textBaseline = "middle";
              c.fillText([...name][0], x + avatarSize / 2, cy);
              c.textAlign = "left";
            }
          }
          c.restore();
          x += avatarSize + Math.round(size * 0.5);
        }

        c.textBaseline = "top";
        let ty = top + (headH - (nameSize + metaSize + 6)) / 2;
        c.fillStyle = ink;
        c.font = font(nameSize, 700);
        c.fillText(name, x, ty);
        ty += nameSize + 6;

        const meta = [handle ? `@${handle}` : "", style.showTime ? post.time.trim() : ""]
          .filter(Boolean)
          .join(" · ");
        if (meta) {
          c.fillStyle = softInk(ink, 0.55);
          c.font = font(metaSize, 400);
          c.fillText(meta, x, ty);
        }
      },
    });
  }

  // ── 內文 ───────────────────────────────────────────────
  const text = post.text.trim();
  if (text) {
    ctx.font = font(size, 400);
    const lines = wrapText(ctx, text, contentW);
    const lineH = Math.round(size * 1.55);
    blocks.push({
      height: lines.length * lineH,
      draw: (c, top) => {
        c.fillStyle = ink;
        c.font = font(size, 400);
        c.textBaseline = "top";
        lines.forEach((line, i) => {
          c.fillText(line, 0, top + i * lineH + (lineH - size) / 2);
        });
      },
    });
  }

  // ── 貼文圖片（完整顯示，不裁切） ───────────────────────
  const images = style.showImages ? assets.images.slice(0, 4) : [];
  if (images.length > 0) {
    const cellGap = Math.round(size * 0.35);
    let height: number;
    let cells: { x: number; y: number; w: number; h: number }[];

    if (images.length === 1) {
      const img = images[0];
      const h = Math.min(
        (contentW * img.naturalHeight) / img.naturalWidth,
        contentW * 1.4,
      );
      height = h;
      cells = [{ x: 0, y: 0, w: contentW, h }];
    } else if (images.length === 2 || images.length === 3) {
      // 3 張排成一列，避免 2×2 網格空出一格造成視覺上的破洞。
      const n = images.length;
      const w = (contentW - cellGap * (n - 1)) / n;
      height = w;
      cells = images.map((_, i) => ({ x: i * (w + cellGap), y: 0, w, h: w }));
    } else {
      const w = (contentW - cellGap) / 2;
      const rows = Math.ceil(images.length / 2);
      height = rows * w + (rows - 1) * cellGap;
      cells = images.map((_, i) => ({
        x: (i % 2) * (w + cellGap),
        y: Math.floor(i / 2) * (w + cellGap),
        w,
        h: w,
      }));
    }

    blocks.push({
      height,
      draw: (c, top) => {
        images.forEach((img, i) => {
          const cell = cells[i];
          c.save();
          roundRect(c, cell.x, top + cell.y, cell.w, cell.h, Math.round(size * 0.4));
          c.clip();
          c.fillStyle = softInk(ink, 0.06);
          c.fill();
          drawContain(c, img, cell.x, top + cell.y, cell.w, cell.h);
          c.restore();
        });
      },
    });
  }

  // ── 互動統計 ───────────────────────────────────────────
  const stats: [(c: CanvasRenderingContext2D, x: number, y: number, s: number) => void, string][] = [];
  if (style.showStats) {
    if (post.likes.trim()) stats.push([heartPath, post.likes.trim()]);
    if (post.replies.trim()) stats.push([bubblePath, post.replies.trim()]);
    if (post.reposts.trim()) stats.push([repeatPath, post.reposts.trim()]);
  }
  if (stats.length > 0) {
    const iconSize = Math.round(size * 0.85);
    blocks.push({
      height: iconSize,
      draw: (c, top) => {
        c.font = font(Math.round(size * 0.8), 400);
        c.textBaseline = "middle";
        let x = 0;
        for (const [icon, value] of stats) {
          const cy = top + iconSize / 2;
          c.save();
          c.strokeStyle = softInk(ink, 0.6);
          c.fillStyle = softInk(ink, 0.6);
          c.lineWidth = Math.max(2, size * 0.06);
          c.lineJoin = "round";
          c.lineCap = "round";
          icon(c, x, top, iconSize);
          if (icon === repeatPath) c.stroke();
          else c.fill();
          c.restore();
          x += iconSize + Math.round(size * 0.28);
          c.fillStyle = softInk(ink, 0.6);
          c.fillText(value, x, cy);
          x += c.measureText(value).width + Math.round(size * 0.9);
        }
        c.textBaseline = "top";
      },
    });
  }

  // ── 原始網址 ───────────────────────────────────────────
  if (style.showUrl && post.url.trim()) {
    const urlSize = Math.round(size * 0.7);
    blocks.push({
      height: urlSize + 4,
      draw: (c, top) => {
        c.fillStyle = softInk(ink, 0.4);
        c.font = font(urlSize, 400);
        c.textBaseline = "top";
        c.fillText(post.url.trim().replace(/^https?:\/\//, ""), 0, top);
      },
    });
  }

  const total =
    blocks.reduce((sum, b) => sum + b.height, 0) + Math.max(0, blocks.length - 1) * gap;

  return {
    height: total,
    draw: (c, top) => {
      let y = top;
      for (const block of blocks) {
        block.draw(c, y);
        y += block.height + gap;
      }
    },
  };
}

export function renderCard(
  canvas: HTMLCanvasElement,
  post: Post,
  style: Style,
  assets: Assets,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const pad = style.pad;
  const panelPad = Math.round(style.textSize * 1.4);
  const contentW = EXPORT_W - pad * 2 - panelPad * 2;

  // 第一次量測用的 context 狀態不影響輸出，只是要拿到文字寬度。
  const metrics = layout(ctx, post, style, assets, Math.max(80, contentW));
  const panelH = metrics.height + panelPad * 2;
  const contentH = panelH + pad * 2;

  const minH =
    style.ratio === "portrait" ? Math.round(EXPORT_W * 1.25) : style.ratio === "square" ? EXPORT_W : 0;
  const H = Math.max(contentH, minH);

  canvas.width = EXPORT_W;
  canvas.height = H;

  // 背景
  if (assets.bg) {
    drawCover(ctx, assets.bg, 0, 0, EXPORT_W, H);
  } else {
    ctx.fillStyle = makeGradient(ctx, findBackground(style.bgId), EXPORT_W, H);
    ctx.fillRect(0, 0, EXPORT_W, H);
  }

  // 底板（比例大於內容時垂直置中）
  const panelY = Math.round((H - panelH) / 2);
  if (style.panelAlpha > 0) {
    ctx.save();
    ctx.fillStyle = hexToRgba(style.panelColor, style.panelAlpha);
    roundRect(ctx, pad, panelY, EXPORT_W - pad * 2, panelH, style.radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(pad + panelPad, 0);
  ctx.textAlign = "left";
  metrics.draw(ctx, panelY + panelPad);
  ctx.restore();
}
