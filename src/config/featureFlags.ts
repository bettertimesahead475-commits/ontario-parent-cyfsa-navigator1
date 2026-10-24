/// <reference types="vite/client" />
/**
 * Feature flags for the report experience. A flag is on only when its build variable is exactly "true".
 * Off by default, so existing screens and exports are unchanged until a flag is enabled on purpose.
 */
export function flagEnabled(value: unknown): boolean {
  return value === "true";
}

export const REPORT_SECTIONS_UI_ENABLED = flagEnabled(import.meta.env.VITE_REPORT_SECTIONS_UI);
export const COURT_PREP_UI_ENABLED = flagEnabled(import.meta.env.VITE_COURT_PREP_UI);
export const PARENT_QA_UI_ENABLED = flagEnabled(import.meta.env.VITE_PARENT_QA_UI);
export const PARENT_REPORT_UI_ENABLED = flagEnabled(import.meta.env.VITE_PARENT_REPORT_UI);
/** Parent and proceeding selection. Needs the matching server flag too. Off until explicitly approved. */
export const PARENT_ANALYSIS_UI_ENABLED = flagEnabled(import.meta.env.VITE_PARENT_ANALYSIS_UI);
