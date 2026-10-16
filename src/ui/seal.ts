// The hanko: a red seal with the character knocked out, eroded like a real stamp.

import { Texture } from 'pixi.js';
import { rng } from '../util';

export function sealCanvas(ch: string, size: number, seed = 5): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const pad = size * 0.07;
  const s = size - pad * 2;
  // a slightly irregular rounded square
  g.fillStyle = '#a5121b';
  g.beginPath();
  const pts: [number, number][] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const side = Math.floor(t * 4);
    const u = (t * 4) % 1;
    let x = 0;
    let y = 0;
    if (side === 0) [x, y] = [u, 0];
    else if (side === 1) [x, y] = [1, u];
    else if (side === 2) [x, y] = [1 - u, 1];
    else [x, y] = [0, 1 - u];
    const j = (r() - 0.5) * 0.018;
    pts.push([pad + x * s + j * s, pad + y * s + (r() - 0.5) * 0.018 * s]);
  }
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts) g.lineTo(x, y);
  g.closePath();
  g.fill();

  g.globalCompositeOperation = 'destination-out';
  // inner frame line
  g.lineWidth = size * 0.022;
  g.strokeStyle = '#000';
  g.strokeRect(pad + s * 0.075, pad + s * 0.075, s * 0.85, s * 0.85);
  g.font = `${Math.round(s * 0.74)}px "Yuji Syuku", "Hiragino Mincho ProN", "Noto Serif JP", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.fillText(ch, size / 2, size * 0.53);

  // stamp texture: uneven pressure, paper tooth, a few voids
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  const grid = 24;
  const cells: number[] = [];
  for (let i = 0; i < (grid + 1) * (grid + 1); i++) cells.push(r());
  const vn = (x: number, y: number) => {
    const gx = (x / size) * grid;
    const gy = (y / size) * grid;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const a = cells[iy * (grid + 1) + ix];
    const b = cells[iy * (grid + 1) + ix + 1];
    const cc = cells[(iy + 1) * (grid + 1) + ix];
    const dd = cells[(iy + 1) * (grid + 1) + ix + 1];
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (a + (b - a) * ux) * (1 - uy) + (cc + (dd - cc) * ux) * uy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4 + 3;
      if (d[i] === 0) continue;
      const pressure = vn(x, y);
      const tooth = Math.random();
      let a = 1;
      if (pressure < 0.22 && tooth < 0.7) a = 0.15;
      else if (tooth < 0.06) a = 0.35;
      a *= 0.86 + 0.14 * pressure;
      d[i] = Math.round(d[i] * a);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function makeSeal(ch: string, size: number): Texture {
  return Texture.from(sealCanvas(ch, size));
}
