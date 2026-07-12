// Build: ESM + CJS + IIFE bundles, plus the stylesheet.
//
// The IIFE build exists for consumers with no bundler — a plain <script> tag that defines
// window.Deepfield. That is not a legacy nicety: it is what lets a zero-build, static-file
// frontend adopt this package without taking on a whole toolchain.

import { build } from "esbuild";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const common = {
  bundle: true,
  target: ["es2020", "chrome90", "firefox90", "safari15"],
  legalComments: "inline",
  logLevel: "info",
};

await Promise.all([
  // Main entry
  build({ ...common, entryPoints: ["src/index.js"], outfile: "dist/deepfield.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/index.js"], outfile: "dist/deepfield.cjs", format: "cjs" }),
  build({
    ...common,
    entryPoints: ["src/index.js"],
    outfile: "dist/deepfield.global.js",
    format: "iife",
    globalName: "Deepfield",
    minify: true,
  }),

  // Layout-only entry, so a consumer whose backend already computes geometry never ships
  // the PCA/packing code to the browser.
  build({ ...common, entryPoints: ["src/layout/index.js"], outfile: "dist/layout.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/layout/index.js"], outfile: "dist/layout.cjs", format: "cjs" }),
]);

copyFileSync("src/styles/deepfield.css", "dist/deepfield.css");
console.log("built dist/ (esm, cjs, iife, css)");
