// Full-screen shaders: rice paper, ink-wash mountains and the red sun are baked
// into textures on resize; the living ink filter runs every frame over the
// dynamic layer (fighters, slashes, splashes) to make it bleed and boil.

import { defaultFilterVert, Filter, GlProgram } from 'pixi.js';
import { FILTER_HEAD, NOISE } from './glsl';

function program(name: string, body: string) {
  return GlProgram.from({
    vertex: defaultFilterVert,
    fragment: `precision highp float;\n${FILTER_HEAD}\n${NOISE}\n${body}`,
    name,
    preferredFragmentPrecision: 'highp',
  });
}

const PAPER = /* glsl */ `
uniform vec2 uRes;
uniform float uSeed;
void main() {
  vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  vec2 p = uv * uRes + uSeed * 97.0;
  vec3 col = vec3(0.935, 0.895, 0.808);
  // broad cloudy mottling of the sheet
  float m = fbm(p * 0.0032);
  col *= 0.955 + 0.08 * m;
  col = mix(col, col * vec3(1.0, 0.97, 0.92), smoothstep(0.45, 0.8, fbm(p * 0.0011 + 4.0)) * 0.5);
  // fibres: some light translucent strands, some darker
  float f1 = fibres(p);
  float f2 = fibres(p * 1.7 + 50.0);
  col += vec3(0.022, 0.02, 0.016) * f1;
  col -= vec3(0.03, 0.033, 0.04) * f2 * 0.6;
  // speckles of bark in the pulp
  float sp = vnoise(p * 0.35);
  col -= vec3(0.12, 0.11, 0.1) * smoothstep(0.86, 0.97, sp) * step(0.7, vnoise(p * 0.02));
  // fine tooth
  col *= 0.985 + 0.03 * hash12(floor(p));
  // vignette, warm and soft
  vec2 q = uv - 0.5;
  q.x *= uRes.x / uRes.y * 0.75;
  float vig = smoothstep(0.25, 0.95, length(q));
  col = mix(col, col * vec3(0.72, 0.64, 0.54), vig * 0.55);
  finalColor = vec4(col, 1.0);
}
`;

const MOUNTAIN = /* glsl */ `
uniform vec2 uRes;
uniform float uSeed;
uniform float uBase;
uniform float uAmp;
uniform float uDark;
uniform float uFreq;
uniform float uMist;
void main() {
  vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  vec2 p = uv * uRes;
  float fx = uv.x * uFreq + uSeed;
  // ridged detail along the skyline
  float rd = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    float n = vnoise(vec2(fx, uSeed * 3.1 + float(i)));
    rd += amp * (1.0 - abs(n * 2.0 - 1.0));
    fx = fx * 2.07 + 3.7;
    amp *= 0.5;
  }
  // a few dominant, pointed massifs
  float big = vnoise(vec2(uv.x * uFreq * 0.9 + uSeed * 1.7, 2.0));
  float sharp = 1.0 - abs(vnoise(vec2(uv.x * uFreq * 1.6 + uSeed * 5.3, 7.0)) * 2.0 - 1.0);
  float peak = pow(smoothstep(0.1, 0.95, big), 1.4) * (0.55 + 0.45 * sharp * sharp);
  float r = peak * 1.25 + rd * 0.32 * (0.4 + peak);
  float ridge = uBase - uAmp * r;
  ridge += (vnoise(p * 0.06) - 0.5) * 0.004 + (vnoise(p * 0.4) - 0.5) * 0.0015;
  float d = uv.y - ridge;
  float inside = smoothstep(-0.0015, 0.003, d);
  // pigment pools along the ridge, then thins into the mist
  float body = 0.42 * exp(-d * 6.0) + 0.58 * exp(-d * 34.0);
  // texture strokes (cun) running down the slopes
  float cun = vnoise(vec2(p.x * 0.045 + uSeed, p.y * 0.005));
  float cun2 = vnoise(vec2(p.x * 0.11 - uSeed, p.y * 0.012));
  body *= 0.62 + 0.5 * cun + 0.22 * cun2;
  body *= 0.75 + 0.5 * fbm3(p * 0.008 + uSeed);
  float mist = smoothstep(ridge + 0.02, ridge + uMist, uv.y);
  mist = max(mist, smoothstep(uBase - 0.02, uBase + 0.12, uv.y));
  float a = uDark * inside * body * (1.0 - mist);
  a *= 0.86 + 0.28 * hash12(floor(p * 0.7));
  a = clamp(a, 0.0, 1.0);
  finalColor = vec4(vec3(0.07, 0.065, 0.07) * a, a);
}
`;

