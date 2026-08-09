import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  fetchMeta,
  fetchRoles,
  fetchUsers,
  setUserPerms,
  updateRole,
  updateUser,
  type AppRole,
  type AppUser,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, cn } from "@/lib/utils";

type Tab = "users" | "roles";

const PERM_GROUPS: { title: string; hint: string; prefix: string }[] = [
  { title: "系统 · 用户账号", hint: "只管账号，不含角色配置", prefix: "system.users." },
  { title: "系统 · 角色管理", hint: "配置角色权限包；与用户账号权限分开", prefix: "system.roles" },
  { title: "系统 · 单人微调", hint: "在角色之外对单个用户加减权限", prefix: "system.permissions" },
  { title: "系统 · 审计", hint: "操作日志", prefix: "system.audit" },
  { title: "系统 · AI 配置", hint: "全局 AI 默认（中转站/官方）；个人配置不需此权限", prefix: "system.ai_config" },
  { title: "站内通知", hint: "查看/接收、发送可分开勾选授权", prefix: "notify." },
  { title: "平台账号", hint: "", prefix: "platform." },
  { title: "询标报名", hint: "", prefix: "inquiry." },
  { title: "投标项目", hint: "", prefix: "project." },
  { title: "开标日历", hint: "与投标项目台账分开勾选", prefix: "calendar." },
  { title: "投标保证金", hint: "", prefix: "deposit." },
  { title: "周报", hint: "", prefix: "weekly." },
];

