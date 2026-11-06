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

export const RULES = {
  roundMs: 60_000,
  countdownMs: 3_000,
  finalRushMs: 10_000,
  feverMs: 7_000,
  feverMult: 3,
  markMs: 4_000,
  comboBonusEvery: 10,
  comboBonus: 5,
  points: { own: 3, yellow: 2, rainbow: 5, stealCalm: 1, counter: 4 },
  fever: { own: 12, yellow: 6, rainbow: 25, stealCalm: -20, miss: -10 },
  rainbowChance: 0.03,
  yellowChance: 0.33,
  /** 클릭 판정 여유(필드 단위) */
  hitPad: 12,
} as const;

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
export function spawnInterval(elapsedMs: number) {
  const prog = Math.min(1, elapsedMs / RULES.roundMs);
  let iv = Math.max(170, 420 - prog * 220);
  if (elapsedMs > RULES.roundMs - RULES.finalRushMs) iv *= 0.75;
  return iv;
}

/** kinds: 이번 판에 참가한 색 목록(주인 없는 색은 나오지 않음) */
export function makeCircle(id: number, now: number, elapsedMs: number, kinds: ColorIndex[], rand = Math.random): Circle {
  const prog = Math.min(1, elapsedMs / RULES.roundMs);
  const rush = elapsedMs > RULES.roundMs - RULES.finalRushMs ? 1.25 : 1;
  const roll = rand();
  let kind: CircleKind;
  if (roll < RULES.rainbowChance) kind = 'rainbow';
  else if (roll < RULES.rainbowChance + RULES.yellowChance) kind = 'y';
  else kind = kinds[Math.floor(rand() * kinds.length)];
  return {
    id,
    kind,
    angle: rand() * Math.PI * 2,
    speed: (130 + prog * 180 + rand() * 60) * rush,
    r: 40 * (0.85 + rand() * 0.3),
    born: now,
  };
}

/** 피버 게이지 증감. 가득 차면 피버 시작 후 true 반환. 피버 중에는 변화 없음. */
function addFever(p: PlayerState, amt: number, now: number): boolean {
  if (isFever(p, now)) return false;
  p.fever = Math.max(0, Math.min(100, p.fever + amt));
  if (p.fever >= 100) {
    p.fever = 0;
    p.feverUntil = now + RULES.feverMs;
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
export function resolveClaim(claimer: PlayerState, kind: CircleKind, players: PlayerState[], now: number): ClaimResult {
  const fever = isFever(claimer, now);
  const res: ClaimResult = { type: 'own', gained: 0, comboBonus: false, feverStarted: false, brokeComboOf: null, marked: false };
  let pts = 0;
  let steal = false;

  if (kind === 'rainbow') {
    res.type = 'rainbow'; pts = RULES.points.rainbow; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.rainbow, now);
  } else if (kind === 'y' && fever) {
    res.type = 'own'; pts = RULES.points.own; claimer.combo++;
  } else if (kind === 'y') {
    res.type = 'yellow'; pts = RULES.points.yellow; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.yellow, now);
  } else if (kind === claimer.color) {
    res.type = 'own'; pts = RULES.points.own; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own, now);
  } else {
    steal = true;
    const owner = players.find((p) => p.color === kind);
    if (owner && isMarked(owner, now)) {
      res.type = 'counter'; pts = RULES.points.counter;
    } else if (fever) {
      res.type = 'feverSteal'; pts = RULES.points.stealCalm;
    } else {
      res.type = 'steal'; pts = RULES.points.stealCalm;
      claimer.combo = 0;
      addFever(claimer, RULES.fever.stealCalm, now);
      claimer.markedUntil = now + RULES.markMs;
      res.marked = true;
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
  res.gained = pts * (fever ? RULES.feverMult : 1);
  claimer.score += res.gained;
  return res;
}

/** 빈 공간 클릭 */
export function resolveMiss(p: PlayerState, now: number) {
  p.combo = 0;
  addFever(p, RULES.fever.miss, now);
}

export function ranking(players: PlayerState[]) {
  return [...players].sort((a, b) => b.score - a.score);
}
