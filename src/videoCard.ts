import { paintMediaFrame, type MediaSlot } from "./render";

/**
 * 影片卡片：把貼文影片放進卡片的媒體格裡播放，並錄成一支影片檔。
 *
 * 做法是「卡片本體只算繪一次、影片一格一格疊上去」：
 * renderCard 畫好的整張卡片先存一份底圖，之後每來一格影片，就把底圖貼回畫布、
 * 再把這一格影片畫進媒體格。文字排版與毛玻璃模糊都很貴，每秒重做三十次手機會喘。
 *
 * 錄影用 canvas.captureStream 加 MediaRecorder，是**即時**錄製 —— 影片多長就要錄多久。
 * 瀏覽器沒有「離線快轉輸出」的通用做法（WebCodecs 在 iOS 上的音訊編碼還不齊全），
 * 即時錄是目前唯一在 iPhone 與電腦上都走得通、而且帶得到原聲的路。
 */

/**
 * 卡片超過這個高度就不錄。H.264 編碼器在手機上多半只吃到 4096，
 * 留一點餘裕；真的這麼長的卡片通常是留言勾太多，拿掉幾則就好。
 */
export const MAX_VIDEO_HEIGHT = 3840;

/** 一支影片卡片最長錄幾秒。IG 限時動態單段 60 秒，再長也分享不出去。 */
export const MAX_VIDEO_SECONDS = 60;

/**
 * 依序嘗試的輸出格式。MP4（H.264 + AAC）排最前面：iPhone 的相簿、IG、LINE 都吃；
 * WebM 只在不支援 MP4 錄製的瀏覽器（例如 Firefox）當退路。
 */
