import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Image as ImageIcon, X } from "lucide-react";

import { ApiError } from "@/api/client";
import { fetchInquiryDailyReport, type InquiryDailyReport } from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 打开时默认日期 */
  initialDate?: string;
  canExport: boolean;
};

function formatCnDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function nowLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 询标单日汇报图：预览 + 导出 PNG */
export function InquiryDailyReportDialog({ open, onClose, initialDate, canExport }: Props) {
  const [day, setDay] = useState(initialDate || todayIso());
  const [data, setData] = useState<InquiryDailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDay(initialDate || todayIso());
  }, [open, initialDate]);

  useEffect(() => {
    if (!open || !day) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchInquiryDailyReport(day)
      .then((res) => {
        if (!cancelled) setData(res.item);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof ApiError ? e.message : "加载日报失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, day]);

  if (!open) return null;

  const maxPlat = Math.max(...(data?.platforms.map((p) => p.count) || [1]), 1);

  const onDownload = async () => {
    if (!cardRef.current || !data || !canExport) return;
    setExporting(true);
    setError("");
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#f7f7f4",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `询标日报-${data.date}.png`;
      a.click();
    } catch {
      setError("生成图片失败，请重试");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[#26251e]">导出询标日报图</h3>
            <p className="mt-0.5 text-[12px] text-[#6b6b6b]">按报名日汇总，生成给领导看的 PNG 图片</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateInput value={day} onChange={setDay} className="w-[150px]" />
            {canExport ? (
              <Button disabled={loading || exporting || !data} onClick={() => void onDownload()}>
                <Download className="h-3.5 w-3.5" />
                {exporting ? "生成中…" : "下载 PNG"}
              </Button>
            ) : (
              <span className="text-[12px] text-[#b54708]">无导出权限</span>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} title="关闭">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[#ecece8] px-4 py-4">
          {error ? <p className="mb-3 text-[12px] text-red-600">{error}</p> : null}
          {loading ? (
            <p className="py-16 text-center text-[13px] text-[#6b6b6b]">加载中…</p>
          ) : data ? (
            <div className="mx-auto w-full max-w-[920px]">
              <div
                ref={cardRef}
                className="overflow-hidden rounded-2xl border border-black/[0.08] bg-[#f7f7f4] text-[#26251e]"
                style={{ fontFamily: '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif' }}
              >
                {/* 头图 */}
                <div className="relative overflow-hidden bg-[#26251e] px-7 py-6 text-white">
                  <div className="pointer-events-none absolute -right-6 -top-10 h-40 w-40 rounded-full bg-[#f54e00]/30" />
                  <div className="pointer-events-none absolute bottom-0 right-24 h-24 w-56 rounded-full bg-white/5" />
                  <p className="text-[12px] text-white/65">BidTrace · 询标报名</p>
                  <h2 className="mt-1 text-[26px] font-semibold tracking-tight">询标工作日报</h2>
                  <p className="mt-1 text-[14px] text-white/80">{formatCnDate(data.date)}</p>
                </div>

                <div className="space-y-4 px-6 py-5">
                  {/* KPI */}
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                    {[
                      { label: "今日新增", value: data.total, tone: "text-[#26251e]", hot: false },
                      { label: "投标·是", value: data.bid_yes, tone: "text-[#f54e00]", hot: false },
                      { label: "投标·否", value: data.bid_no, tone: "text-[#6b6b6b]", hot: false },
                      { label: "待确定", value: data.bid_wait, tone: "text-[#f54e00]", hot: true },
                      { label: "未填写", value: data.bid_empty, tone: "text-[#8a8a8a]", hot: false },
                      { label: "已报名", value: data.registered, tone: "text-[#067647]", hot: false },
                    ].map((k) => (
                      <div
                        key={k.label}
                        className={cn(
                          "rounded-xl border bg-white px-3 py-3",
                          k.hot
                            ? "border-[#f54e00]/50 bg-[#fff7f3] ring-2 ring-[#f54e00]/15"
                            : "border-black/[0.08]",
                        )}
                      >
                        <p className={cn("text-[11px]", k.hot ? "font-medium text-[#b54708]" : "text-[#6b6b6b]")}>
                          {k.label}
                        </p>
                        <p className={cn("mt-1 text-[22px] font-semibold tabular-nums", k.tone)}>{k.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {/* 平台 */}
                    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                      <h3 className="text-[13px] font-semibold">平台分布</h3>
                      {data.platforms.length === 0 ? (
                        <p className="mt-6 text-center text-[12px] text-[#8a8a8a]">当日暂无数据</p>
                      ) : (
                        <ul className="mt-3 space-y-2.5">
                          {data.platforms.map((p) => {
                            const pct = Math.max(4, Math.round((p.count / maxPlat) * 100));
                            return (
                              <li key={p.name}>
                                <div className="mb-1 flex justify-between gap-2 text-[12px]">
                                  <span className="truncate text-[#4a4a4a]">{p.name}</span>
                                  <span className="shrink-0 font-medium tabular-nums">{p.count}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                                  <div className="h-full rounded-full bg-[#f54e00]" style={{ width: `${pct}%` }} />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* 流程节点 */}
                    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                      <h3 className="text-[13px] font-semibold">流程完成情况</h3>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          { label: "已报名", value: data.registered },
                          { label: "已领文件", value: data.file_ok },
                          { label: "已缴费", value: data.paid_ok },
                          { label: "概况完成", value: data.overview_ok },
                        ].map((x) => (
                          <div key={x.label} className="rounded-lg bg-[#f7f7f4] px-3 py-3">
                            <p className="text-[11px] text-[#6b6b6b]">{x.label}</p>
                            <p className="mt-1 text-[20px] font-semibold tabular-nums">
                              {x.value}
                              <span className="ml-1 text-[11px] font-normal text-[#8a8a8a]">/ {data.total}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] leading-relaxed text-[#6b6b6b]">
                        待确定：共 {data.follow_total} 条（本日 {data.follow_today_total ?? 0} · 此前未结{" "}
                        {data.follow_carryover_total ?? 0}）；拟投标：{data.bid_yes_total} 条；未投标：
                        {data.bid_no_total ?? data.bid_no} 条
                      </p>
                    </div>
                  </div>

                  {/* 待确定：当天 + 历史延续，样式醒目但措辞自然 */}
                  <div className="rounded-xl border-2 border-[#f54e00]/40 bg-[#fff7f3] p-4">
                    <h3 className="text-[14px] font-semibold text-[#26251e]">
                      待确定项目
                      <span className="ml-2 text-[12px] font-normal text-[#6b6b6b]">
                        共 {data.follow_total} 条
                        {typeof data.follow_today_total === "number" ||
                        typeof data.follow_carryover_total === "number"
                          ? `（本日 ${data.follow_today_total ?? 0} · 此前未结 ${data.follow_carryover_total ?? 0}）`
                          : ""}
                      </span>
                    </h3>
                    <p className="mt-1 text-[11px] text-[#6b6b6b]">
                      投标意向尚待明确的项目一览（含报名日与说明）
                    </p>
                    {data.follow_items.length === 0 ? (
                      <p className="mt-3 text-[12px] text-[#8a8a8a]">本日暂无待确定项目</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {data.follow_items.map((it, idx) => (
                          <li
                            key={`wait-${it.project_name}-${idx}`}
                            className="rounded-lg border border-[#f54e00]/20 bg-white px-3 py-2.5 text-[12px]"
                          >
                            <div className="flex gap-2">
                              <span className="w-4 shrink-0 font-medium text-[#8a8a8a]">{idx + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <p className="font-semibold text-[#26251e]">
                                    {it.project_name || "（未填项目名）"}
                                  </p>
                                  {it.is_carryover ? (
                                    <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[10px] text-[#6b6b6b]">
                                      此前未结
                                    </span>
                                  ) : (
                                    <span className="rounded bg-[#fff1eb] px-1.5 py-0.5 text-[10px] text-[#b54708]">
                                      本日
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[11px] text-[#6b6b6b]">
                                  报名日：{it.register_date || "—"} · {it.platform_name || "未填平台"} · 报名：
                                  {it.is_registered} · 截止：{it.deadline}
                                </p>
                                {it.reason_text ? (
                                  <p className="mt-1 text-[12px] text-[#4a4a4a]">说明：{it.reason_text}</p>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 拟投标 */}
                  <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                    <h3 className="text-[13px] font-semibold">
                      拟投标项目
                      <span className="ml-2 text-[11px] font-normal text-[#8a8a8a]">
                        是否投标=是（共 {data.bid_yes_items.length} 条）
                      </span>
                    </h3>
                    {data.bid_yes_items.length === 0 ? (
                      <p className="mt-3 text-[12px] text-[#8a8a8a]">当日暂无明确拟投标项目</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-black/[0.05]">
                        {data.bid_yes_items.map((it, idx) => (
                          <li key={`yes-${it.project_name}-${idx}`} className="flex gap-3 py-2 text-[12px]">
                            <span className="w-4 shrink-0 text-[#8a8a8a]">{idx + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-[#26251e]">{it.project_name || "（未填项目名）"}</p>
                              <p className="mt-0.5 text-[11px] text-[#6b6b6b]">
                                {it.platform_name || "未填平台"} · 报名：{it.is_registered} · 截止：{it.deadline}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 未投标：当天全部列出 */}
                  <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                    <h3 className="text-[13px] font-semibold">
                      未投标项目
                      <span className="ml-2 text-[11px] font-normal text-[#8a8a8a]">
                        是否投标=否（共 {data.bid_no_items?.length ?? 0} 条，全部列出）
                      </span>
                    </h3>
                    {(data.bid_no_items?.length ?? 0) === 0 ? (
                      <p className="mt-3 text-[12px] text-[#8a8a8a]">当日暂无未投标项目</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-black/[0.05]">
                        {(data.bid_no_items || []).map((it, idx) => (
                          <li key={`no-${it.project_name}-${idx}`} className="flex gap-3 py-2 text-[12px]">
                            <span className="w-4 shrink-0 text-[#8a8a8a]">{idx + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-[#26251e]">{it.project_name || "（未填项目名）"}</p>
                              <p className="mt-0.5 text-[11px] text-[#6b6b6b]">
                                {it.platform_name || "未填平台"} · 报名：{it.is_registered} · 截止：{it.deadline}
                              </p>
                              <p className="mt-1 text-[12px] text-[#4a4a4a]">
                                原因：{it.reason_text || "台账未填写原因"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-black/[0.06] pt-3 text-[11px] text-[#8a8a8a]">
                    <span>数据来源：询标报名台账（按报名日）</span>
                    <span>导出时间：{nowLabel()}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="py-16 text-center text-[13px] text-[#6b6b6b]">暂无数据</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-5 py-3">
          <p className="flex items-center gap-1.5 text-[12px] text-[#6b6b6b]">
            <ImageIcon className="h-3.5 w-3.5" />
            建议发给领导前先预览核对数字
          </p>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
