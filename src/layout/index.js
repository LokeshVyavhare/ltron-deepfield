// layout() — turn a plain hierarchy into map geometry.
//
// This is the half that makes Deepfield dataset-agnostic. The renderer only ever consumes
// geometry (x/y/r + a visibility window per node); it doesn't care where that came from.
// A backend can compute it (that's what the original news corpus does, in Python), or you
// can hand this function a file tree, an org chart, or a taxonomy and get the same thing
// in the browser.
//
// Determinism is a contract, not a nicety: no RNG, fixed iteration counts, and every child
// list sorted before it is used. The same input always produces the same map, so a rebuild
// never shuffles the world out from under a user who had learned where things live.

import { centroid } from "./pca.js";
import { placeChildren, bands } from "./pack.js";
import { fracture, defaultClusterLabel } from "./fracture.js";

const DEFAULTS = {
  levels: ["root", "branch", "cluster", "leaf"],
  /** Above this many children, insert synthetic grouping nodes (see fracture.js). */
  maxChildren: 9,
  /** How much of the parent's radius children may spread across. */
  spread: 0.6,
  /** Fraction of the parent disc the children's combined area aims to fill. */
  packingFraction: 0.62,
  relaxIterations: 24,
  labelCluster: defaultClusterLabel,
};

/** Accept one root, an array of roots, or `{children: [...]}`. */
function asRoots(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.children) && input.label === undefined) return input.children;
  return [input];
}

/**
 * Flat `[{id, parent}]` -> nested. Convenience for the very common case of data that
 * arrives from a table rather than as JSON nesting.
 */
export function fromFlat(rows, { idKey = "id", parentKey = "parent" } = {}) {
  const byId = new Map(rows.map((r) => [r[idKey], { ...r, children: [] }]));
  const roots = [];
  for (const row of byId.values()) {
    const parent = row[parentKey] != null ? byId.get(row[parentKey]) : null;
    if (parent) parent.children.push(row);
    else roots.push(row);
  }
  return roots;
}

/**
 * `[{path: "a/b/c.txt", ...}]` -> nested, creating intermediate nodes. The classic
 * file-tree / taxonomy-path shape.
 */
export function fromPaths(rows, { pathKey = "path", separator = "/" } = {}) {
  const roots = [];
  const index = new Map();
  for (const row of rows) {
    const parts = String(row[pathKey]).split(separator).filter(Boolean);
    let prefix = "";
    let siblings = roots;
    parts.forEach((part, depth) => {
      prefix = prefix ? `${prefix}${separator}${part}` : part;
      let node = index.get(prefix);
      if (!node) {
        const isLast = depth === parts.length - 1;
        node = { key: part, label: part, children: [], ...(isLast ? row : {}) };
        node.label = (isLast && row.label) || part;
        index.set(prefix, node);
        siblings.push(node);
      }
      siblings = node.children;
    });
  }
  return roots;
}

/** Build the internal working tree: resolve weight, vector and leaf membership bottom-up. */
function ingest(raw, opts, depth, keyFallback) {
  const kids = (raw.children || []).map((child, i) => ingest(child, opts, depth + 1, String(i)));
  const key = String(raw.key ?? raw.id ?? raw.label ?? keyFallback);
  const isLeaf = kids.length === 0;

  const node = {
    key,
    label: String(raw.label ?? raw.name ?? key),
    ref: raw.id ?? null,
    group: raw.group,
    source: raw,
    children: kids,
    synthetic: false,
    depth,
    x: 0, y: 0, r: 0,
  };
  node.leaves = isLeaf ? [node] : kids.flatMap((k) => k.leaves);

  const explicit = opts.weight ? opts.weight(raw) : raw.weight;
  node.weight = Math.max(1, explicit ?? node.leaves.length);

  const vector = opts.vector ? opts.vector(raw) : raw.vector;
  node.centroid = isLeaf
    ? (vector || null)
    : centroid(kids.map((k) => k.centroid));
  if (!isLeaf && vector) node.centroid = vector;   // an explicit vector wins over the mean

  return node;
}

