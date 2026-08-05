# -*- coding: utf-8 -*-
"""Excel 导入导出：表头必须与固定模板完全一致，否则拒绝导入。"""

from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any

from openpyxl import Workbook, load_workbook

# 平台账号：中文表头 -> 字段（顺序即固定模板顺序）
PLATFORM_HEADERS = [
    ("平台名称", "name"),
    ("平台网址", "url"),
    ("登录方式", "login_method"),
    ("登录账号", "login_account"),
    ("登录密码", "login_password"),
    ("是否有CA证书", "has_ca"),
    ("CA证书密码", "ca_password"),
    ("平台优先级", "priority"),
    ("平台状态", "status"),
    ("平台权重(0~5)", "weight"),
    ("备注", "remark"),
]

# 询标：中文表头 -> 字段（顺序即固定模板顺序）
INQUIRY_HEADERS = [
    ("报名时间", "register_date"),
    ("平台", "platform_name"),
    ("项目名", "project_name"),
    ("是否投标", "is_bid"),
    ("是否报名", "is_registered"),
    ("文件是否领取", "file_received"),
    ("是否交费", "is_paid"),
    ("概况是否完成", "overview_done"),
    ("未参与原因类别", "skip_reason_category"),
    ("参与状态或未参与详细原因", "skip_reason_detail"),
    ("报名截止时间", "deadline"),
]

# 投标项目：中文表头 -> 字段（顺序即固定模板顺序）
BID_PROJECT_HEADERS = [
    ("序号", "serial_no"),
    ("开标时间", "open_time"),
    ("投标员", "bidder"),
    ("项目名称", "project_name"),
    ("平台", "platform"),
    ("备注", "remark"),
    ("是/否中标", "is_won"),
    ("中标金额", "win_amount"),
    ("是/否废标", "is_void"),
    ("投标金额", "bid_amount"),
    ("付款方式", "payment_method"),
]

# 投标保证金：第 6 列表头必须是字面量「金额\n（万元）」
DEPOSIT_HEADERS = [
    ("序号", "serial_no"),
    ("申请时间", "apply_time"),
    ("项目名称", "project_name"),
    ("收款单位", "payee"),
    ("平台", "platform"),
    ("金额\n（万元）", "amount"),
    ("投标员", "bidder"),
    ("是否退回", "is_returned"),
    ("保证金退回联系方式", "return_contact"),
    ("备注", "remark"),
]


class TemplateError(ValueError):
    """Excel 表头与固定模板不一致。"""


def _cell_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def _to_iso_date(raw: str) -> str:
    """统一成 YYYY-MM-DD，兼容 YYYYMMDD。"""
    s = (raw or "").strip()
    if not s:
        return ""
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s


def _normalize_cell_date(val: Any) -> str:
    """Excel 单元格日期/datetime 尽量规范为 YYYY-MM-DD。"""
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, date):
        return val.strftime("%Y-%m-%d")
    return _to_iso_date(_cell_str(val))


def _read_header_row(ws: Any, expected_count: int) -> list[str]:
    """读取第 1 行表头；只取模板列数，后面若还有非空列也算违规。"""
    headers: list[str] = []
    max_c = max(ws.max_column or 1, expected_count)
    for c in range(1, max_c + 1):
        headers.append(_cell_str(ws.cell(1, c).value))
    return headers


def _validate_headers(actual: list[str], expected: list[tuple[str, str]], kind: str) -> None:
    """表头必须与模板列名、顺序完全一致；不允许缺列、错列、多列。"""
    expected_names = [zh for zh, _ in expected]
    n = len(expected_names)

    # 前面 n 列必须一模一样
    actual_n = actual[:n]
    while len(actual_n) < n:
        actual_n.append("")

    mismatches: list[str] = []
    for i, (got, want) in enumerate(zip(actual_n, expected_names), start=1):
        if got != want:
            mismatches.append(f"第{i}列应为「{want}」，实际为「{got or '（空）'}」")

    # 模板列之后不允许再有非空表头
    extras = [h for h in actual[n:] if h]
    if extras:
        mismatches.append(f"多出了未允许的列：{'、'.join(extras)}")

    if mismatches:
        tpl = "、".join(expected_names)
        raise TemplateError(
            f"{kind}表头与固定模板不一致，已拒绝导入。"
            f"正确表头（按顺序）为：{tpl}。"
            f"问题：{'；'.join(mismatches)}"
        )


