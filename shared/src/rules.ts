/**
 * 게임 규칙. 프레임워크와 무관한 순수 TypeScript.
 * 서버(판정)와 클라이언트(표시)가 같은 파일을 쓴다.
 * 밸런스 조정은 RULES 값만 바꾸면 된다.
 */

/** 논리 필드 크기. 클라이언트는 화면 크기에 맞춰 이 좌표계를 확대/축소해서 그린다. */
export const FIELD = { w: 1600, h: 900 } as const;
export const MAX_PLAYERS = 4;

export const COLORS = [
  { name: '코랄', hex: '#ff5d73', shape: 'tri' },
  { name: '블루', hex: '#4dabf7', shape: 'square' },
  { name: '그린', hex: '#51cf66', shape: 'diamond' },
  { name: '퍼플', hex: '#c39bff', shape: 'plus' },
] as const;
export const YELLOW = '#ffd43b';

/** 방 규칙과 상관없이 고정인 값 */
export const RULES = {
  countdownMs: 3_000,
  finalRushMs: 10_000,
  comboBonusEvery: 10,
  comboBonus: 5,
  points: { own: 3, yellow: 2, rainbow: 5, stealCalm: 1, counter: 4 },
  fever: { own: 12, yellow: 6, rainbow: 25, stealCalm: -20, miss: -10 },
  yellowChance: 0.33,
  /** 꼴찌 보정이 켜졌을 때 꼴찌의 피버 충전 배율 */
  comebackGain: 1.25,
  /** 클릭 판정 여유(필드 단위) */
  hitPad: 12,
  /** 매크로 방지: 1인 초당 최대 클릭 */
  maxClicksPerSec: 15,
} as const;

// ---------- 방 규칙 (방장이 대기실에서 설정) ----------

export interface RoomRules {
  /** 원 속도 배율 */
  speed: number;
  /** 원 개수 배율 (생성 간격의 역수) */
  density: number;
  /** 한 판 시간(초) */
  roundSec: number;
  feverMult: number;
  feverSec: number;
  /** 피버 게이지 충전 속도 배율 */
  feverGain: number;
  /** 무지개 원 확률(%) */
  rainbowPct: number;
  /** 평상시 견제 시 페널티(콤보 끊김, 게이지 감소, 표적) */
  stealPenalty: boolean;
  /** 표적 시간(초) */
  markSec: number;
  /** 꼴찌는 피버 게이지가 더 빨리 참 */
  comeback: boolean;
  /** 보스 원 등장 */
  boss: boolean;
}

/** 각 설정에서 고를 수 있는 값. 화면의 선택지와 서버 검사에 같이 쓴다 */
export const RULE_CHOICES = {
  speed: [0.75, 1, 1.25, 1.5],
  density: [0.75, 1, 1.3],
  roundSec: [30, 60, 90, 120],
  feverMult: [2, 3, 4, 5],
  feverSec: [4, 5, 7, 10, 12],
  feverGain: [0.7, 1, 1.4],
  rainbowPct: [0, 3, 6, 10],
  markSec: [0, 2, 4, 6, 8],
} as const satisfies Partial<Record<keyof RoomRules, readonly number[]>>;

export const DEFAULT_RULES: RoomRules = {
  speed: 1, density: 1, roundSec: 60,
  feverMult: 3, feverSec: 7, feverGain: 1,
  rainbowPct: 3, stealPenalty: true, markSec: 4,
  comeback: false, boss: true,
};

export const PRESETS = {
  basic: { name: '기본', desc: '표준 규칙', rules: DEFAULT_RULES },
  party: {
    name: '파티', desc: '피버가 자주, 세게 터지는 정신없는 판',
    rules: { ...DEFAULT_RULES, density: 1.3, feverMult: 5, feverSec: 10, feverGain: 1.4, rainbowPct: 10, comeback: true },
  },
  hardcore: {
    name: '하드코어', desc: '빠르고 많은 원, 짧은 피버',
    rules: { ...DEFAULT_RULES, speed: 1.5, density: 1.3, feverMult: 2, feverSec: 4, feverGain: 0.7, rainbowPct: 0 },
  },
  chill: {
    name: '느긋하게', desc: '천천히, 처음 하는 친구와 함께',
    rules: { ...DEFAULT_RULES, speed: 0.75, density: 0.75, roundSec: 90, comeback: true },
  },
} as const satisfies Record<string, { name: string; desc: string; rules: RoomRules }>;
export type PresetId = keyof typeof PRESETS;

