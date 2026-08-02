/**
 * 背景一律用 canvas 畫，縮圖與輸出共用同一個 paint 函式 ——
 * 這樣選單裡看到的就是實際會輸出的樣子，不會有 CSS 預覽與 canvas 對不上的問題。
 */
export type Background = {
  id: string;
  name: string;
  /** 這張底圖搭配的底板色與文字色，選背景時會成對套用。 */
  panel: string;
  ink: string;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

type Stop = [number, string];

/** 角度以順時針、0 度為由上往下定義，與 CSS linear-gradient 一致。 */
function linear(angle: number, stops: Stop[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rad = (angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const len = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    const g = ctx.createLinearGradient(
      w / 2 - dx * len,
      h / 2 - dy * len,
      w / 2 + dx * len,
      h / 2 + dy * len,
    );
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
}

function solid(color: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  };
}

/** 對角一刀切成兩色。 */
function split(a: string, b: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = a;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  };
}

/** 方格紙。cells 是短邊要切幾格。 */
function grid(base: string, line: string, cells: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const step = Math.min(w, h) / cells;
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, step * 0.04);
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  };
}

type Blob = { x: number; y: number; r: number; color: string };

/** 底色加上幾團徑向光暈，座標與半徑都是相對短邊的比例。 */
function blobs(base: string, list: Blob[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const unit = Math.max(w, h);
    for (const blob of list) {
      const cx = blob.x * w;
      const cy = blob.y * h;
      const r = blob.r * unit;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, blob.color);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  };
}

/** 等距斜紋。 */
function stripes(base: string, line: string, thickness: number, gap: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const unit = Math.min(w, h);
    ctx.save();
    ctx.strokeStyle = line;
    ctx.lineWidth = unit * thickness;
    ctx.beginPath();
    const step = unit * gap;
    for (let x = -h; x < w + h; x += step) {
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
    ctx.stroke();
    ctx.restore();
  };
}

/** 一條穿過畫面的粗斜帶。 */
function band(base: string, color: string, thickness: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.min(w, h) * thickness;
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h * 1.1);
    ctx.lineTo(w * 1.1, -h * 0.1);
    ctx.stroke();
    ctx.restore();
  };
}

type Disc = { x: number; y: number; r: number; color: string };

