'use client';
/**
 * All sound is generated with the Web Audio API (no audio files): a generative tune in one of several
 * styles that plays from the first tap and gets quieter at the table, a card sound and a sharp «slap»
 * when a card is slammed down (double tap). Browsers allow audio only after a user gesture, so
 * `unlock()` is called from the first tap/keypress.
 */

type Level = 'lobby' | 'game';
export const MUSIC_THEMES = ['jazz', 'calm', 'guitar', 'ambient'] as const;
export type MusicTheme = (typeof MUSIC_THEMES)[number];
export const CARD_SOUNDS = ['paper', 'wood', 'felt'] as const;
export type CardSound = (typeof CARD_SOUNDS)[number];

const PREFS_KEY = 'bb_sound';
const MUSIC_VOLUME: Record<Level, number> = { lobby: 0.45, game: 0.18 };

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Per style: chords (MIDI), melody scale, seconds per chord. */
const THEMES: Record<MusicTheme, { chords: number[][]; scale: number[]; bar: number }> = {
  // calm: D minor, Dm – B♭ – F – C, sparse plucked pentatonic melody over soft pads
  calm: { chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], scale: [62, 65, 67, 69, 72, 74, 77, 79, 81], bar: 4.8 },
  // jazz: lounge electric piano, Dm9 – G13 – Cmaj9 – A7, walking bass, brushes
  jazz: { chords: [[50, 53, 57, 60, 64], [43, 53, 57, 59, 64], [48, 52, 55, 59, 62], [45, 55, 58, 61, 64]], scale: [62, 64, 65, 67, 69, 71, 72, 74, 76], bar: 3.2 },
  // guitar: plucked nylon-string arpeggios, Am – F – C – G
  guitar: { chords: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 52, 55, 60, 64], [43, 50, 55, 59, 62]], scale: [69, 72, 74, 76, 79, 81], bar: 3.6 },
  // ambient: slow evolving pads, rare bells
  ambient: { chords: [[50, 52, 57, 64], [46, 53, 57, 62], [41, 48, 55, 57, 64], [48, 50, 55, 62]], scale: [74, 76, 79, 81, 86], bar: 7 },
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private strings = new Map<number, AudioBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private bar = 0;
  private melodyIdx = 3;
  private level: Level = 'lobby';
  musicOn = true;
  sfxOn = true;
  theme: MusicTheme = 'jazz';
  cardSound: CardSound = 'wood';
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      if (typeof p.music === 'boolean') this.musicOn = p.music;
      if (typeof p.sfx === 'boolean') this.sfxOn = p.sfx;
      if (MUSIC_THEMES.includes(p.theme)) this.theme = p.theme;
      if (CARD_SOUNDS.includes(p.card)) this.cardSound = p.card;
    } catch {
      /* storage unavailable */
    }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn, theme: this.theme, card: this.cardSound }));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((f) => f());
  }

  /** Create/resume the audio context; must run inside a user gesture. */
  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      this.music = ctx.createGain();
      this.music.gain.value = 0;
      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxOn ? 1 : 0;
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.8);
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      this.music.connect(master);
      this.music.connect(this.reverb);
      this.reverb.connect(wet).connect(master);
      this.sfx.connect(master);
      this.noise = this.whiteNoise(1);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void ctx.suspend();
        else void ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyMusic();
  }

  setLevel(level: Level) {
    this.level = level;
    this.applyMusic();
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    this.applyMusic();
    this.save();
  }

  toggleSfx() {
    this.sfxOn = !this.sfxOn;
    if (this.ctx) this.sfx.gain.setTargetAtTime(this.sfxOn ? 1 : 0, this.ctx.currentTime, 0.05);
    this.save();
  }

  setTheme(theme: MusicTheme) {
    this.theme = theme;
    this.bar = 0;
    if (this.ctx) this.nextBar = Math.max(this.nextBar, this.ctx.currentTime + 0.3);
    this.save();
  }

  setCardSound(c: CardSound) {
    this.cardSound = c;
    this.save();
    this.card();
  }

  private applyMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const target = this.musicOn ? MUSIC_VOLUME[this.level] : 0;
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.setTargetAtTime(target, ctx.currentTime, 1.2);
    if (this.musicOn && !this.timer) {
      this.nextBar = ctx.currentTime + 0.2;
      this.timer = setInterval(() => this.schedule(), 250);
    } else if (!this.musicOn && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------- music ----------

  private schedule() {
    const ctx = this.ctx!;
    while (this.nextBar < ctx.currentTime + 1.5) {
      const th = THEMES[this.theme];
      const chord = th.chords[this.bar % th.chords.length];
      const t = this.nextBar;
      ({ calm: () => this.barCalm(t, chord, th), jazz: () => this.barJazz(t, chord, th), guitar: () => this.barGuitar(t, chord, th), ambient: () => this.barAmbient(t, chord, th) })[this.theme]();
      this.nextBar += th.bar;
      this.bar += 1;
    }
  }

  private walk(scale: number[], steps = [-2, -1, -1, 0, 1, 1, 2]) {
    this.melodyIdx = Math.max(0, Math.min(scale.length - 1, this.melodyIdx + pick(steps)));
    return scale[this.melodyIdx];
  }

  private barCalm(t: number, chord: number[], th: { scale: number[]; bar: number }) {
    for (const m of chord) {
      this.voice(t, midiHz(m), th.bar + 1.5, 0.05, 'triangle', 1.6, 900);
      this.voice(t, midiHz(m) * 1.003, th.bar + 1.5, 0.03, 'sine', 1.6, 900);
    }
    this.voice(t, midiHz(chord[0] - 12), th.bar, 0.09, 'sine', 0.4, 400);
    for (let i = 0; i < 6; i++) {
      if (Math.random() < 0.45) continue;
      this.pluck(t + (i * th.bar) / 6 + Math.random() * 0.05, midiHz(this.walk(th.scale)), 0.07, 2.2);
    }
  }

  private barJazz(t: number, chord: number[], th: { scale: number[]; bar: number }) {
    const beat = th.bar / 4;
    // electric piano chord, comped on 1 and the «and» of 2
    for (const at of [t, t + beat * 1.5]) for (const m of chord.slice(1)) this.epiano(at, midiHz(m), at === t ? 0.035 : 0.022);
    // walking bass
    const root = chord[0] - 12;
    [0, 3, 5, 7].forEach((step, i) => this.voice(t + i * beat, midiHz(root + step), beat * 0.95, 0.12, 'sine', 0.02, 500));
    // brushes on 2 and 4
    for (const i of [1, 3]) this.brush(t + i * beat);
    // a few melody notes
    for (let i = 0; i < 4; i++) if (Math.random() < 0.35) this.epiano(t + i * beat + beat * 0.66, midiHz(this.walk(th.scale)), 0.03);
  }

  private barGuitar(t: number, chord: number[], th: { scale: number[]; bar: number }) {
    // fingerpicked arpeggio: bass, then up and down the chord
    const order = [0, 2, 3, 4, 1, 3, 2, 4];
    const step = th.bar / order.length;
    order.forEach((idx, i) => this.string(t + i * step + Math.random() * 0.01, chord[idx], i === 0 ? 0.6 : 0.38));
    if (Math.random() < 0.5) this.string(t + step * 5, this.walk(th.scale), 0.42);
  }

  private barAmbient(t: number, chord: number[], th: { scale: number[]; bar: number }) {
    for (const m of chord) {
      this.voice(t, midiHz(m), th.bar + 3, 0.04, 'sine', 3, 1200);
      this.voice(t, midiHz(m + 12) * 1.004, th.bar + 3, 0.012, 'triangle', 3.5, 1600);
    }
    if (Math.random() < 0.7) this.pluck(t + 1 + Math.random() * (th.bar - 2), midiHz(pick(th.scale)), 0.035, 4);
  }

  private voice(t: number, hz: number, dur: number, vol: number, type: OscillatorType, attack: number, cutoff: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - Math.min(1.5, dur / 3)));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private pluck(t: number, hz: number, vol: number, decay: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = hz * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.1);
    o2.stop(t + decay + 0.1);
  }

  /** Electric-piano tone: sine with a bell partial and a long decay. */
  private epiano(t: number, hz: number, vol: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    for (const [mul, v] of [[1, 1], [2, 0.25], [3.5, 0.08]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz * mul;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 2.5);
    }
    g.connect(this.music);
  }

  private brush(t: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 6000;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(f).connect(g).connect(this.music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.3);
  }

  /** Plucked string (Karplus–Strong), cached per note. */
  private string(t: number, midi: number, vol: number) {
    const ctx = this.ctx!;
    let buf = this.strings.get(midi);
    if (!buf) {
      const sr = ctx.sampleRate;
      const n = Math.floor(sr * 2.5);
      buf = ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(sr / midiHz(midi)));
      for (let i = 0; i < period; i++) d[i] = Math.random() * 2 - 1;
      for (let i = period; i < n; i++) d[i] = 0.497 * (d[i - period] + d[i - period + 1]);
      this.strings.set(midi, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.music);
    src.start(t);
  }

  // ---------- effects ----------

  /** Kept for old callers: the checker sound. */
  card() {
    this.checker();
  }

  /** Dice rattling in the hand and tumbling on the board. */
  dice() {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.045 + Math.random() * 0.02;
      this.noiseBurst(at, 0.025, 'bandpass', 3200 + Math.random() * 1800, 3, 0.35);
      this.knock(at, 600 + Math.random() * 500, 0.12, 0.03);
    }
    for (let i = 0; i < 3; i++) this.knock(t + 0.36 + i * 0.09 + Math.random() * 0.03, 260 + Math.random() * 120, 0.35 - i * 0.08, 0.06);
  }

  /** A checker put down on the board, in the chosen style. */
  checker() {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime;
    if (this.cardSound === 'paper') {
      // bone / ivory checker: a bright, short click
      this.noiseBurst(t, 0.02, 'bandpass', 4200, 3, 0.4);
      this.knock(t, 900, 0.22, 0.03);
      this.knock(t + 0.001, 420, 0.25, 0.05);
    } else if (this.cardSound === 'wood') {
      // a wooden checker on a wooden board
      this.noiseBurst(t, 0.03, 'bandpass', 2400, 2, 0.35);
      this.knock(t, 300, 0.45, 0.06);
      this.knock(t + 0.002, 650, 0.12, 0.03);
    } else {
      // muffled, soft
      this.noiseBurst(t, 0.08, 'lowpass', 900, 0.7, 0.35);
      this.knock(t + 0.005, 140, 0.35, 0.09);
    }
  }

  /** A short soft «pop» for a quick phrase / emoji. */
  pop() {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** A card slammed down («ճտոց»): a sharp crack and a heavier knock. */
  slap() {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.045, 'highpass', 1800, 0.7, 1.1);
    this.noiseBurst(t + 0.004, 0.12, 'bandpass', 900, 1.2, 0.5);
    this.knock(t, 95, 0.7, 0.14);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private knock(t: number, hz: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private whiteNoise(seconds: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
    }
    return b;
  }
}

let engine: SoundEngine | null = null;
/** The shared sound engine (browser only). */
export function sound(): SoundEngine | null {
  if (typeof window === 'undefined') return null;
  engine ??= new SoundEngine();
  (window as any).__bbSound = engine; // handy for trying sounds from the console
  return engine;
}
