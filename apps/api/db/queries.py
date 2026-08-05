# -*- coding: utf-8 -*-
"""数据库读写。"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any, Optional

from .session import get_conn

# 重新导出 init / path 供外部用
from .session import DB_PATH, init_db  # noqa: F401


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


# ---------------------------------------------------------------------------
# 密码
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """PBKDF2 哈希密码。"""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """校验密码。"""
    try:
        algo, salt, hexdig = password_hash.split("$", 2)
    except ValueError:
        return False
    if algo != "pbkdf2":
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return hmac.compare_digest(dk.hex(), hexdig)


# ---------------------------------------------------------------------------
# 用户
# ---------------------------------------------------------------------------

def count_users() -> int:
    conn = get_conn()
    try:
        return int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
    finally:
        conn.close()


def get_user_by_username(username: str) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def list_users() -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users ORDER BY id"
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def create_user(
    username: str,
    password: str,
    display_name: str,
    role: str,
) -> dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO users (username, password_hash, display_name, role)
            VALUES (?, ?, ?, ?)
            """,
            (username, hash_password(password), display_name or username, role),
        )
        conn.commit()
        uid = int(cur.lastrowid)
    finally:
        conn.close()
    user = get_user_by_id(uid)
    assert user
    return user


def update_user(
    user_id: int,
    *,
    username: Optional[str] = None,
    display_name: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    password: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    fields: list[str] = []
    values: list[Any] = []
    if username is not None:
        fields.append("username = ?")
        values.append(username)
    if display_name is not None:
        fields.append("display_name = ?")
        values.append(display_name)
    if role is not None:
        fields.append("role = ?")
        values.append(role)
    if is_active is not None:
        fields.append("is_active = ?")
        values.append(1 if is_active else 0)
    if password:
        fields.append("password_hash = ?")
        values.append(hash_password(password))
    if not fields:
        return get_user_by_id(user_id)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(user_id)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_user_by_id(user_id)


def delete_user(user_id: int) -> dict[str, Any]:
    """删除用户及其权限覆盖。"""
    target = get_user_by_id(user_id)
    if not target:
        return {"ok": False, "message": "用户不存在"}
    if str(target.get("username")) == "admin":
        return {"ok": False, "message": "内置管理员账号不能删除"}
    conn = get_conn()
    try:
        conn.execute("DELETE FROM user_permission_overrides WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return {"ok": True, "message": "已删除", "username": target.get("username")}
    finally:
        conn.close()


def get_permission_overrides(user_id: int) -> dict[str, bool]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT permission_code, granted FROM user_permission_overrides WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {str(r["permission_code"]): bool(r["granted"]) for r in rows}
    finally:
        conn.close()


def set_permission_overrides(user_id: int, overrides: dict[str, bool]) -> None:
    """整表替换某人的权限覆盖。"""
    conn = get_conn()
    try:
        conn.execute("DELETE FROM user_permission_overrides WHERE user_id = ?", (user_id,))
        for code, granted in overrides.items():
            conn.execute(
                """
                INSERT INTO user_permission_overrides (user_id, permission_code, granted)
                VALUES (?, ?, ?)
                """,
                (user_id, code, 1 if granted else 0),
            )
        conn.commit()
    finally:
        conn.close()


def ensure_seed_users() -> None:
    """首次启动写入默认账号。"""
    if count_users() > 0:
        return
    create_user("admin", "change-me", "管理员", "admin")
    create_user("leader", "change-me", "投标组长", "leader")
    create_user("xunbiao", "change-me", "询标员", "inquiry")
    create_user("member", "change-me", "专员", "member")


# ---------------------------------------------------------------------------
# 可配置角色
# ---------------------------------------------------------------------------

def ensure_seed_roles() -> None:
    """写入内置角色及默认权限包；已存在的角色不覆盖其权限配置。"""
    from permissions import ALL_PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS

    conn = get_conn()
    try:
        for code, label in ROLE_LABELS.items():
            row = conn.execute("SELECT code FROM roles WHERE code = ?", (code,)).fetchone()
            if not row:
                conn.execute(
                    """
                    INSERT INTO roles (code, label, is_system)
                    VALUES (?, ?, 1)
                    """,
                    (code, label),
                )
                for perm in sorted(ROLE_DEFAULTS.get(code) or set()):
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                        VALUES (?, ?)
                        """,
                        (code, perm),
                    )
            else:
                cnt = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM role_permissions WHERE role_code = ?",
                        (code,),
                    ).fetchone()[0]
                )
                if cnt == 0 and code != "admin":
                    for perm in sorted(ROLE_DEFAULTS.get(code) or set()):
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                            VALUES (?, ?)
                            """,
                            (code, perm),
                        )
                if code == "admin":
                    for perm in ALL_PERMISSIONS:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                            VALUES (?, ?)
                            """,
                            (code, perm),
                        )
        conn.commit()
    finally:
        conn.close()

    migrate_system_permission_codes()


def migrate_system_permission_codes() -> None:
    """迁移旧 system.users → 细项；并补全 admin 的 system.roles。

    注意：不会把旧 system.permissions 自动扩成 system.roles，
    避免「分配权限」再次连带角色管理；admin 角色单独保证全开。
    """
    from permissions import ALL_PERMISSIONS, _LEGACY_PERM_EXPAND

    conn = get_conn()
    try:
        # 角色权限包：展开 system.users
        for legacy, modern in _LEGACY_PERM_EXPAND.items():
            rows = conn.execute(
                "SELECT role_code FROM role_permissions WHERE permission_code = ?",
                (legacy,),
            ).fetchall()
            for r in rows:
                role_code = str(r["role_code"])
                conn.execute(
                    "DELETE FROM role_permissions WHERE role_code = ? AND permission_code = ?",
                    (role_code, legacy),
                )
                for code in modern:
                    if code in ALL_PERMISSIONS:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                            VALUES (?, ?)
                            """,
                            (role_code, code),
                        )

        # 单人覆盖表同样展开
        for legacy, modern in _LEGACY_PERM_EXPAND.items():
            rows = conn.execute(
                "SELECT user_id, granted FROM user_permission_overrides WHERE permission_code = ?",
                (legacy,),
            ).fetchall()
            for r in rows:
                uid = int(r["user_id"])
                granted = int(r["granted"])
                conn.execute(
                    "DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_code = ?",
                    (uid, legacy),
                )
                for code in modern:
                    if code in ALL_PERMISSIONS:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO user_permission_overrides
                              (user_id, permission_code, granted)
                            VALUES (?, ?, ?)
                            """,
                            (uid, code, granted),
                        )

        # 已有「查看投标项目」的角色，默认补开标日历查看权（仅补缺，不强制）
        if "calendar.view" in ALL_PERMISSIONS:
            rows = conn.execute(
                "SELECT DISTINCT role_code FROM role_permissions WHERE permission_code = 'project.view'"
            ).fetchall()
            for r in rows:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                    VALUES (?, 'calendar.view')
                    """,
                    (str(r["role_code"]),),
                )

        # 站内通知：所有角色默认可收；leader 默认可发（仅补缺）
        if "notify.view" in ALL_PERMISSIONS:
            for r in conn.execute("SELECT code FROM roles").fetchall():
                conn.execute(
                    """
                    INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                    VALUES (?, 'notify.view')
                    """,
                    (str(r["code"]),),
                )
        if "notify.send" in ALL_PERMISSIONS:
            conn.execute(
                """
                INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                VALUES ('leader', 'notify.send')
                """
            )

        # admin 角色补全新权限码（含 system.roles / calendar.view / notify.*）
        for perm in ALL_PERMISSIONS:
            conn.execute(
                """
                INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
                VALUES ('admin', ?)
                """,
                (perm,),
            )
        conn.commit()
    finally:
        conn.close()


