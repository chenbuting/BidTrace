/** API 封装（cookie 会话） */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  if (res.headers.get("content-type")?.includes("spreadsheet") || res.headers.get("content-disposition")) {
    if (!res.ok) {
      throw new ApiError(res.status, "下载失败");
    }
    return res as unknown as T;
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !url.includes("/api/auth/login")) {
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    const detail = data.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : detail
          ? JSON.stringify(detail)
          : res.statusText || "请求失败";
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
