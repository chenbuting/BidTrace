import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  fetchBidProjectCalendar,
  type BidProjectCalendar,
  type CalendarProjectItem,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { can, cn } from "@/lib/utils";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 投标员固定色板（语义色，非紫色系） */
const BIDDER_COLORS = [
  "#26251e",
  "#1d4ed8",
  "#067647",
  "#b54708",
  "#b42318",
  "#4b5563",
  "#0f766e",
  "#9a3412",
];

function bidderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BIDDER_COLORS[h % BIDDER_COLORS.length];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDay(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function todayIso(): string {
  const t = new Date();
  return isoDay(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** 构建月历格子：周一为一周起始 */
function buildMonthCells(year: number, month: number): { date: string | null; day: number | null }[] {
  const first = new Date(year, month - 1, 1);
  // JS: 0=周日 … 6=周六 → 转成周一=0
  const weekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: { date: string | null; day: number | null }[] = [];
  for (let i = 0; i < weekday; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: isoDay(year, month, d), day: d });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

/** 开标日历：按投标员 + 开标时间看排班 */
export function CalendarPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bidder, setBidder] = useState("");
  const [data, setData] = useState<BidProjectCalendar | null>(null);
  const [selected, setSelected] = useState<string>(todayIso());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const canView = can(user?.permissions, "calendar.view");

  const load = (y = year, m = month, b = bidder) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    fetchBidProjectCalendar(y, m, b)
      .then((res) => {
        setData(res);
        // 若当前选中日不在本月，默认选本月有数据的第一天或 1 号
        const selMonth = `${y}-${pad2(m)}-`;
        setSelected((prev) => {
          if (prev.startsWith(selMonth)) return prev;
          const firstBusy = res.days[0]?.date;
          return firstBusy || isoDay(y, m, 1);
        });
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "加载日历失败");
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const dayMeta = useMemo(() => {
    const map = new Map<string, { count: number; bidders: string[] }>();
    for (const d of data?.days || []) map.set(d.date, { count: d.count, bidders: d.bidders });
    return map;
  }, [data]);

  const selectedItems: CalendarProjectItem[] = data?.by_date?.[selected] || [];

  const shiftMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
    load(y, m, bidder);
  };

  const onBidderChange = (v: string) => {
    setBidder(v);
    load(year, month, v);
  };

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-[13px] text-[#6b6b6b]">没有查看开标日历的权限。</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">开标日历</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">按开标时间与投标员查看排班分布</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
            上月
          </Button>
          <span className="min-w-[110px] text-center text-[14px] font-semibold tabular-nums text-[#26251e]">
            {year} 年 {month} 月
          </span>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>
            下月
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const t = new Date();
              const y = t.getFullYear();
              const m = t.getMonth() + 1;
              setYear(y);
              setMonth(m);
              setSelected(todayIso());
              load(y, m, bidder);
            }}
          >
            本月
          </Button>
          <label className="flex items-center gap-2 text-[12px] text-[#6b6b6b]">
            投标员
            <select
              className="h-8 min-w-[120px] rounded-lg border border-black/[0.12] bg-white px-2 text-[13px] text-[#26251e]"
              value={bidder}
              onChange={(e) => onBidderChange(e.target.value)}
            >
              <option value="">全部</option>
              {(data?.bidders || []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-[12px] text-[#6b6b6b]">
        <span className="rounded-lg border border-black/[0.08] bg-white px-3 py-1.5">
          本月开标 <strong className="text-[#26251e]">{data?.month_total ?? "—"}</strong> 条
        </span>
        <span className="rounded-lg border border-black/[0.08] bg-white px-3 py-1.5">
          无开标时间 <strong className="text-[#b54708]">{data?.unscheduled_count ?? "—"}</strong> 条（不进日历）
        </span>
        {data && data.month_total === 0 && data.suggest ? (
          <button
            type="button"
            className="rounded-lg border border-[#1d4ed8]/30 bg-[#1d4ed8]/[0.06] px-3 py-1.5 text-[#1d4ed8] hover:bg-[#1d4ed8]/10"
            onClick={() => {
              const y = data.suggest!.year;
              const m = data.suggest!.month;
              setYear(y);
              setMonth(m);
              load(y, m, bidder);
            }}
          >
            本月暂无，跳到最近有数据的 {data.suggest.year}-{pad2(data.suggest.month)}
          </button>
        ) : null}
        {loading ? <span>加载中…</span> : null}
        {error ? <span className="text-red-600">{error}</span> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <div className="rounded-xl border border-black/[0.08] bg-white p-3 sm:p-4">
          <div className="mb-2 grid grid-cols-7 gap-1">
            {WEEK_LABELS.map((w) => (
              <div key={w} className="py-1 text-center text-[12px] font-medium text-[#6b6b6b]">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              if (!cell.date) {
                return <div key={`e-${idx}`} className="min-h-[84px] rounded-lg bg-transparent" />;
              }
              const meta = dayMeta.get(cell.date);
              const count = meta?.count || 0;
              const isSel = selected === cell.date;
              const isToday = cell.date === todayIso();
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelected(cell.date!)}
                  className={cn(
                    "flex min-h-[84px] flex-col rounded-lg border px-1.5 py-1.5 text-left transition",
                    isSel
                      ? "border-[#26251e] bg-[#26251e]/[0.06] ring-1 ring-[#26251e]/20"
                      : "border-black/[0.06] bg-white hover:border-black/[0.14]",
                    isToday && !isSel && "border-[#1d4ed8]/40",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums",
                        isToday ? "bg-[#1d4ed8] text-white" : "text-[#26251e]",
                      )}
                    >
                      {cell.day}
                    </span>
                    {count > 0 ? (
                      <span className="rounded-full bg-black/[0.06] px-1.5 text-[10px] font-medium tabular-nums text-[#26251e]">
                        {count}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-auto space-y-0.5 overflow-hidden">
                    {(meta?.bidders || []).slice(0, 3).map((b) => (
                      <div key={b} className="flex items-center gap-1 truncate">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: bidderColor(b) }} />
                        <span className="truncate text-[10px] text-[#4a4a4a]">{b}</span>
                      </div>
                    ))}
                    {(meta?.bidders.length || 0) > 3 ? (
                      <p className="text-[10px] text-[#8a8a8a]">+{(meta?.bidders.length || 0) - 3}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#26251e]">
            {selected} · {selectedItems.length} 条开标
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6b6b6b]">点日历日期查看当天排班明细</p>

          {selectedItems.length === 0 ? (
            <p className="mt-6 text-center text-[13px] text-[#8a8a8a]">这一天没有开标安排</p>
          ) : (
            <ul className="mt-3 max-h-[560px] space-y-2.5 overflow-y-auto pr-1">
              {selectedItems.map((item) => (
                <li key={item.id} className="rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2.5">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-[#26251e]">
                      {item.project_name || "（无项目名）"}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                      style={{ background: bidderColor(item.bidder) }}
                    >
                      {item.bidder}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#6b6b6b]">
                    开标：{item.open_time_raw || item.open_time || "—"}
                  </p>
                  <p className="text-[12px] text-[#6b6b6b]">平台：{item.platform || "—"}</p>
                  <p className="mt-0.5 text-[12px] text-[#6b6b6b]">
                    结果：
                    {item.is_void === "是"
                      ? "废标"
                      : item.is_won === "是"
                        ? "中标"
                        : item.is_won === "否"
                          ? "未中标"
                          : "未标注"}
                  </p>
                  {item.remark ? <p className="mt-1 text-[11px] text-[#8a8a8a]">备注：{item.remark}</p> : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-black/[0.06] pt-3">
            <Link to="/projects" className="text-[12px] font-medium text-[#1d4ed8] hover:underline">
              去投标项目台账 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