function PermChecklist({
  catalog,
  checked,
  disabled,
  onToggle,
}: {
  catalog: { code: string; label: string }[];
  checked: (code: string) => boolean;
  disabled?: boolean;
  onToggle: (code: string, on: boolean) => void;
}) {
  const used = new Set<string>();
  const blocks = PERM_GROUPS.map((g) => {
    const items =
      g.prefix === "system.roles" || g.prefix === "system.permissions" || g.prefix === "system.audit"
        ? catalog.filter((p) => p.code === g.prefix)
        : catalog.filter((p) => p.code.startsWith(g.prefix));
    items.forEach((i) => used.add(i.code));
    return { ...g, items };
  }).filter((b) => b.items.length > 0);
  const rest = catalog.filter((p) => !used.has(p.code));
  if (rest.length) {
    blocks.push({ title: "其它", hint: "", prefix: "", items: rest });
  }

  return (
    <div className="space-y-4">
      {blocks.map((b) => (
        <div key={b.title}>
          <p className="mb-1 text-[12px] font-semibold text-[#26251e]">{b.title}</p>
          {b.hint ? <p className="mb-2 text-[11px] text-[#8a8a8a]">{b.hint}</p> : null}
          <div className="space-y-2">
            {b.items.map((p) => (
              <label
                key={p.code}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-black/[0.06] px-3 py-2 text-[12px]",
                  disabled && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked(p.code)}
                  disabled={disabled}
                  onChange={(e) => onToggle(p.code, e.target.checked)}
                />
                <span className="font-medium text-[#26251e]">{p.label}</span>
                <span className="font-mono text-[10px] text-[#a3a3a3]">{p.code}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 用户与可配置角色管理 */
export function UsersPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const perms = user?.permissions || [];
  const [tab, setTab] = useState<Tab>("users");

  const [items, setItems] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permCatalog, setPermCatalog] = useState<{ code: string; label: string }[]>([]);
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
  const [editingProfile, setEditingProfile] = useState<AppUser | null>(null);
  const [draftUsername, setDraftUsername] = useState("");
  const [draftDisplayName, setDraftDisplayName] = useState("");
  const [draftPassword, setDraftPassword] = useState("");
  const [draftProfileRole, setDraftProfileRole] = useState("member");
  const [clearOverridesOnEdit, setClearOverridesOnEdit] = useState(true);

  const [editingRole, setEditingRole] = useState<AppRole | null>(null);
  const [draftRoleLabel, setDraftRoleLabel] = useState("");
  const [draftRolePerms, setDraftRolePerms] = useState<Set<string>>(new Set());
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRole, setNewRole] = useState({ code: "", label: "" });
  const [newRolePerms, setNewRolePerms] = useState<Set<string>>(new Set());

  const roleOptions = useMemo(() => {
    const opts = roles.map((r) => ({ code: r.code, label: r.label }));
    // 非管理员不能选/看到管理员角色
    if (user?.role !== "admin") {
      return opts.filter((r) => r.code !== "admin");
    }
    return opts;
  }, [roles, user?.role]);

  const visibleUsers = useMemo(() => {
    if (user?.role === "admin") return items;
    return items.filter((u) => u.username !== "admin" && u.role !== "admin");
  }, [items, user?.role]);


  const canViewUsers = can(perms, "system.users.view");
  const canCreateUser = can(perms, "system.users.create");
  const canEditUser = can(perms, "system.users.edit");
  const canDeleteUser = can(perms, "system.users.delete");
  const canManageRoles = can(perms, "system.roles");
  const canFineTune = can(perms, "system.permissions");

  const load = async () => {
    setError("");
    try {
      const needRoles =
        canManageRoles || canEditUser || canCreateUser || canViewUsers;
      const [u, meta, roleList] = await Promise.all([
        canViewUsers ? fetchUsers() : Promise.resolve({ items: [] as AppUser[] }),
        fetchMeta(),
        needRoles ? fetchRoles() : Promise.resolve({ items: [] as AppRole[] }),
      ]);
      setItems(u.items);
      setRoles(roleList.items.length ? roleList.items : meta.roles.map((r) => ({ ...r, is_system: !!r.is_system })));
      setPermCatalog(meta.permissions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  };

  useEffect(() => {
    if (!canViewUsers && !canCreateUser && !canEditUser && !canDeleteUser && !canFineTune && canManageRoles) {
      setTab("roles");
    }
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
    if (user?.id === u.id) {
      setError("不能停用当前登录账号");
      return;
    }
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  const openProfile = (u: AppUser) => {
    setEditingProfile(u);
    setDraftUsername(u.username || "");
    setDraftDisplayName(u.display_name || "");
    setDraftPassword("");
    setDraftProfileRole(u.role);
    setClearOverridesOnEdit(true);
  };

  const saveProfile = async () => {
    if (!editingProfile) return;
    const username = draftUsername.trim();
    const name = draftDisplayName.trim();
    if (!username) {
      setError("登录用户名不能为空");
      return;
    }
    if (!name) {
      setError("显示名不能为空");
      return;
    }
    try {
      const body: {
        username: string;
        display_name: string;
        password?: string;
        role?: string;
        clear_overrides?: boolean;
      } = { username, display_name: name };
      const pwd = draftPassword.trim();
      if (pwd) body.password = pwd;
      if (editingProfile.username !== "admin" && draftProfileRole !== editingProfile.role) {
        body.role = draftProfileRole;
        body.clear_overrides = clearOverridesOnEdit;
      }
      await updateUser(editingProfile.id, body);
      setEditingProfile(null);
      setDraftPassword("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const onDeleteUser = async (u: AppUser) => {
    if (u.username === "admin") return;
    if (user?.id === u.id) {
      setError("不能删除当前登录账号");
      return;
    }
    if (!confirm(`确定删除用户「${u.display_name || u.username}」？此操作不可恢复。`)) return;
    try {
      await deleteUser(u.id);
      if (editingProfile?.id === u.id) setEditingProfile(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const openRoleEditor = (r: AppRole) => {
    setEditingRole(r);
    setDraftRoleLabel(r.label);
    setDraftRolePerms(new Set(r.permissions || []));
  };

  const saveRoleEditor = async () => {
    if (!editingRole) return;
    try {
      await updateRole(editingRole.code, {
        label: draftRoleLabel.trim(),
        permissions: editingRole.code === "admin" ? undefined : [...draftRolePerms],
      });
      setEditingRole(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存角色失败");
    }
  };

  const onCreateRole = async () => {
    try {
      await createRole({
        code: newRole.code.trim().toLowerCase(),
        label: newRole.label.trim(),
        permissions: [...newRolePerms],
      });
      setCreatingRole(false);
      setNewRole({ code: "", label: "" });
      setNewRolePerms(new Set());
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "创建角色失败");
    }
  };

  const onDeleteRole = async (r: AppRole) => {
    if (r.is_system) return;
    if (!confirm(`确定删除角色「${r.label}」？`)) return;
    try {
      await deleteRole(r.code);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const toggleSet = (set: Set<string>, code: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(code);
    else next.delete(code);
    return next;
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">用户权限</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            用户账号与角色管理分开：先配角色权限包，再挂用户；单人微调仅作例外
          </p>
        </div>
        {tab === "users" && canCreateUser ? (
          <Button onClick={() => setCreating(true)}>新建用户</Button>
        ) : null}
        {tab === "roles" && canManageRoles ? (
          <Button
            onClick={() => {
              setCreatingRole(true);
              setNewRole({ code: "", label: "" });
              setNewRolePerms(new Set());
            }}
          >
            新建角色
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-black/[0.08] bg-white p-1 w-fit">
        {canViewUsers || canCreateUser || canEditUser || canDeleteUser || canFineTune ? (
          <button
            type="button"
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium",
              tab === "users" ? "bg-black/[0.06] text-[#26251e]" : "text-[#6b6b6b]",
            )}
            onClick={() => setTab("users")}
          >
            用户
          </button>
        ) : null}
        {canManageRoles ? (
          <button
            type="button"
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium",
              tab === "roles" ? "bg-black/[0.06] text-[#26251e]" : "text-[#6b6b6b]",
            )}
            onClick={() => setTab("roles")}
          >
            角色管理
          </button>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-[12px] text-red-600">{error}</p> : null}

      {tab === "users" && canViewUsers ? (
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
              {visibleUsers.map((u) => (
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
                      {canEditUser ? (
                        <Button variant="ghost" size="sm" onClick={() => openProfile(u)}>
                          编辑
                        </Button>
                      ) : null}
                      {canFineTune && u.role !== "admin" ? (
                        <Button variant="ghost" size="sm" onClick={() => openPerms(u)}>
                          单人微调
                        </Button>
                      ) : null}
                      {canEditUser && u.username !== "admin" && user?.id !== u.id ? (
                        <Button variant="ghost" size="sm" onClick={() => void toggleActive(u)}>
                          {u.is_active ? "停用" : "启用"}
                        </Button>
                      ) : null}
                      {canDeleteUser && u.username !== "admin" && user?.id !== u.id ? (
                        <Button variant="ghost" size="sm" onClick={() => void onDeleteUser(u)}>
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="glass-card overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="border-b border-black/[0.06] bg-[#fafaf8] text-[#6b6b6b]">
              <tr>
                <th className="px-3 py-2.5 font-medium">角色</th>
                <th className="px-3 py-2.5 font-medium">代码</th>
                <th className="px-3 py-2.5 font-medium">权限数</th>
                <th className="px-3 py-2.5 font-medium">用户数</th>
                <th className="px-3 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.code} className="border-b border-black/[0.04]">
                  <td className="px-3 py-2">
                    <p className="font-medium text-[#26251e]">{r.label}</p>
                    {r.is_system ? <p className="text-[11px] text-[#8a8a8a]">系统内置</p> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.code}</td>
                  <td className="px-3 py-2">{r.perm_count ?? r.permissions?.length ?? "—"}</td>
                  <td className="px-3 py-2">{r.user_count ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canManageRoles ? (
                        <Button variant="ghost" size="sm" onClick={() => openRoleEditor(r)}>
                          配置权限
                        </Button>
                      ) : null}
                      {canManageRoles && !r.is_system ? (
                        <Button variant="ghost" size="sm" onClick={() => void onDeleteRole(r)}>
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-3 text-[12px] text-[#6b6b6b]">
            改角色权限后，已挂该角色的用户会立刻生效（单人微调覆盖除外）。管理员角色权限固定全开。
          </p>
        </div>
      )}

      {can(perms, "system.audit") ? (
        <p className="mt-4 text-[12px] text-[#6b6b6b]">
          操作记录已独立成模块，请到{" "}
          <Link to="/audit" className="font-medium text-[#26251e] underline underline-offset-2">
            操作日志
          </Link>{" "}
          查看。
        </p>
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
                  {roleOptions.map((r) => (
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

      {editingProfile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">
              编辑用户 · {editingProfile.username}
            </h3>
            <p className="mt-1 text-[12px] text-[#6b6b6b]">可改登录名、显示名、角色；密码留空表示不修改</p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label>登录用户名</Label>
                <Input
                  value={draftUsername}
                  disabled={editingProfile.username === "admin"}
                  onChange={(e) => setDraftUsername(e.target.value)}
                />
                {editingProfile.username === "admin" ? (
                  <p className="text-[11px] text-[#8a8a8a]">内置管理员登录名不可改</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>显示名</Label>
                <Input value={draftDisplayName} onChange={(e) => setDraftDisplayName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>重置密码</Label>
                <Input
                  type="password"
                  value={draftPassword}
                  placeholder="留空则不改密码"
                  onChange={(e) => setDraftPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {editingProfile.username !== "admin" ? (
                <>
                  <div className="space-y-1">
                    <Label>角色</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px]"
                      value={draftProfileRole}
                      onChange={(e) => setDraftProfileRole(e.target.value)}
                    >
                      {roleOptions.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draftProfileRole !== editingProfile.role ? (
                    <label className="flex items-start gap-2 rounded-lg border border-black/[0.06] px-3 py-2 text-[12px]">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={clearOverridesOnEdit}
                        onChange={(e) => setClearOverridesOnEdit(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-[#26251e]">清空单人微调（推荐）</span>
                        <span className="mt-0.5 block text-[#6b6b6b]">改角色后只用新角色权限包</span>
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap justify-between gap-2">
              {canDeleteUser && editingProfile.username !== "admin" && user?.id !== editingProfile.id ? (
                <Button variant="danger" onClick={() => void onDeleteUser(editingProfile)}>
                  删除用户
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingProfile(null);
                    setDraftPassword("");
                  }}
                >
                  取消
                </Button>
                <Button onClick={() => void saveProfile()}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editingPerms ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">
              单人微调 · {editingPerms.display_name}
            </h3>
            <p className="mt-1 text-[12px] text-[#6b6b6b]">
              在角色权限包之上额外授予或撤销。优先改「角色管理」里的权限包。
            </p>
            <div className="mt-4">
              <PermChecklist
                catalog={permCatalog}
                checked={(code) => {
                  const inOverride = code in draftOverrides;
                  return inOverride
                    ? draftOverrides[code]
                    : editingPerms.permissions.includes(code);
                }}
                onToggle={(code, on) => {
                  setDraftOverrides({ ...draftOverrides, [code]: on });
                }}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingPerms(null)}>
                取消
              </Button>
              <Button variant="soft" onClick={() => setDraftOverrides({})}>
                清空覆盖
              </Button>
              <Button onClick={() => void savePerms()}>保存</Button>
            </div>
          </div>
        </div>
      ) : null}

      {editingRole ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">
              配置角色 · {editingRole.label}
            </h3>
            <p className="mt-1 text-[12px] text-[#6b6b6b]">
              代码 <span className="font-mono">{editingRole.code}</span>
              {editingRole.code === "admin" ? " · 管理员固定全权限" : ""}
            </p>
            <div className="mt-4 space-y-1">
              <Label>显示名</Label>
              <Input value={draftRoleLabel} onChange={(e) => setDraftRoleLabel(e.target.value)} />
            </div>
            <div className="mt-4">
              <PermChecklist
                catalog={permCatalog}
                disabled={editingRole.code === "admin"}
                checked={(code) =>
                  editingRole.code === "admin" ? true : draftRolePerms.has(code)
                }
                onToggle={(code, on) => setDraftRolePerms(toggleSet(draftRolePerms, code, on))}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingRole(null)}>
                取消
              </Button>
              <Button onClick={() => void saveRoleEditor()}>保存</Button>
            </div>
          </div>
        </div>
      ) : null}

      {creatingRole ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-[15px] font-semibold text-[#26251e]">新建角色</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>角色代码</Label>
                <Input
                  value={newRole.code}
                  placeholder="如 bid_assist"
                  onChange={(e) => setNewRole({ ...newRole, code: e.target.value })}
                />
                <p className="text-[11px] text-[#8a8a8a]">小写字母开头，字母数字下划线</p>
              </div>
              <div className="space-y-1">
                <Label>显示名</Label>
                <Input
                  value={newRole.label}
                  placeholder="如 投标助理"
                  onChange={(e) => setNewRole({ ...newRole, label: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-4">
              <PermChecklist
                catalog={permCatalog}
                checked={(code) => newRolePerms.has(code)}
                onToggle={(code, on) => setNewRolePerms(toggleSet(newRolePerms, code, on))}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreatingRole(false)}>
                取消
              </Button>
              <Button onClick={() => void onCreateRole()}>创建</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
