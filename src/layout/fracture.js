// The density rule.
//
// A node with hundreds of direct children is unreadable at every zoom: they're either too
// small to see or too many to tell apart. So above `maxChildren` we insert a level of
// synthetic grouping nodes. Grouping is by similarity when vectors exist, and by stable
// chunking otherwise — either way it's deterministic, and it's computed once at build time,
// never per frame.

import { centroid, cosine } from "./pca.js";

/**
 * Greedy single-pass clustering by cosine threshold. Order-dependent by design: the caller
 * sorts first, so the result is reproducible.
 *
 * @returns {number[]} cluster index per input row
 */
export function greedyCluster(vectors, threshold) {
  const labels = new Array(vectors.length).fill(-1);
  const seeds = [];
  vectors.forEach((v, i) => {
    let best = -1, bestSim = threshold;
    seeds.forEach((seed, c) => {
      const sim = cosine(v, seed);
      if (sim >= bestSim) { bestSim = sim; best = c; }
    });
    if (best === -1) { seeds.push(v); labels[i] = seeds.length - 1; }
    else labels[i] = best;
  });
  return labels;
}

/**
 * Split an over-full child list into synthetic cluster nodes.
 *
 * @param {object[]} children sorted child nodes
 * @param {object} opts maxChildren, clusterKind, labelCluster
 * @returns {object[]} the new child list (may contain synthetic cluster nodes)
 */
export function fracture(children, opts) {
  const max = opts.maxChildren;
  if (children.length <= max) return children;

  const groups = new Map();
  const cents = children.map((c) => c.centroid || null);
  const allHaveVectors = cents.every(Boolean);

  if (allHaveVectors && children.length >= 3) {
    let labels = null;
    // Loosen the threshold until the split actually fits under the cap. Starting strict and
    // relaxing keeps tight groups tight when they exist.
    for (let t = 0.75; t >= 0.4 - 1e-9; t -= 0.05) {
      const lab = greedyCluster(cents, t);
      if (new Set(lab).size <= max) { labels = lab; break; }
    }
    // A degenerate single group would recurse forever (fracture -> one cluster -> fracture).
    // Fall back to deterministic chunking instead.
    if (!labels || new Set(labels).size <= 1) {
      labels = children.map((_, i) => i % max);
    }
    labels.forEach((g, i) => {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(children[i]);
    });
  } else {
    const size = Math.ceil(children.length / max);
    children.forEach((c, i) => {
      const g = Math.floor(i / size);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    });
  }

  const out = [];
  for (const g of [...groups.keys()].sort((a, b) => a - b)) {
    const members = groups.get(g);
    if (members.length === 1) { out.push(members[0]); continue; }   // singletons stay direct
    const leaves = members.flatMap((m) => m.leaves);
    out.push({
      kind: opts.clusterKind,
      key: `~c${g}`,
      label: opts.labelCluster(members, g),
      ref: null,
      synthetic: true,
      leaves,
      children: members,
      weight: Math.max(1, leaves.length),
      centroid: centroid(members.map((m) => m.centroid)),
      x: 0, y: 0, r: 0, depth: 0,
    });
  }
  return out;
}

/**
 * Default cluster label: the most common significant word across member labels. Naming a
 * group after what's inside it beats "Group 3", which tells the user nothing.
 */
export function defaultClusterLabel(members, index) {
  const STOP = new Set([
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "by", "with",
    "from", "is", "are", "was", "be", "as", "it", "its", "this", "that", "new",
  ]);
  const freq = new Map();
  for (const m of members) {
    for (const word of String(m.label || "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3 || STOP.has(word)) continue;
      freq.set(word, (freq.get(word) || 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))   // count desc, then alpha: stable
    .slice(0, 3)
    .map(([w]) => w);
  if (top.length) return top.join(", ");
  // No usable words (non-Latin labels, say) — a representative label beats a bare number.
  const first = members.find((m) => m.label);
  return first ? String(first.label).slice(0, 48) : `Group ${index + 1}`;
}
