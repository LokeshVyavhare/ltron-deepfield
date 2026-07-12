# Changelog

## 0.1.0 — 2026-07-12

First extraction. The renderer previously lived inside the BLACKICE news dashboard as
`web/static/atlas.js`; this is that code, decoupled from its host and given a data contract.

**Added**
- `Deepfield` — WebGL2 renderer for any hierarchy. Semantic-zoom cross-fade, magnetic dive,
  pooled labels with hysteresis, breadcrumb, picking, details panel, group filter, search,
  fullscreen, void rescue, GL context-loss recovery.
- `layout()` — deterministic geometry from a plain hierarchy: PCA placement when vectors are
  supplied, golden-angle spiral otherwise; weight-driven radii; the density rule (synthetic
  grouping nodes above `maxChildren`); log2-space visibility bands.
- `fromPaths()` / `fromFlat()` — the two shapes hierarchical data usually arrives in.
- Columnar and row data both accepted, with aliases (`category`, `lineage_path`, `ref_id`) so
  a backend already speaking its own dialect needs no adapter.
- Every string, colour and click behaviour is an option. Styling is entirely `--df-*` custom
  properties — no need to fork the CSS.
- ESM + CJS + IIFE builds. No runtime dependencies.
