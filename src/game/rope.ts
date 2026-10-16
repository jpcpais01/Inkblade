// Verlet rope for secondary motion: sash tails, hachimaki ribbons, hair.

import type { V2 } from '../util';

export class Rope {
  pts: V2[] = [];
  prev: V2[] = [];
  constructor(
    anchor: V2,
    public n: number,
    public seg: number,
    public drag = 0.985,
    public lift = 0.35,
  ) {
    for (let i = 0; i < n; i++) {
      this.pts.push({ x: anchor.x - i * seg * 0.7, y: anchor.y - i * seg * 0.7 });
      this.prev.push({ x: anchor.x - i * seg * 0.7, y: anchor.y - i * seg * 0.7 });
    }
  }

  update(anchor: V2, dt: number, wind: number, time: number) {
    const g = -9.8 * this.lift;
    const p = this.pts;
    const q = this.prev;
    p[0].x = anchor.x;
    p[0].y = anchor.y;
    for (let i = 1; i < this.n; i++) {
      const vx = (p[i].x - q[i].x) * this.drag;
      const vy = (p[i].y - q[i].y) * this.drag;
      q[i].x = p[i].x;
      q[i].y = p[i].y;
      const flutter = Math.sin(time * 9 + i * 1.7) * 0.6 + Math.sin(time * 5.3 + i) * 0.4;
      p[i].x += vx + (wind * (0.8 + 0.25 * flutter)) * dt * dt;
      p[i].y += vy + (g + wind * 0.15 * flutter) * dt * dt;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = p[i - 1];
        const b = p[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - this.seg) / d;
        if (i === 1) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
      p[0].x = anchor.x;
      p[0].y = anchor.y;
      for (let i = 1; i < this.n; i++) if (p[i].y < 0.01) p[i].y = 0.01;
    }
  }
}
