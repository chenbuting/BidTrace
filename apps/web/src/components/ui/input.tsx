import * as React from "react";

import { cn } from "@/lib/utils";

/** 输入框 */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-lg border border-black/[0.12] bg-white px-3 text-[13px] text-[#26251e] outline-none transition placeholder:text-[#a3a3a3] focus:border-black/25 focus:ring-2 focus:ring-black/5",
        className,
      )}
      {...props}
    />
  );
}
