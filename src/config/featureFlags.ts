/// <reference types="vite/client" />
/**
 * Feature flags for the report experience. A flag is on only when its build variable is exactly "true".
 * Off by default, so existing screens and exports are unchanged until a flag is enabled on purpose.
 */
export function flagEnabled(value: unknown): boolean {
  return value === "true";
}

export const REPORT_SECTIONS_UI_ENABLED = flagEnabled(import.meta.env.VITE_REPORT_SECTIONS_UI);
