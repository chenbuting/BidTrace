import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChevronLeft, ChevronRight, Copy, Download, FileStack, Plus, RefreshCw, Save, Send, Sparkles, Trash2, Undo2 } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  appendWeeklyInquiryAnalysis,
  downloadBlob,
  exportWeeklyReport,
  exportWeeklyTeam,
  fetchMyWeekly,
  fetchPrevWeekContent,
  fetchWeeklyMeta,
  fetchWeeklyReport,
  fetchWeeklyStats,
  fetchWeeklyTemplate,
  reopenWeeklyReport,
  saveWeeklyReport,
  saveWeeklyTemplate,
  submitWeeklyReport,
  type UserInfo,
  type WeeklyItem,
  type WeeklyMeta,
  type WeeklyReport,
  type WeeklyStats,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, cn } from "@/lib/utils";

function emptyItem(): WeeklyItem {
  return { title: "", body: "" };
}

/** 本地日期转 YYYY-MM-DD */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 取某日所在工作周周日（周日～周六） */
function sundayOf(ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 展示：8月3日～8月9日（跨年带年份） */
function formatWeekRangeCn(weekStart: string, weekEnd: string): string {
  if (!weekStart || !weekEnd) return "—";
  const s = parseIsoDate(weekStart);
  const e = parseIsoDate(weekEnd);
  const sameYear = s.getFullYear() === e.getFullYear();
  const left = sameYear
    ? `${s.getMonth() + 1}月${s.getDate()}日`
    : `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日`;
  const right = sameYear
    ? `${e.getMonth() + 1}月${e.getDate()}日`
    : `${e.getFullYear()}年${e.getMonth() + 1}月${e.getDate()}日`;
  const yearPrefix = sameYear ? `${s.getFullYear()}年` : "";
  return `${yearPrefix}${left}～${right}`;
}

function reportHasContent(r: WeeklyReport): boolean {
  return Boolean(
    (r.done_items && r.done_items.length) ||
      (r.problem_items && r.problem_items.length) ||
      (r.solution_items && r.solution_items.length) ||
      (r.plan_items && r.plan_items.length),
  );
}

function cloneItems(items: WeeklyItem[] | undefined): WeeklyItem[] {
  return (items || []).map((it) => ({ title: it.title || "", body: it.body || "" }));
}

function statusLabel(s: string) {
  if (s === "submitted") return "已提交";
  if (s === "draft") return "草稿";
  if (s === "missing") return "未交";
  return s;
}

function StatusTag({ status }: { status: string }) {
  const cls =
    status === "submitted"
      ? "bg-[#ecfdf3] text-[#067647]"
      : status === "draft"
        ? "bg-[#fffaeb] text-[#b54708]"
        : "bg-black/[0.04] text-[#6b6b6b]";
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", cls)}>
      {statusLabel(status)}
    </span>
  );
}

