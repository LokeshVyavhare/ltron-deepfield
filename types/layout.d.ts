import type { DeepfieldData } from "./index";

export interface HierarchyNode {
  id?: number | string;
  key?: string;
  label?: string;
  name?: string;
  children?: HierarchyNode[];
  /** Defaults to the node's leaf count. */
  weight?: number;
  /** Optional embedding. With vectors, siblings are placed by similarity (PCA); without,
   *  they go on a deterministic golden-angle spiral. */
  vector?: number[] | Float32Array;
  /** Colour family + filter key. Defaults to the root's key. */
  group?: string;
  [key: string]: unknown;
}

export interface LayoutOptions {
  /** Level names, outermost first. The last is the leaf level. */
  levels?: string[];
  /** Level code for synthetic grouping nodes. Defaults to the second-deepest level. */
  clusterKind?: number;
  /** Above this many children, insert synthetic grouping nodes. */
  maxChildren?: number;
  /** How much of the parent's radius children spread across (0..1). */
  spread?: number;
  /** Fraction of the parent disc the children's combined area aims to fill. */
  packingFraction?: number;
  relaxIterations?: number;
  weight?: (node: HierarchyNode) => number;
  vector?: (node: HierarchyNode) => number[] | Float32Array | null | undefined;
  group?: (node: HierarchyNode) => string;
  labelCluster?: (members: unknown[], index: number) => string;
}

/**
 * Compute map geometry for a hierarchy. Deterministic: the same input always yields the
 * same coordinates, so rebuilds never shuffle the map out from under the user.
 */
export declare function layout(
  input: HierarchyNode | HierarchyNode[],
  options?: LayoutOptions,
): DeepfieldData;

/** Flat `[{id, parent}]` rows -> nested hierarchy. */
export declare function fromFlat(
  rows: Array<Record<string, unknown>>,
  opts?: { idKey?: string; parentKey?: string },
): HierarchyNode[];

/** `[{path: "a/b/c"}]` rows -> nested hierarchy, creating intermediate nodes. */
export declare function fromPaths(
  rows: Array<Record<string, unknown>>,
  opts?: { pathKey?: string; separator?: string },
): HierarchyNode[];

export declare function defaultClusterLabel(members: unknown[], index: number): string;