const MIME_CANDIDATES = [
  // High profile level 5.1：1080 寬、比 1920 還高的長卡片也在規格內。
  // 常見的 avc1.42E01F 是 Baseline 3.1，上限只到 720p，1080 寬的卡片會超標。
  "video/mp4;codecs=avc1.640033,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** 這台裝置能不能錄影片卡片。不能的話介面就不要出現錄製按鈕。 */
export function canRecordVideo(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.captureStream === "function" && pickRecordingMime() !== null;
}

type RecordOptions = {
  fileBase: string;
  onProgress: (seconds: number, total: number) => void;
  onDone: (file: File | null, error?: string) => void;
};

/** requestVideoFrameCallback 在 Safari 15.4+、Chrome 都有；沒有的話退回 rAF。 */
type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class VideoCard {
  private video: FrameCallbackVideo | null = null;
  private base = document.createElement("canvas");
  private slot: MediaSlot | null = null;
  /**
   * 第一格畫得出來之後就一直算「有影片」。不能每次看 readyState：錄完跳回開頭
   * 重播的那一瞬間它會掉回 HAVE_METADATA，整個錄製區（連同「分享影片」）就跟著消失。
   */
  private ready = false;
  private loopHandle = 0;
  private loopIsVideoFrame = false;

  private audioCtx: AudioContext | null = null;
  /** createMediaElementSource 對同一個 video 只能呼叫一次，要跟著影片一起記住。 */
  private audioSource: MediaElementAudioSourceNode | null = null;
  private audioDest: MediaStreamAudioDestinationNode | null = null;

  private recorder: MediaRecorder | null = null;
  private recordLimit = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly backdrop: () => string,
  ) {}

  /** 有影片、而且卡片上真的有一格可以放它。 */
  get active(): boolean {
    return this.video !== null && this.slot !== null && this.ready;
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** 影片長度（秒），錄製上限以內。還不知道時為 0。 */
  get recordSeconds(): number {
    const d = this.video?.duration ?? 0;
    return Number.isFinite(d) && d > 0 ? Math.min(d, MAX_VIDEO_SECONDS) : 0;
  }

  /**
   * 載入一支影片。第一格可以畫之後才 resolve；載入失敗就 reject，
   * 呼叫端退回靜態封面即可 —— 卡片本來就已經用封面圖排好版了。
   */
  load(url: string): Promise<void> {
    this.clear();

    const video = document.createElement("video") as FrameCallbackVideo;
    // 影片 CDN 帶 `access-control-allow-origin: *`。不設 crossOrigin 的話畫布會被污染，
    // 既不能錄也不能存圖。
    video.crossOrigin = "anonymous";
    // 靜音 + playsinline 才能在 iPhone 上自動播放；錄製時才打開聲音。
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "auto";
    this.video = video;

    return new Promise((resolve, reject) => {
      video.addEventListener(
        "loadeddata",
        () => {
          if (this.video !== video) return;
          this.ready = true;
          this.paint();
          void video.play().catch(() => {
            // 省電模式之類擋掉自動播放時，停在第一格也還是一張正常的卡片。
          });
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          if (this.video === video) this.clear();
          reject(new Error("影片載入失敗"));
        },
        { once: true },
      );
      video.addEventListener("play", () => this.startLoop());
      video.addEventListener("pause", () => this.stopLoop());
      video.src = url;
    });
  }

  /** 拿掉目前的影片（換下一則貼文、改貼文字時）。 */
  clear(): void {
    this.stopRecording();
    this.stopLoop();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.video = null;
    this.slot = null;
    this.ready = false;
    this.audioSource?.disconnect();
    this.audioSource = null;
  }

  /**
   * renderCard 畫完之後呼叫：把整張卡片存成底圖，記下影片那一格的位置，
   * 並立刻把目前這一格影片疊上去（暫停中也要，不然畫面會退回封面）。
   */
  afterRender(slots: MediaSlot[]): void {
    if (!this.video) return;
    this.slot = slots[0] ?? null;
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.base.getContext("2d")?.drawImage(this.canvas, 0, 0);
    this.paint();
  }

  private paint(): void {
    const video = this.video;
    const slot = this.slot;
    if (!video || !slot || video.readyState < 2) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx || this.base.width !== this.canvas.width) return;
    ctx.drawImage(this.base, 0, 0);
    paintMediaFrame(ctx, slot, video, video.videoWidth, video.videoHeight, this.backdrop());

    if (this.recorder && video.currentTime >= this.recordLimit) this.stopRecording();
  }

  private startLoop(): void {
    if (this.loopHandle) return;
    const video = this.video;
    if (!video) return;

    // 有 requestVideoFrameCallback 就跟著影片的真實影格走：影片 30fps 就畫 30 次，
    // 不會在 120Hz 螢幕上白白重畫四倍。
    const step = () => {
      this.loopHandle = 0;
      if (!this.video || this.video.paused) return;
      this.paint();
      this.schedule(step);
    };
    this.schedule(step);
  }

  private schedule(step: () => void): void {
    const video = this.video;
    if (!video) return;
    if (video.requestVideoFrameCallback) {
      this.loopIsVideoFrame = true;
      this.loopHandle = video.requestVideoFrameCallback(step);
    } else {
      this.loopIsVideoFrame = false;
      this.loopHandle = requestAnimationFrame(step);
    }
  }

  private stopLoop(): void {
    if (!this.loopHandle) return;
    if (this.loopIsVideoFrame) this.video?.cancelVideoFrameCallback?.(this.loopHandle);
    else cancelAnimationFrame(this.loopHandle);
    this.loopHandle = 0;
  }

  /**
   * 開始錄製。**必須在使用者點擊的當下同步呼叫** —— iPhone 只允許在點擊裡
   * 取消靜音播放、啟動音訊。這裡刻意不 await 任何東西再去碰影片。
   */
  startRecording(opts: RecordOptions): void {
    const video = this.video;
    const mime = pickRecordingMime();
    if (!video || !this.slot || !mime || this.recorder) {
      opts.onDone(null, "這台裝置的瀏覽器不支援錄製影片。");
      return;
    }
    if (this.canvas.height > MAX_VIDEO_HEIGHT) {
      opts.onDone(null, "卡片太長，錄不成影片。少勾幾則留言、或縮小文字再試一次。");
      return;
    }

    this.recordLimit = this.recordSeconds || MAX_VIDEO_SECONDS;

    video.pause();
    video.loop = false;
    video.currentTime = 0;
    video.muted = false;
    const playing = video.play();

    const tracks: MediaStreamTrack[] = [...this.canvas.captureStream(30).getVideoTracks()];
    const audio = this.audioTracks(video);
    tracks.push(...audio);
    const stream = new MediaStream(tracks);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.restorePreview();
      opts.onDone(null, "這台裝置的瀏覽器不支援錄製影片。");
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const progress = window.setInterval(() => {
      opts.onProgress(Math.min(video.currentTime, this.recordLimit), this.recordLimit);
    }, 250);

    recorder.onstop = () => {
      window.clearInterval(progress);
      // 只停畫布那一條；音訊軌屬於共用的 AudioContext，停掉下次就錄不到聲音。
      stream.getVideoTracks().forEach((t) => t.stop());
      const type = mime.split(";")[0];
      const ext = type === "video/mp4" ? "mp4" : "webm";
      const blob = new Blob(chunks, { type });
      opts.onDone(blob.size > 0 ? new File([blob], `${opts.fileBase}.${ext}`, { type }) : null);
    };

    video.addEventListener("ended", () => this.stopRecording(), { once: true });
    this.recorder = recorder;
    recorder.start(1000);

    void playing.catch(() => {
      // 播放被擋（例如省電模式）：停掉錄製，錄到的空檔案會在 onDone 回報成失敗。
      this.stopRecording();
    });
  }

  /** 停止錄製（使用者提早按停止、影片播完、或到達上限）。 */
  stopRecording(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    if (recorder.state !== "inactive") recorder.stop();
    this.restorePreview();
  }

  private restorePreview(): void {
    const video = this.video;
    if (!video) return;
    video.muted = true;
    video.loop = true;
    void video.play().catch(() => {});
  }

  /**
   * 影片的原聲。透過 Web Audio 接出來，而且**不接到喇叭** —— 錄製時手機不會突然
   * 出聲，錄進去的仍是完整音軌。取不到（瀏覽器不支援、影片沒有音軌）就錄無聲版。
   */
  private audioTracks(video: HTMLVideoElement): MediaStreamTrack[] {
    try {
      if (!this.audioCtx) {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return [];
        this.audioCtx = new Ctx();
        this.audioDest = this.audioCtx.createMediaStreamDestination();
      }
      if (!this.audioSource) {
        this.audioSource = this.audioCtx.createMediaElementSource(video);
        if (this.audioDest) this.audioSource.connect(this.audioDest);
      }
      void this.audioCtx.resume();
      return this.audioDest?.stream.getAudioTracks() ?? [];
    } catch {
      return [];
    }
  }
}
