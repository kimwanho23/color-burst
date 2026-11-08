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

/** 짧은 잡음 (때리는 순간의 "탁" 소리). filter: 이 주파수 위(highpass)나 아래(lowpass)만 */
let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol = 0.1, when = 0, freq = 2000, type: BiquadFilterType = 'highpass') {
  if (!ac || !sfxBus) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + when;
  const src = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t); src.stop(t + dur + 0.02);
}

/** 콤보가 쌓일수록 음이 올라간다: 2콤보마다 반음, 최대 한 옥타브 */
const comboPitch = (combo: number) => 2 ** (Math.min(24, Math.max(0, combo)) / 24);

export const sfx = {
  /**
   * 원 잡기: 점수 글자 단계(1 평소, 2 콤보 보너스·반격, 3 피버, 4 잭팟·황금 원, 5 최고)에 맞춘 소리.
   * 콤보가 쌓일수록 음이 올라간다
   */
  hit: (tier: 1 | 2 | 3 | 4 | 5, combo = 0) => {
    const k = comboPitch(combo);
    noise(0.03, 0.12, 0, 2500);
    if (tier >= 4) {
      tone(1568, 0.07, 'square', 0.06); tone(2093, 0.16, 'square', 0.06, 0.06);
      if (tier === 5) { tone(90, 0.3, 'sine', 0.25, 0, 0.5); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, 0.05 + i * 0.04)); }
      return;
    }
    tone(660 * k, 0.07, 'triangle', 0.12);
    if (tier === 2) tone(1320 * k, 0.09, 'square', 0.05, 0.04);
    if (tier === 3) [830, 990].forEach((f, i) => tone(f * k, 0.09, 'triangle', 0.07, 0.03 + i * 0.03));
  },
  own: () => { tone(880, 0.08, 'square', 0.09); tone(1320, 0.1, 'square', 0.07, 0.05); },
  yellow: () => tone(660, 0.09, 'triangle', 0.14),
  steal: () => tone(300, 0.12, 'sawtooth', 0.06, 0, 0.7),
  /** 빈 곳: 낮고 짧은 "툭" */
  miss: () => { noise(0.04, 0.08, 0, 400, 'lowpass'); tone(120, 0.06, 'sine', 0.08, 0, 0.7); },
  rainbow: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.07, i * 0.05)),
  fever: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.08, i * 0.06)),
  comboBroken: () => tone(220, 0.2, 'triangle', 0.1, 0, 0.5),
  bossAppear: () => [110, 147, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.08, i * 0.12)),
  /** 보스 타격: 둔탁한 "퍽" */
  bossHit: () => { noise(0.06, 0.14, 0, 900, 'lowpass'); tone(140, 0.08, 'square', 0.08, 0, 0.6); },
  /** 방어형 보호막에 막힘: 맑은 금속음 */
  bossBlock: () => tone(1600, 0.08, 'triangle', 0.08, 0, 0.8),
  /** 보스 막타: 저음 "쿵" + 폭발 잡음 + 올라가는 화음 */
  bossKill: () => {
    tone(70, 0.45, 'sine', 0.3, 0, 0.5); noise(0.35, 0.18, 0, 700, 'lowpass');
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'square', 0.07, 0.08 + i * 0.06));
  },
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
  /** 레이저 예고·발사, 스턴, 자석 끌기 */
  laserWarn: () => [880, 880].forEach((f, i) => tone(f, 0.08, 'square', 0.05, i * 0.16)),
  /** 맵 패턴 경고: 낮게 울리는 사이렌 두 번 */
  patternWarn: () => { [330, 247, 330, 247].forEach((f, i) => tone(f, 0.16, 'sawtooth', 0.06, i * 0.18)); noise(0.3, 0.06, 0, 500, 'lowpass'); },
  laserFire: () => tone(1400, 0.3, 'sawtooth', 0.06, 0, 0.25),
  stun: () => [523, 440, 392].forEach((f, i) => tone(f, 0.1, 'triangle', 0.09, i * 0.07)),
  pull: () => tone(300, 0.2, 'sine', 0.08, 0, 2.2),
  /** 방해에 걸림, 저격, 오오라 */
  sabotage: () => [600, 450, 300].forEach((f, i) => tone(f, 0.12, 'sawtooth', 0.06, i * 0.06)),
  snipe: () => { tone(2200, 0.05, 'square', 0.08); tone(90, 0.35, 'sawtooth', 0.1, 0.04, 0.5); },
  aura: () => tone(220, 0.25, 'sine', 0.1, 0, 0.6),
  /** 라운드 종료 */
  roundEnd: () => [784, 659, 523].forEach((f, i) => tone(f, 0.16, 'square', 0.08, i * 0.1)),
  /** 웨이브 예고: 올라가는 휙 소리 */
  wave: () => tone(260, 0.35, 'sawtooth', 0.05, 0, 3),
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
