import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Download,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { ApiError } from "@/api/client";
import {
  deletePlatform,
  deletePlatforms,
  downloadBlob,
  downloadPlatformTemplate,
  exportPlatforms,
  fetchLatestPlatformBackup,
  fetchPlatforms,
  restorePlatformBackup,
  savePlatform,
  type Platform,
  type PlatformBackupInfo,
  type UserInfo,
} from "@/api/bidtrace";
import { PlatformImportDialog } from "@/components/PlatformImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { can, cn } from "@/lib/utils";

const EMPTY: Platform = {
  id: 0,
  name: "",
  url: "",
  login_method: "账号密码",
  login_account: "",
  login_password: "",
  has_ca: "否",
  ca_password: "",
  priority: "中",
  status: "启用",
  weight: 0,
  remark: "",
};

const DEFAULT_PAGE_SIZE = 20;

type Filters = {
  name: string;
  url: string;
  login_method: string;
  has_ca: string;
  priority: string;
  status: string;
};

const EMPTY_FILTERS: Filters = {
  name: "",
  url: "",
  login_method: "",
  has_ca: "",
  priority: "",
  status: "",
};

/** 平台账号页（对齐原管理台功能） */
export function PlatformsPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<Platform[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Platform | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importFile, setImportFile] = useState<File | null>(null);
  const [backup, setBackup] = useState<PlatformBackupInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshBackup = async () => {
    try {
      const r = await fetchLatestPlatformBackup();
      setBackup(r.backup);
    } catch {
      setBackup(null);
    }
  };

  const load = async (nextPage = page, nextFilters = filters, nextSize = pageSize) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchPlatforms({
        name: nextFilters.name,
        url: nextFilters.url,
        login_method: nextFilters.login_method,
        has_ca: nextFilters.has_ca,
        priority: nextFilters.priority,
        status: nextFilters.status,
        limit: nextSize,
        offset: (nextPage - 1) * nextSize,
      });
      setItems(data.items);
      setTotal(data.total);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, filters);
    void refreshBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));

  const selectedRows = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  );

  const onSearch = () => {
    setFilters(draft);
    setPage(1);
    void load(1, draft);
  };

  const onReset = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
    void load(1, EMPTY_FILTERS);
  };

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onSave = async () => {
    if (!editing || !editing.name.trim()) {
      setError("平台名称必填");
      return;
    }
    try {
      const { id, ...rest } = editing;
      await savePlatform(
        {
          ...rest,
          weight: Number(rest.weight) || 0,
        },
        id || undefined,
      );
      setEditing(null);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const onDeleteOne = async (id: number) => {
    if (!confirm("确定删除这条平台账号？")) return;
    try {
      await deletePlatform(id);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const onBatchEdit = () => {
    if (selectedRows.length !== 1) {
      alert(selectedRows.length === 0 ? "请先勾选一条记录" : "一次只能修改一条，请只勾选一条");
      return;
    }
    setEditing({ ...selectedRows[0] });
  };

  const onBatchDelete = async () => {
    if (selected.size === 0) {
      alert("请先勾选要删除的记录");
      return;
    }
    if (!confirm(`确定删除选中的 ${selected.size} 条？`)) return;
    try {
      await deletePlatforms([...selected]);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const onImport = async (file: File) => {
    setImportFile(file);
  };

  const onRestoreBackup = async () => {
    if (!backup) {
      alert("当前没有可恢复的备份");
      return;
    }
    if (
      !confirm(
        `确定恢复 ${backup.created_at} 的备份吗？\n将用备份中的 ${backup.row_count} 条覆盖当前平台账号表。`,
      )
    ) {
      return;
    }
    try {
      const r = await restorePlatformBackup();
      alert(`已恢复 ${r.restored} 条（备份时间 ${r.backup_at || ""}）`);
      setPage(1);
      await load(1, filters);
      await refreshBackup();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "恢复失败");
    }
  };

  const onExport = async () => {
    try {
      const blob = await exportPlatforms({
        name: filters.name,
        url: filters.url,
        login_method: filters.login_method,
        has_ca: filters.has_ca,
        priority: filters.priority,
        status: filters.status,
      });
      downloadBlob(blob, "platforms.xlsx");
    } catch {
      setError("导出失败");
    }
  };

  const onDownloadTemplate = async () => {
    try {
      const blob = await downloadPlatformTemplate();
      downloadBlob(blob, "platforms_template.xlsx");
    } catch {
      setError("下载模板失败");
    }
  };

  const onPageChange = (p: number, size: number) => {
    setPage(p);
    setPageSize(size);
    void load(p, filters, size);
  };

  return (
    <div className="flex min-h-full flex-col p-5 md:p-6">
      {/* 筛选区 */}
      <div className="glass-card p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <FilterField label="平台名称">
            <Input
              placeholder="请输入平台名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="平台网址">
            <Input
              placeholder="请输入平台网址"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="登录方式">
            <Select
              value={draft.login_method}
              onChange={(v) => setDraft({ ...draft, login_method: v })}
              options={["账号密码", "短信验证", "CA"]}
            />
          </FilterField>
          <FilterField label="是否有CA证书">
            <Select
              value={draft.has_ca}
              onChange={(v) => setDraft({ ...draft, has_ca: v })}
              options={["是", "否"]}
            />
          </FilterField>
          <FilterField label="平台优先级">
            <Select
              value={draft.priority}
              onChange={(v) => setDraft({ ...draft, priority: v })}
              options={["高", "中", "低"]}
            />
          </FilterField>
          <FilterField label="平台状态">
            <Select
              value={draft.status}
              onChange={(v) => setDraft({ ...draft, status: v })}
              options={["启用", "维护中", "停用"]}
            />
          </FilterField>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onSearch}>
            <Search className="h-3.5 w-3.5" />
            搜索
          </Button>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </Button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {can(perms, "platform.create") ? (
            <Button onClick={() => setEditing({ ...EMPTY })}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          ) : null}
          {can(perms, "platform.edit") ? (
            <Button variant="soft" onClick={onBatchEdit}>
              <Pencil className="h-3.5 w-3.5" />
              修改
            </Button>
          ) : null}
          {can(perms, "platform.delete") ? (
            <Button variant="danger" onClick={() => void onBatchDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          ) : null}
          {can(perms, "platform.import") ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                导入
              </Button>
              <Button variant="outline" onClick={() => void onDownloadTemplate()}>
                下载模板
              </Button>
              {backup ? (
                <Button variant="ghost" onClick={() => void onRestoreBackup()} title={backup.created_at}>
                  恢复上一版
                </Button>
              ) : null}
            </>
          ) : null}
          {can(perms, "platform.export") ? (
            <Button
              className="bg-[#f5c542] text-[#26251e] hover:bg-[#efb820]"
              onClick={() => void onExport()}
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[#6b6b6b]">
          <span>共 {total} 条</span>
          <Button variant="ghost" size="sm" onClick={() => void load(page, filters)} title="刷新">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      {/* 表格 */}
      <div className="glass-card mt-3 flex-1 overflow-auto">
        <table className="w-full min-w-[1280px] text-left text-[12px]">
          <thead className="sticky top-0 border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2.5 font-medium">平台名称</th>
              <th className="px-3 py-2.5 font-medium">平台网址</th>
              <th className="px-3 py-2.5 font-medium">登录方式</th>
              <th className="px-3 py-2.5 font-medium">登录账号</th>
              <th className="px-3 py-2.5 font-medium">登录密码</th>
              <th className="px-3 py-2.5 font-medium">是否有CA证书</th>
              <th className="px-3 py-2.5 font-medium">CA证书密码</th>
              <th className="px-3 py-2.5 font-medium">平台优先级</th>
              <th className="px-3 py-2.5 font-medium">平台状态</th>
              <th className="px-3 py-2.5 font-medium">平台权重</th>
              <th className="px-3 py-2.5 font-medium">备注说明</th>
              <th className="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-[#6b6b6b]">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-[#6b6b6b]">
                  暂无数据，可点击「导入」迁入 Excel
                </td>
              </tr>
            ) : (
              items.map((row, idx) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-black/[0.04]",
                    idx % 2 === 1 ? "bg-[#fbfbf9]" : "bg-white",
                    selected.has(row.id) && "bg-[#fff7f0]",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                    />
                  </td>
                  <td className="max-w-[160px] px-3 py-2.5 font-medium text-[#26251e]" title={row.name}>
                    <span className="line-clamp-2">{row.name}</span>
                  </td>
                  <td className="max-w-[180px] px-3 py-2.5">
                    {row.url ? (
                      <a
                        href={row.url.startsWith("http") ? row.url : `http://${row.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-[#2563eb] hover:underline"
                      >
                        {row.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Tag kind={loginMethodKind(row.login_method)}>{row.login_method || "—"}</Tag>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[#4a4a4a]">
                    {row.login_account || "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[#4a4a4a]">
                    {row.login_password || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Tag kind={row.has_ca === "是" ? "ok" : "warn"}>{row.has_ca || "—"}</Tag>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[#4a4a4a]">
                    {row.ca_password || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Tag kind={priorityKind(row.priority)}>{row.priority || "—"}</Tag>
                  </td>
                  <td className="px-3 py-2.5">
                    <Tag kind={statusKind(row.status)}>{row.status || "—"}</Tag>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[#4a4a4a]">{row.weight ?? 0}</td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-[#6b6b6b]" title={row.remark}>
                    {row.remark || ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {can(perms, "platform.edit") ? (
                      <button
                        type="button"
                        className="mr-2 text-[#2563eb] hover:underline"
                        onClick={() => setEditing({ ...row })}
                      >
                        修改
                      </button>
                    ) : null}
                    {can(perms, "platform.delete") ? (
                      <button
                        type="button"
                        className="text-red-500 hover:underline"
                        onClick={() => void onDeleteOne(row.id)}
                      >
                        删除
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        disabled={loading}
        onChange={onPageChange}
      />

      <p className="mt-4 text-center text-[11px] text-[#a3a3a3]">
        Copyright © 2025 BruceChen. All Rights Reserved.
      </p>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">
              {editing.id ? "修改平台账号" : "新增平台账号"}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="平台名称 *">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="平台网址">
                <Input value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
              </Field>
              <Field label="登录方式">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.login_method}
                  onChange={(e) => setEditing({ ...editing, login_method: e.target.value })}
                >
                  {["账号密码", "短信验证", "CA"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="登录账号">
                <Input
                  value={editing.login_account}
                  onChange={(e) => setEditing({ ...editing, login_account: e.target.value })}
                />
              </Field>
              <Field label="登录密码">
                <Input
                  value={editing.login_password}
                  onChange={(e) => setEditing({ ...editing, login_password: e.target.value })}
                  placeholder={editing.id ? "保持 *** 表示不改" : ""}
                />
              </Field>
              <Field label="是否有CA证书">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.has_ca}
                  onChange={(e) => setEditing({ ...editing, has_ca: e.target.value })}
                >
                  <option>是</option>
                  <option>否</option>
                </select>
              </Field>
              <Field label="CA证书密码">
                <Input
                  value={editing.ca_password}
                  onChange={(e) => setEditing({ ...editing, ca_password: e.target.value })}
                />
              </Field>
              <Field label="平台优先级">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.priority}
                  onChange={(e) => setEditing({ ...editing, priority: e.target.value })}
                >
                  <option>高</option>
                  <option>中</option>
                  <option>低</option>
                </select>
              </Field>
              <Field label="平台状态">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                >
                  <option>启用</option>
                  <option>维护中</option>
                  <option>停用</option>
                </select>
              </Field>
              <Field label="平台权重(0~5)">
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={editing.weight}
                  onChange={(e) => setEditing({ ...editing, weight: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="备注说明">
                <Input
                  value={editing.remark}
                  onChange={(e) => setEditing({ ...editing, remark: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button onClick={() => void onSave()}>保存</Button>
            </div>
          </div>
        </div>
      ) : null}

      {importFile ? (
        <PlatformImportDialog
          file={importFile}
          onClose={() => setImportFile(null)}
          onDone={(message) => {
            setImportFile(null);
            alert(message);
            setPage(1);
            void load(1, filters);
            void refreshBackup();
          }}
        />
      ) : null}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px] text-[#26251e]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">请选择</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

type TagKind = "blue" | "green" | "ok" | "warn" | "muted" | "high" | "mid" | "low";

function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  const cls: Record<TagKind, string> = {
    blue: "bg-[#e8f3ff] text-[#1677ff]",
    green: "bg-[#e8f8ef] text-[#08979c]",
    ok: "bg-[#ecfdf3] text-[#067647]",
    warn: "bg-[#fff7e6] text-[#d46b08]",
    muted: "bg-[#f4f4f5] text-[#6b6b6b]",
    high: "bg-[#ecfdf3] text-[#067647]",
    mid: "bg-[#e8f3ff] text-[#1677ff]",
    low: "bg-[#f4f4f5] text-[#6b6b6b]",
  };
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", cls[kind])}>
      {children}
    </span>
  );
}

function loginMethodKind(v: string): TagKind {
  if (v.includes("短信")) return "green";
  if (v === "CA") return "warn";
  return "blue";
}

function priorityKind(v: string): TagKind {
  if (v === "高") return "high";
  if (v === "中") return "mid";
  return "low";
}

function statusKind(v: string): TagKind {
  if (v === "启用") return "ok";
  if (v === "维护中") return "muted";
  return "warn";
}
