import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional classes with Tailwind's conflict rules. Shared by every target. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
