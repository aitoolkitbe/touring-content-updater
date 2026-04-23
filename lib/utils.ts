import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Genereert een korte, stabiele id voor aanbevelingen. Niet cryptografisch —
 * louter voor UI-tracking.
 */
export function makeId(prefix = "rec"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
