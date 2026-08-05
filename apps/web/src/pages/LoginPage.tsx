import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { login } from "@/api/bidtrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 登录页 */
export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#26251e] text-[13px] font-bold text-white">
            BT
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#26251e]">Bruce标迹</h1>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">BidTrace · 投标部台账</p>
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-white p-5">
          <h2 className="text-[15px] font-semibold text-[#26251e]">登录</h2>
          <p className="mt-1 text-[12px] text-[#6b6b6b]">局域网多人共用，按角色权限访问</p>

          <form className="mt-5 space-y-3.5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
            <Button className="w-full" size="lg" type="submit" disabled={loading}>
              {loading ? "登录中…" : "进入系统"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
