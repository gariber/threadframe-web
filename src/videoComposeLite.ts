/**
 * 離線合成的輕量入口：判斷支不支援、預先載入、錯誤型別。
 *
 * 跟 videoCompose 分開放，是為了讓主程式引用這些東西時**不會**把 Mediabunny 一起打包進來 ——
 * 它只在真的要合成時才用動態 import 載入。
 */

/** 這個瀏覽器有沒有離線合成要用的 WebCodecs。沒有就退回即時錄製。 */
export function canComposeOffline(): boolean {
  return (
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
export class ComposeError extends Error {
  constructor(
    message: string,
    readonly kind: "fallback" | "canceled" | "failed",
  ) {
    super(message);
  }
}

/** 提早載入合成程式，讓使用者按下去的時候已經下載好了。 */
export function preloadComposer(): void {
  if (canComposeOffline()) void import("./videoCompose").catch(() => {});
}
