# Agent B handoff: A11Y-1 (T-12) axe-core WCAG 2.1 AA audit

Branch `devin/1795799656-exports-a11y1`, based on `engineering/integration` `7cd0d25`. Do not merge or deploy from this branch.

## Method

- axe-core 4.10.2, tags `wcag2a, wcag2aa, wcag21a, wcag21aa`, violations only, run in headless Chromium 156 at 1366×900 after the page settled (CSP bypassed only to inject axe).
- Production `https://cyfsanavigator.com`, signed out; all non-GET `/api/**` requests blocked so the audit could not start paid work.
- Local build (`vite`, HMR off) `/document-analyzer`: signed out, and signed in with a mocked Firebase user, synthetic saved reports and mocked `/api` (Quick, Forensic and Final Case Assessment tabs). Only `GET /api/analyzer-usage` and `GET /api/final-case-assessment` were requested, both mocked.

## Results

| Page | Before | After this PR |
|---|---|---|
| prod `/` (home) | color-contrast ×1 | unchanged (production; contrast) |
| prod `/document-analyzer` (landing) | color-contrast ×2 | unchanged (contrast) |
| prod `/rights` | color-contrast ×1 | unchanged (contrast) |
| prod `/five-day-rule` (Court Process) | color-contrast ×1 | unchanged (contrast) |
| prod `/cyfsa-procedure` | color-contrast ×1 | unchanged (contrast) |
| prod `/lawyers` (Resources) | color-contrast ×1 | unchanged (contrast) |
| prod `/pricing` | color-contrast ×25 | unchanged (contrast) |
| local analyzer, signed in (all 3 tabs) | **button-name ×1 (critical)**, color-contrast ×6 | color-contrast ×6 |
| local analyzer, signed out | color-contrast ×2 | color-contrast ×2 |

No other WCAG 2.1 A/AA rule failed on any page (labels, landmarks, ARIA, images, links, lists all passed).

## Fixed

- `src/components/RedactionToggle.tsx`: the redaction `role="switch"` button had no accessible name (critical `button-name`). Added `aria-label="Hide names & case numbers"` (the visible label text); `aria-checked` already carries the state. No visual change. Test: `src/components/RedactionToggle.test.tsx` (fails on the old code).

## Remaining (contrast only; each fix changes the visible colour, so listed, not changed)

| Where | Element | Colours | Ratio (needs 4.5) |
|---|---|---|---|
| Every page, nav menu | "Free Help Center" eyebrow, `text-[9px] text-slate-400` | #90a1b9 on #feffff | 2.62 |
| Analyzer sign-in card (signed out) | "This only asks for your name and email…" `text-[11px] text-slate-400` | #90a1b9 on #f8fafc | 2.51 |
| Pricing plan cards | struck-through unavailable features `line-through text-slate-400` (7) | #90a1b9 on #fff | 2.63 |
| Pricing comparison table | "✓ Included" / "✓ Full …" cells `text-emerald-600 font-bold` (15) | #009966 on #fff / #fcfdfe | 3.62–3.69 |
| Pricing comparison table | "Preview Only" `text-slate-400` | #90a1b9 on #fff | 2.63 |
| Pricing payment badges | "e-Transfer Only", "Server-Verified" `text-[10px] text-gray-400` | #99a1af on #fff | 2.60 |
| Analyzer toolbar (signed in) | "Analysis Mode", "AI Engine", "Auto-saved" `text-[10px] text-slate-500` on `bg-slate-100` | #62748e on #f1f5f9 | 4.34 |
| Analyzer recorder card | "Record CAS meetings…" `text-brand-900/70` | #5e73ac on #f4f8fd | 4.35 |
| Redaction toggle | "(on-screen text is not changed…)" `text-[10px] text-slate-400` | #90a1b9 on #f8fafc | 2.51 |

Smallest visual change if the owner approves: `text-slate-400` → `text-slate-500` (on white), `text-slate-500` → `text-slate-600` on `bg-slate-100`, `text-emerald-600` → `text-emerald-700`, `text-brand-900/70` → `text-brand-900/80`.

axe checks the rendered state only; dialogs, menus opened by hover, and error states were not opened, except the upload-limit alert already covered by T-18 (#166).
