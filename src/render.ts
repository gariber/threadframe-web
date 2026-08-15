import { findBackground } from "./backgrounds";
import { DEFAULT_FONT, findFont } from "./fonts";
import { MAX_COMMENTS, type Post, type Ratio, type Style } from "./state";

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
  /** 同上，留言自己帶的附圖。 */
  commentImages: (HTMLImageElement | null)[];
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

/**
 * 一行文字實際佔掉的高度。**呼叫前要先設好 ctx.font。**
 *
 * 不能拿字級當行高。字級是 em 框的大小，而 CJK 的字身本來就會超出 em 框
 * （中文字型的 ascent + descent 通常是字級的 1.15–1.4 倍），拿字級去排
 * 上下兩行，畫出來就是黏在一起 —— 名稱與 @帳號 之間只剩幾個像素。
 *
 * fontBoundingBox 才是這個字型真正要的空間。舊瀏覽器沒有這組數值時，
 * 退回一個對中文夠用的比例。
 */
function lineHeight(ctx: CanvasRenderingContext2D, size: number): number {
  const m = ctx.measureText("字");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number" && ascent + descent > 0) {
    return Math.round(ascent + descent);
  }
  return Math.round(size * 1.25);
}

/** 單行文字超出時保留省略號，避免作者名稱＋話題撞出卡片右緣。 */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text || maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = "…";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  const chars = [...text];
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(chars.slice(0, mid).join("") + ellipsis).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + ellipsis;
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
 * canvas 的 filter 能不能用。不能只看 "filter" in ctx —— 屬性存在但不支援時，
 * 指派會被靜靜忽略，所以寫進去再讀回來比對才算數。
 */
function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  const before = ctx.filter;
  try {
    ctx.filter = "blur(1px)";
    return ctx.filter === "blur(1px)";
  } catch {
    return false;
  } finally {
    ctx.filter = before;
  }
}

/**
 * 毛玻璃用的模糊。
 *
 * 優先走原生高斯模糊，**全解析度處理**。先前是把整張背景縮到 1/10 再放大，
 * 靠取樣平均當作模糊 —— 那對純色漸層看不出來，但格線紙會被抹成扭曲的波紋、
 * 斜切背景的交界會變成鋸齒。底板底下的畫質整個掉一級，而且只有底板那一塊掉，
 * 跟旁邊清晰的背景擺在一起特別明顯。
 *
 * 原生 filter 不支援時才退回縮放法，並且把縮小倍率壓在 4 倍以內，
 * 讓最壞情況不要壞得那麼難看。
 */
function frost(source: HTMLCanvasElement, w: number, h: number, radius: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return source;

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  if (supportsCanvasFilter(octx)) {
    const r = Math.max(1, Math.round(radius / 3));
    octx.filter = `blur(${r}px)`;
    // 往外多畫一圈再模糊：不這麼做的話，四邊會把畫布外的透明像素混進來，
    // 底板若貼近邊緣就會出現一圈變暗的痕跡。
    octx.drawImage(source, -r, -r, w + r * 2, h + r * 2);
    octx.filter = "none";
    return out;
  }

  const step = Math.min(4, Math.max(2, Math.round(radius / 8)));
  const sw = Math.max(1, Math.round(w / step));
  const sh = Math.max(1, Math.round(h / step));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  if (!sctx) return source;

  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(source, 0, 0, sw, sh);
  octx.drawImage(small, 0, 0, w, h);
  return out;
}


/**
 * Threads 標誌的官方路徑（SVG 的 d 屬性，座標在 24×24 的方框裡）。
 *
 * 一定要用原始路徑，不能自己描弧線 —— 這個字符的筆畫粗細是變化的
 * （左下最粗、右上收尖），它是一個「填滿的形狀」而不是「描邊的線條」，
 * 用固定線寬畫弧線在原理上就重現不了。
 */
const THREADS_LOGO_VIEWBOX = 24;
const THREADS_LOGO_PATH =
  "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z";

