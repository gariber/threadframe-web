const KEY = "threadframe.worker";

/**
 * 內建的取文服務位址。
 *
 * 寫死預設值是為了讓任何裝置、任何瀏覽器、主畫面 app 打開就能用 ——
 * iOS 的主畫面 app 與 Safari 分頁使用各自獨立的 localStorage，
 * 只靠本機設定的話，每換一個情境就要重設一次。
 *
 * 這支服務有來源網域限制與速率限制（見 worker/src/index.js），
 * 不會因為位址公開就變成任何人都能用的取文服務。
 */
const DEFAULT_WORKER = "https://threadframe-fetch.zhouwen9194.workers.dev";

/**
 * 三種狀態：
 *   沒有這個鍵   → 用內建預設
 *   存了空字串   → 使用者明確停用，回到全手動模式
 *   存了網址     → 使用者自己的服務，覆蓋預設
 */
export function getWorkerUrl(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === null) return DEFAULT_WORKER;
    return saved.trim();
  } catch {
    return DEFAULT_WORKER;
  }
}

/** 目前用的是不是內建預設（介面上要據此顯示不同說明）。 */
export function isUsingDefaultWorker(): boolean {
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return true;
  }
}

/** 存下自訂位址；傳空字串等於停用自動帶入。 */
export function setWorkerUrl(value: string): void {
  try {
    localStorage.setItem(KEY, value.trim().replace(/\/+$/, ""));
  } catch {
    // 無痕模式：這次工作階段仍可用，只是下次要重填。
  }
}

/** 移除覆蓋值，回到內建預設。 */
export function resetWorkerUrl(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上，無法寫入時不影響本次使用。
  }
}

/** 允許用 ?worker=... 帶入設定，方便在手機上不必手打長網址。 */
export function adoptWorkerFromQuery(): boolean {
  const fromQuery = new URLSearchParams(location.search).get("worker");
  if (fromQuery === null) return false;
  setWorkerUrl(fromQuery);
  return true;
}
