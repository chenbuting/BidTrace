# -*- coding: utf-8 -*-
"""报告规格辅助：规范化 AI 结果，并导出接近样例结构的 Excel。"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# 导出配色：表头/必须改/建议/示例结果等，方便扫一眼
FILL_TITLE = PatternFill("solid", fgColor="FFF1EB")
FILL_HEADER = PatternFill("solid", fgColor="1F4E79")
FILL_LABEL = PatternFill("solid", fgColor="D6E3F0")
FILL_WARN = PatternFill("solid", fgColor="FFF3CD")
FILL_MUST = PatternFill("solid", fgColor="FCE8E6")
FILL_SUGGEST = PatternFill("solid", fgColor="E8F5E9")
FILL_NEW = PatternFill("solid", fgColor="C8E6C9")
FILL_DRAFT = PatternFill("solid", fgColor="FFF8E1")
FILL_PARAM = PatternFill("solid", fgColor="E3F2FD")
FILL_STEP = PatternFill("solid", fgColor="F5F5F5")
FILL_ALT = PatternFill("solid", fgColor="FAFAF8")
FILL_P = PatternFill("solid", fgColor="C8E6C9")
FILL_F = PatternFill("solid", fgColor="FFCDD2")
FILL_N = PatternFill("solid", fgColor="E0E0E0")

FONT_HEADER = Font(bold=True, color="FFFFFF")
FONT_TITLE = Font(bold=True, size=13, color="C2410C")
FONT_BOLD = Font(bold=True)
FONT_WARN = Font(bold=True, color="B54708")
ALIGN_TOP = Alignment(wrap_text=True, vertical="top")


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


def _paint(cell: Any, fill: PatternFill | None = None, font: Font | None = None) -> None:
    if fill is not None:
        cell.fill = fill
    if font is not None:
        cell.font = font
    cell.alignment = ALIGN_TOP


def _is_must(text: str) -> bool:
    t = (text or "").strip()
    return "必须" in t and "非必须" not in t


def _rating_fill(rating: str) -> PatternFill | None:
    r = (rating or "").strip().upper()
    if r == "P":
        return FILL_P
    if r == "F":
        return FILL_F
    if r in {"N", "/"}:
        return FILL_N
    return None


def _write_sheet(
    ws: Any,
    headers: list[str],
    rows: list[list[Any]],
    *,
    must_col: int | None = None,
    new_col: int | None = None,
    draft_col: int | None = None,
    rating_col: int | None = None,
    param_col: int | None = None,
) -> None:
    """写表头+数据行，并按列/必须改着色。"""
    for col, h in enumerate(headers, 1):
        cell = ws.cell(1, col, h)
        _paint(cell, FILL_HEADER, FONT_HEADER)
    for r_i, row in enumerate(rows, 2):
        must = False
        if must_col and must_col <= len(row):
            must = _is_must(str(row[must_col - 1] or ""))
        row_fill = FILL_MUST if must else (FILL_ALT if r_i % 2 == 0 else None)
        for c_i, val in enumerate(row, 1):
            cell = ws.cell(r_i, c_i, val)
            fill = row_fill
            font = None
            if new_col and c_i == new_col:
                fill = FILL_NEW
            elif draft_col and c_i == draft_col:
                fill = FILL_DRAFT
            elif param_col and c_i == param_col:
                fill = FILL_PARAM
            elif must_col and c_i == must_col:
                fill = FILL_MUST if must else FILL_SUGGEST
                font = FONT_BOLD
            elif rating_col and c_i == rating_col:
                fill = _rating_fill(str(val)) or fill
            _paint(cell, fill, font)
    widths = [18, 22, 28, 28, 14, 28, 12, 24]
    for i in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(i)].width = (
            widths[i - 1] if i - 1 < len(widths) else 18
        )


def _safe_sheet_title(name: str, used: set[str]) -> str:
    """Excel 工作表名合法化（最长31，去非法字符，避免重名）。"""
    bad = set(r"\/*?:[]")
    base = "".join(ch for ch in (name or "规格").strip() if ch not in bad) or "规格"
    base = base[:28]
    title = base
    i = 2
    while title in used:
        suffix = f"_{i}"
        title = (base[: 31 - len(suffix)] + suffix)[:31]
        i += 1
    used.add(title)
    return title


def build_report_spec_xlsx(result: dict[str, Any]) -> bytes:
    """导出多工作表 Excel（接近「修改说明 + 检验项目表」结构，带底色区分）。"""
    wb = Workbook()
    used_titles: set[str] = set()

    # 使用说明
    ws_help = wb.active
    ws_help.title = _safe_sheet_title("使用说明", used_titles)
    ws_help["A1"] = "检验报告规格修改参考包（AI 生成）"
    _paint(ws_help["A1"], FILL_TITLE, FONT_TITLE)
    ws_help.merge_cells("A1:B1")
    help_rows = [
        ("用途", "对照报告封面与检验项目表进行改规格；可直接按表修改 Word 后人工复核。"),
        ("模板", "支持不同机构/版式的报告模板；具体字段以当前上传文档为准，由 AI 识别。"),
        ("修改说明", "列出位置、原文、建议新值、是否必须改。红色底=必须改，绿色底=建议。"),
        ("检验项目表", "对齐报告检验项目：技术要求 + 结果示例草稿；黄色底结果列非正式实测。"),
        ("单项评定", "P符合(绿) / F不符合(红) / N不判定(灰) / /本项无；正式以实测为准。"),
        ("重要", "电阻、厚度等请按现行国标/企标复核；禁止把示例结果当正式检测数据。"),
        ("色例-必须改", "浅红底"),
        ("色例-建议改", "浅绿底"),
        ("色例-建议新值", "绿色底"),
        ("色例-结果草稿", "黄色底"),
        ("色例-参考参数", "蓝色底"),
    ]
    ws_help["A3"] = "项目"
    ws_help["B3"] = "说明"
    _paint(ws_help["A3"], FILL_HEADER, FONT_HEADER)
    _paint(ws_help["B3"], FILL_HEADER, FONT_HEADER)
    for i, (a, b) in enumerate(help_rows, 4):
        ca = ws_help.cell(i, 1, a)
        cb = ws_help.cell(i, 2, b)
        fill = None
        if "必须" in a:
            fill = FILL_MUST
        elif "建议改" in a:
            fill = FILL_SUGGEST
        elif "新值" in a:
            fill = FILL_NEW
        elif "草稿" in a:
            fill = FILL_DRAFT
        elif "参数" in a:
            fill = FILL_PARAM
        elif a == "重要":
            fill = FILL_WARN
        _paint(ca, fill or FILL_LABEL, FONT_BOLD if a == "重要" else None)
        _paint(cb, fill or (FILL_WARN if a == "重要" else None), FONT_WARN if a == "重要" else None)
    ws_help.column_dimensions["A"].width = 14
    ws_help.column_dimensions["B"].width = 72

    # 总说明
    ws0 = wb.create_sheet(_safe_sheet_title("怎么改-总说明", used_titles))
    ws0["A1"] = "报告规格修改说明（AI 参考稿）"
    _paint(ws0["A1"], FILL_TITLE, FONT_TITLE)
    ws0.merge_cells("A1:D1")
    ws0["A3"] = "总览"
    ws0["B3"] = result.get("summary") or ""
    _paint(ws0["A3"], FILL_LABEL, FONT_BOLD)
    _paint(ws0["B3"])
    ws0["A4"] = "重要提醒"
    warn = result.get("warnings") or []
    ws0["B4"] = (
        "；".join(warn)
        if warn
        else "检验结果列为示例草稿，正式报告必须换实测值；企标不一致处以企标为准。"
    )
    _paint(ws0["A4"], FILL_WARN, FONT_WARN)
    _paint(ws0["B4"], FILL_WARN)
    ws0["A6"] = "建议套用哪一份样例"
    _paint(ws0["A6"], FILL_TITLE, FONT_BOLD)
    headers_m = ["目标规格", "最接近样例报告编号", "样例原规格", "原因"]
    for c, h in enumerate(headers_m, 1):
        cell = ws0.cell(7, c, h)
        _paint(cell, FILL_HEADER, FONT_HEADER)
    for i, m in enumerate(result.get("matches") or [], 8):
        vals = [
            m.get("target_spec") or "",
            m.get("base_report_no") or "",
            m.get("base_spec") or "",
            m.get("reason") or "",
        ]
        for c, v in enumerate(vals, 1):
            cell = ws0.cell(i, c, v)
            _paint(cell, FILL_ALT if i % 2 == 0 else None)
    for col, w in enumerate([28, 22, 28, 40], 1):
        ws0.column_dimensions[get_column_letter(col)].width = w
    ws0.column_dimensions["B"].width = 48

    # 修改说明（全量）
    ws1 = wb.create_sheet(_safe_sheet_title("修改说明", used_titles))
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
        must_col=5,
        new_col=4,
    )

    # 检验项目总表
    all_tests = list(result.get("test_items") or [])
    ws2 = wb.create_sheet(_safe_sheet_title("检验项目表-汇总", used_titles))
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
            for t in all_tests
        ],
        draft_col=6,
        rating_col=7,
    )

    # 按目标规格拆分检验项目表（更接近样例 Excel）
    by_spec: dict[str, list[dict[str, Any]]] = {}
    for t in all_tests:
        key = (t.get("target_spec") or "").strip() or "未命名规格"
        by_spec.setdefault(key, []).append(t)
    for spec, rows in by_spec.items():
        short = spec if len(spec) <= 24 else spec[:24]
        ws = wb.create_sheet(_safe_sheet_title(short, used_titles))
        ws["A1"] = f"试样型号和规格：{spec}"
        _paint(ws["A1"], FILL_TITLE, FONT_TITLE)
        ws.merge_cells("A1:G1")
        ws["A2"] = "【检验结果列为示例草稿（黄底），正式报告请替换为实测值】"
        _paint(ws["A2"], FILL_WARN, FONT_WARN)
        ws.merge_cells("A2:G2")
        headers = ["序号", "检验项目", "单位", "技术要求", "检验结果（示例草稿）", "单项评定", "说明"]
        for c, h in enumerate(headers, 1):
            cell = ws.cell(4, c, h)
            _paint(cell, FILL_HEADER, FONT_HEADER)
        for r_i, t in enumerate(rows, 5):
            vals = [
                t.get("seq") or "",
                t.get("item") or "",
                t.get("unit") or "",
                t.get("requirement") or "",
                t.get("result_draft") or "",
                t.get("rating") or "",
                t.get("note") or "",
            ]
            for c_i, val in enumerate(vals, 1):
                cell = ws.cell(r_i, c_i, val)
                fill = FILL_ALT if r_i % 2 == 0 else None
                if c_i == 5:
                    fill = FILL_DRAFT
                elif c_i == 6:
                    fill = _rating_fill(str(val)) or fill
                _paint(cell, fill)
        for i, w in enumerate([10, 22, 10, 28, 28, 10, 24], 1):
            ws.column_dimensions[get_column_letter(i)].width = w

    # 关键参数
    ws3 = wb.create_sheet(_safe_sheet_title("关键参数参考", used_titles))
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
        param_col=3,
    )

    # 操作步骤
    ws4 = wb.create_sheet(_safe_sheet_title("操作步骤清单", used_titles))
    ws4["A1"] = "实操步骤（按顺序做）"
    _paint(ws4["A1"], FILL_TITLE, FONT_TITLE)
    for i, step in enumerate(result.get("steps") or [], 3):
        cell = ws4.cell(i, 1, step)
        _paint(cell, FILL_STEP if i % 2 == 0 else FILL_ALT)
    ws4.column_dimensions["A"].width = 80

    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue()
