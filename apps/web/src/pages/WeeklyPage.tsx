import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Download, Plus, RefreshCw, Save, Send, Trash2, Undo2 } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  downloadBlob,
  exportWeeklyReport,
  fetchMyWeekly,
  fetchWeeklyMeta,
  fetchWeeklyReport,
  fetchWeeklyStats,
  reopenWeeklyReport,
  saveWeeklyReport,
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

  const editable =
    !!report &&
    (report.status !== "submitted" || canEditOthers) &&
    ((report.user_id === user?.id && canEditOwn) || (report.user_id !== user?.id && canEditOthers));

  const onSave = async () => {
    if (!report) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const data = await saveWeeklyReport(report.id, {
        display_name: report.display_name,
        done_items: report.done_items,
        problems: report.problems,
        solutions: report.solutions,
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
        problems: report.problems,
        solutions: report.solutions,
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
    } catch {
      setError("导出失败");
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
            按自然周填写「所做事项 / 所遇问题 / 解决意见 / 预期工作」，提交后组长可统计交报情况并导出 Excel
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
            value={weekStart}
            onChange={(e) => void onWeekChange(e.target.value)}
          >
            {(meta?.options || []).map((o) => (
              <option key={o.week_start} value={o.week_start}>
                {o.week_label}（{o.week_start} ~ {o.week_end}）
              </option>
            ))}
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
          <Button size="sm" variant={tab === "mine" ? "default" : "outline"} onClick={() => setTab("mine")}>
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
          <div className="flex flex-wrap gap-3 border-b border-black/[0.06] px-4 py-3 text-[13px]">
            <span>本周 {stats?.week_label || "—"}</span>
            <span>应交 {stats?.totals.users ?? 0}</span>
            <span className="text-[#067647]">已交 {stats?.totals.submitted ?? 0}</span>
            <span className="text-[#b54708]">草稿 {stats?.totals.draft ?? 0}</span>
            <span className="text-[#6b6b6b]">未交 {stats?.totals.missing ?? 0}</span>
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
                        <Button size="sm" variant="ghost" onClick={() => void openTeamReport(row.report_id)}>
                          查看
                        </Button>
                        {row.report_id ? (
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
                  时间：{report.week_label}（{report.week_start} ~ {report.week_end}）
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editable ? (
                  <Button variant="outline" disabled={saving} onClick={() => void onSave()}>
                    <Save className="h-3.5 w-3.5" />
                    保存草稿
                  </Button>
                ) : null}
                {editable && report.status !== "submitted" ? (
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
                items={report.done_items}
                disabled={!editable}
                onChange={(done_items) => setReport({ ...report, done_items })}
              />

              <div className="space-y-1">
                <Label>所遇问题</Label>
                <textarea
                  disabled={!editable}
                  className="min-h-[88px] w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] outline-none focus:border-black/30 disabled:bg-black/[0.02]"
                  value={report.problems}
                  onChange={(e) => setReport({ ...report, problems: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label>解决意见</Label>
                <textarea
                  disabled={!editable}
                  className="min-h-[88px] w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] outline-none focus:border-black/30 disabled:bg-black/[0.02]"
                  value={report.solutions}
                  onChange={(e) => setReport({ ...report, solutions: e.target.value })}
                />
              </div>

              <ItemEditor
                label="预期工作"
                items={report.plan_items}
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
