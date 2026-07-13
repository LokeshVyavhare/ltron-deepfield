# Changelog

## 0.2.0 — 2026-07-13

Touch. The renderer bound pointer events already, but only ever tracked one of them — so a
phone could pan and nothing else: no zoom at all, and taps that opened the details panel had
it closed again by the browser's own compatibility click.

**Added**
- **Pinch to zoom**, anchored on the midpoint between the fingers. The finger spread maps
  through `log2(ratio)` onto the same zoom axis the wheel drives, so pinch and wheel are one
  camera, not two.
- **One-finger drag pans**, **tap picks** (descend / open the panel / leaf click). A tap is
  distinguished from a drag by a 10 px / 600 ms threshold, so a drag never fires a click.
- `strings.helpTouch` — the hint shown in place of `strings.help` on a coarse pointer, since a
  touch device has neither a wheel nor a click.
- Responsive UI chrome: 44 px targets and 16 px form fields on touch (below 16 px, iOS zooms
  the page the moment the search box takes focus), and below 560 px the details panel becomes
  a bottom sheet instead of a full-width slab.

**Fixed**
- A pointer lost mid-gesture (`pointercancel`, a stolen capture, an OS gesture) no longer leaves
  the renderer stuck dragging, or leaves a phantom finger that turns the next tap into a pinch.
- The details panel no longer closes itself the instant a tap opens it — the backdrop dismisses
  on `pointerdown`, not on the re-hit-tested compatibility `click`.
- The stylesheet now sets `box-sizing: border-box` on its own subtree. Without it, in a host
  page with no global reset, the search field and the details panel overflowed their container
  by exactly their padding.

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
