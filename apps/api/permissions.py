# -*- coding: utf-8 -*-
"""权限码与角色默认权限包。"""

from __future__ import annotations

from typing import Any

# 全部权限定义：code -> 中文说明
ALL_PERMISSIONS: dict[str, str] = {
    # 平台账号
    "platform.view": "查看平台账号",
    "platform.create": "新增平台账号",
    "platform.edit": "编辑平台账号",
    "platform.delete": "删除平台账号",
    "platform.view_password": "查看密码明文",
    "platform.edit_password": "修改密码字段",
    "platform.import": "导入平台账号",
    "platform.export": "导出平台账号",
    # 询标报名
    "inquiry.view_all": "查看全部询标记录",
    "inquiry.view_own": "查看自己创建的询标",
    "inquiry.create": "新增询标记录",
    "inquiry.edit": "编辑询标记录",
    "inquiry.delete": "删除询标记录",
    "inquiry.import": "导入询标记录",
    "inquiry.export": "导出询标记录",
    # 投标项目
    "project.view": "查看投标项目",
    "project.create": "新增投标项目",
    "project.edit": "编辑投标项目",
    "project.delete": "删除投标项目",
    "project.import": "导入投标项目",
    "project.export": "导出投标项目",
    # 投标保证金
    "deposit.view": "查看投标保证金",
    "deposit.create": "新增投标保证金",
    "deposit.edit": "编辑投标保证金",
    "deposit.delete": "删除投标保证金",
    "deposit.import": "导入投标保证金",
    "deposit.export": "导出投标保证金",
    # 周报（二期预留）
    "weekly.view_all": "查看全部周报",
    "weekly.view_own": "查看自己的周报",
    "weekly.edit_own": "填写/编辑自己的周报",
    "weekly.edit_others": "编辑他人周报",
    # 系统（用户 / 角色 / 微调 分开，避免「有用户管理就能改角色」）
    "system.users.view": "查看用户列表",
    "system.users.create": "新建用户",
    "system.users.edit": "编辑用户（登录名/显示名/密码/角色/启停）",
    "system.users.delete": "删除用户",
    "system.roles": "角色管理（新建/配置权限包/删除角色）",
    "system.permissions": "单人权限微调（在角色之外加减权限）",
    "system.audit": "查看操作日志",
}

# 旧版权限码兼容：展开为新细项
_LEGACY_PERM_EXPAND: dict[str, set[str]] = {
    "system.users": {
        "system.users.view",
        "system.users.create",
        "system.users.edit",
        "system.users.delete",
    },
}

# 角色中文名
ROLE_LABELS: dict[str, str] = {
    "admin": "管理员",
    "leader": "投标组长",
    "inquiry": "询标员",
    "member": "专员",
}

# 各角色默认权限包
ROLE_DEFAULTS: dict[str, set[str]] = {
    "admin": set(ALL_PERMISSIONS.keys()),
    "leader": {
        "platform.view",
        "platform.create",
        "platform.edit",
        "platform.delete",
        "platform.export",
        "inquiry.view_all",
        "inquiry.view_own",
        "inquiry.create",
        "inquiry.edit",
        "inquiry.delete",
        "inquiry.export",
        "project.view",
        "project.create",
        "project.edit",
        "project.delete",
        "project.import",
        "project.export",
        "deposit.view",
        "deposit.create",
        "deposit.edit",
        "deposit.delete",
        "deposit.import",
        "deposit.export",
        "weekly.view_all",
        "weekly.view_own",
        "weekly.edit_own",
        "weekly.edit_others",
        "system.audit",
    },
    "inquiry": {
        "platform.view",
        "inquiry.view_all",
        "inquiry.view_own",
        "inquiry.create",
        "inquiry.edit",
        "inquiry.delete",
        "inquiry.export",
        "project.view",
        "deposit.view",
        "weekly.view_own",
        "weekly.edit_own",
    },
    "member": {
        "platform.view",
        "inquiry.view_all",
        "inquiry.view_own",
        "inquiry.create",
        "inquiry.edit",
        "project.view",
        "project.create",
        "project.edit",
        "deposit.view",
        "deposit.create",
        "deposit.edit",
        "weekly.view_own",
        "weekly.edit_own",
    },
}


def permission_catalog() -> list[dict[str, str]]:
    """返回权限目录列表。"""
    return [{"code": k, "label": v} for k, v in ALL_PERMISSIONS.items()]


def get_role_label(role: str) -> str:
    """角色显示名：优先读库，回退到内置标签。"""
    try:
        from db import queries as q

        row = q.get_role(role)
        if row and row.get("label"):
            return str(row["label"])
    except Exception:
        pass
    return ROLE_LABELS.get(role, role)


def _expand_legacy_perms(codes: set[str]) -> set[str]:
    """把旧权限码展开为新细项，并去掉已废弃码。"""
    out = set(codes)
    for legacy, modern in _LEGACY_PERM_EXPAND.items():
        if legacy in out:
            out.discard(legacy)
            out |= modern
    # 旧「分配权限」曾兼管角色：若库里只有 system.permissions 无 system.roles，
    # 不在运行时自动给角色权（避免再次混用）；迁移脚本会给 admin 补全。
    return {c for c in out if c in ALL_PERMISSIONS}


def resolve_permissions(role: str, overrides: dict[str, bool] | None = None) -> set[str]:
    """根据「角色权限包（库）」+「单人覆盖」算出最终权限。

    overrides: { permission_code: True/False }
    - True：额外授予
    - False：从角色默认中撤销
    """
    if role == "admin":
        # 管理员始终全开，覆盖无效
        return set(ALL_PERMISSIONS.keys())

    base: set[str] = set()
    try:
        from db import queries as q

        base = {c for c in q.get_role_permission_codes(role) if c in ALL_PERMISSIONS or c in _LEGACY_PERM_EXPAND}
    except Exception:
        base = set(ROLE_DEFAULTS.get(role) or set())

    # 库中无记录时回退内置默认包（兼容未迁移）
    if not base and role in ROLE_DEFAULTS:
        base = set(ROLE_DEFAULTS[role])

    base = _expand_legacy_perms(base)

    if not overrides:
        return base
    for code, granted in overrides.items():
        expanded = _expand_legacy_perms({code}) if code in _LEGACY_PERM_EXPAND else (
            {code} if code in ALL_PERMISSIONS else set()
        )
        for c in expanded:
            if granted:
                base.add(c)
            else:
                base.discard(c)
    return base


def has_perm(perms: set[str], code: str) -> bool:
    """是否拥有某权限。"""
    return code in perms


def public_user_payload(
    user: dict[str, Any],
    perms: set[str],
) -> dict[str, Any]:
    """前端可用的用户信息。"""
    role = str(user.get("role") or "member")
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name") or user["username"],
        "role": role,
        "role_label": get_role_label(role),
        "permissions": sorted(perms),
    }
