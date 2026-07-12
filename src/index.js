import { Deepfield } from "./deepfield.js";

export { Deepfield };
export { normalize, groupsOf } from "./data.js";
export { defaultSearch } from "./search.js";
export { hashHue, DEFAULT_THEME, DEFAULT_STRINGS } from "./theme.js";
export { layout, fromFlat, fromPaths, defaultClusterLabel } from "./layout/index.js";

/** Sugar for `new Deepfield(el, opts)`, for consumers who prefer a factory. */
export function deepfield(container, options) {
  return new Deepfield(container, options);
}
