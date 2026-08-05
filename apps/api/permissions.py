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
    # 系统
    "system.users": "用户管理",
    "system.permissions": "分配权限",
    "system.audit": "查看操作日志",
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


def resolve_permissions(role: str, overrides: dict[str, bool] | None = None) -> set[str]:
    """根据角色默认包 + 单人覆盖，算出最终权限集合。

    overrides: { permission_code: True/False }
    - True：额外授予
    - False：从角色默认中撤销
    """
    base = set(ROLE_DEFAULTS.get(role) or set())
    if role == "admin":
        # 管理员始终全开，覆盖无效
        return set(ALL_PERMISSIONS.keys())
    if not overrides:
        return base
    for code, granted in overrides.items():
        if code not in ALL_PERMISSIONS:
            continue
        if granted:
            base.add(code)
        else:
            base.discard(code)
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
        "role_label": ROLE_LABELS.get(role, role),
        "permissions": sorted(perms),
    }
