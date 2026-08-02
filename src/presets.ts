import type { Style } from "./state";

/**
 * 樣式預設：把底圖、底板、字級、留白、圓角、比例打包成一組具名組合。
 *
 * 只覆寫排版相關的欄位 —— 顯示項目（頭像／統計／留言）與隱私設定屬於
 * 使用者的選擇，套用樣式時不應該被重設。
 */
export type PresetStyle = Pick<
  Style,
  | "bgId"
  | "pad"
  | "textSize"
  | "radius"
  | "panelAlpha"
  | "panelColor"
  | "textColor"
  | "ratio"
  | "glass"
  | "blur"
>;

export type Preset = {
  id: string;
  name: string;
  style: PresetStyle;
};

export const PRESETS: Preset[] = [
  {
    id: "clean",
    name: "純淨白",
    style: {
      bgId: "paper",
      pad: 64,
      textSize: 34,
      radius: 28,
      panelAlpha: 1,
      panelColor: "#ffffff",
      textColor: "#16130f",
      ratio: "auto",
      glass: false,
      blur: 40,
    },
  },
  {
    id: "night",
    name: "夜間",
    style: {
      bgId: "ink",
      pad: 64,
      textSize: 34,
      radius: 28,
      panelAlpha: 1,
      panelColor: "#1d1916",
      textColor: "#f2ece6",
      ratio: "auto",
      glass: false,
      blur: 40,
    },
  },
  {
    id: "magazine",
    name: "雜誌感",
    style: {
      bgId: "linen",
      pad: 104,
      textSize: 30,
      radius: 4,
      panelAlpha: 1,
      panelColor: "#ffffff",
      textColor: "#2b2521",
      ratio: "portrait",
      glass: false,
      blur: 40,
    },
  },
  {
    id: "note",
    name: "便條紙",
    style: {
      bgId: "sand",
      pad: 44,
      textSize: 32,
      radius: 12,
      panelAlpha: 1,
      panelColor: "#fffdf6",
      textColor: "#3b2f24",
      ratio: "portrait",
      glass: false,
      blur: 40,
    },
  },
  {
    id: "poster",
    name: "大字報",
    style: {
      bgId: "ember",
      pad: 72,
      textSize: 48,
      radius: 32,
      panelAlpha: 1,
      panelColor: "#3a1d1a",
      textColor: "#fdeee4",
      ratio: "square",
      glass: false,
      blur: 40,
    },
  },
  {
    id: "haze",
    name: "柔霧",
    style: {
      bgId: "lilac",
      pad: 72,
      textSize: 34,
      radius: 40,
      // 對齊滑桿的 5% 刻度，否則控制項會吸附到 70% 而與實際值不一致。
      panelAlpha: 0.45,
      panelColor: "#ffffff",
      textColor: "#2b2340",
      ratio: "portrait",
      glass: true,
      blur: 48,
    },
  },
  {
    id: "glass-sunset",
    name: "夕燒玻璃",
    style: {
      bgId: "sunset",
      pad: 72,
      textSize: 34,
      radius: 36,
      panelAlpha: 0.4,
      panelColor: "#1a0f0d",
      textColor: "#fdf1ec",
      ratio: "portrait",
      glass: true,
      blur: 56,
    },
  },
  {
    id: "glass-aurora",
    name: "極光玻璃",
    style: {
      bgId: "aurora",
      pad: 72,
      textSize: 34,
      radius: 36,
      panelAlpha: 0.4,
      panelColor: "#0b171d",
      textColor: "#e9f7f4",
      ratio: "portrait",
      glass: true,
      blur: 56,
    },
  },
];
