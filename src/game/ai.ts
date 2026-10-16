// Duel AI. It perceives its opponent through a reaction delay, keeps ma-ai
// (the killing distance) just outside the opponent's reach, baits with steps
// and feints, answers wind-ups with parries / guard changes / dodges, and
// punishes anything it sees whiff.

import { pick, rand } from '../util';
import { Fighter, type Cmd } from './fighter';
import { MOVES, ATTACK_FOR, type Line, type MoveName, type Stance } from './moves';

interface Snap {
  t: number;
  x: number;
  threat: { move: MoveName; t: number } | null;
  threatId: number;
  recovering: boolean;
  guard: Line | null;
  stance: Stance;
  sheathed: boolean;
  move: MoveName | null;
}

export interface Personality {
  skill: number; // 0..1 reaction speed & read accuracy
  aggression: number; // 0..1
  patience: number; // 0..1 how often it simply waits
  trickery: number; // 0..1 feints and baits
}

export const PERSONALITIES: Record<string, Personality> = {
  ronin: { skill: 0.78, aggression: 0.55, patience: 0.5, trickery: 0.55 },
  calm: { skill: 0.82, aggression: 0.4, patience: 0.7, trickery: 0.35 },
  fierce: { skill: 0.72, aggression: 0.8, patience: 0.3, trickery: 0.6 },
};

const BODY = 0.38; // the target's body depth toward the attacker

export function attackReach(m: MoveName) {
  return (Fighter.reach[m] ?? 1.6) + BODY;
}

export class AI {
  private hist: Snap[] = [];
  private now = 0;
  private cooldown = rand(0.2, 0.6);
  private answered = -1;
  private schedule: { at: number; cmd: Cmd }[] = [];
  private oppActionId = 0;
  private lastOppMove: MoveName | null = null;
  private lastOppT = 0;

  constructor(
    public me: Fighter,
    public opp: Fighter,
    public p: Personality,
  ) {}

  private reaction() {
    return 0.3 - this.p.skill * 0.14 + rand(-0.02, 0.04);
  }

  private snap(): Snap {
    const o = this.opp;
    const a = o.action;
    if (o.moveName !== this.lastOppMove || (a && a.t < this.lastOppT)) this.oppActionId++;
    this.lastOppMove = o.moveName;
    this.lastOppT = a ? a.t : 0;
    return {
      t: this.now,
      x: o.x,
      threat: o.threat(),
      threatId: this.oppActionId,
      recovering: o.recovering,
      guard: o.guardLine,
      stance: o.stance,
      sheathed: o.sheathed,
      move: o.moveName,
    };
  }

