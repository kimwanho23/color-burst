/**
 * 배경음악과 효과음. 전부 Web Audio로 합성하므로 저작권 문제가 없다.
 * 나중에 CC0 음원 파일로 바꾸려면 startMusic/stopMusic만 교체하면 된다.
 */
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let timer: number | null = null;
let nextNote = 0;
let step = 0;
let fast = () => false;
/** 음량 0~1, muted면 전체 무음 */
const vol = { music: 0.6, sfx: 0.8, muted: false };

export function initAudio() {
  if (!ac) {
    try {
      ac = new AudioContext();
      master = ac.createGain();
      musicBus = ac.createGain();
      sfxBus = ac.createGain();
      musicBus.connect(master); sfxBus.connect(master);
      master.connect(ac.destination);
      applyVolume();
    } catch { ac = null; }
  }
  if (ac?.state === 'suspended') ac.resume();
}

function applyVolume() {
  if (!master || !musicBus || !sfxBus) return;
  master.gain.value = vol.muted ? 0 : 0.5;
  musicBus.gain.value = vol.music;
  sfxBus.gain.value = vol.sfx;
}

export function setVolume(v: Partial<typeof vol>) {
  Object.assign(vol, v);
  applyVolume();
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.12, when = 0, slide = 0, bus: 'sfx' | 'music' = 'sfx') {
  const out = bus === 'music' ? musicBus : sfxBus;
  if (!ac || !out) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  own: () => { tone(880, 0.08, 'square', 0.09); tone(1320, 0.1, 'square', 0.07, 0.05); },
  yellow: () => tone(660, 0.09, 'triangle', 0.14),
  steal: () => tone(300, 0.12, 'sawtooth', 0.06, 0, 0.7),
  miss: () => tone(160, 0.12, 'sine', 0.12, 0, 0.6),
  rainbow: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.07, i * 0.05)),
  fever: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.08, i * 0.06)),
  comboBroken: () => tone(220, 0.2, 'triangle', 0.1, 0, 0.5),
  bossAppear: () => [110, 147, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.08, i * 0.12)),
  bossHit: () => tone(180, 0.06, 'square', 0.08, 0, 0.6),
  bossKill: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'square', 0.08, i * 0.07)),
  pickOpen: () => [392, 494, 587].forEach((f, i) => tone(f, 0.12, 'triangle', 0.1, i * 0.08)),
  pickChoose: () => { tone(784, 0.08, 'square', 0.08); tone(1175, 0.14, 'square', 0.07, 0.07); },
  legend: () => [784, 988, 1175, 1568, 1976, 2349].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.06)),
  tick: () => tone(1000, 0.06, 'square', 0.06),
  /** 아이템 원 획득 (등급이 높을수록 음이 많다) */
  item: (tier: number) => [659, 880, 1175, 1568].slice(0, 2 + tier).forEach((f, i) => tone(f, 0.1, 'triangle', 0.1, i * 0.05)),
  /** 잭팟: 배율이 클수록 높고 길게 */
  jackpot: (mult: number) => {
    const n = mult >= 3 ? 6 : mult >= 2 ? 4 : 3;
    [1047, 1319, 1568, 2093, 2637, 3136].slice(0, n).forEach((f, i) => tone(f, 0.09, 'square', 0.06, i * 0.045));
  },
  bomb: () => { tone(120, 0.3, 'sawtooth', 0.12, 0, 0.4); tone(60, 0.35, 'square', 0.08, 0.02, 0.5); },
  clear: () => [262, 392, 523, 784, 1047].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.06, i * 0.04)),
  freeze: () => tone(1800, 0.4, 'sine', 0.08, 0, 0.3),
  zone: () => tone(440, 0.25, 'triangle', 0.1, 0, 1.5),
  /** 랜덤 이벤트: 등장음, 룰렛이 한 칸 넘어갈 때마다 틱, 결과음 */
  event: () => [523, 659, 784].forEach((f, i) => tone(f, 0.08, 'square', 0.07, i * 0.05)),
  eventTick: () => tone(1400, 0.025, 'square', 0.04),
  eventResult: () => { tone(988, 0.1, 'triangle', 0.1); tone(1319, 0.18, 'triangle', 0.09, 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.07, i * 0.12)),
  lose: () => [392, 349, 330].forEach((f, i) => tone(f, 0.2, 'square', 0.07, i * 0.12)),
};

const BASS = [110, 110, 87.31, 87.31, 130.81, 130.81, 98, 98];
const ARP = [[440, 523.25, 659.25, 523.25], [349.23, 440, 523.25, 440], [523.25, 659.25, 783.99, 659.25], [392, 493.88, 587.33, 493.88]];

function schedule() {
  if (!ac) return;
  const f = fast();
  const eighth = 60 / (f ? 156 : 128) / 2;
  while (nextNote < ac.currentTime + 0.12) {
    const when = nextNote - ac.currentTime;
    const bar = Math.floor(step / 8) % 4, i = step % 8;
    if (i % 2 === 0) tone(BASS[(bar * 2 + (i >> 2)) % 8], eighth * 1.8, 'triangle', 0.16, when, 0, 'music');
    tone(ARP[bar][i % 4] * (f ? 2 : 1), eighth * 0.8, 'square', 0.035, when, 0, 'music');
    if (i % 4 === 2) tone(2400, 0.03, 'sawtooth', 0.015, when, 0, 'music');
    nextNote += eighth; step++;
  }
}

/** isFast: 피버 중일 때 true를 돌려주면 템포가 빨라진다 */
export function startMusic(isFast: () => boolean) {
  fast = isFast;
  if (!ac) return;
  nextNote = ac.currentTime + 0.05;
  stopMusic();
  timer = window.setInterval(schedule, 25);
}

/** 새로고침 후 첫 클릭처럼, 음악이 아직 안 나오고 있으면 시작 */
export function ensureMusic() {
  initAudio();
  if (timer === null && ac) startMusic(fast);
}

export function stopMusic() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
