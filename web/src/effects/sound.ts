/**
 * Spectacle sound (DESIGN.md §7) — synthesized via Web Audio so there are no audio
 * files to bundle or fetch (zero-asset, offline, $0). Each cue is a short envelope of
 * oscillators/noise: dice clatter, the roll concussion, success/crit stings, wet hits,
 * a feeding gulp, stamps. Muteable, and silent until the player opts in (browser
 * autoplay policy needs a user gesture, which the enable toggle provides).
 */
export type Cue =
  | "clatter"
  | "concussion"
  | "success"
  | "crit"
  | "discard"
  | "hit"
  | "feed"
  | "defend"
  | "stamp"
  | "downed";

export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = false;

  /** Create/resume the audio graph. Must be called from a user gesture. */
  enable(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
    }
    void this.ctx.resume();
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  play(cue: Cue): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const at = this.ctx.currentTime;
    switch (cue) {
      case "clatter":
        for (let i = 0; i < 5; i++) this.tick(at + i * 0.035 + Math.abs(Math.sin(i * 12.9)) * 0.02);
        break;
      case "concussion":
        this.thump(at, 120, 0.6);
        this.burst(at, 0.18, 1200, 0.35);
        break;
      case "success":
        this.tone(at, 660, 0.12, "triangle", 0.25);
        break;
      case "crit":
        this.tone(at, 523, 0.1, "sawtooth", 0.3);
        this.tone(at + 0.08, 784, 0.18, "sawtooth", 0.3);
        this.burst(at, 0.25, 2400, 0.2);
        break;
      case "discard":
        this.burst(at, 0.2, 600, 0.25);
        break;
      case "hit":
        this.thump(at, 90, 0.4);
        this.burst(at, 0.12, 800, 0.3);
        break;
      case "feed":
        this.glide(at, 220, 520, 0.35, 0.28); // a rising gulp
        break;
      case "defend":
        this.tick(at);
        this.thump(at, 160, 0.3);
        break;
      case "stamp":
        this.thump(at, 70, 0.45);
        break;
      case "downed":
        this.glide(at, 300, 80, 0.6, 0.3);
        break;
    }
  }

  // ── synthesis primitives ──────────────────────────────────────────────
  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private env(at: number, dur: number, peak: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(this.master!);
    return g;
  }

  private tone(at: number, freq: number, dur: number, type: OscillatorType, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.env(at, dur, peak));
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private glide(at: number, from: number, to: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    o.connect(this.env(at, dur, peak));
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private thump(at: number, freq: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, at + 0.18);
    o.connect(this.env(at, 0.22, peak));
    o.start(at);
    o.stop(at + 0.26);
  }

  private burst(at: number, dur: number, cutoff: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    src.connect(filter);
    filter.connect(this.env(at, dur, peak));
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private tick(at: number): void {
    this.burst(at, 0.05, 2600, 0.18);
  }
}
