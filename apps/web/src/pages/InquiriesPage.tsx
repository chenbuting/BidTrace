import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Download,
  Image as ImageIcon,
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
  deleteInquiry,
  deleteInquiries,
  downloadBlob,
  downloadInquiryTemplate,
  exportInquiries,
  fetchInquiries,
  fetchLatestInquiryBackup,
  fetchPlatformOptions,
  previewInquiryImport,
  commitInquiryImport,
  restoreInquiryBackup,
  saveInquiry,
  type Inquiry,
  type StatsBackupInfo,
  type UserInfo,
} from "@/api/bidtrace";
import { InquiryDailyReportDialog } from "@/components/InquiryDailyReportDialog";
import { StatsImportDialog } from "@/components/StatsImportDialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { toIsoDate, todayIso } from "@/lib/dates";
import { can, cn } from "@/lib/utils";

const SKIP_CATEGORIES = [
  "付款条件",
  "供货时间",
  "公司决策",
  "其他",
  "品牌限制",
  "平台限制",
  "清单数量",
  "清单问题",
  "线下递交",
  "资质要求",
];

const YES_NO = ["是", "否"];
/** 是否投标：含待确定（历史数据中已有该取值） */
const BID_OPTS = ["是", "否", "待确定"];
const OVERVIEW_OPTS = ["是", "否", "等待结果通知"];

const EMPTY: Inquiry = {
  id: 0,
  register_date: "",
  platform_name: "",
  project_name: "",
  is_bid: "否",
  is_registered: "否",
  file_received: "否",
  is_paid: "否",
  overview_done: "否",
  skip_reason_category: "",
  skip_reason_detail: "",
  deadline: "",
};

const DEFAULT_PAGE_SIZE = 20;

type Filters = {
  project_name: string;
  platform_name: string;
  is_bid: string;
  is_registered: string;
  file_received: string;
  is_paid: string;
  overview_done: string;
  skip_reason_category: string;
  date_from: string;
  date_to: string;
};

const EMPTY_FILTERS: Filters = {
  project_name: "",
  platform_name: "",
  is_bid: "",
  is_registered: "",
  file_received: "",
  is_paid: "",
  overview_done: "",
  skip_reason_category: "",
  date_from: "",
  date_to: "",
};

