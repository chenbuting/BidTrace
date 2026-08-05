import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { fetchDashboard, type Dashboard, type UserInfo } from "@/api/bidtrace";
import { can } from "@/lib/utils";

/** 首页总览 */
export function HomePage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const [stats, setStats] = useState<Dashboard | null>(null);

  useEffect(() => {
    void fetchDashboard().then(setStats).catch(() => setStats(null));
  }, []);

  const cards = [
    { label: "平台总数", value: stats?.platform_total ?? "—" },
    { label: "启用平台", value: stats?.platform_active ?? "—" },
    { label: "维护中", value: stats?.platform_maintain ?? "—" },
    { label: "询标记录", value: stats?.inquiry_total ?? "—" },
    { label: "已投标", value: stats?.inquiry_bid_yes ?? "—" },
  ];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">总览</h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          你好，{user?.display_name || "同事"} · {user?.role_label}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="glass-card px-4 py-3.5">
            <p className="text-[12px] text-[#6b6b6b]">{c.label}</p>
            <p className="mt-1 text-[22px] font-semibold tracking-tight text-[#26251e]">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="glass-card p-4">
          <h2 className="text-[14px] font-semibold text-[#26251e]">最近报名日期</h2>
          <ul className="mt-3 space-y-2">
            {(stats?.recent_by_date || []).length === 0 ? (
              <li className="text-[13px] text-[#6b6b6b]">暂无数据，可先导入询标 Excel</li>
            ) : (
              stats!.recent_by_date.map((r) => (
                <li key={r.date} className="flex justify-between text-[13px]">
                  <span className="text-[#4a4a4a]">{r.date}</span>
                  <span className="font-medium text-[#26251e]">{r.count} 条</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="glass-card p-4">
          <h2 className="text-[14px] font-semibold text-[#26251e]">快捷入口</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {can(user?.permissions, "platform.view") ? (
              <Link
                to="/platforms"
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
              >
                平台账号
              </Link>
            ) : null}
            <Link
              to="/charts"
              className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
            >
              数据看板
            </Link>
            {can(user?.permissions, "project.view") ? (
              <Link
                to="/projects"
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
              >
                投标项目
              </Link>
            ) : null}
            {can(user?.permissions, "deposit.view") ? (
              <Link
                to="/deposits"
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
              >
                投标保证金
              </Link>
            ) : null}
            {can(user?.permissions, "inquiry.view_all") || can(user?.permissions, "inquiry.view_own") ? (
              <Link
                to="/inquiries"
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
              >
                询标报名
              </Link>
            ) : null}
            {can(user?.permissions, "system.users") ? (
              <Link
                to="/users"
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-[#26251e] hover:border-black/[0.16]"
              >
                用户权限
              </Link>
            ) : null}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-[#6b6b6b]">
            平台账号、投标项目、投标保证金、询标报名与权限管理。
          </p>
        </div>
      </div>
    </div>
  );
}
