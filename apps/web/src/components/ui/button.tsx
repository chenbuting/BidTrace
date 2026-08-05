import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-[#26251e] text-white hover:bg-black",
        outline: "border border-black/[0.12] bg-white text-[#26251e] hover:bg-black/[0.03]",
        ghost: "text-[#6b6b6b] hover:bg-black/[0.04] hover:text-[#26251e]",
        brand: "bg-[#f54e00] text-white hover:bg-[#e04700]",
        soft: "bg-[#fff1eb] text-[#f54e00] hover:bg-[#ffe6db]",
        danger: "bg-red-600 text-white hover:bg-red-500",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px]",
        lg: "h-9 px-4 text-[13px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

/** 通用按钮 */
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
