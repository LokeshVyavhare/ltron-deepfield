// Packing: put children inside their parent's disc.
//
// Position comes from similarity when vectors are available (PCA of child centroids), and
// from a golden-angle spiral otherwise — so the map still builds with no embeddings at all.
// Radius comes from weight. Then a bounded relaxation pushes overlapping siblings apart and
// a clamp guarantees the one invariant the renderer depends on: every child lies strictly
// inside its parent.

import { pca2, centroid } from "./pca.js";

const GOLDEN_ANGLE = 2.399963229728653;

/** Deterministic golden-angle spiral filling a disc of radius rho. */
export function spiral(n, cx, cy, rho) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const rr = rho * Math.sqrt((k + 0.5) / n);
    const th = k * GOLDEN_ANGLE;
    pts.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
  }
  return pts;
}

/** Bounded pairwise push-apart. Containment is not enforced here — clamp() does that. */
function relax(children, iterations) {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i], b = children[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const need = (a.r + b.r) * 0.9;
        if (dist < 1e-9) { dx = 1; dy = 0; dist = 1; }   // deterministic tiebreak direction
        if (dist < need) {
          const push = (need - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** Pull any child that escaped back inside the parent disc. */
function clamp(parent, children) {
  for (const c of children) {
    const dx = c.x - parent.x, dy = c.y - parent.y;
    const dist = Math.hypot(dx, dy);
    const limit = Math.max(0, parent.r - c.r);
    if (dist > limit && dist > 1e-9) {
      c.x = parent.x + (dx / dist) * limit;
      c.y = parent.y + (dy / dist) * limit;
    }
  }
}

/**
 * Position and size `children` inside `parent`. Mutates the children.
 *
 * @param {object} parent node with x, y, r already set
 * @param {object[]} children nodes with `weight` and optional `centroid`
 * @param {object} opts spread, packingFraction, relaxIterations, leafKind
 */
export function placeChildren(parent, children, opts) {
  const n = children.length;
  if (!n) return;

  const cents = children.map((c) => c.centroid || null);
  const have = cents.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const inner = parent.r * opts.spread;

  let pts;
  if (have.length >= 3 && n >= 3) {
    const coords = Array.from({ length: n }, () => [0.5, 0.5]);
    const projected = pca2(have.map((i) => cents[i]));
    have.forEach((i, k) => { coords[i] = projected[k]; });
    // Children with no vector go on a rim spiral, so they don't all stack at the centre.
    const missing = [];
    for (let i = 0; i < n; i++) if (!cents[i]) missing.push(i);
    if (missing.length) {
      const rim = spiral(missing.length, 0.5, 0.5, 0.45);
      missing.forEach((i, k) => { coords[i] = rim[k]; });
    }
    pts = coords.map(([cx, cy]) => [
      parent.x + (cx - 0.5) * 2 * inner,
      parent.y + (cy - 0.5) * 2 * inner,
    ]);
  } else {
    pts = spiral(n, parent.x, parent.y, inner * 0.8);
  }

  const totalW = children.reduce((s, c) => s + c.weight, 0) || 1;
  const pack = Math.sqrt(opts.packingFraction);
  children.forEach((child, i) => {
    child.x = pts[i][0];
    child.y = pts[i][1];
    // sqrt(share) so AREA tracks weight — radius-proportional would make big nodes swallow
    // the disc. The floor keeps a 1-in-10000 child from collapsing to a zero-radius dot.
    child.r = Math.max(parent.r * 0.02, parent.r * Math.sqrt(child.weight / totalW) * pack);
  });

  // Relax only small container sets. Leaf points may overlap freely — they're dots, and an
  // O(n^2) relaxation over thousands of them would dominate the whole build.
  if (n <= 40 && children.some((c) => c.kind !== opts.leafKind)) {
    relax(children, opts.relaxIterations);
  }
  clamp(parent, children);
}

const LEAF_S_MAX = 64.0;   // leaves, once reached, stay visible however far you zoom in

/**
 * Visibility window in log2(scale) space.
 *
 * Size-based, not depth-based: a node is optimally visible when its projected diameter is
 * about a quarter of the viewport (world span == viewport at z=0). Keying off depth instead
 * desyncs from screen size — a small root would be "in band" while still a speck.
 * Child radii are always smaller than parent radii, so "child fades in before parent fades
 * out" holds by construction.
 */
export function bands(node, isLeaf) {
  const r = Math.max(node.r, 1e-5);
  const sOpt = Math.max(-1.5, Math.min(8.5, Math.log2(0.25 / (2 * r))));
  const sMin = node.depth > 0 ? sOpt - 1.3 : -2.0;
  const sMax = isLeaf ? LEAF_S_MAX : sOpt + 1.7;
  return [sMin, sOpt, sMax];
}
