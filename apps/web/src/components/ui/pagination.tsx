import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const DEFAULT_SIZES = [10, 20, 50, 100];

type Props = {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  disabled?: boolean;
  className?: string;
  /** 页码或每页条数变化时回调（改条数时页码会回到 1） */
  onChange: (page: number, pageSize: number) => void;
};

/** 生成页码序列（含省略号），风格对齐常见后台分页 */
function buildPages(page: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 0) return [1];
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const set = new Set<number>([1, pageCount]);
  for (let i = page - 2; i <= page + 2; i++) {
    if (i >= 1 && i <= pageCount) set.add(i);
  }
  if (page <= 4) {
    [2, 3, 4, 5].forEach((n) => {
      if (n < pageCount) set.add(n);
    });
  }
  if (page >= pageCount - 3) {
    [pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => {
      if (n > 1) set.add(n);
    });
  }
  const sorted = [...set].sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) out.push("ellipsis");
    out.push(sorted[i]!);
  }
  return out;
}

/**
 * 通用分页：共 N 条 · 每页条数 · 页码 · 前往
 */
export function Pagination({
  total,
  page,
  pageSize,
  pageSizeOptions = DEFAULT_SIZES,
  disabled = false,
  className,
  onChange,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pages = buildPages(safePage, pageCount);
  const [jump, setJump] = useState(String(safePage));

  useEffect(() => {
    setJump(String(safePage));
  }, [safePage]);

  const go = (next: number) => {
    if (disabled) return;
    const p = Math.min(pageCount, Math.max(1, next));
    if (p !== page) onChange(p, pageSize);
  };

  const onSizeChange = (size: number) => {
    if (disabled || size === pageSize) return;
    onChange(1, size);
  };

  const submitJump = () => {
    const n = Number.parseInt(jump, 10);
    if (Number.isFinite(n)) go(n);
    else setJump(String(safePage));
  };

  const btnBase =
    "inline-flex h-7 min-w-7 items-center justify-center rounded-md border text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-40";
  const btnIdle = "border-black/[0.12] bg-white text-[#26251e] hover:bg-black/[0.03]";
  const btnActive = "border-[#26251e] bg-[#26251e] text-white";

  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-[12px] text-[#6b6b6b]",
        className,
      )}
    >
      <span className="mr-auto">共 {total} 条</span>

      <select
        className="h-7 rounded-md border border-black/[0.12] bg-white px-2 text-[12px] text-[#26251e] outline-none disabled:opacity-40"
        value={pageSize}
        disabled={disabled}
        onChange={(e) => onSizeChange(Number(e.target.value))}
        aria-label="每页条数"
      >
        {pageSizeOptions.map((n) => (
          <option key={n} value={n}>
            {n}条/页
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(btnBase, btnIdle)}
          disabled={disabled || safePage <= 1}
          onClick={() => go(safePage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {pages.map((item, idx) =>
          item === "ellipsis" ? (
            <span
              key={`e-${idx}`}
              className="inline-flex h-7 min-w-7 items-center justify-center text-[#a3a3a3]"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={cn(btnBase, item === safePage ? btnActive : btnIdle)}
              disabled={disabled}
              onClick={() => go(item)}
            >
              {item}
            </button>
          ),
        )}

        <button
          type="button"
          className={cn(btnBase, btnIdle)}
          disabled={disabled || safePage >= pageCount}
          onClick={() => go(safePage + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="flex items-center gap-1.5">
        <span>前往</span>
        <input
          type="text"
          inputMode="numeric"
          className="h-7 w-10 rounded-md border border-black/[0.12] bg-white px-1.5 text-center text-[12px] text-[#26251e] outline-none focus:border-black/30 disabled:opacity-40"
          value={jump}
          disabled={disabled}
          onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitJump();
          }}
          onBlur={submitJump}
          aria-label="跳转页码"
        />
        <span>页</span>
      </label>
    </div>
  );
}
