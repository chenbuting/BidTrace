import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  generateReportSpecRef,
  type ReportSpecRefItem,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** 检验报告规格修改参考：上传模板 + 目标规格 → AI 参考表 */
export function ReportSpecPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [specs, setSpecs] = useState(
    "ZC-YGG-0.6/1KV 3*120+2*70\nZC-KGGP-750V 10*1.5",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [items, setItems] = useState<ReportSpecRefItem[]>([]);

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
    setSummary("");
    setWarnings([]);
    setItems([]);
    try {
      const data = await generateReportSpecRef(file, specs.trim());
      setSummary(data.summary || "");
      setWarnings(data.warnings || []);
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">
          报告规格辅助
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          上传上缆所类检验报告 Word（.docx），填写目标规格，AI 给出字段/数值修改参考表。文件仅用于本次分析，不会保存在服务器。
        </p>
      </div>

      <div className="glass-card max-w-3xl space-y-4 p-4">
        <div className="space-y-1">
          <Label>报告模板（.docx）</Label>
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

        <Button disabled={loading} onClick={() => void onGenerate()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {loading ? "生成中…" : "生成参考表"}
        </Button>
      </div>

      {summary || items.length > 0 ? (
        <div className="space-y-3">
          {summary ? (
            <p className="flex items-start gap-2 text-[13px] text-[#26251e]">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[#f54e00]" />
              <span>{summary}</span>
            </p>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <p className="mb-1 font-medium">注意</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-black/[0.08]">
            <table className="min-w-full text-left text-[12px]">
              <thead className="bg-[#f7f7f4] text-[#6b6b6b]">
                <tr>
                  <th className="px-3 py-2 font-medium">报告编号</th>
                  <th className="px-3 py-2 font-medium">字段</th>
                  <th className="px-3 py-2 font-medium">原值</th>
                  <th className="px-3 py-2 font-medium">建议新值</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-t border-black/[0.06] align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-[#6b6b6b]">
                      {row.report_no || "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-[#26251e]">{row.field || "—"}</td>
                    <td className="px-3 py-2 max-w-[220px] break-words text-[#6b6b6b]">
                      {row.old_value || "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[220px] break-words text-[#067647]">
                      {row.new_value || "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[240px] break-words text-[#6b6b6b]">
                      {row.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[#8a8a8a]">
            以上为 AI 参考，电阻/厚度等请按对应标准复核后再改正式报告。
          </p>
        </div>
      ) : null}
    </div>
  );
}
