// Deterministic PCA-2, for placing siblings by similarity rather than arbitrarily.
//
// No RNG anywhere: the power-iteration seed is a fixed function of the index, so two runs
// over the same input produce byte-identical coordinates. That determinism is a hard
// requirement — a map whose nodes wander between rebuilds is unnavigable.
//
// We eigendecompose the n x n Gram matrix, not the dim x dim covariance. Sibling sets are
// small (a dozen) while vectors are long (768+), so the Gram matrix is the cheap side, and
// its top eigenvectors ARE the projected coordinates up to a scale factor.

const POWER_ITERS = 64;

function gram(rows) {
  const n = rows.length;
  const G = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const a = rows[i], b = rows[j];
      for (let k = 0; k < a.length; k++) s += a[k] * b[k];
      G[i][j] = s;
      G[j][i] = s;
    }
  }
  return G;
}

function matVec(G, v) {
  const n = v.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = G[i];
    for (let j = 0; j < n; j++) s += row[j] * v[j];
    out[i] = s;
  }
  return out;
}

const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

function normalize(v) {
  const m = norm(v);
  if (m < 1e-12) return null;
  for (let i = 0; i < v.length; i++) v[i] /= m;
  return v;
}

/** Top eigenvector of G by power iteration, seeded deterministically. */
function topEigen(G, n, seed) {
  let v = new Float64Array(n);
  // Math.sin of the index: spread-out, deterministic, and never orthogonal to the
  // eigenvector we're chasing (a constant seed can be, and then it never converges).
  for (let i = 0; i < n; i++) v[i] = Math.sin((i + 1) * (seed + 1.7));
  if (!normalize(v)) return null;
  let lambda = 0;
  for (let it = 0; it < POWER_ITERS; it++) {
    const w = matVec(G, v);
    const m = norm(w);
    if (m < 1e-12) return null;
    for (let i = 0; i < n; i++) w[i] /= m;
    lambda = m;
    v = w;
  }
  return { vec: v, value: lambda };
}

/** Subtract the component along `vec` from every row of G (deflation). */
function deflate(G, n, vec, value) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) G[i][j] -= value * vec[i] * vec[j];
  }
}

/**
 * Project vectors to 2D, then min-max scale each axis into [0, 1].
 *
 * @param {number[][]|Float32Array[]} rows one vector per node (all the same length)
 * @returns {number[][]} `[[x, y], ...]` in [0,1]; degenerate inputs collapse to [0.5, 0.5]
 */
export function pca2(rows) {
  const n = rows.length;
  if (n === 0) return [];
  if (n === 1) return [[0.5, 0.5]];

  const dim = rows[0].length;
  const mean = new Float64Array(dim);
  for (const row of rows) for (let k = 0; k < dim; k++) mean[k] += row[k] / n;
  const centered = rows.map((row) => {
    const out = new Float64Array(dim);
    for (let k = 0; k < dim; k++) out[k] = row[k] - mean[k];
    return out;
  });

  const G = gram(centered);
  const e1 = topEigen(G, n, 0);
  if (!e1) return rows.map(() => [0.5, 0.5]);
  deflate(G, n, e1.vec, e1.value);
  const e2 = topEigen(G, n, 1);

  const s1 = Math.sqrt(Math.max(e1.value, 0));
  const s2 = e2 ? Math.sqrt(Math.max(e2.value, 0)) : 0;
  const coords = [];
  for (let i = 0; i < n; i++) {
    coords.push([e1.vec[i] * s1, e2 ? e2.vec[i] * s2 : 0]);
  }

  // Scale to [0,1] per axis. A flat axis (all siblings identical along it) centres at 0.5
  // rather than dividing by zero.
  for (const axis of [0, 1]) {
    let lo = Infinity, hi = -Infinity;
    for (const c of coords) { lo = Math.min(lo, c[axis]); hi = Math.max(hi, c[axis]); }
    const span = hi - lo;
    for (const c of coords) c[axis] = span > 1e-9 ? (c[axis] - lo) / span : 0.5;
  }
  return coords;
}

/** Mean of the member vectors, L2-normalized. Null when nothing has a vector. */
export function centroid(vectors) {
  const rows = vectors.filter(Boolean);
  if (!rows.length) return null;
  const dim = rows[0].length;
  const c = new Float64Array(dim);
  for (const row of rows) for (let k = 0; k < dim; k++) c[k] += row[k] / rows.length;
  const m = norm(c);
  if (m > 1e-12) for (let k = 0; k < dim; k++) c[k] /= m;
  return c;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-12 ? dot / denom : 0;
}
