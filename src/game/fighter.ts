// A duellist: a pose-space state machine driven by the move book, chased by
// springs, solved into a skeleton with two-bone IK, and painted as brush strokes.

import { clamp, ease, lerp, noise1, Spring, type V2 } from '../util';
import { PAPER, RED, type InkBatch } from '../render/ink';
import {
  ATTACK_FOR,
  MOVES,
  POSE_KEYS,
  samplePose,
  SHEATHED_SW,
  STANCE_POSE,
  type Key,
  type Line,
  type MoveDef,
  type MoveName,
  type Pose,
  type Stance,
} from './moves';
import { Rope } from './rope';

export type Cmd = 'stepF' | 'stepB' | 'dash' | 'dodge' | 'up' | 'down' | 'strike' | 'parry' | 'feint' | 'sheathe';

export type Look = 'hachimaki' | 'kasa';

interface Action {
  def: MoveDef;
  t: number;
  keys: Key[];
  x0: number;
  hitDone: boolean;
  speed: number;
  /** For feints: the attack being impersonated. */
  shows?: MoveName;
}

export interface Capsule {
  a: V2;
  b: V2;
  r: number;
}

export interface Skeleton {
  pelvis: V2;
  neck: V2;
  head: V2;
  shF: V2;
  shB: V2;
  elbF: V2;
  elbB: V2;
  handF: V2;
  handB: V2;
  hipF: V2;
  hipB: V2;
  kneeF: V2;
  kneeB: V2;
  ankF: V2;
  ankB: V2;
  grip: V2;
  dir: V2; // blade direction (unit, in-plane) * foreshortening
  tsuba: V2;
  tip: V2;
  pommel: V2;
  sayaMouth: V2;
  sayaEnd: V2;
}

const SPRING_CFG: Record<keyof Pose, [number, number]> = {
  hx: [15, 0.8],
  hy: [17, 0.75],
  sp: [15, 0.72],
  hd: [12, 0.7],
  gx: [30, 0.74],
  gy: [30, 0.74],
  sw: [34, 0.6],
  sf: [38, 0.82],
  ff: [24, 0.9],
  bf: [24, 0.9],
  fl: [30, 0.9],
  bl: [30, 0.9],
};

const NEXT_UP: Record<Stance, Stance> = { low: 'mid', mid: 'high', high: 'high' };
const NEXT_DOWN: Record<Stance, Stance> = { high: 'mid', mid: 'low', low: 'low' };

const BLADE = 0.74;
const TSUKA = 0.24;

const v = (x = 0, y = 0): V2 => ({ x, y });

function ik(root: V2, target: V2, l1: number, l2: number, bend: number, mid: V2, end: V2) {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let d = Math.hypot(dx, dy) || 1e-6;
  const maxD = (l1 + l2) * 0.999;
  const minD = Math.abs(l1 - l2) + 0.02;
  const dd = clamp(d, minD, maxD);
  dx = (dx / d) * dd;
  dy = (dy / d) * dd;
  d = dd;
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dy, dx);
  const ang = base + a * bend;
  mid.x = root.x + Math.cos(ang) * l1;
  mid.y = root.y + Math.sin(ang) * l1;
  end.x = root.x + dx;
  end.y = root.y + dy;
}

export interface FighterEvents {
  swing?(f: Fighter, heavy: boolean): void;
  step?(f: Fighter, strength: number): void;
  sheathed?(f: Fighter): void;
  drawn?(f: Fighter): void;
}

export class Fighter {
  hp = 3;
  stance: Stance = 'mid';
  sheathed = true;
  action: Action | null = null;
  locked = true;
  dead = false;
  /** Seconds since this fighter last whiffed / got parried etc. (for AI). */
  time = 0;
  readonly springs: Record<keyof Pose, Spring>;
  readonly target: Pose = { ...STANCE_POSE.sheathed };
  readonly pose: Pose = { ...STANCE_POSE.sheathed };
  readonly sk: Skeleton;
  footF = 0;
  footB = 0;
  liftF = 0;
  liftB = 0;
  private buffered: { cmd: Cmd; at: number } | null = null;
  ropes: Rope[] = [];
  sashRope: Rope;
  /** Sword knocked loose on death. */
  dropped: { x: number; y: number; a: number; vx: number; vy: number; w: number; rest: boolean } | null = null;
  /** Arm velocity memory for sleeve swing. */
  private sleeveLag = v();
  private lastHand = v();
  events: FighterEvents = {};
  /** Recent blade positions (tip and lower blade). */
  trail: { x: number; y: number; mx: number; my: number }[] = [];
  private lastX = 0;
  /** Hakama hem lag from body motion and wind (facing-relative). */
  private hemLag = 0;
  name: string;

  constructor(
    public x: number,
    public facing: 1 | -1,
    public look: Look,
    public seed: number,
  ) {
    this.name = look === 'hachimaki' ? 'Akane' : 'Kurō';
    const s = {} as Record<keyof Pose, Spring>;
    for (const k of POSE_KEYS) s[k] = new Spring(this.pose[k], SPRING_CFG[k][0], SPRING_CFG[k][1]);
    this.springs = s;
    this.sk = {
      pelvis: v(),
      neck: v(),
      head: v(),
      shF: v(),
      shB: v(),
      elbF: v(),
      elbB: v(),
      handF: v(),
      handB: v(),
      hipF: v(),
      hipB: v(),
      kneeF: v(),
      kneeB: v(),
      ankF: v(),
      ankB: v(),
      grip: v(),
      dir: v(1, 0),
      tsuba: v(),
      tip: v(),
      pommel: v(),
      sayaMouth: v(),
      sayaEnd: v(),
    };
    this.solve();
    const back = { x: this.sk.pelvis.x - facing * 0.12, y: this.sk.pelvis.y + 0.04 };
    this.sashRope = new Rope(back, 6, 0.065, 0.97, 0.3);
    if (look === 'hachimaki') {
      this.ropes.push(new Rope(this.sk.head, 7, 0.06, 0.975, 0.18));
      this.ropes.push(new Rope(this.sk.head, 6, 0.055, 0.975, 0.22));
    } else {
      this.ropes.push(new Rope(this.sk.head, 5, 0.05, 0.96, 0.6));
    }
    this.solve();
  }

