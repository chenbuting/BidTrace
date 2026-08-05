import { useRef } from "react";
import { Calendar } from "lucide-react";

import { cn } from "@/lib/utils";
import { isIsoDate, toIsoDate } from "@/lib/dates";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * 日期输入：可手输 YYYY-MM-DD，右侧仅显示日历图标（点开选日期）。
 */
export function DateInput({ value, onChange, placeholder = "2026-08-05", className }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const pickerValue = isIsoDate(value) ? value : toIsoDate(value);
  const dateValue = isIsoDate(pickerValue) ? pickerValue : "";

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    // 现代浏览器支持 showPicker；否则退回 click
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* ignore */
      }
    }
    el.click();
  };

  return (
    <div className={cn("flex gap-1.5", className)}>
      <input
        type="text"
        className="flex h-9 min-w-0 flex-1 rounded-lg border border-black/[0.12] bg-white px-3 text-[13px] text-[#26251e] outline-none transition placeholder:text-[#a3a3a3] focus:border-black/25 focus:ring-2 focus:ring-black/5"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = toIsoDate(value);
          if (n && n !== value) onChange(n);
        }}
      />
      <button
        type="button"
        title="日历选择"
        onClick={openPicker}
        className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/[0.12] bg-white text-[#26251e] outline-none transition hover:bg-black/[0.03] focus:border-black/25 focus:ring-2 focus:ring-black/5"
      >
        <Calendar className="h-4 w-4" />
        {/* 隐藏的原生 date，只负责弹出日历，不显示文字 */}
        <input
          ref={pickerRef}
          type="date"
          value={dateValue}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          onChange={(e) => onChange(e.target.value)}
        />
      </button>
    </div>
  );
}
