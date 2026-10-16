// Ink effects: slash strokes painted by the blade, splashes and droplets that
// stain the ground, clash rings, falling petals, and the static scenery strokes.

import { clamp, fbm1, lerp, rand, rng, smooth, type V2 } from '../util';
import { INK, RED, type InkBatch, type Rgb } from './ink';

interface Slash {
  pts: V2[];
  w: number[];
  age: number;
  life: number;
  live: boolean;
  seed: number;
  width: number;
  owner: object;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: Rgb;
  a: number;
}

interface Stain {
  x: number;
  y: number;
  r: number;
  c: Rgb;
  a: number;
  age: number;
  life: number;
  seed: number;
  sx: number;
}

interface Burst {
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  c: Rgb;
  seed: number;
  spikes: { a: number; l: number; w: number }[];
  dir: number;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  r: number;
  seed: number;
}

interface Petal {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  spin: number;
  w: number;
  red: boolean;
  rest: number;
  seed: number;
}

export class Effects {
  slashes: Slash[] = [];
  drops: Drop[] = [];
  stains: Stain[] = [];
  bursts: Burst[] = [];
  rings: Ring[] = [];
  petals: Petal[] = [];
  private seedN = 1;

  constructor() {
    for (let i = 0; i < 70; i++) this.petals.push(this.newPetal(rand(-6, 6), rand(0, 4.5)));
  }

  reset() {
    this.slashes.length = 0;
    this.drops.length = 0;
    this.stains.length = 0;
    this.bursts.length = 0;
    this.rings.length = 0;
  }

  private newPetal(x: number, y: number): Petal {
    const z = rand(0.55, 1.5);
    return { x, y, z, vx: 0, vy: 0, spin: rand(0, 6), w: rand(2, 5), red: Math.random() < 0.14, rest: 0, seed: rand(0, 100) };
  }

  // ---- slash strokes
  beginSlash(owner: object, heavy: boolean) {
    this.endSlash(owner);
    this.slashes.push({ pts: [], w: [], age: 0, life: heavy ? 2.4 : 1.7, live: true, seed: this.seedN++, width: heavy ? 0.12 : 0.085, owner });
  }

  addSlashPoint(owner: object, p: V2, speed: number) {
    const s = this.slashes.find((q) => q.owner === owner && q.live);
    if (!s) return;
    const last = s.pts[s.pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.025) return;
    s.pts.push({ x: p.x, y: p.y });
    s.w.push(clamp(speed / 14, 0.3, 1.0));
  }

  endSlash(owner: object) {
    for (const s of this.slashes) if (s.owner === owner) s.live = false;
  }

  // ---- splashes
  splash(at: V2, dir: number, power: number, red: boolean) {
    const n = Math.round(14 + power * 26);
    for (let i = 0; i < n; i++) {
      const a = rand(-0.9, 1.1) + (dir > 0 ? 0 : Math.PI) * 1;
      const sp = rand(0.8, 3.8) * (0.6 + power * 0.6);
      const ang = dir > 0 ? rand(-0.6, 1.3) : Math.PI - rand(-0.6, 1.3);
      void a;
      this.drops.push({
        x: at.x + rand(-0.05, 0.05),
        y: at.y + rand(-0.05, 0.05),
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + rand(0, 1),
        r: rand(0.008, 0.03) * (0.7 + power * 0.5),
        c: red && Math.random() < 0.85 ? RED : INK,
        a: rand(0.75, 0.95),
      });
    }
    const spikes = [];
    const ns = 4 + Math.round(power * 3);
    for (let i = 0; i < ns; i++) {
      const fwd = Math.random() < 0.7;
      const a = fwd ? (dir > 0 ? 0 : Math.PI) + rand(-0.9, 0.9) : rand(0, Math.PI * 2);
      spikes.push({ a, l: rand(0.5, 1.6), w: rand(0.18, 0.45) });
    }
    this.bursts.push({ x: at.x, y: at.y, r: 0.05 + power * 0.06, age: 0, life: 0.5 + power * 0.4, c: red ? RED : INK, seed: this.seedN++, spikes, dir });
  }

  clash(at: V2) {
    this.rings.push({ x: at.x, y: at.y, age: 0, life: 0.45, r: 0.55, seed: this.seedN++ });
    for (let i = 0; i < 8; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(1.5, 3.5);
      this.drops.push({ x: at.x, y: at.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp + 1, r: rand(0.006, 0.014), c: INK, a: 0.9 });
    }
  }