  // ---------------------------------------------------------------- queries

  get busy() {
    return this.action !== null;
  }

  get moveName(): MoveName | null {
    return this.action?.def.name ?? null;
  }

  /** The stance the body is in for guarding / attack choice. */
  get guardLine(): Line | null {
    if (this.sheathed || this.dead) return null;
    const a = this.action;
    if (!a || a.def.guard) return this.stance;
    return null;
  }

  get parrying() {
    const a = this.action;
    return !!(a && a.def.parry && a.t >= a.def.parry[0] && a.t <= a.def.parry[1]);
  }

  get invulnerable() {
    const a = this.action;
    return !!(a && a.def.iframes && a.t >= a.def.iframes[0] && a.t <= a.def.iframes[1]);
  }

  /** Inside an attack's live frames. */
  get striking() {
    const a = this.action;
    return !!(a && a.def.active && !a.hitDone && a.t >= a.def.active[0] && a.t <= a.def.active[1]);
  }

  /** True while winding up or recovering from an attack (counter-hit window). */
  get exposed() {
    const a = this.action;
    if (!a) return false;
    if (a.def.name === 'stagger' || a.def.name === 'noto' || a.def.name === 'draw') return true;
    if (a.def.parry && a.t > a.def.parry[1]) return true;
    if (a.def.feint) return a.t > 0.2;
    return !!(a.def.active && (a.t < a.def.active[0] || a.t > a.def.active[1]));
  }

  /** What an observer sees: an attack winding up (feints look identical). */
  threat(): { move: MoveName; t: number } | null {
    const a = this.action;
    if (!a) return null;
    if (a.shows && a.t < 0.2) return { move: a.shows, t: a.t };
    if (a.def.active && a.t < a.def.active[1]) return { move: a.def.name, t: a.t };
    return null;
  }

  /** Recovering from a committed action: a punish window. */
  get recovering() {
    const a = this.action;
    if (!a) return false;
    const n = a.def.name;
    if (n === 'stagger' || n === 'hit') return true;
    if (a.def.active) return a.t > a.def.active[1] + 0.05;
    if (a.def.parry) return a.t > a.def.parry[1] + 0.03;
    if (n === 'noto' || n === 'draw') return true;
    return false;
  }

  get canAct() {
    if (this.locked || this.dead) return false;
    const a = this.action;
    if (!a) return true;
    return a.def.cancel !== undefined && a.t >= a.def.cancel * a.def.dur;
  }

  // ---------------------------------------------------------------- control

  command(cmd: Cmd) {
    this.buffered = { cmd, at: this.time };
  }

  private tryCommand(cmd: Cmd): boolean {
    const s = this.sheathed;
    switch (cmd) {
      case 'stepF':
        return this.start('stepF');
      case 'stepB':
        return this.start('stepB');
      case 'dash':
        return this.start('dash');
      case 'dodge':
        return this.start('dodge');
      case 'up':
      case 'down': {
        if (s) {
          this.stance = cmd === 'up' ? 'mid' : 'low';
          return this.start('draw');
        }
        const next = cmd === 'up' ? NEXT_UP[this.stance] : NEXT_DOWN[this.stance];
        if (next === this.stance) return true;
        this.stance = next;
        return this.start('stance');
      }
      case 'strike':
        return this.start(s ? 'iaido' : ATTACK_FOR[this.stance]);
      case 'parry':
        if (s) return false;
        return this.start('parry');
      case 'feint':
        return this.start('feint');
      case 'sheathe':
        if (s) return true;
        return this.start('noto');
    }
  }

  stancePose(): Pose {
    return this.sheathed ? STANCE_POSE.sheathed : STANCE_POSE[this.stance];
  }

  /** Force a move regardless of state (hit reactions, scripted beats). */
  force(name: MoveName) {
    this.buffered = null;
    this.start(name, true);
  }

  private start(name: MoveName, forced = false): boolean {
    if (!forced && !this.canAct) return false;
    const def = MOVES[name];
    let keys = def.keys(this.stancePose());
    let shows: MoveName | undefined;
    if (name === 'feint') {
      shows = this.sheathed ? 'iaido' : ATTACK_FOR[this.stance];
      const ak = MOVES[shows].keys(this.stancePose());
      const wind = ak[1].p;
      const s = this.stancePose();
      const half: Pose = { ...s };
      for (const k of POSE_KEYS) half[k] = lerp(s[k], wind[k], 0.75);
      keys = [
        { t: 0, p: s, e: 'io' },
        { t: 0.16, p: half, e: 'out' },
        { t: 0.44, p: s, e: 'io' },
      ];
    }
    // keep the sword spring on the same winding as the move's first key
    const sw = this.springs.sw;
    const turns = Math.round((keys[0].p.sw - sw.x) / (Math.PI * 2));
    sw.x += turns * Math.PI * 2;
    let speed = 1;
    if (def.attack) {
      const home = def.attack.home;
      const here = this.sheathed ? 'sheathed' : this.stance;
      if (home === here) speed = 1.3;
    }
    this.action = { def, t: 0, keys, x0: this.x, hitDone: false, speed, shows };
    if (def.attack && def.attack.paint) this.events.swing?.(this, def.attack.heavy);
    if (def.travel) this.events.step?.(this, Math.abs(def.travel.d));
    if (name === 'draw' || name === 'iaido') {
      this.sheathed = false;
      this.events.drawn?.(this);
    }
    return true;
  }

