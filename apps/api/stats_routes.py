# -*- coding: utf-8 -*-
"""投标项目与投标保证金 API 路由。"""

from __future__ import annotations

import json
from typing import Any, Callable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from db import bid_stats as bs
from db import queries as q
from excel_io import (
    TemplateError,
    empty_bid_projects_template_xlsx,
    empty_deposits_template_xlsx,
    export_bid_projects_xlsx,
    export_deposits_xlsx,
    parse_bid_projects_xlsx,
    parse_deposits_xlsx,
)


class BatchDeleteBody(BaseModel):
    ids: list[int] = Field(default_factory=list)


class BidProjectBody(BaseModel):
    serial_no: str = ""
    open_time: str = ""
    bidder: str = ""
    project_name: str = ""
    platform: str = ""
    remark: str = ""
    is_won: str = ""
    win_amount: str = ""
    is_void: str = ""
    bid_amount: str = ""
    payment_method: str = ""


class BidDepositBody(BaseModel):
    serial_no: str = ""
    apply_time: str = ""
    project_name: str = ""
    payee: str = ""
    platform: str = ""
    amount: str = ""
    bidder: str = ""
    is_returned: str = ""
    return_contact: str = ""
    remark: str = ""


class ImportDecision(BaseModel):
    row_index: int
    existing_id: int
    action: str  # keep | overwrite


