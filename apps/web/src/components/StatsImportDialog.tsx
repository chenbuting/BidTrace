import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import type { StatsBackupInfo, StatsImportConflict, StatsImportCommitResult, StatsImportPreview } from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "incremental" | "full";
type Step = "mode" | "conflicts" | "confirm-full";

type Props = {
  title: string;
  file: File;
  /** 增量模式说明（含冲突键与固定模板要求） */
  incrementalDesc: string;
  /** 全部覆盖模式说明 */
  fullDesc: string;
  /** 冲突步骤顶部提示，如「开标时间+项目名称+平台」 */
  conflictKeyHint: string;
  previewFn: (file: File, mode: Mode) => Promise<StatsImportPreview>;
  commitFn: (
    file: File,
    mode: Mode,
    decisions: { row_index: number; existing_id: number; action: "keep" | "overwrite" }[],
  ) => Promise<StatsImportCommitResult>;
  fetchBackup: () => Promise<{ backup: StatsBackupInfo | null }>;
  restoreBackup: () => Promise<{ ok: boolean; restored: number; backup_at?: string }>;
  renderConflictTitle: (c: StatsImportConflict) => ReactNode;
  renderConflictSubtitle?: (c: StatsImportConflict) => ReactNode;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** 统计表导入：选模式 → 增量冲突人工选择 / 全部覆盖确认（投标项目、保证金复用） */
export function StatsImportDialog({
  title,
  file,
  incrementalDesc,
  fullDesc,
  conflictKeyHint,
  previewFn,
  commitFn,
  fetchBackup,
  restoreBackup,
  renderConflictTitle,
  renderConflictSubtitle,
  onClose,
  onDone,
}: Props) {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode>("incremental");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [conflicts, setConflicts] = useState<StatsImportConflict[]>([]);
  const [decisions, setDecisions] = useState<Record<number, "keep" | "overwrite">>({});
  const [backup, setBackup] = useState<StatsBackupInfo | null>(null);

  useEffect(() => {
    void fetchBackup()
      .then((r) => setBackup(r.backup))
      .catch(() => setBackup(null));
  }, [fetchBackup]);

  const unresolved = useMemo(
    () => conflicts.filter((c) => !decisions[c.row_index]),
    [conflicts, decisions],
  );

  const runPreview = async (nextMode: Mode) => {
    setLoading(true);
    setError("");
    try {
      const data = await previewFn(file, nextMode);
      setTotal(data.total);
      setNewCount(data.new_count);
      setConflicts(data.conflicts || []);
      setBackup(data.latest_backup);
      const init: Record<number, "keep" | "overwrite"> = {};
      for (const c of data.conflicts || []) {
        if (c.identical) init[c.row_index] = "keep";
      }
      setDecisions(init);
      if (nextMode === "full") setStep("confirm-full");
      else if ((data.conflicts || []).length > 0) setStep("conflicts");
      else await doCommit(nextMode, {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "预览失败");
    } finally {
      setLoading(false);
    }
  };

  const doCommit = async (
    nextMode: Mode,
    nextDecisions: Record<number, "keep" | "overwrite">,
  ) => {
    setLoading(true);
    setError("");
    try {
      const list = Object.entries(nextDecisions).map(([row_index, action]) => {
        const c = conflicts.find((x) => x.row_index === Number(row_index));
        return {
          row_index: Number(row_index),
          existing_id: c?.existing_id ?? 0,
          action,
        };
      });
      const r = await commitFn(file, nextMode, list);
      const msg =
        nextMode === "full"
          ? `全部覆盖完成：导入 ${r.inserted} 条（已备份上一版 ${r.backup?.row_count ?? 0} 条）`
          : `增量完成：新增 ${r.inserted}，覆盖 ${r.updated}，保留 ${r.kept}`;
      onDone(msg);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "导入失败");
      setLoading(false);
    }
  };

  const onRestore = async () => {
    if (!backup) {
      alert("当前没有可恢复的备份");
      return;
    }
    if (
      !confirm(
        `确定恢复 ${backup.created_at} 的备份吗？\n将用备份中的 ${backup.row_count} 条覆盖当前数据表。`,
      )
    ) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await restoreBackup();
      onDone(`已恢复备份：写入 ${r.restored} 条（备份时间 ${r.backup_at || ""}）`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "恢复失败");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-lg">
        <div className="border-b border-black/[0.06] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#26251e]">{title}</h3>
          <p className="mt-1 truncate text-[12px] text-[#6b6b6b]">{file.name}</p>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {error ? <p className="mb-3 text-[12px] text-red-600">{error}</p> : null}

          {step === "mode" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-[#4a4a4a]">请先选择导入模式：</p>
              <label
                className={cn(
                  "block cursor-pointer rounded-xl border p-4",
                  mode === "incremental" ? "border-[#26251e] bg-[#fafaf8]" : "border-black/[0.08]",
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={mode === "incremental"}
                    onChange={() => setMode("incremental")}
                  />
                  <div>
                    <p className="text-[13px] font-semibold text-[#26251e]">增量追加</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#6b6b6b]">{incrementalDesc}</p>
                  </div>
                </div>
              </label>
              <label
                className={cn(
                  "block cursor-pointer rounded-xl border p-4",
                  mode === "full" ? "border-[#26251e] bg-[#fafaf8]" : "border-black/[0.08]",
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={mode === "full"}
                    onChange={() => setMode("full")}
                  />
                  <div>
                    <p className="text-[13px] font-semibold text-[#26251e]">全部覆盖</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#6b6b6b]">{fullDesc}</p>
                  </div>
                </div>
              </label>

              {backup ? (
                <div className="rounded-lg border border-dashed border-black/[0.12] bg-[#fafaf8] px-3 py-2 text-[12px] text-[#6b6b6b]">
                  已有上一版备份：{backup.created_at} · {backup.row_count} 条
                  <button
                    type="button"
                    className="ml-2 text-[#2563eb] hover:underline"
                    onClick={() => void onRestore()}
                    disabled={loading}
                  >
                    恢复上一版
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-[#a3a3a3]">当前还没有覆盖备份。</p>
              )}
            </div>
          ) : null}

          {step === "conflicts" ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-[#fff7f0] px-3 py-2 text-[12px] text-[#b54708]">
                发现 {conflicts.length} 条「{conflictKeyHint}」相同记录；新增约 {newCount} 条。请逐条选择保留或覆盖。
              </div>
              {conflicts.map((c) => (
                <div key={c.row_index} className="rounded-xl border border-black/[0.08] p-3">
                  <p className="text-[13px] font-medium text-[#26251e]">{renderConflictTitle(c)}</p>
                  {renderConflictSubtitle ? (
                    <div className="truncate text-[11px] text-[#6b6b6b]">{renderConflictSubtitle(c)}</div>
                  ) : null}
                  {c.identical ? (
                    <p className="mt-2 text-[12px] text-[#067647]">内容与现有记录完全一致</p>
                  ) : (
                    <div className="mt-2 overflow-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-[#6b6b6b]">
                          <tr>
                            <th className="py-1 pr-2 font-medium">字段</th>
                            <th className="py-1 pr-2 font-medium">原数据</th>
                            <th className="py-1 font-medium">Excel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.diffs.map((d) => (
                            <tr key={d.field} className="border-t border-black/[0.04]">
                              <td className="py-1 pr-2 text-[#4a4a4a]">{d.label}</td>
                              <td className="max-w-[160px] truncate py-1 pr-2 font-mono text-[#6b6b6b]" title={d.old}>
                                {d.old || "（空）"}
                              </td>
                              <td className="max-w-[160px] truncate py-1 font-mono text-[#26251e]" title={d.new}>
                                {d.new || "（空）"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`d-${c.row_index}`}
                        checked={decisions[c.row_index] === "keep"}
                        onChange={() => setDecisions({ ...decisions, [c.row_index]: "keep" })}
                      />
                      保留原数据
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`d-${c.row_index}`}
                        checked={decisions[c.row_index] === "overwrite"}
                        onChange={() => setDecisions({ ...decisions, [c.row_index]: "overwrite" })}
                      />
                      用 Excel 覆盖
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {step === "confirm-full" ? (
            <div className="space-y-3 text-[13px] text-[#4a4a4a]">
              <p>
                即将<strong>全部覆盖</strong>：Excel 共 {total} 条。
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[12px] text-[#6b6b6b]">
                <li>先自动备份当前库里全部数据</li>
                <li>再清空数据表</li>
                <li>再导入 Excel 全部内容</li>
                <li>之后可在导入入口点「恢复上一版」找回</li>
              </ul>
              {backup ? (
                <p className="text-[12px] text-[#b54708]">
                  注意：新备份会替换「可恢复」为这一次覆盖前的版本（仍保留最近若干份）。
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-black/[0.06] px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          {step === "mode" ? (
            <Button disabled={loading} onClick={() => void runPreview(mode)}>
              {loading ? "分析中…" : "下一步"}
            </Button>
          ) : null}
          {step === "conflicts" ? (
            <Button
              disabled={loading || unresolved.length > 0}
              onClick={() => void doCommit("incremental", decisions)}
            >
              {loading
                ? "导入中…"
                : unresolved.length > 0
                  ? `还有 ${unresolved.length} 条未选择`
                  : "确认增量导入"}
            </Button>
          ) : null}
          {step === "confirm-full" ? (
            <Button variant="danger" disabled={loading} onClick={() => void doCommit("full", {})}>
              {loading ? "覆盖中…" : "确认全部覆盖"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
