// Deepfield — a zoomable WebGL2 map of any hierarchy.
//
// One bulk upload of the whole map; the GPU culls per frame through a smoothstep
// visibility window in log2-zoom space, so scrolling dives root -> branch -> leaf with a
// continuous cross-fade instead of discrete level swaps. A parallel CPU pass over the
// same window drives labels, hit-testing and the breadcrumb, which the GPU can't hand back.
//
// Everything host-specific is an option: data, level names, copy, colour, what a click
// means, and where node details come from. The renderer itself knows nothing about any
// particular dataset.

import { normalize, groupsOf } from "./data.js";
import { initGL, uploadBuffers } from "./gl.js";
import { defaultSearch } from "./search.js";
import {
  DEFAULT_THEME, DEFAULT_STRINGS, FADE_IN_PRE, FADE_IN_LEN, FADE_OUT, Z_MIN, Z_MAX,
} from "./theme.js";

const LABEL_POOL = 48;   // pooled divs — labels are recycled, never created per frame
const LABEL_SHOW = 40;   // how many of the pool are actually shown (hysteresis gap)

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Details items carry hrefs from arbitrary backend data. Only navigable link schemes come
// through as anchors; anything else (javascript:, data:, …) falls back to plain text.
const safeHref = (url) => {
  try {
    const p = new URL(String(url), "https://relative.invalid/").protocol;
    return p === "http:" || p === "https:" || p === "mailto:" ? String(url) : null;
  } catch { return null; }
};

function notice(title, hint) {
  return `<div class="df-empty"><div class="df-empty-title">${esc(title)}</div>${
    hint ? `<div class="df-empty-hint">${esc(hint)}</div>` : ""}</div>`;
}

export class Deepfield {
  /**
   * @param {HTMLElement} container element to render into (its contents are replaced)
   * @param {import("../types").DeepfieldOptions} options
   */
  constructor(container, options = {}) {
    if (!container || !container.appendChild) {
      throw new TypeError("deepfield: first argument must be a DOM element");
    }
    this.el = container;
    // Spread FIRST, then the merged sub-objects — otherwise a caller passing a partial
    // `strings` would clobber the whole default set and leave most copy undefined.
    this.opts = {
      ...options,
      strings: { ...DEFAULT_STRINGS, ...(options.strings || {}) },
      theme: { ...DEFAULT_THEME, ...(options.theme || {}) },
    };
    this._alive = true;
    this._teardowns = [];
    this._mount();
  }

  /** Release the rAF loop, observers, document listeners and GL buffers. Idempotent. */
  destroy() {
    if (!this._alive) return;
    this._alive = false;
    for (const fn of this._teardowns.splice(0)) {
      try { fn(); } catch { /* a failed teardown must not block the rest */ }
    }
  }

  /** Restrict the map to one group key, or pass a falsy value for all of them. */
  filter(key) { if (this._applyFilter) this._applyFilter(key || ""); }

  /** Animate the camera to a world point at a given log2 zoom. */
  flyTo(x, y, z, ms = 900) { if (this._flyTo) this._flyTo(x, y, z, ms); }

  /** Frame the whole (currently filtered) map. */
  home() { if (this._home) this._home(); }