def parse_platforms_xlsx(content: bytes) -> list[dict[str, Any]]:
    """解析平台账号 Excel（表头必须完全匹配模板）。"""
    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        ws = wb.active
        headers = _read_header_row(ws, len(PLATFORM_HEADERS))
        _validate_headers(headers, PLATFORM_HEADERS, "平台账号")

        rows: list[dict[str, Any]] = []
        for r in range(2, (ws.max_row or 1) + 1):
            item: dict[str, Any] = {f: ("" if f != "weight" else 0) for _, f in PLATFORM_HEADERS}
            empty = True
            for c, (_, field) in enumerate(PLATFORM_HEADERS, start=1):
                val = ws.cell(r, c).value
                if val is not None and str(val).strip() != "":
                    empty = False
                if field == "weight":
                    try:
                        item[field] = float(val) if val is not None and str(val).strip() != "" else 0
                    except (TypeError, ValueError):
                        item[field] = 0
                else:
                    item[field] = _cell_str(val)
            if not empty and item.get("name"):
                rows.append(item)
        return rows
    finally:
        wb.close()


def export_platforms_xlsx(rows: list[dict[str, Any]], mask_password: bool = True) -> bytes:
    """导出平台账号 Excel。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "投标平台账号数据"
    for i, (zh, _) in enumerate(PLATFORM_HEADERS, start=1):
        ws.cell(1, i, zh)
    for ri, row in enumerate(rows, start=2):
        for ci, (_, field) in enumerate(PLATFORM_HEADERS, start=1):
            val = row.get(field, "")
            if mask_password and field in ("login_password", "ca_password") and val:
                val = "***"
            ws.cell(ri, ci, val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def empty_platforms_template_xlsx() -> bytes:
    """空模板（仅表头）。"""
    return export_platforms_xlsx([], mask_password=False)


def parse_inquiries_xlsx(content: bytes) -> list[dict[str, Any]]:
    """解析询标 Excel（表头必须完全匹配模板）。"""
    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        ws = wb.active
        headers = _read_header_row(ws, len(INQUIRY_HEADERS))
        _validate_headers(headers, INQUIRY_HEADERS, "询标报名")

        rows: list[dict[str, Any]] = []
        for r in range(2, (ws.max_row or 1) + 1):
            item: dict[str, Any] = {f: "" for _, f in INQUIRY_HEADERS}
            empty = True
            for c, (_, field) in enumerate(INQUIRY_HEADERS, start=1):
                val = _cell_str(ws.cell(r, c).value)
                if val:
                    empty = False
                item[field] = val
            if not empty and (item.get("project_name") or item.get("platform_name")):
                item["register_date"] = _to_iso_date(str(item.get("register_date") or ""))
                item["deadline"] = _to_iso_date(str(item.get("deadline") or ""))
                rows.append(item)
        return rows
    finally:
        wb.close()


def export_inquiries_xlsx(rows: list[dict[str, Any]]) -> bytes:
    """导出询标 Excel。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "询标报名跟踪"
    for i, (zh, _) in enumerate(INQUIRY_HEADERS, start=1):
        ws.cell(1, i, zh)
    for ri, row in enumerate(rows, start=2):
        for ci, (_, field) in enumerate(INQUIRY_HEADERS, start=1):
            ws.cell(ri, ci, row.get(field, ""))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def empty_inquiries_template_xlsx() -> bytes:
    """空模板（仅表头）。"""
    return export_inquiries_xlsx([])


def parse_bid_projects_xlsx(content: bytes) -> list[dict[str, Any]]:
    """解析投标项目 Excel（表头必须完全匹配模板）。"""
    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        ws = wb.active
        headers = _read_header_row(ws, len(BID_PROJECT_HEADERS))
        _validate_headers(headers, BID_PROJECT_HEADERS, "投标项目")

        rows: list[dict[str, Any]] = []
        for r in range(2, (ws.max_row or 1) + 1):
            item: dict[str, Any] = {f: "" for _, f in BID_PROJECT_HEADERS}
            empty = True
            for c, (_, field) in enumerate(BID_PROJECT_HEADERS, start=1):
                raw = ws.cell(r, c).value
                if raw is not None and str(raw).strip() != "":
                    empty = False
                if field == "open_time":
                    item[field] = _normalize_cell_date(raw)
                else:
                    item[field] = _cell_str(raw)
            if not empty and item.get("project_name"):
                rows.append(item)
        return rows
    finally:
        wb.close()


