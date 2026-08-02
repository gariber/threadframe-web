export type ParsedUrl = { handle: string; code: string; url: string };

const URL_RE =
  /https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)|t\/([A-Za-z0-9_-]+))/i;

/** 從一段文字裡找出第一個 Threads 貼文網址。找不到回傳 null。 */
export function parseThreadsUrl(input: string): ParsedUrl | null {
  const m = URL_RE.exec(input.trim());
  if (!m) return null;
  const [full, handle, code, shortCode] = m;
  return { handle: handle ?? "", code: code ?? shortCode ?? "", url: full };
}

export function isThreadsUrl(input: string): boolean {
  return URL_RE.test(input.trim());
}

/** 相對時間（2 小時 / 3天 / 5m / 2h / 昨天）或絕對日期。 */
const TIME_RE =
  /^(?:\d{1,2}\s*(?:秒|分鐘|分|小時|時|天|週|周|個月|年)(?:前)?|\d+\s*[smhdwy]|剛剛|昨天|前天|\d{4}[/年.-]\d{1,2}[/月.-]\d{1,2}日?)$/;

/** 純數字統計，允許 1,234 / 1.2萬 / 1.2K。 */
const COUNT_RE = /^[\d,.]+\s*(?:萬|億|[KkMm])?$/;

const NOISE_RE =
  /^(?:翻譯|查看翻譯|顯示翻譯|檢視翻譯|回覆|留言|轉發|轉推|轉貼|分享|讚|喜歡|更多|追蹤|已追蹤|檢視|瀏覽|Translate|See translation|Reply|Repost|Share|Like|More|Follow)$/i;

export type ParsedPaste = {
  name?: string;
  handle?: string;
  text?: string;
  time?: string;
  likes?: string;
  replies?: string;
  reposts?: string;
  url?: string;
};

/**
 * 盡力從「整段複製下來的貼文」猜出各欄位。
 *
 * Threads 沒有提供任何可從瀏覽器讀取的公開資料，所以內容一律來自使用者自己貼上。
 * 這裡只做保守的猜測，猜錯不會有壞處 —— 每個欄位在介面上都還能手動改。
 */
export function parsePastedPost(raw: string): ParsedPaste {
  const out: ParsedPaste = {};
  const found = parseThreadsUrl(raw);
  if (found) {
    out.url = found.url;
    if (found.handle) out.handle = found.handle;
  }

  // 保留空行 —— Threads 貼文常靠空行分段，濾掉的話排版會走樣。
  const lines = raw
    .replace(URL_RE, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !NOISE_RE.test(l));

  const dropEdgeBlanks = () => {
    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  };

  dropEdgeBlanks();
  if (lines.length === 0) return out;

  // 第一行通常是作者顯示名稱；若它本身就是 @handle，兩者一起帶入。
  const first = lines[0];
  if (/^@[A-Za-z0-9._]+$/.test(first)) {
    out.handle = first.slice(1);
    lines.shift();
  } else if (first.length <= 40 && !TIME_RE.test(first)) {
    out.name = first;
    lines.shift();
    while (lines.length > 0 && lines[0] === "") lines.shift();
    if (lines[0] && /^@[A-Za-z0-9._]+$/.test(lines[0])) {
      out.handle = lines[0].slice(1);
      lines.shift();
    }
  }

  // 時間可能緊接在名稱後，也可能落在最後。
  const timeIdx = lines.findIndex((l) => TIME_RE.test(l));
  if (timeIdx !== -1) {
    out.time = lines[timeIdx];
    lines.splice(timeIdx, 1);
  }

  // 結尾連續的數字視為互動統計，Threads 的順序是 讚 / 留言 / 轉發 / 分享。
  const counts: string[] = [];
  while (lines.length > 0 && counts.length < 4) {
    const last = lines[lines.length - 1];
    if (last === "") {
      lines.pop();
      continue;
    }
    if (!COUNT_RE.test(last)) break;
    counts.unshift(lines.pop() as string);
  }
  if (counts[0]) out.likes = counts[0];
  if (counts[1]) out.replies = counts[1];
  if (counts[2]) out.reposts = counts[2];

  dropEdgeBlanks();
  // 連續空行壓成一個，避免貼上時夾帶的多餘空白撐開卡片。
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (text) out.text = text;
  return out;
}
