import "./styles.css";
import { BACKGROUNDS, findBackground, WALLPAPERS, type Background } from "./backgrounds";
import { FONTS } from "./fonts";
import { PRESETS, type Preset } from "./presets";
import { parsePastedPost } from "./parse";
import { renderCard, type Assets } from "./render";
import {
  defaultStyle,
  emptyComment,
  emptyPost,
  loadStyle,
  MAX_COMMENTS,
  saveStyle,
  type Comment,
  type Post,
  type Ratio,
  type Style,
} from "./state";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const post: Post = emptyPost();
let style: Style = loadStyle();
const assets: Assets = { avatar: null, images: [], bg: null, commentAvatars: [] };

const canvas = $<HTMLCanvasElement>("canvas");
const emptyMsg = $("empty");
const result = $("result");
const resultImg = $<HTMLImageElement>("result-img");

/** 匯出用的 blob URL，換圖時要回收，否則長時間使用會累積記憶體。 */
let lastObjectUrl: string | null = null;

// ── 圖片載入 ─────────────────────────────────────────────
const MAX_SIDE = 2048;

/**
 * 讀成 dataURL 並在超過上限時縮圖。
 * 手機拍的照片動輒 4000px 以上，直接丟進 canvas 會讓低階裝置爆記憶體。
 */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取失敗"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("這個檔案不是圖片"));
      img.onload = () => {
        const longest = Math.max(img.naturalWidth, img.naturalHeight);
        if (longest <= MAX_SIDE) return resolve(img);

        const scale = MAX_SIDE / longest;
        const off = document.createElement("canvas");
        off.width = Math.round(img.naturalWidth * scale);
        off.height = Math.round(img.naturalHeight * scale);
        const ctx = off.getContext("2d");
        if (!ctx) return resolve(img);
        ctx.drawImage(img, 0, 0, off.width, off.height);
        const small = new Image();
        small.onload = () => resolve(small);
        small.onerror = () => resolve(img);
        small.src = off.toDataURL("image/jpeg", 0.92);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── 算繪排程 ─────────────────────────────────────────────
let frame = 0;

function hasContent(): boolean {
  return Boolean(post.name.trim() || post.text.trim() || assets.images.length > 0);
}

function draw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const ready = hasContent();
    canvas.hidden = !ready;
    emptyMsg.hidden = ready;
    $<HTMLButtonElement>("export").disabled = !ready;
    if (ready) renderCard(canvas, post, style, assets);
  });
}

function commit(): void {
  saveStyle(style);
  // 手動調過任何一個滑桿就不再吻合任何預設，選中狀態要跟著撤掉。
  paintPresets();
  draw();
}

// ── 貼上與帶入 ───────────────────────────────────────────
const intake = $<HTMLTextAreaElement>("intake");

function applyIntake(): void {
  const raw = intake.value.trim();
  if (!raw) return;
  const parsed = parsePastedPost(raw);

  if (parsed.name !== undefined) post.name = parsed.name;
  if (parsed.handle !== undefined) post.handle = parsed.handle;
  if (parsed.text !== undefined) post.text = parsed.text;
  if (parsed.time !== undefined) post.time = parsed.time;
  if (parsed.likes !== undefined) post.likes = parsed.likes;
  if (parsed.replies !== undefined) post.replies = parsed.replies;
  if (parsed.reposts !== undefined) post.reposts = parsed.reposts;
  if (parsed.shares !== undefined) post.shares = parsed.shares;
  if (parsed.url !== undefined) post.url = parsed.url;

  syncFields();

  // 只貼網址是最常見的用法，但網頁讀不到貼文內容 —— 與其默默把連結
  // 當成內文畫進卡片，不如直接說清楚為什麼沒有東西出現。
  const status = $("intake-status");
  const gotContent = Boolean(parsed.text?.trim() || parsed.name?.trim());

  if (gotContent) {
    status.hidden = true;
    // 內容已經進到下面的欄位，留著原始貼上區只會讓人以為還沒帶入。
    intake.value = "";
  } else if (parsed.url) {
    status.hidden = false;
    status.textContent =
      "只收到網址，已填進「網址」欄。網頁沒辦法從 Threads 讀出貼文內容 —— 請回到那則貼文，長按內文選取文字並複製，再貼一次。";
  } else {
    status.hidden = false;
    status.textContent = "看不出貼文內容，請直接在下面「貼文內容」的欄位填寫。";
  }

  draw();
}

$("apply").addEventListener("click", applyIntake);