/** Deterministic sibling order: heaviest first, then by key. */
const sortChildren = (kids) =>
  kids.slice().sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** Recursively fracture + place. Depth is assigned here, after fracture inserts levels. */
function build(node, opts, depth) {
  node.depth = depth;
  if (!node.children.length) return;
  node.children = fracture(sortChildren(node.children), opts);
  placeChildren(node, node.children, opts);
  for (const child of node.children) build(child, opts, depth + 1);
}

/**
 * Compute map geometry for a hierarchy.
 *
 * @param {object|object[]} input root node, array of roots, or `{children: [...]}`.
 *   Each node: `{id?, key?, label, children?, weight?, vector?, group?}`
 * @param {object} [options] see DEFAULTS; plus `weight(node)`, `vector(node)`, `group(node)`
 * @returns {object} columnar data, ready for `new Deepfield(el, { data })`
 */
export function layout(input, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const levels = opts.levels;
  const leafKind = levels.length - 1;
  const clusterKind = opts.clusterKind ?? Math.max(0, leafKind - 1);
  opts.leafKind = leafKind;
  opts.clusterKind = clusterKind;

  const roots = sortChildren(asRoots(input).map((r, i) => ingest(r, opts, 0, String(i))));
  if (!roots.length) return { count: 0, levels, nodes: {} };

  // The world is a unit disc; roots are packed inside it exactly like any other sibling set.
  const world = { key: "", label: "", x: 0.5, y: 0.5, r: 0.5, depth: -1, weight: 1, children: roots };
  placeChildren(world, roots, opts);
  for (const root of roots) build(root, opts, 0);

  // --- flatten to columns ------------------------------------------------------------
  const cols = {
    id: [], kind: [], ref: [], parent: [], x: [], y: [], r: [],
    s_min: [], s_opt: [], s_max: [], weight: [], label: [], group: [], lineage: [],
  };

  const kindOf = (node) => {
    if (node.synthetic) return clusterKind;
    if (!node.children.length) return leafKind;
    // Deeper than we have level names for: hold at the last container level. Level only
    // drives shading and label size, so saturating is harmless — and beats going out of range.
    return Math.min(node.depth, Math.max(0, leafKind - 1));
  };

  let next = 0;
  const emit = (node, parentIndex, lineage, group, parentSMax) => {
    const i = next++;
    const kind = kindOf(node);
    let [sMin, sOpt, sMax] = bands(node, kind === leafKind);
    // Band continuity: a child must begin fading in BEFORE its parent is gone, even across a
    // big radius jump (wide container -> tiny leaf dot). Without this the dive passes through
    // a zoom range where neither level is visible and the screen goes blank.
    if (parentSMax != null) {
      sMin = Math.min(sMin, parentSMax - 0.5);
      sOpt = Math.max(sOpt, sMin + 0.1);
    }

    cols.id.push(i);
    cols.kind.push(kind);
    cols.ref.push(node.ref ?? -1);
    cols.parent.push(parentIndex);
    cols.x.push(node.x);
    cols.y.push(node.y);
    cols.r.push(node.r);
    cols.s_min.push(sMin);
    cols.s_opt.push(sOpt);
    cols.s_max.push(sMax);
    cols.weight.push(node.weight);
    cols.label.push(node.label);
    cols.group.push(group);
    cols.lineage.push(lineage);

    for (const child of node.children) {
      emit(child, i, `${lineage}/${child.key}`, group, sMax);
    }
  };

  for (const root of roots) {
    const group = (opts.group ? opts.group(root.source) : root.group) ?? root.key;
    emit(root, -1, root.key, String(group), null);
  }

  return { count: next, levels, nodes: cols };
}

export { defaultClusterLabel };
