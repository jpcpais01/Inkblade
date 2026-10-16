// Small math + noise helpers shared by the simulation and the brush renderer.

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const inv = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);

export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): V2 => ({ x, y });

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

function hash1(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}

/** Two octaves of 1D noise in roughly [-1, 1]. */
export function fbm1(x: number) {
  return noise1(x) * 0.66 + noise1(x * 2.13 + 19.7) * 0.34;
}

// ---- Easing ---------------------------------------------------------------

export type Ease = 'lin' | 'in' | 'out' | 'io' | 'snap' | 'back' | 'outBack' | 'expo';

export function ease(kind: Ease, t: number): number {
  t = clamp(t, 0, 1);
  switch (kind) {
    case 'lin':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'io':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'snap': // explosive release: the cut itself
      return 1 - Math.pow(1 - t, 5);
    case 'expo':
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'back': {
      const c = 1.4;
      return t * t * ((c + 1) * t - c);
    }
    case 'outBack': {
      const c = 1.5;
      const u = t - 1;
      return 1 + u * u * ((c + 1) * u + c);
    }
  }
}

/** Critically-ish damped second order spring, integrated semi-implicitly. */
export class Spring {
  v = 0;
  constructor(
    public x: number,
    public omega = 20,
    public zeta = 0.8,
  ) {}
  step(target: number, dt: number) {
    const w = this.omega;
    const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  snap(x: number) {
    this.x = x;
    this.v = 0;
  }
}