  update(dt: number, wind: number, time: number, view: { x0: number; x1: number; top: number }) {
    for (const s of this.slashes) if (!s.live) s.age += dt;
    this.slashes = this.slashes.filter((s) => s.age < s.life);

    for (const d of this.drops) {
      d.vy -= 9.8 * dt;
      d.vx *= 1 - dt * 0.6;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y <= 0.004) {
        this.stains.push({ x: d.x, y: rand(-0.02, 0.05), r: d.r * rand(1.1, 1.8), c: d.c, a: d.a * 0.9, age: 0, life: rand(10, 16), seed: this.seedN++, sx: rand(1.8, 3.2) });
        d.a = 0;
      }
    }
    this.drops = this.drops.filter((d) => d.a > 0);
    for (const s of this.stains) s.age += dt;
    this.stains = this.stains.filter((s) => s.age < s.life);
    if (this.stains.length > 400) this.stains.splice(0, this.stains.length - 400);
    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < b.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);

    for (const p of this.petals) {
      if (p.rest > 0) {
        p.rest -= dt;
        if (p.rest <= 0) Object.assign(p, this.newPetal(rand(view.x0 - 1, view.x1), view.top + rand(0, 1)));
        continue;
      }
      const gust = fbm1(time * 0.3 + p.seed * 0.1);
      const tx = wind * (0.55 + 0.25 * p.z) + gust * 0.25 + Math.sin(time * 1.3 + p.seed) * 0.12;
      p.vx += (tx - p.vx) * dt * 2;
      p.vy += (-0.32 - 0.12 * Math.sin(p.spin) - p.vy) * dt * 3;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * p.w;
      if (p.y < 0.01) {
        p.y = 0.01;
        p.rest = rand(1.5, 5);
      }
      if (p.x > view.x1 + 1.5 || p.x < view.x0 - 2.5) Object.assign(p, this.newPetal(wind > 0 ? view.x0 - rand(0, 1) : view.x1 + rand(0, 1), rand(0.5, view.top)));
    }
  }

  drawBack(b: InkBatch, time: number) {
    for (const s of this.stains) {
      const fade = 1 - smooth(clamp((s.age - s.life * 0.6) / (s.life * 0.4), 0, 1));
      b.blob({ x: s.x, y: s.y }, s.r, { color: s.c, alpha: s.a * fade, seed: s.seed, rough: 0.35, sx: s.sx, pool: 0.7, segs: 12 });
    }
    void time;
  }

  drawPetals(b: InkBatch, near: boolean) {
    for (const p of this.petals) {
      if (near !== p.z > 1.15) continue;
      const flip = Math.abs(Math.cos(p.spin));
      b.blob({ x: p.x, y: p.y }, 0.026 * p.z, {
        color: p.red ? RED : INK,
        alpha: (p.red ? 0.85 : 0.55) * (0.6 + 0.4 * Math.min(1, p.z)),
        seed: p.seed,
        rough: 0.25,
        sx: 0.35 + flip * 1.4,
        angle: p.spin * 0.7,
        pool: 0.5,
        segs: 9,
      });
    }
  }

  drawFront(b: InkBatch, time: number) {
    for (const s of this.slashes) {
      if (s.pts.length < 3) continue;
      const k = s.age / s.life;
      const alpha = 0.9 * (1 - smooth(clamp((k - 0.35) / 0.65, 0, 1)));
      b.stroke(s.pts, {
        width: s.width * (1 - k * 0.25),
        widths: s.w,
        alpha,
        taperIn: 0.3,
        taperOut: 0.45,
        startW: 0.08,
        endW: 0.04,
        dry0: 0.12 + k * 0.6,
        dry1: 0.7 + k * 0.3,
        seed: s.seed,
        time: 0,
        wobble: 0.22,
        smoothing: 2,
        cap: false,
      });
    }
    for (const d of this.drops) {
      const sp = Math.hypot(d.vx, d.vy);
      b.blob({ x: d.x, y: d.y }, d.r, { color: d.c, alpha: d.a, seed: 3, rough: 0.2, sx: 1 + sp * 0.35, angle: Math.atan2(d.vy, d.vx), pool: 0.3, segs: 9 });
    }
    for (const bu of this.bursts) {
      const g = smooth(clamp(bu.age / 0.09, 0, 1));
      const fade = 1 - smooth(clamp((bu.age - bu.life * 0.35) / (bu.life * 0.65), 0, 1));
      const R = bu.r * (0.4 + 0.6 * g);
      b.blob({ x: bu.x, y: bu.y }, R, { color: bu.c, alpha: 0.92 * fade, seed: bu.seed, rough: 0.4, pool: 0.75, segs: 20 });
      for (const sp of bu.spikes) {
        const a = sp.a;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const n = 1;
        const L = R * (1 + sp.l * g * 1.4);
        b.stroke(
          [
            { x: bu.x + (ca / n) * R * 0.5, y: bu.y + (sa / n) * R * 0.5 },
            { x: bu.x + (ca / n) * L, y: bu.y + (sa / n) * L },
          ],
          { width: R * 0.55 * sp.w, color: bu.c, alpha: 0.9 * fade, taperIn: 0.01, taperOut: 0.8, startW: 1, endW: 0.05, dry1: 0.3, seed: bu.seed + a, time },
        );
        b.blob({ x: bu.x + (ca / n) * L * 1.15, y: bu.y + (sa / n) * L * 1.15 }, R * 0.12 * sp.w, { color: bu.c, alpha: 0.9 * fade, seed: a, rough: 0.3, segs: 8 });
      }
    }
    for (const r of this.rings) {
      const k = r.age / r.life;
      const R = lerp(0.12, r.r, smooth(Math.min(1, k * 1.6)));
      const pts: V2[] = [];
      const a0 = r.seed * 2.1;
      for (let i = 0; i <= 18; i++) {
        const a = a0 + (i / 18) * Math.PI * 1.75;
        pts.push({ x: r.x + Math.cos(a) * R, y: r.y + Math.sin(a) * R * 0.9 });
      }
      b.stroke(pts, { width: 0.07 * (1 - k * 0.6), alpha: 0.85 * (1 - k), taperIn: 0.15, taperOut: 0.6, startW: 0.4, endW: 0.05, dry0: 0.2 + k * 0.5, dry1: 0.85, seed: r.seed, time: 0 });
      for (let i = 0; i < 7; i++) {
        const a = a0 + i * 0.9;
        const r0 = R * 1.15;
        const r1 = R * (1.5 + 0.4 * ((i * 37) % 5) / 5);
        b.stroke(
          [
            { x: r.x + Math.cos(a) * r0, y: r.y + Math.sin(a) * r0 },
            { x: r.x + Math.cos(a) * r1, y: r.y + Math.sin(a) * r1 },
          ],
          { width: 0.02, alpha: 0.8 * (1 - k), taperIn: 0.1, taperOut: 0.7, startW: 1, endW: 0.05, seed: r.seed + i, time: 0 },
        );
      }
    }
  }
}

