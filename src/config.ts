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

/**
 * app 自己的網域。底下沒有任何一個子網域是取文服務 —— app 搬過家
 * （threadsframe.gariber.studio），只比對當下這一個位址的話，貼上舊網址
 * 就會被存成取文位址。與 Worker 的來源白名單同一套範圍。
 */
const SITE_DOMAIN_RE = /(^|\.)gariber\.studio$/i;

/**
 * 檢查一個值能不能當取文位址，不行就回傳原因。
 *
 * 特別要擋掉 Threads 連結：使用者很容易把貼文網址貼進設定欄，
 * 存進去之後每次請求都會打向 threads.com 而失敗，錯誤訊息卻指向
 * 「連不上取文服務」，根本看不出是設定被覆蓋了。
 */
export function validateWorkerUrl(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null; // 空字串是合法的：代表停用

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return "這不是一個完整網址，要包含 https://";
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return "取文位址必須是 https://";
  }
  if (/(^|\.)threads\.(com|net)$/i.test(parsed.hostname)) {
    return "這是一條 Threads 連結，不是取文服務的位址 —— 貼文連結要貼在上面的輸入框。";
  }
  // host 而不是 hostname —— hostname 不含 port，本機開發時 app 在 localhost:5173、
  // Worker 在 localhost:8787，比 hostname 會把那支本機 Worker 誤判成本站網址。
  if (parsed.host === location.host) {
    return "這是本站網址，不是取文服務的位址。";
  }
  if (SITE_DOMAIN_RE.test(parsed.hostname)) {
    return "這是 app 自己的網域，不是取文服務的位址。";
  }
  return null;
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
  if (validateWorkerUrl(fromQuery)) return false;
  setWorkerUrl(fromQuery);
  return true;
}

/**
 * 開啟時清掉存壞的設定。
 *
 * 舊版會在取文失敗後把焦點移到設定欄位，使用者下一次貼連結就貼進了設定欄，
 * 把取文位址覆蓋成一條 Threads 連結。那個行為已經移除，但已經壞掉的裝置
 * 需要能自己恢復，否則使用者只會一直看到「連不上取文服務」。
 */
export function repairWorkerUrl(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === null || saved.trim() === "") return false;
    if (!validateWorkerUrl(saved)) return false;
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
