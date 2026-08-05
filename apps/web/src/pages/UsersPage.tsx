import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  createUser,
  fetchAudit,
  fetchMeta,
  fetchUsers,
  setUserPerms,
  updateUser,
  type AppUser,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/lib/utils";

/** 用户与权限管理 */
export function UsersPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];
  const [items, setItems] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<{ code: string; label: string }[]>([]);
  const [permCatalog, setPermCatalog] = useState<{ code: string; label: string }[]>([]);
  const [audit, setAudit] = useState<
    { id: number; username: string; action: string; target: string; detail: string; created_at: string }[]
  >([]);
  const [error, setError] = useState("");
  const [editingPerms, setEditingPerms] = useState<AppUser | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "change-me",
    display_name: "",
    role: "member",
  });

  const load = async () => {
    setError("");
    try {
      const [u, meta] = await Promise.all([fetchUsers(), fetchMeta()]);
      setItems(u.items);
      setRoles(meta.roles);
      setPermCatalog(meta.permissions);
      if (can(perms, "system.audit")) {
        const a = await fetchAudit(50);
        setAudit(a.items);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPerms = (u: AppUser) => {
    setEditingPerms(u);
    setDraftOverrides({ ...u.overrides });
  };

  const savePerms = async () => {
    if (!editingPerms) return;
    try {
      await setUserPerms(editingPerms.id, draftOverrides);
      setEditingPerms(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存权限失败");
    }
  };

  const onCreate = async () => {
    try {
      await createUser(newUser);
      setCreating(false);
      setNewUser({ username: "", password: "change-me", display_name: "", role: "member" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "创建失败");
    }
  };

  const toggleActive = async (u: AppUser) => {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">用户权限</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">角色默认包 + 管理员可对单人微调</p>
        </div>
        {can(perms, "system.users") ? (
          <Button onClick={() => setCreating(true)}>新建用户</Button>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-[12px] text-red-600">{error}</p> : null}

      <div className="glass-card overflow-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead className="border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
            <tr>
              <th className="px-3 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">角色</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">权限数</th>
              <th className="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b border-black/[0.04]">
                <td className="px-3 py-2">
                  <p className="font-medium text-[#26251e]">{u.display_name}</p>
                  <p className="font-mono text-[11px] text-[#6b6b6b]">{u.username}</p>
                </td>
                <td className="px-3 py-2">{u.role_label}</td>
                <td className="px-3 py-2">{u.is_active ? "启用" : "停用"}</td>
                <td className="px-3 py-2">{u.permissions.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {can(perms, "system.permissions") && u.role !== "admin" ? (
                      <Button variant="ghost" size="sm" onClick={() => openPerms(u)}>
                        分配权限
                      </Button>
                    ) : null}
                    {can(perms, "system.users") && u.username !== "admin" ? (
                      <Button variant="ghost" size="sm" onClick={() => void toggleActive(u)}>
                        {u.is_active ? "停用" : "启用"}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(perms, "system.audit") ? (
        <div className="glass-card mt-6 p-4">
          <h2 className="text-[14px] font-semibold text-[#26251e]">最近操作日志</h2>
          <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-[12px]">
            {audit.length === 0 ? (
              <li className="text-[#6b6b6b]">暂无</li>
            ) : (
              audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-3 text-[#4a4a4a]">
                  <span className="text-[#a3a3a3]">{a.created_at}</span>
                  <span className="font-medium text-[#26251e]">{a.username}</span>
                  <span>{a.action}</span>
                  <span className="text-[#6b6b6b]">{a.target}</span>
                  <span className="text-[#6b6b6b]">{a.detail}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">新建用户</h3>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label>用户名</Label>
                <Input
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>显示名</Label>
                <Input
                  value={newUser.display_name}
                  onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>初始密码</Label>
                <Input
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>角色</Label>
                <select
                  className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  {roles.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button onClick={() => void onCreate()}>创建</Button>
            </div>
          </div>
        </div>
      ) : null}

      {editingPerms ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">
              分配权限 · {editingPerms.display_name}
            </h3>
            <p className="mt-1 text-[12px] text-[#6b6b6b]">
              勾选 = 额外授予；取消勾选且写入覆盖 = 从角色默认撤销。留空表示用角色默认。
            </p>
            <div className="mt-4 space-y-2">
              {permCatalog.map((p) => {
                const inOverride = p.code in draftOverrides;
                const checked = inOverride
                  ? draftOverrides[p.code]
                  : editingPerms.permissions.includes(p.code);
                return (
                  <label
                    key={p.code}
                    className="flex items-center gap-2 rounded-lg border border-black/[0.06] px-3 py-2 text-[12px]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setDraftOverrides({ ...draftOverrides, [p.code]: e.target.checked });
                      }}
                    />
                    <span className="font-medium text-[#26251e]">{p.label}</span>
                    <span className="font-mono text-[10px] text-[#a3a3a3]">{p.code}</span>
                    {inOverride ? (
                      <span className="ml-auto text-[10px] text-[#f54e00]">已覆盖</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingPerms(null)}>
                取消
              </Button>
              <Button
                variant="soft"
                onClick={() => {
                  setDraftOverrides({});
                }}
              >
                清空覆盖
              </Button>
              <Button onClick={() => void savePerms()}>保存</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
