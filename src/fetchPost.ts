import { getWorkerUrl } from "./config";

export type FetchedComment = {
  username: string;
  name: string;
  avatar: string | null;
  text: string;
  likes: number | null;
  /** 這兩個是後加的，舊版 Worker 不會回傳。 */
  takenAt?: number | null;
  image?: string | null;
};

export type FetchedPost = {
  url: string;
  username: string;
  name: string;
  avatar: string | null;
  text: string;
  takenAt: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  shares: number | null;
  images: string[];
  /** 選用：舊版 Worker 不會回這個欄位，呼叫端要能接受它不存在。 */
  comments?: FetchedComment[];
};

export class FetchPostError extends Error {}

/** 把圖片轉成經過代理的網址；直連 cdninstagram 會讓 canvas 被污染而無法匯出。 */
export function proxyImage(rawUrl: string): string {
  const worker = getWorkerUrl();
  return `${worker}?img=${encodeURIComponent(rawUrl)}`;
}

export async function fetchThreadsPost(postUrl: string): Promise<FetchedPost> {
  const worker = getWorkerUrl();
  if (!worker) throw new FetchPostError("還沒設定取文服務");

  let response: Response;
  try {
    response = await fetch(`${worker}?url=${encodeURIComponent(postUrl)}`);
  } catch (e) {
    // 把實際用到的網址與底層錯誤一併顯示 —— 少了這些，使用者回報時
    // 分不出是網址填錯、服務掛掉，還是被裝置上的阻擋器擋下。
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new FetchPostError(`連不上取文服務。呼叫的是 ${worker} ，瀏覽器回報 ${detail}。`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FetchPostError("取文服務回傳的內容看不懂，可能網址填錯了。");
  }

  if (!response.ok) {
    const message = (body as { message?: string })?.message;
    throw new FetchPostError(message ?? `取文失敗（HTTP ${response.status}）`);
  }
  return body as FetchedPost;
}

/**
 * 統計數字寫成完整數字並加千分位：7259 → 7,259。
 *
 * 不縮寫成 7.3K —— Threads 自己顯示的就是完整數字，縮寫等於把資訊丟掉，
 * 而卡片是要拿去分享的，數字本身常常就是重點。
 *
 * 千分位固定用逗號（寫死 en-US）：交給裝置的地區設定會讓同一則貼文在不同
 * 手機上長得不一樣，有些地區用點號，看起來會像小數。
 *
 * 零一律留白 —— Threads 自己就不顯示零，畫成「♥ 0」只是雜訊。
 * 使用者想標出零的話，自己在欄位裡打上去仍然會照畫。
 */
export function formatCount(value: number | null): string {
  if (value === null || Number.isNaN(value) || value === 0) return "";
  return value.toLocaleString("en-US");
}

/**
 * 相對時間（「13 小時」「2 天」），Threads 在留言上就是這樣標。
 *
 * 主貼文用的是絕對時間 —— 卡片是一張會被存下來、之後才看到的圖，
 * 主體的時間點要能對得回去；留言只是陪襯，相對時間比較貼近原本的觀感。
 */
export function formatRelativeTime(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "";
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);

  if (seconds < 60) return "剛剛";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} 週`;

  const d = new Date(epochSeconds * 1000);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 絕對時間，與分享圖常見的寫法一致。 */
export function formatTime(epochSeconds: number | null): string {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
