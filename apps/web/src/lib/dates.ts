/** 日期工具：统一成 YYYY-MM-DD，兼容旧的 YYYYMMDD */

/** 转成 2026-08-05；无法识别则原样返回（去空格） */
export function toIsoDate(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // 已是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // 带 / 或 .
  const m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return s;
}

/** 今天 YYYY-MM-DD（本地时区） */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 是否可作为 type=date 的 value */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
