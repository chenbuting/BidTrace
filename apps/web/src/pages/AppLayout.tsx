import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  markAllNotificationsRead,
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

/** 本会话已提示过的最大通知 id；更大的才算「新未读」再弹 */
const ALERT_KEY = "bidtrace_notify_alerted_max";

function getAlertedMax(): number {
  try {
    return Number(sessionStorage.getItem(ALERT_KEY) || "0") || 0;
  } catch {
    return 0;
  }
}

function setAlertedMax(id: number) {
  try {
    const prev = getAlertedMax();
    sessionStorage.setItem(ALERT_KEY, String(Math.max(prev, id)));
  } catch {
    /* ignore */
  }
}

function clearAlertedMax() {
  try {
    sessionStorage.removeItem(ALERT_KEY);
  } catch {
    /* ignore */
  }
}

function isUnreadItem(item: NotifyItem): boolean {
  // 以服务端 read_at 为准：空即未读
  return !item.read_at;
}

/** 控制台布局 */
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [unread, setUnread] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [preview, setPreview] = useState<NotifyItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupItems, setPopupItems] = useState<NotifyItem[]>([]);
  const popupOpenRef = useRef(false);
  const lastUnreadRef = useRef<number | null>(null);
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const canNotify = can(user?.permissions || [], "notify.view");

  /** 把当前最新未读记为「已提示」，避免重复弹同一批 */
  const acknowledgeCurrentUnread = useCallback(async () => {
    try {
      const data = await fetchNotifications({ unread_only: true, limit: 1, offset: 0 });
      const newest = data.items?.[0];
      if (newest?.id) setAlertedMax(newest.id);
    } catch {
      /* ignore */
    }
  }, []);

  const maybeShowUnreadPopup = useCallback(async () => {
    if (!can(user?.permissions || [], "notify.view") || popupOpenRef.current) return;
    // 已在通知页：不弹框，并记为已看过提示
    if (locationRef.current.startsWith("/notifications")) {
      await acknowledgeCurrentUnread();
      return;
    }
    try {
      const data = await fetchNotifications({ unread_only: true, limit: 8, offset: 0 });
      const items = data.items || [];
      if (items.length === 0) return;
      const alerted = getAlertedMax();
      const toShow = items.filter((i) => i.id > alerted);
      // 本会话第一次（alerted=0）：展示当前未读
      const list = alerted <= 0 ? items : toShow;
      if (list.length === 0) return;
      setPopupItems(list);
      setPopupOpen(true);
      popupOpenRef.current = true;
    } catch {
      /* ignore */
    }
  }, [user?.permissions, acknowledgeCurrentUnread]);

  const refreshNotifyCount = useCallback(async () => {
    if (!can(user?.permissions || [], "notify.view")) {
      setUnread(0);
      lastUnreadRef.current = 0;
      return;
    }
    try {
      const r = await fetchNotifyUnreadCount();
      const count = r.count || 0;
      const prev = lastUnreadRef.current;
      setUnread(count);
      lastUnreadRef.current = count;
      // 首次拉取，或未读数量变多（有新消息）时才尝试弹框
      if (count > 0 && (prev === null || count > prev)) {
        void maybeShowUnreadPopup();
      }
    } catch {
      /* ignore */
    }
  }, [user?.permissions, maybeShowUnreadPopup]);

  const dismissPopup = (markSeen = true) => {
    if (markSeen && popupItems.length > 0) {
      setAlertedMax(Math.max(...popupItems.map((i) => i.id)));
    }
    setPopupOpen(false);
    popupOpenRef.current = false;
    setPopupItems([]);
  };

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

  // 进入通知页：关闭弹框并确认已提示
  useEffect(() => {
    if (!location.pathname.startsWith("/notifications")) return;
    if (popupOpenRef.current) {
      setPopupOpen(false);
      popupOpenRef.current = false;
      setPopupItems([]);
    }
    if (canNotify) void acknowledgeCurrentUnread();
  }, [location.pathname, canNotify, acknowledgeCurrentUnread]);

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

  // Esc 关闭未读弹框
  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissPopup(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupOpen, popupItems]);

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
    if (isUnreadItem(item)) {
      try {
        await markNotificationRead(item.id);
        setAlertedMax(item.id);
        void refreshNotifyCount();
      } catch {
        /* ignore */
      }
    }
    navigate(`/notifications?id=${item.id}`);
  };

  const onPopupOpenDetail = async (item: NotifyItem) => {
    dismissPopup(true);
    if (isUnreadItem(item)) {
      try {
        await markNotificationRead(item.id);
        void refreshNotifyCount();
      } catch {
        /* ignore */
      }
    }
    navigate(`/notifications?id=${item.id}`);
  };

  const onPopupReadAll = async () => {
    try {
      await markAllNotificationsRead();
      if (popupItems.length > 0) {
        setAlertedMax(Math.max(...popupItems.map((i) => i.id)));
      }
      dismissPopup(false);
      lastUnreadRef.current = 0;
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      clearAlertedMax();
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
                                isUnreadItem(n) && "font-semibold",
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
        <Outlet context={{ user, refreshNotifyCount, acknowledgeCurrentUnread }} />
      </main>

      {popupOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => dismissPopup(true)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notify-popup-title"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff1eb]">
                <Bell className="h-4 w-4 text-[#f54e00]" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="notify-popup-title" className="text-[15px] font-semibold text-[#26251e]">
                  你有未读通知
                </h3>
                <p className="mt-0.5 text-[12px] text-[#6b6b6b]">
                  {unread > 0 ? `当前共 ${unread} 条未读` : `以下 ${popupItems.length} 条请查看`}
                </p>
              </div>
            </div>

            <ul className="mt-4 max-h-56 space-y-2 overflow-auto">
              {popupItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-black/[0.06] bg-[#fafaf8] px-3 py-2.5 text-left hover:border-black/[0.12]"
                    onClick={() => void onPopupOpenDetail(item)}
                  >
                    <p className="truncate text-[13px] font-medium text-[#26251e]">{item.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[#8a8a8a]">
                      {item.sender_username || "系统"} · {item.created_at}
                    </p>
                    {item.content ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-[#4a4a4a]">{item.content}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => dismissPopup(true)}>
                稍后处理
              </Button>
              <Button variant="outline" size="sm" onClick={() => void onPopupReadAll()}>
                全部已读
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  dismissPopup(true);
                  navigate("/notifications");
                }}
              >
                去查看
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
