import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作用红色确定按钮 */
  danger?: boolean;
};

type Pending = ConfirmOptions & {
  resolve: (ok: boolean) => void;
};

/** 应用内确认弹窗（替代浏览器 confirm） */
export function ConfirmDialog({
  open,
  title = "请确认",
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-black/[0.06] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#26251e]">{title}</h3>
        </div>
        <div className="px-5 py-4 text-[13px] leading-relaxed text-[#4a4a4a]">{description}</div>
        <div className="flex justify-end gap-2 border-t border-black/[0.06] px-5 py-3">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 用 Promise 方式调用确认框，便于替换 window.confirm */
export function useConfirmDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const close = useCallback((ok: boolean) => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    cur?.resolve(ok);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next: Pending = { ...opts, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      danger={pending?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, dialog };
}
