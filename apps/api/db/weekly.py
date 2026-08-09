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
    """工作周：周日到周六。"""
    d = ref or date.today()
    # weekday: 周一=0 … 周日=6 → 回退到本周日
    start = d - timedelta(days=(d.weekday() + 1) % 7)
    end = start + timedelta(days=6)
    return start, end


def week_label(start: date, end: date) -> str:
    """展示用：20260809-0815。"""
    return f"{start.strftime('%Y%m%d')}-{end.strftime('%m%d')}"


def parse_week_start(raw: str) -> date:
    """解析日期，并归一到该日所在周的周日。"""
    s = (raw or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        d = date.fromisoformat(s[:10])
    elif len(s) == 8 and s.isdigit():
        d = date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    else:
        raise ValueError("week_start 格式应为 YYYY-MM-DD")
    start, _ = week_bounds(d)
    return start


def _loads_items(raw: Any) -> list[dict[str, str]]:
    try:
        data = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        data = None
    out: list[dict[str, str]] = []
    if isinstance(data, list):
        for it in data:
            if not isinstance(it, dict):
                continue
            title = str(it.get("title") or "").strip()
            body = str(it.get("body") or "").strip()
            if title or body:
                out.append({"title": title, "body": body})
        return out
    # 兼容旧版：problems/solutions 曾是纯文本
    text = str(raw or "").strip()
    if text and not text.startswith("["):
        return [{"title": "", "body": text}]
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
    item["problem_items"] = _loads_items(item.get("problems"))
    item["solution_items"] = _loads_items(item.get("solutions"))
    # 前端统一用 items；去掉旧字符串字段避免混淆
    item.pop("problems", None)
    item.pop("solutions", None)
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
            ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', 'draft')
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
    if "problem_items" in data:
        fields.append("problems = ?")
        values.append(_dumps_items(data.get("problem_items")))
    if "solution_items" in data:
        fields.append("solutions = ?")
        values.append(_dumps_items(data.get("solution_items")))
    # 兼容旧请求体
    if "problems" in data and "problem_items" not in data:
        fields.append("problems = ?")
        values.append(_dumps_items([{"title": "", "body": str(data.get("problems") or "")}]))
    if "solutions" in data and "solution_items" not in data:
        fields.append("solutions = ?")
        values.append(_dumps_items([{"title": "", "body": str(data.get("solutions") or "")}]))
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


def list_submitted_reports_for_week(week_start: str) -> list[dict[str, Any]]:
    """指定周已提交周报（用于组长合并导出；不含草稿/其他周）。"""
    start = parse_week_start(week_start)
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT *
            FROM weekly_reports
            WHERE week_start = ? AND status = 'submitted'
            ORDER BY display_name ASC, username ASC, id ASC
            """,
            (start.isoformat(),),
        ).fetchall()
        return [_public(_row_to_dict(r)) for r in rows]
    finally:
        conn.close()


def empty_content() -> dict[str, list[dict[str, str]]]:
    return {
        "done_items": [],
        "problem_items": [],
        "solution_items": [],
        "plan_items": [],
    }


def content_from_report(item: Optional[dict[str, Any]]) -> dict[str, list[dict[str, str]]]:
    if not item:
        return empty_content()
    return {
        "done_items": list(item.get("done_items") or []),
        "problem_items": list(item.get("problem_items") or []),
        "solution_items": list(item.get("solution_items") or []),
        "plan_items": list(item.get("plan_items") or []),
    }


def content_nonempty(content: dict[str, Any]) -> bool:
    for key in ("done_items", "problem_items", "solution_items", "plan_items"):
        if content.get(key):
            return True
    return False


def get_template(user_id: int) -> dict[str, Any]:
    """读取个人常用模板；没有则返回空。"""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM weekly_templates WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        out = empty_content()
        out["has_template"] = False
        return out
    raw = _row_to_dict(row)
    out = {
        "done_items": _loads_items(raw.get("done_items")),
        "problem_items": _loads_items(raw.get("problems")),
        "solution_items": _loads_items(raw.get("solutions")),
        "plan_items": _loads_items(raw.get("plan_items")),
        "updated_at": raw.get("updated_at"),
    }
    out["has_template"] = content_nonempty(out)
    return out


def save_template(user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    """覆盖保存个人常用模板。"""
    done = _dumps_items(data.get("done_items"))
    problems = _dumps_items(data.get("problem_items"))
    solutions = _dumps_items(data.get("solution_items"))
    plans = _dumps_items(data.get("plan_items"))
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO weekly_templates (
              user_id, done_items, problems, solutions, plan_items, updated_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
            ON CONFLICT(user_id) DO UPDATE SET
              done_items = excluded.done_items,
              problems = excluded.problems,
              solutions = excluded.solutions,
              plan_items = excluded.plan_items,
              updated_at = datetime('now','localtime')
            """,
            (user_id, done, problems, solutions, plans),
        )
        conn.commit()
    finally:
        conn.close()
    return get_template(user_id)


