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
    display_name: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    password: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    fields: list[str] = []
    values: list[Any] = []
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


def list_audit(limit: int = 100) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
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
