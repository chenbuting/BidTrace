import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  downloadBlob,
  exportReportSpecRef,
  generateReportSpecRef,
  type ReportSpecPack,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function emptyPack(): ReportSpecPack {
  return {
    summary: "",
    warnings: [],
    matches: [],
    relative_diffs: [],
    changes: [],
    test_items: [],
    key_params: [],
    steps: [],
    items: [],
  };
}

const PROGRESS_STEPS = [
  { key: "parse", label: "上传并解析 Word 模板" },
  { key: "ai", label: "AI 识别结构并分析改法（最久）" },
  { key: "pack", label: "整理参考包" },
] as const;

type ProgressKey = (typeof PROGRESS_STEPS)[number]["key"] | "done" | null;

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
}

/** 检验报告规格修改参考：通用模板 + 目标规格 → 修改说明/检验项目/可导出Excel */
export function ReportSpecPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [specs, setSpecs] = useState(
    "ZC-YGG-0.6/1KV 3*120+2*70\nZC-KGGP-750V 10*1.5",
  );
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [pack, setPack] = useState<ReportSpecPack | null>(null);
  const [progress, setProgress] = useState<ProgressKey>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const onPick = (f: File | null) => {
    setFile(f);
    setError("");
  };

  const onGenerate = async () => {
    if (!file) {
      setError("请先选择 .docx 报告模板");
      return;
    }
    if (!specs.trim()) {
      setError("请填写目标规格");
      return;
    }
    setLoading(true);
    setError("");
    setPack(null);
    setProgress("parse");

    // 前端分段提示：真实耗时主要在同一次 AI 请求里
    const toAi = window.setTimeout(() => setProgress("ai"), 900);

    try {
      const data = await generateReportSpecRef(file, specs.trim());
      window.clearTimeout(toAi);
      setProgress("pack");
      await new Promise((r) => window.setTimeout(r, 350));
      setPack({ ...emptyPack(), ...data });
      setProgress("done");
    } catch (e) {
      window.clearTimeout(toAi);
      setProgress(null);
      setError(e instanceof ApiError ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const onExport = async () => {
    if (!pack) return;
    setExporting(true);
    setError("");
    try {
      const blob = await exportReportSpecRef(pack);
      downloadBlob(blob, "报告规格修改参考.xlsx");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const hasResult =
    !!pack &&
    (!!pack.summary ||
      pack.matches.length > 0 ||
      (pack.relative_diffs?.length || 0) > 0 ||
      pack.changes.length > 0 ||
      pack.test_items.length > 0 ||
      pack.key_params.length > 0 ||
      pack.steps.length > 0);

  const stepStatus = (key: (typeof PROGRESS_STEPS)[number]["key"]) => {
    if (progress === "done") return "done";
    if (!progress) return "wait";
    const order = PROGRESS_STEPS.map((s) => s.key);
    const cur = order.indexOf(progress === "pack" ? "pack" : progress);
    const idx = order.indexOf(key);
    if (idx < cur) return "done";
    if (idx === cur) return "active";
    return "wait";
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">
          报告规格辅助
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          上传任意结构相近的检验报告 Word（.docx），填写目标规格。AI
          先识别模板结构，再按「套用样例 / 修改说明 / 检验项目草稿」方向灵活生成参考包，并可导出
          Excel。文件不落库。
        </p>
      </div>

      <div className="glass-card max-w-3xl space-y-4 p-4">
        <div className="space-y-1">
          <Label>报告模板（.docx，尽量通用）</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] || null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              选择文件
            </Button>
            <span className="text-[12px] text-[#6b6b6b]">
              {file ? file.name : "未选择文件"}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <Label>目标规格（自由文本，可多行）</Label>
          <textarea
            className="min-h-[96px] w-full rounded-md border border-black/[0.1] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#f54e00]/40"
            value={specs}
            onChange={(e) => setSpecs(e.target.value)}
            placeholder={"例如：\nZC-YGG-0.6/1KV 3*120+2*70\nZC-KGGP-750V 10*1.5"}
          />
        </div>

        {error ? <p className="text-[13px] text-red-600">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={loading} onClick={() => void onGenerate()}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {loading ? "生成中…" : "生成参考包"}
          </Button>
          {hasResult ? (
            <Button
              variant="outline"
              disabled={exporting || loading}
              onClick={() => void onExport()}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              导出 Excel
            </Button>
          ) : null}
        </div>

        {loading || progress === "done" ? (
          <div className="rounded-md border border-black/[0.08] bg-[#fafaf8] px-3 py-3">
            <div className="mb-2 flex items-center justify-between text-[12px] text-[#6b6b6b]">
              <span>{loading ? "正在处理" : "已完成"}</span>
              <span>已用时 {formatElapsed(elapsed)}</span>
            </div>
            <ul className="space-y-2">
              {PROGRESS_STEPS.map((s) => {
                const st = stepStatus(s.key);
                return (
                  <li key={s.key} className="flex items-center gap-2 text-[13px]">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                        st === "done" && "border-[#067647] bg-[#ecfdf3] text-[#067647]",
                        st === "active" && "border-[#f54e00] bg-[#fff1eb] text-[#f54e00]",
                        st === "wait" && "border-black/15 text-[#8a8a8a]",
                      )}
                    >
                      {st === "done" ? (
                        <Check className="h-3 w-3" />
                      ) : st === "active" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "·"
                      )}
                    </span>
                    <span
                      className={cn(
                        st === "active" && "font-medium text-[#26251e]",
                        st === "wait" && "text-[#8a8a8a]",
                        st === "done" && "text-[#067647]",
                      )}
                    >
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {loading && progress === "ai" ? (
              <p className="mt-2 text-[11px] text-[#8a8a8a]">
                AI 分析通常需要 1～3 分钟，请勿关闭页面。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasResult && pack ? (
        <div className="space-y-5">
          {pack.summary ? (
            <p className="flex items-start gap-2 text-[13px] text-[#26251e]">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[#f54e00]" />
              <span>{pack.summary}</span>
            </p>
          ) : null}

          {pack.warnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <p className="mb-1 font-medium">重要提醒</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {pack.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {pack.matches.length > 0 ? (
            <Section title="建议套用哪一份样例">
              <SimpleTable
                headers={["目标规格", "样例报告编号", "样例原规格", "原因"]}
                rows={pack.matches.map((m) => [
                  m.target_spec,
                  m.base_report_no,
                  m.base_spec,
                  m.reason,
                ])}
              />
            </Section>
          ) : null}

          {(pack.relative_diffs?.length || 0) > 0 ? (
            <Section title="相对原模版改了什么（关键）">
              <SimpleTable
                headers={["规格", "改动点", "原样例", "现在怎么改", "原因"]}
                rows={(pack.relative_diffs || []).map((d) => [
                  d.target_spec,
                  d.aspect,
                  d.old_value,
                  d.new_value,
                  d.reason,
                ])}
                highlightCol={3}
              />
            </Section>
          ) : null}

          {pack.changes.length > 0 ? (
            <Section title="修改说明">
              <SimpleTable
                headers={["目标规格", "位置", "原内容", "建议改为", "必须改", "备注"]}
                rows={pack.changes.map((c) => [
                  c.target_spec,
                  c.position,
                  c.old_value,
                  c.new_value,
                  c.must_change,
                  c.note,
                ])}
                highlightCol={3}
              />
            </Section>
          ) : null}

          {pack.test_items.length > 0 ? (
            <Section title="检验项目表（示例草稿）">
              <SimpleTable
                headers={[
                  "目标规格",
                  "序号",
                  "检验项目",
                  "单位",
                  "技术要求",
                  "结果草稿",
                  "评定",
                  "说明",
                ]}
                rows={pack.test_items.map((t) => [
                  t.target_spec,
                  t.seq,
                  t.item,
                  t.unit,
                  t.requirement,
                  t.result_draft,
                  t.rating,
                  t.note,
                ])}
              />
              <p className="mt-2 text-[11px] text-[#8a8a8a]">
                「结果草稿」仅为格式示例，正式报告必须换成实验室实测值。导出 Excel
                时会按规格拆成独立工作表。
              </p>
            </Section>
          ) : null}

          {pack.key_params.length > 0 ? (
            <Section title="关键参数参考">
              <SimpleTable
                headers={["目标规格", "项目", "常用参考值", "说明"]}
                rows={pack.key_params.map((k) => [
                  k.target_spec,
                  k.param,
                  k.ref_value,
                  k.note,
                ])}
              />
            </Section>
          ) : null}

          {pack.steps.length > 0 ? (
            <Section title="操作步骤">
              <ol className="list-decimal space-y-1 pl-5 text-[12px] text-[#26251e]">
                {pack.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-[14px] font-semibold text-[#26251e]">{title}</h2>
      {children}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  highlightCol,
}: {
  headers: string[];
  rows: string[][];
  highlightCol?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/[0.08]">
      <table className="min-w-full text-left text-[12px]">
        <thead className="bg-[#f7f7f4] text-[#6b6b6b]">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-black/[0.06] align-top">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    j === highlightCol
                      ? "px-3 py-2 max-w-[240px] break-words text-[#067647]"
                      : "px-3 py-2 max-w-[240px] break-words text-[#26251e]"
                  }
                >
                  {cell || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
