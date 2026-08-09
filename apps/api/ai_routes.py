# -*- coding: utf-8 -*-
"""AI 配置与周报询标分析 API。"""

from __future__ import annotations

from datetime import date
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ai_client import chat_completions, extract_json_object
from db import ai_settings as ai
from db import queries as q
from db import weekly as w
from permissions import has_perm


class AiSettingsBody(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout_sec: int = 60


def create_ai_router(
    require_login: Callable[..., Any],
    require_perm: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/ai", tags=["ai"])

    @router.get("/status")
    def api_ai_status(
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        """当前用户生效配置摘要（不含 Key）。"""
        eff = ai.resolve_effective(int(user["id"]))
        return {
            "ok": bool(eff.get("ok")),
            "source": eff.get("source"),
            "message": eff.get("message") or "",
            "model": eff.get("model") or "",
            "base_url": eff.get("base_url") or "",
            "can_edit_system": has_perm(user["_perms"], "system.ai_config"),
        }

    @router.get("/settings/system")
    def api_get_system_ai(
        user: dict[str, Any] = Depends(require_perm("system.ai_config")),
    ) -> dict[str, Any]:
        _ = user
        return {"item": ai.get_public(ai.SCOPE_SYSTEM, 0)}

    @router.put("/settings/system")
    def api_put_system_ai(
        body: AiSettingsBody,
        user: dict[str, Any] = Depends(require_perm("system.ai_config")),
    ) -> dict[str, Any]:
        item = ai.save_settings(ai.SCOPE_SYSTEM, 0, body.model_dump(), keep_key_if_blank=True)
        q.add_audit(int(user["id"]), user["username"], "ai.settings_system", "ai:system", item.get("model") or "")
        return {"item": item}

    @router.get("/settings/me")
    def api_get_my_ai(
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        return {
            "item": ai.get_public(ai.SCOPE_USER, int(user["id"])),
            "effective": {
                k: v
                for k, v in ai.resolve_effective(int(user["id"])).items()
                if k != "api_key"
            },
        }

    @router.put("/settings/me")
    def api_put_my_ai(
        body: AiSettingsBody,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = ai.save_settings(
            ai.SCOPE_USER, int(user["id"]), body.model_dump(), keep_key_if_blank=True
        )
        q.add_audit(int(user["id"]), user["username"], "ai.settings_user", f"user:{user['id']}", item.get("model") or "")
        return {"item": item}

    @router.delete("/settings/me")
    def api_clear_my_ai(
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        item = ai.clear_user_settings(int(user["id"]))
        q.add_audit(int(user["id"]), user["username"], "ai.settings_user_clear", f"user:{user['id']}", "")
        return {"item": item}

    @router.post("/test")
    def api_test_ai(
        body: AiSettingsBody,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        """用表单内容（或已保存 Key）试连。"""
        # 若未填 key，尝试用对应已保存配置
        data = body.model_dump()
        key = str(data.get("api_key") or "").strip()
        if not key:
            # 优先个人，再全局
            raw = ai.get_raw(ai.SCOPE_USER, int(user["id"])) or {}
            key = str(raw.get("api_key") or "").strip()
            if not key and has_perm(user["_perms"], "system.ai_config"):
                raw = ai.get_raw(ai.SCOPE_SYSTEM, 0) or {}
                key = str(raw.get("api_key") or "").strip()
        base_url = str(data.get("base_url") or "").strip()
        model = str(data.get("model") or "").strip()
        if not (base_url and key and model):
            raise HTTPException(status_code=400, detail="请填写 base_url、model，并提供 api_key（或已保存过）")
        try:
            text = chat_completions(
                base_url=base_url,
                api_key=key,
                model=model,
                timeout_sec=int(data.get("timeout_sec") or 60),
                messages=[
                    {"role": "system", "content": "你是连通性测试助手，只回复：ok"},
                    {"role": "user", "content": "ping"},
                ],
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "reply": text[:200]}

    @router.post("/weekly/{rid}/append-inquiry-analysis")
    def api_weekly_append_inquiry_analysis(
        rid: int,
        user: dict[str, Any] = Depends(require_login),
    ) -> dict[str, Any]:
        """分析周报时间范围内询标数据，追加到所做事项/所遇问题（不覆盖）。"""
        item = w.get_report(rid)
        if not item:
            raise HTTPException(status_code=404, detail="周报不存在")
        own = int(item["user_id"]) == int(user["id"])
        perms = user["_perms"]
        if own and has_perm(perms, "weekly.edit_own"):
            pass
        elif (not own) and has_perm(perms, "weekly.edit_others"):
            pass
        else:
            raise HTTPException(status_code=403, detail="无权限编辑该周报")
        if item.get("status") == "submitted" and not has_perm(perms, "weekly.edit_others"):
            raise HTTPException(status_code=400, detail="已提交的周报请先退回草稿再分析")

        eff = ai.resolve_effective(int(user["id"]))
        if not eff.get("ok"):
            raise HTTPException(status_code=400, detail=str(eff.get("message") or "AI 未配置"))

        week_start = str(item.get("week_start") or "")[:10]
        week_end = str(item.get("week_end") or "")[:10]
        try:
            start = date.fromisoformat(week_start)
            end = date.fromisoformat(week_end)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="周报日期无效") from exc

        # 按「当前这份周报」的周期取询标，不是系统日历本周
        owner_id = int(item["user_id"])
        # 有查看全部权限则分析该周期全员询标；否则只看周报所属人自己的
        only_uid: int | None = owner_id
        if has_perm(perms, "inquiry.view_all"):
            only_uid = None
        rows, total = q.list_inquiries(
            q="",
            platform_name="",
            is_bid="",
            is_registered="",
            date_from=start.isoformat(),
            date_to=end.isoformat(),
            only_user_id=only_uid,
            limit=500,
            offset=0,
        )
        period_label = f"{week_start} ~ {week_end}"
        if total <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"所选周报周期（{period_label}）没有询标数据可分析",
            )

        # 汇总统计：整体 + 平台 + 放弃原因，供领导向分析
        bid_yes = sum(1 for r in rows if str(r.get("is_bid") or "") == "是")
        bid_no = sum(1 for r in rows if str(r.get("is_bid") or "") == "否")
        bid_wait = sum(1 for r in rows if str(r.get("is_bid") or "") == "待确定")
        bid_empty = total - bid_yes - bid_no - bid_wait
        registered = sum(1 for r in rows if str(r.get("is_registered") or "") == "是")
        file_ok = sum(1 for r in rows if str(r.get("file_received") or "") == "是")
        paid_ok = sum(1 for r in rows if str(r.get("is_paid") or "") == "是")
        overview_ok = sum(1 for r in rows if str(r.get("overview_done") or "") == "是")

        platform_counter: dict[str, int] = {}
        skip_counter: dict[str, int] = {}
        for r in rows:
            plat = str(r.get("platform_name") or "").strip() or "（未填平台）"
            platform_counter[plat] = platform_counter.get(plat, 0) + 1
            cat = str(r.get("skip_reason_category") or "").strip()
            if cat:
                skip_counter[cat] = skip_counter.get(cat, 0) + 1

        def _top_lines(counter: dict[str, int], limit: int = 8) -> str:
            items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))[:limit]
            if not items:
                return "无"
            return "；".join(f"{k} {v}条" for k, v in items)

        # 需跟进项目：是否投标为「待确定」或未填写
        def _needs_follow(r: dict) -> bool:
            v = str(r.get("is_bid") or "").strip()
            return v == "待确定" or v == ""

        follow_rows = [r for r in rows if _needs_follow(r)]
        follow_n = len(follow_rows)

        def _fmt_follow_line(r: dict) -> str:
            pname = str(r.get("project_name") or "").strip() or "（未填项目名）"
            plat = str(r.get("platform_name") or "").strip() or "未填平台"
            bid = str(r.get("is_bid") or "").strip() or "未填写"
            return (
                f"- {pname}（平台：{plat}；是否投标：{bid}；"
                f"是否报名：{r.get('is_registered') or '未填写'}；"
                f"截止：{r.get('deadline') or '未填写'}）"
            )

        follow_lines = [_fmt_follow_line(r) for r in follow_rows[:20]]
        follow_block = (
            "\n".join(follow_lines)
            if follow_lines
            else "（本周无「待确定/未填写是否投标」的需跟进项目）"
        )

        stats_block = (
            f"【核心指标】询标 {total} 条；"
            f"投标是 {bid_yes}、否 {bid_no}、待确定 {bid_wait}、未填写 {bid_empty}；"
            f"已报名 {registered}；已收文件 {file_ok}；已缴费 {paid_ok}；概况完成 {overview_ok}\n"
            f"【平台分布】{_top_lines(platform_counter)}\n"
            f"【放弃/跳过原因】{_top_lines(skip_counter)}\n"
            f"【需跟进】待确定+未填写是否投标共 {follow_n} 条（重点项目跟进只能写这些）\n"
            f"【样本量提示】本周期共 {total} 条"
            + (
                "，样本量很小，禁止写「100%」「全面缺失导致无法决策」等夸大表述，改用「仅有1条/条数较少」等自然说法。"
                if total <= 3
                else "，可适当点到数字与结构对比，让领导一眼看懂。"
            )
            + "\n【严禁猜测】未填字段只能写「未填写/待确认」，禁止编造原因、意向、进度、结论或下一步结果。"
        )

        # 供模型与兜底使用的「直观数据块」（纯事实，便于分点汇报）
        data_view = (
            f"询标总量：{total} 条\n"
            f"投标决策结构：是 {bid_yes} / 否 {bid_no} / 待确定 {bid_wait} / 未填写 {bid_empty}\n"
            f"流程节点完成：报名 {registered} / 收文件 {file_ok} / 缴费 {paid_ok} / 概况 {overview_ok}\n"
            f"平台分布：{_top_lines(platform_counter)}\n"
            f"放弃/跳过原因：{_top_lines(skip_counter)}\n"
            f"需跟进项目数：{follow_n}\n"
            f"需跟进项目清单（仅此范围）：\n{follow_block}"
        )

        sample_lines = []
        for r in rows[:100]:
            sample_lines.append(
                " | ".join(
                    [
                        str(r.get("register_date") or ""),
                        str(r.get("platform_name") or ""),
                        str(r.get("project_name") or "")[:60],
                        f"是否投标:{r.get('is_bid') or '未填'}",
                        f"是否报名:{r.get('is_registered') or '未填'}",
                        f"收文件:{r.get('file_received') or '未填'}",
                        f"缴费:{r.get('is_paid') or '未填'}",
                        f"概况:{r.get('overview_done') or '未填'}",
                        f"原因分类:{r.get('skip_reason_category') or '-'}",
                        str(r.get("skip_reason_detail") or "")[:50],
                        f"截止:{r.get('deadline') or '-'}",
                    ]
                )
            )
        sample_text = "\n".join(sample_lines)

        reporter = str(item.get("display_name") or item.get("username") or "本人")
        system_prompt = (
            "你是投标部门员工，正在以「个人第一人称」向组长/领导做本周询标数据分析汇报，"
            "只写入「所做事项」。口吻专业、清楚，像简报，不要流水账，也不要恐吓式措辞。"
            "必须只输出 JSON，不要 Markdown，不要解释。"
            "格式严格为："
            '{"done_items":[{"title":"标题","body":"说明"}],'
            '"problem_items":[],"solution_items":[]}。'
            "内容要求："
            "1) done_items 写 2～3 条，建议结构："
            "①「本周询标数据概况」：总量 + 投标决策结构 + 流程节点完成情况，用分点/分行把数字摆清楚；"
            "②「平台与来源结构」：平台分布（有放弃原因再写）；"
            "③「重点项目跟进」：只能写「是否投标=待确定」或「是否投标未填写」的项目；"
            "已明确「是/否」的项目禁止写进重点跟进；若清单为空，写「本周暂无待确定/未填写需跟进项目」，不要硬凑；"
            "条数很少时可合并为 2 条，但必须有清晰数据点，不要只有一句概括。"
            "2) body 用换行分点（如「- 」开头），让领导扫一眼能看懂；禁止整段挤成一团；"
            "3) problem_items、solution_items 必须是空数组 []；"
            "4) 条数很少时禁止「100%」等夸大措辞；"
            "5) 严禁猜测：未填/-/空不得写成已确认事实；禁止编造项目、平台、原因、截止日、报名/缴费结果；"
            "6) 禁止空话套话；同一事实不要在多条里反复复读。"
        )
        user_prompt = (
            f"周报周期（严格按此周期）：{period_label}（周日到周六）\n"
            f"汇报人：{reporter}\n"
            f"{stats_block}\n"
            f"【直观数据（优先引用）】\n{data_view}\n"
            f"明细（最多100条）：\n{sample_text}\n\n"
            f"请以 {reporter} 的个人数据分析汇报口吻，只输出「所做事项」done_items；"
            "problem_items 与 solution_items 必须为空数组。"
            "「重点项目跟进」只能引用【需跟进项目清单】，不要把已明确是/否的项目写进去。"
            "数字要直观分点展示；只依据上面已有数据，未填写的内容不要猜测补全。"
        )

        try:
            raw_text = chat_completions(
                base_url=str(eff["base_url"]),
                api_key=str(eff["api_key"]),
                model=str(eff["model"]),
                timeout_sec=max(60, int(eff.get("timeout_sec") or 90)),
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            parsed = extract_json_object(raw_text)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"AI 分析失败：{exc}") from exc

        def norm_items(val: Any) -> list[dict[str, str]]:
            out: list[dict[str, str]] = []
            if not isinstance(val, list):
                return out
            for it in val:
                if not isinstance(it, dict):
                    continue
                title = str(it.get("title") or "").strip()
                body = str(it.get("body") or "").strip()
                if title or body:
                    out.append({"title": title, "body": body})
            return out

        add_done = norm_items(parsed.get("done_items"))
        # 当前只追加「所做事项」，问题和解决意见一律不写入
        add_problems: list[dict[str, str]] = []
        add_solutions: list[dict[str, str]] = []
        # 有数据但模型空返回时，用「数据分析简报」兜底（仅事项）
        if not add_done and total > 0:
            top_plat = _top_lines(platform_counter, 3)
            add_done = [
                {
                    "title": "本周询标数据概况",
                    "body": (
                        f"本周（{week_start}至{week_end}）询标台账汇总如下：\n"
                        f"- 询标总量：{total} 条\n"
                        f"- 投标决策结构：是 {bid_yes} / 否 {bid_no} / 待确定 {bid_wait} / 未填写 {bid_empty}\n"
                        f"- 流程节点完成：报名 {registered} / 收文件 {file_ok} / 缴费 {paid_ok} / 概况 {overview_ok}\n"
                        f"- 平台分布：{top_plat}\n"
                        f"- 需跟进（待确定+未填写）：{follow_n} 条\n"
                        "以上数字均来自台账已填内容，未填写项未作推测。"
                    ),
                }
            ]
            if follow_n > 0:
                add_done.append(
                    {
                        "title": "重点项目跟进",
                        "body": (
                            f"本周需跟进项目（是否投标为待确定或未填写，共 {follow_n} 条）：\n"
                            f"{follow_block}"
                        ),
                    }
                )
            else:
                add_done.append(
                    {
                        "title": "重点项目跟进",
                        "body": "本周暂无「待确定/未填写是否投标」的需跟进项目。",
                    }
                )
        if not add_done:
            raise HTTPException(
                status_code=400,
                detail=f"AI 未生成可追加内容（周期 {period_label}）",
            )

        # 追加，不覆盖（事项/问题/解决意见）
        new_done = list(item.get("done_items") or []) + add_done
        new_problems = list(item.get("problem_items") or []) + add_problems
        new_solutions = list(item.get("solution_items") or []) + add_solutions
        updated = w.update_report(
            rid,
            {
                "done_items": new_done,
                "problem_items": new_problems,
                "solution_items": new_solutions,
                "plan_items": item.get("plan_items") or [],
                "display_name": item.get("display_name") or "",
            },
        )
        q.add_audit(
            int(user["id"]),
            user["username"],
            "ai.weekly_inquiry_append",
            f"weekly:{rid}",
            f"done+{len(add_done)},problem+{len(add_problems)},solution+{len(add_solutions)},inq={total}",
        )
        return {
            "item": updated,
            "appended": {
                "done_items": add_done,
                "problem_items": add_problems,
                "solution_items": add_solutions,
            },
            "inquiry_total": total,
            "ai_source": eff.get("source"),
            "period": period_label,
        }

    return router


def mount_ai_routes(app: Any, deps: dict[str, Any]) -> None:
    """挂载 AI 路由。"""
    router = create_ai_router(deps["require_login"], deps["require_perm"])
    app.include_router(router)
