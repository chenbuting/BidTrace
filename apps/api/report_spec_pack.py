# -*- coding: utf-8 -*-
"""报告规格辅助：规范化 AI 结果，并导出接近样例结构的 Excel。"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font


def _s(v: Any) -> str:
    return str(v or "").strip()


def _list_of_dict(val: Any) -> list[dict[str, Any]]:
    if not isinstance(val, list):
        return []
    return [x for x in val if isinstance(x, dict)]


def normalize_report_spec_result(parsed: Any) -> dict[str, Any]:
    """把模型 JSON 整理成前端/导出可用的统一结构。"""
    data = parsed if isinstance(parsed, dict) else {}

    summary = _s(data.get("summary"))
    warnings: list[str] = []
    for w in data.get("warnings") or []:
        t = _s(w)
        if t:
            warnings.append(t)

    matches: list[dict[str, str]] = []
    for it in _list_of_dict(data.get("matches")):
        target = _s(it.get("target_spec"))
        if not target and not _s(it.get("base_report_no")):
            continue
        matches.append(
            {
                "target_spec": target,
                "base_report_no": _s(it.get("base_report_no")),
                "base_spec": _s(it.get("base_spec")),
                "reason": _s(it.get("reason")),
            }
        )

    changes: list[dict[str, str]] = []
    for it in _list_of_dict(data.get("changes")):
        position = _s(it.get("position") or it.get("field"))
        if not position and not _s(it.get("new_value")):
            continue
        changes.append(
            {
                "target_spec": _s(it.get("target_spec")),
                "position": position,
                "old_value": _s(it.get("old_value")),
                "new_value": _s(it.get("new_value")),
                "must_change": _s(it.get("must_change") or "建议"),
                "note": _s(it.get("note")),
            }
        )

    # 兼容旧版 items → 并入 changes
    for it in _list_of_dict(data.get("items")):
        position = _s(it.get("field") or it.get("position"))
        if not position and not _s(it.get("new_value")):
            continue
        changes.append(
            {
                "target_spec": _s(it.get("target_spec") or it.get("report_no")),
                "position": position,
                "old_value": _s(it.get("old_value")),
                "new_value": _s(it.get("new_value")),
                "must_change": _s(it.get("must_change") or "建议"),
                "note": _s(it.get("note")),
            }
        )

    test_items: list[dict[str, str]] = []
    for it in _list_of_dict(data.get("test_items")):
        item = _s(it.get("item"))
        if not item:
            continue
        test_items.append(
            {
                "target_spec": _s(it.get("target_spec")),
                "seq": _s(it.get("seq")),
                "item": item,
                "unit": _s(it.get("unit")),
                "requirement": _s(it.get("requirement")),
                "result_draft": _s(it.get("result_draft")),
                "rating": _s(it.get("rating")),
                "note": _s(it.get("note")),
            }
        )

    key_params: list[dict[str, str]] = []
    for it in _list_of_dict(data.get("key_params")):
        param = _s(it.get("param"))
        if not param:
            continue
        key_params.append(
            {
                "target_spec": _s(it.get("target_spec")),
                "param": param,
                "ref_value": _s(it.get("ref_value")),
                "note": _s(it.get("note")),
            }
        )

    steps: list[str] = []
    for s in data.get("steps") or []:
        t = _s(s)
        if t:
            steps.append(t)

    # 兼容旧前端：扁平 items
    items = [
        {
            "report_no": c.get("target_spec") or "",
            "field": c.get("position") or "",
            "old_value": c.get("old_value") or "",
            "new_value": c.get("new_value") or "",
            "note": c.get("note") or "",
        }
        for c in changes
    ]

    return {
        "summary": summary,
        "warnings": warnings,
        "matches": matches,
        "changes": changes,
        "test_items": test_items,
        "key_params": key_params,
        "steps": steps,
        "items": items,
    }


def _write_sheet(ws: Any, headers: list[str], rows: list[list[Any]]) -> None:
    bold = Font(bold=True)
    for col, h in enumerate(headers, 1):
        cell = ws.cell(1, col, h)
        cell.font = bold
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for r_i, row in enumerate(rows, 2):
        for c_i, val in enumerate(row, 1):
            cell = ws.cell(r_i, c_i, val)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    widths = [18, 22, 28, 28, 14, 28, 12, 24]
    for i in range(1, len(headers) + 1):
        letter = ws.cell(1, i).column_letter
        ws.column_dimensions[letter].width = widths[i - 1] if i - 1 < len(widths) else 18


def build_report_spec_xlsx(result: dict[str, Any]) -> bytes:
    """导出多工作表 Excel（接近「修改说明 + 检验项目表」结构）。"""
    wb = Workbook()

    # 总说明
    ws0 = wb.active
    ws0.title = "怎么改-总说明"
    ws0["A1"] = "报告规格修改说明（AI 参考稿）"
    ws0["A1"].font = Font(bold=True, size=13)
    ws0["A3"] = "总览"
    ws0["B3"] = result.get("summary") or ""
    ws0["A4"] = "重要提醒"
    warn = result.get("warnings") or []
    ws0["B4"] = (
        "；".join(warn)
        if warn
        else "检验结果列为示例草稿，正式报告必须换实测值；企标不一致处以企标为准。"
    )
    ws0["A6"] = "建议套用哪一份样例"
    ws0["A6"].font = Font(bold=True)
    headers_m = ["目标规格", "最接近样例报告编号", "样例原规格", "原因"]
    for c, h in enumerate(headers_m, 1):
        cell = ws0.cell(7, c, h)
        cell.font = Font(bold=True)
    for i, m in enumerate(result.get("matches") or [], 8):
        ws0.cell(i, 1, m.get("target_spec") or "")
        ws0.cell(i, 2, m.get("base_report_no") or "")
        ws0.cell(i, 3, m.get("base_spec") or "")
        ws0.cell(i, 4, m.get("reason") or "")
    for col, w in enumerate([28, 22, 28, 40], 1):
        ws0.column_dimensions[ws0.cell(7, col).column_letter].width = w
    ws0.column_dimensions["B"].width = 48

    # 修改说明
    ws1 = wb.create_sheet("修改说明")
    _write_sheet(
        ws1,
        ["目标规格", "位置", "原样例内容", "建议改为", "是否必须改", "备注"],
        [
            [
                c.get("target_spec") or "",
                c.get("position") or "",
                c.get("old_value") or "",
                c.get("new_value") or "",
                c.get("must_change") or "",
                c.get("note") or "",
            ]
            for c in (result.get("changes") or [])
        ],
    )

    # 检验项目表
    ws2 = wb.create_sheet("检验项目表")
    _write_sheet(
        ws2,
        ["目标规格", "序号", "检验项目", "单位", "技术要求", "检验结果（示例草稿）", "单项评定", "说明"],
        [
            [
                t.get("target_spec") or "",
                t.get("seq") or "",
                t.get("item") or "",
                t.get("unit") or "",
                t.get("requirement") or "",
                t.get("result_draft") or "",
                t.get("rating") or "",
                t.get("note") or "",
            ]
            for t in (result.get("test_items") or [])
        ],
    )

    # 关键参数
    ws3 = wb.create_sheet("关键参数参考")
    _write_sheet(
        ws3,
        ["目标规格", "项目", "常用参考值", "说明"],
        [
            [
                k.get("target_spec") or "",
                k.get("param") or "",
                k.get("ref_value") or "",
                k.get("note") or "",
            ]
            for k in (result.get("key_params") or [])
        ],
    )

    # 操作步骤
    ws4 = wb.create_sheet("操作步骤清单")
    ws4["A1"] = "实操步骤（按顺序做）"
    ws4["A1"].font = Font(bold=True)
    for i, step in enumerate(result.get("steps") or [], 3):
        ws4.cell(i, 1, step)
    ws4.column_dimensions["A"].width = 80

    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue()