// ------------------------------------------------------------------ scenery

/** Ground line, grass, stones and a pale ground wash, painted once. */
export function paintGround(b: InkBatch) {
  const r = rng(7);
  b.begin();
  // pale ground wash
  const wash: V2[] = [];
  const washB: V2[] = [];
  for (let x = -14; x <= 14; x += 0.5) {
    wash.push({ x, y: 0.02 + 0.03 * fbm1(x * 0.7) });
    washB.push({ x, y: -1.4 });
  }
  b.ribbon(wash, washB, { alpha: 0.07, seed: 3, pool: 0.0 });
  // brushed earth: long faint horizontal sweeps fading toward the viewer
  for (let k = 0; k < 6; k++) {
    const y = -0.1 - k * 0.16 - r() * 0.05;
    const x0 = -14 + r() * 6;
    const pts: V2[] = [];
    for (let x = x0; x <= x0 + 14 + r() * 10; x += 0.8) pts.push({ x, y: y + 0.02 * fbm1(x * 0.5 + k) });
    b.stroke(pts, { width: 0.04 + r() * 0.05, alpha: 0.09 - k * 0.01, taperIn: 0.1, taperOut: 0.4, startW: 0.4, endW: 0.2, dry0: 0.5, dry1: 0.95, seed: 80 + k, wobble: 0.3 });
  }
  // the ground: a few long dry strokes, overlapping
  for (let k = 0; k < 3; k++) {
    const pts: V2[] = [];
    const x0 = -14 + k * 7.5 + r() * 2;
    const x1 = x0 + 9 + r() * 4;
    for (let x = x0; x <= x1; x += 0.6) pts.push({ x, y: 0.01 + 0.025 * fbm1(x * 0.9 + k * 3) - k * 0.02 });
    b.stroke(pts, { width: 0.07 - k * 0.012, alpha: 0.85, taperIn: 0.08, taperOut: 0.3, startW: 0.6, endW: 0.2, dry0: 0.25, dry1: 0.85, seed: 50 + k, wobble: 0.3 });
  }
  // grass tufts
  for (let i = 0; i < 46; i++) {
    const x = -13 + r() * 26;
    if (Math.abs(x) < 3.5 && r() < 0.7) continue;
    const n = 2 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) {
      const lean = (r() - 0.3) * 0.5;
      const h = 0.1 + r() * 0.22;
      b.stroke(
        [
          { x: x + j * 0.03, y: 0.005 },
          { x: x + j * 0.03 + lean * h * 0.6, y: h * 0.6 },
          { x: x + j * 0.03 + lean * h * 1.4, y: h },
        ],
        { width: 0.022, alpha: 0.8, taperIn: 0.05, taperOut: 0.8, startW: 1, endW: 0.05, dry1: 0.4, seed: i * 7 + j },
      );
    }
  }
  // stones
  for (const [x, s] of [
    [-6.2, 0.22],
    [5.4, 0.16],
    [7.8, 0.28],
    [-9.5, 0.2],
  ]) {
    b.blob({ x, y: 0.02 + s * 0.3 }, s, { alpha: 0.35, seed: x, rough: 0.3, sx: 1.6, pool: 0.9 });
    b.stroke(
      [
        { x: x - s * 1.6, y: 0.02 },
        { x: x - s * 0.9, y: s * 0.65 },
        { x: x + s * 0.3, y: s * 0.75 },
        { x: x + s * 1.5, y: 0.03 },
      ],
      { width: 0.05, alpha: 0.9, taperIn: 0.1, taperOut: 0.4, startW: 0.5, endW: 0.3, dry1: 0.8, seed: x * 3 },
    );
  }
  b.end();
}

