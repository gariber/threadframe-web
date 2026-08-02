const KEY = "threadframe.worker";

/**
 * 取文代理的網址。
 *
 * 留空時 app 仍可完全手動使用；填入自己部署的 Worker 之後，貼上連結就會
 * 自動帶入內容。設定存在本機，不會寫進程式碼，所以 fork 這個專案的人
 * 各自填自己的、互不影響。
 */
export function getWorkerUrl(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setWorkerUrl(value: string): void {
  try {
    const clean = value.trim().replace(/\/+$/, "");
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    // 無痕模式：這次工作階段仍可用，只是下次要重填。
  }
}

/** 允許用 ?worker=... 帶入設定，方便在手機上不必手打長網址。 */
export function adoptWorkerFromQuery(): boolean {
  const fromQuery = new URLSearchParams(location.search).get("worker");
  if (!fromQuery) return false;
  setWorkerUrl(fromQuery);
  return true;
}
