// The duel: standoff, exchange, the killing blow and its aftermath.
// Runs the simulation at a fixed 120 Hz under a time scale for hit-stop and
// slow motion, resolves blade contact, and drives effects and sound.

import { clamp, fbm1, rand, type V2 } from '../util';
import { sound } from '../audio/audio';
import { Effects } from '../render/fx';
import { AI, PERSONALITIES } from './ai';
import { Fighter } from './fighter';
import type { MoveDef } from './moves';

export type Mode = 'duel' | 'watch';
export type Phase = 'title' | 'standoff' | 'fight' | 'kill' | 'over';

const STEP = 1 / 120;

function segClosest(p0: V2, p1: V2, q0: V2, q1: V2): { d: number; p: V2 } {
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const vx = q1.x - q0.x;
  const vy = q1.y - q0.y;
  const wx = p0.x - q0.x;
  const wy = p0.y - q0.y;
  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const D = a * c - b * b;
  let sN: number;
  let sD = D;
  let tN: number;
  let tD = D;
  if (D < 1e-8) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }
  if (tN < 0) {
    tN = 0;
    sN = clamp(-d, 0, a);
    sD = a;
  } else if (tN > tD) {
    tN = tD;
    sN = clamp(-d + b, 0, a);
    sD = a;
  }
  const sc = Math.abs(sN) < 1e-8 || sD < 1e-8 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-8 || tD < 1e-8 ? 0 : tN / tD;
  const px = p0.x + ux * sc;
  const py = p0.y + uy * sc;
  const qx = q0.x + vx * tc;
  const qy = q0.y + vy * tc;
  return { d: Math.hypot(px - qx, py - qy), p: { x: (px + qx) / 2, y: (py + qy) / 2 } };
}

export interface DuelHooks {
  /** Kill splash on the picture plane, at a world point. */
  killSplash(at: V2, dir: number): void;
  seal(winner: Fighter): void;
  over(winner: Fighter): void;
  unlock(): void;
}

interface Track {
  def: MoveDef | null;
  swished: boolean;
  tip: V2;
}

export class Duel {
  a!: Fighter;
  b!: Fighter;
  ais: AI[] = [];
  mode: Mode = 'duel';
  phase: Phase = 'title';
  phaseT = 0;
  simTime = 0;
  private acc = 0;
  hitStop = 0;
  timeScale = 1;
  wind = 0.6;
  shake = 0;
  punch = 0;
  punchAt: V2 = { x: 0, y: 1 };
  winner: Fighter | null = null;
  private tracks = new Map<Fighter, Track>();
  private sealed = false;
  private finished = false;
  private noto = false;
  readonly fx = new Effects();

  constructor(public hooks: DuelHooks) {
    Fighter.measureReach();
    this.setup('watch');
    this.phase = 'title';
  }

  get player(): Fighter | null {
    return this.mode === 'duel' ? this.a : null;
  }

  private setup(mode: Mode) {
    this.mode = mode;
    this.a = new Fighter(-2.1, 1, 'hachimaki', 1);
    this.b = new Fighter(2.1, -1, 'kasa', 2);
    for (const f of [this.a, this.b]) {
      f.events = {
        step: (_f, d) => sound.rustle(0.4 + d * 0.5),
        drawn: () => sound.rustle(0.8),
        sheathed: () => sound.click(),
      };
      this.tracks.set(f, { def: null, swished: false, tip: { ...f.sk.tip } });
    }
    this.ais = [];
    if (mode === 'watch') this.ais.push(new AI(this.a, this.b, PERSONALITIES.fierce));
    this.ais.push(new AI(this.b, this.a, mode === 'watch' ? PERSONALITIES.calm : PERSONALITIES.ronin));
    this.winner = null;
    this.sealed = false;
    this.finished = false;
    this.noto = false;
    this.timeScale = 1;
    this.hitStop = 0;
    this.fx.reset();
  }

  begin(mode: Mode) {
    this.setup(mode);
    this.phase = 'standoff';
    this.phaseT = 0;
    sound.fadeFlute(0.3);
    setTimeout(() => sound.shakuhachi(0.55), 350);
  }

