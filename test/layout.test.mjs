// The layout engine runs in Node (no DOM, no GL), so its invariants are directly testable.
// These are the properties the renderer silently depends on — if any breaks, the map is
// wrong in ways that look like a rendering bug.

import { test } from "node:test";
import assert from "node:assert/strict";

import { layout, fromPaths, fromFlat } from "../src/layout/index.js";
import { normalize, groupsOf } from "../src/data.js";

const tree = [
  {
    key: "alpha",
    label: "Alpha",
    children: [
      { key: "a1", label: "A One", children: [{ key: "l1", label: "Leaf 1" }, { key: "l2", label: "Leaf 2" }] },
      { key: "a2", label: "A Two", children: [{ key: "l3", label: "Leaf 3" }] },
    ],
  },
  { key: "beta", label: "Beta", children: [{ key: "b1", label: "B One" }] },
];

// alpha, a1, l1, l2, a2, l3, beta, b1 — b1 is childless, so it is a leaf, not a branch.
const TREE_NODES = 8;

test("layout emits one column entry per node", () => {
  const d = layout(tree);
  assert.equal(d.count, TREE_NODES);
  for (const col of ["x", "y", "r", "s_min", "s_opt", "s_max", "label", "kind", "parent"]) {
    assert.equal(d.nodes[col].length, TREE_NODES, `column ${col} has the wrong length`);
  }
});

test("layout is deterministic", () => {
  const a = layout(tree);
  const b = layout(tree);
  assert.deepEqual(a.nodes, b.nodes, "two builds over identical input diverged");
});

test("every child lies strictly inside its parent disc", () => {
  const d = layout(tree);
  const { x, y, r, parent } = d.nodes;
  for (let i = 0; i < d.count; i++) {
    const p = parent[i];
    if (p === -1) continue;
    const dist = Math.hypot(x[i] - x[p], y[i] - y[p]);
    assert.ok(
      dist <= r[p] - r[i] + 1e-6,
      `node ${i} (${d.nodes.label[i]}) escapes parent ${p}: dist=${dist} limit=${r[p] - r[i]}`,
    );
  }
});

test("a child fades in before its parent fades out", () => {
  // If this breaks, the dive passes through a zoom range where nothing is on screen.
  const d = layout(tree);
  const { s_min, s_max, parent } = d.nodes;
  for (let i = 0; i < d.count; i++) {
    const p = parent[i];
    if (p === -1) continue;
    assert.ok(
      s_min[i] < s_max[p],
      `node ${i} only appears at ${s_min[i]}, but parent ${p} is gone by ${s_max[p]}`,
    );
  }
});

test("parent indices point backwards, so a single forward pass can resolve ancestry", () => {
  const d = layout(tree);
  for (let i = 0; i < d.count; i++) {
    assert.ok(d.nodes.parent[i] < i, `node ${i} has a forward parent reference`);
  }
});

test("the density rule caps direct children", () => {
  const wide = {
    key: "wide",
    label: "Wide",
    children: Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, label: `Item ${i}` })),
  };
  const d = layout(wide, { maxChildren: 6 });
  const direct = d.nodes.parent.filter((p) => p === 0).length;
  assert.ok(direct <= 6, `expected <= 6 direct children after fracture, got ${direct}`);
  assert.ok(d.count > 61, "fracture should have inserted synthetic grouping nodes");
});

test("weights drive radius: a heavier sibling gets the bigger disc", () => {
  const d = layout({
    key: "root",
    label: "Root",
    children: [
      { key: "big", label: "Big", children: Array.from({ length: 10 }, (_, i) => ({ key: `b${i}` })) },
      { key: "small", label: "Small", children: [{ key: "s0" }] },
    ],
  });
  const idx = (label) => d.nodes.label.indexOf(label);
  assert.ok(d.nodes.r[idx("Big")] > d.nodes.r[idx("Small")]);
});

test("vectors place similar siblings together", () => {
  const near = (v) => ({ key: `n${v}`, label: `N${v}`, vector: [Math.cos(v), Math.sin(v)] });
  const d = layout({
    key: "root",
    label: "Root",
    children: [near(0), near(0.05), near(3.1)],
  });
  const idx = (label) => d.nodes.label.indexOf(label);
  const dist = (a, b) => Math.hypot(
    d.nodes.x[idx(a)] - d.nodes.x[idx(b)],
    d.nodes.y[idx(a)] - d.nodes.y[idx(b)],
  );
  assert.ok(dist("N0", "N0.05") < dist("N0", "N3.1"), "PCA placement ignored similarity");
});

test("layout output feeds straight into normalize()", () => {
  const d = normalize(layout(tree));
  assert.equal(d.count, TREE_NODES);
  assert.equal(d.levels.length, 4);
  assert.deepEqual(groupsOf(d), ["alpha", "beta"]);
  assert.ok(d.X instanceof Float32Array);
});

test("normalize accepts row-shaped data and level names", () => {
  const d = normalize({
    levels: ["world", "thing"],
    nodes: [
      { kind: "world", label: "W", x: 0.5, y: 0.5, r: 0.5, s_min: -2, s_opt: 0, s_max: 2 },
      { kind: "thing", label: "T", x: 0.5, y: 0.5, r: 0.1, s_min: 0, s_opt: 2, s_max: 64, parent: 0 },
    ],
  });
  assert.equal(d.count, 2);
  assert.equal(d.leafKind, 1);
  assert.equal(d.KIND[1], 1);
});

test("normalize rejects data it cannot draw", () => {
  assert.throws(() => normalize({ nodes: [{ label: "no geometry" }] }), /not a finite number/);
  assert.throws(() => normalize(null), /data is required/);
});

test("fromPaths builds intermediate nodes", () => {
  const roots = fromPaths([{ path: "src/lib/a.js" }, { path: "src/lib/b.js" }, { path: "README.md" }]);
  assert.equal(roots.length, 2);
  const src = roots.find((r) => r.key === "src");
  assert.equal(src.children[0].key, "lib");
  assert.equal(src.children[0].children.length, 2);
});

test("fromFlat rebuilds nesting from parent ids", () => {
  const roots = fromFlat([
    { id: 1, parent: null, label: "root" },
    { id: 2, parent: 1, label: "child" },
    { id: 3, parent: 2, label: "grandchild" },
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children[0].children[0].label, "grandchild");
});
