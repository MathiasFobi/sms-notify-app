import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names safely.
 * - Filters out falsy values
 * - Resolves conflicting Tailwind utility classes (e.g. `px-2` vs `px-4`)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