  private finish() {
    const a = this.action!;
    if (a.def.sheathe) {
      this.sheathed = true;
      this.stance = 'mid';
      this.events.sheathed?.(this);
    }
    this.action = null;
    // unwind flipped / multi-turn sword representations without a visual change
    const sw = this.springs.sw;
    const sf = this.springs.sf;
    if (sf.x < 0) {
      sw.x -= Math.PI;
      sf.x = -sf.x;
      sf.v = -sf.v;
    }
    const target = this.stancePose().sw;
    sw.x += Math.round((target - sw.x) / (Math.PI * 2)) * Math.PI * 2;
  }

  // ---------------------------------------------------------------- update

  update(dt: number, wind: number) {
    this.time += dt;
    // buffered input survives a short while so mashing feels responsive
    if (this.buffered) {
      if (this.time - this.buffered.at > 0.22) this.buffered = null;
      else if (this.canAct) {
        const cmd = this.buffered.cmd;
        this.buffered = null;
        this.tryCommand(cmd);
      }
    }

    const a = this.action;
    let travelF = 0;
    let travelB = 0;
    this.liftF = 0;
    this.liftB = 0;
    if (a) {
      const before = a.def.active ? a.def.active[0] : 0;
      a.t += dt * (a.t < before ? a.speed : 1);
      samplePose(a.keys, a.t, this.target);
      const tr = a.def.travel;
      if (tr) {
        const raw = (a.t - tr.t0) / (tr.t1 - tr.t0);
        const pb = ease(tr.e, raw);
        const pLead = ease(tr.e, raw * 1.3);
        const pLag = ease(tr.e, (raw - 0.28) / 0.72);
        this.x = a.x0 + tr.d * this.facing * pb;
        const fwd = tr.d > 0;
        const pf = fwd ? pLead : pLag;
        const pbk = fwd ? pLag : pLead;
        travelF = tr.d * (pf - pb);
        travelB = tr.d * (pbk - pb);
        const hump = (r: number) => (r > 0 && r < 1 ? Math.sin(Math.PI * r) : 0);
        this.liftF = tr.lift * hump(fwd ? raw * 1.3 : (raw - 0.28) / 0.72);
        this.liftB = tr.lift * hump(fwd ? (raw - 0.28) / 0.72 : raw * 1.3);
      }
      if (a.t >= a.def.dur) {
        if (a.def.name === 'death') a.t = a.def.dur; // stays down
        else this.finish();
      }
    } else {
      Object.assign(this.target, this.stancePose());
    }

    // breathing and the restless tip of the sword (seme)
    const t = this.time;
    if (!this.dead) {
      // a living body never quite stops: breath, a slow shift of weight
      // between the feet, the head settling, the sword tip searching (seme)
      const calm = this.action ? 0.35 : 1;
      const b = Math.sin(t * 1.55 + this.seed);
      const shift = noise1(t * 0.32 + this.seed * 3);
      this.target.hy += 0.01 * b - 0.014 * Math.abs(shift) * calm;
      this.target.sp += 0.018 * Math.sin(t * 1.55 + this.seed + 0.7) + 0.025 * shift * calm;
      this.target.hx += 0.04 * shift * calm;
      this.target.gy += 0.009 * b;
      this.target.hd += 0.035 * noise1(t * 0.45 + this.seed * 7) * calm - 0.02 * b;
      if (!this.action) {
        this.target.sw += 0.04 * noise1(t * 0.6 + this.seed * 10);
        this.target.gx += 0.018 * noise1(t * 0.8 + this.seed * 5);
        // now and then the hands re-settle on the hilt
        if (!this.sheathed && Math.random() < dt * 0.35) this.kick({ sw: (Math.random() - 0.5) * 2.4, gy: 0.25, hy: -0.15 });
      }
    }

    const striking = this.striking;
    for (const k of POSE_KEYS) {
      const sp = this.springs[k];
      const boost = striking && (k === 'gx' || k === 'gy' || k === 'sw' || k === 'sf') ? 1.7 : 1;
      sp.omega = SPRING_CFG[k][0] * boost;
      this.pose[k] = sp.step(this.target[k], dt);
    }
    this.footF = this.x + (this.pose.ff + travelF) * this.facing;
    this.footB = this.x + (this.pose.bf + travelB) * this.facing;
    this.liftF += Math.max(0, this.pose.fl);
    this.liftB += Math.max(0, this.pose.bl);

    this.solve();

    // remember where the blade has been, for the motion smear
    const tr = this.trail;
    const sk0 = this.sk;
    tr.push({ x: sk0.tip.x, y: sk0.tip.y, mx: lerp(sk0.tsuba.x, sk0.tip.x, 0.3), my: lerp(sk0.tsuba.y, sk0.tip.y, 0.3) });
    if (tr.length > 9) tr.shift();
    const bodyV = (this.x - this.lastX) / Math.max(dt, 1e-4);
    this.lastX = this.x;
    const kk = 1 - Math.exp(-dt * 6);
    this.hemLag += (clamp(-bodyV * this.facing * 0.06 - wind * this.facing * 0.025, -0.12, 0.12) - this.hemLag) * kk;

    // death drops the sword
    if (a && a.def.name === 'death' && a.t > 0.3 && !this.dropped) {
      const sk = this.sk;
      this.dropped = {
        x: sk.grip.x,
        y: sk.grip.y,
        a: Math.atan2(sk.dir.y, sk.dir.x),
        vx: this.facing * 0.4,
        vy: 0.6,
        w: -this.facing * 5,
        rest: false,
      };
    }
    const d = this.dropped;
    if (d && !d.rest) {
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.w * dt;
      const low = Math.min(d.y + Math.sin(d.a) * BLADE, d.y - Math.sin(d.a) * TSUKA);
      if (low < 0.02) {
        d.y += 0.02 - low;
        d.vy = Math.abs(d.vy) * 0.25;
        d.vx *= 0.5;
        d.w *= 0.4;
        const flat = Math.round(d.a / Math.PI) * Math.PI;
        d.a = lerp(d.a, flat, 0.3);
        if (Math.abs(d.vy) < 0.3) {
          d.rest = true;
          d.a = flat + 0.04;
          d.y = 0.03;
        }
      }
    }

    // secondary motion
    const sk = this.sk;
    const f = this.facing;
    const sashAnchor = { x: sk.pelvis.x - f * 0.13, y: sk.pelvis.y + 0.05 };
    this.sashRope.update(sashAnchor, dt, wind, t);
    if (this.look === 'hachimaki') {
      const back = { x: sk.head.x - f * 0.085, y: sk.head.y + 0.02 };
      this.ropes[0].update(back, dt, wind * 1.3, t + 1);
      this.ropes[1].update({ x: back.x, y: back.y - 0.02 }, dt, wind * 1.1, t + 2.5);
    } else {
      const back = { x: sk.head.x - f * 0.06, y: sk.head.y + 0.07 };
      this.ropes[0].update(back, dt, wind * 0.8, t + 1);
    }
    const hand = sk.handF;
    const vx = (hand.x - this.lastHand.x) / Math.max(dt, 1e-4);
    const vy = (hand.y - this.lastHand.y) / Math.max(dt, 1e-4);
    this.lastHand.x = hand.x;
    this.lastHand.y = hand.y;
    const k = 1 - Math.exp(-dt * 10);
    this.sleeveLag.x += (clamp(-vx * 0.03 + wind * 0.01, -0.12, 0.12) - this.sleeveLag.x) * k;
    this.sleeveLag.y += (clamp(-vy * 0.02, -0.08, 0.08) - this.sleeveLag.y) * k;
  }

