import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Users,
  Wallet,
  Waypoints,
} from "lucide-react";

import { ApiError } from "@/api/client";
import { fetchMe, logout, type UserInfo } from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { can, cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true, perm: null as string | null },
  { to: "/charts", label: "数据看板", icon: BarChart3, perm: null as string | null },
  { to: "/platforms", label: "平台账号", icon: Waypoints, perm: "platform.view" },
  { to: "/projects", label: "投标项目", icon: FolderKanban, perm: "project.view" },
  { to: "/deposits", label: "投标保证金", icon: Wallet, perm: "deposit.view" },
  { to: "/inquiries", label: "询标报名", icon: ClipboardList, perm: "inquiry.view_all|inquiry.view_own" },
  { to: "/users", label: "用户权限", icon: Users, perm: "system.users" },
];

/** 控制台布局 */
export function AppLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (!cancelled) setUser(me.user);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          navigate("/login", { replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const perms = user?.permissions || [];

  const visibleNav = NAV.filter((item) => {
    if (!item.perm) return true;
    return item.perm.split("|").some((p) => can(perms, p));
  });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-black/[0.08] bg-white">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#26251e] text-[11px] font-bold text-white">
            BT
          </div>
          <div>
            <p className="text-[13px] font-semibold tracking-tight text-[#26251e]">Bruce标迹</p>
            <p className="text-[11px] text-[#6b6b6b]">BidTrace</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-black/[0.06] text-[#26251e]"
                      : "text-[#6b6b6b] hover:bg-black/[0.04] hover:text-[#26251e]",
                  )
                }
              >
                <Icon className="h-4 w-4 opacity-70" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-black/[0.06] p-3">
          <p className="truncate text-[12px] font-medium text-[#26251e]">
            {user?.display_name || "…"}
          </p>
          <p className="truncate text-[11px] text-[#6b6b6b]">{user?.role_label}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5" />
            退出登录
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}
