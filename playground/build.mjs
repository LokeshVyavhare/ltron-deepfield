// Vendors the root dist/ build into playground/vendor/, so the playground is a fully
// self-contained static site — no CDN dependency, works even before the package is
// published to npm. Run `npm run build` at the repo root first (or use the
// `playground:build` script, which does both).

import { mkdirSync, copyFileSync, existsSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const vendor = new URL("./vendor/", import.meta.url);

if (!existsSync(dist)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

mkdirSync(vendor, { recursive: true });
for (const file of ["deepfield.global.js", "deepfield.css"]) {
  copyFileSync(new URL(file, dist), new URL(file, vendor));
}
console.log("vendored dist/ into playground/vendor/");