  private perceive(delay: number): Snap {
    const target = this.now - delay;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].t <= target) return this.hist[i];
    return this.hist[0];
  }

  private act(cmd: Cmd) {
    this.me.command(cmd);
  }

  update(dt: number) {
    this.now += dt;
    this.hist.push(this.snap());
    if (this.hist.length > 90) this.hist.shift();
    const me = this.me;
    if (me.locked || me.dead) return;

    for (let i = this.schedule.length - 1; i >= 0; i--) {
      if (this.schedule[i].at <= this.now) {
        this.act(this.schedule[i].cmd);
        this.schedule.splice(i, 1);
      }
    }

    const delay = this.reaction();
    const seen = this.perceive(delay);
    const age = this.now - seen.t;
    const dist = Math.abs(seen.x - me.x);
    const p = this.p;

    // ---- 1. answer a wind-up
    if (seen.threat && seen.threatId !== this.answered) {
      const tm = seen.threat.move;
      const def = MOVES[tm];
      const reach = attackReach(tm);
      if (dist <= reach + 0.3) {
        this.answered = seen.threatId;
        const elapsed = seen.threat.t + age;
        const live = def.active![0] / 1.15 - elapsed; // rough: wind-ups are often sped up
        this.respond(def.attack!.line, live, dist, reach);
        return;
      }
    }

    if (!me.canAct || this.schedule.length) return;

    const myAttack: MoveName = me.sheathed ? 'iaido' : ATTACK_FOR[me.stance];
    const myReach = attackReach(myAttack);

    // ---- 2. punish what whiffs
    if (seen.recovering && seen.move !== 'hit') {
      if (dist <= myReach + 0.05) {
        this.strikeAgainst(seen.guard);
        return;
      }
      if (dist <= myReach + 1.1 && Math.random() < 0.5 + p.aggression * 0.4) {
        this.act('dash');
        this.schedule.push({ at: this.now + 0.24, cmd: 'strike' });
        return;
      }
    }

    // ---- 3. neutral game
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = rand(0.18, 0.6) * (1.35 - p.aggression * 0.6);

    const oppAttack: MoveName = seen.sheathed ? 'iaido' : ATTACK_FOR[seen.stance];
    const danger = attackReach(oppAttack);
    const maai = danger + 0.22;

    if (dist > maai + 1.6 && Math.random() < 0.35 + p.aggression * 0.4) return this.act('dash');
    if (dist > maai + 0.35) {
      // closing in: sheathed fighters love to walk into iaido range
      return this.act('stepF');
    }
    if (dist < 1.0) return this.act(Math.random() < 0.6 ? 'dodge' : 'stepB');

    type Opt = [number, () => void];
    const opts: Opt[] = [];
    const myLine = me.sheathed ? 'mid' : MOVES[myAttack].attack!.line;
    const open = seen.guard !== myLine;
    if (dist <= myReach) opts.push([p.aggression * (open ? 1.6 : 0.25), () => this.strikeAgainst(seen.guard)]);
    if (dist <= myReach + 0.45) {
      opts.push([
        p.trickery * 0.7,
        () => {
          this.act('feint');
          if (Math.random() < 0.55 + p.aggression * 0.3) this.schedule.push({ at: this.now + 0.4, cmd: 'strike' });
        },
      ]);
    }
    // bait: dip into range and straight back out
    opts.push([
      p.trickery * 0.5,
      () => {
        this.act('stepF');
        this.schedule.push({ at: this.now + rand(0.36, 0.5), cmd: 'stepB' });
      },
    ]);
    opts.push([0.35 + p.aggression * 0.3, () => this.act('stepF')]);
    opts.push([0.25, () => this.act('stepB')]);
    if (!me.sheathed && !open) opts.push([0.8, () => this.shiftToBeat(seen.guard)]);
    if (!me.sheathed && seen.threat == null) opts.push([0.25, () => this.guardAgainst(seen.sheathed ? 'mid' : MOVES[oppAttack].attack!.line)]);
    if (!me.sheathed && dist > 2.9) opts.push([0.12, () => this.act('sheathe')]);
    opts.push([p.patience * 0.9, () => {}]);

    let total = 0;
    for (const o of opts) total += o[0];
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o[0];
      if (r <= 0) {
        o[1]();
        return;
      }
    }
  }

  private respond(line: Line, live: number, dist: number, reach: number) {
    const me = this.me;
    const p = this.p;
    const opts: [number, () => void][] = [];
    if (!me.sheathed && live > 0.02) {
      const jitter = (Math.random() - 0.5) * (1 - p.skill) * 0.16;
      const at = this.now + Math.max(0, live - 0.07 + jitter);
      opts.push([p.skill * 1.1, () => this.schedule.push({ at, cmd: 'parry' })]);
    }
    if (!me.sheathed) {
      if (me.stance === line) opts.push([0.9, () => {}]);
      else if (live > 0.1) opts.push([0.7, () => this.guardAgainst(line)]);
    }
    if (me.sheathed && live > 0.0) opts.push([0.8 * p.skill, () => this.act('strike')]); // sen no sen: iaido beats the wind-up
    if (live > 0.02 && dist > reach - 0.6) opts.push([0.6, () => this.act('dodge')]);
    opts.push([0.25 * (1 - p.skill), () => {}]);
    let total = 0;
    for (const o of opts) total += o[0];
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o[0];
      if (r <= 0) return o[1]();
    }
  }

  private strikeAgainst(guard: Line | null) {
    const me = this.me;
    if (!me.sheathed && guard && MOVES[ATTACK_FOR[me.stance]].attack!.line === guard && Math.random() < this.p.skill) {
      this.shiftToBeat(guard);
      this.schedule.push({ at: this.now + 0.2, cmd: 'strike' });
      return;
    }
    this.act('strike');
  }

  private shiftToBeat(guard: Line | null) {
    const me = this.me;
    const choices = (['high', 'mid', 'low'] as Stance[]).filter((s) => s !== guard && s !== me.stance);
    const want = pick(choices.length ? choices : (['mid'] as Stance[]));
    this.moveStanceTo(want);
  }

  private guardAgainst(line: Line) {
    this.moveStanceTo(line);
  }

  private moveStanceTo(s: Stance) {
    const me = this.me;
    const order: Stance[] = ['low', 'mid', 'high'];
    const d = order.indexOf(s) - order.indexOf(me.stance);
    if (d === 0) return;
    this.act(d > 0 ? 'up' : 'down');
    if (Math.abs(d) === 2) this.schedule.push({ at: this.now + 0.2, cmd: d > 0 ? 'up' : 'down' });
  }
}