$("paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      intake.value = text;
      applyIntake();
    }
  } catch {
    // Safari 未授權或非安全來源：使用者自己長按貼上即可。
    intake.focus();
  }
});

// ── 貼文欄位 ─────────────────────────────────────────────
const fields: [string, keyof Post][] = [
  ["f-name", "name"],
  ["f-handle", "handle"],
  ["f-text", "text"],
  ["f-time", "time"],
  ["f-likes", "likes"],
  ["f-replies", "replies"],
  ["f-reposts", "reposts"],
  ["f-shares", "shares"],
  ["f-url", "url"],
];

for (const [id, key] of fields) {
  const el = $<HTMLInputElement | HTMLTextAreaElement>(id);
  el.addEventListener("input", () => {
    (post[key] as string) = el.value;
    draw();
  });
}

function syncFields(): void {
  for (const [id, key] of fields) {
    $<HTMLInputElement | HTMLTextAreaElement>(id).value = post[key] as string;
  }
  updateImageCount();
}

function updateImageCount(): void {
  const n = assets.images.length;
  $("image-count").textContent = n > 0 ? `已加入 ${n} 張貼文圖片（最多 4 張）` : "";
}

$<HTMLInputElement>("f-avatar").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  assets.avatar = await fileToImage(file);
  post.avatar = assets.avatar.src;
  draw();
});

$<HTMLInputElement>("f-images").addEventListener("change", async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])].slice(0, 4);
  assets.images = await Promise.all(files.map(fileToImage));
  updateImageCount();
  draw();
});

$("clear-images").addEventListener("click", () => {
  assets.images = [];
  $<HTMLInputElement>("f-images").value = "";
  updateImageCount();
  draw();
});

// ── 樣式預設 ─────────────────────────────────────────────
const presetList = $("presets");

function matchesPreset(preset: Preset): boolean {
  if (style.customBg) return false;
  return (Object.keys(preset.style) as (keyof Preset["style"])[]).every(
    (key) => style[key] === preset.style[key],
  );
}

function applyPreset(preset: Preset): void {
  Object.assign(style, preset.style);
  // 預設自帶底圖，套用時要把使用者上傳的自訂底圖讓開。
  style.customBg = null;
  assets.bg = null;
  $<HTMLInputElement>("f-bg").value = "";
  syncControls();
  paintAllSwatches();
  commit();
}

function paintPresets(): void {
  presetList.replaceChildren();

  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.setAttribute("aria-pressed", String(matchesPreset(preset)));

    const thumb = document.createElement("span");
    thumb.className = "preset-thumb";

    // 底圖同樣用它自己的 paint 畫，與實際輸出一致。
    const bgThumb = document.createElement("canvas");
    bgThumb.width = 124;
    bgThumb.height = 156;
    const bctx = bgThumb.getContext("2d");
    if (bctx) findBackground(preset.style.bgId).paint(bctx, bgThumb.width, bgThumb.height);
    thumb.append(bgThumb);

    // 縮圖裡的小方塊代表底板，讓圓角、留白與透明度一眼看得出差異。
    const panel = document.createElement("span");
    panel.className = "preset-panel";
    panel.style.background = preset.style.panelColor;
    panel.style.opacity = String(preset.style.panelAlpha);
    panel.style.borderRadius = `${Math.max(1, preset.style.radius / 7)}px`;
    panel.style.inset = `${Math.round(preset.style.pad / 14)}px`;
    if (preset.style.glass) {
      // 縮圖用 CSS 的 backdrop-filter 呈現毛玻璃，與 canvas 的做法不同但視覺一致。
      panel.style.backdropFilter = `blur(${Math.max(2, Math.round(preset.style.blur / 12))}px)`;
      panel.style.border = "1px solid rgba(255, 255, 255, 0.35)";
    }
    thumb.append(panel);

    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.name;

    btn.append(thumb, name);
    btn.addEventListener("click", () => applyPreset(preset));
    presetList.append(btn);
  }
}

// ── 留言 ─────────────────────────────────────────────────
const commentList = $("comments");
const addComment = $<HTMLButtonElement>("add-comment");

function labelled(text: string, control: HTMLElement, stack = false): HTMLLabelElement {
  const label = document.createElement("label");
  if (stack) label.className = "stack";
  label.append(text, control);
  return label;
}

