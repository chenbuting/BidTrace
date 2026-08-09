# -*- coding: utf-8 -*-
"""OpenAI 兼容 Chat Completions 调用（官方 / 中转站）。"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def chat_completions(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout_sec: int = 60,
    temperature: float = 0.3,
) -> str:
    """调用 /v1/chat/completions，返回助手文本。"""
    root = (base_url or "").strip().rstrip("/")
    if not root:
        raise ValueError("base_url 不能为空")
    # 允许填到 /v1 或完整到 /chat/completions
    if root.endswith("/chat/completions"):
        url = root
    elif root.endswith("/v1"):
        url = root + "/chat/completions"
    else:
        url = root + "/v1/chat/completions"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=max(10, int(timeout_sec or 60))) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"AI 接口 HTTP {exc.code}: {detail or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"无法连接 AI 服务: {exc.reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"AI 返回非 JSON: {raw[:300]}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"AI 返回格式异常: {raw[:400]}") from exc
    return str(content or "").strip()


def extract_json_object(text: str) -> dict[str, Any]:
    """从模型输出中提取 JSON 对象（兼容 ```json 包裹）。"""
    s = (text or "").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    # 兜底：取第一个 { ... }
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(s[start : end + 1])
        if isinstance(data, dict):
            return data
    raise ValueError("模型未返回可用 JSON")
