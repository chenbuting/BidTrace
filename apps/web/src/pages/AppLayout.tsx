import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Users,
  Wallet,
  Waypoints,
} from "lucide-react";

import { ApiError } from "@/api/client";
import {
  fetchMe,
  fetchNotifications,
  fetchNotifyUnreadCount,
  logout,
  markNotificationRead,
  type NotifyItem,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { can, cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true, perm: null as string | null },
  { to: "/charts", label: "数据看板", icon: BarChart3, perm: null as string | null },
  { to: "/platforms", label: "平台账号", icon: Waypoints, perm: "platform.view" },
  { to: "/projects", label: "投标项目", icon: FolderKanban, perm: "project.view" },
  { to: "/calendar", label: "开标日历", icon: CalendarDays, perm: "calendar.view" },
  { to: "/deposits", label: "投标保证金", icon: Wallet, perm: "deposit.view" },
  { to: "/inquiries", label: "询标报名", icon: ClipboardList, perm: "inquiry.view_all|inquiry.view_own" },
  { to: "/notifications", label: "站内通知", icon: Bell, perm: "notify.view" },
  { to: "/users", label: "用户权限", icon: Users, perm: "system.users.view|system.roles|system.permissions" },
  { to: "/audit", label: "操作日志", icon: ScrollText, perm: "system.audit" },
];

/** 控制台布局 */
export function AppLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [unread, setUnread] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [preview, setPreview] = useState<NotifyItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const canNotify = can(user?.permissions || [], "notify.view");

  const refreshNotifyCount = useCallback(async () => {
    if (!can(user?.permissions || [], "notify.view")) {
      setUnread(0);
      return;
    }
    try {
      const r = await fetchNotifyUnreadCount();
      setUnread(r.count || 0);
    } catch {
      /* ignore */
    }
  }, [user?.permissions]);

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

  useEffect(() => {
    if (!user || !canNotify) return;
    void refreshNotifyCount();
    const t = window.setInterval(() => void refreshNotifyCount(), 45000);
    return () => window.clearInterval(t);
  }, [user, canNotify, refreshNotifyCount]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [panelOpen]);

  const openPanel = async () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (!next || !canNotify) return;
    try {
      const data = await fetchNotifications({ limit: 5, offset: 0 });
      setPreview(data.items || []);
    } catch {
      setPreview([]);
    }
  };

  const onPreviewClick = async (item: NotifyItem) => {
    setPanelOpen(false);
    if (item.is_unread || !item.read_at) {
      try {
        await markNotificationRead(item.id);
        void refreshNotifyCount();
      } catch {
        /* ignore */
      }
    }
    navigate("/notifications");
  };

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
                <span className="flex-1">{item.label}</span>
                {item.to === "/notifications" && unread > 0 ? (
                  <span className="rounded-full bg-[#f54e00] px-1.5 text-[10px] font-semibold leading-4 text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-black/[0.06] p-3">
          {canNotify ? (
            <div className="relative mb-2" ref={panelRef}>
              <button
                type="button"
                onClick={() => void openPanel()}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[#6b6b6b] hover:bg-black/[0.04] hover:text-[#26251e]"
              >
                <span className="relative">
                  <Bell className="h-3.5 w-3.5" />
                  {unread > 0 ? (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-[#f54e00]" />
                  ) : null}
                </span>
                通知{unread > 0 ? `（${unread}）` : ""}
              </button>
              {panelOpen ? (
                <div className="absolute bottom-full left-0 z-40 mb-1 w-[260px] rounded-xl border border-black/[0.08] bg-white p-2 shadow-lg">
                  <p className="px-2 py-1 text-[11px] font-medium text-[#6b6b6b]">最近通知</p>
                  {preview.length === 0 ? (
                    <p className="px-2 py-3 text-[12px] text-[#a3a3a3]">暂无</p>
                  ) : (
                    <ul className="max-h-56 overflow-auto">
                      {preview.map((n) => (
                        <li key={n.id}>
                          <button
                            type="button"
                            className="w-full rounded-lg px-2 py-2 text-left hover:bg-black/[0.03]"
                            onClick={() => void onPreviewClick(n)}
                          >
                            <p
                              className={cn(
                                "truncate text-[12px] text-[#26251e]",
                                (n.is_unread || !n.read_at) && "font-semibold",
                              )}
                            >
                              {n.title}
                            </p>
                            <p className="truncate text-[10px] text-[#a3a3a3]">{n.created_at}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    to="/notifications"
                    className="mt-1 block rounded-lg px-2 py-1.5 text-center text-[12px] font-medium text-[#26251e] hover:bg-black/[0.04]"
                    onClick={() => setPanelOpen(false)}
                  >
                    查看全部
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
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
        <Outlet context={{ user, refreshNotifyCount }} />
      </main>
    </div>
  );
}