function paintComments(): void {
  commentList.replaceChildren();

  post.comments.forEach((comment, index) => {
    const row = document.createElement("div");
    row.className = "comment-row";

    const head = document.createElement("div");
    head.className = "comment-head";
    const title = document.createElement("span");
    title.textContent = `留言 ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => {
      post.comments.splice(index, 1);
      assets.commentAvatars.splice(index, 1);
      paintComments();
      draw();
    });
    head.append(title, remove);

    const bind = <K extends keyof Comment>(el: HTMLInputElement | HTMLTextAreaElement, key: K) => {
      el.value = comment[key] as string;
      el.addEventListener("input", () => {
        (comment[key] as string) = el.value;
        draw();
      });
    };

    const name = document.createElement("input");
    name.type = "text";
    name.autocomplete = "off";
    bind(name, "name");

    const text = document.createElement("textarea");
    text.rows = 2;
    bind(text, "text");

    const likes = document.createElement("input");
    likes.type = "text";
    likes.inputMode = "numeric";
    bind(likes, "likes");

    const avatar = document.createElement("input");
    avatar.type = "file";
    avatar.accept = "image/*";
    avatar.addEventListener("change", async () => {
      const file = avatar.files?.[0];
      if (!file) return;
      const img = await fileToImage(file);
      assets.commentAvatars[index] = img;
      comment.avatar = img.src;
      draw();
    });

    const bottom = document.createElement("div");
    bottom.className = "triple";
    bottom.append(labelled("讚", likes), labelled("頭像", avatar));

    row.append(head, labelled("名稱", name), labelled("內文", text, true), bottom);
    commentList.append(row);
  });

  addComment.disabled = post.comments.length >= MAX_COMMENTS;
  $("comment-hint").textContent =
    post.comments.length >= MAX_COMMENTS
      ? `最多 ${MAX_COMMENTS} 則。留言同樣要自己貼上 —— 網頁讀不到 Threads 的留言串。`
      : `最多 ${MAX_COMMENTS} 則，依照你排列的順序顯示。`;
}

addComment.addEventListener("click", () => {
  if (post.comments.length >= MAX_COMMENTS) return;
  post.comments.push(emptyComment());
  assets.commentAvatars.push(null);
  paintComments();
  draw();
});

// ── 背景 ─────────────────────────────────────────────────
const swatches = $("swatches");
const wallpapers = $("wallpapers");
const savedList = $("saved");

/** 套用一張內建底圖：底板色與文字色必須一起換，否則深底會做出白底白字。 */
function applyBackground(bg: Background): void {
  style.bgId = bg.id;
  style.customBg = null;
  assets.bg = null;
  style.textColor = bg.ink;
  style.panelColor = bg.panel;
  $<HTMLInputElement>("f-bg").value = "";
  syncControls();
  paintAllSwatches();
  commit();
}

/**
 * 縮圖直接用底圖自己的 paint 畫在小 canvas 上 ——
 * 選單看到的就是實際輸出，不會有另寫一份 CSS 預覽對不上的問題。
 */
function swatchButton(bg: Background, big = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = bg.name;
  btn.setAttribute("aria-label", bg.name);
  btn.setAttribute("aria-pressed", String(!style.customBg && style.bgId === bg.id));
  if (big) btn.classList.add("big");

  const thumb = document.createElement("canvas");
  thumb.width = big ? 132 : 88;
  thumb.height = big ? 176 : 116;
  const tctx = thumb.getContext("2d");
  if (tctx) bg.paint(tctx, thumb.width, thumb.height);

  btn.append(thumb);
  btn.addEventListener("click", () => applyBackground(bg));
  return btn;
}

// ── 本機背景 ─────────────────────────────────────────────
const BG_KEY = "threadframe.bgs.v1";
const MAX_SAVED = 8;

function loadSavedBgs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BG_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function persistSavedBgs(list: string[]): boolean {
  try {
    localStorage.setItem(BG_KEY, JSON.stringify(list));
    return true;
  } catch {
    // localStorage 大約只有 5MB，存滿了就誠實告訴使用者，不要默默失敗。
    return false;
  }
}

/** 存檔前壓到 900px 寬的 JPEG，否則八張原圖就會把 localStorage 撐爆。 */
function toStorageDataUrl(img: HTMLImageElement): string {
  const max = 900;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const cx = c.getContext("2d");
  if (!cx) return img.src;
  cx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function useCustomBackground(url: string): void {
  const img = new Image();
  img.onload = () => {
    assets.bg = img;
    style.customBg = url;
    paintAllSwatches();
    draw();
  };
  img.src = url;
}

function paintSaved(): void {
  const list = loadSavedBgs();
  $("saved-wrap").hidden = list.length === 0;
  $("saved-hint").textContent = `本機背景 ${list.length}／${MAX_SAVED}`;
  savedList.replaceChildren();

  list.forEach((url, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "saved-swatch";
    btn.setAttribute("aria-pressed", String(style.customBg === url));
    btn.style.backgroundImage = `url(${url})`;
    btn.addEventListener("click", () => useCustomBackground(url));

    const remove = document.createElement("span");
    remove.className = "saved-x";
    remove.textContent = "×";
    remove.title = "刪除這張";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = loadSavedBgs();
      next.splice(index, 1);
      persistSavedBgs(next);
      paintSaved();
    });

    btn.append(remove);
    savedList.append(btn);
  });
}

function paintAllSwatches(): void {
  swatches.replaceChildren(...BACKGROUNDS.map((bg) => swatchButton(bg)));
  wallpapers.replaceChildren(...WALLPAPERS.map((bg) => swatchButton(bg, true)));
  $("library-count").textContent = `${WALLPAPERS.length} 張`;
  paintSaved();
}

$<HTMLInputElement>("f-bg").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  assets.bg = await fileToImage(file);
  style.customBg = assets.bg.src;
  paintAllSwatches();
  draw();
});

$("save-bg").addEventListener("click", () => {
  if (!assets.bg) {
    $("saved-hint").textContent = "先上載一張底圖才能存進本機。";
    $("saved-wrap").hidden = false;
    return;
  }
  const list = loadSavedBgs();
  if (list.length >= MAX_SAVED) {
    $("saved-hint").textContent = `已經存滿 ${MAX_SAVED} 張，先刪掉一張再存。`;
    return;
  }
  const url = toStorageDataUrl(assets.bg);
  list.push(url);
  if (!persistSavedBgs(list)) {
    $("saved-hint").textContent = "瀏覽器儲存空間不足，這張沒有存起來。";
    return;
  }
  style.customBg = url;
  paintSaved();
});

$("clear-bg").addEventListener("click", () => {
  assets.bg = null;
  style.customBg = null;
  $<HTMLInputElement>("f-bg").value = "";
  paintAllSwatches();
  commit();
});

$("random-bg").addEventListener("click", () => {
  const pool = [...BACKGROUNDS, ...WALLPAPERS].filter((b) => b.id !== style.bgId);
  applyBackground(pool[Math.floor(Math.random() * pool.length)]);
});

// ── 排版控制 ─────────────────────────────────────────────
const sliders: [string, string, keyof Style, (v: number) => number, (v: number) => string][] = [
  ["s-pad", "v-pad", "pad", (v) => v, (v) => `${v}px`],
  ["s-size", "v-size", "textSize", (v) => v, (v) => `${v}px`],
  ["s-radius", "v-radius", "radius", (v) => v, (v) => `${v}px`],
  ["s-alpha", "v-alpha", "panelAlpha", (v) => v / 100, (v) => `${v}%`],
  ["s-blur", "v-blur", "blur", (v) => v, (v) => `${v}px`],
];

for (const [id, labelId, key, toValue, format] of sliders) {
  const el = $<HTMLInputElement>(id);
  const label = $(labelId);
  const sync = () => {
    const raw = Number(el.value);
    (style[key] as number) = toValue(raw);
    label.textContent = format(raw);
  };
  el.addEventListener("input", () => {
    sync();
    draw();
  });
  el.addEventListener("change", commit);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 色票與 hex 欄位互相同步；hex 只在格式正確時才套用，打到一半不會亂跳。 */
function bindColor(pickerId: string, hexId: string, key: "panelColor" | "textColor"): void {
  const picker = $<HTMLInputElement>(pickerId);
  const hex = $<HTMLInputElement>(hexId);

  picker.addEventListener("input", () => {
    style[key] = picker.value;
    hex.value = picker.value.toUpperCase();
    draw();
  });
  picker.addEventListener("change", commit);

  hex.addEventListener("input", () => {
    const value = hex.value.trim();
    if (!HEX_RE.test(value)) return;
    style[key] = value;
    picker.value = value.length === 4
      ? `#${value.slice(1).split("").map((c) => c + c).join("")}`
      : value;
    draw();
  });
  hex.addEventListener("change", () => {
    hex.value = style[key].toUpperCase();
    commit();
  });
}

