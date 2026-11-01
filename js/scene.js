/*!
 * Velluto · live 3D scene
 * Three.js r158 (UMD global THREE). Everything is procedural: porcelain cup and
 * saucer turned on a lathe, latte-art liquid shader, noise-driven steam, instanced
 * coffee beans, dust and bokeh particles, plus the scroll-driven bean journey.
 *
 * Public API (window.VellutoScene):
 *   init(canvas, { reducedMotion, lowPower })  -> boolean
 *   bind({ hero, heroStage, beans, journey, finale, finaleStage })
 *   refresh()            re-measure bound elements (call after layout changes)
 *   pointer(nx, ny)      normalised pointer, -1..1
 *   intro()              play the hero entrance
 *   tick(ms)             advance + render one frame (when driven externally)
 *   start()              drive itself with requestAnimationFrame
 */
(function () {
  'use strict';

  var Scene = (window.VellutoScene = { ok: false });
  var THREE = window.THREE;
  if (!THREE) return;

  /* ---------- small helpers ---------- */
  var DEG = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { var c1 = 1.35, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- tileable fbm noise, generated once ---------- */
  function makeNoiseTexture(size) {
    var octaves = [[4, 0.5], [8, 0.25], [16, 0.125], [32, 0.0625], [64, 0.03125]];
    var r = rng(1337);
    var grids = octaves.map(function (o) { var g = new Float32Array(o[0] * o[0]); for (var i = 0; i < g.length; i++) g[i] = r(); return g; });
    var vals = new Float32Array(size * size), min = 1e9, max = -1e9;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var v = 0;
        for (var k = 0; k < octaves.length; k++) {
          var s = octaves[k][0], g = grids[k];
          var fx = (x / size) * s, fy = (y / size) * s;
          var x0 = Math.floor(fx), y0 = Math.floor(fy);
          var tx = fx - x0, ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          var x1 = (x0 + 1) % s, y1 = (y0 + 1) % s;
          var a = g[y0 * s + x0], b = g[y0 * s + x1], c = g[y1 * s + x0], d = g[y1 * s + x1];
          v += octaves[k][1] * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
        }
        vals[y * size + x] = v;
        if (v < min) min = v; if (v > max) max = v;
      }
    }
    var data = new Uint8Array(size * size * 4);
    for (var i = 0; i < size * size; i++) {
      var n = Math.round(((vals[i] - min) / (max - min)) * 255);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = n; data[i * 4 + 3] = 255;
    }
    var tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  function radialTexture(stops) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ---------- studio lighting baked into a PMREM environment ---------- */
  function buildEnvironment(renderer) {
    var env = new THREE.Scene();
    var room = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1c0f08), side: THREE.BackSide }));
    env.add(room);
    var origin = new THREE.Vector3(0, 0.5, 0);
    function panel(w, h, hex, power, x, y, z) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(origin); env.add(m);
    }
    panel(7, 4.5, 0xfff1de, 7.5, -5.5, 5.2, 4.5); // key softbox
    panel(1.4, 9, 0xffb46a, 5.5, 7, 1.5, -3);     // caramel strip, back right
    panel(9, 1.2, 0xffe8c8, 3.0, 0, 7, -5);       // top strip behind
    panel(2.2, 6, 0xffd9a8, 2.2, -8, 0.5, -4);    // left kicker
    panel(14, 14, 0x3b1f12, 1.4, 0, -6, 0);       // warm floor bounce
    var pmrem = new THREE.PMREMGenerator(renderer);
    var rt = pmrem.fromScene(env, 0.035);
    pmrem.dispose();
    env.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return rt.texture;
  }

  /* ---------- lathe profiles ---------- */
  function v2(a) { return new THREE.Vector2(a[0], a[1]); }
  function spline(pts, div) { return new THREE.SplineCurve(pts.map(v2)).getPoints(div); }
  function arc(cx, cy, r, a0, a1, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) { var a = lerp(a0, a1, i / steps); out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
    return out;
  }
  function join(parts) {
    var out = [];
    parts.forEach(function (pts) {
      pts.forEach(function (p) { var last = out[out.length - 1]; if (!last || last.distanceTo(p) > 1e-4) out.push(p); });
    });
    out.forEach(function (p) { p.x = Math.max(0, p.x); });
    return out;
  }
  function radiusAt(pts, y) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
    }
    return pts[0].x;
  }

  var LIQ_Y = 0.885; // liquid level inside the cup (cup space)

  var cupOuter = spline([[0, 0.03], [0.36, 0.03], [0.41, 0.0], [0.46, 0.006], [0.5, 0.06], [0.58, 0.12], [0.7, 0.215], [0.8, 0.33], [0.885, 0.48], [0.94, 0.645], [0.975, 0.82], [0.992, 0.97], [1.0, 1.06]], 90);
  var cupLip = arc(0.976, 1.06, 0.024, 0, Math.PI, 14);
  var cupInner = spline([[0.952, 1.06], [0.946, 0.96], [0.926, 0.8], [0.888, 0.64], [0.826, 0.485], [0.738, 0.345], [0.62, 0.228], [0.47, 0.15], [0.29, 0.118], [0, 0.108]], 80);
  var cupProfile = join([cupOuter, cupLip, cupInner]);

  var saucerUnder = spline([[0, 0.012], [0.5, 0.012], [0.55, -0.012], [0.63, -0.012], [0.68, 0.014], [0.92, 0.032], [1.16, 0.062], [1.38, 0.104], [1.535, 0.148]], 70);
  var saucerLip = arc(1.532, 0.162, 0.0145, -1.35, Math.PI - 0.2, 12);
  var saucerInner = spline([[1.518, 0.165], [1.4, 0.142], [1.18, 0.104], [0.92, 0.074], [0.7, 0.06], [0.565, 0.058], [0.535, 0.068], [0.505, 0.071], [0.475, 0.06], [0.4, 0.05], [0, 0.048]], 70);
  var saucerProfile = join([saucerUnder, saucerLip, saucerInner]);

  /* ---------- coffee bean: an ellipsoid with a flat face and an S-shaped crease ---------- */
  function makeBeanGeometry(detail) {
    var geo = new THREE.SphereGeometry(1, detail * 1.4 | 0, detail);
    var pos = geo.attributes.position;
    var col = new Float32Array(pos.count * 3);
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      var x = v.x * 0.7, y = v.y, z = v.z * 0.56, shade = 1;
      if (z < 0) z *= 0.46;
      var centre = 0.09 * Math.sin(y * 2.6);
      var dx = x - centre;
      var groove = Math.exp(-(dx * dx) / 0.0075) * (1 - Math.pow(Math.abs(y), 4));
      if (v.z < 0) { z += groove * 0.3; shade = 1 - groove * 0.88; }
      else { z *= 1 + 0.07 * Math.cos(y * 3.1); shade = 1 - 0.12 * (1 - v.z); }
      pos.setXYZ(i, x, y, z);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------- shaders ---------- */
  var LATTE_GLSL = [
    'uniform float uTime;',
    'uniform float uSwirl;',
    'vec4 LATTE;',
    'float lh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float ln(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float lfbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * ln(p); p *= 2.03; a *= 0.5; } return v; }',
    'float ldot2(vec2 v){ return dot(v, v); }',
    'float sdHeart(vec2 p){ p.x = abs(p.x);',
    '  if (p.y + p.x > 1.0) return sqrt(ldot2(p - vec2(0.25, 0.75))) - 0.35355;',
    '  return sqrt(min(ldot2(p - vec2(0.0, 1.0)), ldot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y); }',
    'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }',
    'vec4 latte(vec2 uv){',
    '  vec2 p = uv * 2.0 - 1.0;',
    '  float r = length(p);',
    '  float ang = uTime * 0.035 + uSwirl * (1.0 - r);',
    '  float s = sin(ang), c = cos(ang);',
    '  p = mat2(c, -s, s, c) * p;',
    '  vec2 w = vec2(lfbm(p * 2.6 + uTime * 0.03), lfbm(p * 2.6 + 7.3 - uTime * 0.025)) - 0.5;',
    '  vec2 q = p + w * 0.07;',
    '  float n = lfbm(q * 6.0);',
    '  vec3 crema = mix(lin(vec3(0.55, 0.31, 0.14)), lin(vec3(0.74, 0.47, 0.24)), smoothstep(0.32, 0.78, n));',
    '  crema = mix(crema, lin(vec3(0.27, 0.13, 0.05)), smoothstep(0.6, 1.0, r));',
    '  crema *= 0.86 + 0.26 * lfbm(q * 22.0);',
    '  vec2 hp = q * 1.08 + vec2(0.0, 0.56);',
    '  float d = sdHeart(hp);',
    '  float foam = 1.0 - smoothstep(-0.012, 0.02, d);',
    '  float rings = 0.0;',
    '  for (int i = 1; i <= 3; i++) { float fi = float(i); float k = 1.0 + fi * 0.34;',
    '    float d2 = sdHeart((hp - vec2(0.0, 0.06 * fi)) * k) / k;',
    '    rings += (1.0 - smoothstep(0.004, 0.02, abs(d2))) * (0.75 - 0.12 * fi); }',
    '  float line = (1.0 - smoothstep(0.006, 0.022, abs(hp.x + 0.02 * sin(hp.y * 7.0)))) * smoothstep(-0.05, 0.12, hp.y) * (1.0 - smoothstep(0.55, 0.85, hp.y));',
    '  vec3 milk = lin(vec3(0.97, 0.93, 0.86)) * (0.96 + 0.06 * lfbm(q * 40.0));',
    '  vec3 milkEdge = lin(vec3(0.86, 0.71, 0.53));',
    '  vec3 foamCol = mix(milk, milkEdge, smoothstep(-0.14, 0.0, d) * 0.55);',
    '  foamCol = mix(foamCol, crema * 1.15, clamp(rings, 0.0, 1.0) * 0.8);',
    '  foamCol = mix(foamCol, crema, line * 0.7);',
    '  vec3 col = mix(crema, foamCol, foam);',
    '  float halo = smoothstep(0.83, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));',
    '  col = mix(col, milk * 0.85, halo * 0.55);',
    '  return vec4(col, clamp(foam + halo * 0.5, 0.0, 1.0));',
    '}'
  ].join('\n');

  var STEAM_VERT = [
    'uniform float uTime; uniform sampler2D uNoise; uniform vec2 uWind; uniform float uSeed;',
    'varying vec2 vUv;',
    'vec2 rot(vec2 v, float a){ float s = sin(a), c = cos(a); return mat2(c, s, -s, c) * v; }',
    'void main(){',
    '  vec3 p = position;',
    '  float tw = texture2D(uNoise, vec2(0.5 + uSeed, uv.y * 0.2 - uTime * 0.005)).r;',
    '  p.xz = rot(p.xz, tw * 9.0);',
    '  vec2 wind = vec2(texture2D(uNoise, vec2(0.25 + uSeed, uTime * 0.01)).r - 0.5, texture2D(uNoise, vec2(0.75 + uSeed, uTime * 0.01)).r - 0.5);',
    '  wind *= pow(uv.y, 2.0) * 1.7;',
    '  p.xz += wind + uWind * pow(uv.y, 1.6);',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var STEAM_FRAG = [
    'uniform float uTime; uniform sampler2D uNoise; uniform float uOpacity; uniform float uSeed; uniform vec3 uColor;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 s = vUv; s.x = s.x * 0.5 + uSeed; s.y = s.y * 0.3 - uTime * 0.045;',
    '  float smoke = texture2D(uNoise, s).r;',
    '  smoke = smoothstep(0.44, 1.0, smoke);',
    '  smoke *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);',
    '  smoke *= smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.42, vUv.y);',
    '  gl_FragColor = vec4(uColor, smoke * uOpacity);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var DUST_VERT = [
    'uniform float uTime; uniform float uPR; uniform float uSize;',
    'attribute float aSize; attribute float aSeed;',
    'varying float vA;',
    'void main(){',
    '  vec3 p = position;',
    '  p.y = mod(p.y + uTime * (0.05 + aSeed * 0.09) + 2.5, 8.0) - 2.5;',
    '  p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.28;',
    '  p.z += cos(uTime * 0.23 + aSeed * 23.0) * 0.22;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = uSize * aSize * uPR / -mv.z;',
    '  vA = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * (0.8 + aSeed * 2.2) + aSeed * 60.0));',
    '  vA *= smoothstep(-2.5, -1.2, p.y) * (1.0 - smoothstep(4.0, 5.5, p.y));',
    '}'
  ].join('\n');
  var DUST_FRAG = [
    'uniform vec3 uColor; uniform float uOpacity; varying float vA;',
    'void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * a * vA * uOpacity); }'
  ].join('\n');

  var BOKEH_VERT = [
    'uniform float uTime; uniform float uPR; uniform float uSize;',
    'attribute float aSize; attribute float aSeed; attribute vec3 aColor;',
    'varying float vA; varying vec3 vC;',
    'void main(){',
    '  vec3 p = position;',
    '  p.x += sin(uTime * 0.07 + aSeed * 30.0) * 0.6;',
    '  p.y += cos(uTime * 0.06 + aSeed * 17.0) * 0.4;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = uSize * aSize * uPR / -mv.z;',
    '  vA = 0.55 + 0.45 * sin(uTime * 0.35 + aSeed * 12.0); vC = aColor;',
    '}'
  ].join('\n');
  var BOKEH_FRAG = [
    'uniform float uOpacity; varying float vA; varying vec3 vC;',
    'void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float disc = smoothstep(1.0, 0.7, d);',
    '  float rim = smoothstep(0.55, 0.92, d) * disc; float a = disc * 0.22 + rim * 0.14;',
    '  gl_FragColor = vec4(vC, a * vA * uOpacity); }'
  ].join('\n');

  var GROUNDS_VERT = [
    'uniform float uTime; uniform float uP; uniform float uPR; uniform float uSize; uniform float uSink;',
    'attribute vec3 aStart; attribute float aSeed; attribute float aSize;',
    'varying float vA; varying float vS;',
    'vec2 rot(vec2 v, float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c) * v; }',
    'void main(){',
    '  float e = smoothstep(0.6, 0.78, uP);',
    '  float v = smoothstep(0.8, 0.95, uP);',
    '  vec3 b = aStart * (1.0 + e * (0.7 + aSeed * 1.6));',
    '  b.y += (aSeed - 0.5) * e * 1.6;',
    '  b.xz = rot(b.xz, uTime * (0.12 + aSeed * 0.3) + e * 2.4);',
    '  float t = fract(aSeed * 7.13 + uTime * (0.1 + aSeed * 0.05));',
    '  float r = mix(2.9, 0.06, pow(t, 0.8));',
    '  float th = aSeed * 60.0 + uTime * (0.7 + 2.2 * (1.0 - r / 2.9));',
    '  vec3 vortex = vec3(cos(th) * r, mix(1.9, uSink, t) + (aSeed - 0.5) * 0.25 * (r / 2.9), sin(th) * r);',
    '  vec3 p = mix(b, vortex, v);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = uSize * aSize * uPR / -mv.z;',
    '  vA = e * (0.35 + 0.65 * aSeed) * (1.0 - v * smoothstep(0.85, 1.0, t)); vS = aSeed;',
    '}'
  ].join('\n');
  var GROUNDS_FRAG = [
    'uniform float uOpacity; varying float vA; varying float vS;',
    'void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d);',
    '  vec3 c = mix(vec3(0.62, 0.36, 0.16), vec3(0.98, 0.8, 0.52), vS);',
    '  gl_FragColor = vec4(c, a * vA * uOpacity); }'
  ].join('\n');

  /* ---------- palettes ---------- */
  var ROASTED = ['#5b2f17', '#4a2512', '#6b3a1d', '#3f1f0f', '#7a4523', '#56301a'];
  var ROAST_STOPS = [
    [0.0, new THREE.Color('#9aa271')], [0.22, new THREE.Color('#b8ad72')], [0.42, new THREE.Color('#b8834b')],
    [0.64, new THREE.Color('#7a4523')], [1.0, new THREE.Color('#3e1f0f')]
  ];
  function roastColor(t, out) {
    for (var i = 0; i < ROAST_STOPS.length - 1; i++) {
      var a = ROAST_STOPS[i], b = ROAST_STOPS[i + 1];
      if (t <= b[0]) return out.copy(a[1]).lerp(b[1], (t - a[0]) / (b[0] - a[0]));
    }
    return out.copy(ROAST_STOPS[ROAST_STOPS.length - 1][1]);
  }

  /* =====================================================================
   * init
   * ===================================================================== */
  Scene.init = function (canvas, opts) {
    opts = opts || {};
    var reduced = !!opts.reducedMotion;
    var low = !!opts.lowPower;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      if (!renderer.getContext()) return false;
    } catch (err) {
      return false;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(28, 1, 0.1, 140);
    var noise = makeNoiseTexture(256);
    scene.environment = buildEnvironment(renderer);

    /* lights */
    var hemi = new THREE.HemisphereLight(0xffe6c8, 0x140a05, 0.55);
    var key = new THREE.DirectionalLight(0xfff0dc, 2.7);
    key.position.set(-3.5, 6, 4.5);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    var sc = key.shadow.camera;
    sc.left = -2.6; sc.right = 2.6; sc.top = 2.6; sc.bottom = -2.6; sc.near = 1; sc.far = 22;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
    var rim = new THREE.DirectionalLight(0xffa65c, 3.4);
    rim.position.set(4.2, 2.8, -4.6);
    var under = new THREE.PointLight(0xff6a1f, 0, 16, 2);
    under.position.set(0, -3.2, 1.6);
    scene.add(hemi, key, key.target, rim, under);

    /* materials */
    var porcelain = new THREE.MeshPhysicalMaterial({ color: 0xf2e9dc, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.0 });
    var gold = new THREE.MeshStandardMaterial({ color: 0xe2bf7a, metalness: 1, roughness: 0.2, envMapIntensity: 1.3 });
    var liquidUniforms = { uTime: { value: 0 }, uSwirl: { value: 0.35 } };
    var liquidMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.7 });
    liquidMat.defines = { USE_UV: '' };
    liquidMat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = liquidUniforms.uTime;
      shader.uniforms.uSwirl = liquidUniforms.uSwirl;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + LATTE_GLSL)
        .replace('#include <map_fragment>', '#include <map_fragment>\nLATTE = latte(vUv);\ndiffuseColor.rgb = LATTE.rgb;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, LATTE.a);');
    };
    liquidMat.customProgramCacheKey = function () { return 'velluto-latte'; };

    /* ----- cup rig ----- */
    var cupRig = new THREE.Group();   // per-mode placement
    var cupTilt = new THREE.Group();  // pointer + scroll tilt, pivot at the visual centre
    var cupBody = new THREE.Group();  // the object itself, base at y = 0
    cupRig.add(cupTilt); cupTilt.add(cupBody);
    cupBody.position.y = -0.56;

    var saucer = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, low ? 72 : 128), porcelain);
    saucer.castShadow = true; saucer.receiveShadow = true;
    var saucerGold = new THREE.Mesh(new THREE.TorusGeometry(1.532, 0.0165, 10, 200), gold);
    saucerGold.rotation.x = Math.PI / 2; saucerGold.position.y = 0.162;
    cupBody.add(saucer, saucerGold);

    var cup = new THREE.Group();
    cup.position.y = 0.048;
    cup.rotation.y = -0.22;
    cupBody.add(cup);
    var body = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, low ? 72 : 128), porcelain);
    body.castShadow = true; body.receiveShadow = true;
    var handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.955, 0.875, 0), new THREE.Vector3(1.08, 0.905, 0), new THREE.Vector3(1.27, 0.875, 0),
      new THREE.Vector3(1.385, 0.74, 0), new THREE.Vector3(1.37, 0.56, 0), new THREE.Vector3(1.24, 0.42, 0),
      new THREE.Vector3(1.03, 0.335, 0), new THREE.Vector3(0.76, 0.3, 0)
    ], false, 'centripetal');
    var handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 96, 0.062, 20, false), porcelain);
    handle.scale.z = 0.78; handle.castShadow = true;
    var rimGold = new THREE.Mesh(new THREE.TorusGeometry(0.976, 0.0262, 12, 200), gold);
    rimGold.rotation.x = Math.PI / 2; rimGold.position.y = 1.06;
    var liquid = new THREE.Mesh(new THREE.CircleGeometry(radiusAt(cupInner, LIQ_Y) + 0.004, 128), liquidMat);
    liquid.rotation.x = -Math.PI / 2; liquid.position.y = LIQ_Y; liquid.receiveShadow = true;
    cup.add(body, handle, rimGold, liquid);

    /* steam */
    var steam = new THREE.Group();
    steam.position.y = LIQ_Y + 0.02;
    cup.add(steam);
    var steamMats = [];
    var steamGeo = new THREE.PlaneGeometry(0.95, 2.7, 16, 64);
    steamGeo.translate(0, 1.35, 0);
    var steamCount = low ? 2 : 3;
    for (var si = 0; si < steamCount; si++) {
      var sm = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uNoise: { value: noise }, uWind: { value: new THREE.Vector2() }, uSeed: { value: si * 0.31 },
          uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xf7ecdd) } },
        vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide
      });
      steamMats.push(sm);
      var plane = new THREE.Mesh(steamGeo, sm);
      plane.rotation.y = si * (Math.PI / steamCount) + 0.3;
      plane.position.x = (si - 1) * 0.08;
      plane.scale.setScalar(1 - si * 0.08);
      plane.renderOrder = 2;
      steam.add(plane);
    }

    /* soft floor shadow, grounds the floating cup */
    var floorShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(0,0,0,1)'], [0.45, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.5 })
    );
    floorShadow.rotation.x = -Math.PI / 2; floorShadow.position.y = -1.08; floorShadow.scale.set(1, 0.62, 1);
    cupRig.add(floorShadow);

    /* warm halo behind the cup */
    var halo = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(201,138,75,0.55)'], [0.35, 'rgba(160,92,44,0.22)'], [1, 'rgba(60,30,15,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    halo.position.set(0.2, 0.5, -3.2);
    cupRig.add(halo);
    scene.add(cupRig);

    /* ----- beans ----- */
    var beanGeo = makeBeanGeometry(low ? 18 : 26);
    var beanMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.32, bumpMap: noise, bumpScale: 1.6, envMapIntensity: 0.9 });
    var R = rng(2024);
    var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
    function randomQuat() { return new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.283, R() * 6.283, R() * 6.283)); }
    function randomAxis() { return new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(); }

    // orbiting beans around the cup (hero + finale)
    var orbitCount = low ? 22 : 38;
    var orbitExtras = [[-2.75, 1.65, 2.3, 0.2], [2.95, -0.35, 2.0, 0.19], [-2.25, -0.95, 2.7, 0.17], [2.35, 1.9, 1.2, 0.15]];
    var orbitTotal = orbitCount + orbitExtras.length;
    var orbit = new THREE.InstancedMesh(beanGeo, beanMat, orbitTotal);
    orbit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    orbit.frustumCulled = false;
    var orbitData = [];
    for (var oi = 0; oi < orbitTotal; oi++) {
      var extra = orbitExtras[oi - orbitCount];
      orbitData.push({
        R: extra ? Math.hypot(extra[0], extra[2]) : 1.85 + R() * 1.75,
        a0: extra ? Math.atan2(extra[2], extra[0]) : R() * Math.PI * 2,
        w: (0.05 + R() * 0.08) * (R() < 0.5 ? 1 : -1) * (extra ? 0.25 : 1),
        h: extra ? extra[1] : -0.55 + R() * 2.3,
        bobA: 0.05 + R() * 0.09, bobF: 0.5 + R() * 0.7, ph: R() * 6.283,
        s: extra ? extra[3] : 0.085 + R() * 0.055,
        q0: randomQuat(), axis: randomAxis(), spin: 0.25 + R() * 0.55,
        delay: 0.18 + R() * 0.32, extra: !!extra
      });
      orbit.setColorAt(oi, tmpC.set(ROASTED[(R() * ROASTED.length) | 0]).multiplyScalar(0.92 + R() * 0.2));
    }
    orbit.instanceColor.needsUpdate = true;
    var orbitTilt = new THREE.Group();
    orbitTilt.rotation.set(0.16, 0, -0.08);
    orbitTilt.add(orbit);
    scene.add(orbitTilt);

    // the bean cloud for the journey section
    var cloudCount = low ? 64 : 120;
    var cloudMat = beanMat.clone();
    var cloud = new THREE.InstancedMesh(beanGeo, cloudMat, cloudCount);
    cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cloud.frustumCulled = false;
    var cloudData = [];
    for (var ci = 0; ci < cloudCount; ci++) {
      var cp;
      do { cp = new THREE.Vector3((R() - 0.32) * 10, (R() - 0.5) * 6.2, -7 + R() * 11.5); } while (Math.hypot(cp.x, cp.y) < 0.9 && cp.z > 0);
      var t = ci / (cloudCount - 1);
      var strand = ci % 2;
      cloudData.push({
        cloud: cp,
        hy: lerp(-2.7, 2.7, t), hphi: ci * 0.34 + strand * Math.PI, hr: 1.25 + 0.2 * Math.sin(ci * 1.7),
        burst: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(1.4 + R() * 2.2),
        s: 0.13 + R() * 0.06, q0: randomQuat(), axis: randomAxis(), spin: 0.2 + R() * 0.5,
        tint: 0.88 + R() * 0.24, bob: R() * 6.283
      });
    }
    for (var cc = 0; cc < cloudCount; cc++) cloud.setColorAt(cc, roastColor(0, tmpC).multiplyScalar(cloudData[cc].tint));
    cloud.instanceColor.needsUpdate = true;
    var cloudGroup = new THREE.Group();
    cloudGroup.add(cloud);
    scene.add(cloudGroup);

    // coffee grounds → vortex
    var gCount = low ? 700 : 1500;
    var gGeo = new THREE.BufferGeometry();
    var gStart = new Float32Array(gCount * 3), gSeed = new Float32Array(gCount), gSize = new Float32Array(gCount), gPos = new Float32Array(gCount * 3);
    for (var gi = 0; gi < gCount; gi++) {
      var ga = R() * Math.PI * 2, gr = 1.2 + R() * 0.6;
      gStart[gi * 3] = Math.cos(ga) * gr; gStart[gi * 3 + 1] = (R() - 0.5) * 5.4; gStart[gi * 3 + 2] = Math.sin(ga) * gr;
      gSeed[gi] = R(); gSize[gi] = 0.5 + R() * 1.4;
    }
    gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    gGeo.setAttribute('aStart', new THREE.BufferAttribute(gStart, 3));
    gGeo.setAttribute('aSeed', new THREE.BufferAttribute(gSeed, 1));
    gGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1));
    var groundsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uP: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uSize: { value: 26 }, uOpacity: { value: 1 }, uSink: { value: -0.7 } },
      vertexShader: GROUNDS_VERT, fragmentShader: GROUNDS_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var grounds = new THREE.Points(gGeo, groundsMat);
    grounds.frustumCulled = false;
    scene.add(grounds);

    /* ----- dust motes + bokeh ----- */
    function pointsGeo(n, fill) {
      var g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n), sd = new Float32Array(n), c = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) fill(i, p, s, sd, c);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
      return g;
    }
    var dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uSize: { value: 30 }, uColor: { value: new THREE.Color(0xf4cf8f) }, uOpacity: { value: 0.9 } },
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var dust = new THREE.Points(pointsGeo(low ? 110 : 240, function (i, p, s, sd) {
      p[i * 3] = (R() - 0.5) * 11; p[i * 3 + 1] = -2.5 + R() * 8; p[i * 3 + 2] = -4 + R() * 7.5;
      s[i] = 0.4 + R() * 1.1; sd[i] = R();
    }), dustMat);
    dust.frustumCulled = false;
    scene.add(dust);

    var bokehCols = [new THREE.Color(0xc98a4b), new THREE.Color(0xe2b26f), new THREE.Color(0x9a5a2c), new THREE.Color(0xf0cf96)];
    var bokehMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uSize: { value: 1500 }, uOpacity: { value: 0.55 } },
      vertexShader: BOKEH_VERT, fragmentShader: BOKEH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var bokeh = new THREE.Points(pointsGeo(low ? 14 : 26, function (i, p, s, sd, c) {
      p[i * 3] = (R() - 0.5) * 22; p[i * 3 + 1] = -4 + R() * 11; p[i * 3 + 2] = -9 - R() * 8;
      s[i] = 0.5 + R() * 1.2; sd[i] = R();
      var col = bokehCols[(R() * bokehCols.length) | 0]; c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }), bokehMat);
    bokeh.frustumCulled = false;
    scene.add(bokeh);

    /* =================================================================
     * state + layout
     * ================================================================= */
    var st = {
      mode: 'none', time: 0, lastMs: 0, vw: 1, vh: 1,
      px: 0, py: 0, sx: 0, sy: 0, vx: 0, wind: 0,
      heroP: 0, beansP: 0, finP: 0,
      intro: reduced ? 1 : 0, introPlaying: false, introStart: 0,
      els: null, rects: {}, needsRender: true
    };
    var camPos = new THREE.Vector3(0, 1, 10), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();

    function docRect(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var sy = window.scrollY || window.pageYOffset || 0;
      return { top: r.top + sy, left: r.left, w: r.width, h: r.height };
    }
    function measure() {
      var e = st.els; if (!e) return;
      st.rects = {
        hero: docRect(e.hero), heroStage: docRect(e.heroStage), beans: docRect(e.beans),
        journey: docRect(e.journey), finale: docRect(e.finale), finaleStage: docRect(e.finaleStage)
      };
    }
    function resize() {
      var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      st.vw = w; st.vh = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      var pr = renderer.getPixelRatio();
      dustMat.uniforms.uPR.value = pr; bokehMat.uniforms.uPR.value = pr; groundsMat.uniforms.uPR.value = pr;
      measure();
      st.needsRender = true;
    }

    // place the camera so a subject of size (w × h world units) fills a DOM box, and shift the lens onto it
    function frameOnBox(box, subjW, subjH, fill, elevation, azimuth, target) {
      var fov = camera.fov * DEG;
      var ppu = Math.min((box.w * fill) / subjW, (box.h * fill) / subjH);
      ppu = Math.max(ppu, 20);
      var dist = st.vh / (2 * Math.tan(fov / 2) * ppu);
      camPos.set(
        target.x + Math.sin(azimuth) * Math.cos(elevation) * dist,
        target.y + Math.sin(elevation) * dist,
        target.z + Math.cos(azimuth) * Math.cos(elevation) * dist
      );
      camLook.copy(target);
      lensShift(box.cx - st.vw / 2, box.cy - st.vh / 2);
    }
    function lensShift(dx, dy) {
      camera.setViewOffset(st.vw, st.vh, -dx, -dy, st.vw, st.vh);
    }

    /* =================================================================
     * per-mode updates
     * ================================================================= */
    var orbitSpread = 0, orbitLift = 0, orbitAppear = 1, steamLevel = 0;

    function updateOrbit(intro) {
      var t = st.time;
      for (var i = 0; i < orbitTotal; i++) {
        var b = orbitData[i];
        var k = clamp((intro - b.delay) / 0.42, 0, 1) * orbitAppear;
        var ek = easeOutCubic(k);
        var r = lerp(0.3, b.R * (1 + orbitSpread * (b.extra ? 0.5 : 1)), ek);
        var a = b.a0 + t * b.w + (1 - ek) * 1.2;
        tmpP.set(Math.cos(a) * r, b.h * ek + Math.sin(t * b.bobF + b.ph) * b.bobA + orbitLift * (0.6 + b.R * 0.25), Math.sin(a) * r * 0.9);
        tmpQ2.setFromAxisAngle(b.axis, t * b.spin * (1 + orbitSpread * 1.5) + b.ph);
        tmpQ.copy(b.q0).multiply(tmpQ2);
        var s = b.s * Math.max(0.0001, k < 1 ? easeOutBack(k) : 1);
        tmpS.set(s, s, s);
        tmpM.compose(tmpP, tmpQ, tmpS);
        orbit.setMatrixAt(i, tmpM);
      }
      orbit.instanceMatrix.needsUpdate = true;
    }

    function poseCup(opts) {
      cupRig.position.set(0, opts.y || 0, 0);
      cupRig.scale.setScalar(opts.scale);
      cupTilt.rotation.set(opts.rx, opts.ry, opts.rz);
      cupBody.position.y = -0.56 + Math.sin(st.time * 0.9) * 0.045;
      floorShadow.material.opacity = 0.45 * opts.shadow * (1 - Math.sin(st.time * 0.9) * 0.15);
      floorShadow.scale.set(1 - Math.sin(st.time * 0.9) * 0.04, 0.62, 1);
    }

    function setSteam(level) {
      steamLevel = level;
      for (var i = 0; i < steamMats.length; i++) {
        var u = steamMats[i].uniforms;
        u.uTime.value = st.time + i * 3.7;
        u.uOpacity.value = level * (0.58 - i * 0.1);
        u.uWind.value.set(st.wind * 0.9, -st.wind * 0.3);
      }
      steam.visible = level > 0.01;
    }

    function lightsWarm(intensity) {
      hemi.intensity = 0.55 * intensity;
      key.color.setHex(0xfff0dc);
      key.intensity = 2.7 * intensity;
      key.position.set(-3.5 + st.sx * 2.6 + Math.sin(st.time * 0.21) * 0.6, 6 + st.sy * 1.4, 4.5);
      rim.color.setHex(0xffa65c);
      rim.intensity = (3.4 + Math.sin(st.time * 0.6) * 0.25) * intensity;
      under.intensity = 0;
    }

    function updateHero(dt) {
      var p = st.heroP;
      var intro = st.intro;
      var box = st.rects.heroStage;
      var sy = window.scrollY || 0;
      var ie = easeOutCubic(smooth(0, 0.6, intro));
      var stage = box ? { w: box.w, h: box.h, cx: box.left + box.w / 2, cy: box.top + box.h / 2 - sy * 0.38 } : { w: st.vw * 0.4, h: st.vh * 0.5, cx: st.vw / 2, cy: st.vh / 2 };
      var target = tmpV.set(0, 0, 0);
      var elev = (16 + st.sy * 4) * DEG;
      var az = (Math.sin(st.time * 0.13) * 4 + st.sx * 7) * DEG;
      frameOnBox(stage, 3.45, 2.0, 0.94 * (1 + p * 0.22), elev, az, target);

      poseCup({
        y: (1 - ie) * -1.4 + p * 0.25,
        scale: lerp(0.55, 1, easeOutBack(smooth(0, 0.7, intro))),
        rx: 0.06 + st.sy * 0.06 + p * 0.5,
        ry: (1 - ie) * -2.4 + Math.sin(st.time * 0.17) * 0.12 + st.sx * 0.18 + p * 1.15,
        rz: -st.sx * 0.05 + Math.sin(st.time * 0.31) * 0.012,
        shadow: ie * (1 - p)
      });
      orbitSpread = p * 1.25;
      orbitLift = p * 0.9;
      orbitAppear = 1;
      orbitTilt.visible = true;
      updateOrbit(intro);
      setSteam(smooth(0.45, 1, intro) * (1 - p * 0.85));
      lightsWarm(lerp(0.35, 1, ie));
      liquidUniforms.uSwirl.value = 0.35 + p * 1.6;
      halo.material.opacity = ie;
      cupRig.visible = true; cloud.visible = false; grounds.visible = false;
      dustMat.uniforms.uOpacity.value = 0.9 * ie;
      bokehMat.uniforms.uOpacity.value = 0.55 * ie;
    }

    function updateFinale() {
      var p = st.finP;
      var box = st.rects.finaleStage;
      var sy = window.scrollY || 0;
      var stage = box ? { w: box.w, h: box.h, cx: box.left + box.w / 2, cy: box.top + box.h / 2 - sy } : { w: st.vw * 0.4, h: st.vh * 0.5, cx: st.vw / 2, cy: st.vh / 2 };
      var e = easeOutCubic(p);
      frameOnBox(stage, 3.45, 2.0, 0.92, (18 + st.sy * 4) * DEG, (st.sx * 7 + Math.sin(st.time * 0.13) * 4) * DEG, tmpV.set(0, 0, 0));
      poseCup({
        y: (1 - e) * -0.9,
        scale: lerp(0.7, 1, e),
        rx: 0.08 + st.sy * 0.06,
        ry: (1 - e) * -1.6 + Math.sin(st.time * 0.17) * 0.12 + st.sx * 0.18,
        rz: -st.sx * 0.05,
        shadow: e
      });
      orbitSpread = (1 - e) * -0.35;
      orbitLift = 0;
      orbitAppear = 1;
      orbitTilt.visible = true;
      updateOrbit(smooth(0.05, 0.95, p) * 1.0 + 0.0001);
      setSteam(smooth(0.35, 0.9, p));
      lightsWarm(lerp(0.5, 1, e));
      liquidUniforms.uSwirl.value = 0.35 + (1 - e) * 1.2;
      halo.material.opacity = e;
      cupRig.visible = true; cloud.visible = false; grounds.visible = false;
      dustMat.uniforms.uOpacity.value = 0.9;
      bokehMat.uniforms.uOpacity.value = 0.55;
    }

    // camera keyframes for the journey: [p, camX, camY, camZ, lookX, lookY]
    var JOURNEY_CAM = [
      [0.0, 0.0, 0.2, 10.2, 0, 0], [0.2, 0.6, 0.5, 8.2, 0, 0.1], [0.4, 1.3, 0.7, 6.8, 0, 0.15],
      [0.6, -0.9, 0.5, 6.2, 0, 0.1], [0.8, 0.0, 1.2, 7.6, 0, 0], [1.0, 0.0, 2.2, 7.6, 0, -0.3]
    ];
    function journeyCam(p) {
      for (var i = 0; i < JOURNEY_CAM.length - 1; i++) {
        var a = JOURNEY_CAM[i], b = JOURNEY_CAM[i + 1];
        if (p <= b[0]) {
          var t = smooth(a[0], b[0], p);
          camPos.set(lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t));
          camLook.set(lerp(a[4], b[4], t), lerp(a[5], b[5], t), 0);
          return;
        }
      }
    }

    var lastRoast = -1;
    function updateBeans() {
      var p = st.beansP, t = st.time;
      journeyCam(p);
      camPos.x += st.sx * 0.55; camPos.y += st.sy * 0.32;
      var wide = st.vw >= 900;
      lensShift(wide ? st.vw * 0.2 : 0, wide ? 0 : -st.vh * 0.08);

      var toHelix = smooth(0.14, 0.34, p);
      var burst = smooth(0.6, 0.76, p);
      var gone = smooth(0.72, 0.84, p);
      var roast = smooth(0.34, 0.56, p);

      cloudGroup.rotation.y = Math.sin(t * 0.05) * 0.45 * (1 - toHelix);
      for (var i = 0; i < cloudCount; i++) {
        var b = cloudData[i];
        var phi = b.hphi + t * 0.22;
        var hx = Math.cos(phi) * b.hr, hz = Math.sin(phi) * b.hr, hy = b.hy;
        var cx = b.cloud.x + Math.sin(t * 0.3 + b.bob) * 0.12, cy = b.cloud.y + Math.cos(t * 0.27 + b.bob) * 0.12, cz = b.cloud.z;
        var x = lerp(cx, hx, toHelix), y = lerp(cy, hy, toHelix), z = lerp(cz, hz, toHelix);
        x += b.burst.x * burst; y += b.burst.y * burst; z += b.burst.z * burst;
        tmpP.set(x, y, z);
        tmpQ2.setFromAxisAngle(b.axis, t * b.spin * (1 + burst * 5) + b.bob);
        tmpQ.copy(b.q0).multiply(tmpQ2);
        var s = b.s * (1 - gone * 0.999);
        tmpS.set(s, s, s);
        tmpM.compose(tmpP, tmpQ, tmpS);
        cloud.setMatrixAt(i, tmpM);
      }
      cloud.instanceMatrix.needsUpdate = true;
      if (Math.abs(roast - lastRoast) > 0.002) {
        for (var j = 0; j < cloudCount; j++) cloud.setColorAt(j, roastColor(roast, tmpC).multiplyScalar(cloudData[j].tint));
        cloud.instanceColor.needsUpdate = true;
        cloudMat.roughness = lerp(0.78, 0.4, roast);
        cloudMat.clearcoat = lerp(0.0, 0.5, roast);
        lastRoast = roast;
      }
      cloud.visible = gone < 0.999;

      // light: cool daylight at origin → roaster flame → warm studio
      var flame = smooth(0.34, 0.46, p) * (1 - smooth(0.58, 0.7, p));
      hemi.intensity = 0.55;
      key.color.copy(tmpC.setHex(0xe8eefc).lerp(new THREE.Color(0xfff0dc), smooth(0.2, 0.45, p)));
      key.intensity = 2.4;
      key.position.set(-3.5 + st.sx * 2, 6, 4.5);
      rim.color.setHex(0xffa65c);
      rim.intensity = lerp(1.6, 3.4, smooth(0.25, 0.5, p));
      under.color.setHex(0xff8a3a);
      under.intensity = flame * (16 + Math.sin(t * 9.0) * 3 + Math.sin(t * 23.0) * 2);

      groundsMat.uniforms.uTime.value = t;
      groundsMat.uniforms.uP.value = p;
      grounds.visible = p > 0.58;

      // the cup arrives for the brew
      var arrive = smooth(0.8, 0.97, p);
      cupRig.visible = arrive > 0.001;
      if (cupRig.visible) {
        poseCup({ y: lerp(-3.0, -0.95, easeOutCubic(arrive)), scale: 0.6 * Math.max(0.001, easeOutBack(arrive)), rx: 0.16, ry: -0.6 + Math.sin(t * 0.2) * 0.25, rz: 0, shadow: 0 });
        groundsMat.uniforms.uSink.value = cupRig.position.y + (LIQ_Y + 0.05 - 0.56) * 0.6;
      }
      setSteam(smooth(0.9, 1, p));
      liquidUniforms.uSwirl.value = 0.35 + (1 - arrive) * 2.5;
      halo.material.opacity = 0;
      floorShadow.material.opacity = 0;
      orbitTilt.visible = false;
      dustMat.uniforms.uOpacity.value = 0.6;
      bokehMat.uniforms.uOpacity.value = 0.45;
    }

    /* =================================================================
     * frame
     * ================================================================= */
    function frame(ms) {
      var dt = st.lastMs ? Math.min(0.05, (ms - st.lastMs) / 1000) : 0.016;
      st.lastMs = ms;
      if (!reduced) st.time += dt;

      // intro clock
      if (st.introPlaying) {
        st.intro = clamp((ms - st.introStart) / 2600, 0, 1);
        if (st.intro >= 1) st.introPlaying = false;
      }

      // pointer smoothing; wind follows pointer velocity
      var psx = st.sx;
      st.sx = damp(st.sx, reduced ? 0 : st.px, 3.2, dt);
      st.sy = damp(st.sy, reduced ? 0 : st.py, 3.2, dt);
      st.wind = damp(st.wind, clamp((st.sx - psx) / Math.max(dt, 0.001), -2, 2) * 0.5, 2.2, dt);

      // scroll-derived progress
      var sy = window.scrollY || 0, vh = st.vh, rc = st.rects;
      var mode = 'none';
      if (rc.hero && sy < rc.hero.top + rc.hero.h) {
        mode = 'hero';
        var hp = clamp((sy - rc.hero.top) / Math.max(1, rc.hero.h), 0, 1);
        st.heroP = reduced ? hp : damp(st.heroP, hp, 10, dt);
      } else if (rc.beans && sy + vh > rc.beans.top && sy < rc.beans.top + rc.beans.h) {
        mode = 'beans';
        var jp = rc.journey ? clamp((sy + vh * 0.5 - rc.journey.top) / Math.max(1, rc.journey.h - vh * 0.5), 0, 1) : 0;
        st.beansP = reduced ? jp : damp(st.beansP, jp, 6, dt);
      } else if (rc.finale && sy + vh > rc.finale.top && sy < rc.finale.top + rc.finale.h) {
        mode = 'finale';
        var fp = clamp((sy + vh - rc.finale.top) / Math.max(1, rc.finale.h * 0.5 + vh * 0.5), 0, 1);
        st.finP = reduced ? fp : damp(st.finP, fp, 8, dt);
      }
      if (mode !== st.mode) { st.mode = mode; st.needsRender = true; if (mode === 'none') renderer.clear(); }
      if (mode === 'none') return;
      if (reduced && !st.needsRender && Math.abs(sy - (st.lastSy || 0)) < 0.5) return;
      st.lastSy = sy;

      camera.clearViewOffset();
      if (mode === 'hero') updateHero(dt);
      else if (mode === 'beans') updateBeans(dt);
      else updateFinale(dt);

      camera.position.copy(camPos);
      camera.lookAt(camLook);
      camera.updateProjectionMatrix();

      liquidUniforms.uTime.value = st.time;
      dustMat.uniforms.uTime.value = st.time;
      bokehMat.uniforms.uTime.value = st.time;

      renderer.render(scene, camera);
      st.needsRender = false;
    }

    /* =================================================================
     * public api
     * ================================================================= */
    var rafId = 0;
    Scene.ok = true;
    Scene.renderer = renderer;
    Scene.bind = function (els) { st.els = els; measure(); st.needsRender = true; };
    Scene.refresh = function () { measure(); st.needsRender = true; };
    Scene.resize = resize;
    Scene.pointer = function (nx, ny) { st.px = clamp(nx, -1, 1); st.py = clamp(ny, -1, 1); };
    Scene.intro = function () {
      if (reduced) { st.intro = 1; st.needsRender = true; return; }
      st.intro = 0; st.introPlaying = true; st.introStart = performance.now();
    };
    Scene.tick = function (ms) { frame(ms == null ? performance.now() : ms); };
    Scene.start = function () {
      if (rafId) return;
      (function loop(ms) { frame(ms); rafId = requestAnimationFrame(loop); })(performance.now());
    };
    Scene.state = st;

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      Scene.ok = false;
      document.documentElement.classList.add('no-webgl');
    });

    resize();
    // compile shaders up front so the first visible frame doesn't hitch
    try { renderer.compile(scene, camera); } catch (e) { /* compile is an optimisation only */ }
    return true;
  };
})();
