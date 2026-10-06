// Tiny synthesised sound effects; no audio assets to ship.

let ctx: AudioContext | null = null;
let muted = localStorage.getItem("cantstop:muted") === "1";

function ac(): AudioContext | null {
  if (muted) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  localStorage.setItem("cantstop:muted", value ? "1" : "0");
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? "triangle";
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; filter?: number; filterEnd?: number } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(opts.filter ?? 2000, t);
  if (opts.filterEnd) f.frequency.exponentialRampToValueAtTime(opts.filterEnd, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  rattle() {
    for (let i = 0; i < 9; i++) noise(0.04, { gain: 0.12, delay: i * 0.07 + Math.random() * 0.03, filter: 3500 });
    for (let i = 0; i < 4; i++) tone(500 + Math.random() * 300, 0.05, { type: "square", gain: 0.03, delay: 0.75 + i * 0.06 });
  },
  hop() {
    tone(420, 0.12, { slide: 720, gain: 0.08 });
  },
  pop() {
    tone(300, 0.1, { slide: 900, gain: 0.1, type: "sine" });
  },
  select() {
    tone(660, 0.06, { gain: 0.06, type: "sine" });
  },
  bank() {
    [523, 659, 784].forEach((f, i) => tone(f, 0.22, { delay: i * 0.08, gain: 0.1 }));
  },
  bust() {
    noise(1.8, { gain: 0.45, filter: 900, filterEnd: 80 });
    tone(220, 0.9, { type: "sawtooth", slide: 55, gain: 0.12 });
    tone(165, 1.1, { type: "sawtooth", slide: 40, gain: 0.08, delay: 0.1 });
  },
  claim() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { delay: i * 0.1, gain: 0.12, type: "square" }));
  },
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, { delay: i * 0.13, gain: 0.12, type: "square" }));
  },
  turn() {
    tone(880, 0.08, { gain: 0.05, type: "sine" });
    tone(1175, 0.1, { gain: 0.05, type: "sine", delay: 0.08 });
  },
};
