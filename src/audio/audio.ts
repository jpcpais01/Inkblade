// Procedural soundscape: wind, paper rustle, taiko, steel, a breathy shakuhachi.
// Everything is synthesised with Web Audio; nothing to download.

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windLevel = 0.5;
  private fluteBus!: GainNode;
  muted = false;

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);

    // noise source shared by everything
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // a long, soft hall built from decaying noise
    const irLen = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;
    this.verbSend.connect(this.reverb).connect(this.master);

    this.fluteBus = ctx.createGain();
    this.fluteBus.gain.value = 0;
    this.fluteBus.connect(this.master);
    this.fluteBus.connect(this.verbSend);

    this.startWind();
  }

  private now() {
    return this.ctx!.currentTime;
  }

  private noiseSrc() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random() * 2;
    return s;
  }

  private env(g: GainNode, t: number, a: number, peak: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  // ---- ambience

  private startWind() {
    const ctx = this.ctx!;
    const src = this.noiseSrc();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(lp).connect(this.windGain).connect(this.master);
    src.start();
    const gust = () => {
      if (!this.ctx) return;
      const t = this.now();
      const g = (0.025 + Math.random() * 0.06) * this.windLevel * (this.muted ? 0 : 1);
      this.windGain.gain.setTargetAtTime(g, t, 0.9);
      this.windFilter.frequency.setTargetAtTime(280 + Math.random() * 700, t, 1.2);
      setTimeout(gust, 900 + Math.random() * 1800);
    };
    gust();
  }

  setWind(level: number) {
    this.windLevel = level;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.now(), 0.05);
  }

  // ---- foley

  rustle(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2400 + Math.random() * 2000;
    hp.Q.value = 0.7;
    const g = ctx.createGain();
    // crackly: several tiny bursts
    g.gain.setValueAtTime(0.0001, t);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const ti = t + i * 0.02 + Math.random() * 0.025;
      g.gain.linearRampToValueAtTime(0.06 * strength * (0.4 + Math.random() * 0.6), ti);
      g.gain.linearRampToValueAtTime(0.004, ti + 0.012);
    }
    g.gain.linearRampToValueAtTime(0.0001, t + n * 0.03 + 0.12);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
  }

  swish(heavy: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now() + 0.02;
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 2600 : 3600, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.35 : 0.24, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
  }

  taiko(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 * (0.85 + 0.15 * power), t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const g = ctx.createGain();
    this.env(g, t, 0.006, 0.9 * power, 0.9 + power * 0.5);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 2);
    // skin slap
    const src = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.002, 0.5 * power, 0.12);
    src.connect(lp).connect(g2).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  steel(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const f0 = 820 + Math.random() * 180;
    const ratios = [1, 2.76, 5.4, 8.93, 13.34];
    const out = ctx.createGain();
    out.gain.value = 0.16 * power;
    out.connect(this.master);
    out.connect(this.verbSend);
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      this.env(g, t, 0.002, 0.9 / (i + 1), 2.6 / (1 + i * 0.6));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 3);
    });
    // the grind of edge on edge
    const src = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 0.35 * power, 0.09);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  cut(heavy: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    bp.Q.value = 2;
    const g = ctx.createGain();
    this.env(g, t, 0.003, heavy ? 0.7 : 0.5, 0.22);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.004, 0.5, 0.3);
    o.connect(g2).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 2300;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 0.15, 0.06);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5000;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.001, 0.25, 0.025);
    src.connect(bp).connect(g2).connect(this.master);
    src.start(t);
    src.stop(t + 0.1);
  }

  stamp() {
    if (!this.ctx) return;
    this.taiko(0.55);
    this.rustle(1.6);
  }

  kill() {
    if (!this.ctx) return;
    this.cut(true);
    this.taiko(1.4);
    setTimeout(() => this.steel(0.6), 30);
  }

  // ---- shakuhachi

  /** A slow phrase in the miyako-bushi mode, breathy and bent. */
  shakuhachi(volume = 0.5) {
    if (!this.ctx) return;
    const t0 = this.now() + 0.15;
    this.fluteBus.gain.cancelScheduledValues(t0);
    this.fluteBus.gain.setValueAtTime(volume, t0);
    // D5 Eb5 G5 A5 Bb5 D6 (miyako-bushi)
    const D = 587.33;
    const phrase: [number, number, number][] = [
      // [freq, start, duration]
      [D, 0, 1.9],
      [D * 1.0595, 2.0, 0.55],
      [D, 2.55, 1.2],
      [D * 0.75, 3.9, 2.4],
    ];
    for (const [f, s, d] of phrase) this.note(f, t0 + s, d);
  }

  fadeFlute(seconds = 1.2) {
    if (!this.ctx) return;
    const t = this.now();
    this.fluteBus.gain.cancelScheduledValues(t);
    this.fluteBus.gain.setValueAtTime(this.fluteBus.gain.value, t);
    this.fluteBus.gain.linearRampToValueAtTime(0, t + seconds);
  }

  private note(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    // meri: scoop up into the note
    o.frequency.setValueAtTime(freq * 0.965, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.28);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.8);
    vib.connect(vibG).connect(o.frequency);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(freq * 2 * 0.965, t);
    o2.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.28);
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o2.connect(g2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.32);
    g.gain.setValueAtTime(0.16, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.11, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    o.connect(g);
    g2.connect(g);
    // breath through the bore
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2;
    bp.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
    ng.gain.exponentialRampToValueAtTime(0.06, t + 0.5);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    n.connect(bp).connect(ng).connect(this.fluteBus);
    g.connect(this.fluteBus);
    for (const s of [o, o2, vib]) {
      s.start(t);
      s.stop(t + dur + 0.4);
    }
    n.start(t);
    n.stop(t + dur + 0.4);
  }
}

export const sound = new Sound();