bindColor("s-panel", "s-panel-hex", "panelColor");
bindColor("s-ink", "s-ink-hex", "textColor");

const fontSelect = $<HTMLSelectElement>("s-font");
fontSelect.replaceChildren(
  ...FONTS.map((f) => {
    const option = document.createElement("option");
    option.value = f.id;
    option.textContent = f.name;
    option.style.fontFamily = f.stack;
    return option;
  }),
);
fontSelect.addEventListener("change", () => {
  style.fontId = fontSelect.value;
  commit();
});

const counters: [string, "imageLimit" | "commentLimit"][] = [
  ["s-image-limit", "imageLimit"],
  ["s-comment-limit", "commentLimit"],
];

for (const [id, key] of counters) {
  const el = $<HTMLSelectElement>(id);
  el.addEventListener("change", () => {
    style[key] = Number(el.value);
    commit();
  });
}

$("reset").addEventListener("click", () => {
  // 只重設排版，不動已經輸入的貼文內容 —— 那些重打一次成本太高。
  style = defaultStyle();
  assets.bg = null;
  $<HTMLInputElement>("f-bg").value = "";
  syncControls();
  paintAllSwatches();
  commit();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="ratio"]')) {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      style.ratio = radio.value as Ratio;
      commit();
    }
  });
}