/** 현재 규칙이 어떤 프리셋과 같은지. 다르면 null(사용자 설정) */
export function matchPreset(r: RoomRules): PresetId | null {
  for (const [id, p] of Object.entries(PRESETS)) {
    if ((Object.keys(r) as (keyof RoomRules)[]).every((k) => r[k] === p.rules[k])) return id as PresetId;
  }
  return null;
}

/** 클라이언트가 보낸 값을 허용된 선택지로만 반영 */
export function sanitizeRules(base: RoomRules, input: Partial<RoomRules>): RoomRules {
  const out = { ...base };
  for (const [k, choices] of Object.entries(RULE_CHOICES) as [keyof typeof RULE_CHOICES, readonly number[]][]) {
    const v = input[k];
    if (typeof v === 'number' && choices.includes(v)) out[k] = v;
  }
  for (const k of ['stealPenalty', 'comeback', 'boss'] as const) {
    if (typeof input[k] === 'boolean') out[k] = input[k]!;
  }
  return out;
}

/** 판정에 쓰는 계산용 규칙 */
export interface GameRules {
  roundMs: number;
  feverMs: number;
  feverMult: number;
  markMs: number;
  stealPenalty: boolean;
  speed: number;
  density: number;
  feverGain: number;
  rainbowChance: number;
  comeback: boolean;
  boss: boolean;
}

export function toGameRules(r: RoomRules): GameRules {
  return {
    roundMs: r.roundSec * 1000,
    feverMs: r.feverSec * 1000,
    feverMult: r.feverMult,
    markMs: r.markSec * 1000,
    stealPenalty: r.stealPenalty,
    speed: r.speed,
    density: r.density,
    feverGain: r.feverGain,
    rainbowChance: r.rainbowPct / 100,
    comeback: r.comeback,
    boss: r.boss,
  };
}

export type ColorIndex = 0 | 1 | 2 | 3;
export type CircleKind = ColorIndex | 'y' | 'rainbow';

export interface Circle {
  id: number;
  kind: CircleKind;
  /** 발사 방향(라디안) */
  angle: number;
  /** 필드 단위/초 */
  speed: number;
  r: number;
  /** 서버 시각(ms) */
  born: number;
}

export interface PlayerState {
  id: string;
  name: string;
  color: ColorIndex;
  bot: boolean;
  connected: boolean;
  score: number;
  combo: number;
  /** 0~100. 피버 중에는 0 */
  fever: number;
  feverUntil: number;
  markedUntil: number;
}

export type ClaimType = 'own' | 'yellow' | 'rainbow' | 'steal' | 'feverSteal' | 'counter';

export interface ClaimResult {
  type: ClaimType;
  gained: number;
  comboBonus: boolean;
  feverStarted: boolean;
  /** 이 클릭으로 콤보가 끊긴 상대 id */
  brokeComboOf: string | null;
  /** 이 클릭으로 표적이 됐는지 */
  marked: boolean;
}

export function newPlayer(id: string, name: string, color: ColorIndex, bot = false): PlayerState {
  return { id, name, color, bot, connected: true, score: 0, combo: 0, fever: 0, feverUntil: 0, markedUntil: 0 };
}

export function resetForRound(p: PlayerState) {
  p.score = 0; p.combo = 0; p.fever = 0; p.feverUntil = 0; p.markedUntil = 0;
}

export const isFever = (p: PlayerState, now: number) => now < p.feverUntil;
export const isMarked = (p: PlayerState, now: number) => now < p.markedUntil;

/** 원의 위치는 발사 정보와 시각만으로 결정된다. 그래서 서버는 생성 정보만 보내면 된다. */
export function circlePos(c: Circle, t: number) {
  const d = (c.speed * Math.max(0, t - c.born)) / 1000;
  return { x: FIELD.w / 2 + Math.cos(c.angle) * d, y: FIELD.h / 2 + Math.sin(c.angle) * d };
}

export function isOut(c: Circle, t: number) {
  const p = circlePos(c, t);
  return p.x < -c.r || p.x > FIELD.w + c.r || p.y < -c.r || p.y > FIELD.h + c.r;
}

export function isHit(c: Circle, t: number, x: number, y: number) {
  const p = circlePos(c, t);
  const rr = c.r + RULES.hitPad;
  return (p.x - x) ** 2 + (p.y - y) ** 2 <= rr * rr;
}

/** 경과 시간에 따른 원 생성 간격(ms) */
export function spawnInterval(elapsedMs: number, G: GameRules) {
  const prog = Math.min(1, elapsedMs / G.roundMs);
  let iv = Math.max(170, 420 - prog * 220);
  if (elapsedMs > G.roundMs - RULES.finalRushMs) iv *= 0.75;
  return iv / G.density;
}