def list_roles() -> list[dict[str, Any]]:
    """角色列表（含权限数、用户数）。"""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
              r.code,
              r.label,
              r.is_system,
              r.created_at,
              r.updated_at,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_code = r.code) AS perm_count,
              (SELECT COUNT(*) FROM users u WHERE u.role = r.code) AS user_count
            FROM roles r
            ORDER BY r.is_system DESC, r.code ASC
            """
        ).fetchall()
        out = []
        for r in rows:
            item = _row_to_dict(r)
            item["is_system"] = bool(item.get("is_system"))
            out.append(item)
        return out
    finally:
        conn.close()


def get_role(code: str) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM roles WHERE code = ?", (code,)).fetchone()
        if not row:
            return None
        item = _row_to_dict(row)
        item["is_system"] = bool(item.get("is_system"))
        return item
    finally:
        conn.close()


def get_role_permission_codes(role_code: str) -> list[str]:
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT permission_code FROM role_permissions
            WHERE role_code = ?
            ORDER BY permission_code
            """,
            (role_code,),
        ).fetchall()
        return [str(r["permission_code"]) for r in rows]
    finally:
        conn.close()


def create_role(code: str, label: str, *, is_system: bool = False) -> dict[str, Any]:
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO roles (code, label, is_system)
            VALUES (?, ?, ?)
            """,
            (code, label, 1 if is_system else 0),
        )
        conn.commit()
    finally:
        conn.close()
    role = get_role(code)
    assert role
    return role


def update_role_label(code: str, label: str) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        conn.execute(
            """
            UPDATE roles
            SET label = ?, updated_at = datetime('now','localtime')
            WHERE code = ?
            """,
            (label, code),
        )
        conn.commit()
    finally:
        conn.close()
    return get_role(code)


def set_role_permissions(role_code: str, permission_codes: list[str]) -> None:
    """整表替换角色权限包。"""
    from permissions import ALL_PERMISSIONS

    clean = [c for c in permission_codes if c in ALL_PERMISSIONS]
    # admin 强制保留全量
    if role_code == "admin":
        clean = list(ALL_PERMISSIONS.keys())
    conn = get_conn()
    try:
        conn.execute("DELETE FROM role_permissions WHERE role_code = ?", (role_code,))
        for code in clean:
            conn.execute(
                """
                INSERT INTO role_permissions (role_code, permission_code)
                VALUES (?, ?)
                """,
                (role_code, code),
            )
        conn.execute(
            "UPDATE roles SET updated_at = datetime('now','localtime') WHERE code = ?",
            (role_code,),
        )
        conn.commit()
    finally:
        conn.close()


def delete_role(code: str) -> dict[str, Any]:
    """删除非系统角色；有用户占用则失败。"""
    role = get_role(code)
    if not role:
        return {"ok": False, "message": "角色不存在"}
    if role.get("is_system"):
        return {"ok": False, "message": "系统内置角色不能删除"}
    conn = get_conn()
    try:
        n = int(conn.execute("SELECT COUNT(*) FROM users WHERE role = ?", (code,)).fetchone()[0])
        if n > 0:
            return {"ok": False, "message": f"仍有 {n} 个用户使用该角色，请先改用户角色"}
        conn.execute("DELETE FROM role_permissions WHERE role_code = ?", (code,))
        conn.execute("DELETE FROM roles WHERE code = ?", (code,))
        conn.commit()
        return {"ok": True, "message": "已删除"}
    finally:
        conn.close()


def role_exists(code: str) -> bool:
    return get_role(code) is not None


# ---------------------------------------------------------------------------
# 审计
# ---------------------------------------------------------------------------

def add_audit(
    user_id: Optional[int],
    username: str,
    action: str,
    target: str = "",
    detail: str = "",
) -> None:
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO audit_logs (user_id, username, action, target, detail)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, username, action, target, detail),
        )
        conn.commit()
    finally:
        conn.close()


def list_audit(
    *,
    username: str = "",
    action: str = "",
    target: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """分页查询操作日志。"""
    clauses: list[str] = []
    params: list[Any] = []
    if username:
        clauses.append("username LIKE ?")
        params.append(f"%{username.strip()}%")
    if action:
        clauses.append("action LIKE ?")
        params.append(f"%{action.strip()}%")
    if target:
        clauses.append("target LIKE ?")
        params.append(f"%{target.strip()}%")
    if date_from:
        clauses.append("created_at >= ?")
        params.append(date_from.strip())
    if date_to:
        # 含当天：若只给日期则扩到当天结束
        end = date_to.strip()
        if len(end) == 10:
            end = end + " 23:59:59"
        clauses.append("created_at <= ?")
        params.append(end)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM audit_logs{where}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM audit_logs{where} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def list_audit_actions(limit: int = 80) -> list[str]:
    """日志里出现过的 action，供筛选下拉。"""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT action FROM audit_logs
            WHERE TRIM(COALESCE(action,'')) != ''
            ORDER BY action ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [str(r["action"]) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 站内通知
# ---------------------------------------------------------------------------

def list_notify_picker_users() -> list[dict[str, Any]]:
    """发通知时可选的启用用户（精简字段）。"""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT id, username, display_name, role
            FROM users
            WHERE COALESCE(is_active, 1) = 1
            ORDER BY id ASC
            """
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def create_notification(
    *,
    sender_id: int,
    sender_username: str,
    title: str,
    content: str,
    recipient_ids: list[int],
) -> dict[str, Any]:
    """创建通知并写入接收人。"""
    title = (title or "").strip()
    content = (content or "").strip()
    ids = sorted({int(x) for x in recipient_ids if int(x) > 0})
    if not title:
        return {"ok": False, "message": "标题不能为空"}
    if not ids:
        return {"ok": False, "message": "请至少选择一名接收人"}

    conn = get_conn()
    try:
        # 只发给仍启用的用户
        placeholders = ",".join("?" for _ in ids)
        valid_rows = conn.execute(
            f"""
            SELECT id FROM users
            WHERE id IN ({placeholders}) AND COALESCE(is_active, 1) = 1
            """,
            ids,
        ).fetchall()
        valid_ids = [int(r["id"]) for r in valid_rows]
        if not valid_ids:
            return {"ok": False, "message": "没有有效的接收人"}

        cur = conn.execute(
            """
            INSERT INTO notifications (sender_id, sender_username, title, content)
            VALUES (?, ?, ?, ?)
            """,
            (sender_id, sender_username, title, content),
        )
        nid = int(cur.lastrowid)
        conn.executemany(
            """
            INSERT OR IGNORE INTO notification_recipients (notification_id, user_id, read_at)
            VALUES (?, ?, NULL)
            """,
            [(nid, uid) for uid in valid_ids],
        )
        conn.commit()
        return {
            "ok": True,
            "item": {
                "id": nid,
                "sender_id": sender_id,
                "sender_username": sender_username,
                "title": title,
                "content": content,
                "recipient_count": len(valid_ids),
            },
        }
    finally:
        conn.close()