const SUN = /* glsl */ `
uniform vec2 uRes;
uniform float uSeed;
void main() {
  vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  vec2 c = uv * 2.0 - 1.0;
  vec2 p = uv * uRes;
  float r = length(c);
  float ang = atan(c.y, c.x);
  float edge = 0.9 + 0.025 * vnoise(vec2(ang * 3.0, uSeed)) + 0.012 * vnoise(vec2(ang * 19.0, uSeed));
  float a = 1.0 - smoothstep(edge - 0.015, edge + 0.01, r);
  // brushed wash inside: horizontal sweeps, granulation, a darker rim where pigment dried
  float sweep = vnoise(vec2(p.x * 0.004, p.y * 0.05) + uSeed);
  a *= 0.74 + 0.16 * sweep + 0.12 * fbm3(p * 0.03);
  a *= mix(1.0, 1.18, smoothstep(edge - 0.12, edge - 0.01, r));
  // bleed halo
  a += (1.0 - smoothstep(edge, edge + 0.08, r)) * 0.12 * (1.0 - step(edge, r) * 0.0);
  a = clamp(a, 0.0, 1.0) * 0.92;
  vec3 col = vec3(0.66, 0.07, 0.08);
  finalColor = vec4(col * a, a);
}
`;

const LIVING_INK = /* glsl */ `
uniform float uTime;
uniform float uBleed;
uniform float uWobble;
void main() {
  vec2 px = vTextureCoord * uInputSize.xy;
  // line boil, stepped like hand-drawn animation
  float t = floor(uTime * 9.0);
  vec2 w = vec2(vnoise(px * 0.03 + t * 1.73), vnoise(px * 0.03 + 31.0 - t * 1.31)) - 0.5;
  vec2 uv = vTextureCoord + w * uWobble * uInputSize.zw;
  vec4 c = texture(uTexture, uv);
  // capillary bleed into the paper, irregular along the fibres
  float fib = fibres(px * 1.3);
  float R = uBleed * (0.65 + 0.7 * vnoise(px * 0.045));
  vec4 h = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.3;
    vec2 o = vec2(cos(a), sin(a));
    h += texture(uTexture, uv + o * R * uInputSize.zw);
    h += texture(uTexture, uv + o * R * 0.45 * uInputSize.zw);
  }
  h /= 16.0;
  float soak = 0.26 + 0.42 * clamp(fib, 0.0, 1.0);
  vec4 halo = h * soak;
  // the paper drinks some pigment from thin ink
  c *= 0.95 + 0.05 * vnoise(px * 0.2);
  finalColor = c + halo * (1.0 - c.a);
}
`;

export function paperFilter(w: number, h: number) {
  return new Filter({
    glProgram: program('paper', PAPER),
    resources: {
      u: {
        uRes: { value: new Float32Array([w, h]), type: 'vec2<f32>' },
        uSeed: { value: 3.7, type: 'f32' },
      },
    },
  });
}

export interface MountainParams {
  seed: number;
  base: number;
  amp: number;
  dark: number;
  freq: number;
  mist: number;
}

export function mountainFilter(w: number, h: number, m: MountainParams) {
  return new Filter({
    glProgram: program('mountain', MOUNTAIN),
    resources: {
      u: {
        uRes: { value: new Float32Array([w, h]), type: 'vec2<f32>' },
        uSeed: { value: m.seed, type: 'f32' },
        uBase: { value: m.base, type: 'f32' },
        uAmp: { value: m.amp, type: 'f32' },
        uDark: { value: m.dark, type: 'f32' },
        uFreq: { value: m.freq, type: 'f32' },
        uMist: { value: m.mist, type: 'f32' },
      },
    },
  });
}

export function sunFilter(size: number) {
  return new Filter({
    glProgram: program('sun', SUN),
    resources: {
      u: {
        uRes: { value: new Float32Array([size, size]), type: 'vec2<f32>' },
        uSeed: { value: 1.3, type: 'f32' },
      },
    },
  });
}

export class LivingInkFilter extends Filter {
  constructor() {
    super({
      glProgram: program('living-ink', LIVING_INK),
      resources: {
        u: {
          uTime: { value: 0, type: 'f32' },
          uBleed: { value: 2.2, type: 'f32' },
          uWobble: { value: 1.1, type: 'f32' },
        },
      },
      padding: 0,
    });
  }
  get u() {
    return this.resources.u.uniforms as { uTime: number; uBleed: number; uWobble: number };
  }
}
