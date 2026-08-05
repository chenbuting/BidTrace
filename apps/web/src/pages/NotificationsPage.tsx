import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { CheckCheck, RefreshCw, Send } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  fetchNotifications,
  fetchNotifyUsers,
  markAllNotificationsRead,
  markNotificationRead,
  sendNotification,
  type NotifyItem,
  type NotifyPickerUser,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { can, cn } from "@/lib/utils";

type Tab = "inbox" | "compose";

const DEFAULT_PAGE_SIZE = 20;

function isUnread(item: NotifyItem): boolean {
  return !item.read_at;
}

/** 站内通知：收件箱 + 发送 */
export function NotificationsPage() {
  const { user, refreshNotifyCount, acknowledgeCurrentUnread } = useOutletContext<{
    user: UserInfo | null;
    refreshNotifyCount?: () => void;
    acknowledgeCurrentUnread?: () => void;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = Number(searchParams.get("id") || 0) || 0;

  const perms = user?.permissions || [];
  const canView = can(perms, "notify.view");
  const canSend = can(perms, "notify.send");

  const [tab, setTab] = useState<Tab>("inbox");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const [picker, setPicker] = useState<NotifyPickerUser[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pickerFilter, setPickerFilter] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const loadInbox = async (p = page, size = pageSize, onlyUnread = unreadOnly) => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchNotifications({
        unread_only: onlyUnread,
        limit: size,
        offset: (p - 1) * size,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      return data.items || [];
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
      setItems([]);
      setTotal(0);
      return [] as NotifyItem[];
    } finally {
      setLoading(false);
    }
  };

  const loadPicker = async () => {
    if (!canSend) return;
    try {
      const data = await fetchNotifyUsers();
      setPicker(data.items || []);
    } catch {
      setPicker([]);
    }
  };

  const markReadLocal = async (item: NotifyItem) => {
    if (!isUnread(item)) return;
    try {
      await markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? { ...x, is_unread: 0, read_at: x.read_at || new Date().toISOString().slice(0, 19).replace("T", " ") }
            : x,
        ),
      );
      refreshNotifyCount?.();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!canView) return;
    void (async () => {
      const list = await loadInbox(1, pageSize, unreadOnly);
      acknowledgeCurrentUnread?.();
      if (focusId > 0) {
        const hit = list.find((x) => x.id === focusId);
        setExpanded(focusId);
        if (hit) void markReadLocal(hit);
        // 清掉 query，避免刷新反复定位
        setSearchParams({}, { replace: true });
        requestAnimationFrame(() => {
          document.getElementById(`notify-${focusId}`)?.scrollIntoView({ block: "nearest" });
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (tab === "compose" && canSend) void loadPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canSend]);

  const filteredPicker = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return picker;
    return picker.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.role_label || "").toLowerCase().includes(q),
    );
  }, [picker, pickerFilter]);

  const roleGroups = useMemo(() => {
    const map = new Map<string, NotifyPickerUser[]>();
    for (const u of filteredPicker) {
      const key = u.role_label || u.role;
      const list = map.get(key) || [];
      list.push(u);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filteredPicker]);

  const onOpenItem = async (item: NotifyItem) => {
    const willOpen = expanded !== item.id;
    setExpanded(willOpen ? item.id : null);
    // 仅「展开」时标记已读，收起不重复请求
    if (willOpen) void markReadLocal(item);
  };

  const onReadAll = async () => {
    try {
      await markAllNotificationsRead();
      await loadInbox(page, pageSize, unreadOnly);
      acknowledgeCurrentUnread?.();
      refreshNotifyCount?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作失败");
    }
  };

  const onSend = async () => {
    if (!title.trim()) {
      setSendMsg("请填写标题");
      return;
    }
    if (selected.size === 0) {
      setSendMsg("请选择接收人");
      return;
    }
    setSending(true);
    setSendMsg("");
    try {
      const r = await sendNotification({
        title: title.trim(),
        content: content.trim(),
        user_ids: [...selected],
      });
      setSendMsg(`已发送给 ${r.item.recipient_count} 人`);
      setTitle("");
      setContent("");
      setSelected(new Set());
      setPickerFilter("");
      setTab("inbox");
      setPage(1);
      await loadInbox(1, pageSize, unreadOnly);
      refreshNotifyCount?.();
    } catch (e) {
      setSendMsg(e instanceof ApiError ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-[13px] text-[#6b6b6b]">没有查看通知的权限。</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">站内通知</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            点开通知即已读
            {canSend ? "；有发送权限可选择接收人发通知" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "inbox" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("inbox")}
          >
            收件箱
          </Button>
          {canSend ? (
            <Button
              variant={tab === "compose" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("compose")}
            >
              <Send className="h-3.5 w-3.5" />
              发通知
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mb-3 text-[12px] text-red-600">{error}</p> : null}

      {tab === "inbox" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b6b]">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => {
                  const v = e.target.checked;
                  setUnreadOnly(v);
                  setPage(1);
                  void loadInbox(1, pageSize, v);
                }}
              />
              只看未读
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadInbox(page, pageSize, unreadOnly)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onReadAll()}>
              <CheckCheck className="h-3.5 w-3.5" />
              全部已读
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-white">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-[#8a8a8a]">
                {loading ? "加载中…" : unreadOnly ? "没有未读通知" : "暂无通知"}
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.05]">
                {items.map((item) => {
                  const unread = isUnread(item);
                  const open = expanded === item.id;
                  return (
                    <li key={item.id} id={`notify-${item.id}`}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-black/[0.02]",
                          unread && "bg-[#fff8f3]",
                          open && "bg-black/[0.02]",
                        )}
                        onClick={() => void onOpenItem(item)}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {unread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f54e00]" />
                          ) : (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />
                          )}
                          <span
                            className={cn(
                              "text-[13px] text-[#26251e]",
                              unread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {item.title}
                          </span>
                          <span className="text-[11px] text-[#a3a3a3]">{item.created_at}</span>
                          <span className="text-[11px] text-[#6b6b6b]">
                            来自 {item.sender_username || "系统"}
                          </span>
                          {!unread ? (
                            <span className="text-[10px] text-[#b0b0b0]">已读</span>
                          ) : null}
                        </div>
                        {open ? (
                          <p className="ml-3.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[#4a4a4a]">
                            {item.content || "（无正文）"}
                          </p>
                        ) : item.content ? (
                          <p className="ml-3.5 truncate text-[12px] text-[#8a8a8a]">{item.content}</p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            disabled={loading}
            onChange={(p, size) => {
              setPage(p);
              setPageSize(size);
              void loadInbox(p, size, unreadOnly);
            }}
          />
        </>
      ) : (
        <div className="max-w-2xl rounded-xl border border-black/[0.08] bg-white p-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>标题</Label>
              <Input
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="通知标题（必填）"
              />
            </div>
            <div className="space-y-1">
              <Label>内容</Label>
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] text-[#26251e] outline-none focus:border-black/30"
                value={content}
                maxLength={2000}
                onChange={(e) => setContent(e.target.value)}
                placeholder="写清楚要交代的事…"
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>接收人（已选 {selected.size} 人）</Label>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setSelected(new Set(filteredPicker.map((u) => u.id)))}
                  >
                    全选
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      // 全员（不含自己更合理）
                      const others = picker.filter((u) => u.id !== user?.id).map((u) => u.id);
                      setSelected(new Set(others));
                      setPickerFilter("");
                    }}
                  >
                    全员（不含自己）
                  </Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setSelected(new Set())}>
                    清空
                  </Button>
                </div>
              </div>
              <Input
                value={pickerFilter}
                onChange={(e) => setPickerFilter(e.target.value)}
                placeholder="搜索姓名 / 用户名 / 角色"
              />
              <div className="max-h-64 space-y-3 overflow-auto rounded-lg border border-black/[0.06] p-3">
                {roleGroups.length === 0 ? (
                  <p className="text-[12px] text-[#8a8a8a]">暂无可选用户</p>
                ) : (
                  roleGroups.map(([roleLabel, users]) => (
                    <div key={roleLabel}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[12px] font-semibold text-[#26251e]">{roleLabel}</p>
                        <button
                          type="button"
                          className="text-[11px] text-[#6b6b6b] underline-offset-2 hover:underline"
                          onClick={() => {
                            const next = new Set(selected);
                            const allOn = users.every((u) => next.has(u.id));
                            users.forEach((u) => {
                              if (allOn) next.delete(u.id);
                              else next.add(u.id);
                            });
                            setSelected(next);
                          }}
                        >
                          本组全选/取消
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {users.map((u) => {
                          const isMe = u.id === user?.id;
                          return (
                            <label
                              key={u.id}
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
                                selected.has(u.id)
                                  ? "border-[#26251e] bg-[#26251e] text-white"
                                  : "border-black/[0.1] bg-white text-[#4a4a4a]",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={selected.has(u.id)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(u.id);
                                  else next.delete(u.id);
                                  setSelected(next);
                                }}
                              />
                              {u.display_name}
                              {isMe ? (
                                <span
                                  className={cn(
                                    "text-[10px]",
                                    selected.has(u.id) ? "text-white/70" : "text-[#a3a3a3]",
                                  )}
                                >
                                  我
                                </span>
                              ) : (
                                <span
                                  className={cn(
                                    "text-[10px]",
                                    selected.has(u.id) ? "text-white/70" : "text-[#a3a3a3]",
                                  )}
                                >
                                  @{u.username}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {sendMsg ? (
              <p className={cn("text-[12px]", sendMsg.includes("已发送") ? "text-green-700" : "text-red-600")}>
                {sendMsg}
              </p>
            ) : null}
            <Button onClick={() => void onSend()} disabled={sending}>
              <Send className="h-3.5 w-3.5" />
              {sending ? "发送中…" : "发送通知"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
