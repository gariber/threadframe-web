import "./styles.css";
import { BACKGROUNDS, findBackground, WALLPAPERS, type Background } from "./backgrounds";
import { FONTS } from "./fonts";
import { PRESETS, type Preset } from "./presets";
import {
  adoptWorkerFromQuery,
  getWorkerUrl,
  isUsingDefaultWorker,
  repairWorkerUrl,
  resetWorkerUrl,
  setWorkerUrl,
  validateWorkerUrl,
} from "./config";
import {
  fetchThreadsPost,
  formatCount,
  formatRelativeTime,
  formatTime,
  proxyImage,
  type FetchedPost,
} from "./fetchPost";
import { parsePastedPost, parseThreadsUrl } from "./parse";
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
  type TimeFormat,
} from "./state";

declare const __BUILD_ID__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const post: Post = emptyPost();
let style: Style = loadStyle();
const assets: Assets = {
  avatar: null,
  images: [],
  bg: null,
  commentAvatars: [],
  commentImages: [],
};

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

/** 從網址載入圖片。crossOrigin 必須設，否則 canvas 會被污染而無法匯出。 */
function urlToImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = url;
  });
}

function setStatus(kind: "hint" | "err" | "none", text = ""): void {
  const status = $("intake-status");
  status.hidden = kind === "none";
  status.className = kind === "err" ? "err" : "hint";
  status.textContent = text;
}

/**
 * 每次自動帶入都會 +1。圖片是慢慢補上的，使用者在載入途中換帶入另一則貼文時，
 * 上一輪的 then 會晚一步回來把新貼文的圖蓋掉 —— 代數對不上就直接丟棄。
 */
let fetchGeneration = 0;

/** 依目前的時間格式，把 post.takenAt 換算成要畫出來的那串字。 */
function formatPostTime(): string {
  if (post.takenAt === null) return post.time;
  return style.timeFormat === "relative"
    ? formatRelativeTime(post.takenAt)
    : formatTime(post.takenAt);
}

async function fillFromFetched(data: FetchedPost): Promise<void> {
  const generation = ++fetchGeneration;

  post.name = data.name || data.username;
  post.handle = data.username;
  post.text = data.text;
  post.takenAt = data.takenAt;
  post.time = formatPostTime();
  post.likes = formatCount(data.likes);
  post.replies = formatCount(data.replies);
  post.reposts = formatCount(data.reposts);
  post.shares = formatCount(data.shares);
  post.url = data.url;

  // 只留有內文的留言：Worker 會把貼圖或純圖片的回覆也算進來，
  // 那些在卡片上只會是一個空白列。展示幾則是使用者的選擇（style.commentLimit），
  // 這裡只負責把素材備齊。
  //
  // Worker 已經依讚數排好序了，這裡不再重排 —— 它看得到整串，我們只收到前幾則。
  const fetched = (data.comments ?? []).filter((c) => c.text.trim()).slice(0, MAX_COMMENTS);
  post.comments = fetched.map((c) => ({
    name: c.name || c.username,
    handle: c.username,
    text: c.text,
    time: formatRelativeTime(c.takenAt),
    likes: formatCount(c.likes),
    avatar: null,
  }));
  // 圖片稍後才會載進來，先把長度對齊，否則索引會錯位到別人的留言上。
  assets.commentAvatars = post.comments.map(() => null);
  assets.commentImages = post.comments.map(() => null);

  syncFields();
  paintComments();
  draw();

  // 圖片比文字慢，先讓卡片出現再逐步補上，不要整段卡著等。
  // 頭像與貼文圖片同時開始下載 —— 先前是等頭像載完才動貼文圖片，白白多等一趟。
  const avatarJob = data.avatar
    ? urlToImage(proxyImage(data.avatar))
        .then((img) => {
          if (generation !== fetchGeneration) return;
          assets.avatar = img;
          draw();
        })
        .catch(() => {
          // 頭像載不到不影響其他內容，留空即可。
        })
    : Promise.resolve();

  const imagesJob =
    data.images.length > 0
      ? Promise.allSettled(data.images.map((u) => urlToImage(proxyImage(u)))).then((loaded) => {
          if (generation !== fetchGeneration) return;
          assets.images = loaded
            .filter((r): r is PromiseFulfilledResult<HTMLImageElement> => r.status === "fulfilled")
            .map((r) => r.value);
          updateImageCount();
          draw();
        })
      : Promise.resolve();

  const commentJobs = fetched.flatMap((c, index) => [
    c.avatar
      ? urlToImage(proxyImage(c.avatar))
          .then((img) => {
            if (generation !== fetchGeneration) return;
            assets.commentAvatars[index] = img;
            draw();
          })
          .catch(() => {
            // 同上：載不到就用名稱首字的圓形底。
          })
      : Promise.resolve(),
    c.image
      ? urlToImage(proxyImage(c.image))
          .then((img) => {
            if (generation !== fetchGeneration) return;
            assets.commentImages[index] = img;
            draw();
          })
          .catch(() => {
            // 留言的附圖載不到就只顯示文字。
          })
      : Promise.resolve(),
  ]);

  await Promise.all([avatarJob, imagesJob, ...commentJobs]);
}