  /** Pose -> world skeleton. */
  solve() {
    const p = this.pose;
    const f = this.facing;
    const sk = this.sk;
    sk.pelvis.x = this.x + p.hx * f;
    sk.pelvis.y = p.hy;
    const sx = Math.sin(p.sp) * f;
    const sy = Math.cos(p.sp);
    sk.neck.x = sk.pelvis.x + sx * 0.5;
    sk.neck.y = sk.pelvis.y + sy * 0.5;
    const ha = p.sp + p.hd;
    sk.head.x = sk.neck.x + Math.sin(ha) * f * 0.13;
    sk.head.y = sk.neck.y + Math.cos(ha) * 0.13;
    // shoulders sit a little below the neck, front one toward the viewer
    const nx = sy * f; // spine normal (toward facing)
    const ny = -sx * f;
    sk.shF.x = sk.neck.x - sx * 0.06 + nx * 0.03;
    sk.shF.y = sk.neck.y - sy * 0.06 + ny * 0.03;
    sk.shB.x = sk.neck.x - sx * 0.065 - nx * 0.035;
    sk.shB.y = sk.neck.y - sy * 0.065 - ny * 0.035;

    // grip, kept within the arms' reach
    let gx = sk.pelvis.x + p.gx * f;
    let gy = sk.pelvis.y + p.gy;
    const reach = 0.56;
    const dx = gx - sk.shF.x;
    const dy = gy - sk.shF.y;
    const dl = Math.hypot(dx, dy);
    if (dl > reach) {
      gx = sk.shF.x + (dx / dl) * reach;
      gy = sk.shF.y + (dy / dl) * reach;
    }
    sk.grip.x = gx;
    sk.grip.y = gy;

    const ca = Math.cos(p.sw) * f;
    const sa = Math.sin(p.sw);
    const fs = p.sf;
    sk.dir.x = ca * fs;
    sk.dir.y = sa * fs;
    sk.tsuba.x = gx + ca * 0.07 * fs;
    sk.tsuba.y = gy + sa * 0.07 * fs;
    sk.tip.x = gx + ca * (0.07 + BLADE) * fs;
    sk.tip.y = gy + sa * (0.07 + BLADE) * fs;
    sk.pommel.x = gx - ca * (TSUKA - 0.07) * fs;
    sk.pommel.y = gy - sa * (TSUKA - 0.07) * fs;

    // saya hangs from the obi on the far hip, mouth forward
    const sa0 = SHEATHED_SW;
    const mx = sk.pelvis.x + 0.13 * f - sx * 0.02;
    const my = sk.pelvis.y - 0.02;
    sk.sayaMouth.x = mx;
    sk.sayaMouth.y = my;
    sk.sayaEnd.x = mx + Math.cos(sa0) * f * 0.78;
    sk.sayaEnd.y = my + Math.sin(sa0) * 0.78;

    // hands on the tsuka (or the left on the saya while sheathed)
    const hF = { x: gx + ca * 0.02 * fs, y: gy + sa * 0.02 * fs };
    let hB: V2;
    if (this.dropped) {
      hB = { x: gx - 0.05 * f, y: gy - 0.03 };
      hF.x = gx + 0.03 * f;
      hF.y = gy - 0.05;
    } else if (this.sheathed && !(this.action && this.action.def.draw)) {
      hB = { x: mx - 0.02 * f, y: my + 0.01 };
    } else {
      hB = { x: gx - ca * 0.13 * fs, y: gy - sa * 0.13 * fs };
    }
    ik(sk.shF, hF, 0.29, 0.27, -f, sk.elbF, sk.handF);
    ik(sk.shB, hB, 0.29, 0.27, -f, sk.elbB, sk.handB);

    // legs
    sk.hipF.x = sk.pelvis.x + 0.035 * f;
    sk.hipF.y = sk.pelvis.y - 0.02;
    sk.hipB.x = sk.pelvis.x - 0.035 * f;
    sk.hipB.y = sk.pelvis.y - 0.02;
    ik(sk.hipF, { x: this.footF, y: 0.075 + this.liftF }, 0.45, 0.45, f, sk.kneeF, sk.ankF);
    ik(sk.hipB, { x: this.footB, y: 0.075 + this.liftB }, 0.45, 0.45, f, sk.kneeB, sk.ankB);
  }

