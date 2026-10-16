// InkBatch: a single dynamic mesh that every brush stroke, wash and splash of a
// layer is tessellated into each frame. The fragment shader turns the stroke's
// (along, across) coordinates into bristle streaks and dry-brush gaps, so a
// stroke is pure geometry + maths: no textures, crisp at any resolution.

import { Buffer, BufferUsage, Geometry, Mesh, Shader } from 'pixi.js';
import { NOISE } from './glsl';
import { clamp, fbm1, noise1, smooth, type V2 } from '../util';

const VERT = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec4 aParams;
out vec2 vUV;
out vec4 vColor;
out vec4 vP;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
  vP = aParams;
  vPos = aPosition;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUV;
in vec4 vColor;
in vec4 vP;
in vec2 vPos;
out vec4 finalColor;
uniform float uGrainScale;
${NOISE}
void main() {
  float dry = vP.x;
  float kind = vP.y;
  float seed = vP.z;
  float a = vColor.a;
  if (kind < 0.5) {
    // Brush stroke. vUV.x runs along the stroke, vUV.y across it in [-1, 1].
    float v = vUV.y;
    float edge = 1.0 - smoothstep(0.78, 1.0, abs(v));
    float s1 = vnoise(vec2(vUV.x * 2.2 + seed * 5.1, v * 7.0 + seed * 3.3));
    float s2 = vnoise(vec2(vUV.x * 4.5 - seed, v * 13.0 + seed));
    float streak = s1 * 0.68 + s2 * 0.32;
    // dryness eats in from the edges first and opens gaps between bristles
    float th = dry * (0.45 + 0.55 * abs(v));
    float m = smoothstep(th - 0.07, th + 0.07, streak);
    a *= edge * mix(1.0, m, step(0.002, dry));
    // wet strokes pool slightly darker at their rims
    a *= mix(0.9 + 0.1 * smoothstep(0.35, 0.9, abs(v)), 1.0, step(0.97, vColor.a));
  } else {
    // Wash / blob: vUV.y is radial (1 at the rim).
    float r = vUV.y;
    // vUV.x = softness: 0 is a crisp wash, 1 an out-of-focus bloom
    float edge = 1.0 - smoothstep(0.8 - 0.75 * vUV.x, 1.0, r);
    vec2 g = vPos * uGrainScale;
    float gran = fbm3(g * 1.0 + seed);
    float pool = vP.w; // how much pigment collects at the rim
    a *= edge * (0.78 + 0.44 * gran);
    a *= mix(1.0, 0.55 + 0.6 * smoothstep(0.45, 0.98, r), pool);
    // dry washes break up into specks
    float sp = vnoise(g * 6.0 + seed * 9.0);
    a *= mix(1.0, smoothstep(dry - 0.1, dry + 0.1, sp), step(0.002, dry));
  }
  a = clamp(a, 0.0, 1.0);
  finalColor = vec4(vColor.rgb * a, a);
}
`;

const STRIDE = 12; // floats per vertex

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const INK: Rgb = { r: 0.055, g: 0.05, b: 0.055 };
export const RED: Rgb = { r: 0.62, g: 0.05, b: 0.07 };
export const PAPER: Rgb = { r: 0.93, g: 0.89, b: 0.8 };

export interface StrokeOpts {
  width: number;
  color?: Rgb;
  alpha?: number;
  /** Fraction of length over which the stroke swells in from the tip. */
  taperIn?: number;
  /** Fraction of length over which it thins out. */
  taperOut?: number;
  /** Width multiplier at the very start / end. */
  startW?: number;
  endW?: number;
  /** Dryness at start and end (0 = wet, ~0.9 = scratchy). */
  dry0?: number;
  dry1?: number;
  /** Edge wobble amount as a fraction of width. */
  wobble?: number;
  seed?: number;
  time?: number;
  /** Optional per-point width multipliers. */
  widths?: number[];
  /** Catmull-Rom subdivisions per input segment. */
  smoothing?: number;
  /** Round, pressed-in entry blob (the "kihitsu" of a stroke). */
  cap?: boolean;
}

export interface BlobOpts {
  color?: Rgb;
  alpha?: number;
  seed?: number;
  /** Irregularity of the rim (0 = circle). */
  rough?: number;
  pool?: number;
  dry?: number;
  /** Squash along an angle. */
  sx?: number;
  angle?: number;
  segs?: number;
  /** Blob only: 0 crisp rim .. 1 soft, out-of-focus falloff. */
  soft?: number;
  /** Ribbon only: per-row alpha multipliers. */
  alphas?: number[];
}

export class InkBatch {
  readonly mesh: Mesh<Geometry, Shader>;
  private data: Float32Array;
  private idx: Uint32Array;
  private vbuf: Buffer;
  private ibuf: Buffer;
  private geom: Geometry;
  private nv = 0;
  private ni = 0;
  private maxV: number;
  private maxI: number;
  /** Shared scratch arrays for stroke tessellation. */
  private sx: number[] = [];
  private sy: number[] = [];
  private sw: number[] = [];

  constructor(maxVerts = 30000, grainScale = 9) {
    this.maxV = maxVerts;
    this.maxI = maxVerts * 3;
    this.data = new Float32Array(maxVerts * STRIDE);
    this.idx = new Uint32Array(this.maxI);
    this.vbuf = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.ibuf = new Buffer({ data: this.idx, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const s = STRIDE * 4;
    this.geom = new Geometry({
      attributes: {
        aPosition: { buffer: this.vbuf, format: 'float32x2', stride: s, offset: 0 },
        aUV: { buffer: this.vbuf, format: 'float32x2', stride: s, offset: 8 },
        aColor: { buffer: this.vbuf, format: 'float32x4', stride: s, offset: 16 },
        aParams: { buffer: this.vbuf, format: 'float32x4', stride: s, offset: 32 },
      },
      indexBuffer: this.ibuf,
    });
    const shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG, name: 'ink-batch' },
      resources: {
        inkUniforms: { uGrainScale: { value: grainScale, type: 'f32' } },
      },
    });
    this.mesh = new Mesh({ geometry: this.geom, shader });
  }

  begin() {
    this.nv = 0;
    this.ni = 0;
  }

  end() {
    this.vbuf.setDataWithSize(this.data, Math.max(1, this.nv) * STRIDE, true);
    this.ibuf.setDataWithSize(this.idx, Math.max(3, this.ni), true);
    this.geom.indexCount = this.ni;
    this.mesh.visible = this.ni > 0;
  }

  private vert(x: number, y: number, u: number, v: number, c: Rgb, a: number, dry: number, kind: number, seed: number, pool: number) {
    if (this.nv >= this.maxV) return -1;
    const o = this.nv * STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = u;
    d[o + 3] = v;
    d[o + 4] = c.r;
    d[o + 5] = c.g;
    d[o + 6] = c.b;
    d[o + 7] = a;
    d[o + 8] = dry;
    d[o + 9] = kind;
    d[o + 10] = seed;
    d[o + 11] = pool;
    return this.nv++;
  }

  private tri(a: number, b: number, c: number) {
    if (a < 0 || b < 0 || c < 0 || this.ni + 3 > this.maxI) return;
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  /** Tapered, bristled brush stroke along a polyline. */
  stroke(pts: readonly V2[], o: StrokeOpts) {
    if (pts.length < 2) return;
    const color = o.color ?? INK;
    const alpha = o.alpha ?? 0.94;
    const seed = o.seed ?? 0;
    const time = o.time ?? 0;
    const wob = o.wobble ?? 0.18;
    const tin = o.taperIn ?? 0.12;
    const tout = o.taperOut ?? 0.45;
    const sW = o.startW ?? 0.35;
    const eW = o.endW ?? 0.08;
    const dry0 = o.dry0 ?? 0;
    const dry1 = o.dry1 ?? 0.55;
    const sub = o.smoothing ?? 3;

    // 1. resample with Catmull-Rom so every stroke is a smooth gesture
    const X = this.sx;
    const Y = this.sy;
    const W = this.sw;
    X.length = Y.length = W.length = 0;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(n - 1, i + 2)];
      const w1 = o.widths ? o.widths[i] : 1;
      const w2 = o.widths ? o.widths[i + 1] : 1;
      for (let k = 0; k < sub; k++) {
        const t = k / sub;
        const t2 = t * t;
        const t3 = t2 * t;
        X.push(0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3));
        Y.push(0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3));
        W.push(w1 + (w2 - w1) * t);
      }
    }
    X.push(pts[n - 1].x);
    Y.push(pts[n - 1].y);
    W.push(o.widths ? o.widths[n - 1] : 1);
    const m = X.length;

    let total = 0;
    const L: number[] = [0];
    for (let i = 1; i < m; i++) {
      total += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
      L.push(total);
    }
    if (total < 1e-5) return;

    const uScale = 0.5 / Math.max(o.width, 1e-4);
    let prev = -1;
    let prevR = -1;
    let firstW = 0;
    for (let i = 0; i < m; i++) {
      const t = L[i] / total;
      const a = Math.max(0, i - 1);
      const b = Math.min(m - 1, i + 1);
      let tx = X[b] - X[a];
      let ty = Y[b] - Y[a];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty;
      const ny = tx;
      // pressure profile: press in, swell, lift off
      const pin = sW + (1 - sW) * smooth(clamp(t / tin, 0, 1));
      const pout = 1 - (1 - eW) * smooth(clamp((t - (1 - tout)) / tout, 0, 1));
      const s = L[i];
      const living = 1 + wob * fbm1(seed * 7.3 + s * 4.1 + time * 0.6);
      const w = o.width * pin * pout * W[i] * living * 0.5;
      if (i === 0) firstW = w;
      const off = wob * 0.35 * w * noise1(seed * 3.1 + s * 2.3 + time * 0.4);
      const cx = X[i] + nx * off;
      const cy = Y[i] + ny * off;
      const dry = dry0 + (dry1 - dry0) * smooth(clamp((t - 0.35) / 0.65, 0, 1));
      const l = this.vert(cx + nx * w, cy + ny * w, s * uScale, -1, color, alpha, dry, 0, seed, 0);
      const r = this.vert(cx - nx * w, cy - ny * w, s * uScale, 1, color, alpha, dry, 0, seed, 0);
      if (prev >= 0) {
        this.tri(prev, prevR, l);
        this.tri(prevR, r, l);
      }
      prev = l;
      prevR = r;
    }
    if (o.cap) {
      this.blob({ x: X[0], y: Y[0] }, firstW * 1.25, { color, alpha, seed, rough: 0.12, segs: 12 });
    }
  }

  /** Irregular ink dab / wash. */
  blob(c: V2, radius: number, o: BlobOpts = {}) {
    const color = o.color ?? INK;
    const alpha = o.alpha ?? 0.92;
    const seed = o.seed ?? 0;
    const rough = o.rough ?? 0.15;
    const segs = o.segs ?? 22;
    const sx = o.sx ?? 1;
    const ang = o.angle ?? 0;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const soft = o.soft ?? 0;
    const center = this.vert(c.x, c.y, soft, 0, color, alpha, o.dry ?? 0, 1, seed, o.pool ?? 0.4);
    let first = -1;
    let prev = -1;
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const r = radius * (1 + rough * fbm1(seed * 13.1 + Math.cos(th) * 1.7 + Math.sin(th) * 1.3 + 4));
      const lx = Math.cos(th) * r * sx;
      const ly = Math.sin(th) * r;
      const v = this.vert(c.x + lx * ca - ly * sa, c.y + lx * sa + ly * ca, soft, 1, color, alpha, o.dry ?? 0, 1, seed, o.pool ?? 0.4);
      if (prev >= 0) this.tri(center, prev, v);
      else first = v;
      prev = v;
    }
    this.tri(center, prev, first);
  }

  /** Fan-filled wash polygon (star-convex around `center`). */
  fill(poly: readonly V2[], center: V2, o: BlobOpts = {}) {
    const color = o.color ?? INK;
    const alpha = o.alpha ?? 0.5;
    const seed = o.seed ?? 0;
    const c = this.vert(center.x, center.y, 0, 0, color, alpha, o.dry ?? 0, 1, seed, o.pool ?? 0.6);
    let first = -1;
    let prev = -1;
    for (let i = 0; i < poly.length; i++) {
      const v = this.vert(poly[i].x, poly[i].y, 0, 1, color, alpha, o.dry ?? 0, 1, seed, o.pool ?? 0.6);
      if (prev >= 0) this.tri(c, prev, v);
      else first = v;
      prev = v;
    }
    this.tri(c, prev, first);
  }

  /**
   * A wash filled between two edge polylines (left & right, same length),
   * e.g. a hakama panel or a sleeve. The rim fades across the width.
   */
  ribbon(left: readonly V2[], right: readonly V2[], o: BlobOpts = {}) {
    const color = o.color ?? INK;
    const alpha = o.alpha ?? 0.5;
    const seed = o.seed ?? 0;
    const pool = o.pool ?? 0.5;
    const dry = o.dry ?? 0;
    let pl = -1;
    let pc = -1;
    let pr = -1;
    for (let i = 0; i < left.length; i++) {
      const L = left[i];
      const R = right[i];
      const edgeEnd = i === 0 || i === left.length - 1 ? 0.9 : 0;
      const ai = alpha * (o.alphas ? o.alphas[i] : 1);
      const l = this.vert(L.x, L.y, 0, 1, color, ai, dry, 1, seed, pool);
      const c = this.vert((L.x + R.x) / 2, (L.y + R.y) / 2, 0, edgeEnd, color, ai, dry, 1, seed, pool);
      const r = this.vert(R.x, R.y, 0, 1, color, ai, dry, 1, seed, pool);
      if (pl >= 0) {
        this.tri(pl, pc, l);
        this.tri(pc, c, l);
        this.tri(pc, pr, c);
        this.tri(pr, r, c);
      }
      pl = l;
      pc = c;
      pr = r;
    }
  }
}
