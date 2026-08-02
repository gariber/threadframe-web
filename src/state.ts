import { DEFAULT_BACKGROUND } from "./backgrounds";

export type Ratio = "portrait" | "square" | "auto";

export type Post = {
  name: string;
  handle: string;
  text: string;
  time: string;
  /** dataURL；null 表示沒有頭像，改用文字縮寫圓形。 */
  avatar: string | null;
  /** dataURL，最多 4 張。 */
  images: string[];
  likes: string;
  replies: string;
  reposts: string;
  /** 貼文原始網址，僅顯示於卡片底部（可關閉），不會被送到任何地方。 */
  url: string;
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
  radius: number;
  ratio: Ratio;
  showAvatar: boolean;
  showStats: boolean;
  showTime: boolean;
  showImages: boolean;
  showUrl: boolean;
  maskIdentity: boolean;
};

export type AppState = { post: Post; style: Style };

export const emptyPost = (): Post => ({
  name: "",
  handle: "",
  text: "",
  time: "",
  avatar: null,
  images: [],
  likes: "",
  replies: "",
  reposts: "",
  url: "",
});

export const defaultStyle = (): Style => ({
  bgId: DEFAULT_BACKGROUND.id,
  customBg: null,
  pad: 64,
  textSize: 34,
  textColor: DEFAULT_BACKGROUND.ink,
  panelColor: "#ffffff",
  panelAlpha: 1,
  radius: 28,
  ratio: "auto",
  showAvatar: true,
  showStats: true,
  showTime: true,
  showImages: true,
  showUrl: false,
  maskIdentity: false,
});

const KEY = "threadframe.v1";

/**
 * 只保存排版偏好，不保存貼文內容 —— 貼文可能是別人的，留在裝置上沒有必要。
 * 自訂底圖同樣不寫入，避免把 localStorage 塞爆。
 */
export function saveStyle(style: Style): void {
  try {
    const { customBg: _customBg, ...rest } = style;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // 無痕模式或配額已滿：偏好設定不保存不影響使用。
  }
}

export function loadStyle(): Style {
  const base = defaultStyle();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Style>;
    // 逐鍵套用，忽略型別不符的舊資料，避免舊版本的殘留把畫面弄壞。
    for (const key of Object.keys(base) as (keyof Style)[]) {
      const value = saved[key];
      if (value !== undefined && typeof value === typeof base[key]) {
        (base as Record<string, unknown>)[key] = value;
      }
    }
    base.customBg = null;
  } catch {
    return defaultStyle();
  }
  return base;
}
