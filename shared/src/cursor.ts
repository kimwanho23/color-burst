/**
 * 게임 커서: 화면이 그리는 내 커서의 위치 계산, 레이저 기하, 커서 자석 대상 고르기.
 * 수치는 rules.ts의 RULES.cursor / RULES.laser / RULES.magnet에 있다.
 */
import { FIELD, RULES, circlePos, isGuarded, isMine, type Circle, type ColorIndex } from './rules.ts';

export type Point = { x: number; y: number };
/** 커서 효과: slow(움직임 배율), invert(반대로) */
export type CursorMode = { slow?: number; invert?: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 다음 게임 커서 위치. 효과가 없으면(mode null) 진짜 마우스 위치 그대로,
 * 효과가 있으면 이전 위치에서 마우스 이동량을 바꿔 움직이고 필드 안으로 자른다
 */
export function nextCursor(prev: Point, real: Point, delta: Point, mode: CursorMode | null): Point {
  if (!mode) return real;
  const k = (mode.slow ?? 1) * (mode.invert ? -1 : 1);
  return { x: clamp(prev.x + delta.x * k, 0, FIELD.w), y: clamp(prev.y + delta.y * k, 0, FIELD.h) };
}

export function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** 레이저: 필드 안쪽 한 점을 지나는 무작위 각도의 긴 선분 */
export function rollLaser(rand = Math.random): { a: Point; b: Point } {
  const cx = 200 + rand() * 1200, cy = 150 + rand() * 600;
  const ang = rand() * Math.PI;
  const dx = Math.cos(ang) * 2000, dy = Math.sin(ang) * 2000;
  return { a: { x: cx - dx, y: cy - dy }, b: { x: cx + dx, y: cy + dy } };
}

export const laserHits = (cursor: Point, a: Point, b: Point) => distToSegment(cursor, a, b) <= RULES.laser.width;

export const nextLaserIn = (rand = Math.random) => RULES.laser.everyMin + rand() * (RULES.laser.everyMax - RULES.laser.everyMin);

/** 커서 자석: 커서 둘레 radius 안에 중심이 들어온 내 원 (보호 구역·skip 제외), 가까운 순 최대 max개 */
export function pickMagnetTargets(
  circles: Iterable<Circle>, color: ColorIndex, cursor: Point, t: number, radius: number, max: number, skip?: ReadonlySet<number>,
): Circle[] {
  const found: { c: Circle; d: number }[] = [];
  for (const c of circles) {
    if (!isMine(c.kind, color) || skip?.has(c.id) || isGuarded(c, t)) continue;
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
