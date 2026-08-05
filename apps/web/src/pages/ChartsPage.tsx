import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";

import {
  fetchDashboardCharts,
  type ChartNamedValue,
  type DashboardCharts,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PIE_COLORS = ["#26251e", "#4b5563", "#78716c", "#a8a29e", "#d6d3d1", "#b54708", "#067647", "#1d4ed8"];

/** YYYY-MM-DD → 08-05 */
function shortDate(iso: string): string {
  if (iso.length >= 10) return iso.slice(5, 10);
  return iso;
}

function ChartPanel({
  title,
  hint,
  children,
  empty,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  empty?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-black/[0.08] bg-white p-4", className)}>
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-[#26251e]">{title}</h3>
        {hint ? <p className="mt-0.5 text-[12px] text-[#6b6b6b]">{hint}</p> : null}
      </div>
      {empty ? (
        <p className="flex min-h-[180px] items-center justify-center text-[13px] text-[#8a8a8a]">暂无数据</p>
      ) : (
        children
      )}
    </div>
  );
}

/** 自定义排名条（对齐采集中心，避免横向柱图遮挡长名称） */
function RankBars({
  items,
  barClass = "bg-[#26251e]",
  valueLabel,
}: {
  items: ChartNamedValue[];
  barClass?: string;
  valueLabel?: string;
}) {
  const max = Math.max(...items.map((x) => x.count), 1);
  return (
    <ul className="max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
      {items.map((item, idx) => {
        const pct = Math.max(2, Math.round((item.count / max) * 100));
        return (
          <li key={`${item.name}-${idx}`} className="min-w-0">
            <div className="mb-1 flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 break-all text-[12px] leading-snug text-[#26251e]" title={item.name}>
                <span className="mr-1.5 inline-block w-4 shrink-0 text-[11px] text-[#8a8a8a]">{idx + 1}</span>
                {item.name}
              </p>
              <div className="shrink-0 text-right text-[12px] tabular-nums text-[#26251e]">
                <span className="font-semibold">{item.count}</span>
                {valueLabel ? <span className="ml-0.5 text-[11px] text-[#8a8a8a]">{valueLabel}</span> : null}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/[0.06]">
              <div className={cn("h-full rounded-full transition-all", barClass)} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SoftTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-black/[0.08] bg-white/95 px-2.5 py-2 text-[12px] shadow-sm backdrop-blur-sm">
      {label ? <p className="mb-1 font-medium text-[#26251e]">{label}</p> : null}
      {payload.map((p, i) => (
        <p key={i} className="text-[#6b6b6b]">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: p.color || "#26251e" }} />
          {p.name}：{p.value}
        </p>
      ))}
    </div>
  );
}

function Donut({ data }: { data: ChartNamedValue[] }) {
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="48%"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<SoftTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 数据看板：对齐采集中心布局（筛选 + KPI + 折线/环图/排行） */
export function ChartsPage() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<DashboardCharts | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = (span = days) => {
    setLoading(true);
    setError("");
    fetchDashboardCharts(span)
      .then(setData)
      .catch((e: Error) => {
        setError(e.message || "加载图表失败");
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = data?.totals;
  const trendData = useMemo(
    () =>
      (data?.inquiry_trend || []).map((d) => ({
        ...d,
        label: shortDate(d.date),
      })),
    [data],
  );

  const hasTrend = trendData.some((d) => d.total > 0);
  const inquiryBid = data?.inquiry_bid || [];
  const projectResult = data?.project_result || [];
  const depositReturn = data?.deposit_return || [];
  const platformStatus = data?.platform_status || [];
  const byInquiryPlatform = data?.by_inquiry_platform || [];
  const bySkipReason = data?.by_skip_reason || [];
  const byProjectBidder = data?.by_project_bidder || [];
  const byProjectPlatform = data?.by_project_platform || [];
  const byDepositPayee = data?.by_deposit_payee || [];

  const statusBars = useMemo(() => {
    const total = platformStatus.reduce((s, x) => s + x.count, 0);
    if (total <= 0) return [];
    return platformStatus.map((x) => {
      let cls = "bg-[#a8a29e]";
      if (x.name === "启用") cls = "bg-[#067647]";
      else if (x.name.includes("维护")) cls = "bg-[#b54708]";
      else if (x.name.includes("停用") || x.name.includes("禁用")) cls = "bg-[#b42318]";
      return { ...x, cls, pct: Math.round((x.count / total) * 100) };
    });
  }, [platformStatus]);

  const cards = [
    { label: "询标记录", value: totals?.inquiry_total ?? "—", hint: "全部报名" },
    { label: "已投标", value: totals?.inquiry_bid_yes ?? "—", hint: "询标里选「是」", tone: "ok" as const },
    { label: "中标项目", value: totals?.project_won ?? "—", hint: `项目共 ${totals?.project_total ?? 0}`, tone: "info" as const },
    {
      label: "保证金待退",
      value: totals?.deposit_pending ?? "—",
      hint: `保证金共 ${totals?.deposit_total ?? 0}`,
      tone: "warn" as const,
    },
  ];

  if (loading && !data) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-[13px] text-[#6b6b6b]">加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 md:p-8">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">数据看板</h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">直观看询标趋势、投标结果、保证金与平台分布</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2.5">
        <label className="flex items-center gap-2 text-[12px] text-[#6b6b6b]">
          趋势天数
          <select
            className="h-8 rounded-lg border border-black/[0.12] bg-white px-2 text-[13px] text-[#26251e]"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={60}>近 60 天</option>
            <option value={0}>全部数据</option>
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => load(days)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </Button>
        {error ? <span className="text-[12px] text-red-600">{error}</span> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-black/[0.08] bg-white px-4 py-3.5">
            <p className="text-[12px] text-[#6b6b6b]">{c.label}</p>
            <p
              className={cn(
                "mt-1 text-[22px] font-semibold tracking-tight tabular-nums",
                c.tone === "ok" && "text-[#067647]",
                c.tone === "info" && "text-[#1d4ed8]",
                c.tone === "warn" && "text-[#b54708]",
                !c.tone && "text-[#26251e]",
              )}
            >
              {c.value}
            </p>
            <p className="mt-0.5 text-[11px] text-[#8a8a8a]">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel
          title="询标报名趋势"
          hint={
            (data?.days ?? days) === 0
              ? "全部历史有数据的日期：全部 / 已投 / 未投"
              : `近 ${data?.days ?? days} 天：全部 / 已投 / 未投`
          }
          empty={!hasTrend}
        >
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b6b6b" }} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b6b6b" }} width={36} />
                <Tooltip content={<SoftTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name="全部" stroke="#26251e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bid_yes" name="已投" stroke="#067647" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bid_no" name="未投" stroke="#b42318" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        <ChartPanel title="询标：是否投标" hint="全部询标记录占比" empty={inquiryBid.length === 0}>
          <Donut data={inquiryBid} />
        </ChartPanel>

        <ChartPanel title="投标项目结果" hint="中标 / 未中标 / 废标" empty={projectResult.length === 0}>
          <Donut data={projectResult} />
        </ChartPanel>

        <ChartPanel title="保证金退回情况" hint="是否已退回" empty={depositReturn.length === 0}>
          <Donut data={depositReturn} />
        </ChartPanel>

        <ChartPanel title="平台账号状态" hint="启用 / 维护等健康度" empty={statusBars.length === 0}>
          <div className="space-y-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-black/[0.06]">
              {statusBars.map((x) => (
                <div key={x.name} className={cn("h-full", x.cls)} style={{ width: `${x.pct}%` }} title={`${x.name} ${x.count}`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {statusBars.map((x) => (
                <div key={x.name} className="rounded-lg bg-black/[0.03] px-2.5 py-2">
                  <p className="truncate text-[11px] text-[#6b6b6b]">{x.name}</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#26251e]">{x.count}</p>
                  <p className="text-[10px] text-[#8a8a8a]">{x.pct}%</p>
                </div>
              ))}
            </div>
          </div>
        </ChartPanel>

        <ChartPanel title="询标平台 Top" hint="报名最多的平台" empty={byInquiryPlatform.length === 0}>
          <RankBars items={byInquiryPlatform} barClass="bg-[#26251e]" valueLabel="条" />
        </ChartPanel>

        <ChartPanel title="未投原因 Top" hint="跳过原因类别" empty={bySkipReason.length === 0}>
          <RankBars items={bySkipReason} barClass="bg-[#b54708]" valueLabel="条" />
        </ChartPanel>

        <ChartPanel title="投标员项目量 Top" hint="投标项目按投标员" empty={byProjectBidder.length === 0}>
          <RankBars items={byProjectBidder} barClass="bg-[#1d4ed8]" valueLabel="条" />
        </ChartPanel>

        <ChartPanel title="投标项目平台 Top" hint="开标项目按平台" empty={byProjectPlatform.length === 0}>
          <RankBars items={byProjectPlatform} barClass="bg-[#4b5563]" valueLabel="条" />
        </ChartPanel>

        <ChartPanel title="保证金收款单位 Top" hint="按收款单位条数" empty={byDepositPayee.length === 0}>
          <RankBars items={byDepositPayee} barClass="bg-[#067647]" valueLabel="条" />
        </ChartPanel>
      </div>
    </div>
  );
}