def get_prev_week_content(user_id: int, week_start: str) -> dict[str, Any]:
    """取指定周的上一周内容（不自动建草稿）。"""
    start = parse_week_start(week_start)
    prev = (start - timedelta(days=7)).isoformat()
    item = get_user_week_report(user_id, prev)
    content = content_from_report(item)
    return {
        **content,
        "source_week_start": prev,
        "source_week_end": (start - timedelta(days=1)).isoformat(),
        "found": bool(item) and content_nonempty(content),
        "user_id": user_id,
    }


def migrate_weekly_to_sunday_start() -> int:
    """一次性：旧「周一～周日」周键改为「周日～周六」。

    旧周一开周 → 前移一天到周日；若与已有周日记录冲突，保留内容更完整/已提交的那份。
    """
    conn = get_conn()
    changed = 0
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM weekly_reports").fetchall()]
        for row in rows:
            try:
                old_start = date.fromisoformat(str(row["week_start"])[:10])
            except ValueError:
                continue
            # 已是周日则跳过
            if old_start.weekday() == 6:
                continue
            # 旧周一开周：周一(0) → 周日 = 周一 - 1 天；其他异常键统一归一
            if old_start.weekday() == 0:
                new_start = old_start - timedelta(days=1)
            else:
                new_start, _ = week_bounds(old_start)
            if new_start == old_start:
                continue
            new_end = new_start + timedelta(days=6)
            uid = int(row["user_id"])
            rid = int(row["id"])
            conflict = conn.execute(
                "SELECT * FROM weekly_reports WHERE user_id = ? AND week_start = ? AND id != ?",
                (uid, new_start.isoformat(), rid),
            ).fetchone()
            if conflict is None:
                conn.execute(
                    """
                    UPDATE weekly_reports
                    SET week_start = ?, week_end = ?,
                        updated_at = datetime('now','localtime')
                    WHERE id = ?
                    """,
                    (new_start.isoformat(), new_end.isoformat(), rid),
                )
                changed += 1
                continue

            def score(r: Any) -> tuple[int, str]:
                st = 2 if str(r["status"] or "") == "submitted" else 1
                # 有正文再加分
                blob = " ".join(
                    [
                        str(r["done_items"] or ""),
                        str(r["problems"] or ""),
                        str(r["solutions"] or ""),
                        str(r["plan_items"] or ""),
                    ]
                )
                if blob.replace("[]", "").strip():
                    st += 1
                return (st, str(r["updated_at"] or ""))

            if score(row) > score(conflict):
                conn.execute("DELETE FROM weekly_reports WHERE id = ?", (int(conflict["id"]),))
                conn.execute(
                    """
                    UPDATE weekly_reports
                    SET week_start = ?, week_end = ?,
                        updated_at = datetime('now','localtime')
                    WHERE id = ?
                    """,
                    (new_start.isoformat(), new_end.isoformat(), rid),
                )
            else:
                conn.execute("DELETE FROM weekly_reports WHERE id = ?", (rid,))
            changed += 1
        if changed:
            conn.commit()
    finally:
        conn.close()
    return changed

