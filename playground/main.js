// Playground wiring: dataset presets + a live config panel over a single Deepfield instance.
//
// A few controls (disc size, colour mode, dataset, group density) bake into per-node data or
// DOM markup at mount time, so changing them tears down and recreates the instance. Background
// colour and leaf size are read fresh every frame by the renderer, so those mutate `df.opts.theme`
// in place — instant, no flicker, no rebuild.
import { PRESETS, CUSTOM_JSON_PLACEHOLDER } from "./presets.js";

const CUSTOM_KEY = "__custom__";

const mapEl = document.getElementById("map");
if (!window.Deepfield) {
  mapEl.innerHTML = '<p style="padding:24px;color:#8b93a3">Couldn’t load the Deepfield bundle (vendor/deepfield.global.js missing — run `npm run playground:build`).</p>';
  throw new Error("window.Deepfield is not defined");
}
const { Deepfield, layout, fromPaths } = window.Deepfield;

const datasetSelect = document.getElementById("dataset-select");
const customSection = document.getElementById("custom-json-section");
const customTextarea = document.getElementById("custom-json");
const applyJsonBtn = document.getElementById("apply-json");
const jsonError = document.getElementById("json-error");

const hueMode = document.getElementById("hue-mode");
const hueSliderRow = document.getElementById("hue-slider-row");
const hueSlider = document.getElementById("hue-slider");
const bgColor = document.getElementById("bg-color");
const discScale = document.getElementById("disc-scale");
const leafSize = document.getElementById("leaf-size");
const maxChildren = document.getElementById("max-children");
const groupFilterToggle = document.getElementById("group-filter-toggle");
const searchToggle = document.getElementById("search-toggle");

let df = null;

datasetSelect.innerHTML =
  PRESETS.map((p) => `<option value="${p.key}">${p.name}</option>`).join("") +
  `<option value="${CUSTOM_KEY}">Your own JSON…</option>`;
customTextarea.value = CUSTOM_JSON_PLACEHOLDER;

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function detailsFor(detailsMap) {
  return (node) => {
    const extra = detailsMap && node.ref != null ? detailsMap[node.ref] : null;
    return {
      title: node.label,
      footer: `${node.level} · weight ${node.weight}`,
      items: (extra && extra.items) || [],
    };
  };
}

/** Resolve the selected dataset into a layout()-ready tree + options. Throws on bad JSON. */
function buildInput(key) {
  if (key === CUSTOM_KEY) {
    return { roots: JSON.parse(customTextarea.value), levels: undefined, weight: undefined, detailsMap: null };
  }
  const preset = PRESETS.find((p) => p.key === key);
  const spec = preset.build();
  const roots = spec.kind === "paths" ? fromPaths(spec.rows) : spec.roots;
  return { roots, levels: preset.levels, weight: spec.weight, detailsMap: spec.detailsMap || null };
}

function rebuild() {
  const key = datasetSelect.value;
  customSection.hidden = key !== CUSTOM_KEY;
  jsonError.hidden = true;

  let input;
  try {
    input = buildInput(key);
  } catch (err) {
    jsonError.hidden = false;
    jsonError.textContent = `Couldn't parse JSON: ${err.message}`;
    return;
  }

  const layoutOpts = { maxChildren: Number(maxChildren.value) };
  if (input.levels) layoutOpts.levels = input.levels;
  if (input.weight) layoutOpts.weight = input.weight;

  let data;
  try {
    data = layout(input.roots, layoutOpts);
  } catch (err) {
    jsonError.hidden = false;
    jsonError.textContent = `Couldn't build the map: ${err.message}`;
    return;
  }

  const theme = {
    background: hexToRgb01(bgColor.value),
    discScale: Number(discScale.value),
    leafSizeFactor: Number(leafSize.value),
  };
  // Only override `hue` in single-hue mode — an explicit `hue: undefined` key would clobber
  // the widget's own default (hash-by-group) instead of falling through to it.
  if (hueMode.value === "single") {
    const h = Number(hueSlider.value) / 360;
    theme.hue = () => h;
  }

  if (df) df.destroy();
  df = new Deepfield(mapEl, {
    data,
    levels: layoutOpts.levels,
    theme,
    groupFilter: groupFilterToggle.checked,
    search: searchToggle.checked ? undefined : null,
    details: detailsFor(input.detailsMap),
  });
}

// --- controls that require a full rebuild (baked into per-node data or DOM at mount) ---
datasetSelect.addEventListener("change", rebuild);
hueMode.addEventListener("change", () => {
  hueSliderRow.hidden = hueMode.value !== "single";
  rebuild();
});
hueSlider.addEventListener("change", rebuild);
discScale.addEventListener("change", rebuild);
maxChildren.addEventListener("change", rebuild);
groupFilterToggle.addEventListener("change", rebuild);
searchToggle.addEventListener("change", rebuild);
applyJsonBtn.addEventListener("click", rebuild);

// --- controls the renderer reads live every frame — mutate in place, no rebuild ---
bgColor.addEventListener("input", () => {
  if (df) df.opts.theme.background = hexToRgb01(bgColor.value);
});
leafSize.addEventListener("input", () => {
  if (df) df.opts.theme.leafSizeFactor = Number(leafSize.value);
});

// --- config panel toggle (small screens only; the CSS hides the button above 860px) ---
const panelEl = document.getElementById("panel");
const panelToggle = document.getElementById("panel-toggle");
panelToggle.addEventListener("click", () => {
  const open = panelEl.classList.toggle("open");
  panelToggle.setAttribute("aria-expanded", String(open));
  if (open) panelEl.scrollIntoView({ behavior: "smooth", block: "start" });
});

// --- install snippet copy button ---
document.getElementById("copy-install").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(document.getElementById("install-cmd").textContent);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch { /* clipboard permission denied — nothing useful to do */ }
});

rebuild();