  /** Live blade segment while striking. */
  blade(): [V2, V2] {
    const sk = this.sk;
    return [
      { x: lerp(sk.tsuba.x, sk.tip.x, 0.25), y: lerp(sk.tsuba.y, sk.tip.y, 0.25) },
      { x: sk.tip.x, y: sk.tip.y },
    ];
  }

  hurtboxes(): Capsule[] {
    const sk = this.sk;
    return [
      { a: sk.pelvis, b: sk.neck, r: 0.16 },
      { a: sk.head, b: sk.head, r: 0.13 },
      { a: sk.hipF, b: sk.kneeF, r: 0.13 },
      { a: sk.kneeF, b: sk.ankF, r: 0.12 },
      { a: sk.hipB, b: sk.kneeB, r: 0.12 },
      { a: sk.kneeB, b: sk.ankB, r: 0.11 },
      { a: sk.shF, b: sk.elbF, r: 0.07 },
    ];
  }

  /** Physical impulse layered over the animation: a shove into the springs. */
  kick(k: Partial<Pose>) {
    for (const key of Object.keys(k) as (keyof Pose)[]) this.springs[key].v += k[key]!;
  }

  markHit() {
    if (this.action) this.action.hitDone = true;
  }

  /** Reach of each attack (fighter x -> blade tip), measured once from the move book. */
  static reach: Partial<Record<MoveName, number>> = {};

  static measureReach() {
    const dummy = new Fighter(0, 1, 'kasa', 0);
    for (const name of ['overhead', 'thrust', 'sweep', 'iaido'] as MoveName[]) {
      const def = MOVES[name];
      const keys = def.keys(name === 'iaido' ? STANCE_POSE.sheathed : STANCE_POSE[def.attack!.home as Stance]);
      let best = 0;
      for (let t = def.active![0]; t <= def.active![1]; t += 0.01) {
        samplePose(keys, t, dummy.pose);
        const tr = def.travel!;
        dummy.x = tr.d * ease(tr.e, (t - tr.t0) / (tr.t1 - tr.t0));
        dummy.footF = dummy.x + dummy.pose.ff;
        dummy.footB = dummy.x + dummy.pose.bf;
        dummy.solve();
        best = Math.max(best, dummy.sk.tip.x);
      }
      Fighter.reach[name] = best;
    }
  }

  // ---------------------------------------------------------------- painting

  draw(b: InkBatch, time: number) {
    const sk = this.sk;
    const f = this.facing;
    const s = this.seed * 17;
    const kasa = this.look === 'kasa';
    // two different costumes: dark gi / pale hakama, and the reverse
    const giA = kasa ? 0.3 : 0.86;
    const hakA = kasa ? 0.82 : 0.4;
    const lw = 1;

    const sword = !this.dropped;
    const swordBehind = sword && this.pose.sf < -0.15 && this.action?.def.name !== 'iaido' && this.action?.def.name !== 'sweep';

    // sash tails trail behind everything
    b.stroke(this.sashRope.pts, { width: 0.05, alpha: 0.9, taperIn: 0.05, taperOut: 0.7, startW: 0.9, endW: 0.15, dry1: 0.7, seed: s + 1, time });

    // back arm + sleeve
    this.drawArm(b, sk.shB, sk.elbB, sk.handB, giA * 0.7, s + 3, time, true);

    // back leg hakama panel
    this.drawLeg(b, sk.hipB, sk.kneeB, sk.ankB, hakA * 0.78, s + 5, time, true);

    // saya (scabbard) on the far hip
    if (!this.dead || this.action?.t! < 0.3) this.drawSaya(b, time, s);
    if (swordBehind) this.drawSword(b, time, s);

    // torso
    this.drawTorso(b, giA, s + 7, time);

    // front leg
    this.drawLeg(b, sk.hipF, sk.kneeF, sk.ankF, hakA, s + 9, time, false);

    // hakama waist band / koshi-ita
    const P = sk.pelvis;
    b.stroke(
      [
        { x: P.x - f * 0.14, y: P.y + 0.06 },
        { x: P.x + f * 0.13, y: P.y + 0.03 },
      ],
      { width: 0.075 * lw, alpha: 0.95, taperIn: 0.1, taperOut: 0.3, startW: 0.7, endW: 0.5, dry1: 0.35, seed: s + 11, time },
    );

    this.drawHead(b, time, s);

    if (sword) this.drawSmear(b);
    if (sword && !swordBehind) this.drawSword(b, time, s);
    if (this.dropped) this.drawDropped(b, time, s);

    // front arm + sleeve over the hilt
    this.drawArm(b, sk.shF, sk.elbF, sk.handF, giA, s + 13, time, false);
  }

