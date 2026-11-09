/**
 * 협력전 계산: 레이드 보스 단계·피해, 공격 일정, 카드 뽑기·투표 집계, 별.
 * 한 판의 상태는 서버의 CoopRun(server/src/coop.ts)이 들고, 여기는 순수 함수만 둔다. 수치는 RULES.coop.
 */
import { COOP_CARD_IDS, RULES, type Circle, type CoopCardId, type CoopLevel, type PlayerState } from './rules.ts';
import type { Point } from './cursor.ts';

const C = RULES.coop;

export type CoopPhase = 1 | 2 | 3;
export type CoopAttack = 'laser' | 'threat' | 'hazard';

export const cardCount = (cards: readonly CoopCardId[], id: CoopCardId) => cards.reduce((n, c) => n + (c === id ? 1 : 0), 0);

/** 레이드 보스 최대 체력: 봇은 botWeight명분 */
export function raidMaxHp(humans: number, bots: number): number {
  return Math.round(C.hpBase * (humans + bots * C.botWeight));
}

export function makeRaid(id: number, now: number, hp: number): Circle {
  return { id, kind: 'boss', boss: 'raid', angle: 0, speed: 0, r: C.bossR, born: now, hp, maxHp: hp };
}

/** 체력 비율로 단계: 0.67 초과 1, 0.33 초과 2, 그 밖 3 */
export function coopPhase(hp: number, maxHp: number): CoopPhase {
  const f = maxHp > 0 ? hp / maxHp : 0;
  // 경계에서 멈춘 체력(maxHp × 비율)이 실수 오차로 비율보다 살짝 커도 다음 단계로 본다
  const eps = 1e-9;
  if (f > C.phaseAt[0] + eps) return 1;
  if (f > C.phaseAt[1] + eps) return 2;
  return 3;
}

/** 그 단계의 아래 경계 체력 (3단계는 0) */
function floorHp(phase: CoopPhase, maxHp: number) {
  return phase === 3 ? 0 : maxHp * C.phaseAt[phase - 1];
}

/** 한 번 때렸을 때 피해: 1 × 피버 배율 × (1 + 콤보 보너스 + 카드 보너스), 봇은 × botWeight */
export function raidDamage(p: PlayerState, cards: readonly CoopCardId[], feverOn: boolean): number {
  const fever = feverOn ? C.feverDmg + cardCount(cards, 'heat') * C.heatStep : 1;
  const comboCap = C.comboCap + cardCount(cards, 'chain') * C.chainCap;
  const combo = Math.min(Math.floor(p.combo / C.comboStep) * C.comboPer, comboCap);
  const card = cardCount(cards, 'power') * C.powerPct;
  return fever * (1 + combo + card) * (p.bot ? C.botWeight : 1);
}

/**
 * 피해를 넣는다. 지금 단계의 아래 경계에서 멈추고 넘친 피해는 버린다. crossed: 경계(3단계는 0)에 닿았는지.
 * phase: 지금 단계 (없으면 체력에서 계산)
 */
export function applyRaidDamage(c: Circle, dmg: number, phase?: CoopPhase): { dealt: number; crossed: boolean } {
  const hp = c.hp ?? 0, max = c.maxHp ?? 0;
  if (hp <= 0 || dmg <= 0) return { dealt: 0, crossed: false };
  const floor = floorHp(phase ?? coopPhase(hp, max), max);
  if (hp <= floor) return { dealt: 0, crossed: false };
  const next = Math.max(floor, hp - dmg);
  c.hp = next;
  return { dealt: hp - next, crossed: next <= floor };
}

/** 공격 원: from에서 angle 방향으로 날아간다 */
export function makeThreat(id: number, now: number, from: Point, angle: number, speed: number, target: string): Circle {
  return { id, kind: 'threat', angle, speed, r: C.threatR, born: now, from: { x: from.x, y: from.y }, target };
}

export function threatSpeed(level: CoopLevel, cards: readonly CoopCardId[]): number {
  return C.levels[level].threatSpeed * (1 - C.slowPct) ** cardCount(cards, 'slow');
}

/** 다음 공격까지 간격. 레이저는 laserEvery 범위에서 무작위, 3단계면 × phase3Mult */
export function attackGap(kind: CoopAttack, level: CoopLevel, phase: CoopPhase, rand = Math.random): number {
  const L = C.levels[level];
  const base = kind === 'laser' ? L.laserEvery[0] + rand() * (L.laserEvery[1] - L.laserEvery[0]) : kind === 'threat' ? L.threatEvery : L.hazardEvery;
  return base * (phase === 3 ? L.phase3Mult : 1);
}

/** 맞은 뒤 무적 시간 */
export function immuneMs(cards: readonly CoopCardId[]): number {
  return C.immuneMs + C.toughMs * cardCount(cards, 'tough');
}

/** 서로 다른 카드 n장 */
export function drawCards(rand = Math.random, n = 3): CoopCardId[] {
  const pool = [...COOP_CARD_IDS];
  const out: CoopCardId[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** 투표 집계: 최다 득표, 동점은 그중 무작위, 표가 없으면 options 중 무작위. options 밖의 표는 무시 */
export function tallyVotes(options: readonly CoopCardId[], votes: ReadonlyMap<string, CoopCardId>, rand = Math.random): CoopCardId {
  const n = new Map<CoopCardId, number>();
  for (const v of votes.values()) if (options.includes(v)) n.set(v, (n.get(v) ?? 0) + 1);
  const top = Math.max(0, ...n.values());
  const best = top > 0 ? options.filter((o) => n.get(o) === top) : [...options];
  return best[Math.min(best.length - 1, Math.floor(rand() * best.length))];
}

/** 별: 진 판 0. 이긴 판은 살아남은 비율·남은 시간으로 1~3 */
export function coopStars(win: boolean, aliveRatio: number, leftMs: number): 0 | 1 | 2 | 3 {
  if (!win) return 0;
  const S = C.stars;
  if (aliveRatio >= S.three.alive && leftMs >= S.three.leftSec * 1000) return 3;
  if (aliveRatio >= S.two.alive && leftMs >= S.two.leftSec * 1000) return 2;
  return 1;
}
