import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Bot, Save, Trash2, Zap } from "lucide-react";

import { ApiError } from "@/api/client";
import {
  clearMyAiSettings,
  fetchMyAiSettings,
  fetchSystemAiSettings,
  saveMyAiSettings,
  saveSystemAiSettings,
  testAiSettings,
  type AiSettings,
  type UserInfo,
} from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, cn } from "@/lib/utils";

type Tab = "me" | "system";

type FormState = {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
  timeout_sec: number;
  has_api_key: boolean;
  api_key_masked: string;
};

function toForm(item?: AiSettings | null): FormState {
  return {
    enabled: !!item?.enabled,
    base_url: item?.base_url || "",
    api_key: "",
    model: item?.model || "",
    timeout_sec: item?.timeout_sec || 60,
    has_api_key: !!item?.has_api_key,
    api_key_masked: item?.api_key_masked || "",
  };
}

/** AI 设置：个人配置 + 管理员全局默认（OpenAI 兼容中转站/官方） */
export function AiSettingsPage() {
  const { user } = useOutletContext<{ user: UserInfo | null }>();
  const canSystem = can(user?.permissions || [], "system.ai_config");
  const [tab, setTab] = useState<Tab>("me");
  const [meForm, setMeForm] = useState<FormState>(toForm());
  const [sysForm, setSysForm] = useState<FormState>(toForm());
  const [effectiveMsg, setEffectiveMsg] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const mine = await fetchMyAiSettings();
      setMeForm(toForm(mine.item));
      const eff = mine.effective;
      setEffectiveMsg(
        eff?.ok
          ? `当前生效：${eff.source === "user" ? "个人配置" : "全局默认"}（${eff.model || ""}）`
          : eff?.message || "尚未配置可用 AI",
      );
      if (canSystem) {
        const sys = await fetchSystemAiSettings();
        setSysForm(toForm(sys.item));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSystem]);

  const active = tab === "system" ? sysForm : meForm;
  const setActive = tab === "system" ? setSysForm : setMeForm;

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const body = {
        enabled: active.enabled,
        base_url: active.base_url.trim(),
        api_key: active.api_key.trim(),
        model: active.model.trim(),
        timeout_sec: Number(active.timeout_sec) || 60,
      };
      if (tab === "system") {
        const data = await saveSystemAiSettings(body);
        setSysForm(toForm(data.item));
        setMsg("全局默认已保存");
      } else {
        const data = await saveMyAiSettings(body);
        setMeForm(toForm(data.item));
        setMsg("个人配置已保存");
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const data = await testAiSettings({
        enabled: active.enabled,
        base_url: active.base_url.trim(),
        api_key: active.api_key.trim(),
        model: active.model.trim(),
        timeout_sec: Number(active.timeout_sec) || 60,
      });
      setMsg(`连通成功：${data.reply || "ok"}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "测试失败");
    } finally {
      setSaving(false);
    }
  };

  const onClearMine = async () => {
    if (!confirm("清除个人配置后将回退使用全局默认，确定？")) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const data = await clearMyAiSettings();
      setMeForm(toForm(data.item));
      setMsg("已清除个人配置");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "清除失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#26251e]">AI 设置</h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          支持官方或中转站（OpenAI 兼容：base_url + api_key + model）。个人配置优先于全局默认。
        </p>
        {effectiveMsg ? <p className="mt-2 text-[12px] text-[#067647]">{effectiveMsg}</p> : null}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={tab === "me" ? "default" : "outline"} onClick={() => setTab("me")}>
          我的配置
        </Button>
        {canSystem ? (
          <Button
            size="sm"
            variant={tab === "system" ? "default" : "outline"}
            onClick={() => setTab("system")}
          >
            全局默认
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
      {msg ? <p className="text-[13px] text-[#067647]">{msg}</p> : null}
      {loading ? <p className="text-[13px] text-[#6b6b6b]">加载中…</p> : null}

      <div className="glass-card max-w-2xl space-y-4 p-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={active.enabled}
            onChange={(e) => setActive({ ...active, enabled: e.target.checked })}
          />
          启用此配置
        </label>

        <div className="space-y-1">
          <Label>接口地址 base_url</Label>
          <Input
            placeholder="例如 https://api.openai.com 或 https://你的中转站.com"
            value={active.base_url}
            onChange={(e) => setActive({ ...active, base_url: e.target.value })}
          />
          <p className="text-[11px] text-[#8a8a8a]">
            可填根域名、…/v1 或完整 …/v1/chat/completions
          </p>
        </div>

        <div className="space-y-1">
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder={
              active.has_api_key
                ? `已保存 ${active.api_key_masked}（留空则保持不变）`
                : "sk-… 或中转站发放的 Key"
            }
            value={active.api_key}
            onChange={(e) => setActive({ ...active, api_key: e.target.value })}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-1">
          <Label>模型 model</Label>
          <Input
            placeholder="例如 deepseek-chat / gpt-4o-mini"
            value={active.model}
            onChange={(e) => setActive({ ...active, model: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label>超时（秒）</Label>
          <Input
            type="number"
            min={10}
            max={300}
            value={active.timeout_sec}
            onChange={(e) => setActive({ ...active, timeout_sec: Number(e.target.value) || 60 })}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button disabled={saving} onClick={() => void onSave()}>
            <Save className="h-3.5 w-3.5" />
            保存
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => void onTest()}>
            <Zap className="h-3.5 w-3.5" />
            测试连通
          </Button>
          {tab === "me" ? (
            <Button variant="outline" disabled={saving} onClick={() => void onClearMine()}>
              <Trash2 className="h-3.5 w-3.5" />
              清除个人配置
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "rounded-lg border border-dashed border-black/[0.1] px-3 py-3 text-[12px] text-[#6b6b6b]",
        )}
      >
        <p className="mb-1 flex items-center gap-1 font-medium text-[#26251e]">
          <Bot className="h-3.5 w-3.5" />
          使用说明
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>管理员在「全局默认」配置一套给大家用；成员可在「我的配置」覆盖。</li>
          <li>周报页可点「AI 填入询标分析」：按当前周询标追加到事项/问题，不覆盖已有内容。</li>
          <li>Key 仅保存在服务器，界面只显示脱敏。</li>
        </ul>
      </div>
    </div>
  );
}
