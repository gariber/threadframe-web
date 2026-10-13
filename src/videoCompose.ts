import {
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  getFirstEncodableVideoCodec,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  Quality,
  UrlSource,
  WEBM,
} from "mediabunny";
import { paintMediaFrame, type MediaSlot } from "./render";
import { ComposeError, describeError } from "./videoComposeLite";

/**
 * 影片卡片的離線合成：不必把影片播一遍，而是一格一格解碼、疊進卡片、再用硬體編碼器壓成 MP4。
 *
 * 跟即時錄製（videoCard 的 MediaRecorder 路線）比：
 * - 快：手機的硬體編碼器通常比即時快好幾倍，不必等影片播完。
 * - 原聲不重壓：音軌的封包直接搬進新檔，音質與原片完全相同。
 * - 不掉格：每一格都會處理到，手機忙的時候也不會漏。
 *
 * 靠 WebCodecs（iOS 16.4 起）加 Mediabunny（拆解、編碼、封裝 MP4）。
 * 這個模組只在真的要合成時才被動態載入（連同 Mediabunny），平常開 app 不必下載它；
 * 主程式要用的判斷與錯誤型別放在 videoComposeLite。
 */

export type ComposeInput = {
  /** renderCard 畫好的整張卡片（沒有影片的那一版）。 */
  base: HTMLCanvasElement;
  /** 影片要畫進去的那一格。 */
  slot: MediaSlot;
  /** 影片網址。影片 CDN 支援 Range，只會抓需要的片段，不必整支下載。 */
  url: string;
  backdrop: string;
  fileBase: string;
  /** 最長輸出幾秒，超過就截掉後面。 */
  maxSeconds: number;
  /** 0–1。 */
  onProgress: (progress: number) => void;
  signal: AbortSignal;
};

export type ComposeResult = {
  file: File;
  seconds: number;
  /** 原片有聲音、但這次沒帶進去（格式搬不過來也無法重新編碼時）。 */
  droppedAudio: boolean;
};

export async function composeVideoCard(input: ComposeInput): Promise<ComposeResult> {
  const { base, slot } = input;
  const width = base.width;
  const height = base.height;

  // 依偏好順序挑第一個編得出來的格式：H.264 是 iPhone 相簿、IG、LINE 都吃的；
  // 其餘只在沒有 H.264 編碼器的瀏覽器（例如 Chromium）當退路。
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  const quality = new Quality(8_000_000);
  const preferred = (["avc", "hevc", "vp9", "av1"] as const).filter((c) =>
    format.getSupportedVideoCodecs().includes(c),
  );
  const codec = await getFirstEncodableVideoCodec([...preferred], { width, height, quality });
  if (!codec) throw new ComposeError("這台裝置的編碼器不支援這個卡片尺寸。", "fallback");

  const source = new Input({
    source: new UrlSource(input.url),
    // 只認 Threads 會出現的容器格式。用 ALL_FORMATS 會把 HLS、MPEG-TS 等解析器全打包進來，
    // 載入的程式大好幾倍。
    formats: [MP4, QTFF, WEBM, MATROSKA],
  });
  const target = new BufferTarget();
  const output = new Output({ format, target });

  // 合成用的畫布，每一格都重複使用：Mediabunny 拿到畫布後會立刻拷成 VideoFrame。
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const ctx = frame.getContext("2d");
  if (!ctx) throw new ComposeError("無法建立合成畫布。", "fallback");

  let duration: number;
  try {
    duration = await source.computeDuration();
  } catch (e) {
    throw new ComposeError("影片讀取失敗。", "fallback", describeError(e));
  }
  const end = Math.min(duration, input.maxSeconds);

  const conversion = await Conversion.init({
    input: source,
    output,
    trim: { start: 0, end },
    video: {
      codec,
      quality,
      forceTranscode: true,
      processedWidth: width,
      processedHeight: height,
      // 關鍵畫格密一點（預設 5 秒一格）：分享到社群後拖曳預覽比較順，檔案只大一點點。
      keyFrameInterval: 2,
      process: (sample) => {
        ctx.drawImage(base, 0, 0);
        paintMediaFrame(
          ctx,
          slot,
          sample.toCanvasImageSource(),
          sample.displayWidth,
          sample.displayHeight,
          input.backdrop,
        );
        return frame;
      },
    },
    // 音訊不指定任何轉換：能直接搬就原封不動搬（AAC → MP4），原聲一點都不損失。
    audio: {},
    showWarnings: false,
  });

  if (!conversion.isValid) {
    throw new ComposeError("這支影片的格式無法離線合成。", "fallback");
  }
  const hasVideo = conversion.utilizedTracks.some((t) => t.isVideoTrack());
  if (!hasVideo) throw new ComposeError("這台裝置解不開這支影片。", "fallback");
  const droppedAudio = conversion.discardedTracks.some(
    (d) => d.track.isAudioTrack() && d.reason !== "discarded_by_user",
  );

  conversion.onProgress = (p) => input.onProgress(p);
  const abort = () => void conversion.cancel();
  input.signal.addEventListener("abort", abort, { once: true });

  try {
    await conversion.execute();
  } catch (e) {
    if (e instanceof ConversionCanceledError) throw new ComposeError("已停止。", "canceled");
    // 編碼器中途失敗（多半是記憶體不夠）時改走即時錄製，至少還做得出來。
    throw new ComposeError("合成時發生錯誤。", "fallback", describeError(e));
  } finally {
    input.signal.removeEventListener("abort", abort);
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new ComposeError("合成結果是空的。", "fallback");
  const file = new File([buffer], `${input.fileBase}.mp4`, { type: "video/mp4" });
  return { file, seconds: end, droppedAudio };
}
