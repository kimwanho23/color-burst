/**
 * 협력전 계산: 레이드 보스 단계·피해, 보스가 뿜는 원, 수정, 내려찍기·안전지대, 공격 일정, 별.
 * 한 판의 상태는 서버의 CoopRun(server/src/coop.ts)이 들고, 여기는 순수 함수만 둔다. 수치는 RULES.coop.
 */
import { FIELD, RULES, zoneOf, type Circle, type CircleKind, type ColorIndex, type CoopLevel, type PlayerState } from './rules.ts';
import type { Point } from './cursor.ts';

const C = RULES.coop;

export type CoopPhase = 1 | 2 | 3;
export type CoopAttack = 'laser' | 'threat' | 'slam' | 'safe' | 'map';

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

/** 잡은 원 하나의 피해: (노랑이면 yellowDmg, 아니면 dmg) × (1 + 콤보 보너스) × (큰 피해 구간이면 burst.mult), 봇은 × botWeight */
export function orbDamage(p: PlayerState, kind: CircleKind, burst: boolean): number {
  const base = kind === 'y' ? C.orb.yellowDmg : C.orb.dmg;
  const combo = Math.min(Math.floor(p.combo / C.comboStep) * C.comboPer, C.comboCap);
  return base * (1 + combo) * (burst ? C.burst.mult : 1) * (p.bot ? C.botWeight : 1);
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

export function threatSpeed(level: CoopLevel): number {
  return C.levels[level].threatSpeed;
}

/** 보스가 뿜는 원: from(보스 자리)에서 angle 방향으로. 크기는 일반 원과 같은 범위 */
export function makeOrb(id: number, now: number, from: Point, angle: number, kind: CircleKind, speed: number, rand = Math.random): Circle {
  return { id, kind, angle, speed, r: 40 * (0.85 + rand() * 0.3), born: now, from: { x: from.x, y: from.y } };
}

/** 수정 횟수: 난이도와 몇 번째 보호막인지 */
export function crystalHits(level: CoopLevel, shieldNo: 0 | 1): number {
  return C.levels[level].crystalHits[shieldNo];
}

/** 수정 자리 n개: 가장자리 구역, 판 안, 서로 minGap 이상, 보스와 겹치지 않게 */
export function placeCrystals(n: number, rand: () => number): Point[] {
  const r = C.crystal.r, out: Point[] = [];
  const bossBottom = C.bossY + C.bossR + r;
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const a = rand() * Math.PI * 2, e = 0.78 + rand() * 0.14;
    const p = {
      x: Math.min(FIELD.w - r, Math.max(r, FIELD.w / 2 + Math.cos(a) * e * FIELD.w / 2)),
      y: Math.min(FIELD.h - r, Math.max(r, FIELD.h / 2 + Math.sin(a) * e * FIELD.h / 2)),
    };
    if (zoneOf(p) !== 2 || p.y < bossBottom) continue;
    if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < C.crystal.minGap)) continue;
    out.push(p);
  }
  return out;
}

/** 수정: 움직이지 않는 주인 색 큰 원, 체력 = 깨는 데 필요한 횟수 */
export function makeCrystal(id: number, now: number, at: Point, owner: string, color: ColorIndex, hits: number): Circle {
  return { id, kind: 'crystal', angle: 0, speed: 0, r: C.crystal.r, born: now, from: { x: at.x, y: at.y }, target: owner, colorOf: color, hp: hits, maxHp: hits };
}

/** 내려찍기: (x, y) 반지름 r 원을 at에 내려친다 */
export interface Slam { id: number; owner: string; x: number; y: number; r: number; at: number }

/** 안전지대: 경고(at - warnMs)부터 at까지 (x0,y0,r0) → (x1,y1,r1)로 줄어들며 옮겨 가고, at에 밖이면 맞는다 */
export interface SafeZones { at: number; warnMs: number; zones: { x0: number; y0: number; x1: number; y1: number }[] }

export function safeZoneAt(s: SafeZones, z: number, t: number): { x: number; y: number; r: number } {
  const q = s.zones[z]!;
  const f = Math.min(1, Math.max(0, (t - (s.at - s.warnMs)) / s.warnMs));
  return { x: q.x0 + (q.x1 - q.x0) * f, y: q.y0 + (q.y1 - q.y0) * f, r: C.safe.r0 + (C.safe.r1 - C.safe.r0) * f };
}

export function inSafe(pt: Point, s: SafeZones, t: number): boolean {
  return s.zones.some((_, i) => { const z = safeZoneAt(s, i, t); return Math.hypot(pt.x - z.x, pt.y - z.y) <= z.r; });
}

/** 안전지대 count개: 보스 아래 판 안쪽에서 시작해 move 이내로 옮겨 간다 (at = 발동 시각) */
export function rollSafe(count: number, at: number, rand: () => number): SafeZones {
  const r = C.safe.r0, top = C.bossY + C.bossR;
  const pick = () => ({ x: r + rand() * (FIELD.w - 2 * r), y: top + rand() * (FIELD.h - r - top) });
  const zones = Array.from({ length: count }, () => {
    const s = pick();
    const a = rand() * Math.PI * 2, d = rand() * C.safe.move;
    const x1 = Math.min(FIELD.w - C.safe.r1, Math.max(C.safe.r1, s.x + Math.cos(a) * d));
    const y1 = Math.min(FIELD.h - C.safe.r1, Math.max(top, s.y + Math.sin(a) * d));
    return { x0: s.x, y0: s.y, x1, y1 };
  });
  return { at, warnMs: C.safe.warnMs, zones };
}

/** 다음 공격까지 간격. 레이저는 laserEvery 범위에서 무작위, 3단계면 × phase3Mult */
export function attackGap(kind: CoopAttack, level: CoopLevel, phase: CoopPhase, rand = Math.random): number {
  const L = C.levels[level];
  const base = kind === 'laser' ? L.laserEvery[0] + rand() * (L.laserEvery[1] - L.laserEvery[0])
    : kind === 'threat' ? L.threatEvery : kind === 'slam' ? L.slamEvery : kind === 'safe' ? L.safeEvery : L.mapEvery;
  return base * (phase === 3 ? L.phase3Mult : 1);
}

/** 맞은 뒤 무적 시간 */
export function immuneMs(): number {
  return C.immuneMs;
}

/** 별: 진 판 0. 이긴 판은 살아남은 비율·남은 시간으로 1~3 */
export function coopStars(win: boolean, aliveRatio: number, leftMs: number): 0 | 1 | 2 | 3 {
  if (!win) return 0;
  const S = C.stars;
  if (aliveRatio >= S.three.alive && leftMs >= S.three.leftSec * 1000) return 3;
  if (aliveRatio >= S.two.alive && leftMs >= S.two.leftSec * 1000) return 2;
  return 1;
}
