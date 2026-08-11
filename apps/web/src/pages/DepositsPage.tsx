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
  commitBidDepositImport,
  deleteBidDeposit,
  deleteBidDeposits,
  downloadBidDepositTemplate,
  downloadBlob,
  exportBidDeposits,
  fetchBidDeposits,
  fetchLatestBidDepositBackup,
  previewBidDepositImport,
  restoreBidDepositBackup,
  saveBidDeposit,
  type BidDeposit,
  type StatsBackupInfo,
  type UserInfo,
} from "@/api/bidtrace";
import { StatsImportDialog } from "@/components/StatsImportDialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { toIsoDate } from "@/lib/dates";
import { can, cn } from "@/lib/utils";

const EMPTY: BidDeposit = {
  id: 0,
  serial_no: "",
  apply_time: "",
  project_name: "",
  payee: "",
  platform: "",
  amount: "",
  bidder: "",
  is_returned: "",
  return_contact: "",
  remark: "",
};

const DEFAULT_PAGE_SIZE = 20;

type Filters = {
  project_name: string;
  platform: string;
  bidder: string;
  is_returned: string;
  payee: string;
};

const EMPTY_FILTERS: Filters = {
  project_name: "",
  platform: "",
  bidder: "",
  is_returned: "",
  payee: "",
};

