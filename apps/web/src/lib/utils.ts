import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind class */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 是否拥有权限 */
export function can(perms: string[] | undefined, code: string): boolean {
  return !!perms?.includes(code);
}
