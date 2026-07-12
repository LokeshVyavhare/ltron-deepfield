// Colour + tunables. Everything a consumer might want to restyle lives here, so
// the renderer never hard-codes a look.

/** Stable string -> hue in [0,1). Same key always gets the same colour, no palette to maintain. */
export function hashHue(key) {
  let h = 0;
  const s = String(key || "?");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 360) / 360;
}

export const DEFAULT_THEME = {
  /** Canvas clear colour, `[r, g, b]` in 0..1. */
  background: [0.055, 0.063, 0.082],
  /** `(node) => hue in [0,1)`. Default: hash the group so siblings share a family. */
  hue: (node) => hashHue(node.group),
  /**
   * Per-node hue jitter, so two nodes in the same group are distinguishable without
   * abandoning the family colour. Derived from position — deterministic, no RNG.
   */
  jitter: 0.04,
  /** Global disc shrink. Smaller discs = calmer zoom. */
  discScale: 0.5,
  /** Largest point sprite in CSS px (also clamped by the GPU's own limit). */
  maxPointSize: 230,
  /** Leaf dots stay modest — the label carries the information, giant blobs don't. */
  leafSizeFactor: 0.13,
};

// Fade-in starts BEFORE s_min and runs long, so discs appear small and near their
// parent's centre rather than popping in at full size at the viewport edge. Size eases
// in with the fade (see the vertex shader). Fade-out stays tight at s_max.
export const FADE_IN_PRE = 0.3;
export const FADE_IN_LEN = 1.4;
export const FADE_OUT = 0.75;

// Camera zoom limits, in log2(scale) space.
export const Z_MIN = -2.0;
export const Z_MAX = 9.0;

export const DEFAULT_STRINGS = {
  allGroups: "◉ All",
  searchPlaceholder: "Search…",
  groupTitle: "Focus one group, or view all",
  home: "Reset view",
  fullscreen: "Toggle fullscreen",
  voidText: "◎ nothing in view —",
  voidAction: "return to the map",
  help: "scroll = zoom · drag = pan · click = open",
  loading: "Loading…",
  emptyTitle: "Nothing to map.",
  emptyHint: "",
  noWebGL: "This view requires WebGL2.",
  noWebGLHint: "This browser or GPU can't render the map.",
  shaderFailed: "Shader compile failed.",
  descend: "⤓ Descend into this",
  noChildren: "Nothing inside.",
  detailsFailed: "Could not load node.",
};