/** 询标报名页（对齐平台账号页布局） */
export function InquiriesPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<string[]>([]);
  const [items, setItems] = useState<Inquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Inquiry | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importFile, setImportFile] = useState<File | null>(null);
  const [backup, setBackup] = useState<StatsBackupInfo | null>(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshBackup = async () => {
    try {
      const r = await fetchLatestInquiryBackup();
      setBackup(r.backup);
    } catch {
      setBackup(null);
    }
  };

  const load = async (nextPage = page, nextFilters = filters, nextSize = pageSize) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchInquiries({
        project_name: nextFilters.project_name,
        platform_name: nextFilters.platform_name,
        is_bid: nextFilters.is_bid,
        is_registered: nextFilters.is_registered,
        file_received: nextFilters.file_received,
        is_paid: nextFilters.is_paid,
        overview_done: nextFilters.overview_done,
        skip_reason_category: nextFilters.skip_reason_category,
        date_from: nextFilters.date_from,
        date_to: nextFilters.date_to,
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
    void fetchPlatformOptions()
      .then((r) => setOptions(r.items))
      .catch(() => setOptions([]));
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

  const openEdit = (row: Inquiry) => {
    setEditing({
      ...row,
      register_date: toIsoDate(row.register_date),
      deadline: toIsoDate(row.deadline),
    });
  };

  const onSave = async () => {
    if (!editing) return;
    if (!editing.project_name.trim() && !editing.platform_name.trim()) {
      setError("请至少填写平台或项目名");
      return;
    }
    try {
      const { id, created_by, ...rest } = editing;
      await saveInquiry(
        {
          ...rest,
          register_date: toIsoDate(rest.register_date),
          deadline: toIsoDate(rest.deadline),
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
    if (!confirm("确定删除这条询标记录？")) return;
    try {
      await deleteInquiry(id);
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
      await deleteInquiries([...selected]);
      await load(page, filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const onImport = (file: File) => {
    setImportFile(file);
  };

  const onRestoreBackup = async () => {
    if (!backup) {
      alert("当前没有可恢复的备份");
      return;
    }
    if (
      !confirm(
        `确定恢复 ${backup.created_at} 的备份吗？\n将用备份中的 ${backup.row_count} 条覆盖当前询标报名表。`,
      )
    ) {
      return;
    }
    try {
      const r = await restoreInquiryBackup();
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
      const blob = await exportInquiries({ ...filters });
      downloadBlob(blob, "inquiries.xlsx");
    } catch {
      setError("导出失败");
    }
  };

  const onDownloadTemplate = async () => {
    try {
      const blob = await downloadInquiryTemplate();
      downloadBlob(blob, "inquiries_template.xlsx");
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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <FilterField label="项目名">
            <Input
              placeholder="请输入项目名"
              value={draft.project_name}
              onChange={(e) => setDraft({ ...draft, project_name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </FilterField>
          <FilterField label="平台">
            <Input
              list="filter-platform-list"
              placeholder="请输入或选择平台"
              value={draft.platform_name}
              onChange={(e) => setDraft({ ...draft, platform_name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
            <datalist id="filter-platform-list">
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </FilterField>
          <FilterField label="报名时间起">
            <DateInput
              value={draft.date_from}
              onChange={(v) => setDraft({ ...draft, date_from: v })}
            />
          </FilterField>
          <FilterField label="报名时间止">
            <DateInput value={draft.date_to} onChange={(v) => setDraft({ ...draft, date_to: v })} />
          </FilterField>
          <FilterField label="是否投标">
            <Select
              value={draft.is_bid}
              onChange={(v) => setDraft({ ...draft, is_bid: v })}
              options={BID_OPTS}
            />
          </FilterField>
          <FilterField label="是否报名">
            <Select
              value={draft.is_registered}
              onChange={(v) => setDraft({ ...draft, is_registered: v })}
              options={YES_NO}
            />
          </FilterField>
          <FilterField label="文件是否领取">
            <Select
              value={draft.file_received}
              onChange={(v) => setDraft({ ...draft, file_received: v })}
              options={YES_NO}
            />
          </FilterField>
          <FilterField label="是否交费">
            <Select
              value={draft.is_paid}
              onChange={(v) => setDraft({ ...draft, is_paid: v })}
              options={YES_NO}
            />
          </FilterField>
          <FilterField label="概况是否完成">
            <Select
              value={draft.overview_done}
              onChange={(v) => setDraft({ ...draft, overview_done: v })}
              options={OVERVIEW_OPTS}
            />
          </FilterField>
          <FilterField label="未参与原因类别">
            <Select
              value={draft.skip_reason_category}
              onChange={(v) => setDraft({ ...draft, skip_reason_category: v })}
              options={SKIP_CATEGORIES}
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
          {can(perms, "inquiry.create") ? (
            <Button onClick={() => setEditing({ ...EMPTY, register_date: todayIso() })}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          ) : null}
          {can(perms, "inquiry.edit") ? (
            <Button variant="soft" onClick={onBatchEdit}>
              <Pencil className="h-3.5 w-3.5" />
              修改
            </Button>
          ) : null}
          {can(perms, "inquiry.delete") ? (
            <Button variant="danger" onClick={() => void onBatchDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          ) : null}
          {can(perms, "inquiry.import") ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
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
          {can(perms, "inquiry.export") ? (
            <>
              <Button variant="outline" onClick={() => setDailyOpen(true)}>
                <ImageIcon className="h-3.5 w-3.5" />
                导出日报图
              </Button>
              <Button
                className="bg-[#f5c542] text-[#26251e] hover:bg-[#efb820]"
                onClick={() => void onExport()}
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </Button>
            </>
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
      <div className="glass-card mt-3 max-h-[calc(100vh-280px)] overflow-auto">
        <table className="w-full min-w-[1280px] text-left text-[12px]">
          <thead className="sticky top-0 z-10 border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="w-10 px-2.5 py-1.5">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th className="px-2.5 py-1.5 font-medium">报名时间</th>
              <th className="px-2.5 py-1.5 font-medium">平台</th>
              <th className="px-2.5 py-1.5 font-medium">项目名</th>
              <th className="px-2.5 py-1.5 font-medium">是否投标</th>
              <th className="px-2.5 py-1.5 font-medium">是否报名</th>
              <th className="px-2.5 py-1.5 font-medium">文件是否领取</th>
              <th className="px-2.5 py-1.5 font-medium">是否交费</th>
              <th className="px-2.5 py-1.5 font-medium">概况是否完成</th>
              <th className="px-2.5 py-1.5 font-medium">未参与原因类别</th>
              <th className="px-2.5 py-1.5 font-medium">详细原因</th>
              <th className="px-2.5 py-1.5 font-medium">报名截止时间</th>
              <th className="px-2.5 py-1.5 font-medium">操作</th>
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
                  <td className="px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[#4a4a4a]">
                    {toIsoDate(row.register_date) || row.register_date || "—"}
                  </td>
                  <td className="max-w-[140px] truncate px-2.5 py-1.5" title={row.platform_name}>
                    {row.platform_name || "—"}
                  </td>
                  <td className="max-w-[240px] px-2.5 py-1.5">
                    <p className="line-clamp-2 font-medium text-[#26251e]" title={row.project_name}>
                      {row.project_name || "—"}
                    </p>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <YesNoTag value={row.is_bid} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <YesNoTag value={row.is_registered} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <YesNoTag value={row.file_received} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <YesNoTag value={row.is_paid} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <OverviewTag value={row.overview_done} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    {row.skip_reason_category ? (
                      <Tag kind="muted">{row.skip_reason_category}</Tag>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="max-w-[180px] truncate px-2.5 py-1.5 text-[#6b6b6b]"
                    title={row.skip_reason_detail}
                  >
                    {row.skip_reason_detail || ""}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[#4a4a4a]">
                    {toIsoDate(row.deadline) || row.deadline || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    {can(perms, "inquiry.edit") ? (
                      <button
                        type="button"
                        className="mr-2 text-[#2563eb] hover:underline"
                        onClick={() => openEdit(row)}
                      >
                        修改
                      </button>
                    ) : null}
                    {can(perms, "inquiry.delete") ? (
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
              {editing.id ? "修改询标报名" : "新增询标报名"}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="报名时间">
                <DateInput
                  value={editing.register_date}
                  onChange={(v) => setEditing({ ...editing, register_date: v })}
                />
              </Field>
              <Field label="报名截止时间">
                <DateInput
                  value={editing.deadline}
                  onChange={(v) => setEditing({ ...editing, deadline: v })}
                />
              </Field>
              <Field label="平台">
                <Input
                  list="platform-list"
                  value={editing.platform_name}
                  onChange={(e) => setEditing({ ...editing, platform_name: e.target.value })}
                  placeholder="可选手动输入，或从已有平台选"
                />
                <datalist id="platform-list">
                  {options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
                <p className="mt-1 text-[11px] text-[#8a8a8a]">
                  建议从平台账号里选；也可手输未收录的平台名
                </p>
              </Field>
              <Field label="项目名">
                <Input
                  value={editing.project_name}
                  onChange={(e) => setEditing({ ...editing, project_name: e.target.value })}
                />
              </Field>
              {(
                [
                  ["is_bid", "是否投标", BID_OPTS],
                  ["is_registered", "是否报名", YES_NO],
                  ["file_received", "文件是否领取", YES_NO],
                  ["is_paid", "是否交费", YES_NO],
                  ["overview_done", "概况是否完成", OVERVIEW_OPTS],
                ] as const
              ).map(([key, label, opts]) => (
                <Field key={key} label={label}>
                  <select
                    className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                    value={editing[key]}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                  >
                    {opts.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
              <Field label="未参与原因类别">
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={editing.skip_reason_category}
                  onChange={(e) => setEditing({ ...editing, skip_reason_category: e.target.value })}
                >
                  <option value="">（空）</option>
                  {SKIP_CATEGORIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="详细原因">
                <Input
                  value={editing.skip_reason_detail}
                  onChange={(e) => setEditing({ ...editing, skip_reason_detail: e.target.value })}
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
        <StatsImportDialog
          title="导入询标报名"
          file={importFile}
          incrementalDesc="新记录直接写入。若「报名时间 + 平台 + 项目名」都与库中已有记录相同，会单独列出不一样的字段，由你选择保留原数据或用 Excel 覆盖。表头必须与固定模板完全一致（报名时间、平台、项目名、是否投标、是否报名、文件是否领取、是否交费、概况是否完成、未参与原因类别、参与状态或未参与详细原因、报名截止时间），否则会拒绝导入。"
          fullDesc="先自动备份当前全部询标报名，再清空表，再导入 Excel 全部内容。之后可用「恢复上一版」找回覆盖前数据。表头必须与固定模板完全一致，否则会拒绝导入。"
          conflictKeyHint="报名时间+平台+项目名"
          previewFn={previewInquiryImport}
          commitFn={commitInquiryImport}
          fetchBackup={fetchLatestInquiryBackup}
          restoreBackup={restoreInquiryBackup}
          renderConflictTitle={(c) => c.project_name || "（无项目名）"}
          renderConflictSubtitle={(c) => (
            <>
              {c.register_date || "—"} · {c.platform_name || "—"}
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

      <InquiryDailyReportDialog
        open={dailyOpen}
        onClose={() => setDailyOpen(false)}
        initialDate={filters.date_from || filters.date_to || todayIso()}
        canExport={can(perms, "inquiry.export")}
      />
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

type TagKind = "ok" | "no" | "wait" | "muted";

function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  const cls: Record<TagKind, string> = {
    ok: "bg-[#ecfdf3] text-[#067647]",
    no: "bg-[#fff7e6] text-[#d46b08]",
    wait: "bg-[#e8f3ff] text-[#1677ff]",
    muted: "bg-[#f4f4f5] text-[#6b6b6b]",
  };
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", cls[kind])}>
      {children}
    </span>
  );
}

function YesNoTag({ value }: { value: string }) {
  if (!value) return <span>—</span>;
  if (value === "待确定") return <Tag kind="wait">{value}</Tag>;
  return <Tag kind={value === "是" ? "ok" : "no"}>{value}</Tag>;
}

function OverviewTag({ value }: { value: string }) {
  if (!value) return <span>—</span>;
  if (value === "等待结果通知") return <Tag kind="wait">{value}</Tag>;
  return <Tag kind={value === "是" ? "ok" : "no"}>{value}</Tag>;
}
