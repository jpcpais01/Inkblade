// Pose space and the move book. Poses are authored as targets on a timeline;
// the fighter chases them with springs, which supplies weight, lag and settle.
// Angles: sword `sw` is the blade direction (0 = toward the opponent, +up),
// unwrapped so a cut can sweep through more than a half turn. `sf` is a
// foreshortening factor (cos of the blade's turn in depth): horizontal cuts
// swing the blade "through" the picture plane, from behind the body to in front.

import { ease as easeFor, type Ease } from '../util';

export interface Pose {
  hx: number; // pelvis x offset from the fighter's ground position
  hy: number; // pelvis height
  sp: number; // spine lean (+ toward the opponent)
  hd: number; // head tilt relative to the spine
  gx: number; // grip position relative to the pelvis
  gy: number;
  sw: number; // sword angle
  sf: number; // sword foreshortening
  ff: number; // front foot offset
  bf: number; // back foot offset
  fl: number; // front foot lift
  bl: number; // back foot lift
}

export const POSE_KEYS: (keyof Pose)[] = ['hx', 'hy', 'sp', 'hd', 'gx', 'gy', 'sw', 'sf', 'ff', 'bf', 'fl', 'bl'];

export type Stance = 'high' | 'mid' | 'low';
export type Line = 'high' | 'mid' | 'low';

const PI = Math.PI;
export const SHEATHED_SW = PI + 0.25;

const MID: Pose = { hx: 0, hy: 0.86, sp: 0.08, hd: 0.05, gx: 0.3, gy: 0.14, sw: 0.42, sf: 1, ff: 0.3, bf: -0.33, fl: 0, bl: 0 };

export const STANCE_POSE: Record<Stance | 'sheathed', Pose> = {
  mid: MID,
  high: { ...MID, hy: 0.875, sp: -0.03, hd: 0.0, gx: 0.05, gy: 0.8, sw: 2.45, ff: 0.27, bf: -0.36 },
  low: { ...MID, hy: 0.83, sp: 0.13, hd: 0.08, gx: 0.27, gy: 0.02, sw: -0.52 },
  sheathed: { ...MID, hy: 0.845, sp: 0.15, hd: 0.09, gx: 0.178, gy: -0.005, sw: SHEATHED_SW, ff: 0.3, bf: -0.35 },
};

export interface Key {
  t: number;
  p: Pose;
  e: Ease;
}

export interface Travel {
  d: number;
  t0: number;
  t1: number;
  e: Ease;
  lift: number;
}

export interface AttackSpec {
  line: Line;
  dmg: number;
  /** Stance that makes the anticipation faster. */
  home: Stance | 'sheathed';
  /** Slash trail is painted while the cut is live. */
  paint: boolean;
  heavy: boolean;
}

export interface MoveDef {
  name: MoveName;
  dur: number;
  keys: (stance: Pose) => Key[];
  travel?: Travel;
  active?: [number, number];
  attack?: AttackSpec;
  iframes?: [number, number];
  parry?: [number, number];
  /** Fighter keeps its guard up during this move. */
  guard?: boolean;
  /** After this fraction of the move, a new command may cancel it. */
  cancel?: number;
  /** Ends sheathed / drawn. */
  sheathe?: boolean;
  draw?: boolean;
  /** Feints present as this attack while winding up. */
  feint?: boolean;
}

export type MoveName =
  | 'stance'
  | 'stepF'
  | 'stepB'
  | 'dash'
  | 'dodge'
  | 'overhead'
  | 'thrust'
  | 'sweep'
  | 'iaido'
  | 'parry'
  | 'riposte'
  | 'feint'
  | 'draw'
  | 'noto'
  | 'stagger'
  | 'recoil'
  | 'hit'
  | 'death'
  | 'victory';

const k = (t: number, p: Pose, e: Ease = 'io'): Key => ({ t, p, e });
const P = (base: Pose, o: Partial<Pose>): Pose => ({ ...base, ...o });

const S = STANCE_POSE;

