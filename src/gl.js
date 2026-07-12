// The GL layer: shaders, program setup, buffer upload. Raw WebGL2, zero dependencies.
//
// The whole map is uploaded once as points and the GPU culls per frame via a
// smoothstep trapezoid in log2-zoom space — that's why there are no per-viewport
// fetches and no CPU-side scene graph. Depth is normalized by the level count, so an
// N-level hierarchy shades correctly without touching the shader source.

import { FADE_IN_PRE, FADE_IN_LEN, FADE_OUT } from "./theme.js";

export const VERT = `#version 300 es
precision highp float;
in vec2 a_pos; in float a_r; in vec3 a_win; in float a_hue; in float a_kind; in float a_on;
uniform vec2 u_center; uniform vec2 u_res;
uniform float u_scale; uniform float u_z; uniform float u_maxpt;
uniform float u_leaf;        // kind code of the leaf level
uniform float u_leafsize;    // leaf dots capped to this fraction of u_maxpt
out float v_alpha; out vec3 v_color; out float v_leafness; out float v_size; out float v_past;
vec3 hsl2rgb(vec3 hsl) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hsl.x * 12.0, 12.0);
  float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return hsl.z - a * max(vec3(-1.0), min(min(k - vec3(3.0), vec3(9.0) - k), vec3(1.0)));
}
void main() {
  float fadeIn  = smoothstep(a_win.x - ${FADE_IN_PRE.toFixed(2)}, a_win.x - ${FADE_IN_PRE.toFixed(2)} + ${FADE_IN_LEN.toFixed(2)}, u_z);
  float fadeOut = 1.0 - smoothstep(a_win.z - ${FADE_OUT.toFixed(2)}, a_win.z, u_z);
  float a = fadeIn * fadeOut * a_on;
  vec2 px = (a_pos - u_center) * u_scale;
  gl_Position = vec4(px / (0.5 * u_res) * vec2(1.0, -1.0), 0.0, 1.0);
  // Size eases in with the fade so appearing discs grow gently instead of popping.
  float d = clamp(a_r * u_scale * 2.0, 2.0, u_maxpt) * (0.5 + 0.5 * fadeIn);
  float isLeaf = step(u_leaf - 0.5, a_kind);
  if (isLeaf > 0.5) d = min(d, u_maxpt * u_leafsize);
  gl_PointSize = max(d, 1.5);
  if (a < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
  float depth = a_kind / max(u_leaf, 1.0);
  float L = mix(0.64, 0.5, depth) + 0.04 * clamp(u_z - a_win.y, -1.0, 1.0);
  v_color = hsl2rgb(vec3(a_hue, mix(0.7, 0.52, depth), L));
  v_alpha = a * mix(0.75, 0.85, depth);
  v_leafness = isLeaf;
  v_size = gl_PointSize;
  // Once the camera dives past a container's optimal band its fill empties out — only a
  // crisp ring remains, so the children inside read without confusion.
  v_past = smoothstep(a_win.y + 0.15, a_win.y + 0.9, u_z);
}`;

export const FRAG = `#version 300 es
precision mediump float;
in float v_alpha; in vec3 v_color; in float v_leafness; in float v_size; in float v_past;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  // Pixel-accurate anti-aliasing: 1 sprite unit == v_size/2 px.
  float aa = clamp(3.0 / v_size, 0.004, 0.25);
  float edge = 1.0 - smoothstep(1.0 - aa, 1.0, r);   // crisp outer boundary
  if (v_leafness > 0.5) {                             // leaf: solid sharp dot
    float a = v_alpha * edge;
    o = vec4(v_color * a, a);
    return;
  }
  // Container: thin crisp ring + faint interior that EMPTIES once dived past.
  float bw = max(5.0 / v_size, 0.035);                // ~2.5px ring, min width
  float ring = smoothstep(1.0 - bw - aa, 1.0 - bw, r) * edge;
  float fill = edge * 0.14 * (1.0 - 0.85 * v_past);
  float a = v_alpha * (ring * (0.55 + 0.35 * v_past) + fill);
  o = vec4(v_color * a, a);
}`;

/** Compile + link. Returns null (and logs) rather than throwing, so callers can fall back. */
export function initGL(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("deepfield shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("deepfield link:", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const u = {};
  for (const name of ["center", "res", "scale", "z", "maxpt", "leaf", "leafsize"]) {
    u[name] = gl.getUniformLocation(prog, `u_${name}`);
  }
  return { prog, u, vao: gl.createVertexArray(), bufs: {} };
}

/** Interleave-free upload: one buffer per attribute, all STATIC_DRAW except a_on. */
export function uploadBuffers(gl, glo, d, HUE, ON) {
  const n = d.count;
  gl.bindVertexArray(glo.vao);
  glo.bufs = {};

  const attach = (name, arr, size, usage = gl.STATIC_DRAW) => {
    const loc = gl.getAttribLocation(glo.prog, name);
    const buf = gl.createBuffer();
    glo.bufs[name] = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, usage);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  const pos = new Float32Array(n * 2);
  const win = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 2] = d.X[i];
    pos[i * 2 + 1] = d.Y[i];
    win[i * 3] = d.SMIN[i];
    win[i * 3 + 1] = d.SOPT[i];
    win[i * 3 + 2] = d.SMAX[i];
    kind[i] = d.KIND[i];
  }
  attach("a_pos", pos, 2);
  attach("a_r", d.RSCALED, 1);
  attach("a_win", win, 3);
  attach("a_hue", HUE, 1);
  attach("a_kind", kind, 1);
  attach("a_on", ON, 1, gl.DYNAMIC_DRAW);   // rewritten on every filter change
  gl.bindVertexArray(null);
}
