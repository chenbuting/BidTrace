import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { RefreshCw, RotateCcw, Search } from "lucide-react";

import { ApiError } from "@/api/client";
import { fetchAudit, type AuditLog, type UserInfo } from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { can, cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 20;

/** 常见操作中文名（未知则显示原 action） */
const ACTION_LABELS: Record<string, string> = {
  login: "登录",
  logout: "退出",
  "user.create": "新建用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "user.perms": "单人权限微调",
  "role.create": "新建角色",
  "role.update": "更新角色",
  "role.delete": "删除角色",
  "notify.send": "发送通知",
  "platform.create": "新建平台",
  "platform.update": "更新平台",
  "platform.delete": "删除平台",
  "platform.batch_delete": "批量删除平台",
  "platform.export": "导出平台",
  "platform.import": "导入平台",
  "inquiry.create": "新建询标",
  "inquiry.update": "更新询标",
  "inquiry.delete": "删除询标",
  "inquiry.batch_delete": "批量删除询标",
  "inquiry.export": "导出询标",
  "inquiry.import": "导入询标",
  "inquiry.import_incremental": "增量导入询标",
  "inquiry.import_full": "全量覆盖导入询标",
  "inquiry.restore_backup": "恢复询标备份",
  "weekly.save": "保存周报",
  "weekly.submit": "提交周报",
  "weekly.reopen": "退回周报草稿",
  "weekly.export": "导出周报",
  "project.export": "导出投标项目",
  "project.create": "新建投标项目",
  "project.update": "更新投标项目",
  "project.delete": "删除投标项目",
  "project.batch_delete": "批量删除投标项目",
  "deposit.export": "导出保证金",
  "deposit.create": "新建保证金",
  "deposit.update": "更新保证金",
  "deposit.delete": "删除保证金",
  "deposit.batch_delete": "批量删除保证金",
  "ai.report_spec_ref": "报告规格分析",
  "ai.report_spec_export": "导出规格参考包",
  "ai.settings_system": "保存全局 AI 配置",
  "ai.settings_user": "保存个人 AI 配置",
  "ai.settings_user_clear": "清除个人 AI 配置",
  "ai.weekly_inquiry_append": "周报 AI 询标分析",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

type Filters = {
  username: string;
  action: string;
  target: string;
  date_from: string;
  date_to: string;
};

const EMPTY: Filters = {
  username: "",
  action: "",
  target: "",
  date_from: "",
  date_to: "",
};

/** 操作日志独立模块 */
export function AuditPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];
  const allowed = can(perms, "system.audit");

  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [filters, setFilters] = useState<Filters>({ ...EMPTY });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (f = filters, p = page, size = pageSize) => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchAudit({
        username: f.username,
        action: f.action,
        target: f.target,
        date_from: f.date_from,
        date_to: f.date_to,
        limit: size,
        offset: (p - 1) * size,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setActions(data.actions || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载日志失败");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const actionOptions = useMemo(() => {
    const set = new Set([...actions, ...Object.keys(ACTION_LABELS)]);
    return [...set].sort();
  }, [actions]);

  if (!allowed) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-[13px] text-[#6b6b6b]">没有查看操作日志的权限。</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-5">
      <div className="mb-3">
        <h1 className="text-[18px] font-semibold tracking-tight text-[#26251e]">操作日志</h1>
        <p className="mt-0.5 text-[12px] text-[#6b6b6b]">查看登录、用户权限与业务操作记录</p>
      </div>

      <div className="rounded-lg border border-black/[0.08] bg-white px-3 py-2.5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-0.5">
            <Label className="text-[11px]">操作人</Label>
            <Input
              className="h-8 text-[12px]"
              value={draft.username}
              placeholder="用户名"
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (setFilters({ ...draft }), setPage(1), void load(draft, 1))}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[11px]">操作类型</Label>
            <select
              className="h-8 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[12px]"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            >
              <option value="">全部</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[11px]">对象</Label>
            <Input
              className="h-8 text-[12px]"
              value={draft.target}
              placeholder="如 user:2 / auth"
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[11px]">开始日期</Label>
            <DateInput value={draft.date_from} onChange={(v) => setDraft({ ...draft, date_from: v })} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[11px]">结束日期</Label>
            <DateInput value={draft.date_to} onChange={(v) => setDraft({ ...draft, date_to: v })} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              setFilters({ ...draft });
              setPage(1);
              void load(draft, 1);
            }}
          >
            <Search className="h-3.5 w-3.5" />
            搜索
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft({ ...EMPTY });
              setFilters({ ...EMPTY });
              setPage(1);
              void load(EMPTY, 1);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void load(filters, page)} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      {/* 表格区域限高，内部滚动，避免整页被拉很长 */}
      <div className="mt-3 max-h-[calc(100vh-260px)] overflow-auto rounded-lg border border-black/[0.08] bg-white">
        <table className="w-full min-w-[860px] text-left text-[12px]">
          <thead className="sticky top-0 z-10 border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">时间</th>
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">操作人</th>
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">操作</th>
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">对象</th>
              <th className="px-2.5 py-1.5 font-medium">详情</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[#8a8a8a]">
                  {loading ? "加载中…" : "暂无日志"}
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} className="border-b border-black/[0.04] hover:bg-[#fafaf8]">
                  <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-[#6b6b6b]">
                    {a.created_at}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-[#26251e]">
                    {a.username || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[#26251e]" title={a.action}>
                    {actionLabel(a.action)}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-2.5 py-1.5 text-[#4a4a4a]"
                    title={a.target || undefined}
                  >
                    {a.target || "—"}
                  </td>
                  <td
                    className="max-w-[360px] truncate px-2.5 py-1.5 text-[#4a4a4a]"
                    title={a.detail || undefined}
                  >
                    {a.detail || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        disabled={loading}
        onChange={(p, size) => {
          setPage(p);
          setPageSize(size);
          void load(filters, p, size);
        }}
      />
    </div>
  );
}
