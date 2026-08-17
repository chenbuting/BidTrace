import { api, ApiError } from "./client";

export type UserInfo = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
  permissions: string[];
};

export type Platform = {
  id: number;
  name: string;
  url: string;
  login_method: string;
  login_account: string;
  login_password: string;
  has_ca: string;
  ca_password: string;
  priority: string;
  status: string;
  weight: number;
  remark: string;
};

export type Inquiry = {
  id: number;
  register_date: string;
  platform_name: string;
  project_name: string;
  is_bid: string;
  is_registered: string;
  file_received: string;
  is_paid: string;
  overview_done: string;
  skip_reason_category: string;
  skip_reason_detail: string;
  deadline: string;
  created_by?: number;
};

export type Dashboard = {
  platform_total: number;
  platform_active: number;
  platform_maintain: number;
  inquiry_total: number;
  inquiry_bid_yes: number;
  recent_by_date: { date: string; count: number }[];
};

export type AppUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
  is_active: number;
  overrides: Record<string, boolean>;
  permissions: string[];
};

export type AppRole = {
  code: string;
  label: string;
  is_system: boolean;
  perm_count?: number;
  user_count?: number;
  permissions?: string[];
  created_at?: string;
  updated_at?: string;
};

export async function login(username: string, password: string) {
  return api<{ ok: boolean; user: UserInfo }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return api<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function fetchMe() {
  return api<{ user: UserInfo }>("/api/auth/me");
}

export async function fetchDashboard() {
  return api<Dashboard>("/api/dashboard");
}

export type ChartNamedValue = { name: string; count: number };

export type DashboardCharts = {
  days: number;
  totals: {
    inquiry_total: number;
    inquiry_bid_yes: number;
    inquiry_bid_pending: number;
    project_total: number;
    project_won: number;
    deposit_total: number;
    deposit_pending: number;
    platform_total: number;
  };
  inquiry_trend: {
    date: string;
    total: number;
    bid_yes: number;
    bid_no: number;
    bid_pending: number;
  }[];
  inquiry_bid: ChartNamedValue[];
  project_result: ChartNamedValue[];
  deposit_return: ChartNamedValue[];
  platform_status: ChartNamedValue[];
  by_inquiry_platform: ChartNamedValue[];
  by_skip_reason: ChartNamedValue[];
  by_project_bidder: ChartNamedValue[];
  by_project_platform: ChartNamedValue[];
  by_deposit_payee: ChartNamedValue[];
};

/** 数据看板图表数据 */
export async function fetchDashboardCharts(days = 14) {
  return api<DashboardCharts>(`/api/dashboard/charts?days=${days}`);
}

export async function fetchPlatforms(params: Record<string, string | number>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  return api<{ total: number; items: Platform[] }>(`/api/platforms?${qs}`);
}

export async function deletePlatforms(ids: number[]) {
  return api<{ ok: boolean; deleted: number }>("/api/platforms/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function savePlatform(data: Partial<Platform> & { name: string }, id?: number) {
  if (id) {
    return api<{ item: Platform }>(`/api/platforms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
  return api<{ item: Platform }>("/api/platforms", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deletePlatform(id: number) {
  return api<{ ok: boolean }>(`/api/platforms/${id}`, { method: "DELETE" });
}

export async function importPlatforms(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ ok: boolean; imported: number }>("/api/platforms/import", {
    method: "POST",
    body: fd,
  });
}

export type PlatformBackupInfo = {
  id: number;
  reason: string;
  row_count: number;
  created_by?: number;
  created_at: string;
};

export type ImportConflictDiff = {
  field: string;
  label: string;
  old: string;
  new: string;
};

export type ImportConflict = {
  row_index: number;
  existing_id: number;
  name: string;
  url: string;
  identical: boolean;
  diffs: ImportConflictDiff[];
};

export async function previewPlatformImport(file: File, mode: "incremental" | "full") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  return api<{
    mode: string;
    total: number;
    new_count: number;
    conflict_count: number;
    conflicts: ImportConflict[];
    mode_label: string;
    mode_desc: string;
    latest_backup: PlatformBackupInfo | null;
  }>("/api/platforms/import/preview", { method: "POST", body: fd });
}

export async function commitPlatformImport(
  file: File,
  mode: "incremental" | "full",
  decisions: { row_index: number; existing_id: number; action: "keep" | "overwrite" }[],
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("decisions_json", JSON.stringify(decisions));
  return api<{
    ok: boolean;
    mode: string;
    inserted: number;
    updated: number;
    kept: number;
    backup?: { id: number; row_count: number };
  }>("/api/platforms/import/commit", { method: "POST", body: fd });
}

export async function fetchLatestPlatformBackup() {
  return api<{ backup: PlatformBackupInfo | null }>("/api/platforms/backup/latest");
}

export async function restorePlatformBackup() {
  return api<{ ok: boolean; restored: number; backup_id?: number; backup_at?: string }>(
    "/api/platforms/backup/restore",
    { method: "POST" },
  );
}

export async function exportPlatforms(params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/platforms/export${suffix}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("导出失败");
  return res.blob();
}

export async function downloadPlatformTemplate() {
  const res = await fetch("/api/platforms/template", { credentials: "same-origin" });
  if (!res.ok) throw new Error("下载模板失败");
  return res.blob();
}

export async function fetchPlatformOptions() {
  return api<{ items: string[] }>("/api/platforms/options");
}

export async function fetchInquiries(params: Record<string, string | number>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  return api<{ total: number; items: Inquiry[] }>(`/api/inquiries?${qs}`);
}

export async function saveInquiry(data: Partial<Inquiry>, id?: number) {
  if (id) {
    return api<{ item: Inquiry }>(`/api/inquiries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
  return api<{ item: Inquiry }>("/api/inquiries", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteInquiry(id: number) {
  return api<{ ok: boolean }>(`/api/inquiries/${id}`, { method: "DELETE" });
}

export async function deleteInquiries(ids: number[]) {
  return api<{ ok: boolean; deleted: number }>("/api/inquiries/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function importInquiries(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ ok: boolean; imported: number }>("/api/inquiries/import", {
    method: "POST",
    body: fd,
  });
}

export async function previewInquiryImport(file: File, mode: "incremental" | "full") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  return api<StatsImportPreview>("/api/inquiries/import/preview", { method: "POST", body: fd });
}

export async function commitInquiryImport(
  file: File,
  mode: "incremental" | "full",
  decisions: { row_index: number; existing_id: number; action: "keep" | "overwrite" }[],
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("decisions_json", JSON.stringify(decisions));
  return api<StatsImportCommitResult>("/api/inquiries/import/commit", { method: "POST", body: fd });
}

export async function fetchLatestInquiryBackup() {
  return api<{ backup: StatsBackupInfo | null }>("/api/inquiries/backup/latest");
}

export async function restoreInquiryBackup() {
  return api<{ ok: boolean; restored: number; backup_id?: number; backup_at?: string }>(
    "/api/inquiries/backup/restore",
    { method: "POST" },
  );
}

export async function exportInquiries(params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/inquiries/export${suffix}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("导出失败");
  return res.blob();
}

export type InquiryDailyReportItem = {
  platform_name: string;
  project_name: string;
  is_bid: string;
  is_registered: string;
  deadline: string;
  skip_reason_category?: string;
  skip_reason_detail?: string;
  reason_text?: string;
  register_date?: string;
  /** 历史积压：报名日早于所选日报日，但仍是待确定 */
  is_carryover?: boolean;
};

/** 询标单日报表（导出领导汇报图用） */
export type InquiryDailyReport = {
  date: string;
  total: number;
  bid_yes: number;
  bid_no: number;
  bid_wait: number;
  bid_empty: number;
  registered: number;
  file_ok: number;
  paid_ok: number;
  overview_ok: number;
  platforms: { name: string; count: number }[];
  follow_total: number;
  follow_today_total?: number;
  follow_carryover_total?: number;
  follow_items: InquiryDailyReportItem[];
  bid_yes_items: InquiryDailyReportItem[];
  bid_yes_total: number;
  bid_no_items: InquiryDailyReportItem[];
  bid_no_total: number;
};

export async function fetchInquiryDailyReport(date: string) {
  return api<{ item: InquiryDailyReport }>(`/api/inquiries/daily-report?date=${encodeURIComponent(date)}`);
}

export async function downloadInquiryTemplate() {
  const res = await fetch("/api/inquiries/template", { credentials: "same-origin" });
  if (!res.ok) throw new Error("下载模板失败");
  return res.blob();
}

export async function fetchUsers() {
  return api<{ items: AppUser[] }>("/api/users");
}

export async function createUser(body: {
  username: string;
  password: string;
  display_name: string;
  role: string;
}) {
  return api<{ item: AppUser }>("/api/users", { method: "POST", body: JSON.stringify(body) });
}

export async function updateUser(
  id: number,
  body: {
    username?: string;
    display_name?: string;
    role?: string;
    is_active?: boolean;
    password?: string;
    clear_overrides?: boolean;
  },
) {
  return api<{ item: AppUser }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function deleteUser(id: number) {
  return api<{ ok: boolean; message?: string }>(`/api/users/${id}`, { method: "DELETE" });
}

export async function setUserPerms(id: number, overrides: Record<string, boolean>) {
  return api<{ overrides: Record<string, boolean>; permissions: string[] }>(
    `/api/users/${id}/permissions`,
    { method: "PUT", body: JSON.stringify({ overrides }) },
  );
}

export async function fetchMeta() {
  return api<{
    permissions: { code: string; label: string }[];
    roles: { code: string; label: string; is_system?: boolean }[];
  }>("/api/meta/permissions");
}

export async function fetchRoles() {
  return api<{ items: AppRole[] }>("/api/roles");
}

export async function createRole(body: { code: string; label: string; permissions: string[] }) {
  return api<{ item: AppRole }>("/api/roles", { method: "POST", body: JSON.stringify(body) });
}

export async function updateRole(
  code: string,
  body: { label?: string; permissions?: string[] },
) {
  return api<{ item: AppRole }>(`/api/roles/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteRole(code: string) {
  return api<{ ok: boolean; message?: string }>(`/api/roles/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

export type AuditLog = {
  id: number;
  user_id?: number | null;
  username: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
};

export async function fetchAudit(params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{ total: number; items: AuditLog[]; actions: string[] }>(`/api/audit${suffix}`);
}

export type NotifyItem = {
  id: number;
  sender_id?: number | null;
  sender_username: string;
  title: string;
  content: string;
  created_at: string;
  read_at?: string | null;
  is_unread?: number | boolean;
};

export type NotifyPickerUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
};

export async function fetchNotifications(params: Record<string, string | number | boolean> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{ total: number; items: NotifyItem[] }>(`/api/notifications${suffix}`);
}

export async function fetchNotifyUnreadCount() {
  return api<{ count: number }>("/api/notifications/unread-count");
}

export async function fetchNotifyUsers() {
  return api<{ items: NotifyPickerUser[] }>("/api/notifications/users");
}

export async function sendNotification(body: { title: string; content: string; user_ids: number[] }) {
  return api<{ item: { id: number; title: string; recipient_count: number } }>("/api/notifications", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function markNotificationRead(id: number) {
  return api<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead() {
  return api<{ ok: boolean; updated: number }>("/api/notifications/read-all", { method: "POST" });
}

export type BidProject = {
  id: number;
  serial_no: string;
  open_time: string;
  bidder: string;
  project_name: string;
  platform: string;
  remark: string;
  is_won: string;
  win_amount: string;
  is_void: string;
  bid_amount: string;
  payment_method: string;
};

export type CalendarProjectItem = {
  id: number;
  open_time: string;
  open_time_raw?: string;
  bidder: string;
  project_name: string;
  platform: string;
  is_won: string;
  is_void: string;
  remark: string;
};

export type BidProjectCalendar = {
  year: number;
  month: number;
  bidder: string;
  month_total: number;
  unscheduled_count: number;
  bidders: string[];
  days: { date: string; count: number; bidders: string[] }[];
  by_date: Record<string, CalendarProjectItem[]>;
  suggest?: { year: number; month: number } | null;
};

/** 开标日历（按月 + 投标员） */
export async function fetchBidProjectCalendar(year: number, month: number, bidder = "") {
  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  if (bidder) qs.set("bidder", bidder);
  return api<BidProjectCalendar>(`/api/bid-projects/calendar?${qs}`);
}

export type BidDeposit = {
  id: number;
  serial_no: string;
  apply_time: string;
  project_name: string;
  payee: string;
  platform: string;
  amount: string;
  bidder: string;
  is_returned: string;
  return_contact: string;
  remark: string;
};

export type StatsBackupInfo = PlatformBackupInfo;

export type StatsImportConflict = {
  row_index: number;
  existing_id: number;
  identical: boolean;
  diffs: ImportConflictDiff[];
  project_name?: string;
  open_time?: string;
  platform?: string;
  platform_name?: string;
  register_date?: string;
  apply_time?: string;
  payee?: string;
  name?: string;
  url?: string;
};

export type StatsImportPreview = {
  mode: string;
  total: number;
  new_count: number;
  conflict_count: number;
  conflicts: StatsImportConflict[];
  mode_label: string;
  mode_desc: string;
  latest_backup: StatsBackupInfo | null;
};

export type StatsImportCommitResult = {
  ok: boolean;
  mode: string;
  inserted: number;
  updated: number;
  kept: number;
  backup?: { id: number; row_count: number };
};

export async function fetchBidProjects(params: Record<string, string | number>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  return api<{ total: number; items: BidProject[] }>(`/api/bid-projects?${qs}`);
}

export async function saveBidProject(data: Partial<BidProject> & { project_name?: string }, id?: number) {
  if (id) {
    return api<{ item: BidProject }>(`/api/bid-projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
  return api<{ item: BidProject }>("/api/bid-projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteBidProject(id: number) {
  return api<{ ok: boolean }>(`/api/bid-projects/${id}`, { method: "DELETE" });
}

export async function deleteBidProjects(ids: number[]) {
  return api<{ ok: boolean; deleted: number }>("/api/bid-projects/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function previewBidProjectImport(file: File, mode: "incremental" | "full") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  return api<StatsImportPreview>("/api/bid-projects/import/preview", { method: "POST", body: fd });
}

export async function commitBidProjectImport(
  file: File,
  mode: "incremental" | "full",
  decisions: { row_index: number; existing_id: number; action: "keep" | "overwrite" }[],
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("decisions_json", JSON.stringify(decisions));
  return api<StatsImportCommitResult>("/api/bid-projects/import/commit", { method: "POST", body: fd });
}

export async function fetchLatestBidProjectBackup() {
  return api<{ backup: StatsBackupInfo | null }>("/api/bid-projects/backup/latest");
}

export async function restoreBidProjectBackup() {
  return api<{ ok: boolean; restored: number; backup_id?: number; backup_at?: string }>(
    "/api/bid-projects/backup/restore",
    { method: "POST" },
  );
}

export async function exportBidProjects(params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/bid-projects/export${suffix}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("导出失败");
  return res.blob();
}

export async function downloadBidProjectTemplate() {
  const res = await fetch("/api/bid-projects/template", { credentials: "same-origin" });
  if (!res.ok) throw new Error("下载模板失败");
  return res.blob();
}

export async function fetchBidDeposits(params: Record<string, string | number>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  return api<{ total: number; items: BidDeposit[] }>(`/api/bid-deposits?${qs}`);
}

export async function saveBidDeposit(data: Partial<BidDeposit>, id?: number) {
  if (id) {
    return api<{ item: BidDeposit }>(`/api/bid-deposits/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
  return api<{ item: BidDeposit }>("/api/bid-deposits", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteBidDeposit(id: number) {
  return api<{ ok: boolean }>(`/api/bid-deposits/${id}`, { method: "DELETE" });
}

export async function deleteBidDeposits(ids: number[]) {
  return api<{ ok: boolean; deleted: number }>("/api/bid-deposits/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function previewBidDepositImport(file: File, mode: "incremental" | "full") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  return api<StatsImportPreview>("/api/bid-deposits/import/preview", { method: "POST", body: fd });
}

export async function commitBidDepositImport(
  file: File,
  mode: "incremental" | "full",
  decisions: { row_index: number; existing_id: number; action: "keep" | "overwrite" }[],
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("decisions_json", JSON.stringify(decisions));
  return api<StatsImportCommitResult>("/api/bid-deposits/import/commit", { method: "POST", body: fd });
}

export async function fetchLatestBidDepositBackup() {
  return api<{ backup: StatsBackupInfo | null }>("/api/bid-deposits/backup/latest");
}

export async function restoreBidDepositBackup() {
  return api<{ ok: boolean; restored: number; backup_id?: number; backup_at?: string }>(
    "/api/bid-deposits/backup/restore",
    { method: "POST" },
  );
}

export async function exportBidDeposits(params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/bid-deposits/export${suffix}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("导出失败");
  return res.blob();
}

export async function downloadBidDepositTemplate() {
  const res = await fetch("/api/bid-deposits/template", { credentials: "same-origin" });
  if (!res.ok) throw new Error("下载模板失败");
  return res.blob();
}

/** 下载 blob 为文件 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type WeeklyItem = { title: string; body: string };

export type WeeklyReport = {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  week_start: string;
  week_end: string;
  week_label: string;
  done_items: WeeklyItem[];
  problem_items: WeeklyItem[];
  solution_items: WeeklyItem[];
  plan_items: WeeklyItem[];
  status: "draft" | "submitted" | string;
  submitted_at?: string | null;
  updated_at?: string;
};

export type WeeklyMeta = {
  week_start: string;
  week_end: string;
  week_label: string;
  options: { week_start: string; week_end: string; week_label: string }[];
};

export type WeeklyStatRow = {
  user_id: number;
  username: string;
  display_name: string;
  role: string;
  status: "submitted" | "draft" | "missing" | string;
  report_id: number | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

export type WeeklyStats = {
  week_start: string;
  week_end: string;
  week_label: string;
  totals: { users: number; submitted: number; draft: number; missing: number };
  items: WeeklyStatRow[];
};

export async function fetchWeeklyMeta(week_start = "") {
  const qs = week_start ? `?week_start=${encodeURIComponent(week_start)}` : "";
  return api<WeeklyMeta>(`/api/weekly/meta${qs}`);
}

export async function fetchMyWeekly(week_start = "") {
  const qs = week_start ? `?week_start=${encodeURIComponent(week_start)}` : "";
  return api<{ item: WeeklyReport }>(`/api/weekly/mine${qs}`);
}

export async function fetchWeeklyStats(week_start = "") {
  const qs = week_start ? `?week_start=${encodeURIComponent(week_start)}` : "";
  return api<WeeklyStats>(`/api/weekly/stats${qs}`);
}

export async function fetchWeeklyReport(id: number) {
  return api<{ item: WeeklyReport }>(`/api/weekly/reports/${id}`);
}

export async function saveWeeklyReport(
  id: number,
  body: {
    display_name?: string;
    done_items: WeeklyItem[];
    problem_items: WeeklyItem[];
    solution_items: WeeklyItem[];
    plan_items: WeeklyItem[];
  },
) {
  return api<{ item: WeeklyReport }>(`/api/weekly/reports/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function submitWeeklyReport(id: number) {
  return api<{ item: WeeklyReport }>(`/api/weekly/reports/${id}/submit`, { method: "POST" });
}

export async function reopenWeeklyReport(id: number) {
  return api<{ item: WeeklyReport }>(`/api/weekly/reports/${id}/reopen`, { method: "POST" });
}

export async function exportWeeklyReport(id: number) {
  const res = await fetch(`/api/weekly/reports/${id}/export`, { credentials: "same-origin" });
  if (!res.ok) {
    let msg = "导出失败";
    try {
      const j = await res.json();
      if (j?.detail) msg = String(j.detail);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** 组长：合并导出指定周已提交周报 */
export async function exportWeeklyTeam(week_start = "") {
  const qs = week_start ? `?week_start=${encodeURIComponent(week_start)}` : "";
  const res = await fetch(`/api/weekly/export-team${qs}`, { credentials: "same-origin" });
  if (!res.ok) {
    let msg = "合并导出失败";
    try {
      const j = await res.json();
      if (j?.detail) msg = String(j.detail);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.blob();
}

export type WeeklyContentPack = {
  done_items: WeeklyItem[];
  problem_items: WeeklyItem[];
  solution_items: WeeklyItem[];
  plan_items: WeeklyItem[];
  has_template?: boolean;
  found?: boolean;
  source_week_start?: string;
  source_week_end?: string;
  updated_at?: string;
};

/** 读取个人常用模板 */
export async function fetchWeeklyTemplate() {
  return api<WeeklyContentPack>("/api/weekly/template");
}

/** 把当前内容存为常用模板 */
export async function saveWeeklyTemplate(body: {
  done_items: WeeklyItem[];
  problem_items: WeeklyItem[];
  solution_items: WeeklyItem[];
  plan_items: WeeklyItem[];
}) {
  return api<WeeklyContentPack>("/api/weekly/template", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** 取上一周内容（不建草稿）；userId 可指定周报所属人 */
export async function fetchPrevWeekContent(week_start = "", userId?: number) {
  const qs = new URLSearchParams();
  if (week_start) qs.set("week_start", week_start);
  if (userId) qs.set("user_id", String(userId));
  const q = qs.toString();
  return api<WeeklyContentPack>(`/api/weekly/prev-week-content${q ? `?${q}` : ""}`);
}

export type AiSettings = {
  scope: string;
  owner_id: number;
  enabled: boolean;
  base_url: string;
  api_key: string;
  api_key_masked: string;
  has_api_key: boolean;
  model: string;
  timeout_sec: number;
  updated_at?: string | null;
};

export type AiEffective = {
  ok: boolean;
  source?: string | null;
  message?: string;
  model?: string;
  base_url?: string;
  can_edit_system?: boolean;
};

export async function fetchAiStatus() {
  return api<AiEffective>("/api/ai/status");
}

export async function fetchSystemAiSettings() {
  return api<{ item: AiSettings }>("/api/ai/settings/system");
}

export async function saveSystemAiSettings(body: {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
  timeout_sec: number;
}) {
  return api<{ item: AiSettings }>("/api/ai/settings/system", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function fetchMyAiSettings() {
  return api<{ item: AiSettings; effective: AiEffective }>("/api/ai/settings/me");
}

export async function saveMyAiSettings(body: {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
  timeout_sec: number;
}) {
  return api<{ item: AiSettings }>("/api/ai/settings/me", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function clearMyAiSettings() {
  return api<{ item: AiSettings }>("/api/ai/settings/me", { method: "DELETE" });
}

export async function testAiSettings(body: {
  enabled?: boolean;
  base_url: string;
  api_key: string;
  model: string;
  timeout_sec: number;
}) {
  return api<{ ok: boolean; reply: string }>("/api/ai/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 周报：AI 分析本周询标并追加（不覆盖） */
export async function appendWeeklyInquiryAnalysis(id: number) {
  return api<{
    item: WeeklyReport;
    appended: {
      done_items: WeeklyItem[];
      problem_items: WeeklyItem[];
      solution_items?: WeeklyItem[];
    };
    inquiry_total: number;
    ai_source?: string;
    period?: string;
  }>(`/api/ai/weekly/${id}/append-inquiry-analysis`, { method: "POST" });
}

/** 报告规格修改参考（兼容旧扁平行） */
export type ReportSpecRefItem = {
  report_no: string;
  field: string;
  old_value: string;
  new_value: string;
  note: string;
};

export type ReportSpecMatch = {
  target_spec: string;
  base_report_no: string;
  base_spec: string;
  reason: string;
};

export type ReportSpecChange = {
  target_spec: string;
  position: string;
  old_value: string;
  new_value: string;
  must_change: string;
  note: string;
};

export type ReportSpecTestItem = {
  target_spec: string;
  seq: string;
  item: string;
  unit: string;
  requirement: string;
  result_draft: string;
  rating: string;
  note: string;
};

export type ReportSpecKeyParam = {
  target_spec: string;
  param: string;
  ref_value: string;
  note: string;
};

export type ReportSpecRelativeDiff = {
  target_spec: string;
  aspect: string;
  old_value: string;
  new_value: string;
  reason: string;
};

export type ReportSpecPack = {
  summary: string;
  warnings: string[];
  matches: ReportSpecMatch[];
  relative_diffs: ReportSpecRelativeDiff[];
  changes: ReportSpecChange[];
  test_items: ReportSpecTestItem[];
  key_params: ReportSpecKeyParam[];
  steps: string[];
  items: ReportSpecRefItem[];
  ai_source?: string;
  filename?: string;
  kept_on_server?: boolean;
};

/** 上传报告模板 + 目标规格，生成完整修改参考包（服务端不保留文件） */
export async function generateReportSpecRef(file: File, specs: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("specs", specs);
  return api<ReportSpecPack>("/api/ai/report-spec-ref", { method: "POST", body: fd });
}

/** 导出参考包为 Excel */
export async function exportReportSpecRef(pack: ReportSpecPack) {
  const res = await fetch("/api/ai/report-spec-ref/export", {
    credentials: "same-origin",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: pack.summary || "",
      warnings: pack.warnings || [],
      matches: pack.matches || [],
      relative_diffs: pack.relative_diffs || [],
      changes: pack.changes || [],
      test_items: pack.test_items || [],
      key_params: pack.key_params || [],
      steps: pack.steps || [],
      items: pack.items || [],
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(res.status, data.detail || "导出失败");
  }
  return res.blob();
}