export const MOVES: Record<MoveName, MoveDef> = {
  stance: {
    name: 'stance',
    dur: 0.22,
    guard: true,
    keys: (s) => [k(0, s, 'io')],
  },

  stepF: {
    name: 'stepF',
    dur: 0.34,
    guard: true,
    cancel: 0.55,
    travel: { d: 0.42, t0: 0.0, t1: 0.3, e: 'io', lift: 0.03 },
    keys: (s) => [k(0, s), k(0.15, P(s, { hy: s.hy - 0.025, sp: s.sp + 0.04 })), k(0.34, s)],
  },
  stepB: {
    name: 'stepB',
    dur: 0.34,
    guard: true,
    cancel: 0.55,
    travel: { d: -0.42, t0: 0.0, t1: 0.3, e: 'io', lift: 0.03 },
    keys: (s) => [k(0, s), k(0.15, P(s, { hy: s.hy - 0.02, sp: s.sp - 0.03 })), k(0.34, s)],
  },
  dash: {
    name: 'dash',
    dur: 0.36,
    cancel: 0.6,
    travel: { d: 1.25, t0: 0.02, t1: 0.3, e: 'out', lift: 0.09 },
    keys: (s) => [
      k(0, s),
      k(0.07, P(s, { hy: s.hy - 0.08, sp: s.sp + 0.28, hd: s.hd + 0.05 }), 'out'),
      k(0.24, P(s, { hy: s.hy - 0.05, sp: s.sp + 0.2 })),
      k(0.36, s, 'io'),
    ],
  },
  dodge: {
    name: 'dodge',
    dur: 0.44,
    cancel: 0.7,
    iframes: [0.02, 0.26],
    travel: { d: -1.15, t0: 0.02, t1: 0.3, e: 'out', lift: 0.11 },
    keys: (s) => [
      k(0, s),
      k(0.06, P(s, { hy: s.hy + 0.02, sp: s.sp - 0.32, hd: s.hd - 0.12, gx: s.gx - 0.12, gy: s.gy + 0.08 }), 'out'),
      k(0.28, P(s, { hy: s.hy - 0.06, sp: s.sp - 0.1, gx: s.gx - 0.05 }), 'io'),
      k(0.44, s, 'io'),
    ],
  },

  // Shomen-uchi: rise, coil, and drop the blade through the centre line.
  overhead: {
    name: 'overhead',
    dur: 0.95,
    active: [0.29, 0.39],
    attack: { line: 'high', dmg: 2, home: 'high', paint: true, heavy: true },
    travel: { d: 0.6, t0: 0.18, t1: 0.4, e: 'out', lift: 0.07 },
    keys: (s) => [
      k(0, P(S.high, { sp: -0.05 }), 'io'),
      k(0.25, P(S.high, { hy: 0.9, sp: -0.14, hd: -0.06, gx: -0.03, gy: 0.86, sw: 2.9 }), 'io'),
      k(0.31, P(S.high, { hy: 0.82, sp: 0.16, hd: 0.06, gx: 0.28, gy: 0.66, sw: 1.25 }), 'in'),
      k(0.37, P(S.mid, { hy: 0.74, sp: 0.34, hd: 0.14, gx: 0.5, gy: 0.28, sw: -0.12 }), 'snap'),
      k(0.5, P(S.mid, { hy: 0.7, sp: 0.38, hd: 0.15, gx: 0.46, gy: 0.12, sw: -0.44 }), 'out'),
      k(0.7, P(S.mid, { hy: 0.72, sp: 0.3, hd: 0.1, gx: 0.44, gy: 0.14, sw: -0.36 }), 'io'),
      k(0.95, s, 'io'),
    ],
  },

  // Tsuki: draw the hands in, then the whole body drives the point.
  thrust: {
    name: 'thrust',
    dur: 0.84,
    active: [0.22, 0.33],
    attack: { line: 'mid', dmg: 1, home: 'mid', paint: true, heavy: false },
    travel: { d: 0.78, t0: 0.15, t1: 0.32, e: 'out', lift: 0.06 },
    keys: (s) => [
      k(0, P(S.mid, {}), 'io'),
      k(0.17, P(S.mid, { hy: 0.82, sp: 0.0, hx: -0.06, hd: 0.08, gx: 0.12, gy: 0.18, sw: 0.14 }), 'io'),
      k(0.25, P(S.mid, { hy: 0.75, sp: 0.4, hx: 0.06, hd: 0.1, gx: 0.62, gy: 0.3, sw: 0.05 }), 'snap'),
      k(0.4, P(S.mid, { hy: 0.75, sp: 0.37, hx: 0.05, gx: 0.6, gy: 0.3, sw: 0.03 }), 'out'),
      k(0.84, s, 'io'),
    ],
  },

  // Ashi-barai style: coil low behind the hip and sweep through the shins.
  sweep: {
    name: 'sweep',
    dur: 1.0,
    active: [0.27, 0.4],
    attack: { line: 'low', dmg: 1, home: 'low', paint: true, heavy: false },
    travel: { d: 0.55, t0: 0.18, t1: 0.38, e: 'out', lift: 0.05 },
    keys: (s) => [
      k(0, P(S.low, {}), 'io'),
      k(0.23, P(S.low, { hy: 0.72, sp: 0.26, hx: -0.05, hd: 0.1, gx: -0.02, gy: 0.0, sw: PI - 0.38, sf: 1 }), 'io'),
      k(0.31, P(S.low, { hy: 0.63, sp: 0.38, gx: 0.26, gy: -0.05, sw: PI - 0.32, sf: 0.0 }), 'in'),
      k(0.37, P(S.low, { hy: 0.58, sp: 0.42, gx: 0.46, gy: -0.07, sw: PI - 0.3, sf: -1 }), 'snap'),
      k(0.55, P(S.low, { hy: 0.6, sp: 0.38, gx: 0.44, gy: 0.0, sw: PI - 0.4, sf: -1 }), 'out'),
      k(0.72, P(S.low, { hy: 0.64, sp: 0.32, gx: 0.42, gy: 0.0, sw: PI - 0.42, sf: -1 }), 'io'),
      k(1.0, P(s, { sw: s.sw + PI, sf: -1 }), 'io'),
    ],
  },

  // Nukitsuke: the draw is the cut. Fast, rising, from the scabbard.
  iaido: {
    name: 'iaido',
    dur: 1.0,
    active: [0.1, 0.22],
    attack: { line: 'mid', dmg: 2, home: 'sheathed', paint: true, heavy: true },
    travel: { d: 0.95, t0: 0.02, t1: 0.22, e: 'out', lift: 0.08 },
    draw: true,
    keys: () => [
      k(0, S.sheathed, 'io'),
      k(0.07, P(S.sheathed, { hy: 0.78, sp: 0.3, hd: 0.12, gx: 0.26, gy: 0.03, sw: SHEATHED_SW, sf: 0.92 }), 'in'),
      k(0.13, P(S.sheathed, { hy: 0.74, sp: 0.3, gx: 0.46, gy: 0.22, sw: PI + 0.18, sf: 0.0 }), 'lin'),
      k(0.2, P(S.sheathed, { hy: 0.75, sp: 0.22, gx: 0.58, gy: 0.44, sw: PI + 0.45, sf: -1 }), 'snap'),
      k(0.33, P(S.sheathed, { hy: 0.77, sp: 0.16, hd: 0.06, gx: 0.52, gy: 0.52, sw: PI + 0.62, sf: -1 }), 'out'),
      k(0.6, P(S.sheathed, { hy: 0.8, sp: 0.12, hd: 0.05, gx: 0.46, gy: 0.42, sw: PI + 0.56, sf: -1 }), 'io'),
      k(1.0, P(S.mid, { sw: S.mid.sw + PI, sf: -1 }), 'io'),
    ],
  },

  parry: {
    name: 'parry',
    dur: 0.5,
    parry: [0.02, 0.18],
    keys: (s) => [
      k(0, s),
      k(0.06, P(S.mid, { hy: 0.85, sp: 0.0, hx: -0.03, hd: 0.0, gx: 0.3, gy: 0.46, sw: 1.22 }), 'snap'),
      k(0.2, P(S.mid, { hy: 0.85, sp: 0.02, hx: -0.03, gx: 0.31, gy: 0.47, sw: 1.18 }), 'lin'),
      k(0.5, s, 'io'),
    ],
  },
  // Successful parry: the opponent's blade is swept aside, ready to answer.
  riposte: {
    name: 'riposte',
    dur: 0.26,
    guard: true,
    keys: (s) => [k(0, P(S.mid, { gx: 0.36, gy: 0.36, sw: 0.4, sp: 0.12 }), 'snap'), k(0.26, s, 'io')],
  },
  feint: {
    name: 'feint',
    dur: 0.44,
    feint: true,
    keys: (s) => [k(0, s), k(0.15, s, 'out'), k(0.44, s, 'io')], // replaced at runtime with the stance's wind-up
  },

  draw: {
    name: 'draw',
    dur: 0.4,
    draw: true,
    keys: (s) => [
      k(0, P(S.sheathed, { sw: SHEATHED_SW - 2 * PI })),
      k(0.13, P(S.sheathed, { hy: 0.82, gx: 0.56, gy: 0.09, sw: SHEATHED_SW - 2 * PI }), 'io'),
      k(0.4, s, 'out'),
    ],
  },
  // Chiburi (shake the blood off) and noto (return the blade to the saya).
  noto: {
    name: 'noto',
    dur: 1.15,
    sheathe: true,
    keys: () => [
      k(0, S.mid),
      k(0.24, P(S.mid, { gx: 0.36, gy: 0.52, sw: 1.45, sp: 0.02 }), 'io'),
      k(0.36, P(S.mid, { gx: 0.5, gy: 0.06, sw: -0.55, sp: 0.12 }), 'snap'),
      k(0.6, P(S.mid, { gx: 0.5, gy: 0.1, sw: -1.6, sf: 0.75 }), 'io'),
      k(0.78, P(S.sheathed, { gx: 0.566, gy: 0.095, sw: SHEATHED_SW - 2 * PI, sf: 1 }), 'io'),
      k(1.1, P(S.sheathed, { sw: SHEATHED_SW - 2 * PI }), 'io'),
    ],
  },

  stagger: {
    name: 'stagger',
    dur: 0.85,
    travel: { d: -0.32, t0: 0.0, t1: 0.3, e: 'out', lift: 0.04 },
    keys: (s) => [
      k(0, s),
      k(0.08, P(S.mid, { hy: 0.9, sp: -0.32, hd: -0.22, gx: 0.0, gy: 0.74, sw: 2.3 }), 'snap'),
      k(0.5, P(S.mid, { hy: 0.85, sp: -0.16, hd: -0.1, gx: 0.1, gy: 0.52, sw: 1.8 }), 'io'),
      k(0.85, s, 'io'),
    ],
  },
  recoil: {
    name: 'recoil',
    dur: 0.36,
    guard: true,
    travel: { d: -0.28, t0: 0.0, t1: 0.25, e: 'out', lift: 0.02 },
    keys: (s) => [k(0, s), k(0.06, P(s, { hx: -0.04, sp: s.sp - 0.1, gy: s.gy + 0.1, sw: s.sw + 0.35 }), 'snap'), k(0.36, s, 'io')],
  },
  hit: {
    name: 'hit',
    dur: 0.75,
    travel: { d: -0.4, t0: 0.0, t1: 0.3, e: 'out', lift: 0.03 },
    keys: (s) => [
      k(0, s),
      k(0.08, P(S.mid, { hy: 0.77, sp: 0.52, hd: 0.32, gx: 0.18, gy: -0.02, sw: -0.9 }), 'snap'),
      k(0.45, P(S.mid, { hy: 0.79, sp: 0.42, hd: 0.25, gx: 0.2, gy: 0.02, sw: -0.7 }), 'io'),
      k(0.75, s, 'io'),
    ],
  },
  death: {
    name: 'death',
    dur: 2.6,
    travel: { d: -0.25, t0: 0.0, t1: 0.35, e: 'out', lift: 0.02 },
    keys: () => [
      k(0, S.mid),
      k(0.1, P(S.mid, { hy: 0.8, sp: 0.46, hd: 0.36, gx: 0.16, gy: 0.06, sw: -1.2 }), 'snap'),
      k(0.6, P(S.mid, { hy: 0.74, sp: 0.5, hd: 0.4, gx: 0.12, gy: -0.04, sw: -1.3 }), 'io'),
      k(1.15, P(S.mid, { hy: 0.5, sp: 0.6, hd: 0.45, gx: 0.1, gy: -0.12, ff: 0.34, bf: -0.42, sw: -1.3 }), 'in'),
      k(1.7, P(S.mid, { hy: 0.47, sp: 0.66, hd: 0.5, gx: 0.12, gy: -0.12, ff: 0.34, bf: -0.42, sw: -1.3 }), 'io'),
      k(2.6, P(S.mid, { hy: 0.36, sp: 1.08, hd: 0.55, hx: 0.06, gx: 0.22, gy: -0.2, ff: -0.12, bf: -0.42, sw: -1.3 }), 'in'),
    ],
  },
  victory: {
    name: 'victory',
    dur: 2.2,
    sheathe: true,
    keys: () => [
      k(0, S.mid),
      k(0.5, P(S.mid, { gx: 0.36, gy: 0.52, sw: 1.45, sp: 0.02 }), 'io'),
      k(0.62, P(S.mid, { gx: 0.5, gy: 0.06, sw: -0.55, sp: 0.12 }), 'snap'),
      k(1.1, P(S.mid, { gx: 0.5, gy: 0.1, sw: -1.6, sf: 0.75 }), 'io'),
      k(1.45, P(S.sheathed, { gx: 0.566, gy: 0.095, sw: SHEATHED_SW - 2 * PI, sf: 1 }), 'io'),
      k(2.1, P(S.sheathed, { sw: SHEATHED_SW - 2 * PI, hy: 0.88, sp: 0.04 }), 'io'),
    ],
  },
};

export const ATTACK_FOR: Record<Stance | 'sheathed', MoveName> = {
  high: 'overhead',
  mid: 'thrust',
  low: 'sweep',
  sheathed: 'iaido',
};

export function samplePose(keys: Key[], t: number, out: Pose): Pose {
  if (t <= keys[0].t || keys.length === 1) return Object.assign(out, keys[0].p);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const f = easeFor(b.e, (t - a.t) / Math.max(1e-6, b.t - a.t));
      for (const key of POSE_KEYS) out[key] = a.p[key] + (b.p[key] - a.p[key]) * f;
      return out;
    }
  }
  return Object.assign(out, keys[keys.length - 1].p);
}

