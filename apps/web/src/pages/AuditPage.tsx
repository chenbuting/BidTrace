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

const DEFAULT_PAGE_SIZE = 50;

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
    <div className="p-6 md:p-8">
      <div className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">操作日志</h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">查看登录、用户权限与业务操作记录</p>
      </div>

      <div className="rounded-xl border border-black/[0.08] bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label>操作人</Label>
            <Input
              value={draft.username}
              placeholder="用户名"
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (setFilters({ ...draft }), setPage(1), void load(draft, 1))}
            />
          </div>
          <div className="space-y-1">
            <Label>操作类型</Label>
            <select
              className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            >
              <option value="">全部</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}（{a}）
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>对象</Label>
            <Input
              value={draft.target}
              placeholder="如 user:2 / auth"
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>开始日期</Label>
            <DateInput value={draft.date_from} onChange={(v) => setDraft({ ...draft, date_from: v })} />
          </div>
          <div className="space-y-1">
            <Label>结束日期</Label>
            <DateInput value={draft.date_to} onChange={(v) => setDraft({ ...draft, date_to: v })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
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
          <Button variant="ghost" onClick={() => void load(filters, page)} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {error ? <p className="mt-3 text-[12px] text-red-600">{error}</p> : null}

      <div className="mt-4 overflow-auto rounded-xl border border-black/[0.08] bg-white">
        <table className="w-full min-w-[900px] text-left text-[12px]">
          <thead className="border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="px-3 py-2.5 font-medium">时间</th>
              <th className="px-3 py-2.5 font-medium">操作人</th>
              <th className="px-3 py-2.5 font-medium">操作</th>
              <th className="px-3 py-2.5 font-medium">对象</th>
              <th className="px-3 py-2.5 font-medium">详情</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-[#8a8a8a]">
                  {loading ? "加载中…" : "暂无日志"}
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} className="border-b border-black/[0.04] align-top">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#6b6b6b]">{a.created_at}</td>
                  <td className="px-3 py-2.5 font-medium text-[#26251e]">{a.username || "—"}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-[#26251e]">{actionLabel(a.action)}</p>
                    <p className="font-mono text-[10px] text-[#a3a3a3]">{a.action}</p>
                  </td>
                  <td className="max-w-[180px] break-all px-3 py-2.5 text-[#4a4a4a]">{a.target || "—"}</td>
                  <td className="max-w-[420px] break-all px-3 py-2.5 text-[#4a4a4a]">{a.detail || "—"}</td>
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
