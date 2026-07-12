// Sample datasets for the playground. Each preset returns a `layout()`-ready input
// (either raw path rows or a nested tree) plus the options `layout()` needs — main.js
// stays dataset-agnostic and just calls `preset.build()`.

// --- Source tree -------------------------------------------------------------------
// Same shape as examples/filesystem.html: a plausible repo, weighted by file size.
// Multiple top-level dirs means each gets its own colour automatically (layout() groups
// by root key when no explicit `group` is given).
const FILES = [
  ["src/api/routes/users.ts", 320], ["src/api/routes/orders.ts", 780],
  ["src/api/routes/auth.ts", 210], ["src/api/middleware/cors.ts", 60],
  ["src/api/middleware/rateLimit.ts", 140], ["src/api/server.ts", 190],
  ["src/db/schema.sql", 450], ["src/db/migrations/001_init.sql", 120],
  ["src/db/migrations/002_orders.sql", 95], ["src/db/client.ts", 210],
  ["src/ui/components/Button.tsx", 80], ["src/ui/components/Table.tsx", 340],
  ["src/ui/components/Modal.tsx", 160], ["src/ui/components/Chart.tsx", 520],
  ["src/ui/pages/Dashboard.tsx", 610], ["src/ui/pages/Settings.tsx", 230],
  ["src/ui/theme.css", 140], ["src/lib/date.ts", 70], ["src/lib/money.ts", 110],
  ["src/lib/retry.ts", 90], ["src/lib/log.ts", 130],
  ["tests/api/users.test.ts", 180], ["tests/api/orders.test.ts", 260],
  ["tests/ui/Table.test.tsx", 150], ["tests/lib/money.test.ts", 90],
  ["docs/architecture.md", 400], ["docs/onboarding.md", 220],
  ["docs/adr/001-storage.md", 130], ["docs/adr/002-auth.md", 110],
];

// --- Org chart -----------------------------------------------------------------------
// Each department is its own root, so departments (not teams) get the distinct colours.
// No explicit weight: a container's default weight is its descendant leaf count, so team
// and department discs size themselves to headcount for free.
const people = (names) => names.map((label) => ({ label }));

const ORG_ROOTS = [
  { label: "Engineering", children: [
    { label: "Platform", children: people(["Ravi K.", "Dana O.", "Wei T.", "Sofia M."]) },
    { label: "Product Eng", children: people(["Marcus L.", "Priya S.", "Ben H.", "Elena V.", "Tomás R."]) },
    { label: "Infra", children: people(["Grace N.", "Omar F.", "Yuki S."]) },
  ] },
  { label: "Sales", children: [
    { label: "Enterprise", children: people(["Jake P.", "Nadia B.", "Chris W."]) },
    { label: "SMB", children: people(["Ana G.", "Leo F.", "Mira K.", "Sam D."]) },
  ] },
  { label: "Marketing", children: [
    { label: "Brand", children: people(["Ivy L.", "Noah C."]) },
    { label: "Growth", children: people(["Talia R.", "Kofi A.", "June H."]) },
  ] },
  { label: "People Ops", children: [
    { label: "Recruiting", children: people(["Zara M.", "Petra V."]) },
    { label: "HR", children: people(["Diego S.", "Alina W."]) },
  ] },
];

// --- Product catalog -------------------------------------------------------------------
// Category is the root (own colour per category); each leaf gets a hand-picked 2D vector
// so PCA placement clusters visually/functionally related products together instead of a
// golden-angle spiral. Weight = sales, so best-sellers get the biggest discs.
let nextId = 0;
const product = (label, weight, vector, price) => {
  const id = `p${nextId++}`;
  CATALOG_DETAILS[id] = {
    items: [{ label: "View product", href: `https://example.com/products/${id}`, note: price }],
  };
  return { id, label, weight, vector };
};
const CATALOG_DETAILS = {};

const CATALOG_ROOTS = [
  { label: "Audio", children: [
    { label: "Headphones", children: [
      product("Aria Over-Ear", 420, [0.9, 0.2], "$179"),
      product("Aria Over-Ear Pro", 260, [0.85, 0.3], "$249"),
      product("Nimbus Earbuds", 610, [0.2, 0.8], "$99"),
      product("Nimbus Earbuds Lite", 340, [0.25, 0.75], "$59"),
    ] },
    { label: "Speakers", children: [
      product("Boombox Mini", 300, [-0.6, 0.4], "$89"),
      product("Boombox Max", 150, [-0.65, 0.35], "$199"),
      product("Patio Speaker", 210, [-0.5, 0.6], "$129"),
    ] },
  ] },
  { label: "Home", children: [
    { label: "Lighting", children: [
      product("Glow Bulb", 800, [0.3, -0.7], "$19"),
      product("Glow Strip", 540, [0.35, -0.6], "$29"),
      product("Glow Lamp", 190, [0.4, -0.8], "$49"),
    ] },
    { label: "Climate", children: [
      product("Aircore Fan", 260, [-0.2, -0.9], "$79"),
      product("Aircore Purifier", 310, [-0.15, -0.85], "$149"),
    ] },
  ] },
  { label: "Wearables", children: [
    { label: "Fitness", children: [
      product("Pulse Band", 700, [0.7, 0.7], "$69"),
      product("Pulse Band Pro", 380, [0.75, 0.65], "$129"),
    ] },
    { label: "Smartwatch", children: [
      product("Orbit Watch", 450, [0.9, 0.9], "$249"),
    ] },
  ] },
];

export const PRESETS = [
  {
    key: "source-tree",
    name: "Source tree",
    levels: ["top", "dir", "group", "file"],
    build: () => ({
      kind: "paths",
      rows: FILES.map(([path, bytes]) => ({ path, bytes, label: path.split("/").pop() })),
      weight: (raw) => raw.bytes || 1,
    }),
  },
  {
    key: "org-chart",
    name: "Org chart",
    levels: ["dept", "team", "person"],
    build: () => ({ kind: "tree", roots: ORG_ROOTS }),
  },
  {
    key: "product-catalog",
    name: "Product catalog",
    levels: ["category", "subcategory", "product"],
    build: () => ({ kind: "tree", roots: CATALOG_ROOTS, detailsMap: CATALOG_DETAILS }),
  },
];

export const CUSTOM_JSON_PLACEHOLDER = JSON.stringify(
  {
    label: "My data",
    children: [
      { label: "A", weight: 3 },
      { label: "B", children: [{ label: "B1" }, { label: "B2" }] },
    ],
  },
  null,
  2,
);
