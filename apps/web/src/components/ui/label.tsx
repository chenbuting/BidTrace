import * as React from "react";

import { cn } from "@/lib/utils";

/** 表单标签 */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-[12px] font-medium text-[#4a4a4a]", className)} {...props} />;
}
