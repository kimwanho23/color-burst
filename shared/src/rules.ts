import { ABILITY, CURSE, bossDamage, comboPeriod, jackpotMult, modsOf, type Mods, type Pick, type RoundEffect } from './arcade.ts';

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
  boss: {
    /** 때릴 때마다 */
    hit: 1,
    /** 막타 */
    kill: 20,
    /** 가장 많이 때린 사람 */
    mvp: 5,
    /** 보스 점수에 붙는 피버 배율 상한 */
    feverMultCap: 2,
    /** 체력 = 참가 인원 × 이 값 */
    hpPerPlayer: 6,
    r: 90,
    /** 화면 밖으로 나가기까지 걸리는 시간(초, 속도 ×1 기준) */
    lifeSec: 8,
  },
  /** 아이템 원 */
  items: {
    /** 넓은 손 아이템의 범위, 자석 아이템의 거리 (능력과 더하고 능력 상한 적용) */
    wideHand: 35,
    magnet: 70,
  },
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
  /** 빈 곳 클릭 페널티 (콤보 끊김, 피버 게이지 감소) */
  missPenalty: boolean;
  /** 클래식: 한 판 / 아케이드: 5라운드 + 라운드마다 능력 선택 */
  mode: 'classic' | 'arcade';
  /** 아케이드 라운드 시간(초) */
  arcadeRoundSec: number;
}

/** 프리셋을 골라도 바뀌지 않는 설정 (모드 관련) */
export const MODE_KEYS = ['mode', 'arcadeRoundSec'] as const;

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
  arcadeRoundSec: [30, 45, 60, 90],
} as const satisfies Partial<Record<keyof RoomRules, readonly number[]>>;

export const DEFAULT_RULES: RoomRules = {
  speed: 1, density: 1, roundSec: 60,
  feverMult: 3, feverSec: 7, feverGain: 1,
  rainbowPct: 3, stealPenalty: true, markSec: 4,
  comeback: false, boss: true, missPenalty: true,
  mode: 'classic', arcadeRoundSec: 30,
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
    rules: { ...DEFAULT_RULES, speed: 0.75, density: 0.75, roundSec: 90, comeback: true, missPenalty: false },
  },
} as const satisfies Record<string, { name: string; desc: string; rules: RoomRules }>;
export type PresetId = keyof typeof PRESETS;

/** 현재 규칙이 어떤 프리셋과 같은지. 다르면 null(사용자 설정) */
export function matchPreset(r: RoomRules): PresetId | null {
  for (const [id, p] of Object.entries(PRESETS)) {
    const keys = (Object.keys(r) as (keyof RoomRules)[]).filter((k) => !(MODE_KEYS as readonly string[]).includes(k));
    if (keys.every((k) => r[k] === p.rules[k])) return id as PresetId;
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
  for (const k of ['stealPenalty', 'comeback', 'boss', 'missPenalty'] as const) {
    if (typeof input[k] === 'boolean') out[k] = input[k]!;
  }
  if (input.mode === 'classic' || input.mode === 'arcade') out.mode = input.mode;
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
  missPenalty: boolean;
  arcade: boolean;
}

export function toGameRules(r: RoomRules): GameRules {
  return {
    roundMs: (r.mode === 'arcade' ? r.arcadeRoundSec : r.roundSec) * 1000,
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
    missPenalty: r.missPenalty,
    arcade: r.mode === 'arcade',
  };
}

export type ColorIndex = 0 | 1 | 2 | 3;
export type CircleKind = ColorIndex | 'y' | 'rainbow' | 'boss';

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
  /** 보스 원만: 남은 체력 / 최대 체력 */
  hp?: number;
  maxHp?: number;
}

/** 결과 화면 칭호 계산용 기록 (한 판 단위) */
export interface PlayerStats {
  /** 가져간 원 수 (보스 제외) */
  hits: number;
  misses: number;
  /** 남의 색을 가져간 횟수 (반격 제외) */
  steals: number;
  counters: number;
  fevers: number;
  maxCombo: number;
  bossHits: number;
  bossKills: number;
}

