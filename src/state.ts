import { DEFAULT_BACKGROUND } from "./backgrounds";

export type Ratio = "portrait" | "tall" | "square" | "auto";

/**
 * 時間要寫成絕對（2026-08-07 07:40）還是相對（6 小時）。
 *
 * 絕對是預設：卡片是會被存下來、之後才看到的圖，「6 小時」在那時候已經不成立。
 * 但限時動態之類的用途講求即時感，相對時間比較貼近原本在 Threads 上的觀感。
 */
export type TimeFormat = "absolute" | "relative";

export const MAX_COMMENTS = 4;

export type Comment = {
  name: string;
  /** 帳號（不含 @），顯示在名稱下方。 */
  handle: string;
  text: string;
  /** 相對時間，例如「13 小時」。 */
  time: string;
  likes: string;
  replies: string;
  reposts: string;
  shares: string;
  /** dataURL；null 時改用名稱首字的圓形底。 */
  avatar: string | null;
  /**
   * 這則留言是不是「貼留言連結」帶進來的。
   *
   * 只影響卡片上那條從貼文頭像連到留言頭像的細線：那條線是在說「我要分享的
   * 是這則回覆」，只有刻意指定某則留言時才成立。自動帶入的熱門留言只是附帶
   * 資訊，畫了線反而像在強調它。
   */
  fromLink?: boolean;
};

export const emptyComment = (): Comment => ({
  name: "",
  handle: "",
  text: "",
  time: "",
  likes: "",
  replies: "",
  reposts: "",
  shares: "",
  avatar: null,
});

export type Post = {
  name: string;
  /** Threads 的貼文話題；與正文分開，顯示在作者名稱旁。 */
  topic: string;
  handle: string;
  text: string;
  time: string;
  /**
   * 自動帶入時的原始發文時間（Unix 秒）。留著才能在切換時間格式時重新換算 ——
   * 只存 time 那串字的話，切過去就回不來了。手動輸入時為 null。
   */
  takenAt: number | null;
  /** dataURL；null 表示沒有頭像，改用文字縮寫圓形。 */
  avatar: string | null;
  /** dataURL，最多 4 張。 */
  images: string[];
  likes: string;
  replies: string;
  reposts: string;
  shares: string;
  /** 貼文原始網址，僅顯示於卡片底部（可關閉），不會被送到任何地方。 */
  url: string;
  comments: Comment[];
};

export type Style = {
  bgId: string;
  /** 使用者自訂底圖的 dataURL；有值時優先於 bgId。 */
  customBg: string | null;
  pad: number;
  textSize: number;
  textColor: string;
  panelColor: string;
  panelAlpha: number;
  /** 毛玻璃：底板下方的背景會被模糊，而不是清晰穿透。 */
  glass: boolean;
  /** 毛玻璃的模糊強度（輸出像素）。 */
  blur: number;
  radius: number;
  ratio: Ratio;
  showAvatar: boolean;
  showStats: boolean;
  showTime: boolean;
  timeFormat: TimeFormat;
  showImages: boolean;
  /** 最多顯示幾張貼文圖片（1–4）。 */
  imageLimit: number;
  showUrl: boolean;
  /** 卡片右上角的 Threads 標誌。 */
  showLogo: boolean;
  /** 卡片右下角的品牌標記。 */
  showBrand: boolean;
  /** 展示幾則留言，0 表示不展示。 */
  commentLimit: number;
  maskIdentity: boolean;
  fontId: string;
};

export type AppState = { post: Post; style: Style };

export const emptyPost = (): Post => ({
  name: "",
  topic: "",
  handle: "",
  text: "",
  time: "",
  takenAt: null,
  avatar: null,
  images: [],
  likes: "",
  replies: "",
  reposts: "",
  shares: "",
  url: "",
  comments: [],
});

