# -*- coding: utf-8 -*-
"""周报（工作报表）数据库读写。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from .session import get_conn


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def week_bounds(ref: Optional[date] = None) -> tuple[date, date]:
    """自然周：周一到周日。"""
    d = ref or date.today()
    start = d - timedelta(days=d.weekday())
    end = start + timedelta(days=6)
    return start, end


def week_label(start: date, end: date) -> str:
    """展示用：20260726-0801。"""
    return f"{start.strftime('%Y%m%d')}-{end.strftime('%m%d')}"


def parse_week_start(raw: str) -> date:
    s = (raw or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return date.fromisoformat(s[:10])
    if len(s) == 8 and s.isdigit():
        return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    raise ValueError("week_start 格式应为 YYYY-MM-DD")


def _loads_items(raw: Any) -> list[dict[str, str]]:
    try:
        data = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    out: list[dict[str, str]] = []
    if not isinstance(data, list):
        return out
    for it in data:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()
        body = str(it.get("body") or "").strip()
        if title or body:
            out.append({"title": title, "body": body})
    return out


def _dumps_items(items: Any) -> str:
    cleaned: list[dict[str, str]] = []
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            title = str(it.get("title") or "").strip()
            body = str(it.get("body") or "").strip()
            if title or body:
                cleaned.append({"title": title, "body": body})
    return json.dumps(cleaned, ensure_ascii=False)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["done_items"] = _loads_items(item.get("done_items"))
    item["plan_items"] = _loads_items(item.get("plan_items"))
    item["week_label"] = week_label(
        date.fromisoformat(str(item["week_start"])[:10]),
        date.fromisoformat(str(item["week_end"])[:10]),
    )
    return item


def get_report(rid: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM weekly_reports WHERE id = ?", (rid,)).fetchone()
        return _public(_row_to_dict(row)) if row else None
    finally:
        conn.close()


def get_user_week_report(user_id: int, week_start: str) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM weekly_reports WHERE user_id = ? AND week_start = ?",
            (user_id, week_start),
        ).fetchone()
        return _public(_row_to_dict(row)) if row else None
    finally:
        conn.close()


def ensure_user_week_report(
    *,
    user_id: int,
    username: str,
    display_name: str,
    week_start: str,
) -> dict[str, Any]:
    """取本周草稿；没有则创建空草稿。"""
    existing = get_user_week_report(user_id, week_start)
    if existing:
        return existing
    start = parse_week_start(week_start)
    end = start + timedelta(days=6)
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO weekly_reports (
              user_id, username, display_name, week_start, week_end,
              done_items, problems, solutions, plan_items, status
            ) VALUES (?, ?, ?, ?, ?, '[]', '', '', '[]', 'draft')
            """,
            (user_id, username, display_name or username, start.isoformat(), end.isoformat()),
        )
        conn.commit()
        rid = int(cur.lastrowid)
    finally:
        conn.close()
    item = get_report(rid)
    assert item
    return item


def update_report(rid: int, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    """更新草稿内容（不改状态）。"""
    fields = []
    values: list[Any] = []
    if "done_items" in data:
        fields.append("done_items = ?")
        values.append(_dumps_items(data.get("done_items")))
    if "plan_items" in data:
        fields.append("plan_items = ?")
        values.append(_dumps_items(data.get("plan_items")))
    if "problems" in data:
        fields.append("problems = ?")
        values.append(str(data.get("problems") or "").strip())
    if "solutions" in data:
        fields.append("solutions = ?")
        values.append(str(data.get("solutions") or "").strip())
    if "display_name" in data:
        fields.append("display_name = ?")
        values.append(str(data.get("display_name") or "").strip())
    if not fields:
        return get_report(rid)
    fields.append("updated_at = datetime('now','localtime')")
    values.append(rid)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE weekly_reports SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    finally:
        conn.close()
    return get_report(rid)


def submit_report(rid: int) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        conn.execute(
            """
            UPDATE weekly_reports
            SET status = 'submitted',
                submitted_at = datetime('now','localtime'),
                updated_at = datetime('now','localtime')
            WHERE id = ?
            """,
            (rid,),
        )
        conn.commit()
    finally:
        conn.close()
    return get_report(rid)


def reopen_report(rid: int) -> Optional[dict[str, Any]]:
    """退回草稿，便于本人或组长再改。"""
    conn = get_conn()
    try:
        conn.execute(
            """
            UPDATE weekly_reports
            SET status = 'draft',
                submitted_at = NULL,
                updated_at = datetime('now','localtime')
            WHERE id = ?
            """,
            (rid,),
        )
        conn.commit()
    finally:
        conn.close()
    return get_report(rid)


def list_reports(
    *,
    week_start: str = "",
    user_id: Optional[int] = None,
    status: str = "",
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    clauses: list[str] = []
    params: list[Any] = []
    if week_start:
        clauses.append("week_start = ?")
        params.append(week_start)
    if user_id is not None:
        clauses.append("user_id = ?")
        params.append(user_id)
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = get_conn()
    try:
        total = int(conn.execute(f"SELECT COUNT(*) FROM weekly_reports{where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT * FROM weekly_reports{where}
            ORDER BY week_start DESC, display_name ASC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return [_public(_row_to_dict(r)) for r in rows], total
    finally:
        conn.close()


def week_submission_stats(week_start: str) -> dict[str, Any]:
    """组长统计：本周启用用户交报情况。"""
    start = parse_week_start(week_start)
    end = start + timedelta(days=6)
    conn = get_conn()
    try:
        users = conn.execute(
            """
            SELECT id, username, display_name, role
            FROM users
            WHERE COALESCE(is_active, 1) = 1
            ORDER BY id
            """
        ).fetchall()
        reports = {
            int(r["user_id"]): _public(_row_to_dict(r))
            for r in conn.execute(
                "SELECT * FROM weekly_reports WHERE week_start = ?",
                (start.isoformat(),),
            ).fetchall()
        }
    finally:
        conn.close()

    items = []
    submitted = 0
    draft = 0
    missing = 0
    for u in users:
        uid = int(u["id"])
        rep = reports.get(uid)
        if rep and rep.get("status") == "submitted":
            state = "submitted"
            submitted += 1
        elif rep:
            state = "draft"
            draft += 1
        else:
            state = "missing"
            missing += 1
        items.append(
            {
                "user_id": uid,
                "username": u["username"],
                "display_name": u["display_name"] or u["username"],
                "role": u["role"],
                "status": state,
                "report_id": rep["id"] if rep else None,
                "submitted_at": rep.get("submitted_at") if rep else None,
                "updated_at": rep.get("updated_at") if rep else None,
            }
        )
    return {
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "week_label": week_label(start, end),
        "totals": {
            "users": len(items),
            "submitted": submitted,
            "draft": draft,
            "missing": missing,
        },
        "items": items,
    }
