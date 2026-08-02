import { findBackground } from "./backgrounds";
import { DEFAULT_FONT, findFont } from "./fonts";
import { MAX_COMMENTS, type Post, type Style } from "./state";

/** 輸出寬度固定，與裝置螢幕寬度無關；預覽只是把同一張圖縮小顯示。 */
export const EXPORT_W = 1080;

/**
 * 目前這次算繪使用的字型堆疊。renderCard 開頭設定一次，
 * 讓底下所有 font() 呼叫不必各自帶著 style 跑。
 */
let activeStack = DEFAULT_FONT.stack;

export type Assets = {
  avatar: HTMLImageElement | null;
  images: HTMLImageElement[];
  bg: HTMLImageElement | null;
  /** 與 post.comments 同索引；沒上傳頭像的位置放 null。 */
  commentAvatars: (HTMLImageElement | null)[];
};

const CJK_RE = /[ᄀ-ᇿ⺀-鿿　-〿가-힯豈-﫿＀-￯]/;
/** 不該出現在行首的收尾標點。 */
const NO_LINE_START = "、。，．：；！？」』）》〉】〕｝”’,.:;!?)]}%";

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${activeStack}`;
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

function paintBackground(
  ctx: CanvasRenderingContext2D,
  style: Style,
  assets: Assets,
  w: number,
  h: number,
): void {
  if (assets.bg) {
    drawCover(ctx, assets.bg, 0, 0, w, h);
  } else {
    ctx.save();
    findBackground(style.bgId).paint(ctx, w, h);
    ctx.restore();
  }
}

/**
 * 毛玻璃用的模糊。先縮小再放大 —— 縮圖時瀏覽器會做像素平均，本身就是一次模糊，
 * 在所有瀏覽器都有效；ctx.filter 只在支援的環境（iOS 17 以後）再疊一層讓邊緣更柔。
 */
function frost(source: HTMLCanvasElement, w: number, h: number, radius: number): HTMLCanvasElement {
  const step = Math.max(2, Math.round(radius / 4));
  const sw = Math.max(1, Math.round(w / step));
  const sh = Math.max(1, Math.round(h / step));

  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!sctx || !octx) return source;

  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(source, 0, 0, sw, sh);

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  if ("filter" in octx) octx.filter = `blur(${Math.max(1, Math.round(radius / 5))}px)`;
  octx.drawImage(small, 0, 0, w, h);
  return out;
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

/** 分享：紙飛機。 */
function sendPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.08, y + s * 0.5);
  ctx.lineTo(x + s * 0.94, y + s * 0.12);
  ctx.lineTo(x + s * 0.56, y + s * 0.92);
  ctx.lineTo(x + s * 0.46, y + s * 0.58);
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

/** 圓形頭像：有圖就裁圓，沒圖就用名稱首字，遮蔽身分時只留素色圓。 */
function drawAvatar(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  ink: string,
  name: string,
  masked: boolean,
): void {
  c.save();
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.clip();
  if (img && !masked) {
    drawCover(c, img, x, y, size, size);
  } else {
    c.fillStyle = softInk(ink, 0.14);
    c.fillRect(x, y, size, size);
    if (!masked && name) {
      c.fillStyle = softInk(ink, 0.55);
      c.font = font(Math.round(size * 0.42), 600);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText([...name][0], x + size / 2, y + size / 2);
    }
  }
  c.restore();
  c.textAlign = "left";
  c.textBaseline = "top";
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
          drawAvatar(
            c,
            assets.avatar,
            x,
            cy - avatarSize / 2,
            avatarSize,
            ink,
            name,
            style.maskIdentity,
          );
          x += avatarSize + Math.round(size * 0.5);
        }

        c.textBaseline = "top";
        let ty = top + (headH - (nameSize + metaSize + 6)) / 2;
        c.fillStyle = ink;
        c.font = font(nameSize, 700);
        c.fillText(name, x, ty);
        ty += nameSize + 6;

        // 時間不放在這裡 —— 它自成一行落在內容下方、統計上方（見下方的時間區塊）。
        const meta = handle ? `@${handle}` : "";
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
  const images = style.showImages
    ? assets.images.slice(0, Math.max(0, Math.min(4, style.imageLimit)))
    : [];
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

  // ── 發文時間 ───────────────────────────────────────────
  // 獨立一行放在內容之後、統計之前，與統計之間隔一條細線。
  const timeText = style.showTime ? post.time.trim() : "";
  if (timeText) {
    const timeSize = Math.round(size * 0.8);
    blocks.push({
      height: timeSize + 4,
      draw: (c, top) => {
        c.fillStyle = softInk(ink, 0.45);
        c.font = font(timeSize, 400);
        c.textBaseline = "top";
        c.fillText(timeText, 0, top);
      },
    });
  }

  // ── 互動統計 ───────────────────────────────────────────
  const stats: [(c: CanvasRenderingContext2D, x: number, y: number, s: number) => void, string][] = [];
  if (style.showStats) {
    if (post.likes.trim()) stats.push([heartPath, post.likes.trim()]);
    if (post.replies.trim()) stats.push([bubblePath, post.replies.trim()]);
    if (post.reposts.trim()) stats.push([repeatPath, post.reposts.trim()]);
    if (post.shares.trim()) stats.push([sendPath, post.shares.trim()]);
  }
  if (stats.length > 0) {
    const iconSize = Math.round(size * 0.85);
    const valueSize = Math.round(size * 0.8);
    const ruleGap = Math.round(size * 0.5);
    const iconGap = Math.round(size * 0.28);
    const dotGap = Math.round(size * 0.42);

    blocks.push({
      height: ruleGap + iconSize,
      draw: (c, top) => {
        // 統計上方的細線，與時間隔開。
        c.strokeStyle = softInk(ink, 0.13);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, top + 1);
        c.lineTo(contentW, top + 1);
        c.stroke();

        const rowTop = top + ruleGap;
        const cy = rowTop + iconSize / 2;
        let x = 0;

        stats.forEach(([icon, value], index) => {
          if (index > 0) {
            // 項目之間的分隔點
            c.textBaseline = "middle";
            c.fillStyle = softInk(ink, 0.35);
            c.font = font(valueSize, 400);
            c.fillText("·", x, cy);
            x += c.measureText("·").width + dotGap;
          }

          c.save();
          c.strokeStyle = softInk(ink, 0.6);
          c.fillStyle = softInk(ink, 0.6);
          c.lineWidth = Math.max(2, size * 0.06);
          c.lineJoin = "round";
          c.lineCap = "round";
          icon(c, x, rowTop, iconSize);
          if (icon === repeatPath) c.stroke();
          else c.fill();
          c.restore();
          x += iconSize + iconGap;

          c.textBaseline = "middle";
          c.fillStyle = softInk(ink, 0.6);
          c.font = font(valueSize, 400);
          c.fillText(value, x, cy);
          x += c.measureText(value).width + dotGap;
        });

        c.textBaseline = "top";
      },
    });
  }

  // ── 留言 ───────────────────────────────────────────────
  const commentLimit = Math.max(0, Math.min(MAX_COMMENTS, style.commentLimit));
  const comments =
    commentLimit > 0
      ? post.comments
          .map((comment, index) => ({ comment, index }))
          .filter(({ comment }) => comment.text.trim() || comment.name.trim())
          .slice(0, commentLimit)
      : [];

  if (comments.length > 0) {
    const avatarSize = Math.round(size * 1.15);
    const nameSize = Math.round(size * 0.78);
    const bodySize = Math.round(size * 0.85);
    const bodyLineH = Math.round(bodySize * 1.5);
    const indent = avatarSize + Math.round(size * 0.45);
    const between = Math.round(size * 0.75);
    const afterRule = Math.round(size * 0.65);

    ctx.font = font(bodySize, 400);
    const items = comments.map(({ comment, index }) => {
      const lines = comment.text.trim()
        ? wrapText(ctx, comment.text.trim(), contentW - indent)
        : [];
      return {
        comment,
        avatar: assets.commentAvatars[index] ?? null,
        lines,
        height: Math.max(avatarSize, nameSize + 6 + lines.length * bodyLineH),
      };
    });

    blocks.push({
      height:
        afterRule + items.reduce((sum, i) => sum + i.height, 0) + (items.length - 1) * between,
      draw: (c, top) => {
        c.strokeStyle = softInk(ink, 0.13);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, top + 1);
        c.lineTo(contentW, top + 1);
        c.stroke();

        let y = top + afterRule;
        for (const item of items) {
          const author = style.maskIdentity ? "匿名" : item.comment.name.trim();
          drawAvatar(c, item.avatar, 0, y, avatarSize, ink, author, style.maskIdentity);

          c.textBaseline = "top";
          c.fillStyle = ink;
          c.font = font(nameSize, 700);
          c.fillText(author, indent, y);

          const likes = item.comment.likes.trim();
          if (likes) {
            const nameW = c.measureText(author).width;
            const heart = Math.round(nameSize * 0.8);
            const hx = indent + nameW + Math.round(size * 0.4);
            c.save();
            c.fillStyle = softInk(ink, 0.45);
            heartPath(c, hx, y + (nameSize - heart) / 2, heart);
            c.fill();
            c.restore();
            c.fillStyle = softInk(ink, 0.45);
            c.font = font(Math.round(nameSize * 0.9), 400);
            c.fillText(likes, hx + heart + Math.round(size * 0.16), y + 1);
          }

          c.fillStyle = softInk(ink, 0.85);
          c.font = font(bodySize, 400);
          item.lines.forEach((line, i) => {
            c.fillText(line, indent, y + nameSize + 6 + i * bodyLineH + (bodyLineH - bodySize) / 2);
          });

          y += item.height + between;
        }
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

  activeStack = findFont(style.fontId).stack;

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
  paintBackground(ctx, style, assets, EXPORT_W, H);

  // 底板（比例大於內容時垂直置中）
  const panelY = Math.round((H - panelH) / 2);
  const panelX = pad;
  const panelW = EXPORT_W - pad * 2;
  const panel = (c: CanvasRenderingContext2D) =>
    roundRect(c, panelX, panelY, panelW, panelH, style.radius);

  if (style.glass) {
    // 先用實色填一次取得外緣陰影；這塊實色隨後會被模糊背景與色調整片蓋掉。
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.34)";
    ctx.shadowBlur = Math.round(style.radius * 1.4 + 26);
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#000";
    panel(ctx);
    ctx.fill();
    ctx.restore();

    // 模糊來源另外畫一份乾淨的背景，避免把剛才的陰影一起模糊進去。
    const source = document.createElement("canvas");
    source.width = EXPORT_W;
    source.height = H;
    const sctx = source.getContext("2d");
    if (sctx) {
      paintBackground(sctx, style, assets, EXPORT_W, H);
      ctx.save();
      panel(ctx);
      ctx.clip();
      ctx.drawImage(frost(source, EXPORT_W, H, style.blur), 0, 0);
      ctx.restore();
    }
  }

  if (style.panelAlpha > 0) {
    ctx.save();
    ctx.fillStyle = hexToRgba(style.panelColor, style.panelAlpha);
    panel(ctx);
    ctx.fill();
    ctx.restore();
  }

  if (style.glass) {
    // 玻璃邊緣的細亮邊，讓底板在背景上有實體感。
    ctx.save();
    ctx.strokeStyle = softInk(style.textColor, 0.22);
    ctx.lineWidth = 2;
    panel(ctx);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(pad + panelPad, 0);
  ctx.textAlign = "left";
  metrics.draw(ctx, panelY + panelPad);
  ctx.restore();
}