export const emptyStats = (): PlayerStats => ({ hits: 0, misses: 0, steals: 0, counters: 0, fevers: 0, maxCombo: 0, bossHits: 0, bossKills: 0 });

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
  stats: PlayerStats;
  /** 아케이드: 고른 능력 */
  picks: Pick[];
  /** 여운: 피버가 끝난 뒤 점수 ×1.5가 유지되는 시각 */
  afterUntil: number;
  /** 방해 전파를 맞아 내 화면의 원이 흐려지는 시각 */
  blurUntil: number;
  /** 이번 라운드에 남은 침착·방패 횟수 */
  calmLeft: number;
  shieldLeft: number;
  /** 라운드 시작 때 점수 (도박사·악마의 계약 계산용) */
  roundStart: number;
  /** 이번 라운드 최대 콤보 (시한폭탄) */
  roundMaxCombo: number;
  /** 악마의 계약: 다음 라운드 끝에 점수 절반 */
  pactPending: boolean;
  /** 악마의 계약: 다음 능력 선택이 전부 레전드 */
  legendNext: boolean;
  /** 아이템 효과가 끝나는 서버 시각 */
  buffs: Partial<Record<BuffId, number>>;
  /** 황금 손: 점수 2배가 남은 원 수 */
  goldLeft: number;
}

/** 시간 제한이 있는 아이템 효과 */
export type BuffId = 'wideHand' | 'magnet' | 'missGuard' | 'comboLock' | 'guard' | 'double' | 'paint';

export const buffOn = (p: PlayerState, id: BuffId, now: number) => now < (p.buffs[id] ?? 0);

/** 효과 걸기. 이미 걸려 있으면 남은 시간에 더하되 원래 시간의 2배까지 */
export function addBuff(p: PlayerState, id: BuffId, ms: number, now: number) {
  p.buffs[id] = Math.min(Math.max(p.buffs[id] ?? 0, now) + ms, now + ms * 2);
}

/** 일시정지가 풀렸을 때: since 이후에 끝나는 시각을 delta만큼 뒤로 */
export function shiftTimes(p: PlayerState, since: number, delta: number) {
  for (const k of ['feverUntil', 'markedUntil', 'afterUntil', 'blurUntil'] as const) if (p[k] > since) p[k] += delta;
  for (const k of Object.keys(p.buffs) as BuffId[]) if (p.buffs[k]! > since) p.buffs[k]! += delta;
}

/** 넓은 손 범위: 능력 + 아이템, 능력 상한 */
export function reachOf(p: PlayerState, now: number) {
  const v = modsOf(p.picks).wideHand + (buffOn(p, 'wideHand', now) ? RULES.items.wideHand : 0);
  return Math.min(ABILITY.wideHand.cap ?? Infinity, v);
}
/** 자석 거리: 능력 + 아이템, 능력 상한 */
export function magnetOf(p: PlayerState, now: number) {
  const v = modsOf(p.picks).magnet + (buffOn(p, 'magnet', now) ? RULES.items.magnet : 0);
  return Math.min(ABILITY.magnet.cap ?? Infinity, v);
}

/** 점수 2배·황금 손 배율 (서로 겹치지 않음). consume이면 황금 손 하나를 쓴다 */
export function itemMult(p: PlayerState, now: number, consume: boolean) {
  if (buffOn(p, 'double', now)) return 2;
  if (p.goldLeft > 0) { if (consume) p.goldLeft--; return 2; }
  return 1;
}

export type ClaimType = 'own' | 'yellow' | 'rainbow' | 'steal' | 'feverSteal' | 'counter';
/** 어떻게 잡았는지: 직접 클릭, 넓은 손 범위, 자석, 장판, 폭죽·필드 클리어 */
export type ClaimVia = 'click' | 'range' | 'magnet' | 'zone' | 'blast';

export interface ClaimResult {
  type: ClaimType;
  gained: number;
  comboBonus: boolean;
  feverStarted: boolean;
  /** 이 클릭으로 콤보가 끊긴 상대 id */
  brokeComboOf: string | null;
  /** 이 클릭으로 표적이 됐는지 */
  marked: boolean;
  /** 강탈로 빼앗은 점수 */
  plundered: number;
  /** 상대의 방패로 콤보 끊기가 막혔는지 */
  shielded: boolean;
  via: ClaimVia;
  /** 잭팟 배율 (안 터지면 1) */
  jackpot: number;
}