def export_bid_projects_xlsx(rows: list[dict[str, Any]]) -> bytes:
    """导出投标项目 Excel。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "投标项目"
    for i, (zh, _) in enumerate(BID_PROJECT_HEADERS, start=1):
        ws.cell(1, i, zh)
    for ri, row in enumerate(rows, start=2):
        for ci, (_, field) in enumerate(BID_PROJECT_HEADERS, start=1):
            ws.cell(ri, ci, row.get(field, ""))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def empty_bid_projects_template_xlsx() -> bytes:
    """投标项目空模板（仅表头）。"""
    return export_bid_projects_xlsx([])


def parse_deposits_xlsx(content: bytes) -> list[dict[str, Any]]:
    """解析投标保证金 Excel（表头必须完全匹配模板）。"""
    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        ws = wb.active
        headers = _read_header_row(ws, len(DEPOSIT_HEADERS))
        _validate_headers(headers, DEPOSIT_HEADERS, "投标保证金")

        rows: list[dict[str, Any]] = []
        for r in range(2, (ws.max_row or 1) + 1):
            item: dict[str, Any] = {f: "" for _, f in DEPOSIT_HEADERS}
            empty = True
            for c, (_, field) in enumerate(DEPOSIT_HEADERS, start=1):
                raw = ws.cell(r, c).value
                if raw is not None and str(raw).strip() != "":
                    empty = False
                if field == "apply_time":
                    item[field] = _normalize_cell_date(raw)
                else:
                    item[field] = _cell_str(raw)
            if not empty and (item.get("project_name") or item.get("payee")):
                rows.append(item)
        return rows
    finally:
        wb.close()


def export_deposits_xlsx(rows: list[dict[str, Any]]) -> bytes:
    """导出投标保证金 Excel。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "投标保证金"
    for i, (zh, _) in enumerate(DEPOSIT_HEADERS, start=1):
        ws.cell(1, i, zh)
    for ri, row in enumerate(rows, start=2):
        for ci, (_, field) in enumerate(DEPOSIT_HEADERS, start=1):
            ws.cell(ri, ci, row.get(field, ""))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def empty_deposits_template_xlsx() -> bytes:
    """投标保证金空模板（仅表头）。"""
    return export_deposits_xlsx([])


def export_weekly_report_xlsx(report: dict[str, Any]) -> bytes:
    """按「工作报表」模板导出单份周报。"""
    from openpyxl.styles import Alignment, Border, Font, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    thin = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="top", wrap_text=True)

    def merge_row(r: int, value: str, *, header: bool = False, height: float = 22) -> None:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
        cell = ws.cell(r, 1, value)
        cell.alignment = center if header else left
        cell.font = Font(bold=True, size=14) if header else Font(size=11)
        for c in range(1, 8):
            ws.cell(r, c).border = thin
        ws.row_dimensions[r].height = height

    display = str(report.get("display_name") or report.get("username") or "")
    week_label = str(report.get("week_label") or "")
    done_items = report.get("done_items") or []
    plan_items = report.get("plan_items") or []
    problems = str(report.get("problems") or "").strip()
    solutions = str(report.get("solutions") or "").strip()

    # 列宽
    for c in range(1, 8):
        ws.column_dimensions[chr(64 + c)].width = 12

    merge_row(1, "工 作 报 表", header=True, height=28)
    ws.merge_cells("A2:E2")
    ws.merge_cells("F2:G2")
    ws.cell(2, 1, f"制表人：{display}")
    ws.cell(2, 6, f"时间：{week_label}")
    for c in range(1, 8):
        ws.cell(2, c).border = thin
        ws.cell(2, c).alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 22

    row = 3
    merge_row(row, "所做事项", header=True)
    row += 1
    if not done_items:
        merge_row(row, "", height=36)
        row += 1
    else:
        for i, it in enumerate(done_items, start=1):
            title = str(it.get("title") or "").strip()
            body = str(it.get("body") or "").strip()
            text = f"{i}.{title}" if title else f"{i}."
            if body:
                text = f"{text}\n\n{body}" if title else f"{i}.{body}"
            merge_row(row, text, height=max(36, 18 + 14 * (1 + text.count("\n"))))
            row += 1

    # 空行分隔
    merge_row(row, "", height=10)
    row += 1
    merge_row(row, "所遇问题", header=True)
    row += 1
    merge_row(row, problems, height=max(36, 18 + 14 * max(1, problems.count("\n"))))
    row += 1
    merge_row(row, "解决意见", header=True)
    row += 1
    merge_row(row, solutions, height=max(36, 18 + 14 * max(1, solutions.count("\n"))))
    row += 1
    merge_row(row, "预期工作", header=True)
    row += 1
    if not plan_items:
        merge_row(row, "", height=36)
    else:
        for i, it in enumerate(plan_items, start=1):
            title = str(it.get("title") or "").strip()
            body = str(it.get("body") or "").strip()
            text = f"{i}.{title}" if title else f"{i}."
            if body:
                text = f"{text}\n{body}" if title else f"{i}.{body}"
            merge_row(row, text, height=max(36, 18 + 14 * (1 + text.count("\n"))))
            row += 1

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
