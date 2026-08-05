# -*- coding: utf-8 -*-
"""投标项目与投标保证金数据库读写。"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from .session import get_conn

# ---------------------------------------------------------------------------
# 字段定义
# ---------------------------------------------------------------------------

PROJECT_FIELDS = [
    "serial_no",
    "open_time",
    "bidder",
    "project_name",
    "platform",
    "remark",
    "is_won",
    "win_amount",
    "is_void",
    "bid_amount",
    "payment_method",
]

PROJECT_FIELD_LABELS: dict[str, str] = {
    "serial_no": "序号",
    "open_time": "开标时间",
    "bidder": "投标员",
    "project_name": "项目名称",
    "platform": "平台",
    "remark": "备注",
    "is_won": "是/否中标",
    "win_amount": "中标金额",
    "is_void": "是/否废标",
    "bid_amount": "投标金额",
    "payment_method": "付款方式",
}

# 匹配键字段（对比时跳过）
PROJECT_MATCH_FIELDS = ("open_time", "project_name", "platform")

DEPOSIT_FIELDS = [
    "serial_no",
    "apply_time",
    "project_name",
    "payee",
    "platform",
    "amount",
    "bidder",
    "is_returned",
    "return_contact",
    "remark",
]

DEPOSIT_FIELD_LABELS: dict[str, str] = {
    "serial_no": "序号",
    "apply_time": "申请时间",
    "project_name": "项目名称",
    "payee": "收款单位",
    "platform": "平台",
    "amount": "金额（万元）",
    "bidder": "投标员",
    "is_returned": "是否退回",
    "return_contact": "保证金退回联系方式",
    "remark": "备注",
}

DEPOSIT_MATCH_FIELDS = ("apply_time", "project_name", "payee")


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def _norm_key_part(v: Any) -> str:
    return str(v or "").strip()


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


def _open_date_for_calendar(raw: str) -> str:
    """从开标时间抽出日历用日期 YYYY-MM-DD。

    兼容：2026-05-14、2026-5-14、2026-02-02-9:00、2025-10-27-9:30:00。
    """
    import re

    s = (raw or "").strip()
    if not s:
        return ""
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


def project_match_key(open_time: Any, project_name: Any, platform: Any) -> str:
    """开标时间+项目名称+平台作为匹配键。"""
    return (
        f"{_normalize_date(_norm_key_part(open_time))}\n"
        f"{_norm_key_part(project_name)}\n"
        f"{_norm_key_part(platform)}"
    )


def deposit_match_key(apply_time: Any, project_name: Any, payee: Any) -> str:
    """申请时间+项目名称+收款单位作为匹配键。"""
    return (
        f"{_normalize_date(_norm_key_part(apply_time))}\n"
        f"{_norm_key_part(project_name)}\n"
        f"{_norm_key_part(payee)}"
    )


def _build_index(
    items: list[dict[str, Any]],
    match_fn: Callable[[dict[str, Any]], str],
) -> dict[str, dict[str, Any]]:
    """按匹配键建索引（同键取 id 最小的一条）。"""
    index: dict[str, dict[str, Any]] = {}
    for item in items:
        key = match_fn(item)
        if not key.strip() or key == "\n\n":
            continue
        prev = index.get(key)
        if prev is None or int(item["id"]) < int(prev["id"]):
            index[key] = item
    return index


def build_project_index() -> dict[str, dict[str, Any]]:
    """投标项目匹配索引。"""
    items, _ = list_bid_projects(limit=20000, offset=0)
    return _build_index(
        items,
        lambda r: project_match_key(r.get("open_time"), r.get("project_name"), r.get("platform")),
    )


def build_deposit_index() -> dict[str, dict[str, Any]]:
    """投标保证金匹配索引。"""
    items, _ = list_bid_deposits(limit=20000, offset=0)
    return _build_index(
        items,
        lambda r: deposit_match_key(r.get("apply_time"), r.get("project_name"), r.get("payee")),
    )


def _diff_fields(
    existing: dict[str, Any],
    incoming: dict[str, Any],
    fields: list[str],
    labels: dict[str, str],
    skip_fields: tuple[str, ...],
) -> list[dict[str, Any]]:
    """对比字段差异（跳过序号与匹配键）。"""
    diffs: list[dict[str, Any]] = []
    for field in fields:
        if field in skip_fields:
            continue
        old_s = _norm_key_part(existing.get(field, ""))
        new_s = _norm_key_part(incoming.get(field, ""))
        if old_s != new_s:
            diffs.append(
                {
                    "field": field,
                    "label": labels.get(field, field),
                    "old": old_s,
                    "new": new_s,
                }
            )
    return diffs


def diff_project_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> list[dict[str, Any]]:
    """投标项目字段差异。"""
    return _diff_fields(
        existing,
        incoming,
        PROJECT_FIELDS,
        PROJECT_FIELD_LABELS,
        ("serial_no", *PROJECT_MATCH_FIELDS),
    )


def diff_deposit_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> list[dict[str, Any]]:
    """投标保证金字段差异。"""
    return _diff_fields(
        existing,
        incoming,
        DEPOSIT_FIELDS,
        DEPOSIT_FIELD_LABELS,
        ("serial_no", *DEPOSIT_MATCH_FIELDS),
    )


# ---------------------------------------------------------------------------
# 投标项目 CRUD
# ---------------------------------------------------------------------------

def list_bid_projects(
    *,
    q: str = "",
    project_name: str = "",
    platform: str = "",
    bidder: str = "",
    is_won: str = "",
    is_void: str = "",
    open_time_from: str = "",
    open_time_to: str = "",
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """分页列出投标项目。"""
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append("(project_name LIKE ? OR platform LIKE ? OR bidder LIKE ? OR remark LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like])
    if project_name:
        clauses.append("project_name LIKE ?")
        params.append(f"%{project_name}%")
    if platform:
        clauses.append("platform LIKE ?")
        params.append(f"%{platform}%")
    if bidder:
        clauses.append("bidder LIKE ?")
        params.append(f"%{bidder}%")
    if is_won:
        clauses.append("is_won = ?")
        params.append(is_won)
    if is_void:
        clauses.append("is_void = ?")
        params.append(is_void)
    if open_time_from:
        clauses.append("open_time >= ?")
        params.append(open_time_from)
    if open_time_to:
        clauses.append("open_time <= ?")
        params.append(open_time_to)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM bid_projects{where}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM bid_projects{where} ORDER BY open_time DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def get_bid_project(pid: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM bid_projects WHERE id = ?", (pid,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def create_bid_project(data: dict[str, Any], user_id: Optional[int]) -> dict[str, Any]:
    data = dict(data)
    data["open_time"] = _normalize_date(str(data.get("open_time") or ""))
    cols = PROJECT_FIELDS + ["created_by", "updated_by"]
    values = [data.get(k, "") for k in PROJECT_FIELDS]
    values.extend([user_id, user_id])
    placeholders = ", ".join("?" for _ in cols)
    conn = get_conn()
    try:
        cur = conn.execute(
            f"INSERT INTO bid_projects ({', '.join(cols)}) VALUES ({placeholders})",
            values,
        )
        conn.commit()
        pid = int(cur.lastrowid)
    finally:
        conn.close()
    item = get_bid_project(pid)
    assert item
    return item


def update_bid_project(pid: int, data: dict[str, Any], user_id: Optional[int]) -> Optional[dict[str, Any]]:
    data = dict(data)
    if "open_time" in data:
        data["open_time"] = _normalize_date(str(data.get("open_time") or ""))
    fields: list[str] = []
    values: list[Any] = []
    for k in PROJECT_FIELDS:
        if k in data:
            fields.append(f"{k} = ?")
            values.append(data[k])
    if not fields:
        return get_bid_project(pid)
    fields.append("updated_by = ?")
    values.append(user_id)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(pid)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE bid_projects SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_bid_project(pid)


def delete_bid_project(pid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM bid_projects WHERE id = ?", (pid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_bid_projects(ids: list[int]) -> int:
    if not ids:
        return 0
    conn = get_conn()
    try:
        placeholders = ", ".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM bid_projects WHERE id IN ({placeholders})", ids)
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def bulk_insert_bid_projects(rows: list[dict[str, Any]], user_id: Optional[int]) -> int:
    if not rows:
        return 0
    conn = get_conn()
    try:
        for data in rows:
            item = dict(data)
            item["open_time"] = _normalize_date(str(item.get("open_time") or ""))
            cols = PROJECT_FIELDS + ["created_by", "updated_by"]
            values = [item.get(k, "") for k in PROJECT_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO bid_projects ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def clear_all_bid_projects() -> int:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM bid_projects")
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def create_bid_project_backup(
    *,
    reason: str,
    user_id: Optional[int],
    keep_latest: int = 5,
) -> dict[str, Any]:
    items, _ = list_bid_projects(limit=20000, offset=0)
    payload = [{k: row.get(k) for k in ["id", *PROJECT_FIELDS]} for row in items]
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO bid_project_backups (reason, row_count, payload, created_by)
            VALUES (?, ?, ?, ?)
            """,
            (reason, len(payload), json.dumps(payload, ensure_ascii=False), user_id),
        )
        conn.commit()
        backup_id = int(cur.lastrowid)
        conn.execute(
            """
            DELETE FROM bid_project_backups
            WHERE id NOT IN (
                SELECT id FROM bid_project_backups ORDER BY id DESC LIMIT ?
            )
            """,
            (keep_latest,),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": backup_id, "row_count": len(payload), "reason": reason}


def latest_bid_project_backup() -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT id, reason, row_count, created_by, created_at
            FROM bid_project_backups
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def restore_latest_bid_project_backup(user_id: Optional[int]) -> dict[str, Any]:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT id, reason, row_count, payload, created_at FROM bid_project_backups ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {"ok": False, "restored": 0, "message": "没有可恢复的备份"}
        backup = _row_to_dict(row)
        payload = json.loads(backup.get("payload") or "[]")
        conn.execute("DELETE FROM bid_projects")
        for data in payload:
            cols = PROJECT_FIELDS + ["created_by", "updated_by"]
            values = [data.get(k, "") for k in PROJECT_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO bid_projects ({', '.join(cols)}) VALUES ({placeholders})",
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


def list_project_bidders() -> list[str]:
    """投标员下拉选项（去重排序）。"""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT TRIM(bidder) AS bidder
            FROM bid_projects
            WHERE TRIM(COALESCE(bidder, '')) != ''
            ORDER BY bidder COLLATE NOCASE
            """
        ).fetchall()
        return [str(r["bidder"]) for r in rows if r["bidder"]]
    finally:
        conn.close()


def bid_project_calendar(year: int, month: int, bidder: str = "") -> dict[str, Any]:
    """按月汇总开标排班：开标时间 + 投标员。

    无开标时间的不进日历格子，单独返回 unscheduled_count。
    """
    if month < 1 or month > 12:
        raise ValueError("month 必须是 1-12")
    if year < 2000 or year > 2100:
        raise ValueError("year 超出合理范围")

    prefix = f"{year:04d}-{month:02d}-"
    bidder_q = (bidder or "").strip()

    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM bid_projects ORDER BY id ASC").fetchall()
        by_date: dict[str, list[dict[str, Any]]] = {}
        unscheduled = 0
        month_total = 0

        for row in rows:
            item = _row_to_dict(row)
            name = str(item.get("bidder") or "").strip()
            if bidder_q and name != bidder_q:
                continue
            ot = _open_date_for_calendar(str(item.get("open_time") or ""))
            if not ot:
                unscheduled += 1
                continue
            if not ot.startswith(prefix):
                continue

            slim = {
                "id": item["id"],
                "open_time": ot,
                "open_time_raw": str(item.get("open_time") or ""),
                "bidder": name or "未填写",
                "project_name": item.get("project_name") or "",
                "platform": item.get("platform") or "",
                "is_won": item.get("is_won") or "",
                "is_void": item.get("is_void") or "",
                "remark": item.get("remark") or "",
            }
            by_date.setdefault(ot, []).append(slim)
            month_total += 1

        for _day, items in by_date.items():
            items.sort(key=lambda x: (x.get("bidder") or "", x.get("project_name") or "", int(x["id"])))

        days = [
            {
                "date": d,
                "count": len(items),
                "bidders": sorted({x["bidder"] for x in items}),
            }
            for d, items in sorted(by_date.items())
        ]

        return {
            "year": year,
            "month": month,
            "bidder": bidder_q,
            "month_total": month_total,
            "unscheduled_count": unscheduled,
            "bidders": list_project_bidders(),
            "days": days,
            "by_date": by_date,
            "suggest": _latest_open_month(conn),
        }
    finally:
        conn.close()


def _latest_open_month(conn: Any) -> Optional[dict[str, int]]:
    """找最近一条能解析的开标日期所在年月，供空月提示跳转。"""
    rows = conn.execute(
        "SELECT open_time FROM bid_projects WHERE TRIM(COALESCE(open_time,'')) != '' ORDER BY id DESC LIMIT 500"
    ).fetchall()
    best: Optional[str] = None
    for r in rows:
        d = _open_date_for_calendar(str(r["open_time"] or ""))
        if not d:
            continue
        if best is None or d > best:
            best = d
    if not best:
        return None
    return {"year": int(best[0:4]), "month": int(best[5:7])}


# ---------------------------------------------------------------------------
# 投标保证金 CRUD
# ---------------------------------------------------------------------------

def list_bid_deposits(
    *,
    q: str = "",
    project_name: str = "",
    platform: str = "",
    payee: str = "",
    bidder: str = "",
    is_returned: str = "",
    apply_time_from: str = "",
    apply_time_to: str = "",
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """分页列出投标保证金。"""
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append("(project_name LIKE ? OR payee LIKE ? OR platform LIKE ? OR bidder LIKE ? OR remark LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like, like])
    if project_name:
        clauses.append("project_name LIKE ?")
        params.append(f"%{project_name}%")
    if platform:
        clauses.append("platform LIKE ?")
        params.append(f"%{platform}%")
    if payee:
        clauses.append("payee LIKE ?")
        params.append(f"%{payee}%")
    if bidder:
        clauses.append("bidder LIKE ?")
        params.append(f"%{bidder}%")
    if is_returned:
        clauses.append("is_returned = ?")
        params.append(is_returned)
    if apply_time_from:
        clauses.append("apply_time >= ?")
        params.append(apply_time_from)
    if apply_time_to:
        clauses.append("apply_time <= ?")
        params.append(apply_time_to)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM bid_deposits{where}", params).fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM bid_deposits{where} ORDER BY apply_time DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [_row_to_dict(r) for r in rows], total
    finally:
        conn.close()


def get_bid_deposit(did: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM bid_deposits WHERE id = ?", (did,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def create_bid_deposit(data: dict[str, Any], user_id: Optional[int]) -> dict[str, Any]:
    data = dict(data)
    data["apply_time"] = _normalize_date(str(data.get("apply_time") or ""))
    cols = DEPOSIT_FIELDS + ["created_by", "updated_by"]
    values = [data.get(k, "") for k in DEPOSIT_FIELDS]
    values.extend([user_id, user_id])
    placeholders = ", ".join("?" for _ in cols)
    conn = get_conn()
    try:
        cur = conn.execute(
            f"INSERT INTO bid_deposits ({', '.join(cols)}) VALUES ({placeholders})",
            values,
        )
        conn.commit()
        did = int(cur.lastrowid)
    finally:
        conn.close()
    item = get_bid_deposit(did)
    assert item
    return item


def update_bid_deposit(did: int, data: dict[str, Any], user_id: Optional[int]) -> Optional[dict[str, Any]]:
    data = dict(data)
    if "apply_time" in data:
        data["apply_time"] = _normalize_date(str(data.get("apply_time") or ""))
    fields: list[str] = []
    values: list[Any] = []
    for k in DEPOSIT_FIELDS:
        if k in data:
            fields.append(f"{k} = ?")
            values.append(data[k])
    if not fields:
        return get_bid_deposit(did)
    fields.append("updated_by = ?")
    values.append(user_id)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(did)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE bid_deposits SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_bid_deposit(did)


def delete_bid_deposit(did: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM bid_deposits WHERE id = ?", (did,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_bid_deposits(ids: list[int]) -> int:
    if not ids:
        return 0
    conn = get_conn()
    try:
        placeholders = ", ".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM bid_deposits WHERE id IN ({placeholders})", ids)
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def bulk_insert_bid_deposits(rows: list[dict[str, Any]], user_id: Optional[int]) -> int:
    if not rows:
        return 0
    conn = get_conn()
    try:
        for data in rows:
            item = dict(data)
            item["apply_time"] = _normalize_date(str(item.get("apply_time") or ""))
            cols = DEPOSIT_FIELDS + ["created_by", "updated_by"]
            values = [item.get(k, "") for k in DEPOSIT_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO bid_deposits ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def clear_all_bid_deposits() -> int:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM bid_deposits")
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


def create_bid_deposit_backup(
    *,
    reason: str,
    user_id: Optional[int],
    keep_latest: int = 5,
) -> dict[str, Any]:
    items, _ = list_bid_deposits(limit=20000, offset=0)
    payload = [{k: row.get(k) for k in ["id", *DEPOSIT_FIELDS]} for row in items]
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO bid_deposit_backups (reason, row_count, payload, created_by)
            VALUES (?, ?, ?, ?)
            """,
            (reason, len(payload), json.dumps(payload, ensure_ascii=False), user_id),
        )
        conn.commit()
        backup_id = int(cur.lastrowid)
        conn.execute(
            """
            DELETE FROM bid_deposit_backups
            WHERE id NOT IN (
                SELECT id FROM bid_deposit_backups ORDER BY id DESC LIMIT ?
            )
            """,
            (keep_latest,),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": backup_id, "row_count": len(payload), "reason": reason}


def latest_bid_deposit_backup() -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT id, reason, row_count, created_by, created_at
            FROM bid_deposit_backups
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def restore_latest_bid_deposit_backup(user_id: Optional[int]) -> dict[str, Any]:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT id, reason, row_count, payload, created_at FROM bid_deposit_backups ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {"ok": False, "restored": 0, "message": "没有可恢复的备份"}
        backup = _row_to_dict(row)
        payload = json.loads(backup.get("payload") or "[]")
        conn.execute("DELETE FROM bid_deposits")
        for data in payload:
            cols = DEPOSIT_FIELDS + ["created_by", "updated_by"]
            values = [data.get(k, "") for k in DEPOSIT_FIELDS]
            values.extend([user_id, user_id])
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO bid_deposits ({', '.join(cols)}) VALUES ({placeholders})",
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