export function newPlayer(id: string, name: string, color: ColorIndex, bot = false): PlayerState {
  return {
    id, name, color, bot, connected: true, score: 0, combo: 0, fever: 0, feverUntil: 0, markedUntil: 0, stats: emptyStats(),
    picks: [], afterUntil: 0, blurUntil: 0, calmLeft: 0, shieldLeft: 0,
    roundStart: 0, roundMaxCombo: 0, pactPending: false, legendNext: false, buffs: {}, goldLeft: 0,
  };
}

/** 새 게임 시작: 점수, 기록, 능력 모두 초기화 */
export function resetForRound(p: PlayerState) {
  p.score = 0; p.stats = emptyStats(); p.picks = []; p.pactPending = false; p.legendNext = false;
}

/** 능력(또는 저주)을 고른 직후 처리 */
export function applyPick(p: PlayerState, pick: Pick) {
  p.picks.push(pick);
  if (pick.id === 'devilPact') p.pactPending = true;
}

/** 라운드 시작(클래식은 판 시작): 라운드 단위 상태 초기화와 능력 적용. 점수는 누적 */
export function startRound(p: PlayerState, startAt: number, G: GameRules, endAt = 0) {
  const m = modsOf(p.picks);
  p.combo = 0; p.fever = 0; p.feverUntil = 0; p.markedUntil = 0; p.afterUntil = 0; p.blurUntil = 0;
  p.calmLeft = m.calm; p.shieldLeft = m.shield;
  p.buffs = {}; p.goldLeft = 0;
  p.roundStart = p.score; p.roundMaxCombo = 0;
  p.score += m.headStart;
  if (m.timeBomb) p.score += CURSE.timeBomb.bonus;
  // 표적 자처: 라운드 내내 표적
  if (m.selfTarget) p.markedUntil = endAt || startAt + G.roundMs;
  if (m.preheat >= 100) startFever(p, startAt, G, m);
  else p.fever = m.preheat;
}

/** 능력을 반영한 피버 시간·배율 */
export const feverMsOf = (p: PlayerState, G: GameRules) => G.feverMs + modsOf(p.picks).overtime * 1000;
export const feverMultOf = (p: PlayerState, G: GameRules) => {
  const m = modsOf(p.picks);
  return G.feverMult + m.frenzy + (m.berserker ? CURSE.berserker.multAdd : 0);
};
/** 유리 대포·표적 자처: 모든 점수 배율 */
export const scoreBoostOf = (m: Mods) =>
  1 + ((m.glassCannon ? CURSE.glassCannon.boostPct : 0) + (m.selfTarget ? CURSE.selfTarget.boostPct : 0)) / 100;

/** 라운드가 끝날 때 저주 효과 적용 (시한폭탄 → 악마의 계약 → 도박사 순) */
export function endRoundCurses(p: PlayerState, rand = Math.random): RoundEffect[] {
  const m = modsOf(p.picks);
  const out: RoundEffect[] = [];
  const add = (id: RoundEffect['id'], delta: number) => {
    const d = Math.max(-p.score, Math.round(delta));
    p.score += d;
    out.push({ playerId: p.id, id, delta: d });
  };
  if (m.timeBomb && p.roundMaxCombo < CURSE.timeBomb.comboGoal) add('timeBomb', -CURSE.timeBomb.penalty);
  if (p.pactPending) {
    // 계약을 맺은 다음 라운드가 끝났을 때 (계약은 라운드 사이에 고르므로 이 시점이 곧 다음 라운드 끝)
    add('devilPact', -Math.max(0, p.score - p.roundStart) * (1 - CURSE.devilPact.keepPct / 100));
    p.pactPending = false;
    p.legendNext = true;
  }
  if (m.gambler) {
    const round = Math.max(0, p.score - p.roundStart);
    add('gambler', rand() < CURSE.gambler.chance ? (round * CURSE.gambler.winPct) / 100 : (-round * CURSE.gambler.losePct) / 100);
  }
  return out;
}

function startFever(p: PlayerState, now: number, G: GameRules, m: Mods) {
  p.fever = 0;
  p.feverUntil = now + G.feverMs + m.overtime * 1000;
  p.afterUntil = m.afterglow ? p.feverUntil + m.afterglow * 1000 : 0;
}

