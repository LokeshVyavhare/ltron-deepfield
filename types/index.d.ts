export interface ColumnarNodes {
  id?: Array<number | string>;
  /** Level code (index into `levels`) or the level name itself. */
  kind?: Array<number | string>;
  /** Your own domain id for the node, echoed back on click. */
  ref?: number[];
  ref_id?: number[];
  /** INDEX into these arrays of the parent node, or -1 for a root. Not an id. */
  parent?: number[];
  x: number[];
  y: number[];
  r: number[];
  /** Visibility window in log2(scale) space. */
  s_min?: number[];
  s_opt?: number[];
  s_max?: number[];
  sMin?: number[];
  sOpt?: number[];
  sMax?: number[];
  weight?: number[];
  label?: string[];
  /** Colour family + filter key. `category` is accepted as an alias. */
  group?: string[];
  category?: string[];
  /** Slash-separated ancestry, used for the breadcrumb. `lineage_path` is an alias. */
  lineage?: string[];
  lineage_path?: string[];
}

export interface RowNode {
  id?: number | string;
  kind?: number | string;
  ref?: number;
  parent?: number;
  x: number;
  y: number;
  r: number;
  s_min: number;
  s_opt: number;
  s_max: number;
  weight?: number;
  label?: string;
  group?: string;
  lineage?: string;
}

export interface DeepfieldData {
  count?: number;
  levels?: string[];
  nodes: ColumnarNodes | RowNode[];
}

/** A node as handed back to your callbacks. */
export interface DeepfieldNode {
  index: number;
  id: number | string;
  ref: number | null;
  kind: number;
  level: string;
  isLeaf: boolean;
  label: string;
  group: string;
  lineage: string;
  weight: number;
  x: number;
  y: number;
  r: number;
}

export interface SearchHit {
  label: string;
  x: number;
  y: number;
  s_opt?: number;
  z?: number;
  level?: string;
  kind?: number | string;
}

export interface DetailItem {
  label: string;
  href?: string;
  note?: string;
}

export interface NodeDetails {
  title?: string;
  subtitle?: string;
  items?: DetailItem[];
  footer?: string;
}

export interface DeepfieldTheme {
  /** Canvas clear colour, `[r, g, b]` in 0..1. */
  background?: [number, number, number];
  hue?: (node: Partial<DeepfieldNode>) => number;
  jitter?: number;
  discScale?: number;
  maxPointSize?: number;
  leafSizeFactor?: number;
}

export type DeepfieldStrings = Partial<Record<
  | "allGroups" | "searchPlaceholder" | "groupTitle" | "home" | "fullscreen"
  | "voidText" | "voidAction" | "help" | "helpTouch" | "loading" | "emptyTitle" | "emptyHint"
  | "noWebGL" | "noWebGLHint" | "shaderFailed" | "descend" | "noChildren" | "detailsFailed",
  string
>>;

export interface DeepfieldOptions {
  data: DeepfieldData | RowNode[];
  /** Level names, outermost first. Index == kind code; the last is the leaf level. */
  levels?: string[];
  strings?: DeepfieldStrings;
  theme?: DeepfieldTheme;
  /** Initial group filter. */
  group?: string;
  /** Set false to hide the group dropdown. */
  groupFilter?: boolean;
  formatGroup?: (group: string) => string;
  tooltip?: (node: DeepfieldNode) => string;
  /** Return false to suppress the default click behaviour. */
  onNodeClick?: (node: DeepfieldNode) => boolean | void;
  onLeafClick?: (node: DeepfieldNode) => void;
  /** Supply the panel contents for a node. Omit and clicking a container just descends. */
  details?: (node: DeepfieldNode) => Promise<NodeDetails | null> | NodeDetails | null;
  /** Custom search. Omit for in-memory label/lineage search; pass null to hide the box. */
  search?: ((q: string) => Promise<SearchHit[]>) | null;
}

export declare class Deepfield {
  constructor(container: HTMLElement, options: DeepfieldOptions);
  /** Release the rAF loop, observers and listeners. Idempotent. */
  destroy(): void;
  /** Restrict to one group key; falsy shows all. */
  filter(key?: string): void;
  flyTo(x: number, y: number, z: number, ms?: number): void;
  home(): void;
}

export declare function deepfield(container: HTMLElement, options: DeepfieldOptions): Deepfield;
export declare function hashHue(key: string): number;
export declare function groupsOf(data: unknown): string[];
/** Normalize any accepted data shape (columnar, rows, bare array, aliases) into the internal column bundle. */
export declare function normalize(
  input: DeepfieldData | RowNode[] | { nodes: RowNode[] },
  opts?: { levels?: string[] }
): unknown;
/** The built-in in-memory label/lineage search over a normalize()d bundle. */
export declare function defaultSearch(data: unknown): (q: string, limit?: number) => Promise<SearchHit[]>;
export declare const DEFAULT_THEME: Required<DeepfieldTheme>;
export declare const DEFAULT_STRINGS: Required<DeepfieldStrings>;

export * from "./layout";