const toggles: [string, keyof Style][] = [
  ["t-avatar", "showAvatar"],
  ["t-stats", "showStats"],
  ["t-time", "showTime"],
  ["t-images", "showImages"],
  ["t-url", "showUrl"],
  ["t-glass", "glass"],
  ["t-mask", "maskIdentity"],
];

for (const [id, key] of toggles) {
  const el = $<HTMLInputElement>(id);
  el.addEventListener("change", () => {
    (style[key] as boolean) = el.checked;
    commit();
  });
}

/** 把讀回來的偏好推回介面控制項。 */
function syncControls(): void {
  $<HTMLInputElement>("s-pad").value = String(style.pad);
  $("v-pad").textContent = `${style.pad}px`;
  $<HTMLInputElement>("s-size").value = String(style.textSize);
  $("v-size").textContent = `${style.textSize}px`;
  $<HTMLInputElement>("s-radius").value = String(style.radius);
  $("v-radius").textContent = `${style.radius}px`;
  $<HTMLInputElement>("s-alpha").value = String(Math.round(style.panelAlpha * 100));
  $("v-alpha").textContent = `${Math.round(style.panelAlpha * 100)}%`;
  $<HTMLInputElement>("s-blur").value = String(style.blur);
  $("v-blur").textContent = `${style.blur}px`;
  $<HTMLInputElement>("s-panel").value = style.panelColor;
  $<HTMLInputElement>("s-panel-hex").value = style.panelColor.toUpperCase();
  $<HTMLInputElement>("s-ink").value = style.textColor;
  $<HTMLInputElement>("s-ink-hex").value = style.textColor.toUpperCase();
  $<HTMLSelectElement>("s-font").value = style.fontId;
  $<HTMLSelectElement>("s-image-limit").value = String(style.imageLimit);
  $<HTMLSelectElement>("s-comment-limit").value = String(style.commentLimit);
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="ratio"]')) {
    radio.checked = radio.value === style.ratio;
  }
  for (const [id, key] of toggles) {
    $<HTMLInputElement>(id).checked = style[key] as boolean;
  }
}

// ── 匯出 ─────────────────────────────────────────────────
function fileName(): string {
  const who = post.handle.trim().replace(/[^A-Za-z0-9._-]/g, "") || "threads";
  return `threadframe-${who}.png`;
}

$("export").addEventListener("click", () => {
  renderCard(canvas, post, style, assets);
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);
    resultImg.src = lastObjectUrl;
    result.hidden = false;

    const shareBtn = $<HTMLButtonElement>("share");
    const file = new File([blob], fileName(), { type: "image/png" });
    shareBtn.hidden = !navigator.canShare?.({ files: [file] });
    shareBtn.onclick = () => {
      void navigator.share({ files: [file] }).catch(() => {
        /* 使用者取消分享不需要處理。 */
      });
    };

    $("download").onclick = () => {
      const a = document.createElement("a");
      a.href = lastObjectUrl as string;
      a.download = fileName();
      a.click();
    };

    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, "image/png");
});

// ── 分享目標（從 Threads 分享到這個 PWA） ────────────────
function readShareTarget(): void {
  const params = new URLSearchParams(location.search);
  const incoming = [params.get("title"), params.get("text"), params.get("url")]
    .filter((v): v is string => Boolean(v))
    .join("\n");
  if (!incoming) return;
  intake.value = incoming;
  applyIntake();
  history.replaceState(null, "", location.pathname);
}

paintAllSwatches();
paintPresets();
paintComments();
syncControls();
syncFields();
readShareTarget();
draw();
