// The data contract. Everything the renderer draws arrives through normalize().
//
// Two accepted shapes, because the two producers are different animals:
//   columnar (struct-of-arrays) — what a backend ships over the wire; already the
//     layout the GPU wants, so it costs nothing to upload.
//   rows (array-of-objects)     — what a human writes by hand or gets from JSON.
// Both land in the same typed-array bundle. Field aliases exist so a producer that
// already speaks a domain dialect (`category`, `lineage_path`) needs no adapter.

const ALIASES = {
  group: ["group", "category", "cat"],
  lineage: ["lineage", "lineage_path", "path"],
  ref: ["ref", "ref_id", "refId"],
  parent: ["parent", "parent_index", "parentIndex"],
  s_min: ["s_min", "sMin"],
  s_opt: ["s_opt", "sOpt"],
  s_max: ["s_max", "sMax"],
};

const DEFAULT_LEVELS = ["root", "branch", "group", "leaf"];

function pick(obj, key) {
  for (const name of ALIASES[key] || [key]) {
    if (obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

/** Rows -> columns. Keeps the rest of the pipeline single-path. */
function columnarize(rows) {
  const cols = {
    id: [], kind: [], ref: [], parent: [], x: [], y: [], r: [],
    s_min: [], s_opt: [], s_max: [], weight: [], label: [], group: [], lineage: [],
  };
  rows.forEach((row, i) => {
    cols.id.push(row.id ?? i);
    cols.kind.push(row.kind ?? 0);
    cols.ref.push(pick(row, "ref") ?? -1);
    cols.parent.push(pick(row, "parent") ?? -1);
    cols.x.push(row.x);
    cols.y.push(row.y);
    cols.r.push(row.r);
    cols.s_min.push(pick(row, "s_min"));
    cols.s_opt.push(pick(row, "s_opt"));
    cols.s_max.push(pick(row, "s_max"));
    cols.weight.push(row.weight ?? 1);
    cols.label.push(row.label ?? "");
    cols.group.push(pick(row, "group") ?? "");
    cols.lineage.push(pick(row, "lineage") ?? String(row.label ?? i));
  });
  return cols;
}

/**
 * Normalize any accepted input into the bundle the renderer and GL layer consume.
 *
 * @param {object} input columnar `{count, nodes:{...}}`, `{nodes:[...]}`, or a bare array
 * @param {object} [opts]
 * @param {string[]} [opts.levels] level names; index == kind code
 * @returns {object} `{count, levels, leafKind, X, Y, R, SMIN, SOPT, SMAX, KIND, IDS, REF, PARENT, LABEL, GROUP, LINEAGE}`
 */
export function normalize(input, opts = {}) {
  if (!input) throw new TypeError("deepfield: data is required");

  const rowsIn = Array.isArray(input) ? input
    : Array.isArray(input.nodes) ? input.nodes
      : null;
  const cols = rowsIn ? columnarize(rowsIn) : input.nodes;
  if (!cols || !Array.isArray(cols.x)) {
    throw new TypeError("deepfield: data must be columnar {nodes:{x:[],y:[],...}} or rows [{x,y,...}]");
  }

  const n = input.count ?? cols.x.length;
  const levels = opts.levels || input.levels || DEFAULT_LEVELS;
  const leafKind = levels.length - 1;

  // Kind may arrive as a level NAME (hand-written data) or a CODE (wire format).
  const codeOf = new Map(levels.map((name, i) => [name, i]));
  const KIND = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = cols.kind ? cols.kind[i] : leafKind;
    const code = typeof k === "string" ? codeOf.get(k) : k;
    if (code === undefined) {
      throw new RangeError(`deepfield: node ${i} has unknown kind "${k}" (levels: ${levels.join(", ")})`);
    }
    KIND[i] = Math.min(code, leafKind);
  }

  const num = (arr, name) => {
    if (!arr) throw new TypeError(`deepfield: data.nodes.${name} is required`);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) throw new RangeError(`deepfield: data.nodes.${name}[${i}] is not a finite number`);
      out[i] = v;
    }
    return out;
  };

  const strs = (arr, fallback) =>
    Array.from({ length: n }, (_, i) => String((arr && arr[i]) ?? fallback(i)));
  const ints = (arr, fill) => {
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = arr && arr[i] != null ? arr[i] : fill;
    return out;
  };

  return {
    count: n,
    levels,
    leafKind,
    X: num(cols.x, "x"),
    Y: num(cols.y, "y"),
    R: num(cols.r, "r"),
    SMIN: num(pick(cols, "s_min"), "s_min"),
    SOPT: num(pick(cols, "s_opt"), "s_opt"),
    SMAX: num(pick(cols, "s_max"), "s_max"),
    KIND,
    WEIGHT: ints(cols.weight, 1),
    IDS: cols.id ? Array.from(cols.id) : Array.from({ length: n }, (_, i) => i),
    REF: ints(pick(cols, "ref"), -1),
    PARENT: ints(pick(cols, "parent"), -1),
    LABEL: strs(cols.label, () => ""),
    GROUP: strs(pick(cols, "group"), () => ""),
    LINEAGE: strs(pick(cols, "lineage"), (i) => String((cols.label && cols.label[i]) ?? i)),
  };
}

/** The distinct, sorted group keys present in the data (drives the filter dropdown). */
export function groupsOf(d) {
  return [...new Set(Array.from(d.GROUP).filter(Boolean))].sort();
}