  private drawTorso(b: InkBatch, alpha: number, s: number, time: number) {
    const sk = this.sk;
    const f = this.facing;
    const P = sk.pelvis;
    const N = sk.neck;
    const ux = N.x - P.x;
    const uy = N.y - P.y;
    const L = Math.hypot(ux, uy);
    const tx = ux / L;
    const ty = uy / L;
    const nx = ty * f; // toward the front
    const ny = -tx * f;
    const front: V2[] = [];
    const back: V2[] = [];
    const widths = [
      [0.12, 0.15],
      [0.115, 0.15],
      [0.12, 0.155],
      [0.12, 0.14],
      [0.09, 0.1],
    ];
    for (let i = 0; i < widths.length; i++) {
      const u = i / (widths.length - 1);
      const cx = P.x + ux * u;
      const cy = P.y + uy * u;
      const breathe = 1 + 0.03 * Math.sin(time * 1.7 + this.seed);
      front.push({ x: cx + nx * widths[i][0] * breathe, y: cy + ny * widths[i][0] * breathe });
      back.push({ x: cx - nx * widths[i][1], y: cy - ny * widths[i][1] });
    }
    b.ribbon(back, front, { alpha: alpha * 0.85, seed: s, pool: 0.65 });
    // the back line is the gesture of the whole figure: one confident stroke
    b.stroke([back[0], back[1], back[2], back[3], { x: N.x - nx * 0.04, y: N.y - ny * 0.04 }], {
      width: 0.055,
      alpha: 0.95,
      taperIn: 0.15,
      taperOut: 0.4,
      startW: 0.5,
      endW: 0.25,
      dry0: 0.05,
      dry1: 0.6,
      seed: s + 1,
      time,
    });
    b.stroke([front[0], front[1], front[2], front[3]], {
      width: 0.03,
      alpha: 0.9,
      taperIn: 0.2,
      taperOut: 0.5,
      startW: 0.3,
      endW: 0.2,
      dry1: 0.7,
      seed: s + 2,
      time,
    });
    // collar: the crossed lapels of the gi
    b.stroke(
      [
        { x: N.x - nx * 0.06 + tx * 0.01, y: N.y - ny * 0.06 + ty * 0.01 },
        { x: N.x + nx * 0.04 - tx * 0.12, y: N.y + ny * 0.04 - ty * 0.12 },
        { x: N.x + nx * 0.11 - tx * 0.22, y: N.y + ny * 0.11 - ty * 0.22 },
      ],
      { width: 0.028, alpha: 0.95, taperIn: 0.1, taperOut: 0.6, startW: 0.6, endW: 0.1, dry1: 0.5, seed: s + 3, time },
    );
  }