  /** Advance by real seconds. */
  frame(dt: number) {
    dt = Math.min(dt, 0.1);
    this.phaseT += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.punch = Math.max(0, this.punch - dt * 0.9);
    this.phaseLogic(dt);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.acc += dt * this.timeScale;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  private phaseLogic(dt: number) {
    const t = this.phaseT;
    switch (this.phase) {
      case 'title':
        sound.setWind(0.6);
        break;
      case 'standoff':
        sound.setWind(1);
        if (t > 4.1) {
          this.phase = 'fight';
          this.phaseT = 0;
          this.a.locked = false;
          this.b.locked = false;
          sound.fadeFlute(1.5);
          sound.click();
          this.hooks.unlock();
        }
        break;
      case 'fight':
        sound.setWind(0.55);
        break;
      case 'kill': {
        // slow motion eases back to real time, then the breath, then the seal
        if (t > 0.4) this.timeScale = Math.min(1, this.timeScale + dt * 0.45);
        sound.setWind(t < 2.6 ? 0.15 : 0.8);
        if (t > 3.5 && !this.sealed) {
          this.sealed = true;
          sound.stamp();
          this.hooks.seal(this.winner!);
        }
        if (t > 4.6 && !this.noto) {
          this.noto = true;
          this.winner!.force('victory');
        }
        if (t > 7.0 && !this.finished) {
          this.finished = true;
          this.phase = 'over';
          this.hooks.over(this.winner!);
        }
        break;
      }
      case 'over':
        sound.setWind(0.6);
        break;
    }
  }

  private step(dt: number) {
    this.simTime += dt;
    const t = this.simTime;
    this.wind = 0.45 + 0.55 * fbm1(t * 0.18) + (this.phase === 'standoff' ? 0.5 : 0);
    if (this.phase === 'fight') for (const ai of this.ais) ai.update(dt);
    this.a.update(dt, this.wind);
    this.b.update(dt, this.wind);

    // fighters keep apart and face each other
    const minD = 0.95;
    const d = this.b.x - this.a.x;
    if (d < minD) {
      const push = (minD - d) / 2;
      this.a.x -= push;
      this.b.x += push;
      this.a.solve();
      this.b.solve();
    }
    for (const f of [this.a, this.b]) {
      if (f.x < -6.5) f.x = -6.5;
      if (f.x > 6.5) f.x = 6.5;
    }

    if (this.phase === 'fight') {
      this.resolve(this.a, this.b);
      if (this.phase === 'fight') this.resolve(this.b, this.a);
    }
    this.paintSlashes(dt);
    const view = { x0: (this.a.x + this.b.x) / 2 - 6, x1: (this.a.x + this.b.x) / 2 + 6, top: 4.5 };
    this.fx.update(dt, this.wind, t, view);
  }

  private paintSlashes(dt: number) {
    for (const f of [this.a, this.b]) {
      const tr = this.tracks.get(f)!;
      const a = f.action;
      const def = a?.def ?? null;
      if (def !== tr.def) {
        if (tr.def) this.fx.endSlash(f);
        tr.def = def;
        tr.swished = false;
        if (def?.attack?.paint) this.fx.beginSlash(f, def.attack.heavy);
      }
      const tip = f.sk.tip;
      const speed = Math.hypot(tip.x - tr.tip.x, tip.y - tr.tip.y) / dt;
      tr.tip.x = tip.x;
      tr.tip.y = tip.y;
      if (a && def?.active && def.attack?.paint) {
        const [s, e] = def.active;
        if (!tr.swished && a.t >= s - 0.05) {
          tr.swished = true;
          sound.swish(def.attack.heavy);
        }
        const ahead = (tip.x - f.sk.pelvis.x) * f.facing > 0.05;
        if (a.t >= s - 0.06 && a.t <= e + 0.09 && ahead) this.fx.addSlashPoint(f, tip, speed);
        else if (a.t > e + 0.09) this.fx.endSlash(f);
      }
    }
  }

  private resolve(att: Fighter, def: Fighter) {
    if (!att.striking || def.dead) return;
    const atk = att.action!.def.attack!;
    const [p0, p1] = att.blade();
    // blade meets blade
    if (def.striking) {
      const [q0, q1] = def.blade();
      const c = segClosest(p0, p1, q0, q1);
      if (c.d < 0.06) {
        att.markHit();
        def.markHit();
        att.force('recoil');
        def.force('recoil');
        this.rebound(att, 1.2);
        this.rebound(def, 1.2);
        this.clash(c.p, 1.2);
        return;
      }
    }
    let hit: { d: number; p: V2 } | null = null;
    for (const cap of def.hurtboxes()) {
      const c = segClosest(p0, p1, cap.a, cap.b);
      if (c.d < cap.r && (!hit || c.d < hit.d)) hit = c;
    }
    if (!hit) return;
    att.markHit();
    if (def.invulnerable) return;
    if (def.parrying) {
      att.force('stagger');
      def.force('riposte');
      this.rebound(att, 1.8);
      att.kick({ sp: -7, hd: -5, hy: -1.2 });
      def.kick({ sw: def.springs.sw.v * 0.2, sp: 2.5 });
      this.clash(hit.p, 1.4);
      this.hitStop = 0.14;
      this.fx.splash(hit.p, def.facing, 0.25, false);
      return;
    }
    if (def.guardLine === atk.line) {
      att.force('recoil');
      def.force('recoil');
      this.rebound(att, 1);
      def.kick({ gy: -2, sp: -3, hx: -1.2 });
      this.clash(hit.p, 1);
      return;
    }
    // a riposte into a staggered opponent is the one-cut kill; otherwise a cut
    // wounds, a counter-hit wounds deeper, and it takes two or three to finish
    const dmg = def.moveName === 'stagger' ? 3 : Math.min(2, atk.dmg + (def.exposed ? 1 : 0));
    def.hp = Math.max(0, def.hp - dmg);
    const dir = att.facing;
    if (def.hp <= 0) {
      this.kill(att, def, hit.p);
      return;
    }
    def.force('hit');
    // the cut lands in the body: a shove the animation could never key
    def.kick({ sp: -9, hd: -8, hy: -1.6, hx: -2.2 });
    att.kick({ gy: -1.2, sp: 1.5 });
    this.fx.bloodSlash(att);
    this.hitStop = 0.11;
    this.shake = 0.5;
    this.fx.splash(hit.p, dir, 0.6, true);
    sound.cut(atk.heavy);
    sound.taiko(0.6);
  }

  /** Steel on steel: the blade bounces back along the way it came. */
  private rebound(f: Fighter, power: number) {
    const v = f.springs.sw.v;
    f.kick({ sw: -v * 0.55 * power - Math.sign(v || 1) * 2, gx: -2 * power, sp: -2.5 * power, hd: -2 });
  }

  private clash(at: V2, power: number) {
    this.hitStop = Math.max(this.hitStop, 0.075 * power);
    this.shake = Math.max(this.shake, 0.35 * power);
    this.fx.clash(at);
    sound.taiko(0.8 * power);
    sound.steel(power);
  }

  private kill(att: Fighter, def: Fighter, at: V2) {
    this.winner = att;
    this.phase = 'kill';
    this.phaseT = 0;
    att.locked = true;
    def.locked = true;
    def.dead = true;
    def.force('death');
    def.kick({ sp: -12, hd: -14, hy: -2 });
    att.kick({ sw: att.springs.sw.v * 0.35, sp: 2 });
    this.fx.bloodSlash(att);
    this.hitStop = 0.38;
    this.timeScale = 0.18;
    this.shake = 1;
    this.punch = 1;
    this.punchAt = { x: at.x, y: at.y };
    this.fx.splash(at, att.facing, 1.6, true);
    this.fx.splash({ x: at.x, y: at.y + 0.1 }, att.facing, 1.0, false);
    this.hooks.killSplash(at, att.facing);
    sound.kill();
    sound.setWind(0.1);
    void rand;
  }
}
