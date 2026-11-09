/**
 * 게임 커서: 화면이 그리는 내 커서의 위치 계산, 레이저 기하, 커서 자석 대상 고르기.
 * 수치는 rules.ts의 RULES.cursor / RULES.laser / RULES.magnet에 있다.
 */
import { modsOf } from './arcade.ts';
import { FIELD, RULES, circlePos, debuffOn, isGuarded, isOut, ownTest, type Circle, type OwnTest, type PlayerState } from './rules.ts';

export type Point = { x: number; y: number };
/** 커서 효과: slow(늦게 따라옴), invert(거울 위치). 오오라만 걸리면 {} */
export type CursorMode = { slow?: boolean; invert?: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 게임 커서가 가야 할 자리: 진짜 마우스 위치를 필드 안으로 자르고, 마우스 반대면 화면 가운데 기준 거울 위치.
 * 진짜 마우스가 화면 안을 오가는 것만으로 필드 전체에 닿아서 커서가 화면 밖으로 빠지지 않는다
 */
export function cursorTarget(real: Point, mode: CursorMode | null): Point {
  const x = clamp(real.x, 0, FIELD.w), y = clamp(real.y, 0, FIELD.h);
  return mode?.invert ? { x: FIELD.w - x, y: FIELD.h - y } : { x, y };
}

/** 감도 감소: 커서가 목표를 늦게 따라간다 (시간 상수 RULES.sabotage.slowLagMs). 아니면 바로 목표 */
export function followCursor(prev: Point, target: Point, dtMs: number, slow: boolean): Point {
  if (!slow) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / RULES.sabotage.slowLagMs);
  return { x: prev.x + (target.x - prev.x) * k, y: prev.y + (target.y - prev.y) * k };
}

/** 오오라에 끌리는 중(다른 효과 없음): 이동량을 그대로 더해 끌려간 만큼을 유지한다 */
export function relativeCursor(prev: Point, delta: Point): Point {
  return { x: clamp(prev.x + delta.x, 0, FIELD.w), y: clamp(prev.y + delta.y, 0, FIELD.h) };
}

export function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** 레이저: 필드 안쪽 한 점을 지나는 무작위 각도의 긴 선분 */
export function rollLaser(rand = Math.random): { a: Point; b: Point } {
  const cx = FIELD.w * (0.15 + rand() * 0.7), cy = FIELD.h * (0.15 + rand() * 0.7);
  const ang = rand() * Math.PI;
  const dx = Math.cos(ang) * 2000, dy = Math.sin(ang) * 2000;
  return { a: { x: cx - dx, y: cy - dy }, b: { x: cx + dx, y: cy + dy } };
}

/** half: 맞는 거리 (빔 폭의 절반, 방 규칙 레이저 두께) */
export const laserHits = (cursor: Point, a: Point, b: Point, half: number = RULES.laser.width) => distToSegment(cursor, a, b) <= half;

/** 한 번에 같이 쏘는 레이저 줄 모양 */
export type VolleyKind = 'single' | 'parallel' | 'cross' | 'radial';
export type LaserLine = { a: Point; b: Point };

/** 중심 c를 지나는 각도 ang의 길이 4000 선분 (화면 밖까지) */
const lineThrough = (c: Point, ang: number): LaserLine => {
  const dx = Math.cos(ang) * 2000, dy = Math.sin(ang) * 2000;
  return { a: { x: c.x - dx, y: c.y - dy }, b: { x: c.x + dx, y: c.y + dy } };
};

/**
 * 레이저 볼리: 모양을 고르고 줄들을 만든다. 한 줄 / 평행 두 줄(사이에 safeGap 틈) / X자 / 60° 간격 세 줄.
 * 중심은 판 안쪽(가로·세로 15%~85%)
 */
/** half: 맞는 거리 (방 규칙 레이저 두께). 평행 두 줄 사이 빈 틈이 늘 safeGap이 되게 */
export function rollVolley(rand = Math.random, half: number = RULES.laser.width): { kind: VolleyKind; lines: LaserLine[] } {
  const odds = Object.entries(RULES.laser.volleyOdds) as [VolleyKind, number][];
  let r = rand() * odds.reduce((s, [, w]) => s + w, 0);
  let kind: VolleyKind = odds[odds.length - 1][0];
  for (const [k, w] of odds) { r -= w; if (r < 0) { kind = k; break; } }
  const c = { x: FIELD.w * (0.15 + rand() * 0.7), y: FIELD.h * (0.15 + rand() * 0.7) };
  const ang = rand() * Math.PI;
  if (kind === 'single') return { kind, lines: [lineThrough(c, ang)] };
  if (kind === 'parallel') {
    const h = half + RULES.laser.safeGap / 2;
    const nx = -Math.sin(ang) * h, ny = Math.cos(ang) * h;
    return { kind, lines: [lineThrough({ x: c.x + nx, y: c.y + ny }, ang), lineThrough({ x: c.x - nx, y: c.y - ny }, ang)] };
  }
  if (kind === 'cross') return { kind, lines: [lineThrough(c, ang), lineThrough(c, ang + Math.PI / 2)] };
  return { kind, lines: [0, 1, 2].map((i) => lineThrough(c, ang + (i * Math.PI) / 3)) };
}

