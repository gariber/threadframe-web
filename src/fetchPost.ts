import { getWorkerUrl } from "./config";

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
  } catch {
    throw new FetchPostError("連不上取文服務，請確認網址是否正確、服務是否還在。");
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

/** 統計數字照 Threads 的習慣縮寫：1.2萬 / 3.4K 之類交給呼叫端決定，這裡只加千分位。 */
export function formatCount(value: number | null): string {
  return value === null || Number.isNaN(value) ? "" : value.toLocaleString("en-US");
}

/** 絕對時間，與分享圖常見的寫法一致。 */
export function formatTime(epochSeconds: number | null): string {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