async function autoFill(url: string): Promise<void> {
  const applyBtn = $<HTMLButtonElement>("apply");
  applyBtn.disabled = true;
  setStatus("hint", "讀取貼文中…");
  try {
    await fillFromFetched(await fetchThreadsPost(url));
    setStatus("none");
    intake.value = "";
  } catch (e) {
    setStatus(
      "err",
      `${(e as Error).message} 你仍然可以直接貼上貼文文字，或在下面的欄位手動填。`,
    );
  } finally {
    applyBtn.disabled = false;
  }
}

function applyIntake(): void {
  const raw = intake.value.trim();
  if (!raw) return;

  const link = parseThreadsUrl(raw);
  const preview = parsePastedPost(raw);
  const pastedContent = Boolean(preview.text?.trim() || preview.name?.trim());

  // 只有連結、而且設定好取文服務 —— 走自動帶入。
  if (link && !pastedContent && getWorkerUrl()) {
    void autoFill(link.url);
    return;
  }

  const parsed = preview;

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
  if (pastedContent) {
    setStatus("none");
    // 內容已經進到下面的欄位，留著原始貼上區只會讓人以為還沒帶入。
    intake.value = "";
  } else if (parsed.url) {
    setStatus(
      "err",
      "只收到網址，但這台裝置還沒設定取文服務。下面已經幫你展開「自動帶入」，" +
        "把 Worker 網址填進去就會自動帶入；或直接複製貼文文字貼上來。",
    );
    // 光是展開還不夠 —— 那個區塊在畫面下方，不捲過去等於沒提示。
    // 但不要自動聚焦設定欄位：游標留在那裡的話，使用者下一次貼連結
    // 會貼進設定欄而不是輸入框，把取文位址覆蓋成一條 Threads 連結。
    const sheet = $("fetch-sheet");
    sheet.setAttribute("open", "");
    sheet.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    setStatus("err", "看不出貼文內容，請直接在下面「貼文內容」的欄位填寫。");
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
    // 自己動手改過時間之後，切換時間格式就不該再把它換算掉 ——
    // 忘了斷開的話，使用者打的字會在切格式時無聲消失。
    if (key === "time") post.takenAt = null;
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

// ── 取文服務設定 ─────────────────────────────────────────
const workerInput = $<HTMLInputElement>("worker-url");
const workerStatus = $("worker-status");

function showWorkerState(): void {
  const url = getWorkerUrl();
  workerStatus.className = "hint";
  if (!url) {
    workerStatus.textContent = "已停用自動帶入，目前是手動模式。";
  } else if (isUsingDefaultWorker()) {
    workerStatus.textContent = `使用內建預設：${url}`;
  } else {
    workerStatus.textContent = `使用自訂位址：${url}`;
  }
}

/** 存下輸入框的值；不合法就退回原設定並說明原因。回傳是否成功。 */
function commitWorkerInput(): boolean {
  const problem = validateWorkerUrl(workerInput.value);
  if (problem) {
    workerStatus.className = "err";
    workerStatus.textContent = problem;
    workerInput.value = getWorkerUrl();
    return false;
  }
  setWorkerUrl(workerInput.value);
  workerInput.value = getWorkerUrl();
  return true;
}

workerInput.addEventListener("change", () => {
  if (commitWorkerInput()) showWorkerState();
});

$("worker-test").addEventListener("click", async () => {
  if (!commitWorkerInput()) return;
  const url = getWorkerUrl();
  if (!url) {
    showWorkerState();
    return;
  }
  workerStatus.className = "hint";
  workerStatus.textContent = "測試中…";
  try {
    const res = await fetch(url);
    const body = (await res.json()) as { ok?: boolean };
    workerStatus.className = body?.ok ? "hint" : "err";
    workerStatus.textContent = body?.ok
      ? "連線正常，現在貼上連結就會自動帶入。"
      : "有回應，但格式不對 —— 這個網址可能不是 ThreadFrame 的取文服務。";
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    workerStatus.className = "err";
    workerStatus.textContent = `連不上 ${url} —— 瀏覽器回報 ${detail}。請確認 Worker 已部署、網址正確且含 https://`;
  }
});

$("worker-reset").addEventListener("click", () => {
  resetWorkerUrl();
  workerInput.value = getWorkerUrl();
  showWorkerState();
});

$("worker-clear").addEventListener("click", () => {
  setWorkerUrl("");
  workerInput.value = "";
  showWorkerState();
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
      assets.commentImages.splice(index, 1);
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

    const handle = document.createElement("input");
    handle.type = "text";
    handle.autocomplete = "off";
    bind(handle, "handle");

    const text = document.createElement("textarea");
    text.rows = 2;
    bind(text, "text");

    const time = document.createElement("input");
    time.type = "text";
    time.autocomplete = "off";
    bind(time, "time");

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

    const image = document.createElement("input");
    image.type = "file";
    image.accept = "image/*";
    image.addEventListener("change", async () => {
      const file = image.files?.[0];
      if (!file) return;
      assets.commentImages[index] = await fileToImage(file);
      draw();
    });

    const who = document.createElement("div");
    who.className = "triple";
    who.append(labelled("名稱", name), labelled("帳號", handle));

    const bottom = document.createElement("div");
    bottom.className = "triple";
    bottom.append(labelled("時間", time), labelled("讚", likes));

    const media = document.createElement("div");
    media.className = "triple";
    media.append(labelled("頭像", avatar), labelled("附圖", image));

    row.append(head, who, labelled("內文", text, true), bottom, media);
    commentList.append(row);
  });

  addComment.disabled = post.comments.length >= MAX_COMMENTS;
  $("comment-hint").textContent =
    post.comments.length >= MAX_COMMENTS
      ? `最多 ${MAX_COMMENTS} 則。自動帶入會先填上貼文底下的留言，你可以直接改寫或刪掉。`
      : `最多 ${MAX_COMMENTS} 則，依照你排列的順序顯示。`;
}

addComment.addEventListener("click", () => {
  if (post.comments.length >= MAX_COMMENTS) return;
  post.comments.push(emptyComment());
  assets.commentAvatars.push(null);
  assets.commentImages.push(null);
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

$<HTMLSelectElement>("s-time-format").addEventListener("change", (e) => {
  style.timeFormat = (e.target as HTMLSelectElement).value as TimeFormat;
  // 自動帶入過的貼文重新換算；手動打的時間不動 —— 那是使用者自己寫的字。
  if (post.takenAt !== null) {
    post.time = formatPostTime();
    syncFields();
  }
  commit();
});

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
  $<HTMLSelectElement>("s-time-format").value = style.timeFormat;
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

$("build").textContent = `建置 ${__BUILD_ID__}`;

/**
 * 手機瀏覽器會把 index.html 留在快取裡，導致明明已經部署新版、畫面卻還是舊的。
 * 這裡主動比對伺服器上的 version.json，不一致就讓使用者一鍵換到新版。
 */
async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (!build || build === __BUILD_ID__) return;

    const bar = $("update-bar");
    bar.hidden = false;
    $("update-now").addEventListener("click", () => {
      // 換一個網址才拿得到新的 index.html —— 單純 reload 仍會吃到快取。
      location.replace(`${location.pathname}?u=${Date.now()}`);
    });
  } catch {
    // 離線或擋掉請求都不影響使用，靜靜略過。
  }
}

void checkForUpdate();

const repaired = repairWorkerUrl();
if (adoptWorkerFromQuery()) history.replaceState(null, "", location.pathname);
workerInput.value = getWorkerUrl();
showWorkerState();
if (repaired) {
  workerStatus.className = "hint";
  workerStatus.textContent = `先前存了一個無效的取文位址，已改回內建預設：${getWorkerUrl()}`;
}

paintAllSwatches();
paintPresets();
paintComments();
syncControls();
syncFields();
readShareTarget();
draw();