def list_inbox(
    user_id: int,
    *,
    unread_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """当前用户收件箱。"""
    clauses = ["r.user_id = ?"]
    params: list[Any] = [user_id]
    if unread_only:
        clauses.append("r.read_at IS NULL")
    where = " AND ".join(clauses)
    conn = get_conn()
    try:
        total = int(
            conn.execute(
                f"""
                SELECT COUNT(*)
                FROM notification_recipients r
                WHERE {where}
                """,
                params,
            ).fetchone()[0]
        )
        rows = conn.execute(
            f"""
            SELECT
              n.id,
              n.sender_id,
              n.sender_username,
              n.title,
              n.content,
              n.created_at,
              r.read_at,
              CASE WHEN r.read_at IS NULL THEN 1 ELSE 0 END AS is_unread
            FROM notification_recipients r
            JOIN notifications n ON n.id = r.notification_id
            WHERE {where}
            ORDER BY n.id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def count_unread_notifications(user_id: int) -> int:
    conn = get_conn()
    try:
        return int(
            conn.execute(
                """
                SELECT COUNT(*) FROM notification_recipients
                WHERE user_id = ? AND read_at IS NULL
                """,
                (user_id,),
            ).fetchone()[0]
        )
    finally:
        conn.close()


def mark_notification_read(user_id: int, notification_id: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            UPDATE notification_recipients
            SET read_at = datetime('now','localtime')
            WHERE user_id = ? AND notification_id = ? AND read_at IS NULL
            """,
            (user_id, notification_id),
        )
        conn.commit()
        return cur.rowcount > 0 or conn.execute(
            """
            SELECT 1 FROM notification_recipients
            WHERE user_id = ? AND notification_id = ?
            """,
            (user_id, notification_id),
        ).fetchone() is not None
    finally:
        conn.close()


def mark_all_notifications_read(user_id: int) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            UPDATE notification_recipients
            SET read_at = datetime('now','localtime')
            WHERE user_id = ? AND read_at IS NULL
            """,
            (user_id,),
        )
        conn.commit()
        return int(cur.rowcount or 0)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 平台账号
# ---------------------------------------------------------------------------

PLATFORM_FIELDS = [
    "name",
    "url",
    "login_method",
    "login_account",
    "login_password",
    "has_ca",
    "ca_password",
    "priority",
    "status",
    "weight",
    "remark",
]

PLATFORM_FIELD_LABELS: dict[str, str] = {
    "name": "平台名称",
    "url": "平台网址",
    "login_method": "登录方式",
    "login_account": "登录账号",
    "login_password": "登录密码",
    "has_ca": "是否有CA证书",
    "ca_password": "CA证书密码",
    "priority": "平台优先级",
    "status": "平台状态",
    "weight": "平台权重",
    "remark": "备注说明",
}


def _norm_key_part(v: Any) -> str:
    return str(v or "").strip()


def platform_match_key(name: Any, url: Any) -> str:
    """名称+网址去空格后作为匹配键。"""
    return f"{_norm_key_part(name)}\n{_norm_key_part(url)}"


def build_platform_index() -> dict[str, dict[str, Any]]:
    """按 名称+网址 建索引（同键取 id 最小的一条）。"""
    items, _ = list_platforms(limit=20000, offset=0)
    index: dict[str, dict[str, Any]] = {}
    for item in items:
        key = platform_match_key(item.get("name"), item.get("url"))
        if not key.strip() or key == "\n":
            continue
        prev = index.get(key)
        if prev is None or int(item["id"]) < int(prev["id"]):
            index[key] = item
    return index


def diff_platform_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> list[dict[str, Any]]:
    """对比字段差异（不含 id/时间戳）。"""
    diffs: list[dict[str, Any]] = []
    for field in PLATFORM_FIELDS:
        if field in ("name", "url"):
            continue  # 匹配键本身相同，不作为差异列出
        old = existing.get(field, "" if field != "weight" else 0)
        new = incoming.get(field, "" if field != "weight" else 0)
        if field == "weight":
            try:
                old_c = float(old or 0)
            except (TypeError, ValueError):
                old_c = 0.0
            try:
                new_c = float(new or 0)
            except (TypeError, ValueError):
                new_c = 0.0
            same = old_c == new_c
            old_s, new_s = str(old_c), str(new_c)
        else:
            old_s = _norm_key_part(old)
            new_s = _norm_key_part(new)
            same = old_s == new_s
        if not same:
            diffs.append(
                {
                    "field": field,
                    "label": PLATFORM_FIELD_LABELS.get(field, field),
                    "old": old_s,
                    "new": new_s,
                }
            )
    return diffs


def clear_all_platforms() -> int:
    """清空平台账号表。"""
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM platforms")
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def create_platform_backup(
    *,
    reason: str,
    user_id: Optional[int],
    keep_latest: int = 5,
) -> dict[str, Any]:
    """备份当前全部平台账号；只保留最近 keep_latest 份。"""
    import json

    items, _ = list_platforms(limit=20000, offset=0)
    # 备份完整字段（含密码明文，仅服务端存）
    payload = [{k: row.get(k) for k in ["id", *PLATFORM_FIELDS]} for row in items]
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO platform_backups (reason, row_count, payload, created_by)
            VALUES (?, ?, ?, ?)
            """,
            (reason, len(payload), json.dumps(payload, ensure_ascii=False), user_id),
        )
        conn.commit()
        backup_id = int(cur.lastrowid)
        # 删掉过旧备份
        conn.execute(
            """
            DELETE FROM platform_backups
            WHERE id NOT IN (
                SELECT id FROM platform_backups ORDER BY id DESC LIMIT ?
            )
            """,
            (keep_latest,),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": backup_id, "row_count": len(payload), "reason": reason}


def latest_platform_backup() -> Optional[dict[str, Any]]:
    """最近一次平台备份元信息（不含 payload）。"""
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT id, reason, row_count, created_by, created_at
            FROM platform_backups
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def restore_latest_platform_backup(user_id: Optional[int]) -> dict[str, Any]:
    """用最近一次备份覆盖当前平台表。"""
    import json

    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT id, reason, row_count, payload, created_at FROM platform_backups ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {"ok": False, "restored": 0, "message": "没有可恢复的备份"}
        backup = _row_to_dict(row)
        payload = json.loads(backup.get("payload") or "[]")
        conn.execute("DELETE FROM platforms")
        for data in payload:
            cols = PLATFORM_FIELDS + ["created_by", "updated_by"]
            values = [data.get(k, "" if k != "weight" else 0) for k in PLATFORM_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO platforms ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
        conn.commit()
        return {
            "ok": True,
            "restored": len(payload),
            "backup_id": backup["id"],
            "backup_at": backup.get("created_at"),
        }
    finally:
        conn.close()


def list_platforms(
    *,
    q: str = "",
    name: str = "",
    url: str = "",
    login_method: str = "",
    has_ca: str = "",
    status: str = "",
    priority: str = "",
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append("(name LIKE ? OR login_account LIKE ? OR remark LIKE ? OR url LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like])
    if name:
        clauses.append("name LIKE ?")
        params.append(f"%{name}%")
    if url:
        clauses.append("url LIKE ?")
        params.append(f"%{url}%")
    if login_method:
        clauses.append("login_method = ?")
        params.append(login_method)
    if has_ca:
        clauses.append("has_ca = ?")
        params.append(has_ca)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if priority:
        clauses.append("priority = ?")
        params.append(priority)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM platforms{where}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM platforms{where} ORDER BY CASE priority WHEN '高' THEN 1 WHEN '中' THEN 2 WHEN '低' THEN 3 ELSE 4 END, id ASC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def delete_platforms(ids: list[int]) -> int:
    """批量删除平台账号。"""
    if not ids:
        return 0
    conn = get_conn()
    try:
        placeholders = ", ".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM platforms WHERE id IN ({placeholders})", ids)
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def get_platform(pid: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM platforms WHERE id = ?", (pid,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def create_platform(data: dict[str, Any], user_id: Optional[int]) -> dict[str, Any]:
    cols = PLATFORM_FIELDS + ["created_by", "updated_by"]
    values = [data.get(k, "" if k != "weight" else 0) for k in PLATFORM_FIELDS]
    values.extend([user_id, user_id])
    placeholders = ", ".join("?" for _ in cols)
    conn = get_conn()
    try:
        cur = conn.execute(
            f"INSERT INTO platforms ({', '.join(cols)}) VALUES ({placeholders})",
            values,
        )
        conn.commit()
        pid = int(cur.lastrowid)
    finally:
        conn.close()
    item = get_platform(pid)
    assert item
    return item


def update_platform(pid: int, data: dict[str, Any], user_id: Optional[int]) -> Optional[dict[str, Any]]:
    fields = []
    values: list[Any] = []
    for k in PLATFORM_FIELDS:
        if k in data:
            fields.append(f"{k} = ?")
            values.append(data[k])
    if not fields:
        return get_platform(pid)
    fields.append("updated_by = ?")
    values.append(user_id)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(pid)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE platforms SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_platform(pid)


def delete_platform(pid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM platforms WHERE id = ?", (pid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def bulk_insert_platforms(rows: list[dict[str, Any]], user_id: Optional[int]) -> int:
    """批量插入平台（导入用）。"""
    if not rows:
        return 0
    conn = get_conn()
    try:
        for data in rows:
            cols = PLATFORM_FIELDS + ["created_by", "updated_by"]
            values = [data.get(k, "" if k != "weight" else 0) for k in PLATFORM_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO platforms ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def platform_name_options() -> list[str]:
    """询标下拉：启用中的平台名。"""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT DISTINCT name FROM platforms WHERE status != '停用' ORDER BY name"
        ).fetchall()
        return [str(r["name"]) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 询标
# ---------------------------------------------------------------------------

INQUIRY_FIELDS = [
    "register_date",
    "platform_name",
    "project_name",
    "is_bid",
    "is_registered",
    "file_received",
    "is_paid",
    "overview_done",
    "skip_reason_category",
    "skip_reason_detail",
    "deadline",
]


def list_inquiries(
    *,
    q: str = "",
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
    only_user_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append("(project_name LIKE ? OR platform_name LIKE ? OR skip_reason_detail LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if project_name:
        clauses.append("project_name LIKE ?")
        params.append(f"%{project_name}%")
    if platform_name:
        clauses.append("platform_name LIKE ?")
        params.append(f"%{platform_name}%")
    if is_bid:
        clauses.append("is_bid = ?")
        params.append(is_bid)
    if is_registered:
        clauses.append("is_registered = ?")
        params.append(is_registered)
    if file_received:
        clauses.append("file_received = ?")
        params.append(file_received)
    if is_paid:
        clauses.append("is_paid = ?")
        params.append(is_paid)
    if overview_done:
        clauses.append("overview_done = ?")
        params.append(overview_done)
    if skip_reason_category:
        clauses.append("skip_reason_category = ?")
        params.append(skip_reason_category)
    if date_from:
        clauses.append("register_date >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("register_date <= ?")
        params.append(date_to)
    if only_user_id is not None:
        clauses.append("created_by = ?")
        params.append(only_user_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM inquiries{where}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM inquiries{where} ORDER BY register_date DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def get_inquiry(iid: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM inquiries WHERE id = ?", (iid,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def create_inquiry(data: dict[str, Any], user_id: Optional[int]) -> dict[str, Any]:
    data = dict(data)
    data["register_date"] = _normalize_date(str(data.get("register_date") or ""))
    data["deadline"] = _normalize_date(str(data.get("deadline") or ""))
    cols = INQUIRY_FIELDS + ["created_by", "updated_by"]
    values = [data.get(k, "") for k in INQUIRY_FIELDS]
    values.extend([user_id, user_id])
    placeholders = ", ".join("?" for _ in cols)
    conn = get_conn()
    try:
        cur = conn.execute(
            f"INSERT INTO inquiries ({', '.join(cols)}) VALUES ({placeholders})",
            values,
        )
        conn.commit()
        iid = int(cur.lastrowid)
    finally:
        conn.close()
    item = get_inquiry(iid)
    assert item
    return item


def update_inquiry(iid: int, data: dict[str, Any], user_id: Optional[int]) -> Optional[dict[str, Any]]:
    data = dict(data)
    if "register_date" in data:
        data["register_date"] = _normalize_date(str(data.get("register_date") or ""))
    if "deadline" in data:
        data["deadline"] = _normalize_date(str(data.get("deadline") or ""))
    fields = []
    values: list[Any] = []
    for k in INQUIRY_FIELDS:
        if k in data:
            fields.append(f"{k} = ?")
            values.append(data[k])
    if not fields:
        return get_inquiry(iid)
    fields.append("updated_by = ?")
    values.append(user_id)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(iid)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE inquiries SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_inquiry(iid)


def _normalize_date(raw: str) -> str:
    """统一成 YYYY-MM-DD。"""
    s = (raw or "").strip()
    if not s:
        return ""
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s


def delete_inquiry(iid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM inquiries WHERE id = ?", (iid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_inquiries(ids: list[int]) -> int:
    """批量删除询标记录。"""
    if not ids:
        return 0
    conn = get_conn()
    try:
        placeholders = ", ".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM inquiries WHERE id IN ({placeholders})", ids)
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def bulk_insert_inquiries(rows: list[dict[str, Any]], user_id: Optional[int]) -> int:
    if not rows:
        return 0
    conn = get_conn()
    try:
        for data in rows:
            cols = INQUIRY_FIELDS + ["created_by", "updated_by"]
            values = [data.get(k, "") for k in INQUIRY_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO inquiries ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def dashboard_stats() -> dict[str, Any]:
    conn = get_conn()
    try:
        platform_total = int(conn.execute("SELECT COUNT(*) FROM platforms").fetchone()[0])
        platform_active = int(
            conn.execute("SELECT COUNT(*) FROM platforms WHERE status = '启用'").fetchone()[0]
        )
        platform_maintain = int(
            conn.execute("SELECT COUNT(*) FROM platforms WHERE status = '维护中'").fetchone()[0]
        )
        inquiry_total = int(conn.execute("SELECT COUNT(*) FROM inquiries").fetchone()[0])
        bid_yes = int(conn.execute("SELECT COUNT(*) FROM inquiries WHERE is_bid = '是'").fetchone()[0])
        recent = conn.execute(
            """
            SELECT register_date, COUNT(*) AS cnt
            FROM inquiries
            WHERE register_date != ''
            GROUP BY register_date
            ORDER BY register_date DESC
            LIMIT 7
            """
        ).fetchall()
        return {
            "platform_total": platform_total,
            "platform_active": platform_active,
            "platform_maintain": platform_maintain,
            "inquiry_total": inquiry_total,
            "inquiry_bid_yes": bid_yes,
            "recent_by_date": [{"date": r["register_date"], "count": r["cnt"]} for r in recent],
        }
    finally:
        conn.close()


def _label_count_rows(rows: list[Any], empty_label: str = "未标注") -> list[dict[str, Any]]:
    """把 GROUP BY 结果转成 {name,count}，空标签统一成未标注。"""
    out: list[dict[str, Any]] = []
    for r in rows:
        name = str(r["label"] or "").strip() or empty_label
        out.append({"name": name, "count": int(r["cnt"])})
    return out


def _norm_chart_date(raw: Any) -> str:
    """图表日期统一成 YYYY-MM-DD，兼容 YYYYMMDD。"""
    s = str(raw or "").strip()
    if not s:
        return ""
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s


def _merge_trend_rows(rows: list[Any]) -> list[dict[str, Any]]:
    """按归一化日期合并趋势点，并按日期排序。"""
    merged: dict[str, dict[str, int]] = {}
    for r in rows:
        key = _norm_chart_date(r["d"])
        if not key:
            continue
        cell = merged.setdefault(key, {"total": 0, "bid_yes": 0, "bid_no": 0})
        cell["total"] += int(r["total"] or 0)
        cell["bid_yes"] += int(r["bid_yes"] or 0)
        cell["bid_no"] += int(r["bid_no"] or 0)
    return [{"date": k, **merged[k]} for k in sorted(merged.keys())]


def _top_name_counts(
    conn: Any,
    sql: str,
    params: tuple[Any, ...] = (),
    empty_label: str = "未填写",
) -> list[dict[str, Any]]:
    """执行 Top N 查询，返回 {name,count}。"""
    rows = conn.execute(sql, params).fetchall()
    return _label_count_rows(rows, empty_label=empty_label)


def dashboard_charts(days: int = 14) -> dict[str, Any]:
    """数据看板（对齐采集中心风格）：趋势 + 占比 + Top 排行。

    days=0 表示询标趋势统计全部历史日期（只返回有数据的天，避免空白日爆炸）。
    """
    from datetime import date, timedelta

    raw_days = int(days) if days is not None else 14
    all_time = raw_days == 0
    span = 0 if all_time else max(1, min(raw_days, 3650))
    conn = get_conn()
    try:
        today = date.today()
        end_s = today.isoformat()

        if all_time:
            raw_trend = conn.execute(
                """
                SELECT
                  register_date AS d,
                  COUNT(*) AS total,
                  SUM(CASE WHEN TRIM(COALESCE(is_bid, '')) = '是' THEN 1 ELSE 0 END) AS bid_yes,
                  SUM(CASE WHEN TRIM(COALESCE(is_bid, '')) = '否' THEN 1 ELSE 0 END) AS bid_no
                FROM inquiries
                WHERE register_date != ''
                GROUP BY register_date
                ORDER BY register_date ASC
                """
            ).fetchall()
            inquiry_trend = _merge_trend_rows(raw_trend)
        else:
            start = today - timedelta(days=span - 1)
            start_s = start.isoformat()
            # 同时兼容库里 YYYY-MM-DD 与 YYYYMMDD
            start_compact = start.strftime("%Y%m%d")
            end_compact = today.strftime("%Y%m%d")
            raw_trend = conn.execute(
                """
                SELECT
                  register_date AS d,
                  COUNT(*) AS total,
                  SUM(CASE WHEN TRIM(COALESCE(is_bid, '')) = '是' THEN 1 ELSE 0 END) AS bid_yes,
                  SUM(CASE WHEN TRIM(COALESCE(is_bid, '')) = '否' THEN 1 ELSE 0 END) AS bid_no
                FROM inquiries
                WHERE (
                  (register_date >= ? AND register_date <= ?)
                  OR (register_date >= ? AND register_date <= ?)
                )
                GROUP BY register_date
                """,
                (start_s, end_s, start_compact, end_compact),
            ).fetchall()
            by_day = {
                item["date"]: {
                    "total": item["total"],
                    "bid_yes": item["bid_yes"],
                    "bid_no": item["bid_no"],
                }
                for item in _merge_trend_rows(raw_trend)
            }
            inquiry_trend = []
            cur = start
            while cur <= today:
                key = cur.isoformat()
                cell = by_day.get(key, {"total": 0, "bid_yes": 0, "bid_no": 0})
                inquiry_trend.append({"date": key, **cell})
                cur += timedelta(days=1)

        inquiry_bid = _label_count_rows(
            conn.execute(
                """
                SELECT TRIM(COALESCE(is_bid, '')) AS label, COUNT(*) AS cnt
                FROM inquiries
                GROUP BY TRIM(COALESCE(is_bid, ''))
                ORDER BY cnt DESC
                """
            ).fetchall()
        )

        project_result = _label_count_rows(
            conn.execute(
                """
                SELECT
                  CASE
                    WHEN TRIM(COALESCE(is_void, '')) = '是' THEN '废标'
                    WHEN TRIM(COALESCE(is_won, '')) = '是' THEN '中标'
                    WHEN TRIM(COALESCE(is_won, '')) = '否' THEN '未中标'
                    ELSE '未标注'
                  END AS label,
                  COUNT(*) AS cnt
                FROM bid_projects
                GROUP BY label
                ORDER BY cnt DESC
                """
            ).fetchall()
        )

        deposit_return = _label_count_rows(
            conn.execute(
                """
                SELECT TRIM(COALESCE(is_returned, '')) AS label, COUNT(*) AS cnt
                FROM bid_deposits
                GROUP BY TRIM(COALESCE(is_returned, ''))
                ORDER BY cnt DESC
                """
            ).fetchall()
        )

        platform_status = _label_count_rows(
            conn.execute(
                """
                SELECT TRIM(COALESCE(status, '')) AS label, COUNT(*) AS cnt
                FROM platforms
                GROUP BY TRIM(COALESCE(status, ''))
                ORDER BY cnt DESC
                """
            ).fetchall(),
            empty_label="未设置",
        )

        by_inquiry_platform = _top_name_counts(
            conn,
            """
            SELECT TRIM(COALESCE(platform_name, '')) AS label, COUNT(*) AS cnt
            FROM inquiries
            GROUP BY TRIM(COALESCE(platform_name, ''))
            ORDER BY cnt DESC
            LIMIT 12
            """,
            empty_label="未知平台",
        )

        by_skip_reason = _top_name_counts(
            conn,
            """
            SELECT TRIM(COALESCE(skip_reason_category, '')) AS label, COUNT(*) AS cnt
            FROM inquiries
            WHERE TRIM(COALESCE(skip_reason_category, '')) != ''
            GROUP BY TRIM(COALESCE(skip_reason_category, ''))
            ORDER BY cnt DESC
            LIMIT 10
            """,
            empty_label="未分类",
        )

        by_project_bidder = _top_name_counts(
            conn,
            """
            SELECT TRIM(COALESCE(bidder, '')) AS label, COUNT(*) AS cnt
            FROM bid_projects
            GROUP BY TRIM(COALESCE(bidder, ''))
            ORDER BY cnt DESC
            LIMIT 12
            """,
            empty_label="未填写",
        )

        by_project_platform = _top_name_counts(
            conn,
            """
            SELECT TRIM(COALESCE(platform, '')) AS label, COUNT(*) AS cnt
            FROM bid_projects
            GROUP BY TRIM(COALESCE(platform, ''))
            ORDER BY cnt DESC
            LIMIT 12
            """,
            empty_label="未知平台",
        )

        by_deposit_payee = _top_name_counts(
            conn,
            """
            SELECT TRIM(COALESCE(payee, '')) AS label, COUNT(*) AS cnt
            FROM bid_deposits
            GROUP BY TRIM(COALESCE(payee, ''))
            ORDER BY cnt DESC
            LIMIT 10
            """,
            empty_label="未填写",
        )

        inquiry_total = int(conn.execute("SELECT COUNT(*) FROM inquiries").fetchone()[0])
        inquiry_bid_yes = int(
            conn.execute("SELECT COUNT(*) FROM inquiries WHERE TRIM(COALESCE(is_bid,'')) = '是'").fetchone()[0]
        )
        project_total = int(conn.execute("SELECT COUNT(*) FROM bid_projects").fetchone()[0])
        project_won = int(
            conn.execute(
                """
                SELECT COUNT(*) FROM bid_projects
                WHERE TRIM(COALESCE(is_won,'')) = '是'
                  AND TRIM(COALESCE(is_void,'')) != '是'
                """
            ).fetchone()[0]
        )
        deposit_total = int(conn.execute("SELECT COUNT(*) FROM bid_deposits").fetchone()[0])
        deposit_pending = int(
            conn.execute(
                """
                SELECT COUNT(*) FROM bid_deposits
                WHERE TRIM(COALESCE(is_returned,'')) != '是'
                """
            ).fetchone()[0]
        )
        platform_total = int(conn.execute("SELECT COUNT(*) FROM platforms").fetchone()[0])

        return {
            "days": span,
            "totals": {
                "inquiry_total": inquiry_total,
                "inquiry_bid_yes": inquiry_bid_yes,
                "project_total": project_total,
                "project_won": project_won,
                "deposit_total": deposit_total,
                "deposit_pending": deposit_pending,
                "platform_total": platform_total,
            },
            "inquiry_trend": inquiry_trend,
            "inquiry_bid": inquiry_bid,
            "project_result": project_result,
            "deposit_return": deposit_return,
            "platform_status": platform_status,
            "by_inquiry_platform": by_inquiry_platform,
            "by_skip_reason": by_skip_reason,
            "by_project_bidder": by_project_bidder,
            "by_project_platform": by_project_platform,
            "by_deposit_payee": by_deposit_payee,
        }
    finally:
        conn.close()