/** A gnarled pine leaning over the duelling ground. */
export function paintPine(b: InkBatch, rootX: number) {
  const r = rng(41);
  b.begin();
  // rock at the root
  b.blob({ x: rootX + 0.2, y: 0.15 }, 0.55, { alpha: 0.3, seed: 2, rough: 0.35, sx: 1.7, pool: 0.95 });
  b.stroke(
    [
      { x: rootX - 0.9, y: 0.0 },
      { x: rootX - 0.5, y: 0.42 },
      { x: rootX + 0.3, y: 0.55 },
      { x: rootX + 1.1, y: 0.02 },
    ],
    { width: 0.09, alpha: 0.92, taperIn: 0.1, taperOut: 0.4, startW: 0.4, endW: 0.4, dry0: 0.2, dry1: 0.9, seed: 5 },
  );
  // trunk: leans in, bends back, reaches over
  const trunk: V2[] = [
    { x: rootX, y: 0.35 },
    { x: rootX + 0.15, y: 1.2 },
    { x: rootX - 0.05, y: 2.0 },
    { x: rootX + 0.35, y: 2.75 },
    { x: rootX + 1.1, y: 3.25 },
    { x: rootX + 2.0, y: 3.4 },
  ];
  b.stroke(trunk, { width: 0.3, alpha: 0.9, taperIn: 0.02, taperOut: 0.6, startW: 1.2, endW: 0.25, dry0: 0.35, dry1: 0.75, seed: 11, wobble: 0.25, smoothing: 5 });
  b.stroke(
    trunk.map((p) => ({ x: p.x + 0.07, y: p.y })),
    { width: 0.1, alpha: 0.85, taperIn: 0.05, taperOut: 0.5, startW: 1, endW: 0.2, dry0: 0.55, dry1: 0.9, seed: 12, smoothing: 5 },
  );
  // bark scales
  for (let i = 0; i < 9; i++) {
    const t = 0.1 + i * 0.09;
    const y = lerp(0.5, 3.0, t);
    const x = rootX + 0.1 + Math.sin(t * 6) * 0.15;
    b.stroke(
      [
        { x: x - 0.07, y },
        { x: x + 0.06, y: y + 0.05 },
      ],
      { width: 0.035, alpha: 0.8, taperIn: 0.2, taperOut: 0.5, startW: 0.5, endW: 0.2, dry1: 0.6, seed: 20 + i },
    );
  }
  // branches with needle clouds
  const branches: [V2[], number][] = [
    [
      [
        { x: rootX + 0.05, y: 1.9 },
        { x: rootX + 0.7, y: 2.05 },
        { x: rootX + 1.5, y: 1.92 },
      ],
      0.55,
    ],
    [
      [
        { x: rootX + 0.25, y: 2.6 },
        { x: rootX - 0.4, y: 2.85 },
        { x: rootX - 1.1, y: 2.7 },
      ],
      0.5,
    ],
    [
      [
        { x: rootX + 1.6, y: 3.35 },
        { x: rootX + 2.5, y: 3.5 },
        { x: rootX + 3.3, y: 3.35 },
      ],
      0.65,
    ],
    [
      [
        { x: rootX + 1.0, y: 3.2 },
        { x: rootX + 1.3, y: 3.75 },
        { x: rootX + 1.9, y: 4.05 },
      ],
      0.5,
    ],
  ];
  let seed = 60;
  for (const [pts, size] of branches) {
    b.stroke(pts, { width: 0.09, alpha: 0.9, taperIn: 0.05, taperOut: 0.7, startW: 1, endW: 0.2, dry0: 0.3, dry1: 0.8, seed: seed++ });
    const end = pts[pts.length - 1];
    const mid = pts[1];
    for (const [c, s] of [
      [end, size],
      [mid, size * 0.7],
    ] as [V2, number][]) {
      // pale wash cloud, then layered needle fans
      b.blob({ x: c.x, y: c.y + 0.12 }, s * 0.95, { alpha: 0.26, seed: seed++, rough: 0.35, sx: 1.9, pool: 0.95 });
      for (let k = 0; k < 26; k++) {
        const ox = (r() - 0.5) * s * 3.2;
        const oy = (r() - 0.25) * s * 0.75;
        const len = 0.08 + r() * 0.1;
        const a0 = Math.PI * (0.15 + r() * 0.7);
        const x = c.x + ox;
        const y = c.y + oy + 0.05;
        for (let j = 0; j < 3; j++) {
          const a = a0 + (j - 1) * 0.35;
          b.stroke(
            [
              { x, y },
              { x: x + Math.cos(a) * len, y: y + Math.sin(a) * len * 0.6 },
            ],
            { width: 0.018, alpha: 0.85, taperIn: 0.05, taperOut: 0.7, startW: 1, endW: 0.1, seed: seed + k * 3 + j },
          );
        }
      }
      b.blob({ x: c.x, y: c.y + 0.04 }, s * 0.42, { alpha: 0.7, seed: seed++, rough: 0.45, sx: 2.6, pool: 0.8 });
    }
  }
  b.end();
}