  // --- mount ---------------------------------------------------------------
  _mount() {
    const { strings, theme } = this.opts;
    const el = this.el;
    // A touch device has no wheel and no click, so the hint mustn't claim it does. Read once
    // at mount: this decides copy, not layout — the CSS handles the responsive part.
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

    el.innerHTML = `<div class="df-wrap">
        <canvas class="df-canvas"></canvas>
        <div class="df-labels"></div>
        <div class="df-hud">
          <div class="df-hud-row">
            <select class="df-group" title="${esc(strings.groupTitle)}"></select>
            <div class="df-searchbox">
              <input class="df-search" type="search" placeholder="${esc(strings.searchPlaceholder)}" />
              <div class="df-results"></div>
            </div>
          </div>
          <div class="df-crumb"></div>
        </div>
        <button class="df-home" title="${esc(strings.home)}">⌂</button>
        <button class="df-fs" title="${esc(strings.fullscreen)}">⛶</button>
        <div class="df-void" hidden>${esc(strings.voidText)}
          <button class="df-btn">${esc(strings.voidAction)}</button></div>
        <div class="df-help">${esc(coarse ? strings.helpTouch : strings.help)}</div>
        <div class="df-panel"><div class="df-panel-inner"></div></div>
      </div>`;

    const wrap = el.querySelector(".df-wrap");
    const canvas = el.querySelector(".df-canvas");

    // --- data ---------------------------------------------------------------
    const d = normalize(this.opts.data, { levels: this.opts.levels });
    this.data = d;
    const n = d.count;
    if (!n) {
      el.innerHTML = notice(strings.emptyTitle, strings.emptyHint);
      return;
    }
    const leaf = d.leafKind;
    const { X, Y, SMIN, SOPT, SMAX, KIND, IDS, REF, PARENT, LABEL, GROUP, LINEAGE } = d;

    // Radii are shrunk once, here — the CPU pass and the GPU must agree on disc size or
    // hit-testing drifts from what's drawn.
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) R[i] = d.R[i] * theme.discScale;
    d.RSCALED = R;

    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      el.innerHTML = notice(strings.noWebGL, strings.noWebGLHint);
      return;
    }

    // ON drives filtering; HUE is fixed per node.
    const ON = new Float32Array(n);
    const HUE = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ON[i] = 1;
      const jitter = theme.jitter
        ? ((X[i] * 13.37 + Y[i] * 7.91) % (theme.jitter * 2)) - theme.jitter
        : 0;
      const h = theme.hue({
        index: i, id: IDS[i], kind: KIND[i], level: d.levels[KIND[i]],
        label: LABEL[i], group: GROUP[i], lineage: LINEAGE[i], weight: d.WEIGHT[i],
      });
      HUE[i] = (h + jitter + 1) % 1;
    }

    let glo = initGL(gl);
    if (!glo) { el.innerHTML = notice(strings.shaderFailed); return; }
    uploadBuffers(gl, glo, d, HUE, ON);

    // --- camera ---------------------------------------------------------------
    // Content bounds in world units. Framing, clamping and void-rescue all key off the
    // nodes ENABLED by the current filter, never an abstract world square — otherwise
    // filtering to one small group leaves the camera stranded in empty space.
    const bounds = { x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5, span: 1 };
    const computeBounds = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!ON[i]) continue;
        x0 = Math.min(x0, X[i] - R[i]); x1 = Math.max(x1, X[i] + R[i]);
        y0 = Math.min(y0, Y[i] - R[i]); y1 = Math.max(y1, Y[i] + R[i]);
      }
      if (x0 > x1) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
      bounds.x0 = x0; bounds.y0 = y0; bounds.x1 = x1; bounds.y1 = y1;
      bounds.cx = (x0 + x1) / 2; bounds.cy = (y0 + y1) / 2;
      bounds.span = Math.max(0.05, x1 - x0, y1 - y0);
    };
    computeBounds();

    const cam = { x: bounds.cx, y: bounds.cy, z: 0, zTarget: 0, s0: 600, anchor: null, fly: null };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width * dpr));
      H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W; canvas.height = H;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      cam.s0 = Math.min(W, H) * 0.85;
      gl.viewport(0, 0, W, H);
    };
    resize();

    const scaleOf = () => cam.s0 * Math.pow(2, cam.z);
    // Zoom at which the content box fits, clamped into the top level's visibility band.
    const zFit = () => Math.max(-0.6, Math.min(0.35,
      Math.log2(Math.min(W, H) * 0.8 / (bounds.span * cam.s0))));
    // Zoom at which node i's disc spans ~3/4 of the viewport.
    const fitNodeZ = (i) => Math.max(Z_MIN, Math.min(Z_MAX,
      Math.log2(Math.min(W, H) * 0.75 / (2 * Math.max(R[i], 1e-5) * cam.s0))));

    cam.z = cam.zTarget = zFit();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    this._teardowns.push(() => ro.disconnect());

    const flyTo = (x, y, zTarget, ms = 900) => {
      cam.anchor = null;
      cam.fly = {
        x0: cam.x, y0: cam.y, z0: cam.z, x1: x, y1: y,
        z1: Math.max(Z_MIN, Math.min(Z_MAX, zTarget)), t0: performance.now(), ms,
      };
      cam.zTarget = cam.fly.z1;
    };
    const home = () => flyTo(bounds.cx, bounds.cy, zFit());
    this._flyTo = flyTo;
    this._home = home;

    // --- input ------------------------------------------------------------------
    // Mouse, pen and touch all arrive as pointer events, so one code path serves them all:
    // one pointer down pans, two pinch. `touch-action: none` on the canvas (see the CSS) is
    // what stops the browser eating the gesture as a page scroll or a page pinch-zoom.
    const clampZ = (z) => Math.max(Z_MIN, Math.min(Z_MAX, z));
    // Pointer position in device px, relative to the canvas — the space vis.px/vis.py live in.
    const at = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr];
    };
    const worldAt = (mx, my) => {
      const s = scaleOf();
      return [cam.x + (mx - W / 2) / s, cam.y + (my - H / 2) / s];
    };

    // Cursor-anchored zoom: remember the world point under the cursor once per gesture,
    // then RE-derive the camera from it every frame, so smoothing never drifts.
    // MAGNETIC DIVE: when zooming in, pull the anchor toward the nearest visible node.
    // Content is sparse discs — free-zooming between them just produces void. A cursor
    // already inside a disc still means "that one".
    const onWheel = (e) => {
      e.preventDefault();
      cam.fly = null;
      const zoomingIn = e.deltaY < 0;
      cam.zTarget = clampZ(cam.zTarget - e.deltaY * 0.0017);
      const [mx, my] = at(e);
      let [wx, wy] = worldAt(mx, my);
      if (zoomingIn && vis.count) {
        let best = -1, bd = Infinity;
        for (let k = 0; k < vis.count; k++) {
          const dist = Math.hypot(vis.px[k] - mx, vis.py[k] - my);
          if (dist < bd) { bd = dist; best = k; }
        }
        if (best >= 0) {
          const i = vis.idx[best];
          const inside = bd < vis.pr[best];
          const pull = inside ? 0 : Math.min(0.9, bd / (420 * dpr));
          wx += (X[i] - wx) * pull;
          wy += (Y[i] - wy) * pull;
        }
      }
      cam.anchor = { mx, my, wx, wy };
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const pointers = new Map();   // pointerId -> client position, every finger/button down on us
    let drag = null;              // one-pointer pan, and the tap candidate that goes with it
    let pinch = null;             // two-pointer gesture: the finger spread we last saw

    // A tap is a press that neither travelled nor lingered. Fingers are imprecise, so the
    // slop is far wider than a mouse needs; a mouse click sits well inside it either way.
    const TAP_SLOP = 10;   // CSS px
    const TAP_MS = 600;

    // Centroid + spread of the first two pointers, in device px.
    const spread = () => {
      const [a, b] = [...pointers.values()];
      if (!b) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        mx: ((a.x + b.x) / 2 - rect.left) * dpr,
        my: ((a.y + b.y) / 2 - rect.top) * dpr,
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y) * dpr),
      };
    };
    // Pinch pins the world point under the fingers and then moves that point's SCREEN
    // position with them — one anchor drives both the zoom and the pan, so the map stays
    // under the grip. No magnetic dive here: with two fingers on the glass the user is
    // already saying exactly where they want to be.
    const startPinch = () => {
      const g = spread();
      if (!g) return;
      drag = null;
      cam.fly = null;
      pinch = { dist: g.dist };
      const [wx, wy] = worldAt(g.mx, g.my);
      cam.anchor = { mx: g.mx, my: g.my, wx, wy };
    };

    const endPointer = (e, tap) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pinch) {
        pinch = null;
        if (pointers.size >= 2) {
          startPinch();   // a spare finger lifted; the two that remain are still pinching
        } else {
          // Down to one finger: restart the pan from where the survivor actually is, or the
          // map jumps by the gap between the two. It is still a drag, never a tap.
          const rest = [...pointers.values()][0];
          drag = rest ? { x: rest.x, y: rest.y, x0: rest.x, y0: rest.y, t0: 0, moved: true } : null;
        }
      } else {
        const d = drag;
        drag = null;
        if (tap && d && !d.moved && performance.now() - d.t0 < TAP_MS) onClick(e);
      }
      if (e.pointerType !== "mouse") hideTip();   // no hover to keep the tooltip alive
    };

    canvas.addEventListener("pointerdown", (e) => {
      // A primary pointer is the FIRST finger of a gesture, so nothing else can legitimately
      // still be down. Clearing here self-heals a pointercancel we never got (an OS gesture,
      // browser chrome, a lost capture) — otherwise one leaked finger makes the next tap look
      // like the second half of a pinch, and the map stops responding to touch entirely.
      if (e.isPrimary) { pointers.clear(); pinch = null; drag = null; }
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
      } else if (pointers.size === 2) {
        startPinch();
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (pinch) {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = spread();
        if (!g) return;
        // Fingers spreading by a factor of 2 is exactly one octave of zoom — log2 of the
        // ratio IS the camera's unit, so pinch rides the same axis the wheel drives.
        cam.zTarget = clampZ(cam.zTarget + Math.log2(g.dist / pinch.dist));
        pinch.dist = g.dist;
        cam.anchor.mx = g.mx; cam.anchor.my = g.my;
        cam.fly = null;
        return;
      }
      onHover(e);
      if (!drag || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const dx = (e.clientX - drag.x) * dpr, dy = (e.clientY - drag.y) * dpr;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > TAP_SLOP) drag.moved = true;
      const s = scaleOf();
      cam.x -= dx / s; cam.y -= dy / s;
      cam.anchor = null; cam.fly = null;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    canvas.addEventListener("pointerup", (e) => endPointer(e, true));
    canvas.addEventListener("pointercancel", (e) => endPointer(e, false));
    // Capture can be taken away without a pointerup (an OS-level gesture, browser chrome).
    // Whatever the cause, no gesture state may outlive the pointer that started it.
    canvas.addEventListener("lostpointercapture", (e) => endPointer(e, false));
    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && !pointers.size) hideTip();
    });

    // --- group filter ------------------------------------------------------------
    const groupSel = wrap.querySelector(".df-group");
    const groups = groupsOf(d);
    if (!groups.length || this.opts.groupFilter === false) {
      groupSel.hidden = true;
    } else {
      groupSel.innerHTML = `<option value="">${esc(strings.allGroups)}</option>` +
        groups.map((g) => `<option value="${esc(g)}">${esc(this.opts.formatGroup ? this.opts.formatGroup(g) : g)}</option>`).join("");
      groupSel.value = groups.includes(this.opts.group) ? this.opts.group : "";
    }

    const applyFilter = (key) => {
      for (let i = 0; i < n; i++) ON[i] = (!key || GROUP[i] === key) ? 1 : 0;
      if (glo && glo.bufs.a_on) {
        gl.bindBuffer(gl.ARRAY_BUFFER, glo.bufs.a_on);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, ON);
      }
      computeBounds();
      if (groupSel.value !== key) groupSel.value = key;
      if (key) {
        // Focus mode: dive INTO the group's root disc rather than merely framing it.
        for (let i = 0; i < n; i++) {
          if (KIND[i] === 0 && GROUP[i] === key) { flyTo(X[i], Y[i], fitNodeZ(i)); return; }
        }
      }
      home();
    };
    this._applyFilter = applyFilter;
    groupSel.addEventListener("change", () => applyFilter(groupSel.value));
    if (this.opts.group) applyFilter(this.opts.group);

    // --- home / void rescue -------------------------------------------------------
    wrap.querySelector(".df-home").addEventListener("click", home);
    const voidEl = wrap.querySelector(".df-void");
    voidEl.querySelector("button").addEventListener("click", home);
    let voidFrames = 0;

    // --- fullscreen ---------------------------------------------------------------
    // The wrap becomes the fullscreen element. The panel lives inside the wrap precisely
    // so it keeps rendering in :fullscreen — no re-hosting needed.
    const fsBtn = wrap.querySelector(".df-fs");
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
    });
    const onFsChange = () => {
      fsBtn.textContent = document.fullscreenElement === wrap ? "🗗" : "⛶";
    };
    document.addEventListener("fullscreenchange", onFsChange);
    this._teardowns.push(() => document.removeEventListener("fullscreenchange", onFsChange));

    // --- CPU visible pass (labels / picking / breadcrumb) -------------------------
    // Mirrors the shader's trapezoid exactly. If these two ever disagree, labels attach
    // to invisible discs.
    const vis = {
      idx: new Int32Array(n), px: new Float32Array(n), py: new Float32Array(n),
      pr: new Float32Array(n), a: new Float32Array(n), count: 0,
    };
    const smoothstep = (t) => t * t * (3 - 2 * t);
    const alphaAt = (i, z) => {
      const t1 = Math.min(1, Math.max(0, (z - (SMIN[i] - FADE_IN_PRE)) / FADE_IN_LEN));
      const t2 = Math.min(1, Math.max(0, (SMAX[i] - z) / FADE_OUT));
      return smoothstep(t1) * smoothstep(t2) * ON[i];
    };
    const cullVisible = () => {
      const s = scaleOf(), z = cam.z;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const a = alphaAt(i, z);
        if (a < 0.02) continue;
        const px = (X[i] - cam.x) * s + W / 2;
        const py = (Y[i] - cam.y) * s + H / 2;
        const pr = Math.max(1, R[i] * s);
        if (px < -pr - 60 || px > W + pr + 60 || py < -pr - 60 || py > H + pr + 60) continue;
        vis.idx[m] = i; vis.px[m] = px; vis.py[m] = py; vis.pr[m] = pr; vis.a[m] = a; m++;
      }
      vis.count = m;
    };

    // --- labels: pooled divs + hysteresis (no flicker) ----------------------------
    const labelHost = wrap.querySelector(".df-labels");
    const pool = [];
    for (let i = 0; i < LABEL_POOL; i++) {
      const div = document.createElement("div");
      div.className = "df-label";
      div._node = -1;
      labelHost.appendChild(div);
      pool.push(div);
    }
    const labelOf = new Map();   // node index -> pooled div
    let lastRank = 0;
    const rankLabels = (now) => {
      if (now - lastRank < 100) return;
      lastRank = now;
      const scored = [];
      for (let k = 0; k < vis.count; k++) {
        const i = vis.idx[k];
        if (KIND[i] === leaf && vis.pr[k] < 8) continue;   // tiny leaf dots stay unlabeled
        scored.push([vis.a[k] * Math.min(vis.pr[k], 80) * (KIND[i] === 0 ? 2 : 1), i]);
      }
      scored.sort((p, q) => q[0] - p[0]);
      // Show fewer than we keep: the gap is the hysteresis that stops labels flickering
      // on and off as scores jitter around the cutoff.
      const want = new Set(scored.slice(0, LABEL_SHOW).map((s) => s[1]));
      const keep = new Set(scored.slice(0, LABEL_POOL).map((s) => s[1]));
      for (const [i, div] of labelOf) {
        if (!keep.has(i)) { labelOf.delete(i); div.style.opacity = "0"; div._node = -1; }
      }
      for (const i of want) {
        if (labelOf.has(i)) continue;
        const free = pool.find((div) => div._node === -1);
        if (!free) break;
        free._node = i;
        free.textContent = LABEL[i] || "";
        free.className = `df-label df-l${Math.min(KIND[i], 5)}`;
        labelOf.set(i, free);
      }
    };
    const placeLabels = () => {
      const posOf = new Map();
      for (let k = 0; k < vis.count; k++) posOf.set(vis.idx[k], k);
      for (const [i, div] of labelOf) {
        const k = posOf.get(i);
        if (k == null) { div.style.opacity = "0"; continue; }
        div.style.opacity = String(Math.min(1, vis.a[k] * 1.4));
        const dy = KIND[i] === leaf ? -14 : vis.pr[k] * 0.1;
        div.style.transform =
          `translate(${(vis.px[k] / dpr).toFixed(1)}px, ${((vis.py[k] + dy) / dpr).toFixed(1)}px)`;
      }
    };

    // --- picking / tooltip --------------------------------------------------------
    const tip = document.createElement("div");
    tip.className = "df-tip";
    wrap.appendChild(tip);
    const hideTip = () => { tip.style.display = "none"; };

    const pick = (mx, my) => {
      let best = -1, bd = Infinity;
      for (let k = 0; k < vis.count; k++) {
        const dist = Math.hypot(vis.px[k] - mx, vis.py[k] - my) - Math.min(vis.pr[k], 40);
        if (dist < bd) { bd = dist; best = k; }
      }
      return best >= 0 && bd < 16 * dpr ? best : -1;
    };
    const nodeAt = (i) => ({
      index: i, id: IDS[i], ref: REF[i] === -1 ? null : REF[i],
      kind: KIND[i], level: d.levels[KIND[i]], isLeaf: KIND[i] === leaf,
      label: LABEL[i], group: GROUP[i], lineage: LINEAGE[i], weight: d.WEIGHT[i],
      x: X[i], y: Y[i], r: R[i],
    });
    this._nodeAt = nodeAt;

    function onHover(e) {
      const rect = canvas.getBoundingClientRect();
      const k = pick((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
      if (k < 0) { hideTip(); canvas.style.cursor = "grab"; return; }
      const i = vis.idx[k];
      tip.style.display = "block";
      tip.style.left = (e.clientX - rect.left + 14) + "px";
      tip.style.top = (e.clientY - rect.top + 14) + "px";
      tip.textContent = self.opts.tooltip
        ? self.opts.tooltip(nodeAt(i))
        : `${LABEL[i] || "?"} · ${d.levels[KIND[i]]}`;
      canvas.style.cursor = "pointer";
    }

    const self = this;
    function onClick(e) {
      const rect = canvas.getBoundingClientRect();
      const k = pick((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
      if (k < 0) return;
      const i = vis.idx[k];
      const node = nodeAt(i);
      if (self.opts.onNodeClick && self.opts.onNodeClick(node) === false) return;
      if (node.isLeaf) {
        if (self.opts.onLeafClick) self.opts.onLeafClick(node);
        else if (self.opts.details) openPanel(i);
        return;
      }
      if (self.opts.details) openPanel(i);
      else flyTo(X[i], Y[i], fitNodeZ(i));   // no details source: click just descends
    }

    // --- details panel --------------------------------------------------------------
    const panel = wrap.querySelector(".df-panel");
    const panelInner = panel.querySelector(".df-panel-inner");
    const closePanel = () => panel.classList.remove("df-open");
    this._closePanel = closePanel;
    // Dismissed on pointerdown, not click. A tap opens the panel during the canvas's
    // pointerup — and the compatibility click the browser fires afterwards is hit-tested
    // fresh, so it lands on the backdrop that has just appeared under the finger and closes
    // the panel again the instant it opened. A pointerdown can only be a deliberate one.
    panel.addEventListener("pointerdown", (e) => { if (e.target === panel) closePanel(); });

    async function openPanel(i) {
      const node = nodeAt(i);
      panelInner.innerHTML = `<div class="df-loading">${esc(strings.loading)}</div>`;
      panel.classList.add("df-open");
      let detail;
      try {
        detail = await self.opts.details(node);
      } catch (err) {
        panelInner.innerHTML =
          `<button class="df-x">✕</button>` + notice(strings.detailsFailed, err && err.message);
        panelInner.querySelector(".df-x").addEventListener("click", closePanel);
        return;
      }
      if (!self._alive) return;
      detail = detail || {};
      const items = (detail.items || []).map((it) => {
        const href = it.href ? safeHref(it.href) : null;
        return `<div class="df-item">${href
          ? `<a href="${esc(href)}" data-close>${esc(it.label)}</a>`
          : esc(it.label)}${it.note ? `<span class="df-pill">${esc(it.note)}</span>` : ""}</div>`;
      }).join("");
      panelInner.innerHTML = `
        <button class="df-x">✕</button>
        <h3>${esc(detail.title ?? node.label)}</h3>
        <div class="df-muted">${esc(detail.subtitle ?? node.lineage.split("/").join(" › "))}</div>
        <div class="df-panel-actions">
          <button class="df-btn df-primary" data-fly>${esc(strings.descend)} ${esc(node.level)}</button>
        </div>
        <div class="df-items">${items || notice(strings.noChildren)}</div>
        ${detail.footer ? `<div class="df-muted">${esc(detail.footer)}</div>` : ""}`;
      panelInner.querySelector(".df-x").addEventListener("click", closePanel);
      panelInner.querySelector("[data-fly]").addEventListener("click", () => {
        closePanel();
        flyTo(X[i], Y[i], fitNodeZ(i));
      });
      panelInner.querySelectorAll("[data-close]").forEach((a) =>
        a.addEventListener("click", closePanel));
    }

    // --- breadcrumb ---------------------------------------------------------------
    // Whatever container the viewport centre is currently inside, deepest wins. Walking
    // PARENT (not splitting the lineage string) is what makes each crumb clickable.
    const crumbEl = wrap.querySelector(".df-crumb");
    let lastCrumb = "";
    const updateBreadcrumb = () => {
      let best = -1, bestDepth = -1;
      for (let k = 0; k < vis.count; k++) {
        const i = vis.idx[k];
        if (KIND[i] === leaf || vis.a[k] < 0.5) continue;
        const dist = Math.hypot(vis.px[k] - W / 2, vis.py[k] - H / 2);
        if (dist < vis.pr[k]) {
          const depth = LINEAGE[i].split("/").length;
          if (depth > bestDepth) { bestDepth = depth; best = i; }
        }
      }
      const text = best >= 0 ? LINEAGE[best] : "";
      if (text === lastCrumb) return;
      lastCrumb = text;
      if (!text) { crumbEl.innerHTML = ""; return; }

      const chain = [];
      for (let cur = best; cur !== -1 && cur != null; cur = PARENT[cur] === -1 ? null : PARENT[cur]) {
        chain.unshift(cur);
      }
      crumbEl.innerHTML = text.split("/").map((part, j) => {
        const ni = chain[j];
        return ni != null
          ? `<span class="df-crumb-link" data-n="${ni}">${esc(part)}</span>`
          : `<span class="df-crumb-plain">${esc(part)}</span>`;
      }).join(`<span class="df-crumb-sep">›</span>`);
      crumbEl.querySelectorAll(".df-crumb-link").forEach((span) =>
        span.addEventListener("click", () => {
          const ni = Number(span.dataset.n);
          flyTo(X[ni], Y[ni], SOPT[ni]);
        }));
    };

    // --- search --------------------------------------------------------------------
    const searchInput = wrap.querySelector(".df-search");
    const resultsEl = wrap.querySelector(".df-results");
    const search = this.opts.search === null
      ? null
      : (this.opts.search || defaultSearch(d));
    if (!search) {
      searchInput.parentElement.hidden = true;
    } else {
      let timer = null;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(timer);
        const q = e.target.value.trim();
        if (!q) { resultsEl.innerHTML = ""; return; }
        timer = setTimeout(async () => {
          let hits = [];
          try { hits = (await search(q)) || []; } catch { hits = []; }
          if (!self._alive) return;
          resultsEl.innerHTML = hits.slice(0, 8).map((h) =>
            `<div class="df-hit" data-x="${Number(h.x)}" data-y="${Number(h.y)}" data-z="${Number(h.s_opt ?? h.z)}">
               ${esc(h.label)}<span class="df-muted">${esc(h.level ?? h.kind ?? "")}</span></div>`
          ).join("");
          resultsEl.querySelectorAll(".df-hit").forEach((hit) =>
            hit.addEventListener("click", () => {
              resultsEl.innerHTML = "";
              searchInput.value = "";
              flyTo(Number(hit.dataset.x), Number(hit.dataset.y), Number(hit.dataset.z));
            }));
        }, 250);
      });
      this._teardowns.push(() => clearTimeout(timer));
    }

    // --- GL context loss -------------------------------------------------------------
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); glo = null; });
    canvas.addEventListener("webglcontextrestored", () => {
      glo = initGL(gl);
      if (glo) uploadBuffers(gl, glo, d, HUE, ON);
    });

    // --- main loop ---------------------------------------------------------------------
    const maxPt = Math.min(theme.maxPointSize * dpr,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
    let raf = 0;
    let lastT = performance.now();
    this._teardowns.push(() => cancelAnimationFrame(raf));

    const frame = (now) => {
      if (!self._alive || !canvas.isConnected) { self.destroy(); return; }
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      if (cam.fly) {
        const f = cam.fly;
        let t = (now - f.t0) / f.ms;
        if (t >= 1) { t = 1; cam.fly = null; }
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // easeInOutCubic
        cam.x = f.x0 + (f.x1 - f.x0) * e;
        cam.y = f.y0 + (f.y1 - f.y0) * e;
        cam.z = f.z0 + (f.z1 - f.z0) * e;
      } else {
        cam.z += (cam.zTarget - cam.z) * Math.min(1, dt * 10);
        if (cam.anchor) {
          const s = scaleOf();
          cam.x = cam.anchor.wx - (cam.anchor.mx - W / 2) / s;
          cam.y = cam.anchor.wy - (cam.anchor.my - H / 2) / s;
          // A pinch that is only translating has nothing left to smooth, but the anchor is
          // what pans it — so it must survive until the fingers lift.
          if (!pinch && Math.abs(cam.zTarget - cam.z) < 1e-3) cam.anchor = null;
        }
      }
      // Never lose the content: the camera centre stays inside the content box + margin.
      const margin = bounds.span * 0.3;
      cam.x = Math.max(bounds.x0 - margin, Math.min(bounds.x1 + margin, cam.x));
      cam.y = Math.max(bounds.y0 - margin, Math.min(bounds.y1 + margin, cam.y));

      if (glo) {
        gl.clearColor(theme.background[0], theme.background[1], theme.background[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(glo.prog);
        gl.uniform2f(glo.u.center, cam.x, cam.y);
        gl.uniform2f(glo.u.res, W, H);
        gl.uniform1f(glo.u.scale, scaleOf());
        gl.uniform1f(glo.u.z, cam.z);
        gl.uniform1f(glo.u.maxpt, maxPt);
        gl.uniform1f(glo.u.leaf, leaf);
        gl.uniform1f(glo.u.leafsize, theme.leafSizeFactor);
        gl.bindVertexArray(glo.vao);
        gl.drawArrays(gl.POINTS, 0, n);
      }

      cullVisible();
      // Void rescue: ~1s of empty viewport offers the way home, so a wrong-turn zoom
      // never strands the user in blank space with no landmark to steer by.
      voidFrames = vis.count === 0 ? voidFrames + 1 : 0;
      voidEl.hidden = voidFrames < 60;

      rankLabels(now);
      placeLabels();
      updateBreadcrumb();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
}