function ItemEditor({
  label,
  items,
  disabled,
  onChange,
}: {
  label: string;
  items: WeeklyItem[];
  disabled?: boolean;
  onChange: (items: WeeklyItem[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {!disabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange([...items, emptyItem()])}
          >
            <Plus className="h-3.5 w-3.5" />
            添加一条
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/[0.1] px-3 py-4 text-[12px] text-[#8a8a8a]">
          暂无内容
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={idx} className="rounded-xl border border-black/[0.08] bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#8a8a8a]">第 {idx + 1} 条</span>
                {!disabled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
              <Input
                disabled={disabled}
                placeholder="标题，例如：相关网站寻标工作"
                value={it.title}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, title: e.target.value };
                  onChange(next);
                }}
              />
              <textarea
                disabled={disabled}
                className="mt-2 min-h-[72px] w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] text-[#26251e] outline-none focus:border-black/30 disabled:bg-black/[0.02]"
                placeholder="详细说明"
                value={it.body}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, body: e.target.value };
                  onChange(next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 周报：在线填写 + 提交；组长查看交报统计并可导出 Excel */
export function WeeklyPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];
  const canViewAll = can(perms, "weekly.view_all");
  const canEditOwn = can(perms, "weekly.edit_own");
  const canEditOthers = can(perms, "weekly.edit_others");

  const [tab, setTab] = useState<"mine" | "team">("mine");
  const [meta, setMeta] = useState<WeeklyMeta | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [stats, setStats] = useState<WeeklyStats | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMeta = async (ws = weekStart) => {
    const data = await fetchWeeklyMeta(ws);
    setMeta(data);
    if (!ws) setWeekStart(data.week_start);
    return data;
  };

  const loadMine = async (ws: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyWeekly(ws);
      setReport(data.item);
    } catch (e) {
      setReport(null);
      setError(e instanceof ApiError ? e.message : "加载周报失败");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (ws: string) => {
    if (!canViewAll) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchWeeklyStats(ws);
      setStats(data);
    } catch (e) {
      setStats(null);
      setError(e instanceof ApiError ? e.message : "加载统计失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const m = await loadMeta("");
        await loadMine(m.week_start);
        if (canViewAll) await loadStats(m.week_start);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "初始化失败");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWeekChange = async (ws: string) => {
    setWeekStart(ws);
    setMsg("");
    await loadMeta(ws);
    if (tab === "mine") await loadMine(ws);
    else await loadStats(ws);
  };

  const thisWeekStart = toIsoDate(sundayOf());
  const weekEndShown = meta?.week_end || (weekStart ? toIsoDate(addDays(parseIsoDate(weekStart), 6)) : "");
  const isThisWeek = weekStart === thisWeekStart;

  const shiftWeek = (delta: number) => {
    const base = weekStart ? parseIsoDate(weekStart) : sundayOf();
    const next = toIsoDate(addDays(sundayOf(base), delta * 7));
    void onWeekChange(next);
  };

  const editable =
    !!report &&
    (report.status !== "submitted" || canEditOthers) &&
    ((report.user_id === user?.id && canEditOwn) || (report.user_id !== user?.id && canEditOthers));

  const isOwnReport = !!report && !!user && report.user_id === user.id;

  const onSave = async () => {
    if (!report) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const data = await saveWeeklyReport(report.id, {
        display_name: report.display_name,
        done_items: report.done_items,
        problem_items: report.problem_items || [],
        solution_items: report.solution_items || [],
        plan_items: report.plan_items,
      });
      setReport(data.item);
      setMsg("已保存草稿");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async () => {
    if (!report) return;
    if (!confirm("提交后将交给组长统计，确定提交？")) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await saveWeeklyReport(report.id, {
        display_name: report.display_name,
        done_items: report.done_items,
        problem_items: report.problem_items || [],
        solution_items: report.solution_items || [],
        plan_items: report.plan_items,
      });
      const data = await submitWeeklyReport(report.id);
      setReport(data.item);
      setMsg("已提交");
      if (canViewAll) await loadStats(weekStart);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  };

  const onReopen = async () => {
    if (!report) return;
    if (!confirm("确定退回为草稿以便继续修改？")) return;
    try {
      const data = await reopenWeeklyReport(report.id);
      setReport(data.item);
      setMsg("已退回草稿");
      if (canViewAll) await loadStats(weekStart);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "退回失败");
    }
  };

  const onExport = async (id: number, label: string) => {
    try {
      const blob = await exportWeeklyReport(id);
      downloadBlob(blob, `周报-${label}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  };

  const onExportTeam = async () => {
    setError("");
    setMsg("");
    try {
      const blob = await exportWeeklyTeam(weekStart);
      const label = stats?.week_label || weekStart || "本周";
      downloadBlob(blob, `周报合并-${label}.xlsx`);
      setMsg(`已合并导出本周已交 ${stats?.totals.submitted ?? ""} 份`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "合并导出失败");
    }
  };

  const onCopyPrevWeek = async () => {
    if (!report || !editable) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const pack = await fetchPrevWeekContent(report.week_start, report.user_id);
      if (!pack.found) {
        setError("上一周没有可复制的内容");
        return;
      }
      if (reportHasContent(report) && !confirm("当前周已有内容，确定用上一周覆盖？")) return;
      const data = await saveWeeklyReport(report.id, {
        display_name: report.display_name,
        done_items: cloneItems(pack.done_items),
        problem_items: cloneItems(pack.problem_items),
        solution_items: cloneItems(pack.solution_items),
        plan_items: cloneItems(pack.plan_items),
      });
      setReport(data.item);
      const range = formatWeekRangeCn(pack.source_week_start || "", pack.source_week_end || "");
      setMsg(`已复制上一周（${range}）并保存为草稿`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "复制上一周失败");
    } finally {
      setSaving(false);
    }
  };

  const onSaveAsTemplate = async () => {
    if (!report) return;
    if (!reportHasContent(report)) {
      setError("当前周没有内容，无法存为模板");
      return;
    }
    if (!confirm("把当前内容存为常用模板？（会覆盖旧模板）")) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await saveWeeklyTemplate({
        done_items: report.done_items || [],
        problem_items: report.problem_items || [],
        solution_items: report.solution_items || [],
        plan_items: report.plan_items || [],
      });
      setMsg("已存为常用模板");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存模板失败");
    } finally {
      setSaving(false);
    }
  };

  const onApplyTemplate = async () => {
    if (!report || !editable) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const pack = await fetchWeeklyTemplate();
      if (!pack.has_template) {
        setError("还没有常用模板，请先「存为常用模板」");
        return;
      }
      if (reportHasContent(report) && !confirm("当前周已有内容，确定用模板覆盖？")) return;
      const data = await saveWeeklyReport(report.id, {
        display_name: report.display_name,
        done_items: cloneItems(pack.done_items),
        problem_items: cloneItems(pack.problem_items),
        solution_items: cloneItems(pack.solution_items),
        plan_items: cloneItems(pack.plan_items),
      });
      setReport(data.item);
      setMsg("已套用常用模板并保存为草稿");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "套用模板失败");
    } finally {
      setSaving(false);
    }
  };

  const onAiAppendInquiry = async () => {
    if (!report || !editable) return;
    const range = formatWeekRangeCn(report.week_start, report.week_end);
    if (
      !confirm(
        `将根据所选周报周期「${range}」的询标数据，按个人汇报口吻生成「所做事项」并追加（不写问题/意见，不覆盖已有内容）。继续？`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const data = await appendWeeklyInquiryAnalysis(report.id);
      setReport(data.item);
      const nDone = data.appended?.done_items?.length || 0;
      setMsg(
        `AI 已按「${range}」追加所做事项 ${nDone} 条（询标 ${data.inquiry_total} 条）`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "AI 分析失败");
    } finally {
      setSaving(false);
    }
  };

  const openTeamReport = async (reportId: number | null) => {
    if (!reportId) {
      setError("该同事本周尚未创建周报");
      return;
    }
    setTab("mine");
    setLoading(true);
    try {
      const data = await fetchWeeklyReport(reportId);
      setReport(data.item);
      setWeekStart(data.item.week_start);
      setMsg(`正在查看：${data.item.display_name}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "打开失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">工作周报</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            用「上一周 / 下一周」切换（周日～周六），填写后提交；组长可统计交报并导出 Excel
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-lg border border-black/[0.12] bg-white">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none border-r border-black/[0.08] px-2"
              title="上一周"
              onClick={() => shiftWeek(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
              上一周
            </Button>
            <div className="min-w-[168px] px-3 text-center text-[13px] text-[#26251e]">
              <span className="font-medium">{isThisWeek ? "本周" : "所选周"}</span>
              <span className="ml-1 text-[#6b6b6b]">{formatWeekRangeCn(weekStart, weekEndShown)}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none border-l border-black/[0.08] px-2"
              title="下一周"
              onClick={() => shiftWeek(1)}
            >
              下一周
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {!isThisWeek ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void onWeekChange(thisWeekStart)}>
              回到本周
            </Button>
          ) : null}
          <select
            className="h-9 max-w-[200px] rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
            value={weekStart}
            title="快速跳转到历史周"
            onChange={(e) => void onWeekChange(e.target.value)}
          >
            {(meta?.options || []).map((o) => {
              const label = formatWeekRangeCn(o.week_start, o.week_end);
              const tag = o.week_start === thisWeekStart ? "本周 · " : "";
              return (
                <option key={o.week_start} value={o.week_start}>
                  {tag}
                  {label}
                </option>
              );
            })}
            {weekStart && !(meta?.options || []).some((o) => o.week_start === weekStart) ? (
              <option value={weekStart}>{formatWeekRangeCn(weekStart, weekEndShown)}</option>
            ) : null}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void (tab === "mine" ? loadMine(weekStart) : loadStats(weekStart))}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {canViewAll ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === "mine" ? "default" : "outline"}
            onClick={() => {
              setTab("mine");
              void loadMine(weekStart);
            }}
          >
            填写/查看
          </Button>
          <Button
            size="sm"
            variant={tab === "team" ? "default" : "outline"}
            onClick={() => {
              setTab("team");
              void loadStats(weekStart);
            }}
          >
            组长统计
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
      {msg ? <p className="text-[13px] text-[#067647]">{msg}</p> : null}

      {tab === "team" && canViewAll ? (
        <div className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 text-[13px]">
            <div className="flex flex-wrap gap-3">
              <span>
                {isThisWeek ? "本周" : "所选周"}{" "}
                {formatWeekRangeCn(stats?.week_start || weekStart, stats?.week_end || weekEndShown)}
              </span>
              <span>应交 {stats?.totals.users ?? 0}</span>
              <span className="text-[#067647]">已交 {stats?.totals.submitted ?? 0}</span>
              <span className="text-[#b54708]">草稿 {stats?.totals.draft ?? 0}</span>
              <span className="text-[#6b6b6b]">未交 {stats?.totals.missing ?? 0}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!stats?.totals.submitted}
              onClick={() => void onExportTeam()}
            >
              <Download className="h-3.5 w-3.5" />
              合并导出本周已交
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="bg-black/[0.02] text-[12px] text-[#6b6b6b]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">姓名</th>
                  <th className="px-3 py-2.5 font-medium">账号</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">提交时间</th>
                  <th className="px-3 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.items || []).map((row) => (
                  <tr key={row.user_id} className="border-t border-black/[0.05]">
                    <td className="px-3 py-2.5">{row.display_name}</td>
                    <td className="px-3 py-2.5 text-[#6b6b6b]">{row.username}</td>
                    <td className="px-3 py-2.5">
                      <StatusTag status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[#6b6b6b]">{row.submitted_at || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2">
                        {row.report_id ? (
                          <Button size="sm" variant="ghost" onClick={() => void openTeamReport(row.report_id)}>
                            查看
                          </Button>
                        ) : (
                          <span className="px-2 text-[12px] text-[#8a8a8a]">—</span>
                        )}
                        {row.status === "submitted" && row.report_id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void onExport(row.report_id!, `${row.display_name}-${stats?.week_label}`)}
                          >
                            <Download className="h-3.5 w-3.5" />
                            导出
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "mine" ? (
        loading && !report ? (
          <p className="text-[13px] text-[#6b6b6b]">加载中…</p>
        ) : !report ? (
          <p className="text-[13px] text-[#6b6b6b]">暂无周报</p>
        ) : (
          <div className="space-y-4">
            <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-[#26251e]">工作报表</h2>
                  <StatusTag status={report.status} />
                </div>
                <p className="text-[12px] text-[#6b6b6b]">
                  时间：{formatWeekRangeCn(report.week_start, report.week_end)}
                  {report.week_start === thisWeekStart ? "（本周）" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editable ? (
                  <>
                    <Button variant="outline" disabled={saving} onClick={() => void onAiAppendInquiry()}>
                      <Sparkles className="h-3.5 w-3.5" />
                      AI 填入询标分析
                    </Button>
                    <Button variant="outline" disabled={saving} onClick={() => void onCopyPrevWeek()}>
                      <Copy className="h-3.5 w-3.5" />
                      复制上一周
                    </Button>
                    {isOwnReport ? (
                      <>
                        <Button variant="outline" disabled={saving} onClick={() => void onApplyTemplate()}>
                          <FileStack className="h-3.5 w-3.5" />
                          套用模板
                        </Button>
                        <Button variant="outline" disabled={saving} onClick={() => void onSaveAsTemplate()}>
                          存为常用模板
                        </Button>
                      </>
                    ) : null}
                    <Button variant="outline" disabled={saving} onClick={() => void onSave()}>
                      <Save className="h-3.5 w-3.5" />
                      保存草稿
                    </Button>
                  </>
                ) : null}
                {editable && isOwnReport && report.status !== "submitted" ? (
                  <Button disabled={saving} onClick={() => void onSubmit()}>
                    <Send className="h-3.5 w-3.5" />
                    提交组长
                  </Button>
                ) : null}
                {report.status === "submitted" &&
                ((report.user_id === user?.id && canEditOwn) || canEditOthers) ? (
                  <Button variant="outline" onClick={() => void onReopen()}>
                    <Undo2 className="h-3.5 w-3.5" />
                    退回草稿
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => void onExport(report.id, `${report.display_name}-${report.week_label}`)}
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 Excel
                </Button>
              </div>
            </div>

            <div className="glass-card space-y-4 p-4">
              <div className="max-w-sm space-y-1">
                <Label>制表人</Label>
                <Input
                  disabled={!editable}
                  value={report.display_name}
                  onChange={(e) => setReport({ ...report, display_name: e.target.value })}
                />
              </div>

              <ItemEditor
                label="所做事项"
                items={report.done_items || []}
                disabled={!editable}
                onChange={(done_items) => setReport({ ...report, done_items })}
              />

              <ItemEditor
                label="所遇问题"
                items={report.problem_items || []}
                disabled={!editable}
                onChange={(problem_items) => setReport({ ...report, problem_items })}
              />

              <ItemEditor
                label="解决意见"
                items={report.solution_items || []}
                disabled={!editable}
                onChange={(solution_items) => setReport({ ...report, solution_items })}
              />

              <ItemEditor
                label="预期工作"
                items={report.plan_items || []}
                disabled={!editable}
                onChange={(plan_items) => setReport({ ...report, plan_items })}
              />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