/** 建一次就好；renderCard 會在拖滑桿時被反覆呼叫。 */
let threadsLogo: Path2D | null = null;

/** 把 Threads 標誌填在 (x, y) 起點、邊長 s 的方框裡。 */
function drawThreadsLogo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  if (!threadsLogo) threadsLogo = new Path2D(THREADS_LOGO_PATH);
  const scale = s / THREADS_LOGO_VIEWBOX;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(threadsLogo);
  ctx.restore();
}

/** 統計圖示的繪製函式：在 (x, y) 起點、邊長 s 的方框裡描出形狀。 */
type IconPath = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void;

/*
 * 四個統計圖示都畫成**外框線**，與 Threads 上的一致 ——
 * 那邊只有「已按讚」時才會是實心紅色，卡片是靜態的快照，一律用未按讚的樣子。
 *
 * 每個 path 都畫在同一個 s×s 的方框裡，而且**四個的實際筆畫都要撐滿
 * 大約 x 0.08–0.92、y 0.10–0.90 這個範圍**。否則同樣的 s 畫出來，
 * 佔框比例大的（泡泡）看起來就是比佔框比例小的（轉發）大一號，
 * 排成一列時大小參差不齊。改任何一個 path 都要順手檢查這件事。
 */

/**
 * 讚：愛心外框。
 *
 * 控制點刻意落在方框外（負值、超過 1）—— 貝茲曲線不會通過控制點，
 * 把控制點放在 0–1 之內畫出來的愛心只有方框的三分之二大，
 * 排在其他三個圖示旁邊會明顯小一號。這些值是量出來的，不是估的。
 */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cx = x + s / 2;
  ctx.beginPath();
  ctx.moveTo(cx, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 0.08, y + s * 0.49, x - s * 0.03, y - s * 0.06, cx, y + s * 0.18);
  ctx.bezierCurveTo(x + s * 1.03, y - s * 0.06, x + s * 1.08, y + s * 0.49, cx, y + s * 0.9);
  ctx.closePath();
}

/** 留言：對話泡泡，左下角帶一個小尾巴。 */
function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  // 尾巴要算進總高度，泡泡本身因此比其他圖示的外圍略小一點。
  ctx.ellipse(x + s / 2, y + s * 0.44, s * 0.42, s * 0.34, 0, 0, Math.PI * 2);
  // 尾巴獨立成一段開放路徑：跟泡泡連在同一個 path 裡描邊會多出一條穿過泡泡的線。
  ctx.moveTo(x + s * 0.3, y + s * 0.72);
  ctx.lineTo(x + s * 0.19, y + s * 0.9);
  ctx.lineTo(x + s * 0.44, y + s * 0.76);
}

/**
 * 分享：紙飛機外框。中間那條折線是關鍵 —— 少了它就只是一個空心三角形，
 * 看起來會像播放鍵而不是紙飛機。
 */
function sendPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.92, y + s * 0.1);
  ctx.lineTo(x + s * 0.08, y + s * 0.44);
  ctx.lineTo(x + s * 0.43, y + s * 0.57);
  ctx.lineTo(x + s * 0.56, y + s * 0.9);
  ctx.closePath();
  ctx.moveTo(x + s * 0.92, y + s * 0.1);
  ctx.lineTo(x + s * 0.43, y + s * 0.57);
}

