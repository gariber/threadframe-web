export type Background = {
  id: string;
  name: string;
  /** 漸層角度（度）。0 = 由上往下。 */
  angle: number;
  /** [位置 0–1, 顏色] */
  stops: [number, string][];
  /**
   * 這張底圖搭配的底板色與文字色。文字是畫在底板上、不是畫在背景上，
   * 所以兩者必須成對切換 —— 只換文字色會做出白底白字。
   */
  panel: string;
  ink: string;
};

const LIGHT = "#ffffff";
const DARK = "#1d1916";

export const BACKGROUNDS: Background[] = [
  { id: "paper", name: "紙", angle: 160, panel: LIGHT, ink: "#16130f", stops: [[0, "#f6f2ea"], [1, "#e6ded1"]] },
  { id: "linen", name: "亞麻", angle: 200, panel: LIGHT, ink: "#2b2521", stops: [[0, "#efe7db"], [1, "#d9cbb8"]] },
  { id: "sand", name: "砂", angle: 150, panel: LIGHT, ink: "#3b2f24", stops: [[0, "#f3e3cc"], [1, "#d8b892"]] },
  { id: "peach", name: "蜜桃", angle: 145, panel: LIGHT, ink: "#4a2a24", stops: [[0, "#ffe3d3"], [1, "#f7b7a3"]] },
  { id: "rose", name: "玫瑰", angle: 155, panel: LIGHT, ink: "#4a2130", stops: [[0, "#ffd9e2"], [1, "#e79bb4"]] },
  { id: "lilac", name: "紫丁香", angle: 165, panel: LIGHT, ink: "#332a4d", stops: [[0, "#e6ddff"], [1, "#b7a6ee"]] },
  { id: "sky", name: "晴空", angle: 170, panel: LIGHT, ink: "#17324a", stops: [[0, "#d9ecff"], [1, "#a3c9ee"]] },
  { id: "mint", name: "薄荷", angle: 150, panel: LIGHT, ink: "#17402f", stops: [[0, "#d8f3e5"], [1, "#a3ddc4"]] },
  { id: "moss", name: "苔", angle: 160, panel: LIGHT, ink: "#22301c", stops: [[0, "#dfe8cf"], [1, "#b3c49b"]] },
  { id: "dusk", name: "暮色", angle: 155, panel: "#2a2438", ink: "#f6efe9", stops: [[0, "#6b5b7b"], [1, "#3a3350"]] },
  { id: "ember", name: "餘燼", angle: 150, panel: "#3a1d1a", ink: "#fdeee4", stops: [[0, "#b3583c"], [1, "#5e2a26"]] },
  { id: "ocean", name: "深海", angle: 165, panel: "#12222f", ink: "#e9f2fa", stops: [[0, "#2b5c7e"], [1, "#14283d"]] },
  { id: "ink", name: "墨", angle: 160, panel: DARK, ink: "#f2ece6", stops: [[0, "#2a2320"], [1, "#141010"]] },
  { id: "carbon", name: "石墨", angle: 180, panel: "#23282b", ink: "#eceff1", stops: [[0, "#3d4348"], [1, "#1b1f22"]] },
];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0];

export function findBackground(id: string): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? DEFAULT_BACKGROUND;
}

/**
 * 依角度在畫布上建立線性漸層。角度以「順時針、0 度為由上往下」定義，
 * 與 CSS linear-gradient 一致，方便日後把預設值搬到 CSS 上預覽。
 */
export function makeGradient(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  w: number,
  h: number,
): CanvasGradient {
  const rad = (bg.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // 讓漸層線覆蓋整個矩形對角，避免角落出現斷色。
  const len = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const g = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
  for (const [offset, color] of bg.stops) g.addColorStop(offset, color);
  return g;
}