/** 콤보 끊기 (보험이 있으면 일부 유지, 콤보 고정 중이면 그대로). 실제로 줄었으면 true */
function breakCombo(p: PlayerState, m: Mods, now: number) {
  if (buffOn(p, 'comboLock', now)) return false;
  const before = p.combo;
  p.combo = Math.floor((p.combo * m.insurance) / 100);
  return p.combo < before;
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

/** pad: 원 둘레 바깥으로 인정하는 여유(필드 단위). 넓은 손·자석은 이 값을 늘려서 판정한다 */
export function isHit(c: Circle, t: number, x: number, y: number, pad: number = RULES.hitPad) {
  const p = circlePos(c, t);
  const rr = c.r + pad;
  return (p.x - x) ** 2 + (p.y - y) ** 2 <= rr * rr;
}

/** 내 원: 내 색, 노란색, 무지개. 넓은 손·자석·장판은 내 원만 잡는다 */
export function isMine(kind: CircleKind, color: ColorIndex) {
  return typeof kind === 'number' ? kind === color : kind === 'y' || kind === 'rainbow';
}

/**
 * 직접 맞은 원이 없을 때(또는 그 밖에) 넓은 손·자석으로 같이 잡히는 원.
 * range: 클릭 둘레 reach 안의 내 원 전부 / magnet: range가 비었을 때 magnet 거리 안에서 가장 가까운 내 원
 */
export function assistTargets(
  circles: Iterable<Circle>, color: ColorIndex, x: number, y: number, t: number,
  reach: number, magnet: number, skip?: ReadonlySet<number>,
): { range: Circle[]; magnet: Circle | null } {
  const mine = [...circles].filter((c) => isMine(c.kind, color) && !skip?.has(c.id));
  const range = reach > 0 ? mine.filter((c) => isHit(c, t, x, y, RULES.hitPad + reach)) : [];
  if (range.length || magnet <= 0) return { range, magnet: null };
  let best: Circle | null = null, bd = Infinity;
  for (const c of mine) {
    if (!isHit(c, t, x, y, RULES.hitPad + magnet)) continue;
    const p = circlePos(c, t);
    const d = Math.hypot(p.x - x, p.y - y) - c.r;
    if (d < bd) { bd = d; best = c; }
  }
  return { range, magnet: best };
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

/** 보스가 나오는 시점(판 시작 후 ms). 마지막 10초에 한 번은 꼭 나온다 */
export function bossTimes(G: GameRules): number[] {
  if (!G.boss) return [];
  const L = G.roundMs, last = L - 9_000;
  return L >= 60_000 ? [L * 0.3, L * 0.62, last] : [last];
}

export function makeBoss(id: number, now: number, playerCount: number, G: GameRules, rand = Math.random): Circle {
  const B = RULES.boss;
  const angle = rand() * Math.PI * 2;
  // 어느 방향으로 가도 lifeSec 만에 화면 밖으로 나가도록 속도를 맞춘다
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const dist = Math.min(c ? (FIELD.w / 2 + B.r) / c : Infinity, s ? (FIELD.h / 2 + B.r) / s : Infinity);
  const hp = B.hpPerPlayer * playerCount;
  return { id, kind: 'boss', angle, speed: (dist / B.lifeSec) * G.speed, r: B.r, born: now, hp, maxHp: hp };
}

/** 보스 점수에 붙는 배율 */
export function bossMult(p: PlayerState, now: number, G: GameRules) {
  return isFever(p, now) ? Math.min(feverMultOf(p, G), RULES.boss.feverMultCap) : 1;
}

/** 보스를 한 번 때렸을 때: 피해, 타격 점수(배율 전), 막타 점수(배율 전) */
export function bossHitInfo(p: PlayerState, rand = Math.random) {
  const m = modsOf(p.picks);
  return { damage: bossDamage(m, rand), hit: RULES.boss.hit + m.hammer, kill: RULES.boss.kill + m.hunter, boost: scoreBoostOf(m) };
}

/** 꼴찌인지 (동점이면 모두 꼴찌가 아님) */
function isLast(p: PlayerState, players: PlayerState[]) {
  const min = Math.min(...players.map((x) => x.score));
  return p.score === min && players.some((x) => x.score > min);
}

/** 피버 게이지 증감. 가득 차면 피버 시작 후 true 반환. 피버 중에는 변화 없음. */
function addFever(p: PlayerState, amt: number, now: number, G: GameRules, players: PlayerState[]): boolean {
  if (isFever(p, now)) return false;
  const m = modsOf(p.picks);
  if (amt > 0) amt *= G.feverGain * (1 + m.overcharge / 100) * (G.comeback && isLast(p, players) ? RULES.comebackGain : 1) / (m.berserker ? CURSE.berserker.gainDiv : 1);
  p.fever = Math.max(0, Math.min(100, p.fever + amt));
  if (p.fever >= 100) {
    startFever(p, now, G, m);
    // 방해 전파: 다른 사람 화면의 원을 흐리게
    if (m.jammer) for (const o of players) if (o !== p) o.blurUntil = Math.max(o.blurUntil, now + m.jammer);
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
export function resolveClaim(
  claimer: PlayerState, kind: CircleKind, players: PlayerState[], now: number, G: GameRules,
  opts: { via?: ClaimVia; rand?: () => number } = {},
): ClaimResult {
  const via = opts.via ?? 'click';
  const blast = via === 'blast';
  const fever = isFever(claimer, now);
  const after = !fever && now < claimer.afterUntil;
  const m = modsOf(claimer.picks);
  const P = RULES.points;
  const res: ClaimResult = { type: 'own', gained: 0, comboBonus: false, feverStarted: false, brokeComboOf: null, marked: false, plundered: 0, shielded: false, via, jackpot: 1 };
  let pts = 0;
  let steal = false;

  // 외길: 내 색 ×3, 노란색·무지개 0점
  const own = (P.own + m.picky) * (m.oneWay ? CURSE.oneWay.ownMult : 1);
  if (kind === 'rainbow') {
    res.type = 'rainbow'; pts = m.oneWay ? 0 : P.rainbow + m.rainbowHunt; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.rainbow, now, G, players);
  } else if (kind === 'y' && !fever && buffOn(claimer, 'paint', now)) {
    // 물들이기: 노란 원을 내 색으로 계산 (외길이면 그대로 0점)
    res.type = 'own'; pts = m.oneWay ? 0 : P.own + m.picky + m.yellowTaste; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own, now, G, players);
  } else if (kind === 'y' && fever) {
    res.type = 'own'; pts = m.oneWay ? 0 : P.own + m.picky + m.yellowTaste; claimer.combo++;
  } else if (kind === 'y') {
    res.type = 'yellow'; pts = m.oneWay ? 0 : Math.max(0, P.yellow + m.yellowTaste - (m.picky ? 1 : 0)); claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.yellow, now, G, players);
  } else if (kind === claimer.color) {
    res.type = 'own'; pts = own; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own, now, G, players);
  } else {
    steal = true;
    const owner = players.find((p) => p.color === kind);
    if (blast) {
      // 폭죽·필드 클리어: 남의 색도 +1만, 견제 페널티·표적·반격·강탈 없음
      res.type = 'feverSteal'; pts = P.stealCalm;
    } else {
      if (owner && isMarked(owner, now)) {
        res.type = 'counter'; pts = P.counter + m.counterPro;
      } else if (fever || !G.stealPenalty) {
        res.type = 'feverSteal'; pts = P.stealCalm;
      } else {
        res.type = 'steal'; pts = P.stealCalm;
        breakCombo(claimer, m, now);
        addFever(claimer, RULES.fever.stealCalm, now, G, players);
        // 철면피: 표적 시간 감소 (99 이상이면 표적 안 됨)
        const markMs = m.thickSkin >= 99 ? 0 : G.markMs - m.thickSkin * 1000;
        if (markMs > 0) { claimer.markedUntil = now + markMs; res.marked = true; }
      }
      const guarded = !!owner && buffOn(owner, 'guard', now);
      if (owner && owner.combo > 0) {
        // 보호막 아이템이 먼저 막는다 (방패 횟수는 그대로)
        if (guarded) res.shielded = true;
        else if (owner.shieldLeft > 0) { owner.shieldLeft--; res.shielded = true; }
        else if (breakCombo(owner, modsOf(owner.picks), now)) res.brokeComboOf = owner.id;
      }
      // 강탈·흡혈귀: 상대 점수를 빼앗음 (배율 없음). 흡혈귀를 가진 사람은 견제당할 때도 빼앗긴다
      if (owner && res.type !== 'counter') {
        const take = (guarded ? 0 : m.plunder) + (m.vampire ? CURSE.vampire.drain : 0) + (modsOf(owner.picks).vampire ? CURSE.vampire.drain : 0);
        res.plundered = Math.min(take, owner.score);
        owner.score -= res.plundered;
      }
    }
  }

  if (!steal && claimer.combo > 0 && claimer.combo % comboPeriod(m.comboArtist) === 0) {
    res.comboBonus = true;
    pts += RULES.comboBonus;
  }
  const st = claimer.stats;
  st.hits++;
  if (!blast && (res.type === 'steal' || res.type === 'feverSteal')) st.steals++;
  if (res.type === 'counter') st.counters++;
  if (res.feverStarted) st.fevers++;
  st.maxCombo = Math.max(st.maxCombo, claimer.combo);
  claimer.roundMaxCombo = Math.max(claimer.roundMaxCombo, claimer.combo);
  // 피버 시작 직후의 원은 배율 미적용(시작 시점 기준)
  const mult = (fever ? feverMultOf(claimer, G) : after ? 1.5 : 1) * scoreBoostOf(m) * itemMult(claimer, now, true);
  // 잭팟은 맨 마지막에 곱한다 (블라스트는 없음)
  if (!blast) res.jackpot = jackpotMult(m, opts.rand);
  res.gained = Math.round(pts * mult * res.jackpot) + res.plundered;
  claimer.score += res.gained;
  return res;
}

