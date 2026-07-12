// Default search: substring match over labels and lineage, ranked by weight.
//
// Runs entirely in memory over the already-loaded map, so the package works with no
// backend at all. A consumer with a real search index (or a corpus too large to scan)
// passes their own `search` option instead; passing `null` hides the box.

/**
 * @param {object} d normalized data bundle
 * @returns {(q: string, limit?: number) => Promise<object[]>}
 */
export function defaultSearch(d) {
  return async (q, limit = 20) => {
    const needle = String(q || "").toLowerCase();
    if (!needle) return [];
    const hits = [];
    for (let i = 0; i < d.count; i++) {
      const label = d.LABEL[i].toLowerCase();
      const lineage = d.LINEAGE[i].toLowerCase();
      if (!label.includes(needle) && !lineage.includes(needle)) continue;
      // A label match beats a lineage-only match; weight breaks ties. Otherwise a big
      // ancestor outranks the exact node the user typed the name of.
      const score = (label.includes(needle) ? 1e9 : 0)
        + (label.startsWith(needle) ? 1e8 : 0)
        + d.WEIGHT[i];
      hits.push({
        score,
        index: i,
        id: d.IDS[i],
        label: d.LABEL[i],
        kind: d.KIND[i],
        level: d.levels[d.KIND[i]],
        lineage: d.LINEAGE[i],
        x: d.X[i],
        y: d.Y[i],
        s_opt: d.SOPT[i],
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  };
}