export const defaultStyle = (): Style => ({
  bgId: DEFAULT_BACKGROUND.id,
  customBg: null,
  pad: 64,
  textSize: 34,
  textColor: DEFAULT_BACKGROUND.ink,
  // 底板色與文字色必須取自同一張底圖，分開寫死會做出白底白字。
  panelColor: DEFAULT_BACKGROUND.panel,
  panelAlpha: 1,
  glass: false,
  blur: 40,
  radius: 28,
  ratio: "auto",
  showAvatar: true,
  showStats: true,
  showTime: true,
  timeFormat: "absolute",
  showImages: true,
  // 貼文有幾張就放幾張（上限 4）。原本預設只放第一張，但多圖貼文的重點
  // 常常就在後面幾張，只出現第一張看起來像是壞掉而不是刻意的選擇。
  imageLimit: 4,
  // 原始網址預設不畫。卡片是要拿去分享的，一條長網址在下面只是干擾 ——
  // 需要出處的人自己開得起來，需要標註的人再自己打開這個開關。
  showUrl: false,
  showLogo: true,
  showBrand: true,
  // 留言預設不展示。留言會把卡片拉得很長，而多數時候要分享的是貼文本身。
  // 注意這只影響「畫不畫」：自動帶入照樣會把留言填進欄位，
  // 想秀的時候把「展示留言數目」調上去就立刻出現，不必重新帶入。
  commentLimit: 0,
  maskIdentity: false,
  fontId: "sans",
});

const KEY = "threadframe.v1";

/**
 * 存檔格式版本。用來辨認「這份設定是哪一版寫的」，不是用來丟掉舊設定的。
 *
 *   1（沒有這個欄位）預設是「圖片 1 張、留言 3 則」
 *   2              圖片改 4 張、留言改 4 則
 *   3              留言改成不展示、原始網址改成不顯示
 */
const SCHEMA = 4;

/**
 * 只保存排版偏好，不保存貼文內容 —— 貼文可能是別人的，留在裝置上沒有必要。
 * 自訂底圖同樣不寫入，避免把 localStorage 塞爆。
 */
export function saveStyle(style: Style): void {
  try {
    const { customBg: _customBg, ...rest } = style;
    localStorage.setItem(KEY, JSON.stringify({ ...rest, schema: SCHEMA }));
  } catch {
    // 無痕模式或配額已滿：偏好設定不保存不影響使用。
  }
}

export function loadStyle(): Style {
  const base = defaultStyle();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Style> & { schema?: number };
    // 逐鍵套用，忽略型別不符的舊資料，避免舊版本的殘留把畫面弄壞。
    for (const key of Object.keys(base) as (keyof Style)[]) {
      const value = saved[key];
      if (value !== undefined && typeof value === typeof base[key]) {
        (base as Record<string, unknown>)[key] = value;
      }
    }
    base.customBg = null;

    /*
     * 預設值改版時，把存檔裡「多半只是舊預設值」的那幾項拉到新預設。
     *
     * 這些開關幾乎沒有人會特地去調，存下來的絕大多數就是當時的預設本身；
     * 照抄回來的話，使用者更新後會看到卡片沒有任何變化，以為新版沒生效。
     *
     * 每一段只碰**那一版真正改過預設**的欄位，而且逐版累積地跑 ——
     * 整組重設會把使用者在上一版特地選過的值一起清掉。
     */
    const fresh = defaultStyle();
    const from = saved.schema ?? 1;

    // v2：圖片 1 張 → 4 張、留言 3 則 → 4 則
    if (from < 2) {
      base.imageLimit = fresh.imageLimit;
      base.commentLimit = fresh.commentLimit;
    }
    // v3：留言改成不展示、原始網址改成不顯示（兩者都讓卡片變長變雜）
    if (from < 3) {
      base.commentLimit = fresh.commentLimit;
      base.showUrl = fresh.showUrl;
    }
    /*
     * v4：「顯示項目」整區從介面拿掉了。
     *
     * 那些開關現在沒有地方可以調，存檔裡若留著舊的選擇（例如當初把貼文圖片
     * 關掉），使用者就再也打不開，而且找不到原因。一律拉回預設。
     */
    if (from < 4) {
      base.showAvatar = fresh.showAvatar;
      base.showStats = fresh.showStats;
      base.showTime = fresh.showTime;
      base.timeFormat = fresh.timeFormat;
      base.showImages = fresh.showImages;
      base.imageLimit = fresh.imageLimit;
      base.showUrl = fresh.showUrl;
      base.showLogo = fresh.showLogo;
      base.showBrand = fresh.showBrand;
    }
  } catch {
    return defaultStyle();
  }
  return base;
}