/** 底色加上幾個實心圓，用來做疊圓造型。 */
function discs(base: string, list: Disc[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const unit = Math.max(w, h);
    for (const disc of list) {
      ctx.fillStyle = disc.color;
      ctx.beginPath();
      ctx.arc(disc.x * w, disc.y * h, disc.r * unit, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

/** 內建底圖：對應擴充功能的十四款。 */
export const BACKGROUNDS: Background[] = [
  { id: "noir", name: "純黑", panel: "#191919", ink: "#f4f1ec", paint: solid("#0b0b0b") },
  { id: "paper", name: "米白", panel: "#ffffff", ink: "#16130f", paint: solid("#e9e5db") },
  {
    id: "citrus",
    name: "柑橘",
    panel: "#ffffff",
    ink: "#2b1608",
    paint: split("#ff6a1f", "#ffc61f"),
  },
  {
    id: "graph",
    name: "格線",
    panel: "#ffffff",
    ink: "#1e2a08",
    paint: grid("#c9f542", "rgba(60, 90, 10, 0.45)", 9),
  },
  {
    id: "midnight",
    name: "午夜",
    panel: "#141c33",
    ink: "#e8ecf7",
    paint: linear(180, [
      [0, "#080d1c"],
      [1, "#1e2f5e"],
    ]),
  },
  {
    id: "lagoon",
    name: "潟湖",
    panel: "#0f2422",
    ink: "#e6f6f0",
    paint: blobs("#0c1f1e", [
      { x: 0.72, y: 0.24, r: 0.42, color: "rgba(90, 214, 160, 0.75)" },
      { x: 0.22, y: 0.7, r: 0.5, color: "rgba(38, 128, 138, 0.7)" },
    ]),
  },
  {
    id: "teal",
    name: "青碧",
    panel: "#0d2f33",
    ink: "#e6f6f4",
    paint: linear(150, [
      [0, "#0b2a2e"],
      [1, "#26a596"],
    ]),
  },
  {
    id: "plum",
    name: "李",
    panel: "#25101f",
    ink: "#f7e9f1",
    paint: blobs("#1a0b16", [{ x: 0.5, y: 0.42, r: 0.55, color: "rgba(150, 42, 104, 0.8)" }]),
  },
  {
    id: "forest",
    name: "森",
    panel: "#122016",
    ink: "#e9f3e8",
    paint: blobs("#0d1a11", [{ x: 0.6, y: 0.55, r: 0.6, color: "rgba(46, 110, 62, 0.75)" }]),
  },
  {
    id: "flare",
    name: "焰",
    panel: "#3a1410",
    ink: "#fdeee8",
    paint: linear(150, [
      [0, "#ff8a3d"],
      [1, "#c9241f"],
    ]),
  },
  {
    id: "violet",
    name: "紫暈",
    panel: "#241b3d",
    ink: "#efeaff",
    paint: blobs("#4c3fa0", [
      { x: 0.28, y: 0.3, r: 0.4, color: "rgba(196, 172, 255, 0.85)" },
      { x: 0.74, y: 0.72, r: 0.42, color: "rgba(150, 130, 240, 0.85)" },
    ]),
  },
  {
    id: "denim",
    name: "丹寧",
    panel: "#10265c",
    ink: "#eaf0ff",
    paint: stripes("#1749c4", "rgba(10, 40, 120, 0.55)", 0.055, 0.16),
  },
  {
    id: "dune",
    name: "沙丘",
    panel: "#ffffff",
    ink: "#3a2716",
    paint: discs("#f0cf9c", [
      { x: 0.72, y: 0.82, r: 0.3, color: "#c98b4b" },
      { x: 0.3, y: 0.95, r: 0.34, color: "#8a5524" },
    ]),
  },
  {
    id: "slash",
    name: "斜線",
    panel: "#1c1c1c",
    ink: "#f2f2f2",
    paint: band("#111111", "#f2f2f2", 0.13),
  },
];

/**
 * 紙庫：程式生成的桌布，數量比內建多。
 *
 * 刻意不打包任何系統桌布或現成素材 —— 那些有版權，也會讓 repo 肥上數十 MB。
 * 這裡每一張都是用上面那組畫法組出來的。
 */
export const WALLPAPERS: Background[] = [
  {
    id: "sunset",
    name: "夕燒",
    panel: "#2b1512",
    ink: "#fdeee8",
    paint: linear(175, [
      [0, "#1a0d0c"],
      [0.45, "#8f2f1f"],
      [0.75, "#e8623c"],
      [1, "#f98f86"],
    ]),
  },
  {
    id: "aurora",
    name: "極光",
    panel: "#101d24",
    ink: "#e8f6f4",
    paint: linear(150, [
      [0, "#0d1a22"],
      [0.5, "#1f5f66"],
      [1, "#6fd6b4"],
    ]),
  },
  {
    id: "linen",
    name: "亞麻",
    panel: "#ffffff",
    ink: "#2b2521",
    paint: linear(200, [
      [0, "#efe7db"],
      [1, "#d9cbb8"],
    ]),
  },
  {
    id: "sand",
    name: "砂",
    panel: "#fffdf6",
    ink: "#3b2f24",
    paint: linear(150, [
      [0, "#f3e3cc"],
      [1, "#d8b892"],
    ]),
  },
  {
    id: "peach",
    name: "蜜桃",
    panel: "#ffffff",
    ink: "#4a2a24",
    paint: linear(145, [
      [0, "#ffe3d3"],
      [1, "#f7b7a3"],
    ]),
  },
  {
    id: "rose",
    name: "玫瑰",
    panel: "#ffffff",
    ink: "#4a2130",
    paint: linear(155, [
      [0, "#ffd9e2"],
      [1, "#e79bb4"],
    ]),
  },
  {
    id: "lilac",
    name: "紫丁香",
    panel: "#ffffff",
    ink: "#332a4d",
    paint: linear(165, [
      [0, "#e6ddff"],
      [1, "#b7a6ee"],
    ]),
  },
  {
    id: "sky",
    name: "晴空",
    panel: "#ffffff",
    ink: "#17324a",
    paint: linear(170, [
      [0, "#d9ecff"],
      [1, "#a3c9ee"],
    ]),
  },
  {
    id: "mint",
    name: "薄荷",
    panel: "#ffffff",
    ink: "#17402f",
    paint: linear(150, [
      [0, "#d8f3e5"],
      [1, "#a3ddc4"],
    ]),
  },
  {
    id: "moss",
    name: "苔",
    panel: "#ffffff",
    ink: "#22301c",
    paint: linear(160, [
      [0, "#dfe8cf"],
      [1, "#b3c49b"],
    ]),
  },
  {
    id: "dusk",
    name: "暮色",
    panel: "#2a2438",
    ink: "#f6efe9",
    paint: linear(155, [
      [0, "#6b5b7b"],
      [1, "#3a3350"],
    ]),
  },
  {
    id: "ember",
    name: "餘燼",
    panel: "#3a1d1a",
    ink: "#fdeee4",
    paint: linear(150, [
      [0, "#b3583c"],
      [1, "#5e2a26"],
    ]),
  },
  {
    id: "ocean",
    name: "深海",
    panel: "#12222f",
    ink: "#e9f2fa",
    paint: linear(165, [
      [0, "#2b5c7e"],
      [1, "#14283d"],
    ]),
  },
  {
    id: "ink",
    name: "墨",
    panel: "#1d1916",
    ink: "#f2ece6",
    paint: linear(160, [
      [0, "#2a2320"],
      [1, "#141010"],
    ]),
  },
  {
    id: "carbon",
    name: "石墨",
    panel: "#23282b",
    ink: "#eceff1",
    paint: linear(180, [
      [0, "#3d4348"],
      [1, "#1b1f22"],
    ]),
  },
  {
    id: "candy",
    name: "糖霧",
    panel: "#ffffff",
    ink: "#3d1f3a",
    paint: blobs("#f4d9ec", [
      { x: 0.25, y: 0.25, r: 0.45, color: "rgba(255, 190, 220, 0.9)" },
      { x: 0.8, y: 0.75, r: 0.45, color: "rgba(190, 210, 255, 0.9)" },
    ]),
  },
  {
    id: "nebula",
    name: "星雲",
    panel: "#141029",
    ink: "#ecebff",
    paint: blobs("#0a0820", [
      { x: 0.3, y: 0.28, r: 0.42, color: "rgba(120, 80, 220, 0.85)" },
      { x: 0.75, y: 0.66, r: 0.4, color: "rgba(220, 70, 150, 0.7)" },
    ]),
  },
  {
    id: "cobalt",
    name: "鈷藍",
    panel: "#0d1b3d",
    ink: "#e9efff",
    paint: linear(160, [
      [0, "#0a1430"],
      [1, "#2f5fd0"],
    ]),
  },
  {
    id: "lime-split",
    name: "萊姆",
    panel: "#ffffff",
    ink: "#14260a",
    paint: split("#8fd431", "#e4f77f"),
  },
  {
    id: "mono-grid",
    name: "灰格",
    panel: "#ffffff",
    ink: "#1d1d1d",
    paint: grid("#e6e4df", "rgba(0, 0, 0, 0.16)", 11),
  },
  {
    id: "night-grid",
    name: "夜格",
    panel: "#1a1d21",
    ink: "#eef1f4",
    paint: grid("#12151a", "rgba(150, 190, 255, 0.16)", 11),
  },
  {
    id: "coral-stripe",
    name: "珊瑚紋",
    panel: "#ffffff",
    ink: "#42150f",
    paint: stripes("#ff8f6b", "rgba(190, 60, 40, 0.35)", 0.05, 0.15),
  },
  {
    id: "steel",
    name: "鋼",
    panel: "#20262b",
    ink: "#eef2f6",
    paint: linear(140, [
      [0, "#59636d"],
      [0.5, "#2b3238"],
      [1, "#6b7480"],
    ]),
  },
  {
    id: "clay",
    name: "陶土",
    panel: "#ffffff",
    ink: "#3d2118",
    paint: discs("#e8b48d", [
      { x: 0.25, y: 0.2, r: 0.26, color: "#d18f63" },
      { x: 0.78, y: 0.68, r: 0.34, color: "#a9603a" },
    ]),
  },
  {
    id: "abyss",
    name: "深淵",
    panel: "#0e1418",
    ink: "#e6eef2",
    paint: blobs("#070b0e", [{ x: 0.5, y: 0.15, r: 0.6, color: "rgba(40, 90, 120, 0.8)" }]),
  },
  {
    id: "gold-band",
    name: "金帶",
    panel: "#241c0c",
    ink: "#fdf4e0",
    paint: band("#141008", "#e8b62c", 0.12),
  },
];

export const ALL_BACKGROUNDS: Background[] = [...BACKGROUNDS, ...WALLPAPERS];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0];

export function findBackground(id: string): Background {
  return ALL_BACKGROUNDS.find((b) => b.id === id) ?? DEFAULT_BACKGROUND;
}
