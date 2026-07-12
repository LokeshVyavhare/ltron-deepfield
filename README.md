# @ltron/deepfield

A zoomable WebGL2 map for **any hierarchy**. Scroll to dive from roots, through branches, down to individual leaves — with a continuous cross-fade between levels instead of discrete drill-down clicks.

Zero runtime dependencies. ~28 kB minified. Renders ~10k nodes on the GPU.

**[Live demo / playground →](https://lokeshvyavhare.github.io/ltron-deepfield/)** — try it with the built-in sample datasets or paste your own hierarchy.

```bash
npm install @ltron/deepfield
```

## Two ways in

The package is split so you only pay for what you use.

**You have a hierarchy.** Hand it over; geometry is computed in the browser.

```js
import { Deepfield, layout, fromPaths } from "@ltron/deepfield";
import "@ltron/deepfield/style.css";

const roots = fromPaths(files.map((f) => ({ path: f.path, bytes: f.size, label: f.name })));
const data = layout(roots, { weight: (n) => n.bytes });

new Deepfield(document.getElementById("map"), { data });
```

**Your backend already computes geometry.** Skip `layout()` entirely and ship the columns over the wire — the renderer never needs the packing code.

```js
import { Deepfield } from "@ltron/deepfield";

new Deepfield(el, { data: await fetch("/map").then((r) => r.json()) });
```

## The data contract

The renderer draws whatever satisfies this shape. It has no idea what your nodes mean.

```js
{
  count: 1234,
  levels: ["category", "layer", "cluster", "article"],   // outermost first; last == leaf
  nodes: {
    x: [], y: [], r: [],            // world coordinates + radius
    s_min: [], s_opt: [], s_max: [], // visibility window in log2(zoom) space
    kind: [],                        // index into `levels`, or the level name
    parent: [],                      // INDEX into these arrays (not an id), -1 for a root
    label: [], group: [], lineage: [], weight: [], id: [], ref: [],
  }
}
```

Rows work too — `nodes: [{x, y, r, s_min, ...}, ...]` — and `category`/`lineage_path`/`ref_id` are accepted as aliases, so a backend already speaking its own dialect needs no adapter.

`s_min`/`s_opt`/`s_max` are the whole trick. Each node declares the zoom band in which it is worth showing; the GPU cross-fades it in and out through a smoothstep trapezoid. That's why there are no viewport fetches and no scene graph: the entire map is uploaded once and the GPU decides what's visible, every frame.

## Options

| Option | Purpose |
|---|---|
| `data` | Required. Columnar or rows. |
| `levels` | Level names, outermost first. The last one is the leaf level. |
| `details(node)` | Return `{title, subtitle, items:[{label, href}]}` to populate the side panel. Omit it and clicking a container just descends. |
| `onLeafClick(node)` | What clicking a leaf means in your app (usually navigation). |
| `search(q)` | Custom search. Omit for built-in in-memory search; pass `null` to hide the box. |
| `theme` | `background`, `hue(node)`, `discScale`, `leafSizeFactor`… |
| `strings` | Every piece of UI copy, for i18n or a themed skin. |
| `group` / `groupFilter` | Initial group filter, and whether to show the dropdown. |

Instance methods: `filter(key)`, `flyTo(x, y, z)`, `home()`, `destroy()`.

Restyle without forking the CSS — everything is a custom property:

```css
.df-wrap { --df-accent: #f0b; --df-panel: #fff; --df-text: #111; }
```

## layout()

Turns a plain hierarchy into geometry. Nodes are `{id?, key?, label, children?, weight?, vector?, group?}`.

- **Radius** follows `weight` by area (`sqrt` of the share), so one heavy child can't swallow the disc.
- **Position** follows `vector` similarity when you supply embeddings — siblings are placed by a deterministic PCA projection, so related things end up near each other. With no vectors, children go on a golden-angle spiral, and the map still builds.
- **Density rule**: a node with more than `maxChildren` children gets synthetic grouping nodes inserted, labelled from their contents. Hundreds of siblings are unreadable at every zoom; this is the fix.

`fromPaths(rows)` and `fromFlat(rows)` convert the two shapes data usually arrives in.

**Determinism is a contract.** No RNG, fixed iteration counts, every child list sorted before use. The same input always produces the same coordinates — a map whose nodes wander between rebuilds is one nobody can learn.

## Invariants

The renderer depends on these, and `layout()` guarantees them (they're covered by tests):

1. Every child lies strictly **inside** its parent's disc.
2. A child starts fading in **before** its parent has faded out — otherwise the dive passes through a zoom range where the screen is blank.
3. `parent` indices point **backwards**, so ancestry resolves in one forward pass.

If you compute geometry yourself, hold to all three.

## Requirements

WebGL2. The renderer degrades to a readable message where it's unavailable rather than throwing. `layout()` is pure JS and runs anywhere, including Node.

## Development

```bash
npm install
npm test          # layout invariants (no DOM needed) + browser render tests when Playwright's Chromium is installed
npm run build     # dist/: esm, cjs, iife, css
open examples/filesystem.html
```

## License

MIT
