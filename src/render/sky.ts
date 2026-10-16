// Atmosphere between the baked hills: drifting bands of paper-white mist that
// separate the ranges, and a far skein of birds crossing the sky.

import { fbm1 } from '../util';
import { INK, PAPER, type InkBatch } from './ink';

interface Band {
  y: number; // fraction of screen height
  x: number; // fraction of screen width
  len: number;
  thick: number;
  speed: number;
  alpha: number;
  seed: number;
}

export function mistBands(layer: number): Band[] {
  const out: Band[] = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const s = layer * 17 + i * 5.3;
    out.push({
      y: [0.47, 0.58, 0.69][layer] + fbm1(s) * 0.025,
      x: i / n + fbm1(s + 3) * 0.1,
      len: 0.32 + 0.2 * Math.abs(fbm1(s + 7)),
      thick: 0.018 + 0.012 * Math.abs(fbm1(s + 9)),
      speed: 0.004 + 0.003 * layer,
      alpha: 0.4 + 0.2 * Math.abs(fbm1(s + 11)),
      seed: s,
    });
  }
  return out;
}

export function paintMist(b: InkBatch, bands: Band[], W: number, H: number, time: number, wind: number, camX: number) {
  for (const m of bands) {
    let x = (m.x + time * m.speed * (0.6 + wind * 0.6) - camX) % 1.3;
    if (x < 0) x += 1.3;
    const cx = (x - 0.15) * W;
    const cy = m.y * H + Math.sin(time * 0.1 + m.seed) * H * 0.006;
    const r = m.thick * H;
    const breathe = 0.85 + 0.15 * Math.sin(time * 0.17 + m.seed * 2);
    b.blob({ x: cx, y: cy }, r, { color: PAPER, alpha: m.alpha * breathe, seed: m.seed, rough: 0.35, sx: (m.len * W) / r / 2, pool: 0, soft: 1, segs: 24 });
  }
}

interface Bird {
  ox: number;
  oy: number;
  phase: number;
  size: number;
}

export class Flock {
  private birds: Bird[] = [];
  private t0 = Math.random() * 60;
  constructor() {
    const lead = [0, 0];
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.ceil(i / 2);
      this.birds.push({ ox: lead[0] - k * 0.022 + Math.random() * 0.006, oy: lead[1] + side * k * 0.012 + Math.random() * 0.004, phase: Math.random() * 6, size: 0.8 + Math.random() * 0.4 });
    }
  }

  draw(b: InkBatch, W: number, H: number, time: number) {
    const T = time + this.t0;
    const period = 70;
    const u = (T % period) / period; // crosses the sky, then a long empty pause
    if (u > 0.6) return;
    const fx = 1.15 - (u / 0.6) * 1.35;
    const fy = 0.2 + 0.05 * Math.sin(u * 4) + 0.02 * fbm1(T * 0.1);
    const S = Math.min(W, H) * 0.011;
    for (const bd of this.birds) {
      const x = (fx - bd.ox) * W;
      const y = (fy + bd.oy) * H;
      const flap = Math.sin(T * 7 + bd.phase);
      const s = S * bd.size;
      const wy = -flap * s * 0.7;
      for (const side of [-1, 1]) {
        b.stroke(
          [
            { x, y },
            { x: x + side * s * 0.55, y: y + wy * 0.6 - s * 0.25 },
            { x: x + side * s * 1.1, y: y + wy + s * 0.15 },
          ],
          { width: s * 0.22, color: INK, alpha: 0.55, taperIn: 0.1, taperOut: 0.8, startW: 1, endW: 0.1, seed: bd.phase + side },
        );
      }
    }
  }
}
