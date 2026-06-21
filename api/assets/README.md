# Export branding assets

Drop a file named **`venakan-logo.png`** in this directory to brand the
generated Word (.docx) and PDF program exports (see `api/export-program.ts`).

- The logo is placed on a **light off-white (`#F1F5F9`) banner** with an emerald
  accent rule, at the top of the cover page and as a running header — so a
  **black / dark** (or transparent-background) PNG reads correctly. The official
  black "VENAKAN — INFO SOLUTIONS" wordmark is the intended asset.
- A roughly landscape logo (e.g. ~1000×260 px) works best in the banner.

If `venakan-logo.png` is absent, exports fall back to a styled
"VENAKAN / INFO SOLUTIONS" text wordmark (ink + emerald) — no build step
required.
