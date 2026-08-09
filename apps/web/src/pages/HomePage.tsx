import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  ScrollText,
  Users,
  Wallet,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { fetchDashboard, type Dashboard, type UserInfo } from "@/api/bidtrace";
import { can, cn } from "@/lib/utils";

/** YYYY-MM-DD → 08-04 */
function shortDate(iso: string): string {
  if (iso.length >= 10) return iso.slice(5, 10);
  return iso;
}

function todayLabel(): string {
  const d = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week}`;
}

type StatCard = {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  tone: "neutral" | "green" | "amber" | "orange" | "slate";
};

const TONE: Record<StatCard["tone"], { wrap: string; icon: string }> = {
  neutral: { wrap: "bg-[#f7f7f4]", icon: "text-[#6b6b6b]" },
  green: { wrap: "bg-[#ecfdf3]", icon: "text-[#067647]" },
  amber: { wrap: "bg-[#fffaeb]", icon: "text-[#b54708]" },
  orange: { wrap: "bg-[#fff1eb]", icon: "text-[#f54e00]" },
  slate: { wrap: "bg-[#f4f4f5]", icon: "text-[#3f3f46]" },
};

type QuickLink = {
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  show: boolean;
};

/** 首页总览 */
export function HomePage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const [stats, setStats] = useState<Dashboard | null>(null);

  useEffect(() => {
    void fetchDashboard().then(setStats).catch(() => setStats(null));
  }, []);

  const cards: StatCard[] = [
    {
      label: "平台总数",
      value: stats?.platform_total ?? "—",
      hint: "已登记平台",
      icon: Waypoints,
      tone: "neutral",
    },
    {
      label: "启用平台",
      value: stats?.platform_active ?? "—",
      hint: "可正常使用",
      icon: CheckCircle2,
      tone: "green",
    },
    {
      label: "维护中",
      value: stats?.platform_maintain ?? "—",
      hint: "暂不可用",
      icon: Wrench,
      tone: "amber",
    },
    {
      label: "询标记录",
      value: stats?.inquiry_total ?? "—",
      hint: "台账累计",
      icon: ClipboardList,
      tone: "slate",
    },
    {
      label: "已投标",
      value: stats?.inquiry_bid_yes ?? "—",
      hint: "意向为「是」",
      icon: FolderKanban,
      tone: "orange",
    },
  ];

  const chartData = useMemo(
    () =>
      [...(stats?.recent_by_date || [])]
        .slice()
        .reverse()
        .map((r) => ({ date: shortDate(r.date), count: r.count, full: r.date })),
    [stats],
  );

  const quickLinks: QuickLink[] = [
    {
      to: "/platforms",
      label: "平台账号",
      desc: "登录与状态",
      icon: Waypoints,
      show: can(user?.permissions, "platform.view"),
    },
    {
      to: "/charts",
      label: "数据看板",
      desc: "趋势与结构",
      icon: LayoutDashboard,
      show: true,
    },
    {
      to: "/projects",
      label: "投标项目",
      desc: "项目进展",
      icon: FolderKanban,
      show: can(user?.permissions, "project.view"),
    },
    {
      to: "/calendar",
      label: "开标日历",
      desc: "近期开标",
      icon: CalendarDays,
      show: can(user?.permissions, "calendar.view"),
    },
    {
      to: "/deposits",
      label: "投标保证金",
      desc: "缴纳与退回",
      icon: Wallet,
      show: can(user?.permissions, "deposit.view"),
    },
    {
      to: "/inquiries",
      label: "询标报名",
      desc: "台账登记",
      icon: ClipboardList,
      show: can(user?.permissions, "inquiry.view_all") || can(user?.permissions, "inquiry.view_own"),
    },
    {
      to: "/weekly",
      label: "工作周报",
      desc: "本周汇报",
      icon: ScrollText,
      show: can(user?.permissions, "weekly.view_all") || can(user?.permissions, "weekly.view_own"),
    },
    {
      to: "/notifications",
      label: "站内通知",
      desc: "消息提醒",
      icon: Bell,
      show: can(user?.permissions, "notify.view"),
    },
    {
      to: "/users",
      label: "用户权限",
      desc: "账号与角色",
      icon: Users,
      show:
        can(user?.permissions, "system.users.view") ||
        can(user?.permissions, "system.roles") ||
        can(user?.permissions, "system.permissions"),
    },
    {
      to: "/audit",
      label: "操作日志",
      desc: "审计记录",
      icon: ScrollText,
      show: can(user?.permissions, "system.audit"),
    },
  ].filter((x) => x.show);

  const name = user?.display_name || "同事";

  return (
    <div className="space-y-5 p-5 md:p-6">
      {/* 问候区 */}
      <div className="relative overflow-hidden rounded-2xl border border-black/[0.08] bg-white px-5 py-5 md:px-6">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-[#f54e00]/[0.08]" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-20 w-48 rounded-full bg-[#26251e]/[0.03]" />
        <p className="text-[12px] text-[#6b6b6b]">{todayLabel()}</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-[#26251e]">
          你好，{name}
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          {user?.role_label || "成员"} · 一览平台与询标概况，从这里快速进入常用功能
        </p>
      </div>

      {/* 指标 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => {
          const Icon = c.icon;
          const tone = TONE[c.tone];
          return (
            <div key={c.label} className="glass-card px-4 py-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] text-[#6b6b6b]">{c.label}</p>
                <span className={cn("inline-flex rounded-lg p-1.5", tone.wrap)}>
                  <Icon className={cn("h-3.5 w-3.5", tone.icon)} />
                </span>
              </div>
              <p className="mt-2 text-[26px] font-semibold tracking-tight text-[#26251e] tabular-nums">
                {c.value}
              </p>
              {c.hint ? <p className="mt-1 text-[11px] text-[#8a8a8a]">{c.hint}</p> : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 最近报名趋势 */}
        <div className="glass-card p-4 lg:col-span-3">
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold text-[#26251e]">最近报名趋势</h2>
              <p className="mt-0.5 text-[12px] text-[#6b6b6b]">按报名日期统计近期条数</p>
            </div>
            {stats?.inquiry_total != null ? (
              <Link to="/inquiries" className="text-[12px] font-medium text-[#f54e00] hover:underline">
                查看询标 →
              </Link>
            ) : null}
          </div>
          {chartData.length === 0 ? (
            <p className="flex min-h-[220px] items-center justify-center text-[13px] text-[#8a8a8a]">
              暂无数据，可先导入询标 Excel
            </p>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#6b6b6b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6b6b6b" }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(245,78,0,0.06)" }}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.08)",
                      fontSize: 12,
                    }}
                    labelFormatter={(_, payload) => {
                      const full = payload?.[0]?.payload?.full;
                      return full ? String(full) : "";
                    }}
                    formatter={(value: number) => [`${value} 条`, "报名"]}
                  />
                  <Bar dataKey="count" fill="#f54e00" radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 快捷入口 */}
        <div className="glass-card p-4 lg:col-span-2">
          <h2 className="text-[14px] font-semibold text-[#26251e]">快捷入口</h2>
          <p className="mt-0.5 text-[12px] text-[#6b6b6b]">按权限显示可用模块</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 py-3 transition-colors hover:border-[#f54e00]/40 hover:bg-[#fff7f3]"
                >
                  <span className="inline-flex rounded-lg bg-white p-1.5 text-[#26251e] shadow-sm ring-1 ring-black/[0.06] group-hover:text-[#f54e00]">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <p className="mt-2 text-[13px] font-medium text-[#26251e]">{item.label}</p>
                  <p className="text-[11px] text-[#8a8a8a]">{item.desc}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