  private drawLeg(b: InkBatch, hip: V2, knee: V2, ank: V2, alpha: number, s: number, time: number, back: boolean) {
    const f = this.facing;
    // hakama: a wide pleated panel that flares toward the hem
    const pts = [hip, { x: lerp(hip.x, knee.x, 0.5), y: lerp(hip.y, knee.y, 0.5) }, knee, { x: lerp(knee.x, ank.x, 0.55), y: lerp(knee.y, ank.y, 0.55) }, { x: ank.x, y: ank.y - 0.035 }];
    const half = [0.12, 0.13, 0.145, 0.165, 0.19];
    const L: V2[] = [];
    const R: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      let tx = c.x - a.x;
      let ty = c.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      let nx = -ty;
      let ny = tx;
      if (nx * f < 0) {
        nx = -nx;
        ny = -ny;
      }
      const flutter = 1 + 0.06 * noise1(time * 1.3 + s + i * 0.7) * (i / pts.length);
      const h = half[i] * flutter;
      // the hem flares back more than forward
      L.push({ x: pts[i].x + nx * h * 0.85, y: pts[i].y + ny * h * 0.85 });
      R.push({ x: pts[i].x - nx * h * 1.1, y: pts[i].y - ny * h * 1.1 });
    }
    // the hem trails motion and wind
    for (let i = 2; i < L.length; i++) {
      const w = ((i - 1) / (L.length - 1)) ** 2 * this.hemLag * f;
      L[i].x += w;
      R[i].x += w * 1.3;
    }
    // keep the hem off the ground
    for (const p of [...L, ...R]) p.y = Math.max(p.y, 0.05);
    b.ribbon(L, R, { alpha, seed: s, pool: 0.8, alphas: [1, 1, 0.92, 0.8, 0.55] });
    // the hem: a short dry stroke across the bottom
    const hl = L[L.length - 1];
    const hr = R[R.length - 1];
    b.stroke([hl, { x: (hl.x + hr.x) / 2, y: Math.max(0.05, ank.y - 0.05) }, hr], { width: 0.03, alpha: 0.75, taperIn: 0.3, taperOut: 0.5, startW: 0.3, endW: 0.2, dry0: 0.3, dry1: 0.8, seed: s + 6, time });
    b.stroke(L, { width: 0.05, alpha: 0.94, taperIn: 0.12, taperOut: 0.45, startW: 0.35, endW: 0.25, dry0: 0.05, dry1: 0.7, seed: s + 1, time });
    b.stroke(R, { width: 0.055, alpha: 0.94, taperIn: 0.12, taperOut: 0.45, startW: 0.35, endW: 0.3, dry0: 0.1, dry1: 0.8, seed: s + 2, time });
    // a pleat or two
    if (!back) {
      const pl: V2[] = [];
      for (let i = 1; i < pts.length; i++) pl.push({ x: lerp(pts[i].x, R[i].x, 0.45), y: lerp(pts[i].y, R[i].y, 0.45) });
      b.stroke(pl, { width: 0.014, alpha: 0.7, taperIn: 0.3, taperOut: 0.5, startW: 0.2, endW: 0.2, dry1: 0.8, seed: s + 3, time });
    }
    // foot
    const toe = { x: ank.x + f * (back ? 0.1 : 0.14), y: Math.max(0.012, ank.y - 0.06) };
    b.stroke([{ x: ank.x - f * 0.03, y: ank.y - 0.04 }, toe], { width: 0.045, alpha: 0.95, taperIn: 0.2, taperOut: 0.5, startW: 0.8, endW: 0.4, dry1: 0.4, seed: s + 4, time });
  }

  private drawArm(b: InkBatch, sh: V2, elb: V2, hand: V2, alpha: number, s: number, time: number, back: boolean) {
    const lag = this.sleeveLag;
    // sleeve: hangs from the upper arm, swings behind fast motion
    const top = [sh, { x: lerp(sh.x, elb.x, 0.5), y: lerp(sh.y, elb.y, 0.5) }, elb, { x: lerp(elb.x, hand.x, 0.35), y: lerp(elb.y, hand.y, 0.35) }];
    const bot = top.map((p, i) => {
      const k = i / (top.length - 1);
      const drop = 0.04 + 0.13 * Math.sin(Math.min(1, k * 1.2) * Math.PI * 0.85);
      return { x: p.x + lag.x * k * 1.2, y: p.y - drop + lag.y * k };
    });
    b.ribbon(top, bot, { alpha: alpha * 0.75, seed: s, pool: 0.7 });
    b.stroke(bot.slice(1), { width: 0.022, alpha: 0.8, taperIn: 0.2, taperOut: 0.4, startW: 0.4, endW: 0.4, dry1: 0.8, seed: s + 1, time });
    const a = back ? 0.75 : 0.95;
    if (!back) {
      // a sliver of untouched paper keeps the arm readable against the body
      b.stroke([sh, elb, hand], { width: 0.11, color: PAPER, alpha: 0.75, taperIn: 0.1, taperOut: 0.3, startW: 0.6, endW: 0.6, seed: s + 9, time, wobble: 0.1 });
    }
    b.stroke([sh, elb, hand], { width: 0.072, alpha: a, taperIn: 0.08, taperOut: 0.4, startW: 0.8, endW: 0.55, dry0: 0.0, dry1: 0.45, seed: s + 2, time, smoothing: 4 });
    b.blob(hand, 0.034, { alpha: a, seed: s + 3, rough: 0.25, pool: 0.2, segs: 10 });
  }

  private drawHead(b: InkBatch, time: number, s: number) {
    const sk = this.sk;
    const f = this.facing;
    const H = sk.head;
    const tilt = this.pose.sp + this.pose.hd;
    const ux = Math.sin(tilt) * f; // head up vector
    const uy = Math.cos(tilt);
    const fx = uy * f; // head forward vector
    const fy = -ux * f;
    // neck
    b.stroke([sk.neck, { x: H.x - ux * 0.05, y: H.y - uy * 0.05 }], { width: 0.06, alpha: 0.9, taperIn: 0.3, taperOut: 0.3, startW: 0.8, endW: 0.7, seed: s + 20, time });
    // face: left open as paper, edged with a thin line
    b.stroke(
      [
        { x: H.x + fx * 0.02 + ux * 0.075, y: H.y + fy * 0.02 + uy * 0.075 },
        { x: H.x + fx * 0.085 + ux * 0.02, y: H.y + fy * 0.085 + uy * 0.02 },
        { x: H.x + fx * 0.08 - ux * 0.04, y: H.y + fy * 0.08 - uy * 0.04 },
        { x: H.x + fx * 0.03 - ux * 0.085, y: H.y + fy * 0.03 - uy * 0.085 },
      ],
      { width: 0.016, alpha: 0.9, taperIn: 0.2, taperOut: 0.5, startW: 0.4, endW: 0.2, dry1: 0.35, seed: s + 21, time, wobble: 0.1 },
    );
    if (this.look === 'kasa') {
      // straw hat: a wide shallow cone that shades the face
      const cx = H.x + ux * 0.07;
      const cy = H.y + uy * 0.07;
      const apex = { x: cx + ux * 0.12, y: cy + uy * 0.12 };
      const rimF = { x: cx + fx * 0.3 - ux * 0.03, y: cy + fy * 0.3 - uy * 0.03 };
      const rimB = { x: cx - fx * 0.28 - ux * 0.03, y: cy - fy * 0.28 - uy * 0.03 };
      b.fill([apex, rimF, { x: cx - ux * 0.005, y: cy - uy * 0.005 }, rimB], { x: cx + ux * 0.04, y: cy + uy * 0.04 }, { alpha: 0.85, seed: s + 22, pool: 0.8 });
      b.stroke([rimB, { x: cx - ux * 0.01, y: cy - uy * 0.01 }, rimF], { width: 0.03, alpha: 0.97, taperIn: 0.1, taperOut: 0.3, startW: 0.4, endW: 0.2, dry1: 0.6, seed: s + 23, time });
      b.stroke([rimB, apex, rimF], { width: 0.022, alpha: 0.8, taperIn: 0.2, taperOut: 0.3, startW: 0.3, endW: 0.2, dry1: 0.8, seed: s + 24, time });
      b.blob({ x: H.x - fx * 0.03, y: H.y }, 0.07, { alpha: 0.9, seed: s + 25, rough: 0.2 });
      // ponytail
      b.stroke(this.ropes[0].pts, { width: 0.04, alpha: 0.92, taperIn: 0.05, taperOut: 0.8, startW: 0.9, endW: 0.05, dry1: 0.85, seed: s + 26, time });
    } else {
      // hair: an ink dab over the back and crown, with a topknot
      b.blob({ x: H.x - fx * 0.025 + ux * 0.012, y: H.y - fy * 0.025 + uy * 0.012 }, 0.085, { alpha: 0.95, seed: s + 22, rough: 0.18, pool: 0.3 });
      b.stroke(
        [
          { x: H.x + ux * 0.08 - fx * 0.02, y: H.y + uy * 0.08 - fy * 0.02 },
          { x: H.x + ux * 0.12 - fx * 0.06, y: H.y + uy * 0.12 - fy * 0.06 },
          { x: H.x + ux * 0.1 - fx * 0.11, y: H.y + uy * 0.1 - fy * 0.11 },
        ],
        { width: 0.035, alpha: 0.95, taperIn: 0.2, taperOut: 0.5, startW: 0.8, endW: 0.3, seed: s + 23, time },
      );
      // the red hachimaki: a band and two tails in the wind
      const band: V2[] = [
        { x: H.x - fx * 0.09 + ux * 0.03, y: H.y - fy * 0.09 + uy * 0.03 },
        { x: H.x + fx * 0.02 + ux * 0.055, y: H.y + fy * 0.02 + uy * 0.055 },
        { x: H.x + fx * 0.085 + ux * 0.05, y: H.y + fy * 0.085 + uy * 0.05 },
      ];
      b.stroke(band, { width: 0.032, color: RED, alpha: 0.95, taperIn: 0.1, taperOut: 0.3, startW: 0.8, endW: 0.6, dry1: 0.4, seed: s + 24, time });
      b.stroke(this.ropes[0].pts, { width: 0.032, color: RED, alpha: 0.92, taperIn: 0.05, taperOut: 0.6, startW: 0.9, endW: 0.3, dry1: 0.7, seed: s + 25, time });
      b.stroke(this.ropes[1].pts, { width: 0.026, color: RED, alpha: 0.88, taperIn: 0.05, taperOut: 0.6, startW: 0.9, endW: 0.3, dry1: 0.75, seed: s + 26, time });
    }
  }

  /** Fast blade motion leaves a pale dry-brush fan, like a smear frame. */
  private drawSmear(b: InkBatch) {
    const tr = this.trail;
    if (tr.length < 4 || this.sheathed) return;
    let len = 0;
    for (let i = 1; i < tr.length; i++) len += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
    const k = clamp((len - 0.3) * 1.4, 0, 1);
    if (k <= 0) return;
    const tips = tr.map((p) => ({ x: p.x, y: p.y }));
    const mids = tr.map((p) => ({ x: p.mx, y: p.my }));
    const alphas = tr.map((_, i) => (i / (tr.length - 1)) ** 1.5);
    b.ribbon(tips, mids, { alpha: 0.32 * k, seed: this.seed * 5, pool: 0.9, dry: 0.25, alphas });
    b.stroke(tips, { width: 0.035, alpha: 0.55 * k, taperIn: 0.6, taperOut: 0.05, startW: 0.05, endW: 1, dry0: 0.6, dry1: 0.2, seed: this.seed * 9, smoothing: 2 });
  }

  private drawSaya(b: InkBatch, time: number, s: number) {
    const sk = this.sk;
    b.stroke([sk.sayaMouth, sk.sayaEnd], { width: 0.036, alpha: 0.96, taperIn: 0.05, taperOut: 0.2, startW: 1, endW: 0.75, dry0: 0.1, dry1: 0.5, seed: s + 30, time, wobble: 0.06 });
  }

  private drawSword(b: InkBatch, time: number, s: number) {
    const sk = this.sk;
    const sheathed = this.sheathed && !(this.action && this.action.def.draw);
    // tsuka: wrapped hilt, dry and textured
    b.stroke([sk.pommel, sk.grip, sk.tsuba], { width: 0.04, alpha: 0.97, taperIn: 0.1, taperOut: 0.1, startW: 0.8, endW: 0.9, dry0: 0.35, dry1: 0.45, seed: s + 40, time, wobble: 0.05 });
    b.blob(sk.tsuba, 0.03, { alpha: 1, seed: s + 41, rough: 0.1, pool: 0.1, segs: 10 });
    if (sheathed) return;
    const len = Math.hypot(sk.tip.x - sk.tsuba.x, sk.tip.y - sk.tsuba.y);
    if (len < 0.02) return;
    // blade: one sharp, decisive stroke with a gentle curve (sori)
    const dx = (sk.tip.x - sk.tsuba.x) / len;
    const dy = (sk.tip.y - sk.tsuba.y) / len;
    const sori = 0.025 * (len / BLADE);
    const nx = -dy;
    const ny = dx;
    const side = this.facing * Math.sign(Math.cos(this.pose.sw) || 1);
    const mid = { x: (sk.tsuba.x + sk.tip.x) / 2 + nx * sori * side, y: (sk.tsuba.y + sk.tip.y) / 2 + ny * sori * side };
    b.stroke([sk.tsuba, mid, sk.tip], {
      width: 0.026,
      alpha: 1,
      taperIn: 0.02,
      taperOut: 0.25,
      startW: 1,
      endW: 0.05,
      dry0: 0,
      dry1: 0.1,
      seed: s + 42,
      time,
      wobble: 0.04,
      smoothing: 6,
    });
  }

  private drawDropped(b: InkBatch, time: number, s: number) {
    const d = this.dropped!;
    const ca = Math.cos(d.a);
    const sa = Math.sin(d.a);
    const g = { x: d.x, y: d.y };
    const tip = { x: d.x + ca * (BLADE + 0.07), y: d.y + sa * (BLADE + 0.07) };
    const tsuba = { x: d.x + ca * 0.07, y: d.y + sa * 0.07 };
    const pommel = { x: d.x - ca * (TSUKA - 0.07), y: d.y - sa * (TSUKA - 0.07) };
    b.stroke([pommel, g, tsuba], { width: 0.04, alpha: 0.97, dry0: 0.35, dry1: 0.45, startW: 0.8, endW: 0.9, seed: s + 40, time });
    b.stroke([tsuba, tip], { width: 0.026, alpha: 1, taperIn: 0.02, taperOut: 0.25, startW: 1, endW: 0.05, dry1: 0.1, seed: s + 42, time, wobble: 0.04 });
  }
}

