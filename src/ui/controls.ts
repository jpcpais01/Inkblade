// Keyboard and touch input. Both produce the same commands as the AI uses.

import type { Cmd, Fighter } from '../game/fighter';

type Dir = 'left' | 'right';

const KEYMAP: Record<string, Cmd | Dir> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  KeyJ: 'strike',
  KeyZ: 'strike',
  Space: 'strike',
  KeyK: 'parry',
  KeyX: 'parry',
  KeyL: 'feint',
  KeyC: 'feint',
  KeyI: 'sheathe',
  KeyV: 'sheathe',
};

export class Controls {
  private held: Record<Dir, boolean> = { left: false, right: false };
  private lastTap: Record<Dir, number> = { left: -1, right: -1 };
  private touchEl = document.getElementById('touch')!;
  private keysEl = document.getElementById('keys')!;
  private usingTouch = matchMedia('(pointer: coarse)').matches;
  private active = false;
  private firstTap = true;

  constructor(private send: (c: Cmd) => void) {
    window.addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (e.repeat) return;
      if (k === 'left' || k === 'right') this.dir(k, true, e.shiftKey);
      else this.send(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k === 'left' || k === 'right') this.held[k] = false;
    });
    window.addEventListener('blur', () => (this.held.left = this.held.right = false));

    this.touchEl.querySelectorAll<HTMLElement>('[data-cmd]').forEach((el) => {
      const c = el.dataset.cmd as Cmd | Dir;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('down');
        if (c === 'left' || c === 'right') this.dir(c, true, false);
        else this.send(c);
        navigator.vibrate?.(8);
      });
      const up = () => {
        el.classList.remove('down');
        if (c === 'left' || c === 'right') this.held[c] = false;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });

    // first touch: go fullscreen and try to hold landscape
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          this.usingTouch = true;
          this.refresh();
        }
        if (!this.firstTap || e.pointerType !== 'touch') return;
        this.firstTap = false;
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
        const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
        try {
          if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock, lock);
          else el.webkitRequestFullscreen?.();
        } catch {
          /* not allowed: fine */
        }
      },
      { capture: true },
    );
  }

  private dir(d: Dir, down: boolean, modifier: boolean) {
    const now = performance.now() / 1000;
    const double = now - this.lastTap[d] < 0.28;
    this.lastTap[d] = now;
    this.held[d] = down;
    if (modifier || double) this.send(d === 'right' ? 'dash' : 'dodge');
    else this.send(d === 'right' ? 'stepF' : 'stepB');
  }

  /** Holding a direction keeps walking. */
  poll(player: Fighter | null) {
    if (!player || player.busy || player.locked) return;
    if (this.held.right && !this.held.left) this.send('stepF');
    else if (this.held.left && !this.held.right) this.send('stepB');
  }

  show(on: boolean) {
    this.active = on;
    this.refresh();
  }

  private refresh() {
    this.touchEl.classList.toggle('hidden', !(this.active && this.usingTouch));
    this.keysEl.classList.toggle('hidden', !(this.active && !this.usingTouch));
  }

  flash() {
    this.touchEl.classList.add('awake');
    this.keysEl.classList.add('awake');
  }
}
