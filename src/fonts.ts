export type Font = { id: string; name: string; stack: string };

/**
 * 字體一律用系統內建字型堆疊 —— 不外連字型檔，離線與隱私都不受影響，
 * 也避免 canvas 在字型還沒載入時算出錯誤的行寬。
 */
export const FONTS: Font[] = [
  {
    id: "sans",
    name: "黑體",
    stack:
      '"PingFang TC", "Noto Sans TC", "Hiragino Sans TC", "Microsoft JhengHei", system-ui, -apple-system, sans-serif',
  },
  {
    id: "serif",
    name: "襯線",
    stack:
      '"Songti TC", "Noto Serif TC", "Source Han Serif TC", "Times New Roman", Georgia, serif',
  },
  {
    id: "rounded",
    name: "圓體",
    stack:
      '"Yuanti TC", "Hiragino Maru Gothic ProN", "Noto Sans TC", "PingFang TC", system-ui, sans-serif',
  },
  {
    id: "mono",
    name: "等寬",
    stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK TC", monospace',
  },
];

export const DEFAULT_FONT = FONTS[0];

export function findFont(id: string): Font {
  return FONTS.find((f) => f.id === id) ?? DEFAULT_FONT;
}
