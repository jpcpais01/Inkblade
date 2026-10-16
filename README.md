# Ink Blade · 墨刃

A one-on-one samurai duel painted in living sumi-e ink. One demo fight, built
to look and move like a brush painting that breathes.

- **Vite + TypeScript + PixiJS 8 (WebGL)**, installable PWA, deploys to Vercel as-is.
- **Everything is procedural.** Rice paper, ink-wash mountains and the red sun are
  fragment shaders baked once per resize. Fighters, slashes, splashes and petals are
  brush strokes tessellated every frame into a single dynamic mesh whose shader paints
  bristle streaks and dry-brush gaps. A full-screen "living ink" pass makes the whole
  layer boil like hand-drawn line and bleed into the paper fibres.
- **Procedural animation.** Moves are pose targets on a timeline; springs chase them,
  which gives anticipation, follow-through and settle. Arms and legs are solved with
  two-bone IK onto the grip and planted feet, and sashes, sleeves and the hachimaki
  ride on verlet ropes in the wind.
- **Sound** is pure Web Audio: wind, paper rustle, taiko, ringing steel, and a
  shakuhachi phrase in the miyako-bushi mode during the standoff.

## Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Step in / back | `→` `←` (hold to walk) | ▶ ◀ |
| Dash / dodge back | double-tap `→` / `←` (or Shift) | double-tap ▶ / ◀ |
| Stance high / mid / low | `↑` `↓` | ▲ ▼ |
| Strike | `J` / `Z` / Space | 斬 |
| Parry | `K` / `X` | 受 |
| Feint | `L` / `C` | 虚 |
| Sheathe | `I` / `V` | 納 |

The strike depends on your stance: **high** → overhead cut, **mid** → thrust,
**low** → low sweep, **sheathed** → iaido quick-draw (the fastest cut in the game).
Your stance is also your guard: a high guard stops overhead cuts, mid stops thrusts
and iaido, low stops sweeps. A sheathed fighter cannot guard.

**Parry** has a short perfect window: catch a cut inside it and the attacker
staggers wide open. Mistime it and you are the one exposed. Hitting someone during
their wind-up or recovery is a counter-hit and does an extra wound. Three wounds
end the duel, and most fights end in one to three clean hits.

**Watch** mode puts two AIs against each other. They keep ma-ai just outside each
other's reach, bait with steps and feints, parry or re-guard against what they
see coming, and punish whiffs.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview
```

Deploy on Vercel with the defaults (framework: Vite, output: `dist`); `vercel.json`
sets cache headers for the service worker and hashed assets.

## Layout

```
src/
  main.ts            app, layers, camera, baking, the frame loop
  game/moves.ts      pose space and the move book (keyframed targets)
  game/fighter.ts    state machine, springs, IK, ropes, brush painting
  game/duel.ts       phases, hit resolution, hit-stop, the killing blow
  game/ai.ts         the duel AI
  render/ink.ts      InkBatch: brush-stroke tessellator + bristle shader
  render/filters.ts  paper, mountains, sun, living-ink shaders
  render/fx.ts       slashes, splashes, petals, ground, pine, HUD
  audio/audio.ts     procedural soundscape
  ui/                seal (hanko) and controls
```

Fonts: Yuji Syuku and Cormorant Garamond (SIL Open Font License), subset to the
glyphs used.