/** 轉發：上下兩支反向的箭頭，各自在末端轉一個直角。 */
function repeatPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  // 上排：往右，右端向下收
  ctx.moveTo(x + s * 0.1, y + s * 0.52);
  ctx.lineTo(x + s * 0.1, y + s * 0.26);
  ctx.lineTo(x + s * 0.8, y + s * 0.26);
  ctx.moveTo(x + s * 0.64, y + s * 0.1);
  ctx.lineTo(x + s * 0.82, y + s * 0.26);
  ctx.lineTo(x + s * 0.64, y + s * 0.42);
  // 下排：往左，左端向上收
  ctx.moveTo(x + s * 0.9, y + s * 0.48);
  ctx.lineTo(x + s * 0.9, y + s * 0.74);
  ctx.lineTo(x + s * 0.2, y + s * 0.74);
  ctx.moveTo(x + s * 0.36, y + s * 0.9);
  ctx.lineTo(x + s * 0.18, y + s * 0.74);
  ctx.lineTo(x + s * 0.36, y + s * 0.58);
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

  /*
   * 作者列標的是**帳號**，不是顯示名稱 —— Threads 自己就是這樣排的。
   *
   * 顯示名稱動輒很長（很多人把服務項目整串寫進名稱裡），塞進卡片會把整行
   * 撐爆還得截斷，話題就被擠掉了。帳號短、唯一、而且是大家實際用來找人的東西。
   * 沒有帳號時才退回顯示名稱，這樣手動輸入的卡片仍然有東西可顯示。
   */
  const topic = post.topic.trim().replace(/^#+\s*/, "");
  const rawHandle = post.handle.trim().replace(/^@/, "");
  const author = style.maskIdentity ? "匿名" : rawHandle || post.name.trim();
  const headline = topic ? [author, topic].filter(Boolean).join(" › ") : author;

  // ── 標誌橫條 ───────────────────────────────────────────
  /*
   * 自成一條窄橫條，標誌**置中**。
   *
   * 靠右擺過，不好看：左邊一大片空白，標誌像是不小心留下的記號。
   * 置中之後兩側留白對稱，整條才讀得出來是「標題列」而不是漂浮的裝飾。
   * 這也順便避開跟時間打架 —— 時間同樣靠右。
   */
  if (style.showLogo) {
    const logoSize = Math.round(size * 1.5);
    blocks.push({
      height: logoSize + Math.round(size * 0.5),
      draw: (c, top) => {
        drawThreadsLogo(c, (contentW - logoSize) / 2, top, logoSize, softInk(ink, 0.5));
      },
    });
  }

  // ── 作者列 ─────────────────────────────────────────────
  // 只有一行：頭像 ＋「帳號 › 話題」＋ 時間。
  // 先前是名稱一行、@帳號一行，改成 Threads 的排法之後第二行就不需要了。
  if (headline || (style.showAvatar && assets.avatar)) {
    const avatarSize = Math.round(size * 1.75);
    const nameSize = Math.round(size * 0.95);
    const avatarGap = Math.round(size * 0.5);
    ctx.font = font(nameSize, 700);
    const headLineH = lineHeight(ctx, nameSize);
    const headH = Math.max(style.showAvatar ? avatarSize : 0, headLineH);

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
            author,
            style.maskIdentity,
          );
          x += avatarSize + avatarGap;
        }

        c.textBaseline = "top";
        const ty = top + (headH - headLineH) / 2;

        // 時間不放在這裡 —— 它自成一行落在內容下方、統計上方（見下方的時間區塊）。
        if (headline) {
          c.fillStyle = ink;
          c.font = font(nameSize, 700);
          c.fillText(ellipsize(c, headline, Math.max(0, contentW - x)), x, ty);
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

  // ── 貼文圖片（依方向自動適配） ─────────────────────────
  const images = style.showImages
    ? assets.images.slice(0, Math.max(0, Math.min(4, style.imageLimit)))
    : [];
  if (images.length > 0) {
    const corner = Math.round(size * 0.4);
    const gap = Math.round(size * 0.2);
    let height: number;
    let cells: { x: number; y: number; w: number; h: number }[];
    let single = false;

    if (images.length === 1) {
      // 單張維持原始比例，不裁切。
      const img = images[0];
      height = Math.min((contentW * img.naturalHeight) / img.naturalWidth, contentW * 1.4);
      cells = [{ x: 0, y: 0, w: contentW, h: height }];
      single = true;
    } else {
      /*
       * 多張按「一行兩張」逐行判斷方向：
       *
       * - 橫圖／方圖維持原本的正方形格，不改已經好看的橫圖排法。
       * - 直圖使用 Threads 常見的 2:3 卡位，少裁掉上下內容。
       * - 一直一橫時依各自卡位比例分配欄寬，所以同一行仍等高，但直圖較窄、
       *   橫圖較寬；不必犧牲其中一張去遷就另一張。
       * - 最後落單的奇數張獨佔整排，固定成約 2:1 的橫向收尾。
       */
      const portraitRatio = 2 / 3;
      const isPortrait = (img: HTMLImageElement) =>
        img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth * 1.05;
      cells = [];
      let y = 0;

      for (let i = 0; i < images.length; i += 2) {
        const first = images[i];
        const second = images[i + 1];

        if (!second) {
          const oddHeight = (contentW - gap) / 2;
          cells.push({ x: 0, y, w: contentW, h: oddHeight });
          y += oddHeight;
          continue;
        }

        const firstRatio = isPortrait(first) ? portraitRatio : 1;
        const secondRatio = isPortrait(second) ? portraitRatio : 1;
        const rowHeight = (contentW - gap) / (firstRatio + secondRatio);
        const firstWidth = rowHeight * firstRatio;
        // 讓第二格吃掉浮點數尾差，右緣一定與 contentW 齊平。
        const secondWidth = contentW - gap - firstWidth;

        cells.push(
          { x: 0, y, w: firstWidth, h: rowHeight },
          { x: firstWidth + gap, y, w: secondWidth, h: rowHeight },
        );
        y += rowHeight;

        if (i + 2 < images.length) y += gap;
      }

      height = y;
    }

    blocks.push({
      height,
      draw: (c, top) => {
        // 每一格各自裁圓角。多張之間有間距，整塊套一個外框圓角是看不出來的。
        images.forEach((img, i) => {
          const cell = cells[i];
          c.save();
          roundRect(c, cell.x, top + cell.y, cell.w, cell.h, single ? corner : corner * 0.75);
          c.clip();
          c.fillStyle = softInk(ink, 0.06);
          c.fillRect(cell.x, top + cell.y, cell.w, cell.h);
          // 多圖填滿依方向算出的卡位；單張仍維持完整畫面。
          const place = single ? drawContain : drawCover;
          place(c, img, cell.x, top + cell.y, cell.w, cell.h);
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
  const stats: [IconPath, string][] = [];
  if (style.showStats) {
    if (post.likes.trim()) stats.push([heartPath, post.likes.trim()]);
    if (post.replies.trim()) stats.push([bubblePath, post.replies.trim()]);
    if (post.reposts.trim()) stats.push([repeatPath, post.reposts.trim()]);
    if (post.shares.trim()) stats.push([sendPath, post.shares.trim()]);
  }
  if (stats.length > 0) {
    const baseIconSize = Math.round(size * 0.85);
    const baseValueSize = Math.round(size * 0.8);
    const ruleGap = Math.round(size * 0.5);
    const baseIconGap = Math.round(size * 0.28);
    const baseDotGap = Math.round(size * 0.42);

    /**
     * 統計列永遠從正文左緣開始；右側預留一點呼吸空間。
     *
     * 留白與字級都能由使用者大幅調整，四個數字也可能同時很長。固定尺寸時，
     * 可用寬度一縮小就會把整列擠到右邊甚至裁掉。先量自然寬度，只有放不下時
     * 才把圖示、文字與間距一起等比縮小，讓不同設定下的節奏維持一致。
     */
    const measureRow = (iconSize: number, valueSize: number, iconGap: number, dotGap: number) => {
      ctx.font = font(valueSize, 400);
      const dotW = ctx.measureText("·").width;
      return stats.reduce(
        (sum, [, value], index) =>
          sum +
          (index > 0 ? dotW + dotGap : 0) +
          iconSize +
          iconGap +
          ctx.measureText(value).width +
          (index < stats.length - 1 ? dotGap : 0),
        0,
      );
    };

    const naturalW = measureRow(baseIconSize, baseValueSize, baseIconGap, baseDotGap);
    const safeW = Math.max(1, contentW - Math.round(size * 0.4));
    const fit = Math.min(1, safeW / Math.max(1, naturalW));

    blocks.push({
      height: ruleGap + Math.ceil(baseIconSize * fit),
      draw: (c, top) => {
        // 統計上方的細線，與時間隔開。
        c.strokeStyle = softInk(ink, 0.13);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, top + 1);
        c.lineTo(contentW, top + 1);
        c.stroke();

        const rowTop = top + ruleGap;
        c.save();
        c.translate(0, rowTop);
        c.scale(fit, fit);
        const cy = baseIconSize / 2;

        c.font = font(baseValueSize, 400);

        /*
         * 數字改用基線定位，而不是 textBaseline="middle"。
         *
         * "middle" 對齊的是字型 em 框的中線，那條線會把上伸部與下伸部一起算進去；
         * 阿拉伯數字沒有下伸部，全部落在基線之上，所以用 "middle" 畫出來的數字
         * 會整體偏低，跟旁邊置中的圖示對不齊 —— 差距小但一整列看得很清楚。
         * 改成量數字實際的字身高度，讓字身中線落在 cy 上。
         *
         * textBaseline 必須先設成 alphabetic 再量：actualBoundingBoxAscent 是
         * 相對於「當下的 textBaseline」量的，在 top 之下量會得到接近 0 的值，
         * 算出來的位移等於沒有位移。
         */
        c.textBaseline = "alphabetic";
        const capH = c.measureText("0").actualBoundingBoxAscent;
        const textBase = cy + capH / 2;
        let x = 0;

        stats.forEach(([icon, value], index) => {
          if (index > 0) {
            // 項目之間的分隔點。這一顆是標點，維持 middle 才會落在行中央。
            c.textBaseline = "middle";
            c.fillStyle = softInk(ink, 0.35);
            c.font = font(baseValueSize, 400);
            c.fillText("·", x, cy);
            c.textBaseline = "alphabetic";
            x += c.measureText("·").width + baseDotGap;
          }

          c.save();
          c.strokeStyle = softInk(ink, 0.6);
          c.lineWidth = Math.max(2, size * 0.055);
          c.lineJoin = "round";
          c.lineCap = "round";
          // 圖示的方框以 cy 為中心，與數字的字身中線對齊。
          icon(c, x, cy - baseIconSize / 2, baseIconSize);
          // 四個都描邊，不填色 —— Threads 上只有自己按過的那個才是實心。
          c.stroke();
          c.restore();
          x += baseIconSize + baseIconGap;

          c.fillStyle = softInk(ink, 0.6);
          c.font = font(baseValueSize, 400);
          c.fillText(value, x, textBase);
          x += c.measureText(value).width + baseDotGap;
        });

        c.restore();
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
    /*
     * 版面照 Threads 上留言的樣子：
     *
     *   [頭像]  帳號  3 小時
     *           內文……
     *           [附圖]
     *           ♡ 521   💬 1   ⇄ 4   ➤ 11
     *   ───────────────────────────────────
     *
     * 三個關鍵：帳號與時間**同一行**（時間緊接在後，不是靠右對齊）、
     * 內文**縮排對齊帳號**而不是切齊最左、每則下面都有完整的四項互動。
     */
    const avatarSize = Math.round(size * 1.05);
    const nameSize = Math.round(size * 0.74);
    const metaSize = Math.round(size * 0.66);
    const bodySize = Math.round(size * 0.84);
    const bodyLineH = Math.round(bodySize * 1.5);
    const labelSize = Math.round(size * 0.6);
    const statSize = Math.round(size * 0.62);
    const statIcon = Math.round(size * 0.66);

    const afterRule = Math.round(size * 0.6);
    const afterLabel = Math.round(size * 0.7);
    const between = Math.round(size * 0.7);
    const afterHead = Math.round(size * 0.24);
    const beforeImage = Math.round(size * 0.34);
    const beforeStats = Math.round(size * 0.34);

    /** 內文與互動列都對齊帳號，不是對齊卡片左緣。 */
    const indent = avatarSize + Math.round(size * 0.4);
    const textW = contentW - indent;

    // 留言的附圖不該搶走主體的版面 —— 壓在內容寬度的六成以內。
    const imageMaxW = Math.round(textW * 0.72);
    const imageMaxH = Math.round(size * 9);
    const imageCorner = Math.round(size * 0.3);

    ctx.font = font(nameSize, 700);
    const headLineH = lineHeight(ctx, nameSize);
    const headH = Math.max(avatarSize, headLineH);
    ctx.font = font(statSize, 400);
    const statLineH = Math.max(statIcon, lineHeight(ctx, statSize));

    ctx.font = font(bodySize, 400);
    const items = comments.map(({ comment, index }) => {
      const lines = comment.text.trim() ? wrapText(ctx, comment.text.trim(), textW) : [];

      const image = assets.commentImages[index] ?? null;
      let imageW = 0;
      let imageH = 0;
      if (image && image.naturalWidth > 0) {
        // 取三者最小：寬度上限、高度上限、1（小圖維持原尺寸，放大只會糊掉）。
        const fit = Math.min(imageMaxW / image.naturalWidth, imageMaxH / image.naturalHeight, 1);
        imageW = Math.round(image.naturalWidth * fit);
        imageH = Math.round(image.naturalHeight * fit);
      }

      // 四個圖示一律畫出來，數字只在不是零的時候出現 —— Threads 就是這樣。
      const stats: [IconPath, string][] = [
        [heartPath, comment.likes.trim()],
        [bubblePath, comment.replies.trim()],
        [repeatPath, comment.reposts.trim()],
        [sendPath, comment.shares.trim()],
      ];

      return {
        comment,
        avatar: assets.commentAvatars[index] ?? null,
        image,
        imageW,
        imageH,
        lines,
        stats,
        height:
          headH +
          (lines.length > 0 ? afterHead + lines.length * bodyLineH : 0) +
          (imageH > 0 ? beforeImage + imageH : 0) +
          beforeStats +
          statLineH,
      };
    });

    const label = `THREAD REPLIES · ${items.length}`;

    blocks.push({
      height:
        afterRule +
        labelSize +
        afterLabel +
        items.reduce((sum, i) => sum + i.height, 0) +
        (items.length - 1) * between,
      draw: (c, top) => {
        c.strokeStyle = softInk(ink, 0.13);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, top + 1);
        c.lineTo(contentW, top + 1);
        c.stroke();

        // 留言區的標頭。貼文與留言一起出現時，少了它就分不出下面是誰在說話。
        c.textBaseline = "top";
        c.fillStyle = softInk(ink, 0.4);
        c.font = font(labelSize, 700);
        c.fillText(label, 0, top + afterRule);

        let y = top + afterRule + labelSize + afterLabel;
        items.forEach((item, itemIndex) => {
          // Threads 的留言列標的是帳號，不是顯示名稱。沒有帳號時才退回名稱，
          // 這樣手動加的留言仍然有東西可以顯示。
          const handle = item.comment.handle.trim().replace(/^@/, "");
          const author = style.maskIdentity ? "匿名" : handle || item.comment.name.trim();
          drawAvatar(c, item.avatar, 0, y, avatarSize, ink, author, style.maskIdentity);

          // 帳號與時間同一行，用基線定位讓兩個不同字級的字身對齊。
          c.textBaseline = "alphabetic";
          c.font = font(nameSize, 700);
          const headBase = y + headLineH / 2 + c.measureText("字").actualBoundingBoxAscent / 2;
          c.fillStyle = ink;
          c.fillText(author, indent, headBase);
          const time = item.comment.time.trim();
          if (time) {
            const nameW = c.measureText(author).width;
            c.font = font(metaSize, 400);
            c.fillStyle = softInk(ink, 0.38);
            c.fillText(time, indent + nameW + Math.round(size * 0.34), headBase);
          }
          c.textBaseline = "top";

          let cursor = y + headH;

          if (item.lines.length > 0) {
            cursor += afterHead;
            c.fillStyle = softInk(ink, 0.85);
            c.font = font(bodySize, 400);
            item.lines.forEach((line, i) => {
              c.fillText(line, indent, cursor + i * bodyLineH + (bodyLineH - bodySize) / 2);
            });
            cursor += item.lines.length * bodyLineH;
          }

          if (item.image && item.imageH > 0) {
            cursor += beforeImage;
            c.save();
            roundRect(c, indent, cursor, item.imageW, item.imageH, imageCorner);
            c.clip();
            c.drawImage(item.image, indent, cursor, item.imageW, item.imageH);
            c.restore();
            cursor += item.imageH;
          }

          // 互動列
          cursor += beforeStats;
          const statMid = cursor + statLineH / 2;
          c.font = font(statSize, 400);
          c.textBaseline = "alphabetic";
          const statBase = statMid + c.measureText("0").actualBoundingBoxAscent / 2;
          let sx = indent;
          for (const [icon, value] of item.stats) {
            c.save();
            c.strokeStyle = softInk(ink, 0.45);
            c.lineWidth = Math.max(1.5, size * 0.045);
            c.lineJoin = "round";
            c.lineCap = "round";
            icon(c, sx, statMid - statIcon / 2, statIcon);
            c.stroke();
            c.restore();
            sx += statIcon;
            if (value) {
              const gap = Math.round(size * 0.14);
              c.fillStyle = softInk(ink, 0.45);
              c.fillText(value, sx + gap, statBase);
              sx += gap + c.measureText(value).width;
            }
            sx += Math.round(size * 0.62);
          }
          c.textBaseline = "top";

          y += item.height;

          // 每則之間一條細線，與 Threads 上留言之間的分隔一致。
          if (itemIndex < items.length - 1) {
            const dividerY = y + Math.round(between / 2);
            c.strokeStyle = softInk(ink, 0.08);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(indent, dividerY);
            c.lineTo(contentW, dividerY);
            c.stroke();
            y += between;
          }
        });
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

  // ── 品牌標記 ───────────────────────────────────────────
  /*
   * 右下角一行小字。刻意做得比原始網址還輕：字級更小、透明度更低、
   * 不加粗 —— 它要能看清，但不能跟貼文內容搶注意力。
   *
   * 不寫「Made by」：東西出現在卡片角落本來就代表是誰做的，那三個字是贅字。
   * 網域放在後面，因為對看到卡片的人來說，「去哪裡找得到」比「誰做的」有用。
   */
  if (style.showBrand) {
    const brandSize = Math.round(size * 0.62);
    const brand = "ThreadsFrame · gariber.studio";
    blocks.push({
      height: brandSize + 4,
      draw: (c, top) => {
        c.font = font(brandSize, 400);
        c.fillStyle = softInk(ink, 0.3);
        c.textBaseline = "top";
        c.fillText(brand, contentW - c.measureText(brand).width, top);
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

  /*
   * 比例給的是**最小高度**，不是固定高度：內容比它長時卡片就往下長。
   * 這樣「9:16」對長貼文才不會把內容裁掉，短貼文又拿得到限時動態的版型。
   */
  const MIN_HEIGHT: Record<Ratio, number> = {
    portrait: Math.round(EXPORT_W * 1.25), // 4:5
    tall: Math.round((EXPORT_W * 16) / 9), // 9:16
    square: EXPORT_W,
    auto: 0,
  };
  const H = Math.max(contentH, MIN_HEIGHT[style.ratio] ?? 0);

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