def create_stats_router(
    require_login: Callable[..., dict[str, Any]],
    require_perm: Callable[[str], Callable[..., dict[str, Any]]],
) -> APIRouter:
    """创建投标统计路由（注入 serve.py 中的认证依赖）。"""

    router = APIRouter(prefix="/api", tags=["stats"])
    
    # -----------------------------------------------------------------------
    # 投标项目
    # -----------------------------------------------------------------------

    @router.get("/bid-projects")
    def api_list_bid_projects(
        q_text: str = Query("", alias="q"),
        project_name: str = "",
        platform: str = "",
        bidder: str = "",
        is_won: str = "",
        is_void: str = "",
        open_time_from: str = "",
        open_time_to: str = "",
        limit: int = Query(200, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        user: dict[str, Any] = Depends(require_perm("project.view")),
    ) -> dict[str, Any]:
        items, total = bs.list_bid_projects(
            q=q_text,
            project_name=project_name,
            platform=platform,
            bidder=bidder,
            is_won=is_won,
            is_void=is_void,
            open_time_from=open_time_from,
            open_time_to=open_time_to,
            limit=limit,
            offset=offset,
        )
        return {"total": total, "items": items}

    @router.get("/bid-projects/calendar")
    def api_bid_projects_calendar(
        year: int = Query(..., ge=2000, le=2100),
        month: int = Query(..., ge=1, le=12),
        bidder: str = "",
        user: dict[str, Any] = Depends(require_perm("project.view")),
    ) -> dict[str, Any]:
        """开标日历 / 投标员排班。"""
        try:
            return bs.bid_project_calendar(year=year, month=month, bidder=bidder)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/bid-projects/template")
    def api_bid_projects_template(
        user: dict[str, Any] = Depends(require_perm("project.import")),
    ) -> Response:
        data = empty_bid_projects_template_xlsx()
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=bid_projects_template.xlsx"},
        )

    @router.get("/bid-projects/export")
    def api_export_bid_projects(
        q_text: str = Query("", alias="q"),
        project_name: str = "",
        platform: str = "",
        bidder: str = "",
        is_won: str = "",
        is_void: str = "",
        open_time_from: str = "",
        open_time_to: str = "",
        user: dict[str, Any] = Depends(require_perm("project.export")),
    ) -> Response:
        items, _ = bs.list_bid_projects(
            q=q_text,
            project_name=project_name,
            platform=platform,
            bidder=bidder,
            is_won=is_won,
            is_void=is_void,
            open_time_from=open_time_from,
            open_time_to=open_time_to,
            limit=20000,
            offset=0,
        )
        data = export_bid_projects_xlsx(items)
        q.add_audit(int(user["id"]), user["username"], "project.export", "bid_projects", f"{len(items)} 条")
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=bid_projects.xlsx"},
        )

    @router.post("/bid-projects/import/preview")
    async def api_import_bid_projects_preview(
        file: UploadFile = File(...),
        mode: str = Form("incremental"),
        user: dict[str, Any] = Depends(require_perm("project.import")),
    ) -> dict[str, Any]:
        if mode not in ("incremental", "full"):
            raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
        content = await file.read()
        try:
            rows = parse_bid_projects_xlsx(content)
        except TemplateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not rows:
            raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需至少有项目名称）")

        index = bs.build_project_index()
        conflicts: list[dict[str, Any]] = []
        new_count = 0
        for i, row in enumerate(rows):
            key = bs.project_match_key(row.get("open_time"), row.get("project_name"), row.get("platform"))
            existing = index.get(key) if key.strip() and key != "\n\n" else None
            if mode == "full" or existing is None:
                new_count += 1
                continue
            diffs = bs.diff_project_fields(existing, row)
            conflicts.append(
                {
                    "row_index": i,
                    "existing_id": int(existing["id"]),
                    "project_name": row.get("project_name") or "",
                    "open_time": row.get("open_time") or "",
                    "platform": row.get("platform") or "",
                    "identical": len(diffs) == 0,
                    "diffs": diffs,
                    "existing": existing,
                    "incoming": {**row, "id": 0},
                }
            )

        backup = bs.latest_bid_project_backup()
        return {
            "mode": mode,
            "total": len(rows),
            "new_count": new_count if mode == "incremental" else len(rows),
            "conflict_count": len(conflicts) if mode == "incremental" else 0,
            "conflicts": conflicts if mode == "incremental" else [],
            "mode_label": "增量追加" if mode == "incremental" else "全部覆盖",
            "mode_desc": (
                "增量追加：新项目直接写入；开标时间+项目名称+平台相同的记录需人工选择「保留」或「覆盖」。"
                if mode == "incremental"
                else "全部覆盖：会先备份当前全部投标项目，再清空表并导入 Excel 全部内容；可一键恢复上一版备份。"
            ),
            "latest_backup": backup,
        }

    @router.post("/bid-projects/import/commit")
    async def api_import_bid_projects_commit(
        file: UploadFile = File(...),
        mode: str = Form("incremental"),
        decisions_json: str = Form("[]"),
        user: dict[str, Any] = Depends(require_perm("project.import")),
    ) -> dict[str, Any]:
        if mode not in ("incremental", "full"):
            raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
        try:
            raw_decisions = json.loads(decisions_json or "[]")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="decisions_json 不是合法 JSON") from exc

        content = await file.read()
        try:
            rows = parse_bid_projects_xlsx(content)
        except TemplateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not rows:
            raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需至少有项目名称）")

        uid = int(user["id"])

        if mode == "full":
            backup = bs.create_bid_project_backup(reason="full_overwrite", user_id=uid)
            cleared = bs.clear_all_bid_projects()
            inserted = bs.bulk_insert_bid_projects(rows, uid)
            q.add_audit(
                uid,
                user["username"],
                "project.import_full",
                "bid_projects",
                f"清空 {cleared} 条，导入 {inserted} 条，备份#{backup['id']}",
            )
            return {"ok": True, "mode": mode, "inserted": inserted, "updated": 0, "kept": 0, "backup": backup}

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

        index = bs.build_project_index()
        inserted = 0
        updated = 0
        kept = 0
        for i, row in enumerate(rows):
            key = bs.project_match_key(row.get("open_time"), row.get("project_name"), row.get("platform"))
            existing = index.get(key) if key.strip() and key != "\n\n" else None
            if existing is None:
                created = bs.create_bid_project(row, uid)
                inserted += 1
                index[key] = created
                continue
            action = decisions_map.get(i, "keep")
            if action == "overwrite":
                bs.update_bid_project(int(existing["id"]), row, uid)
                updated += 1
                refreshed = bs.get_bid_project(int(existing["id"]))
                if refreshed:
                    index[key] = refreshed
            else:
                kept += 1

        q.add_audit(
            uid,
            user["username"],
            "project.import_incremental",
            "bid_projects",
            f"新增 {inserted}，覆盖 {updated}，保留 {kept}",
        )
        return {"ok": True, "mode": mode, "inserted": inserted, "updated": updated, "kept": kept}

    @router.get("/bid-projects/backup/latest")
    def api_latest_bid_project_backup(
        user: dict[str, Any] = Depends(require_perm("project.import")),
    ) -> dict[str, Any]:
        return {"backup": bs.latest_bid_project_backup()}

    @router.post("/bid-projects/backup/restore")
    def api_restore_bid_project_backup(
        user: dict[str, Any] = Depends(require_perm("project.import")),
    ) -> dict[str, Any]:
        result = bs.restore_latest_bid_project_backup(int(user["id"]))
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("message") or "恢复失败")
        q.add_audit(
            int(user["id"]),
            user["username"],
            "project.restore_backup",
            f"backup:{result.get('backup_id')}",
            f"恢复 {result.get('restored')} 条",
        )
        return result

    @router.get("/bid-projects/{pid}")
    def api_get_bid_project(
        pid: int,
        user: dict[str, Any] = Depends(require_perm("project.view")),
    ) -> dict[str, Any]:
        item = bs.get_bid_project(pid)
        if not item:
            raise HTTPException(status_code=404, detail="记录不存在")
        return {"item": item}

    @router.post("/bid-projects")
    def api_create_bid_project(
        body: BidProjectBody,
        user: dict[str, Any] = Depends(require_perm("project.create")),
    ) -> dict[str, Any]:
        item = bs.create_bid_project(body.model_dump(), int(user["id"]))
        q.add_audit(
            int(user["id"]),
            user["username"],
            "project.create",
            f"bid_project:{item['id']}",
            item.get("project_name", "")[:80],
        )
        return {"item": item}

    @router.patch("/bid-projects/{pid}")
    def api_update_bid_project(
        pid: int,
        body: BidProjectBody,
        user: dict[str, Any] = Depends(require_perm("project.edit")),
    ) -> dict[str, Any]:
        existing = bs.get_bid_project(pid)
        if not existing:
            raise HTTPException(status_code=404, detail="记录不存在")
        item = bs.update_bid_project(pid, body.model_dump(), int(user["id"]))
        q.add_audit(int(user["id"]), user["username"], "project.update", f"bid_project:{pid}", "")
        return {"item": item}

    @router.delete("/bid-projects/{pid}")
    def api_delete_bid_project(
        pid: int,
        user: dict[str, Any] = Depends(require_perm("project.delete")),
    ) -> dict[str, Any]:
        ok = bs.delete_bid_project(pid)
        if not ok:
            raise HTTPException(status_code=404, detail="记录不存在")
        q.add_audit(int(user["id"]), user["username"], "project.delete", f"bid_project:{pid}", "")
        return {"ok": True}

    @router.post("/bid-projects/batch-delete")
    def api_batch_delete_bid_projects(
        body: BatchDeleteBody,
        user: dict[str, Any] = Depends(require_perm("project.delete")),
    ) -> dict[str, Any]:
        ids = [int(i) for i in body.ids if int(i) > 0]
        if not ids:
            raise HTTPException(status_code=400, detail="请先勾选要删除的记录")
        n = bs.delete_bid_projects(ids)
        q.add_audit(int(user["id"]), user["username"], "project.batch_delete", "bid_projects", f"删除 {n} 条")
        return {"ok": True, "deleted": n}

    # -----------------------------------------------------------------------
    # 投标保证金
    # -----------------------------------------------------------------------

    @router.get("/bid-deposits")
    def api_list_bid_deposits(
        q_text: str = Query("", alias="q"),
        project_name: str = "",
        platform: str = "",
        payee: str = "",
        bidder: str = "",
        is_returned: str = "",
        apply_time_from: str = "",
        apply_time_to: str = "",
        limit: int = Query(200, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        user: dict[str, Any] = Depends(require_perm("deposit.view")),
    ) -> dict[str, Any]:
        items, total = bs.list_bid_deposits(
            q=q_text,
            project_name=project_name,
            platform=platform,
            payee=payee,
            bidder=bidder,
            is_returned=is_returned,
            apply_time_from=apply_time_from,
            apply_time_to=apply_time_to,
            limit=limit,
            offset=offset,
        )
        return {"total": total, "items": items}

    @router.get("/bid-deposits/template")
    def api_bid_deposits_template(
        user: dict[str, Any] = Depends(require_perm("deposit.import")),
    ) -> Response:
        data = empty_deposits_template_xlsx()
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=bid_deposits_template.xlsx"},
        )

    @router.get("/bid-deposits/export")
    def api_export_bid_deposits(
        q_text: str = Query("", alias="q"),
        project_name: str = "",
        platform: str = "",
        payee: str = "",
        bidder: str = "",
        is_returned: str = "",
        apply_time_from: str = "",
        apply_time_to: str = "",
        user: dict[str, Any] = Depends(require_perm("deposit.export")),
    ) -> Response:
        items, _ = bs.list_bid_deposits(
            q=q_text,
            project_name=project_name,
            platform=platform,
            payee=payee,
            bidder=bidder,
            is_returned=is_returned,
            apply_time_from=apply_time_from,
            apply_time_to=apply_time_to,
            limit=20000,
            offset=0,
        )
        data = export_deposits_xlsx(items)
        q.add_audit(int(user["id"]), user["username"], "deposit.export", "bid_deposits", f"{len(items)} 条")
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=bid_deposits.xlsx"},
        )

    @router.post("/bid-deposits/import/preview")
    async def api_import_bid_deposits_preview(
        file: UploadFile = File(...),
        mode: str = Form("incremental"),
        user: dict[str, Any] = Depends(require_perm("deposit.import")),
    ) -> dict[str, Any]:
        if mode not in ("incremental", "full"):
            raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
        content = await file.read()
        try:
            rows = parse_deposits_xlsx(content)
        except TemplateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not rows:
            raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需有项目名称或收款单位）")

        index = bs.build_deposit_index()
        conflicts: list[dict[str, Any]] = []
        new_count = 0
        for i, row in enumerate(rows):
            key = bs.deposit_match_key(row.get("apply_time"), row.get("project_name"), row.get("payee"))
            existing = index.get(key) if key.strip() and key != "\n\n" else None
            if mode == "full" or existing is None:
                new_count += 1
                continue
            diffs = bs.diff_deposit_fields(existing, row)
            conflicts.append(
                {
                    "row_index": i,
                    "existing_id": int(existing["id"]),
                    "project_name": row.get("project_name") or "",
                    "apply_time": row.get("apply_time") or "",
                    "payee": row.get("payee") or "",
                    "identical": len(diffs) == 0,
                    "diffs": diffs,
                    "existing": existing,
                    "incoming": {**row, "id": 0},
                }
            )

        backup = bs.latest_bid_deposit_backup()
        return {
            "mode": mode,
            "total": len(rows),
            "new_count": new_count if mode == "incremental" else len(rows),
            "conflict_count": len(conflicts) if mode == "incremental" else 0,
            "conflicts": conflicts if mode == "incremental" else [],
            "mode_label": "增量追加" if mode == "incremental" else "全部覆盖",
            "mode_desc": (
                "增量追加：新记录直接写入；申请时间+项目名称+收款单位相同的记录需人工选择「保留」或「覆盖」。"
                if mode == "incremental"
                else "全部覆盖：会先备份当前全部投标保证金，再清空表并导入 Excel 全部内容；可一键恢复上一版备份。"
            ),
            "latest_backup": backup,
        }

    @router.post("/bid-deposits/import/commit")
    async def api_import_bid_deposits_commit(
        file: UploadFile = File(...),
        mode: str = Form("incremental"),
        decisions_json: str = Form("[]"),
        user: dict[str, Any] = Depends(require_perm("deposit.import")),
    ) -> dict[str, Any]:
        if mode not in ("incremental", "full"):
            raise HTTPException(status_code=400, detail="mode 只能是 incremental 或 full")
        try:
            raw_decisions = json.loads(decisions_json or "[]")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="decisions_json 不是合法 JSON") from exc

        content = await file.read()
        try:
            rows = parse_deposits_xlsx(content)
        except TemplateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not rows:
            raise HTTPException(status_code=400, detail="模板正确，但没有有效数据行（需有项目名称或收款单位）")

        uid = int(user["id"])

        if mode == "full":
            backup = bs.create_bid_deposit_backup(reason="full_overwrite", user_id=uid)
            cleared = bs.clear_all_bid_deposits()
            inserted = bs.bulk_insert_bid_deposits(rows, uid)
            q.add_audit(
                uid,
                user["username"],
                "deposit.import_full",
                "bid_deposits",
                f"清空 {cleared} 条，导入 {inserted} 条，备份#{backup['id']}",
            )
            return {"ok": True, "mode": mode, "inserted": inserted, "updated": 0, "kept": 0, "backup": backup}

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

        index = bs.build_deposit_index()
        inserted = 0
        updated = 0
        kept = 0
        for i, row in enumerate(rows):
            key = bs.deposit_match_key(row.get("apply_time"), row.get("project_name"), row.get("payee"))
            existing = index.get(key) if key.strip() and key != "\n\n" else None
            if existing is None:
                created = bs.create_bid_deposit(row, uid)
                inserted += 1
                index[key] = created
                continue
            action = decisions_map.get(i, "keep")
            if action == "overwrite":
                bs.update_bid_deposit(int(existing["id"]), row, uid)
                updated += 1
                refreshed = bs.get_bid_deposit(int(existing["id"]))
                if refreshed:
                    index[key] = refreshed
            else:
                kept += 1

        q.add_audit(
            uid,
            user["username"],
            "deposit.import_incremental",
            "bid_deposits",
            f"新增 {inserted}，覆盖 {updated}，保留 {kept}",
        )
        return {"ok": True, "mode": mode, "inserted": inserted, "updated": updated, "kept": kept}

    @router.get("/bid-deposits/backup/latest")
    def api_latest_bid_deposit_backup(
        user: dict[str, Any] = Depends(require_perm("deposit.import")),
    ) -> dict[str, Any]:
        return {"backup": bs.latest_bid_deposit_backup()}

    @router.post("/bid-deposits/backup/restore")
    def api_restore_bid_deposit_backup(
        user: dict[str, Any] = Depends(require_perm("deposit.import")),
    ) -> dict[str, Any]:
        result = bs.restore_latest_bid_deposit_backup(int(user["id"]))
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("message") or "恢复失败")
        q.add_audit(
            int(user["id"]),
            user["username"],
            "deposit.restore_backup",
            f"backup:{result.get('backup_id')}",
            f"恢复 {result.get('restored')} 条",
        )
        return result

    @router.get("/bid-deposits/{did}")
    def api_get_bid_deposit(
        did: int,
        user: dict[str, Any] = Depends(require_perm("deposit.view")),
    ) -> dict[str, Any]:
        item = bs.get_bid_deposit(did)
        if not item:
            raise HTTPException(status_code=404, detail="记录不存在")
        return {"item": item}

    @router.post("/bid-deposits")
    def api_create_bid_deposit(
        body: BidDepositBody,
        user: dict[str, Any] = Depends(require_perm("deposit.create")),
    ) -> dict[str, Any]:
        item = bs.create_bid_deposit(body.model_dump(), int(user["id"]))
        q.add_audit(
            int(user["id"]),
            user["username"],
            "deposit.create",
            f"bid_deposit:{item['id']}",
            item.get("project_name", "")[:80],
        )
        return {"item": item}

    @router.patch("/bid-deposits/{did}")
    def api_update_bid_deposit(
        did: int,
        body: BidDepositBody,
        user: dict[str, Any] = Depends(require_perm("deposit.edit")),
    ) -> dict[str, Any]:
        existing = bs.get_bid_deposit(did)
        if not existing:
            raise HTTPException(status_code=404, detail="记录不存在")
        item = bs.update_bid_deposit(did, body.model_dump(), int(user["id"]))
        q.add_audit(int(user["id"]), user["username"], "deposit.update", f"bid_deposit:{did}", "")
        return {"item": item}

    @router.delete("/bid-deposits/{did}")
    def api_delete_bid_deposit(
        did: int,
        user: dict[str, Any] = Depends(require_perm("deposit.delete")),
    ) -> dict[str, Any]:
        ok = bs.delete_bid_deposit(did)
        if not ok:
            raise HTTPException(status_code=404, detail="记录不存在")
        q.add_audit(int(user["id"]), user["username"], "deposit.delete", f"bid_deposit:{did}", "")
        return {"ok": True}

    @router.post("/bid-deposits/batch-delete")
    def api_batch_delete_bid_deposits(
        body: BatchDeleteBody,
        user: dict[str, Any] = Depends(require_perm("deposit.delete")),
    ) -> dict[str, Any]:
        ids = [int(i) for i in body.ids if int(i) > 0]
        if not ids:
            raise HTTPException(status_code=400, detail="请先勾选要删除的记录")
        n = bs.delete_bid_deposits(ids)
        q.add_audit(int(user["id"]), user["username"], "deposit.batch_delete", "bid_deposits", f"删除 {n} 条")
        return {"ok": True, "deleted": n}

    return router


def mount_stats_routes(app: Any, deps: dict[str, Any]) -> None:
    """挂载投标统计路由到 FastAPI 应用。

    deps 需包含：
    - require_login: 登录依赖
    - require_perm: 权限依赖工厂
    """
    router = create_stats_router(deps["require_login"], deps["require_perm"])
    app.include_router(router)
