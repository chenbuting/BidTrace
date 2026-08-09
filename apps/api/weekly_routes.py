# -*- coding: utf-8 -*-
"""周报（工作报表）API。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from db import queries as q
from db import weekly as w
from excel_io import export_weekly_report_xlsx
from permissions import has_perm


class WeeklyItem(BaseModel):
    title: str = ""
    body: str = ""


class WeeklySaveBody(BaseModel):
    display_name: str = ""
    done_items: list[WeeklyItem] = Field(default_factory=list)
    problem_items: list[WeeklyItem] = Field(default_factory=list)
    solution_items: list[WeeklyItem] = Field(default_factory=list)
    plan_items: list[WeeklyItem] = Field(default_factory=list)


def create_weekly_router(
    require_login: Callable[..., Any],
    require_perm: Callable[..., Any],
    require_any_perm: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/weekly", tags=["weekly"])

    def _can_view(user: dict[str, Any], report: dict[str, Any]) -> bool:
        perms = user["_perms"]
        if has_perm(perms, "weekly.view_all"):
            return True
        if has_perm(perms, "weekly.view_own") and int(report["user_id"]) == int(user["id"]):
            return True
        return False

    def _can_edit(user: dict[str, Any], report: dict[str, Any]) -> bool:
        perms = user["_perms"]
        own = int(report["user_id"]) == int(user["id"])
        if own and has_perm(perms, "weekly.edit_own"):
            return True
        if (not own) and has_perm(perms, "weekly.edit_others"):
            return True
        return False

    @router.get("/meta")
    def api_weekly_meta(
        week_start: str = Query(""),
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        """当前/指定自然周信息。"""
        _ = user
        if week_start.strip():
            try:
                start = w.parse_week_start(week_start)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            end = start + timedelta(days=6)
        else:
            start, end = w.week_bounds()
        today = date.today()
        cur, _ = w.week_bounds(today)
        options = []
        for i in range(0, 8):
            s = cur - timedelta(days=7 * i)
            e = s + timedelta(days=6)
            options.append(
                {
                    "week_start": s.isoformat(),
                    "week_end": e.isoformat(),
                    "week_label": w.week_label(s, e),
                }
            )
        return {
            "week_start": start.isoformat(),
            "week_end": end.isoformat(),
            "week_label": w.week_label(start, end),
            "options": options,
        }

    @router.get("/mine")
    def api_weekly_mine(
        week_start: str = Query(""),
        user: dict[str, Any] = Depends(require_any_perm("weekly.view_own", "weekly.view_all")),
    ) -> dict[str, Any]:
        """我的周报（有编辑权则自动建草稿）。"""
        if week_start.strip():
            try:
                start = w.parse_week_start(week_start)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            start, _ = w.week_bounds()
        if has_perm(user["_perms"], "weekly.edit_own"):
            item = w.ensure_user_week_report(
                user_id=int(user["id"]),
                username=str(user["username"]),
                display_name=str(user.get("display_name") or user["username"]),
                week_start=start.isoformat(),
            )
        else:
            item = w.get_user_week_report(int(user["id"]), start.isoformat())
            if not item:
                raise HTTPException(status_code=404, detail="本周还没有周报")
        return {"item": item}

    @router.get("/stats")
    def api_weekly_stats(
        week_start: str = Query(""),
        user: dict[str, Any] = Depends(require_perm("weekly.view_all")),
    ) -> dict[str, Any]:
        """组长：本周交报统计。"""
        _ = user
        if week_start.strip():
            try:
                start = w.parse_week_start(week_start)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            start, _ = w.week_bounds()
        return w.week_submission_stats(start.isoformat())

    @router.get("/reports")
    def api_list_weekly_reports(
        week_start: str = Query(""),
        status: str = Query(""),
        limit: int = Query(200, ge=1, le=500),
        offset: int = Query(0, ge=0),
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        perms = user["_perms"]
        only_uid: Optional[int] = None
        if has_perm(perms, "weekly.view_all"):
            only_uid = None
        elif has_perm(perms, "weekly.view_own"):
            only_uid = int(user["id"])
        else:
            raise HTTPException(status_code=403, detail="无周报查看权限")
        items, total = w.list_reports(
            week_start=week_start.strip(),
            user_id=only_uid,
            status=status.strip(),
            limit=limit,
            offset=offset,
        )
        return {"total": total, "items": items}

    @router.get("/reports/{rid}")
    def api_get_weekly_report(
        rid: int,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        if not _can_view(user, item):
            raise HTTPException(status_code=403, detail="无权限查看")
        return {"item": item}

    @router.put("/reports/{rid}")
    def api_save_weekly_report(
        rid: int,
        body: WeeklySaveBody,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        if not _can_edit(user, item):
            raise HTTPException(status_code=403, detail="无权限编辑")
        if item.get("status") == "submitted" and not has_perm(user["_perms"], "weekly.edit_others"):
            # 已提交后本人不可直接改，需先退回
            raise HTTPException(status_code=400, detail="已提交的周报请先退回草稿再修改")
        payload = body.model_dump()
        if not payload.get("display_name"):
            payload["display_name"] = item.get("display_name") or user.get("display_name") or user["username"]
        updated = w.update_report(rid, payload)
        q.add_audit(int(user["id"]), user["username"], "weekly.save", f"weekly:{rid}", "")
        return {"item": updated}

    @router.post("/reports/{rid}/submit")
    def api_submit_weekly_report(
        rid: int,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        if not _can_edit(user, item):
            raise HTTPException(status_code=403, detail="无权限提交")
        if int(item["user_id"]) != int(user["id"]) and not has_perm(user["_perms"], "weekly.edit_others"):
            raise HTTPException(status_code=403, detail="只能提交自己的周报")
        done = item.get("done_items") or []
        problems = item.get("problem_items") or []
        plans = item.get("plan_items") or []
        if not done and not problems and not plans and not (item.get("solution_items") or []):
            raise HTTPException(status_code=400, detail="请至少填写所做事项、所遇问题、解决意见或预期工作")
        updated = w.submit_report(rid)
        q.add_audit(int(user["id"]), user["username"], "weekly.submit", f"weekly:{rid}", "")
        return {"item": updated}

    @router.post("/reports/{rid}/reopen")
    def api_reopen_weekly_report(
        rid: int,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        own = int(item["user_id"]) == int(user["id"])
        if own and has_perm(user["_perms"], "weekly.edit_own"):
            pass
        elif has_perm(user["_perms"], "weekly.edit_others"):
            pass
        else:
            raise HTTPException(status_code=403, detail="无权限退回")
        updated = w.reopen_report(rid)
        q.add_audit(int(user["id"]), user["username"], "weekly.reopen", f"weekly:{rid}", "")
        return {"item": updated}

    @router.get("/reports/{rid}/export")
    def api_export_weekly_report(
        rid: int,
        user: dict[str, Any] = Depends(require_login),
    ) -> Response:
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        if not _can_view(user, item):
            raise HTTPException(status_code=403, detail="无权限导出")
        data = export_weekly_report_xlsx(item)
        safe = f"weekly-{item.get('week_label') or 'report'}-{item.get('id')}.xlsx"
        q.add_audit(int(user["id"]), user["username"], "weekly.export", f"weekly:{rid}", safe)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={safe}"},
        )

    return router


def mount_weekly_routes(app: Any, deps: dict[str, Any]) -> None:
    """挂载周报路由。"""
    router = create_weekly_router(
        deps["require_login"],
        deps["require_perm"],
        deps["require_any_perm"],
    )
    app.include_router(router)
