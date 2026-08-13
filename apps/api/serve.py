# -*- coding: utf-8 -*-
"""BidTrace（Bruce标迹）API 入口。

用法：
  cd apps/api
  pip install -r requirements.txt
  python serve.py

局域网访问请设置 BIDTRACE_HOST=0.0.0.0
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sys
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from starlette.requests import Request
from starlette.responses import JSONResponse

API_ROOT = Path(__file__).resolve().parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from db import queries as q  # noqa: E402
from db.session import DB_PATH, init_db  # noqa: E402
from excel_io import (  # noqa: E402
    TemplateError,
    empty_inquiries_template_xlsx,
    empty_platforms_template_xlsx,
    export_inquiries_xlsx,
    export_platforms_xlsx,
    parse_inquiries_xlsx,
    parse_platforms_xlsx,
)
from permissions import (  # noqa: E402
    ALL_PERMISSIONS,
    get_role_label,
    has_perm,
    permission_catalog,
    public_user_payload,
    resolve_permissions,
)
from stats_routes import mount_stats_routes  # noqa: E402
from weekly_routes import mount_weekly_routes  # noqa: E402
from ai_routes import mount_ai_routes  # noqa: E402

WEB_DIST = API_ROOT.parent / "web" / "dist"

HOST = (os.environ.get("BIDTRACE_HOST") or "0.0.0.0").strip() or "0.0.0.0"
PORT = int(os.environ.get("BIDTRACE_PORT") or "5200")
SESSION_MAX_AGE = 60 * 60 * 12
SESSION_COOKIE = "bidtrace_session"

_secret = os.environ.get("BIDTRACE_SECRET", "").strip() or secrets.token_hex(32)
_serializer = URLSafeTimedSerializer(_secret, salt="bidtrace-auth")

app = FastAPI(title="BidTrace · Bruce标迹", version="0.1.0")


# ---------------------------------------------------------------------------
# 认证 / 权限依赖
# ---------------------------------------------------------------------------

def _set_session(response: Response, username: str) -> None:
    token = _serializer.dumps({"u": username})
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _load_session_user(request: Request) -> Optional[dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        payload = _serializer.loads(token, max_age=SESSION_MAX_AGE)
    except BadSignature:
        return None
    username = str(payload.get("u") or "")
    user = q.get_user_by_username(username)
    if not user or not user.get("is_active"):
        return None
    overrides = q.get_permission_overrides(int(user["id"]))
    perms = resolve_permissions(str(user["role"]), overrides)
    user["_perms"] = perms
    user["_overrides"] = overrides
    return user


def require_login(request: Request) -> dict[str, Any]:
    user = _load_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return user


def require_perm(code: str):
    """依赖工厂：要求某权限。"""

    def _dep(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
        if not has_perm(user["_perms"], code):
            raise HTTPException(status_code=403, detail=f"无权限：{ALL_PERMISSIONS.get(code, code)}")
        return user

    return _dep


def require_any_perm(*codes: str):
    """依赖工厂：拥有任一权限即可。"""

    def _dep(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
        if not any(has_perm(user["_perms"], c) for c in codes):
            labels = " / ".join(ALL_PERMISSIONS.get(c, c) for c in codes)
            raise HTTPException(status_code=403, detail=f"无权限：{labels}")
        return user

    return _dep


# 挂载投标项目 / 投标保证金 / 周报路由
mount_stats_routes(app, {"require_login": require_login, "require_perm": require_perm})
mount_weekly_routes(
    app,
    {
        "require_login": require_login,
        "require_perm": require_perm,
        "require_any_perm": require_any_perm,
    },
)
mount_ai_routes(app, {"require_login": require_login, "require_perm": require_perm})


def mask_platform(row: dict[str, Any], perms: set[str]) -> dict[str, Any]:
    """按权限脱敏密码。"""
    out = dict(row)
    if not has_perm(perms, "platform.view_password"):
        if out.get("login_password"):
            out["login_password"] = "***"
        if out.get("ca_password"):
            out["ca_password"] = "***"
    return out


# ---------------------------------------------------------------------------
# 请求体
# ---------------------------------------------------------------------------

class LoginBody(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class UserCreateBody(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "member"


class UserUpdateBody(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    # 改角色时是否清空个人权限覆盖；默认 True（改角色后用新角色默认包）
    clear_overrides: Optional[bool] = None


class PermsBody(BaseModel):
    overrides: dict[str, bool] = Field(default_factory=dict)


class NotifyCreateBody(BaseModel):
    title: str
    content: str = ""
    user_ids: list[int] = Field(default_factory=list)


class RoleCreateBody(BaseModel):
    code: str
    label: str
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateBody(BaseModel):
    label: Optional[str] = None
    permissions: Optional[list[str]] = None


class PlatformBody(BaseModel):
    name: str
    url: str = ""
    login_method: str = ""
    login_account: str = ""
    login_password: str = ""
    has_ca: str = "否"
    ca_password: str = ""
    priority: str = "中"
    status: str = "启用"
    weight: float = 0
    remark: str = ""


class InquiryBody(BaseModel):
    register_date: str = ""
    platform_name: str = ""
    project_name: str = ""
    is_bid: str = "否"
    is_registered: str = "否"
    file_received: str = "否"
    is_paid: str = "否"
    overview_done: str = "否"
    skip_reason_category: str = ""
    skip_reason_detail: str = ""
    deadline: str = ""


# ---------------------------------------------------------------------------
# 启动
# ---------------------------------------------------------------------------

@app.on_event("startup")
def on_startup() -> None:
    init_db()
    q.ensure_seed_roles()
    q.ensure_seed_users()


# ---------------------------------------------------------------------------
# 认证
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
def api_login(body: LoginBody) -> JSONResponse:
    user = q.get_user_by_username(body.username.strip())
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not q.verify_password(body.password, str(user["password_hash"])):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    overrides = q.get_permission_overrides(int(user["id"]))
    perms = resolve_permissions(str(user["role"]), overrides)
    q.add_audit(int(user["id"]), user["username"], "login", "auth", "登录成功")
    resp = JSONResponse({"ok": True, "user": public_user_payload(user, perms)})
    _set_session(resp, user["username"])
    return resp


@app.post("/api/auth/logout")
def api_logout(user: dict[str, Any] = Depends(require_login)) -> JSONResponse:
    q.add_audit(int(user["id"]), user["username"], "logout", "auth", "")
    resp = JSONResponse({"ok": True})
    _clear_session(resp)
    return resp


@app.get("/api/auth/me")
def api_me(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
    return {"user": public_user_payload(user, user["_perms"])}


# ---------------------------------------------------------------------------
# 权限 / 用户管理
# ---------------------------------------------------------------------------

@app.get("/api/meta/permissions")
def api_permission_catalog(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
    roles = [{"code": r["code"], "label": r["label"], "is_system": r["is_system"]} for r in q.list_roles()]
    return {
        "permissions": permission_catalog(),
        "roles": roles,
    }


@app.get("/api/roles")
def api_list_roles(
    user: dict[str, Any] = Depends(
        require_any_perm(
            "system.users.view",
            "system.users.create",
            "system.users.edit",
            "system.roles",
        )
    ),
) -> dict[str, Any]:
    items = []
    for r in q.list_roles():
        perms = q.get_role_permission_codes(str(r["code"]))
        items.append({**r, "permissions": perms})
    return {"items": items}


@app.post("/api/roles")
def api_create_role(
    body: RoleCreateBody,
    user: dict[str, Any] = Depends(require_perm("system.roles")),
) -> dict[str, Any]:
    import re

    code = body.code.strip().lower()
    label = body.label.strip()
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,31}", code):
        raise HTTPException(status_code=400, detail="角色代码需为小写字母开头，仅含字母数字下划线，2-32 位")
    if not label:
        raise HTTPException(status_code=400, detail="请填写角色名称")
    if q.role_exists(code):
        raise HTTPException(status_code=400, detail="角色代码已存在")
    created = q.create_role(code, label, is_system=False)
    q.set_role_permissions(code, body.permissions)
    q.add_audit(int(user["id"]), user["username"], "role.create", f"role:{code}", label)
    return {
        "item": {
            **created,
            "permissions": q.get_role_permission_codes(code),
            "perm_count": len(q.get_role_permission_codes(code)),
            "user_count": 0,
        }
    }


@app.patch("/api/roles/{code}")
def api_update_role(
    code: str,
    body: RoleUpdateBody,
    user: dict[str, Any] = Depends(require_perm("system.roles")),
) -> dict[str, Any]:
    role = q.get_role(code)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if body.label is not None:
        label = body.label.strip()
        if not label:
            raise HTTPException(status_code=400, detail="角色名称不能为空")
        # admin 显示名可改，其它系统角色也可改名
        q.update_role_label(code, label)
    if body.permissions is not None:
        if code == "admin":
            # 仍写入全量，忽略传入（防误操作）
            q.set_role_permissions(code, list(ALL_PERMISSIONS.keys()))
        else:
            q.set_role_permissions(code, body.permissions)
    updated = q.get_role(code)
    assert updated
    perms = q.get_role_permission_codes(code)
    q.add_audit(
        int(user["id"]),
        user["username"],
        "role.update",
        f"role:{code}",
        f"perms={len(perms)}",
    )
    # 附带列表字段
    for r in q.list_roles():
        if r["code"] == code:
            return {"item": {**r, "permissions": perms}}
    return {"item": {**updated, "permissions": perms}}


@app.delete("/api/roles/{code}")
def api_delete_role(
    code: str,
    user: dict[str, Any] = Depends(require_perm("system.roles")),
) -> dict[str, Any]:
    result = q.delete_role(code)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message") or "删除失败")
    q.add_audit(int(user["id"]), user["username"], "role.delete", f"role:{code}", "")
    return result


@app.get("/api/users")
def api_list_users(user: dict[str, Any] = Depends(require_perm("system.users.view"))) -> dict[str, Any]:
    actor_is_admin = str(user.get("role") or "") == "admin"
    items = []
    for u in q.list_users():
        # 非管理员看不到内置 admin / 管理员角色账号
        if not actor_is_admin and (
            str(u.get("username") or "") == "admin" or str(u.get("role") or "") == "admin"
        ):
            continue
        overrides = q.get_permission_overrides(int(u["id"]))
        perms = resolve_permissions(str(u["role"]), overrides)
        items.append(
            {
                **{k: u[k] for k in ("id", "username", "display_name", "role", "is_active", "created_at")},
                "role_label": get_role_label(str(u["role"])),
                "overrides": overrides,
                "permissions": sorted(perms),
            }
        )
    return {"items": items}


def _deny_manage_admin_account(actor: dict[str, Any], target: dict[str, Any]) -> None:
    """非管理员不能改/删管理员账号。"""
    if str(actor.get("role") or "") == "admin":
        return
    if str(target.get("username") or "") == "admin" or str(target.get("role") or "") == "admin":
        raise HTTPException(status_code=403, detail="无权管理管理员账号")


@app.post("/api/users")
def api_create_user(
    body: UserCreateBody,
    user: dict[str, Any] = Depends(require_perm("system.users.create")),
) -> dict[str, Any]:
    if not q.role_exists(body.role):
        raise HTTPException(status_code=400, detail="无效角色")
    if str(user.get("role") or "") != "admin" and body.role == "admin":
        raise HTTPException(status_code=403, detail="无权创建管理员账号")
    if q.get_user_by_username(body.username.strip()):
        raise HTTPException(status_code=400, detail="用户名已存在")
    created = q.create_user(body.username.strip(), body.password, body.display_name.strip(), body.role)
    q.add_audit(int(user["id"]), user["username"], "user.create", f"user:{created['id']}", created["username"])
    return {"item": {k: created[k] for k in ("id", "username", "display_name", "role", "is_active")}}


@app.patch("/api/users/{user_id}")
def api_update_user(
    user_id: int,
    body: UserUpdateBody,
    user: dict[str, Any] = Depends(require_perm("system.users.edit")),
) -> JSONResponse:
    target = q.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    _deny_manage_admin_account(user, target)
    if body.role is not None and not q.role_exists(body.role):
        raise HTTPException(status_code=400, detail="无效角色")
    if str(user.get("role") or "") != "admin" and body.role == "admin":
        raise HTTPException(status_code=403, detail="无权将用户设为管理员")
    # 内置 admin 账号不允许改角色，避免锁死系统
    if body.role is not None and str(target.get("username")) == "admin":
        raise HTTPException(status_code=400, detail="内置管理员账号不能改角色")
    # 不能停用自己
    if body.is_active is False and int(target["id"]) == int(user["id"]):
        raise HTTPException(status_code=400, detail="不能停用当前登录账号")

    new_username: Optional[str] = None
    if body.username is not None:
        new_username = body.username.strip()
        if not new_username:
            raise HTTPException(status_code=400, detail="登录用户名不能为空")
        if str(target.get("username")) == "admin" and new_username != "admin":
            raise HTTPException(status_code=400, detail="内置管理员登录名不能修改")
        if new_username != str(target.get("username")):
            exists = q.get_user_by_username(new_username)
            if exists and int(exists["id"]) != int(user_id):
                raise HTTPException(status_code=400, detail="登录用户名已存在")

    old_role = str(target.get("role") or "")
    pwd = (body.password or "").strip() or None
    updated = q.update_user(
        user_id,
        username=new_username,
        display_name=body.display_name,
        role=body.role,
        is_active=body.is_active,
        password=pwd,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="用户不存在")

    cleared = False
    if body.role is not None and body.role != old_role:
        do_clear = True if body.clear_overrides is None else bool(body.clear_overrides)
        if do_clear:
            q.set_permission_overrides(user_id, {})
            cleared = True

    parts: list[str] = []
    if new_username is not None and new_username != str(target.get("username") or ""):
        parts.append(f"username {target.get('username')}->{new_username}")
    if body.display_name is not None and body.display_name != (target.get("display_name") or ""):
        parts.append("display_name")
    if pwd:
        parts.append("password")
    if body.is_active is not None:
        parts.append("active" if body.is_active else "inactive")
    if body.role is not None and body.role != old_role:
        detail_role = f"role {old_role}->{body.role}"
        if cleared:
            detail_role += "; clear overrides"
        elif body.clear_overrides is False:
            detail_role += "; keep overrides"
        parts.append(detail_role)
    detail = "; ".join(parts)
    q.add_audit(int(user["id"]), user["username"], "user.update", f"user:{user_id}", detail)

    payload = {"item": {k: updated[k] for k in ("id", "username", "display_name", "role", "is_active")}}
    resp = JSONResponse(payload)
    # 若改的是当前登录用户自己的用户名，刷新会话 cookie，避免立刻掉线
    if new_username and int(user_id) == int(user["id"]) and new_username != str(user.get("username") or ""):
        _set_session(resp, new_username)
    return resp


@app.delete("/api/users/{user_id}")
def api_delete_user(
    user_id: int,
    user: dict[str, Any] = Depends(require_perm("system.users.delete")),
) -> dict[str, Any]:
    if int(user_id) == int(user["id"]):
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    target = q.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    _deny_manage_admin_account(user, target)
    result = q.delete_user(user_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message") or "删除失败")
    q.add_audit(
        int(user["id"]),
        user["username"],
        "user.delete",
        f"user:{user_id}",
        str(result.get("username") or ""),
    )
    return result


@app.put("/api/users/{user_id}/permissions")
def api_set_user_perms(
    user_id: int,
    body: PermsBody,
    user: dict[str, Any] = Depends(require_perm("system.permissions")),
) -> dict[str, Any]:
    target = q.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    _deny_manage_admin_account(user, target)
    if str(target["role"]) == "admin":
        raise HTTPException(status_code=400, detail="管理员权限不可覆盖")
    clean = {k: bool(v) for k, v in body.overrides.items() if k in ALL_PERMISSIONS}
    q.set_permission_overrides(user_id, clean)
    perms = resolve_permissions(str(target["role"]), clean)
    q.add_audit(int(user["id"]), user["username"], "user.perms", f"user:{user_id}", str(clean))
    return {"overrides": clean, "permissions": sorted(perms)}


@app.get("/api/audit")
def api_audit(
    username: str = "",
    action: str = "",
    target: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict[str, Any] = Depends(require_perm("system.audit")),
) -> dict[str, Any]:
    items, total = q.list_audit(
        username=username,
        action=action,
        target=target,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return {
        "total": total,
        "items": items,
        "actions": q.list_audit_actions(),
    }


# ---------------------------------------------------------------------------
# 站内通知
# ---------------------------------------------------------------------------

@app.get("/api/notifications/unread-count")
def api_notify_unread_count(
    user: dict[str, Any] = Depends(require_perm("notify.view")),
) -> dict[str, Any]:
    return {"count": q.count_unread_notifications(int(user["id"]))}


@app.get("/api/notifications/users")
def api_notify_users(
    user: dict[str, Any] = Depends(require_perm("notify.send")),
) -> dict[str, Any]:
    """发通知时的接收人列表。"""
    items = []
    for u in q.list_notify_picker_users():
        items.append(
            {
                "id": u["id"],
                "username": u["username"],
                "display_name": u.get("display_name") or u["username"],
                "role": u.get("role") or "member",
                "role_label": get_role_label(str(u.get("role") or "member")),
            }
        )
    return {"items": items}


@app.get("/api/notifications")
def api_list_notifications(
    unread_only: bool = False,
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict[str, Any] = Depends(require_perm("notify.view")),
) -> dict[str, Any]:
    items, total = q.list_inbox(
        int(user["id"]),
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return {"total": total, "items": items}


@app.post("/api/notifications/read-all")
def api_notify_read_all(
    user: dict[str, Any] = Depends(require_perm("notify.view")),
) -> dict[str, Any]:
    n = q.mark_all_notifications_read(int(user["id"]))
    return {"ok": True, "updated": n}


@app.post("/api/notifications/{notification_id}/read")
def api_notify_read_one(
    notification_id: int,
    user: dict[str, Any] = Depends(require_perm("notify.view")),
) -> dict[str, Any]:
    ok = q.mark_notification_read(int(user["id"]), notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="通知不存在")
    return {"ok": True}


@app.post("/api/notifications")
def api_create_notification(
    body: NotifyCreateBody,
    user: dict[str, Any] = Depends(require_perm("notify.send")),
) -> dict[str, Any]:
    result = q.create_notification(
        sender_id=int(user["id"]),
        sender_username=str(user.get("username") or ""),
        title=body.title,
        content=body.content,
        recipient_ids=body.user_ids,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message") or "发送失败")
    item = result["item"]
    q.add_audit(
        int(user["id"]),
        user["username"],
        "notify.send",
        f"notify:{item['id']}",
        f"{item['title']} → {item['recipient_count']}人",
    )
    return {"item": item}


# ---------------------------------------------------------------------------
# 首页统计
# ---------------------------------------------------------------------------

@app.get("/api/dashboard")
def api_dashboard(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
    return q.dashboard_stats()


@app.get("/api/dashboard/charts")
def api_dashboard_charts(
    days: int = Query(14, ge=0, le=3650, description="趋势天数；0=全部历史"),
    user: dict[str, Any] = Depends(require_login),
) -> dict[str, Any]:
    """数据看板图表汇总。"""
    return q.dashboard_charts(days=days)


# ---------------------------------------------------------------------------
# 平台账号
# ---------------------------------------------------------------------------

@app.get("/api/platforms")
def api_list_platforms(
    q_text: str = Query("", alias="q"),
    name: str = "",
    url: str = "",
    login_method: str = "",
    has_ca: str = "",
    status: str = "",
    priority: str = "",
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    user: dict[str, Any] = Depends(require_perm("platform.view")),
) -> dict[str, Any]:
    items, total = q.list_platforms(
        q=q_text,
        name=name,
        url=url,
        login_method=login_method,
        has_ca=has_ca,
        status=status,
        priority=priority,
        limit=limit,
        offset=offset,
    )
    return {
        "total": total,
        "items": [mask_platform(i, user["_perms"]) for i in items],
    }


class BatchDeleteBody(BaseModel):
    ids: list[int] = Field(default_factory=list)


@app.get("/api/platforms/options")
def api_platform_options(user: dict[str, Any] = Depends(require_login)) -> dict[str, Any]:
    return {"items": q.platform_name_options()}


@app.get("/api/platforms/template")
def api_platforms_template(
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> Response:
    """下载平台账号固定空模板。"""
    data = empty_platforms_template_xlsx()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=platforms_template.xlsx"},
    )


@app.get("/api/platforms/export")
def api_export_platforms(
    name: str = "",
    url: str = "",
    login_method: str = "",
    has_ca: str = "",
    status: str = "",
    priority: str = "",
    q_text: str = Query("", alias="q"),
    user: dict[str, Any] = Depends(require_perm("platform.export")),
) -> Response:
    items, _ = q.list_platforms(
        q=q_text,
        name=name,
        url=url,
        login_method=login_method,
        has_ca=has_ca,
        status=status,
        priority=priority,
        limit=10000,
        offset=0,
    )
    mask = not has_perm(user["_perms"], "platform.view_password")
    data = export_platforms_xlsx(items, mask_password=mask)
    q.add_audit(int(user["id"]), user["username"], "platform.export", "platforms", f"{len(items)} 条")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=platforms.xlsx"},
    )


@app.post("/api/platforms/import")
async def api_import_platforms(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> dict[str, Any]:
    """兼容旧入口：默认走增量预览说明，请改用 preview/commit。"""
    raise HTTPException(
        status_code=400,
        detail="请使用新的导入流程：先预览再确认（增量追加 / 全部覆盖）",
    )


@app.post("/api/platforms/import/preview")
async def api_import_platforms_preview(
    file: UploadFile = File(...),
    mode: str = Form("incremental"),
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> dict[str, Any]:
    """导入预览：分析新增与冲突（名称+网址相同）。"""
    if mode not in ("incremental", "full"):
        raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
    content = await file.read()
    try:
        rows = parse_platforms_xlsx(content)
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需至少有平台名称）")

    index = q.build_platform_index()
    conflicts: list[dict[str, Any]] = []
    new_count = 0
    for i, row in enumerate(rows):
        key = q.platform_match_key(row.get("name"), row.get("url"))
        existing = index.get(key) if key != "\n" else None
        if mode == "full" or existing is None:
            new_count += 1
            continue
        diffs = q.diff_platform_fields(existing, row)
        if not has_perm(user["_perms"], "platform.view_password"):
            for d in diffs:
                if d["field"] in ("login_password", "ca_password"):
                    if d.get("old"):
                        d["old"] = "***"
                    if d.get("new"):
                        d["new"] = "***"
        conflicts.append(
            {
                "row_index": i,
                "existing_id": int(existing["id"]),
                "name": row.get("name") or "",
                "url": row.get("url") or "",
                "identical": len(diffs) == 0,
                "diffs": diffs,
                "existing": mask_platform(existing, user["_perms"]),
                "incoming": mask_platform({**row, "id": 0}, user["_perms"]),
            }
        )

    backup = q.latest_platform_backup()
    return {
        "mode": mode,
        "total": len(rows),
        "new_count": new_count if mode == "incremental" else len(rows),
        "conflict_count": len(conflicts) if mode == "incremental" else 0,
        "conflicts": conflicts if mode == "incremental" else [],
        "mode_label": "增量追加" if mode == "incremental" else "全部覆盖",
        "mode_desc": (
            "增量追加：新平台直接写入；名称+网址都相同的记录需人工选择「保留」或「覆盖」。"
            if mode == "incremental"
            else "全部覆盖：会先备份当前全部平台账号，再清空表并导入 Excel 全部内容；可一键恢复上一版备份。"
        ),
        "latest_backup": backup,
    }


class ImportDecision(BaseModel):
    row_index: int
    existing_id: int
    action: str  # keep | overwrite


class ImportCommitMeta(BaseModel):
    mode: str = "incremental"
    decisions: list[ImportDecision] = Field(default_factory=list)


@app.post("/api/platforms/import/commit")
async def api_import_platforms_commit(
    file: UploadFile = File(...),
    mode: str = Form("incremental"),
    decisions_json: str = Form("[]"),
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> dict[str, Any]:
    """确认导入：按模式写入。"""
    if mode not in ("incremental", "full"):
        raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
    try:
        raw_decisions = json.loads(decisions_json or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="decisions_json 不是合法 JSON") from exc

    content = await file.read()
    try:
        rows = parse_platforms_xlsx(content)
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需至少有平台名称）")

    uid = int(user["id"])

    if mode == "full":
        backup = q.create_platform_backup(reason="full_overwrite", user_id=uid)
        cleared = q.clear_all_platforms()
        inserted = q.bulk_insert_platforms(rows, uid)
        q.add_audit(
            uid,
            user["username"],
            "platform.import_full",
            "platforms",
            f"清空 {cleared} 条，导入 {inserted} 条，备份#{backup['id']}",
        )
        return {
            "ok": True,
            "mode": mode,
            "inserted": inserted,
            "updated": 0,
            "kept": 0,
            "backup": backup,
        }

    # 增量
    decisions_map: dict[int, str] = {}
    for d in raw_decisions:
        try:
            ri = int(d["row_index"])
            action = str(d.get("action") or "keep")
        except (KeyError, TypeError, ValueError):
            continue
        if action not in ("keep", "overwrite"):
            action = "keep"
        decisions_map[ri] = action

    index = q.build_platform_index()
    inserted = 0
    updated = 0
    kept = 0
    for i, row in enumerate(rows):
        key = q.platform_match_key(row.get("name"), row.get("url"))
        existing = index.get(key) if key != "\n" else None
        if existing is None:
            created = q.create_platform(row, uid)
            inserted += 1
            index[key] = created
            continue

        action = decisions_map.get(i, "keep")
        if action == "overwrite":
            q.update_platform(int(existing["id"]), row, uid)
            updated += 1
            refreshed = q.get_platform(int(existing["id"]))
            if refreshed:
                index[key] = refreshed
        else:
            kept += 1

    q.add_audit(
        uid,
        user["username"],
        "platform.import_incremental",
        "platforms",
        f"新增 {inserted}，覆盖 {updated}，保留 {kept}",
    )
    return {
        "ok": True,
        "mode": mode,
        "inserted": inserted,
        "updated": updated,
        "kept": kept,
    }


@app.get("/api/platforms/backup/latest")
def api_latest_platform_backup(
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> dict[str, Any]:
    return {"backup": q.latest_platform_backup()}


@app.post("/api/platforms/backup/restore")
def api_restore_platform_backup(
    user: dict[str, Any] = Depends(require_perm("platform.import")),
) -> dict[str, Any]:
    result = q.restore_latest_platform_backup(int(user["id"]))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message") or "恢复失败")
    q.add_audit(
        int(user["id"]),
        user["username"],
        "platform.restore_backup",
        f"backup:{result.get('backup_id')}",
        f"恢复 {result.get('restored')} 条",
    )
    return result


@app.get("/api/platforms/{pid}")
def api_get_platform(
    pid: int,
    user: dict[str, Any] = Depends(require_perm("platform.view")),
) -> dict[str, Any]:
    item = q.get_platform(pid)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"item": mask_platform(item, user["_perms"])}


@app.post("/api/platforms")
def api_create_platform(
    body: PlatformBody,
    user: dict[str, Any] = Depends(require_perm("platform.create")),
) -> dict[str, Any]:
    data = body.model_dump()
    item = q.create_platform(data, int(user["id"]))
    q.add_audit(int(user["id"]), user["username"], "platform.create", f"platform:{item['id']}", item["name"])
    return {"item": mask_platform(item, user["_perms"])}


@app.patch("/api/platforms/{pid}")
def api_update_platform(
    pid: int,
    body: PlatformBody,
    user: dict[str, Any] = Depends(require_perm("platform.edit")),
) -> dict[str, Any]:
    existing = q.get_platform(pid)
    if not existing:
        raise HTTPException(status_code=404, detail="记录不存在")
    data = body.model_dump()
    # 脱敏占位符 *** 表示未改密码
    if data.get("login_password") == "***":
        data.pop("login_password")
    if data.get("ca_password") == "***":
        data.pop("ca_password")
    if not has_perm(user["_perms"], "platform.edit_password"):
        data.pop("login_password", None)
        data.pop("ca_password", None)
    item = q.update_platform(pid, data, int(user["id"]))
    q.add_audit(int(user["id"]), user["username"], "platform.update", f"platform:{pid}", data.get("name", ""))
    return {"item": mask_platform(item or {}, user["_perms"])}


@app.delete("/api/platforms/{pid}")
def api_delete_platform(
    pid: int,
    user: dict[str, Any] = Depends(require_perm("platform.delete")),
) -> dict[str, Any]:
    ok = q.delete_platform(pid)
    if not ok:
        raise HTTPException(status_code=404, detail="记录不存在")
    q.add_audit(int(user["id"]), user["username"], "platform.delete", f"platform:{pid}", "")
    return {"ok": True}


@app.post("/api/platforms/batch-delete")
def api_batch_delete_platforms(
    body: BatchDeleteBody,
    user: dict[str, Any] = Depends(require_perm("platform.delete")),
) -> dict[str, Any]:
    ids = [int(i) for i in body.ids if int(i) > 0]
    if not ids:
        raise HTTPException(status_code=400, detail="请先勾选要删除的记录")
    n = q.delete_platforms(ids)
    q.add_audit(int(user["id"]), user["username"], "platform.batch_delete", "platforms", f"删除 {n} 条")
    return {"ok": True, "deleted": n}


# ---------------------------------------------------------------------------
# 询标报名
# ---------------------------------------------------------------------------

def _can_view_inquiry(user: dict[str, Any], item: dict[str, Any]) -> bool:
    perms = user["_perms"]
    if has_perm(perms, "inquiry.view_all"):
        return True
    if has_perm(perms, "inquiry.view_own") and item.get("created_by") == user["id"]:
        return True
    return False


@app.get("/api/inquiries")
def api_list_inquiries(
    q_text: str = Query("", alias="q"),
    project_name: str = "",
    platform_name: str = "",
    is_bid: str = "",
    is_registered: str = "",
    file_received: str = "",
    is_paid: str = "",
    overview_done: str = "",
    skip_reason_category: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    user: dict[str, Any] = Depends(require_login),
) -> dict[str, Any]:
    perms = user["_perms"]
    if not (has_perm(perms, "inquiry.view_all") or has_perm(perms, "inquiry.view_own")):
        raise HTTPException(status_code=403, detail="无权限查看询标")
    only_uid = None if has_perm(perms, "inquiry.view_all") else int(user["id"])
    items, total = q.list_inquiries(
        q=q_text,
        project_name=project_name,
        platform_name=platform_name,
        is_bid=is_bid,
        is_registered=is_registered,
        file_received=file_received,
        is_paid=is_paid,
        overview_done=overview_done,
        skip_reason_category=skip_reason_category,
        date_from=date_from,
        date_to=date_to,
        only_user_id=only_uid,
        limit=limit,
        offset=offset,
    )
    return {"total": total, "items": items}


@app.post("/api/inquiries")
def api_create_inquiry(
    body: InquiryBody,
    user: dict[str, Any] = Depends(require_perm("inquiry.create")),
) -> dict[str, Any]:
    item = q.create_inquiry(body.model_dump(), int(user["id"]))
    q.add_audit(int(user["id"]), user["username"], "inquiry.create", f"inquiry:{item['id']}", item.get("project_name", "")[:80])
    return {"item": item}


@app.get("/api/inquiries/template")
def api_inquiries_template(
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> Response:
    """下载询标报名固定空模板。"""
    data = empty_inquiries_template_xlsx()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inquiries_template.xlsx"},
    )


@app.get("/api/inquiries/daily-report")
def api_inquiry_daily_report(
    day: str = Query(..., alias="date", description="报名日 YYYY-MM-DD"),
    user: dict[str, Any] = Depends(require_login),
) -> dict[str, Any]:
    """单日询标汇总，供前端导出领导汇报图。"""
    perms = user["_perms"]
    if not (has_perm(perms, "inquiry.view_all") or has_perm(perms, "inquiry.view_own")):
        raise HTTPException(status_code=403, detail="无权限查看询标")
    day = (day or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")
    only_uid = None if has_perm(perms, "inquiry.view_all") else int(user["id"])
    try:
        data = q.inquiry_daily_report(day, only_user_id=only_uid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": data}


@app.get("/api/inquiries/export")
def api_export_inquiries(
    q_text: str = Query("", alias="q"),
    project_name: str = "",
    platform_name: str = "",
    is_bid: str = "",
    is_registered: str = "",
    file_received: str = "",
    is_paid: str = "",
    overview_done: str = "",
    skip_reason_category: str = "",
    date_from: str = "",
    date_to: str = "",
    user: dict[str, Any] = Depends(require_perm("inquiry.export")),
) -> Response:
    only_uid = None if has_perm(user["_perms"], "inquiry.view_all") else int(user["id"])
    items, _ = q.list_inquiries(
        q=q_text,
        project_name=project_name,
        platform_name=platform_name,
        is_bid=is_bid,
        is_registered=is_registered,
        file_received=file_received,
        is_paid=is_paid,
        overview_done=overview_done,
        skip_reason_category=skip_reason_category,
        date_from=date_from,
        date_to=date_to,
        only_user_id=only_uid,
        limit=20000,
        offset=0,
    )
    data = export_inquiries_xlsx(items)
    q.add_audit(int(user["id"]), user["username"], "inquiry.export", "inquiries", f"{len(items)} 条")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inquiries.xlsx"},
    )


@app.post("/api/inquiries/import")
async def api_import_inquiries(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> dict[str, Any]:
    """兼容旧入口：请改用 preview/commit。"""
    raise HTTPException(
        status_code=400,
        detail="请使用新的导入流程：先预览再确认（增量追加 / 全部覆盖）",
    )


@app.post("/api/inquiries/import/preview")
async def api_import_inquiries_preview(
    file: UploadFile = File(...),
    mode: str = Form("incremental"),
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> dict[str, Any]:
    """导入预览：分析新增与冲突（报名时间+平台+项目名相同）。"""
    if mode not in ("incremental", "full"):
        raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
    content = await file.read()
    try:
        rows = parse_inquiries_xlsx(content)
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需有平台或项目名）")

    index = q.build_inquiry_index()
    conflicts: list[dict[str, Any]] = []
    new_count = 0
    for i, row in enumerate(rows):
        key = q.inquiry_match_key(row.get("register_date"), row.get("platform_name"), row.get("project_name"))
        existing = index.get(key) if key.strip() and key != "\n\n" else None
        if mode == "full" or existing is None:
            new_count += 1
            continue
        diffs = q.diff_inquiry_fields(existing, row)
        conflicts.append(
            {
                "row_index": i,
                "existing_id": int(existing["id"]),
                "register_date": row.get("register_date") or "",
                "platform_name": row.get("platform_name") or "",
                "project_name": row.get("project_name") or "",
                "identical": len(diffs) == 0,
                "diffs": diffs,
                "existing": existing,
                "incoming": {**row, "id": 0},
            }
        )

    backup = q.latest_inquiry_backup()
    return {
        "mode": mode,
        "total": len(rows),
        "new_count": new_count if mode == "incremental" else len(rows),
        "conflict_count": len(conflicts) if mode == "incremental" else 0,
        "conflicts": conflicts if mode == "incremental" else [],
        "mode_label": "增量追加" if mode == "incremental" else "全部覆盖",
        "mode_desc": (
            "增量追加：新记录直接写入；报名时间+平台+项目名相同的记录需人工选择「保留」或「覆盖」。"
            if mode == "incremental"
            else "全部覆盖：会先备份当前全部询标报名，再清空表并导入 Excel 全部内容；可一键恢复上一版备份。"
        ),
        "latest_backup": backup,
    }


@app.post("/api/inquiries/import/commit")
async def api_import_inquiries_commit(
    file: UploadFile = File(...),
    mode: str = Form("incremental"),
    decisions_json: str = Form("[]"),
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> dict[str, Any]:
    """确认导入：按模式写入。"""
    if mode not in ("incremental", "full"):
        raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
    try:
        raw_decisions = json.loads(decisions_json or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="decisions_json 不是合法 JSON") from exc

    content = await file.read()
    try:
        rows = parse_inquiries_xlsx(content)
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需有平台或项目名）")

    uid = int(user["id"])

    if mode == "full":
        backup = q.create_inquiry_backup(reason="full_overwrite", user_id=uid)
        cleared = q.clear_all_inquiries()
        inserted = q.bulk_insert_inquiries(rows, uid)
        q.add_audit(
            uid,
            user["username"],
            "inquiry.import_full",
            "inquiries",
            f"清空 {cleared} 条，导入 {inserted} 条，备份#{backup['id']}",
        )
        return {
            "ok": True,
            "mode": mode,
            "inserted": inserted,
            "updated": 0,
            "kept": 0,
            "backup": backup,
        }

    decisions_map: dict[int, str] = {}
    for d in raw_decisions:
        try:
            ri = int(d["row_index"])
            action = str(d.get("action") or "keep")
        except (KeyError, TypeError, ValueError):
            continue
        if action not in ("keep", "overwrite"):
            action = "keep"
        decisions_map[ri] = action

    index = q.build_inquiry_index()
    inserted = 0
    updated = 0
    kept = 0
    for i, row in enumerate(rows):
        key = q.inquiry_match_key(row.get("register_date"), row.get("platform_name"), row.get("project_name"))
        existing = index.get(key) if key.strip() and key != "\n\n" else None
        if existing is None:
            created = q.create_inquiry(row, uid)
            inserted += 1
            index[key] = created
            continue
        action = decisions_map.get(i, "keep")
        if action == "overwrite":
            q.update_inquiry(int(existing["id"]), row, uid)
            updated += 1
            refreshed = q.get_inquiry(int(existing["id"]))
            if refreshed:
                index[key] = refreshed
        else:
            kept += 1

    q.add_audit(
        uid,
        user["username"],
        "inquiry.import_incremental",
        "inquiries",
        f"新增 {inserted}，覆盖 {updated}，保留 {kept}",
    )
    return {
        "ok": True,
        "mode": mode,
        "inserted": inserted,
        "updated": updated,
        "kept": kept,
    }


@app.get("/api/inquiries/backup/latest")
def api_latest_inquiry_backup(
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> dict[str, Any]:
    return {"backup": q.latest_inquiry_backup()}


@app.post("/api/inquiries/backup/restore")
def api_restore_inquiry_backup(
    user: dict[str, Any] = Depends(require_perm("inquiry.import")),
) -> dict[str, Any]:
    result = q.restore_latest_inquiry_backup(int(user["id"]))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message") or "恢复失败")
    q.add_audit(
        int(user["id"]),
        user["username"],
        "inquiry.restore_backup",
        f"backup:{result.get('backup_id')}",
        f"恢复 {result.get('restored')} 条",
    )
    return result


@app.patch("/api/inquiries/{iid}")
def api_update_inquiry(
    iid: int,
    body: InquiryBody,
    user: dict[str, Any] = Depends(require_perm("inquiry.edit")),
) -> dict[str, Any]:
    existing = q.get_inquiry(iid)
    if not existing:
        raise HTTPException(status_code=404, detail="记录不存在")
    if not _can_view_inquiry(user, existing) and not has_perm(user["_perms"], "inquiry.view_all"):
        raise HTTPException(status_code=403, detail="无权限")
    item = q.update_inquiry(iid, body.model_dump(), int(user["id"]))
    q.add_audit(int(user["id"]), user["username"], "inquiry.update", f"inquiry:{iid}", "")
    return {"item": item}


@app.delete("/api/inquiries/{iid}")
def api_delete_inquiry(
    iid: int,
    user: dict[str, Any] = Depends(require_perm("inquiry.delete")),
) -> dict[str, Any]:
    ok = q.delete_inquiry(iid)
    if not ok:
        raise HTTPException(status_code=404, detail="记录不存在")
    q.add_audit(int(user["id"]), user["username"], "inquiry.delete", f"inquiry:{iid}", "")
    return {"ok": True}


@app.post("/api/inquiries/batch-delete")
def api_batch_delete_inquiries(
    body: BatchDeleteBody,
    user: dict[str, Any] = Depends(require_perm("inquiry.delete")),
) -> dict[str, Any]:
    ids = [int(i) for i in body.ids if int(i) > 0]
    if not ids:
        raise HTTPException(status_code=400, detail="请先勾选要删除的记录")
    n = q.delete_inquiries(ids)
    q.add_audit(int(user["id"]), user["username"], "inquiry.batch_delete", "inquiries", f"删除 {n} 条")
    return {"ok": True, "deleted": n}


# ---------------------------------------------------------------------------
# 前端静态托管
# ---------------------------------------------------------------------------

@app.get("/")
def index_page() -> FileResponse:
    index = WEB_DIST / "index.html"
    if not index.exists():
        return JSONResponse(
            {
                "message": "前端尚未构建。请先 cd apps/web && npm install && npm run build",
                "api": "http://127.0.0.1:5200/docs",
            }
        )
    return FileResponse(index)


@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> FileResponse:
    """SPA 回退；API 已在上方注册。"""
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    candidate = WEB_DIST / full_path
    if candidate.is_file():
        return FileResponse(candidate)
    index = WEB_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="前端未构建")


if __name__ == "__main__":
    print(f"BidTrace API  → http://{HOST}:{PORT}")
    print(f"SQLite        → {DB_PATH}")
    print(f"API 文档      → http://127.0.0.1:{PORT}/docs")
    uvicorn.run("serve:app", host=HOST, port=PORT, reload=False)