/** 빈 공간 클릭 */
export function resolveMiss(p: PlayerState, now: number, G: GameRules, players: PlayerState[]) {
  p.stats.misses++;
  const m = modsOf(p.picks);
  // 헛클릭 무효 아이템이 먼저 막는다 (침착 횟수는 그대로, 유리 대포 감점은 아래에서 그대로 적용)
  if (G.missPenalty && !buffOn(p, 'missGuard', now)) {
    // 침착: 라운드당 정해진 횟수만큼 페널티 무시
    if (p.calmLeft > 0) { p.calmLeft--; return; }
    breakCombo(p, m, now);
    addFever(p, RULES.fever.miss, now, G, players);
  }
  // 유리 대포: 빈 곳 클릭 감점 (저주의 대가라서 방 규칙과 상관없이 적용)
  if (m.glassCannon) p.score = Math.max(0, p.score - CURSE.glassCannon.missPenalty);
}

export function ranking(players: PlayerState[]) {
  return [...players].sort((a, b) => b.score - a.score);
}

// ---------- 결과 화면 칭호 ----------

export interface Title {
  playerId: string;
  name: string;
  desc: string;
}

/**
 * 한 판 기록으로 칭호를 준다. 칭호마다 한 명(동점이면 점수가 높은 사람).
 * 조건을 넘는 사람이 없으면 그 칭호는 없다.
 */
