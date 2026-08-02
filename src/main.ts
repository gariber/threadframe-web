import "./styles.css";
import { BACKGROUNDS } from "./backgrounds";
import { parsePastedPost } from "./parse";
import { renderCard, type Assets } from "./render";
import { emptyPost, loadStyle, saveStyle, type Post, type Ratio, type Style } from "./state";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const post: Post = emptyPost();
let style: Style = loadStyle();
const assets: Assets = { avatar: null, images: [], bg: null };

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
  if (parsed.url !== undefined) post.url = parsed.url;

  syncFields();
  // 內容已經進到下面的欄位，留著原始貼上區只會讓人以為還沒帶入。
  intake.value = "";
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

// ── 背景 ─────────────────────────────────────────────────
const swatches = $("swatches");

/** 套用一張內建底圖：底板色與文字色必須一起換，否則深底會做出白底白字。 */
function applyBackground(bg: (typeof BACKGROUNDS)[number]): void {
  style.bgId = bg.id;
  style.customBg = null;
  assets.bg = null;
  style.textColor = bg.ink;
  style.panelColor = bg.panel;
  $<HTMLInputElement>("s-ink").value = bg.ink;
  $<HTMLInputElement>("s-panel").value = bg.panel;
  $<HTMLInputElement>("f-bg").value = "";
  paintSwatches();
  commit();
}

function paintSwatches(): void {
  swatches.replaceChildren();
  for (const bg of BACKGROUNDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = bg.name;
    btn.setAttribute("aria-label", bg.name);
    btn.setAttribute("aria-pressed", String(!style.customBg && style.bgId === bg.id));
    btn.style.background = `linear-gradient(${bg.angle}deg, ${bg.stops
      .map(([at, color]) => `${color} ${Math.round(at * 100)}%`)
      .join(", ")})`;
    btn.addEventListener("click", () => applyBackground(bg));
    swatches.append(btn);
  }
}

$<HTMLInputElement>("f-bg").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  assets.bg = await fileToImage(file);
  style.customBg = assets.bg.src;
  paintSwatches();
  draw();
});

$("clear-bg").addEventListener("click", () => {
  assets.bg = null;
  style.customBg = null;
  $<HTMLInputElement>("f-bg").value = "";
  paintSwatches();
  commit();
});

$("random-bg").addEventListener("click", () => {
  const pool = BACKGROUNDS.filter((b) => b.id !== style.bgId);
  applyBackground(pool[Math.floor(Math.random() * pool.length)]);
});

// ── 排版控制 ─────────────────────────────────────────────
const sliders: [string, string, keyof Style, (v: number) => number, (v: number) => string][] = [
  ["s-pad", "v-pad", "pad", (v) => v, (v) => `${v}px`],
  ["s-size", "v-size", "textSize", (v) => v, (v) => `${v}px`],
  ["s-radius", "v-radius", "radius", (v) => v, (v) => `${v}px`],
  ["s-alpha", "v-alpha", "panelAlpha", (v) => v / 100, (v) => `${v}%`],
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

$<HTMLInputElement>("s-panel").addEventListener("input", (e) => {
  style.panelColor = (e.target as HTMLInputElement).value;
  draw();
});
$<HTMLInputElement>("s-ink").addEventListener("input", (e) => {
  style.textColor = (e.target as HTMLInputElement).value;
  draw();
});
$("s-panel").addEventListener("change", commit);
$("s-ink").addEventListener("change", commit);

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
  $<HTMLInputElement>("s-panel").value = style.panelColor;
  $<HTMLInputElement>("s-ink").value = style.textColor;
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

paintSwatches();
syncControls();
syncFields();
readShareTarget();
draw();
