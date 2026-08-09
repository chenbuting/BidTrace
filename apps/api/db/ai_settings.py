# -*- coding: utf-8 -*-
"""AI 配置：全局默认 + 个人覆盖（OpenAI 兼容）。"""

from __future__ import annotations

from typing import Any, Optional

from .session import get_conn

SCOPE_SYSTEM = "system"
SCOPE_USER = "user"


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def _mask_key(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return "*" * len(s)
    return s[:4] + "*" * max(4, len(s) - 8) + s[-4:]


def _public(row: dict[str, Any], *, reveal_key: bool = False) -> dict[str, Any]:
    key = str(row.get("api_key") or "")
    return {
        "scope": row.get("scope") or "",
        "owner_id": int(row.get("owner_id") or 0),
        "enabled": bool(int(row.get("enabled") or 0)),
        "base_url": str(row.get("base_url") or "").strip(),
        "api_key": key if reveal_key else "",
        "api_key_masked": _mask_key(key),
        "has_api_key": bool(key.strip()),
        "model": str(row.get("model") or "").strip(),
        "timeout_sec": int(row.get("timeout_sec") or 60),
        "updated_at": row.get("updated_at"),
    }


def _empty(scope: str, owner_id: int = 0) -> dict[str, Any]:
    return {
        "scope": scope,
        "owner_id": owner_id,
        "enabled": False,
        "base_url": "",
        "api_key": "",
        "api_key_masked": "",
        "has_api_key": False,
        "model": "",
        "timeout_sec": 60,
        "updated_at": None,
    }


def get_raw(scope: str, owner_id: int = 0) -> Optional[dict[str, Any]]:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM ai_settings WHERE scope = ? AND owner_id = ?",
            (scope, int(owner_id)),
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def get_public(scope: str, owner_id: int = 0) -> dict[str, Any]:
    raw = get_raw(scope, owner_id)
    if not raw:
        return _empty(scope, owner_id)
    return _public(raw, reveal_key=False)


def save_settings(
    scope: str,
    owner_id: int,
    data: dict[str, Any],
    *,
    keep_key_if_blank: bool = True,
) -> dict[str, Any]:
    """保存配置。api_key 传空字符串且 keep_key_if_blank=True 时保留原 Key。"""
    existing = get_raw(scope, owner_id) or {}
    enabled = 1 if data.get("enabled") else 0
    base_url = str(data.get("base_url") or "").strip().rstrip("/")
    model = str(data.get("model") or "").strip()
    try:
        timeout_sec = max(10, min(300, int(data.get("timeout_sec") or 60)))
    except (TypeError, ValueError):
        timeout_sec = 60
    new_key = str(data.get("api_key") or "").strip()
    if new_key:
        api_key = new_key
    elif keep_key_if_blank:
        api_key = str(existing.get("api_key") or "")
    else:
        api_key = ""

    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO ai_settings (
              scope, owner_id, enabled, base_url, api_key, model, timeout_sec, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
            ON CONFLICT(scope, owner_id) DO UPDATE SET
              enabled = excluded.enabled,
              base_url = excluded.base_url,
              api_key = excluded.api_key,
              model = excluded.model,
              timeout_sec = excluded.timeout_sec,
              updated_at = datetime('now','localtime')
            """,
            (scope, int(owner_id), enabled, base_url, api_key, model, timeout_sec),
        )
        conn.commit()
    finally:
        conn.close()
    return get_public(scope, owner_id)


def clear_user_settings(user_id: int) -> dict[str, Any]:
    """清除个人配置，回退全局。"""
    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM ai_settings WHERE scope = ? AND owner_id = ?",
            (SCOPE_USER, int(user_id)),
        )
        conn.commit()
    finally:
        conn.close()
    return _empty(SCOPE_USER, int(user_id))


def resolve_effective(user_id: int) -> dict[str, Any]:
    """个人优先（已启用且字段齐全），否则用全局。"""
    user_raw = get_raw(SCOPE_USER, int(user_id))
    sys_raw = get_raw(SCOPE_SYSTEM, 0)

    def usable(raw: Optional[dict[str, Any]]) -> bool:
        if not raw or not int(raw.get("enabled") or 0):
            return False
        return bool(
            str(raw.get("base_url") or "").strip()
            and str(raw.get("api_key") or "").strip()
            and str(raw.get("model") or "").strip()
        )

    if usable(user_raw):
        src = "user"
        raw = user_raw
    elif usable(sys_raw):
        src = "system"
        raw = sys_raw
    else:
        return {
            "ok": False,
            "source": None,
            "enabled": False,
            "base_url": "",
            "api_key": "",
            "model": "",
            "timeout_sec": 60,
            "message": "尚未配置可用的 AI（请在「AI 设置」填写中转站/官方地址、Key、模型并启用）",
        }

    assert raw is not None
    return {
        "ok": True,
        "source": src,
        "enabled": True,
        "base_url": str(raw.get("base_url") or "").strip().rstrip("/"),
        "api_key": str(raw.get("api_key") or "").strip(),
        "model": str(raw.get("model") or "").strip(),
        "timeout_sec": int(raw.get("timeout_sec") or 60),
        "message": "使用个人配置" if src == "user" else "使用全局默认配置",
    }