/** HUD: three ink marks per fighter, crossed out in red when lost. */
export function paintLives(b: InkBatch, x: number, y: number, dir: number, hp: number, max: number, size: number, time: number) {
  for (let i = 0; i < max; i++) {
    const cx = x + dir * i * size * 1.6;
    b.stroke(
      [
        { x: cx - size * 0.5, y: y + size * 0.15 },
        { x: cx + size * 0.5, y: y - size * 0.1 },
      ],
      { width: size * 0.42, alpha: i < hp ? 0.9 : 0.25, taperIn: 0.2, taperOut: 0.5, startW: 0.6, endW: 0.2, dry1: 0.6, seed: 300 + i + dir, time: time * 0.2 },
    );
    if (i >= hp) {
      b.stroke(
        [
          { x: cx - size * 0.3, y: y - size * 0.45 },
          { x: cx + size * 0.35, y: y + size * 0.45 },
        ],
        { width: size * 0.22, color: RED, alpha: 0.9, taperIn: 0.1, taperOut: 0.6, startW: 0.8, endW: 0.1, dry1: 0.5, seed: 330 + i + dir },
      );
    }
  }
}

/** The killing splash, painted straight onto the picture plane (screen px). */
export class ScreenSplash {
  age = -1;
  x = 0;
  y = 0;
  scale = 1;
  seed = 1;
  private lobes: { a: number; d: number; r: number }[] = [];
  private tendrils: { a: number; l: number; w: number; bend: number }[] = [];
  private drips: { x: number; len: number; w: number; speed: number }[] = [];
  private dots: { a: number; d: number; r: number }[] = [];