export function awardTitles(players: PlayerState[]): Title[] {
  const out: Title[] = [];
  const pick = (name: string, value: (p: PlayerState) => number, min: number, desc: (v: number) => string) => {
    let best: PlayerState | null = null, bv = -Infinity;
    for (const p of players) {
      const v = value(p);
      if (v >= min && (v > bv || (v === bv && best && p.score > best.score))) { best = p; bv = v; }
    }
    if (best) out.push({ playerId: best.id, name, desc: desc(bv) });
  };
  pick('막타 장인', (p) => p.stats.bossKills, 1, (v) => `보스 막타 ${v}번`);
  pick('견제왕', (p) => p.stats.steals + p.stats.counters, 3, (v) => `견제·반격 ${v}번`);
  pick('피버 머신', (p) => p.stats.fevers, 2, (v) => `피버 ${v}번`);
  pick('콤보 마스터', (p) => p.stats.maxCombo, 10, (v) => `최대 ${v}콤보`);
  pick('정밀 사격', (p) => (p.stats.hits >= 15 ? Math.round((p.stats.hits / (p.stats.hits + p.stats.misses)) * 100) : -1), 85, (v) => `명중률 ${v}%`);
  // 평화주의자: 견제 0번이면서 열심히 한 사람
  const peace = players.filter((p) => p.stats.steals + p.stats.counters === 0 && p.stats.hits >= 10).sort((a, b) => b.score - a.score)[0];
  if (peace) out.push({ playerId: peace.id, name: '평화주의자', desc: '견제 0번' });
  return out;
}