/** 投标保证金页 */
export function DepositsPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<BidDeposit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BidDeposit | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importFile, setImportFile] = useState<File | null>(null);
  const [backup, setBackup] = useState<StatsBackupInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshBackup = async () => {
    try {
      const r = await fetchLatestBidDepositBackup();
      setBackup(r.backup);
    } catch {
      setBackup(null);
    }
  };

  const load = async (nextPage = page, nextFilters = filters, nextSize = pageSize) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchBidDeposits({
        project_name: nextFilters.project_name,
        platform: nextFilters.platform,
        bidder: nextFilters.bidder,
        is_returned: nextFilters.is_returned,
        payee: nextFilters.payee,
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

  const openEdit = (row: BidDeposit) => {
    setEditing({ ...row, apply_time: toIsoDate(row.apply_time) });
  };

  const onSave = async () => {
    if (!editing) return;
    try {
      const { id, ...rest } = editing;
      await saveBidDeposit({ ...rest, apply_time: toIsoDate(rest.apply_time) }, id || undefined);
      setEditing(null);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const onDeleteOne = async (id: number) => {
    if (!confirm("确定删除这条投标保证金？")) return;
    try {
      await deleteBidDeposit(id);
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
    openEdit(selectedRows[0]);
  };

  const onBatchDelete = async () => {
    if (selected.size === 0) {
      alert("请先勾选要删除的记录");
      return;
    }
    if (!confirm(`确定删除选中的 ${selected.size} 条？`)) return;
    try {
      await deleteBidDeposits([...selected]);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const onRestoreBackup = async () => {
    if (!backup) {
      alert("当前没有可恢复的备份");
      return;
    }
    if (
      !confirm(
        `确定恢复 ${backup.created_at} 的备份吗？\n将用备份中的 ${backup.row_count} 条覆盖当前投标保证金表。`,
      )
    ) {
      return;
    }
    try {
      const r = await restoreBidDepositBackup();
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
      const blob = await exportBidDeposits({
        project_name: filters.project_name,
        platform: filters.platform,
        bidder: filters.bidder,
        is_returned: filters.is_returned,
        payee: filters.payee,
      });
      downloadBlob(blob, "bid_deposits.xlsx");
    } catch {
      setError("导出失败");
    }
  };

  const onDownloadTemplate = async () => {
    try {
      const blob = await downloadBidDepositTemplate();
      downloadBlob(blob, "bid_deposits_template.xlsx");
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
      <div className="glass-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <FilterField label="项目名称">
            <Input
              placeholder="请输入项目名称"
              value={draft.project_name}
              onChange={(e) => setDraft({ ...draft, project_name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="平台">
            <Input
              placeholder="请输入平台"
              value={draft.platform}
              onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="投标员">
            <Input
              placeholder="请输入投标员"
              value={draft.bidder}
              onChange={(e) => setDraft({ ...draft, bidder: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="收款单位">
            <Input
              placeholder="请输入收款单位"
              value={draft.payee}
              onChange={(e) => setDraft({ ...draft, payee: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="是否退回">
            <Select
              value={draft.is_returned}
              onChange={(v) => setDraft({ ...draft, is_returned: v })}
              options={["是", "否"]}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {can(perms, "deposit.create") ? (
            <Button onClick={() => setEditing({ ...EMPTY })}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          ) : null}
          {can(perms, "deposit.edit") ? (
            <Button variant="soft" onClick={onBatchEdit}>
              <Pencil className="h-3.5 w-3.5" />
              修改
            </Button>
          ) : null}
          {can(perms, "deposit.delete") ? (
            <Button variant="danger" onClick={() => void onBatchDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          ) : null}
          {can(perms, "deposit.import") ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setImportFile(f);
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
          {can(perms, "deposit.export") ? (
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

      <div className="glass-card mt-3 max-h-[calc(100vh-280px)] overflow-auto">
        <table className="w-full min-w-[1300px] text-left text-[12px]">
          <thead className="sticky top-0 z-10 border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="w-10 px-2.5 py-1.5">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th className="px-2.5 py-1.5 font-medium">序号</th>
              <th className="px-2.5 py-1.5 font-medium">申请时间</th>
              <th className="px-2.5 py-1.5 font-medium">项目名称</th>
              <th className="px-2.5 py-1.5 font-medium">收款单位</th>
              <th className="px-2.5 py-1.5 font-medium">平台</th>
              <th className="px-2.5 py-1.5 font-medium">金额（万元）</th>
              <th className="px-2.5 py-1.5 font-medium">投标员</th>
              <th className="px-2.5 py-1.5 font-medium">是否退回</th>
              <th className="px-2.5 py-1.5 font-medium">退回联系方式</th>
              <th className="px-2.5 py-1.5 font-medium">备注</th>
              <th className="px-2.5 py-1.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center text-[#6b6b6b]">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center text-[#6b6b6b]">
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
                  <td className="px-2.5 py-1.5">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} />
                  </td>
                  <td className="px-2.5 py-1.5 text-[#4a4a4a]">{row.serial_no || "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{row.apply_time || "—"}</td>
                  <td className="max-w-[180px] px-2.5 py-1.5 font-medium text-[#26251e]" title={row.project_name}>
                    <span className="line-clamp-2">{row.project_name || "—"}</span>
                  </td>
                  <td className="max-w-[160px] truncate px-2.5 py-1.5" title={row.payee}>
                    {row.payee || "—"}
                  </td>
                  <td className="px-2.5 py-1.5">{row.platform || "—"}</td>
                  <td className="px-2.5 py-1.5 font-medium text-[#26251e]">{row.amount || "—"}</td>
                  <td className="px-2.5 py-1.5">{row.bidder || "—"}</td>
                  <td className="px-2.5 py-1.5">
                    <Tag kind={row.is_returned === "是" ? "ok" : row.is_returned === "否" ? "warn" : "muted"}>
                      {row.is_returned || "—"}
                    </Tag>
                  </td>
                  <td className="max-w-[140px] truncate px-2.5 py-1.5 text-[#4a4a4a]" title={row.return_contact}>
                    {row.return_contact || "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-2.5 py-1.5 text-[#6b6b6b]" title={row.remark}>
                    {row.remark || ""}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    {can(perms, "deposit.edit") ? (
                      <button
                        type="button"
                        className="mr-2 text-[#2563eb] hover:underline"
                        onClick={() => openEdit(row)}
                      >
                        修改
                      </button>
                    ) : null}
                    {can(perms, "deposit.delete") ? (
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
              {editing.id ? "修改投标保证金" : "新增投标保证金"}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="序号">
                <Input value={editing.serial_no} onChange={(e) => setEditing({ ...editing, serial_no: e.target.value })} />
              </Field>
              <Field label="申请时间">
                <DateInput
                  value={editing.apply_time}
                  onChange={(v) => setEditing({ ...editing, apply_time: v })}
                />
              </Field>
              <Field label="项目名称">
                <Input value={editing.project_name} onChange={(e) => setEditing({ ...editing, project_name: e.target.value })} />
              </Field>
              <Field label="收款单位">
                <Input value={editing.payee} onChange={(e) => setEditing({ ...editing, payee: e.target.value })} />
              </Field>
              <Field label="平台">
                <Input value={editing.platform} onChange={(e) => setEditing({ ...editing, platform: e.target.value })} />
              </Field>
              <Field label="金额（万元）">
                <Input value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
              </Field>
              <Field label="投标员">
                <Input value={editing.bidder} onChange={(e) => setEditing({ ...editing, bidder: e.target.value })} />
              </Field>
              <Field label="是否退回">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.is_returned}
                  onChange={(e) => setEditing({ ...editing, is_returned: e.target.value })}
                >
                  <option value="">请选择</option>
                  <option>是</option>
                  <option>否</option>
                </select>
              </Field>
              <Field label="保证金退回联系方式">
                <Input value={editing.return_contact} onChange={(e) => setEditing({ ...editing, return_contact: e.target.value })} />
              </Field>
              <Field label="备注">
                <Input value={editing.remark} onChange={(e) => setEditing({ ...editing, remark: e.target.value })} />
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
        <StatsImportDialog
          title="导入投标保证金"
          file={importFile}
          incrementalDesc="新记录直接写入。若「申请时间 + 项目名称 + 收款单位」都与库中已有记录相同，会单独列出不一样的字段，由你选择保留原数据或用 Excel 覆盖。表头必须与固定模板完全一致（序号、申请时间、项目名称、收款单位、平台、金额（万元）、投标员、是否退回、保证金退回联系方式、备注），第 6 列表头必须是字面量「金额（万元）」，否则会拒绝导入。"
          fullDesc="先自动备份当前全部投标保证金，再清空表，再导入 Excel 全部内容。之后可用「恢复上一版」找回覆盖前数据。表头必须与固定模板完全一致，否则会拒绝导入。"
          conflictKeyHint="申请时间+项目名称+收款单位"
          previewFn={previewBidDepositImport}
          commitFn={commitBidDepositImport}
          fetchBackup={fetchLatestBidDepositBackup}
          restoreBackup={restoreBidDepositBackup}
          renderConflictTitle={(c) => c.project_name || "（无项目名称）"}
          renderConflictSubtitle={(c) => (
            <>
              {c.apply_time || "—"} · {c.payee || "—"}
            </>
          )}
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

type TagKind = "ok" | "warn" | "muted";

function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  const cls: Record<TagKind, string> = {
    ok: "bg-[#ecfdf3] text-[#067647]",
    warn: "bg-[#fff7e6] text-[#d46b08]",
    muted: "bg-[#f4f4f5] text-[#6b6b6b]",
  };
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", cls[kind])}>
      {children}
    </span>
  );
}
