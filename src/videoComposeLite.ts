/**
 * 離線合成的輕量入口：判斷支不支援、預先載入、錯誤型別。
 *
 * 跟 videoCompose 分開放，是為了讓主程式引用這些東西時**不會**把 Mediabunny 一起打包進來 ——
 * 它只在真的要合成時才用動態 import 載入。
 */

/**
 * iPhone、iPad 與 Mac 的 Safari（iOS 上所有瀏覽器底層都是它）。
 *
 * 它們雖然有 WebCodecs，實際用起來離線合成並不順，即時錄製反而穩定，
 * 所以這些裝置直接走即時錄製。
 */
function isWebKitSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 預設把自己報成 Mac，只能靠觸控點數認出來。
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const desktopSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android/.test(ua);
  return iOS || desktopSafari;
}

/** 這個瀏覽器能不能離線合成。不行就用即時錄製。 */
export function canComposeOffline(): boolean {
  return (
    !isWebKitSafari() &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}

/**
 * 合成沒有產出影片時丟出來的錯誤。
 *
 * - `fallback`：這台裝置做不到離線合成（例如編碼器不支援這個尺寸），應該改走即時錄製。
 * - `canceled`：使用者自己按了停止，不算失敗。
 */
export function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export class ComposeError extends Error {
  constructor(
    message: string,
    readonly kind: "fallback" | "canceled" | "failed",
    /** 底層錯誤的原文，顯示在畫面上方便回報問題。 */
    readonly detail = "",
  ) {
    super(message);
  }
}

/** 提早載入合成程式，讓使用者按下去的時候已經下載好了。 */
export function preloadComposer(): void {
  if (canComposeOffline()) void import("./videoCompose").catch(() => {});
}