  trigger(x: number, y: number, scale: number, dir: number) {
    this.age = 0;
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.seed = rand(1, 100);
    this.lobes = [];
    this.tendrils = [];
    this.dots = [];
    this.drips = [];
    const fwd = dir > 0 ? 0 : Math.PI;
    for (let i = 0; i < 5; i++) this.lobes.push({ a: fwd + rand(-1.2, 1.2), d: rand(0.35, 0.8), r: rand(0.28, 0.55) });
    for (let i = 0; i < 9; i++) {
      const spray = Math.random() < 0.75;
      this.tendrils.push({ a: spray ? fwd + rand(-0.75, 0.75) : rand(0, Math.PI * 2), l: spray ? rand(1.3, 3.2) : rand(0.9, 1.6), w: rand(0.1, 0.24), bend: rand(-0.25, 0.25) });
    }
    for (let i = 0; i < 90; i++) {
      const spray = Math.random() < 0.8;
      const d = spray ? 1.1 + Math.pow(Math.random(), 1.6) * 4 : rand(1, 2.2);
      this.dots.push({ a: spray ? fwd + rand(-0.6, 0.6) * (1 + d * 0.08) : rand(0, Math.PI * 2), d, r: rand(0.012, 0.075) * (1.2 - d * 0.15) });
    }
    for (let i = 0; i < 5; i++) this.drips.push({ x: rand(-0.6, 0.6), len: rand(0.6, 2.2), w: rand(0.04, 0.09), speed: rand(0.15, 0.4) });
  }

  reset() {
    this.age = -1;
  }

  update(dt: number) {
    if (this.age >= 0) this.age += dt;
  }

  draw(b: InkBatch) {
    if (this.age < 0) return;
    const S = this.scale;
    const g = smooth(clamp(this.age / 0.1, 0, 1));
    const R = S * (0.3 + 0.7 * g);
    const c = { x: this.x, y: this.y };
    b.blob(c, R * 0.85, { color: RED, alpha: 0.94, seed: this.seed, rough: 0.5, pool: 0.85, segs: 30 });
    for (const l of this.lobes) {
      b.blob({ x: c.x + Math.cos(l.a) * l.d * R, y: c.y + Math.sin(l.a) * l.d * R }, R * l.r, { color: RED, alpha: 0.9, seed: this.seed + l.a, rough: 0.5, pool: 0.85, segs: 18 });
    }
    for (const t of this.tendrils) {
      const L = R * (0.6 + t.l * g);
      const ca = Math.cos(t.a);
      const sa = Math.sin(t.a);
      const mx = c.x + ca * L * 0.6 - sa * L * t.bend;
      const my = c.y + sa * L * 0.6 + ca * L * t.bend;
      const end = { x: c.x + ca * L, y: c.y + sa * L };
      b.stroke([{ x: c.x + ca * R * 0.4, y: c.y + sa * R * 0.4 }, { x: mx, y: my }, end], {
        width: R * t.w * 2,
        color: RED,
        alpha: 0.92,
        taperIn: 0.02,
        taperOut: 0.75,
        startW: 1,
        endW: 0.08,
        dry1: 0.2,
        seed: this.seed + t.a,
      });
      b.blob(end, R * t.w * 0.55, { color: RED, alpha: 0.92, seed: t.a * 7, rough: 0.3, segs: 10 });
    }
    for (const d of this.dots) {
      const dd = R * d.d * (0.5 + 0.5 * g);
      b.blob({ x: c.x + Math.cos(d.a) * dd, y: c.y + Math.sin(d.a) * dd }, R * Math.max(0.01, d.r), { color: RED, alpha: 0.9, seed: d.a * 10, rough: 0.3, pool: 0.6, segs: 9 });
    }
    for (const d of this.drips) {
      const L = R * d.len * smooth(clamp((this.age - 0.4) * d.speed, 0, 1));
      if (L < 1) continue;
      const x = c.x + d.x * R;
      const y0 = c.y + R * 0.3;
      b.stroke(
        [
          { x, y: y0 },
          { x: x + 1.5, y: y0 + L },
        ],
        { width: R * d.w, color: RED, alpha: 0.9, taperIn: 0.05, taperOut: 0.15, startW: 1, endW: 0.75, seed: d.x * 9 },
      );
      b.blob({ x: x + 1.5, y: y0 + L }, R * d.w * 0.65, { color: RED, alpha: 0.9, seed: d.x * 9, rough: 0.1, segs: 10 });
    }
  }
}