/** 시간 정지: from 뒤에 쏠 볼리만 ms만큼 늦춘다 (이미 쏘고 있는 볼리는 그대로). 서버·화면이 같은 규칙을 쓴다 */
export function holdLasers(lasers: { at: number }[], from: number, ms: number) {
  for (const l of lasers) if (l.at > from) l.at += ms;
}

/** 볼리의 줄 중 하나라도 커서에 닿는지 */
export const volleyHits = (cursor: Point, lines: readonly LaserLine[], half?: number) => lines.some((l) => laserHits(cursor, l.a, l.b, half));

/** 레이저 스턴을 걸 수 있는지: 스턴 중이 아니고, 스턴이 끝난 지 immuneMs가 지났다 (연속 스턴 방지) */
export const canLaserStun = (p: PlayerState, now: number) => now >= p.stunUntil + RULES.laser.immuneMs && !modsOf(p.picks).fortress;

/** 다음 레이저까지 걸리는 시간(ms). 카오스면 2초마다, 가끔 0.6초 뒤 한 번 더 (겹침) */
export const nextLaserIn = (rand = Math.random, chaos = false) => {
  const C = RULES.chaos;
  if (chaos) return rand() < C.laserQuickChance ? C.laserQuickMs : C.laserEveryMs;
  return RULES.laser.everyMin + rand() * (RULES.laser.everyMax - RULES.laser.everyMin);
};

/** 커서 자석: 커서 둘레 radius 안에 중심이 들어온 내 원·노란 원 (무지개·보호 구역·화면 밖·skip 제외), 가까운 순 최대 max개 */
export function pickMagnetTargets(
  circles: Iterable<Circle>, own: OwnTest, cursor: Point, t: number, radius: number, max: number, skip?: ReadonlySet<number>,
): Circle[] {
  const found: { c: Circle; d: number }[] = [];
  const mine = ownTest(own);
  for (const c of circles) {
    // 이미 화면 밖으로 나간 원(서버는 지연 보정 때문에 잠깐 더 들고 있음)은 끌지 않는다
    if (!mine(c.kind) || c.kind === 'rainbow' || skip?.has(c.id) || isGuarded(c, t) || isOut(c, t)) continue;
    const p = circlePos(c, t);
    const d = Math.hypot(p.x - cursor.x, p.y - cursor.y);
    if (d <= radius) found.push({ c, d });
  }
  return found.sort((a, b) => a.d - b.d).slice(0, max).map((f) => f.c);
}

/**
 * 커서를 서버로 보낼 상태인지. 탭이 숨겨졌거나 창이 포커스를 잃으면 보내지 않아서,
 * 자리를 비운 사람이 레이저에 맞거나 자석이 계속 끌어오지 않게 한다 (서버는 오래된 커서를 판정에서 뺀다)
 */
export function cursorActive(s: { playing: boolean; picking: boolean; roundOver: boolean; paused: boolean; hidden: boolean; focused: boolean }) {
  return s.playing && !s.picking && !s.roundOver && !s.paused && !s.hidden && s.focused;
}

/** 방해 디버프로 정해지는 커서 효과 (감도 감소·마우스 반대, 둘 다면 합침). 없으면 null */
export function cursorModeOf(p: PlayerState, now: number): CursorMode | null {
  const slow = debuffOn(p, 'slow', now), invert = debuffOn(p, 'invert', now);
  if (!slow && !invert) return null;
  return { ...(slow ? { slow: true } : {}), ...(invert ? { invert: true } : {}) };
}

/** 효과가 끝난 뒤 게임 커서가 진짜 마우스 위치로 미끄러져 돌아온다 (slideMs 동안) */
export function slideBack(from: Point, real: Point, elapsedMs: number): Point {
  const k = Math.min(1, Math.max(0, elapsedMs / RULES.sabotage.slideMs));
  return { x: from.x + (real.x - from.x) * k, y: from.y + (real.y - from.y) * k };
}

/** 이동형 보스의 오오라: 몸통(inner) 밖, 반지름 r까지의 고리. 다른 원은 null */
export function auraAt(c: Circle, t: number): { x: number; y: number; r: number; inner: number } | null {
  if (c.kind !== 'boss' || c.boss !== 'runner') return null;
  const p = circlePos(c, t);
  return { x: p.x, y: p.y, r: c.r + RULES.aura.extra, inner: c.r };
}

export function inAura(p: Point, a: { x: number; y: number; r: number; inner: number }) {
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  return d > a.inner && d <= a.r;
}

/** 렌즈 시야 방해: 그리는 물체의 위치·크기만 휜다 (중심 가운데, 반경 LENS_R). 볼록은 바깥으로 크게, 오목은 안쪽으로 작게 */
const LENS_R = 380;
export function lensWarp(p: Point, size: number, convex: boolean): { x: number; y: number; size: number } {
  const cx = FIELD.w / 2, cy = FIELD.h / 2;
  const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
  if (d === 0 || d >= LENS_R) return { x: p.x, y: p.y, size };
  const u = d / LENS_R;
  const d2 = LENS_R * Math.pow(u, convex ? 0.6 : 1.6);
  const scale = convex ? 1 + 0.6 * (1 - u) : 1 - 0.4 * (1 - u);
  return { x: cx + (dx / d) * d2, y: cy + (dy / d) * d2, size: size * scale };
}