/** kinds: 이번 판에 참가한 색 목록(주인 없는 색은 나오지 않음) */
export function makeCircle(id: number, now: number, elapsedMs: number, kinds: ColorIndex[], G: GameRules, rand = Math.random): Circle {
  const prog = Math.min(1, elapsedMs / G.roundMs);
  const rush = elapsedMs > G.roundMs - RULES.finalRushMs ? 1.25 : 1;
  const roll = rand();
  let kind: CircleKind;
  if (roll < G.rainbowChance) kind = 'rainbow';
  else if (roll < G.rainbowChance + RULES.yellowChance) kind = 'y';
  else kind = kinds[Math.floor(rand() * kinds.length)];
  return {
    id,
    kind,
    angle: rand() * Math.PI * 2,
    speed: (130 + prog * 180 + rand() * 60) * rush * G.speed,
    r: 40 * (0.85 + rand() * 0.3),
    born: now,
  };
}

/** 꼴찌인지 (동점이면 모두 꼴찌가 아님) */
function isLast(p: PlayerState, players: PlayerState[]) {
  const min = Math.min(...players.map((x) => x.score));
  return p.score === min && players.some((x) => x.score > min);
}

/** 피버 게이지 증감. 가득 차면 피버 시작 후 true 반환. 피버 중에는 변화 없음. */
function addFever(p: PlayerState, amt: number, now: number, G: GameRules, players: PlayerState[]): boolean {
  if (isFever(p, now)) return false;
  if (amt > 0) amt *= G.feverGain * (G.comeback && isLast(p, players) ? RULES.comebackGain : 1);
  p.fever = Math.max(0, Math.min(100, p.fever + amt));
  if (p.fever >= 100) {
    p.fever = 0;
    p.feverUntil = now + G.feverMs;
    return true;
  }
  return false;
}

/**
 * 원을 가져갔을 때의 결과를 계산하고 플레이어 상태를 바꾼다.
 * - 피버 중: 노란 원은 내 색 취급, 남의 색은 페널티 없는 견제
 * - 평상시 견제: +1, 내 콤보 끊김, 피버 감소, 표적이 됨
 * - 표적인 사람의 색: 반격 보너스
 */
export function resolveClaim(claimer: PlayerState, kind: CircleKind, players: PlayerState[], now: number, G: GameRules): ClaimResult {
  const fever = isFever(claimer, now);
  const res: ClaimResult = { type: 'own', gained: 0, comboBonus: false, feverStarted: false, brokeComboOf: null, marked: false };
  let pts = 0;
  let steal = false;

  if (kind === 'rainbow') {
    res.type = 'rainbow'; pts = RULES.points.rainbow; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.rainbow, now, G, players);
  } else if (kind === 'y' && fever) {
    res.type = 'own'; pts = RULES.points.own; claimer.combo++;
  } else if (kind === 'y') {
    res.type = 'yellow'; pts = RULES.points.yellow; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.yellow, now, G, players);
  } else if (kind === claimer.color) {
    res.type = 'own'; pts = RULES.points.own; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own, now, G, players);
  } else {
    steal = true;
    const owner = players.find((p) => p.color === kind);
    if (owner && isMarked(owner, now)) {
      res.type = 'counter'; pts = RULES.points.counter;
    } else if (fever || !G.stealPenalty) {
      res.type = 'feverSteal'; pts = RULES.points.stealCalm;
    } else {
      res.type = 'steal'; pts = RULES.points.stealCalm;
      claimer.combo = 0;
      addFever(claimer, RULES.fever.stealCalm, now, G, players);
      if (G.markMs > 0) { claimer.markedUntil = now + G.markMs; res.marked = true; }
    }
    if (owner && owner.combo > 0) {
      owner.combo = 0;
      res.brokeComboOf = owner.id;
    }
  }

  if (!steal && claimer.combo > 0 && claimer.combo % RULES.comboBonusEvery === 0) {
    res.comboBonus = true;
    pts += RULES.comboBonus;
  }
  // 피버 시작 직후의 원은 배율 미적용(시작 시점 기준)
  res.gained = pts * (fever ? G.feverMult : 1);
  claimer.score += res.gained;
  return res;
}

/** 빈 공간 클릭 */
export function resolveMiss(p: PlayerState, now: number, G: GameRules, players: PlayerState[]) {
  p.combo = 0;
  addFever(p, RULES.fever.miss, now, G, players);
}

export function ranking(players: PlayerState[]) {
  return [...players].sort((a, b) => b.score - a.score);
}
