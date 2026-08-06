import { getWorkerUrl } from "./config";

export type FetchedComment = {
  username: string;
  name: string;
  avatar: string | null;
  text: string;
  likes: number | null;
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
 * 統計數字縮寫成 1.9K / 321.7K / 1.2M，與分享圖上的慣例一致。
 * 只用在自動帶入的數字；使用者自己打的值不會被改寫。
 *
 * 零一律留白 —— Threads 自己就不顯示零，畫成「♥ 0」只是雜訊。
 * 使用者想標出零的話，自己在欄位裡打上去仍然會照畫。
 */
export function formatCount(value: number | null): string {
  if (value === null || Number.isNaN(value) || value === 0) return "";
  const trim = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));
  // 先算成 K，四捨五入後若已經滿一千才進位到 M，避免 999999 變成 "1000K"。
  const k = Math.round(value / 100) / 10;
  if (k >= 1000) return `${trim(Math.round(value / 100_000) / 10)}M`;
  if (value >= 1_000) return `${trim(k)}K`;
  return String(value);
}

/** 絕對時間，與分享圖常見的寫法一致。 */
export function formatTime(epochSeconds: number | null): string {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
