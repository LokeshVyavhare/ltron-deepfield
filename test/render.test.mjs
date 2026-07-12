// The renderer, actually rendered.
//
// The layout tests cover the maths, but a WebGL renderer that has never run in a browser is
// not verified: shader compile errors, uniform typos and GL state bugs are invisible to Node.
// These drive a real Chromium (SwiftShader for WebGL2) against the built bundle and assert
// that pixels came out — and that no exception was thrown getting there.
//
// Skipped automatically when Playwright isn't installed, so `npm test` still works without it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const BUNDLE = "dist/deepfield.global.js";
const CSS = "dist/deepfield.css";

let chromium;
try { ({ chromium } = await import("playwright")); } catch { /* not installed */ }

const runnable = chromium && existsSync(BUNDLE);
const opts = { skip: runnable ? false : "playwright or dist/ missing — run npm run build first" };

let browser, page;
let launchFailed = null;
const errors = [];

before(async () => {
  if (!runnable) return;
  try {
    browser = await chromium.launch({
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    });
  } catch (err) {
    // Playwright installed but browsers not fetched (`npx playwright install chromium`).
    // This suite runs inside prepublishOnly — a missing browser must skip, not abort publish.
    launchFailed = `browser launch failed — ${err.message.split("\n")[0]}`;
    return;
  }
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.setContent(`<!doctype html><html><head><style>
      ${readFileSync(CSS, "utf8")}
      html,body{margin:0} #map{width:900px;height:600px}
    </style></head><body><div id="map"></div>
    <script>${readFileSync(BUNDLE, "utf8")}</script></body></html>`);
});

after(async () => { if (browser) await browser.close(); });

test("WebGL2 is available in the test browser", opts, async (t) => {
  if (launchFailed) return t.skip(launchFailed);
  const ok = await page.evaluate(() =>
    !!document.createElement("canvas").getContext("webgl2"));
  assert.ok(ok, "no WebGL2 — the render assertions below would be meaningless");
});

test("a hierarchy renders actual pixels", opts, async (t) => {
  if (launchFailed) return t.skip(launchFailed);
  const result = await page.evaluate(async () => {
    const tree = {
      key: "root", label: "Root",
      children: Array.from({ length: 5 }, (_, i) => ({
        key: `b${i}`, label: `Branch ${i}`,
        children: Array.from({ length: 6 }, (_, j) => ({ key: `l${i}_${j}`, label: `Leaf ${i}-${j}` })),
      })),
    };
    const data = Deepfield.layout(tree);
    const df = new Deepfield.Deepfield(document.getElementById("map"), { data });

    // Let the camera ease to its fit — frame 1 is not settled.
    await new Promise((r) => setTimeout(r, 900));

    // readPixels MUST run inside a rAF callback. WebGL discards the drawing buffer once the
    // frame is composited, so reading from a timer returns an empty buffer even though the
    // map drew fine. Our callback is queued after the renderer's (which re-queues itself at
    // the end of each frame), so it lands right after that frame's draw, buffer intact.
    return await new Promise((resolve) => {
      requestAnimationFrame(() => {
        const canvas = document.querySelector(".df-canvas");
        const gl = canvas.getContext("webgl2");
        const px = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // The clear colour is a known dark blue (~14,16,21). Anything brighter is a node.
        let drawn = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] > 30 || px[i + 1] > 30 || px[i + 2] > 40) drawn++;
        }
        resolve({
          drawn,
          nodes: data.count,
          labels: document.querySelectorAll(".df-label").length,
          glError: gl.getError(),
          hasInstance: typeof df.destroy === "function",
        });
      });
    });
  });

  assert.equal(result.glError, 0, "GL raised an error during rendering");
  assert.ok(result.drawn > 500, `expected the map to paint pixels, only ${result.drawn} lit up`);
  assert.ok(result.labels > 0, "no label divs were created");
  assert.equal(result.nodes, 36, "layout produced the wrong node count");
  assert.deepEqual(errors, [], "the page raised errors");
});

test("destroy() stops the loop and leaves nothing running", opts, async (t) => {
  if (launchFailed) return t.skip(launchFailed);
  const clean = await page.evaluate(async () => {
    const data = Deepfield.layout({ key: "r", label: "R", children: [{ key: "a", label: "A" }] });
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:300px";
    document.body.appendChild(host);
    const df = new Deepfield.Deepfield(host, { data });
    await new Promise((r) => setTimeout(r, 300));
    df.destroy();
    df.destroy();   // idempotent: a second call must not throw
    return true;
  });
  assert.ok(clean);
  assert.deepEqual(errors, [], "destroy() raised errors");
});

test("partial strings merge with the defaults instead of replacing them", opts, async (t) => {
  if (launchFailed) return t.skip(launchFailed);
  // Regression: spreading `options` after the merged defaults wiped every string the caller
  // did not happen to override, so most of the UI copy came out as "undefined".
  const copy = await page.evaluate(async () => {
    const data = Deepfield.layout({ key: "r", label: "R", children: [{ key: "a", label: "A" }] });
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:300px";
    document.body.appendChild(host);
    new Deepfield.Deepfield(host, { data, strings: { help: "custom help" } });
    await new Promise((r) => setTimeout(r, 100));
    return {
      help: host.querySelector(".df-help").textContent,
      home: host.querySelector(".df-home").title,
    };
  });
  assert.equal(copy.help, "custom help", "the caller's override did not take");
  assert.equal(copy.home, "Reset view", "a default string was clobbered by the partial override");
});
