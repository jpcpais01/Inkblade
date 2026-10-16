import { Application, Container, RenderTexture, Sprite, Texture, type Filter, type Renderer } from 'pixi.js';
import './style.css';
import { sound } from './audio/audio';
import { Duel, type Mode } from './game/duel';
import type { Cmd, Fighter } from './game/fighter';
import { mountainFilter, paperFilter, sunFilter, LivingInkFilter, type MountainParams } from './render/filters';
import { paintGround, paintLives, paintPine, ScreenSplash } from './render/fx';
import { InkBatch } from './render/ink';
import { makeSeal } from './ui/seal';
import { Controls } from './ui/controls';
import { clamp, lerp, Spring } from './util';

const MOUNTAINS: (MountainParams & { parallax: number })[] = [
  { seed: 11.3, base: 0.66, amp: 0.36, dark: 0.24, freq: 2.2, mist: 0.3, parallax: 0.04 },
  { seed: 4.7, base: 0.73, amp: 0.26, dark: 0.4, freq: 3.0, mist: 0.2, parallax: 0.1 },
  { seed: 8.1, base: 0.8, amp: 0.13, dark: 0.55, freq: 4.4, mist: 0.12, parallax: 0.2 },
];

async function boot() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    resizeTo: window,
    antialias: false,
    background: 0xece3cc,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  });
  document.getElementById('app')!.appendChild(app.canvas);
  const renderer = app.renderer as Renderer;

  // fonts must be ready before the seal is rasterised
  await Promise.all([document.fonts.load('100px "Yuji Syuku"', '勝刃'), document.fonts.load('20px "Cormorant Garamond"')]).catch(() => {});

  // ------------------------------------------------------------ layers
  const bg = new Container();
  const paper = new Sprite();
  const sun = new Sprite();
  const hills = MOUNTAINS.map(() => new Sprite());
  bg.addChild(paper, sun, ...hills);

  const ink = new Container();
  const living = new LivingInkFilter();
  ink.filters = [living];

  const mid = new Container();
  const pine = new InkBatch(20000);
  paintPine(pine, 0);
  mid.addChild(pine.mesh);

  const world = new Container();
  const ground = new InkBatch(12000);
  paintGround(ground);
  const back = new InkBatch(12000);
  const bodies = new InkBatch(40000);
  const front = new InkBatch(40000);
  world.addChild(ground.mesh, back.mesh, bodies.mesh, front.mesh);

  const screen = new Container();
  const screenInk = new InkBatch(12000, 0.08);
  screen.addChild(screenInk.mesh);
  ink.addChild(mid, world, screen);

  const ui = new Container();
  const seal = new Sprite(makeSeal('勝', 512));
  seal.anchor.set(0.5);
  seal.visible = false;
  ui.addChild(seal);

  app.stage.addChild(bg, ink, ui);

  // ------------------------------------------------------------ baking
  let W = 0;
  let H = 0;
  const baked: RenderTexture[] = [];
  function bake(w: number, h: number, filter: Filter) {
    const s = new Sprite(Texture.WHITE);
    s.width = w;
    s.height = h;
    s.filters = [filter];
    const rt = RenderTexture.create({ width: w, height: h, resolution: renderer.resolution });
    renderer.render({ container: s, target: rt, clear: true });
    s.destroy();
    filter.destroy();
    baked.push(rt);
    return rt;
  }
  function rebake() {
    W = renderer.screen.width;
    H = renderer.screen.height;
    for (const t of baked.splice(0)) t.destroy(true);
    paper.texture = bake(W, H, paperFilter(W, H));
    const s = Math.round(Math.min(W, H) * 0.34);
    sun.texture = bake(s, s, sunFilter(s));
    MOUNTAINS.forEach((m, i) => {
      const w = Math.round(W * 1.3);
      hills[i].texture = bake(w, H, mountainFilter(w, H, m));
    });
    ink.filterArea = renderer.screen;
  }
  rebake();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(rebake, 150);
  });

  // ------------------------------------------------------------ game
  const splash = new ScreenSplash();
  const titleEl = document.getElementById('title')!;
  const resultEl = document.getElementById('result')!;
  const verdictEl = document.getElementById('verdict')!;
  let sealT = -1;
  let autoTimer = 0;

  const duel = new Duel({
    killSplash(at, dir) {
      const p = toScreen(at.x, at.y);
      splash.trigger(p.x + dir * camScale * 0.25, p.y - camScale * 0.1, camScale * 0.3, dir);
    },
    seal() {
      sealT = 0;
      seal.visible = true;
    },
    over(winner: Fighter) {
      const playerWon = duel.mode === 'duel' && winner === duel.a;
      const playerLost = duel.mode === 'duel' && winner !== duel.a;
      verdictEl.innerHTML = playerWon
        ? `<span class="v-big">Victory</span><span class="v-small">One clean cut.</span>`
        : playerLost
          ? `<span class="v-big">Defeat</span><span class="v-small">${winner.name} sheathes the blade.</span>`
          : `<span class="v-big">${winner.name}</span><span class="v-small">wins the duel.</span>`;
      resultEl.classList.remove('hidden');
      controls.show(false);
      if (duel.mode === 'watch') autoTimer = 6;
    },
    unlock() {
      controls.flash();
    },
  });

  const controls = new Controls((cmd: Cmd) => duel.player?.command(cmd));

  function start(mode: Mode) {
    sound.start();
    titleEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    seal.visible = false;
    sealT = -1;
    splash.reset();
    autoTimer = 0;
    duel.begin(mode);
    controls.show(mode === 'duel');
  }
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      start(b.dataset.mode as Mode);
    }),
  );
  document.getElementById('menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    resultEl.classList.add('hidden');
    titleEl.classList.remove('hidden');
    seal.visible = false;
    splash.reset();
    controls.show(false);
    duel.phase = 'title';
    autoTimer = 0;
  });
  // the title stays scored by the flute
  let fluteTimer = 1.0;

  // ------------------------------------------------------------ camera
  const camX = new Spring(0, 3.2, 1);
  const camZ = new Spring(9, 2.6, 1);
  let camScale = 100;
  let camOX = 0;
  let camOY = 0;
  const portraitNow = () => H > W;
  function toScreen(x: number, y: number) {
    return { x: camOX + x * camScale, y: camOY - y * camScale };
  }

  let real = 0;
  let cpuMs = 0;
  function update(dt: number) {
    real += dt;
    controls.poll(duel.player);
    duel.frame(dt);

    if (duel.phase === 'title' && titleEl.classList.contains('hidden') === false && sound.ctx) {
      fluteTimer -= dt;
      if (fluteTimer < 0) {
        sound.shakuhachi(0.35);
        fluteTimer = 14;
      }
    }
    if (autoTimer > 0) {
      autoTimer -= dt;
      if (autoTimer <= 0 && duel.phase === 'over' && duel.mode === 'watch') start('watch');
    }

    // camera frames both fighters, punches in on the killing blow
    const a = duel.a;
    const b = duel.b;
    const dist = Math.abs(b.x - a.x);
    const portrait = H > W;
    let wantW = duel.phase === 'title' ? 8.6 : clamp(dist + 4.4, 6.6, 10.5);
    if (portrait) wantW = clamp(dist + 2.6, 4.6, 7);
    let cx = (a.x + b.x) / 2;
    if (duel.punch > 0) {
      const k = Math.sin(Math.min(1, duel.punch) * Math.PI * 0.5);
      cx = lerp(cx, duel.punchAt.x, 0.25 * k);
      wantW *= 1 - 0.14 * k;
    }
    camX.step(cx, dt);
    camZ.step(wantW, dt);
    camScale = Math.min(W / camZ.x, (H * (portrait ? 0.42 : 0.62)) / 2.1);
    const groundY = H * (portrait ? 0.66 : 0.8);
    const sh = duel.shake * duel.shake * camScale * 0.04;
    const sx = (Math.random() - 0.5) * sh;
    const sy = (Math.random() - 0.5) * sh;
    camOX = W / 2 - camX.x * camScale + sx;
    camOY = groundY + sy;
    world.position.set(camOX, camOY);
    world.scale.set(camScale, -camScale);
    mid.position.set(W / 2 - camX.x * 0.7 * camScale - 5.1 * camScale * 0.92 + sx, groundY + sy);
    mid.scale.set(camScale * 0.92, -camScale * 0.92);

    paper.position.set(0, 0);
    sun.position.set(W * 0.7 - sun.width / 2 - camX.x * camScale * 0.02, H * (portrait ? 0.14 : 0.1));
    hills.forEach((h, i) => {
      const off = clamp(camX.x * camScale * MOUNTAINS[i].parallax, -W * 0.14, W * 0.14);
      h.position.set(-W * 0.15 - off, portrait ? -H * 0.12 : 0);
    });

    living.u.uTime = real;
    splash.update(dt);
    if (sealT >= 0) sealT += dt;
  }

  function paint() {
    const a = duel.a;
    const b = duel.b;
    const t0 = performance.now();
    const time = duel.simTime;
    back.begin();
    duel.fx.drawBack(back, time);
    duel.fx.drawPetals(back, false);
    back.end();

    bodies.begin();
    const order = duel.player ? [b, a] : [a, b];
    for (const f of order) f.draw(bodies, time);
    bodies.end();

    front.begin();
    duel.fx.drawFront(front, time);
    duel.fx.drawPetals(front, true);
    front.end();

    screenInk.begin();
    splash.draw(screenInk);
    if (duel.phase === 'fight' || duel.phase === 'standoff') {
      const s = Math.max(12, Math.min(W, H) * 0.03);
      paintLives(screenInk, W / 2 - s * 2.4, s * 2.6, -1, a.hp, 3, s, real);
      paintLives(screenInk, W / 2 + s * 2.4, s * 2.6, 1, b.hp, 3, s, real);
    }
    screenInk.end();

    // ---- the seal
    if (sealT >= 0) {
      const k = clamp(sealT / 0.16, 0, 1);
      const size = Math.min(W, H) * 0.3;
      const sc = (size / 512) * lerp(2.1, 1, k * k);
      seal.scale.set(sc);
      seal.alpha = Math.min(1, k * 1.6);
      seal.rotation = lerp(-0.25, -0.06, k);
      const wx = W * (portraitNow() ? 0.5 : 0.36);
      const jolt = sealT > 0.16 && sealT < 0.3 ? (Math.random() - 0.5) * 6 : 0;
      seal.position.set(wx + jolt, H * (portraitNow() ? 0.2 : 0.3) + jolt);
    }
    cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  app.ticker.add((tk) => {
    update(Math.min(tk.deltaMS / 1000, 0.05));
    paint();
  });

  /** Debug / screenshot helper: advance the world by fixed steps. */
  function run(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) update(1 / 60);
    paint();
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // expose for screenshots / debugging
  (window as unknown as { inkblade: unknown }).inkblade = { duel, start, run, cpu: () => cpuMs };
  document.body.classList.add('ready');
}

void boot();
