import { FIELD, RULES } from './rules.ts';
import type { Point } from './cursor.ts';
import type { CoopPhase } from './coop.ts';

export type BulletShape = 'spiral' | 'ring' | 'aimed' | 'scatter' | 'wall';
/** 출발점, 각도, 속도(필드/초), 발사 지연 ms */
export interface Shot { x: number; y: number; a: number; v: number; d: number }
export interface Volley { id: number; at: number; r: number; shots: Shot[] }

const key = (volleyId: number, shot: number) => `${volleyId}:${shot}`;

/** 아래쪽 반원 (0, π) 안의 각도. f는 0~1 */
const lower = (f: number) => Math.PI * (0.08 + 0.84 * f);

/**
 * 탄막 한 번. from은 발사 순간 보스 위치(이후 보스가 움직여도 탄은 직선).
 * o.speed는 그대로 쓴다(속도는 난이도만 정함). phaseMult·shieldMult는 탄의 양이라 호출하는 쪽이 발사 간격(bulletEveryMs)을 나눠 적용한다.
 */
export function makeVolley(
  shape: BulletShape, id: number, at: number, from: Point,
  o: { speed: number; phase: CoopPhase; aim?: Point; gaps?: number }, rand: () => number,
): Volley {
  const B = RULES.coop.bullets;
  const v = o.speed;
  const shots: Shot[] = [];
  const add = (x: number, y: number, a: number, d = 0, speed = v) => shots.push({ x, y, a, v: speed, d });
  if (shape === 'ring') {
    const n = B.ringCount;
    if (o.phase === 3) {
      for (let i = 0; i < n; i++) add(from.x, from.y, Math.PI * (i + 0.25) / n);
      for (let i = 0; i < n; i++) add(from.x, from.y, Math.PI * (i + 0.75) / n);
    } else {
      for (let i = 0; i < n; i++) add(from.x, from.y, Math.PI * (i + 0.5) / n);
    }
  } else if (shape === 'spiral') {
    const n = B.spiralCount, rev = rand() < 0.5;
    for (let i = 0; i < n; i++) add(from.x, from.y, lower(rev ? 1 - i / (n - 1) : i / (n - 1)), i * B.spiralMs);
  } else if (shape === 'aimed') {
    const aim = o.aim ?? { x: from.x, y: from.y + 1 };
    const c = Math.atan2(aim.y - from.y, aim.x - from.x), n = B.aimedCount;
    for (let i = 0; i < n; i++) add(from.x, from.y, c + (i / (n - 1) * 2 - 1) * B.aimedSpread);
  } else if (shape === 'scatter') {
    for (let i = 0; i < B.scatterCount; i++) add(from.x, from.y, lower(rand()), 0, v * (0.8 + 0.4 * rand()));
  } else {
    const n = Math.max(1, Math.floor(o.gaps ?? 1)), W = B.gapW, y = from.y + B.wallDy;
    const slot = FIELD.w / n, margin = 20;
    // 틈은 칸마다 하나씩, 칸 안에서 무작위 — 서로 겹치지 않고 필드 안
    const holes = Array.from({ length: n }, (_, k) => k * slot + margin + rand() * Math.max(0, slot - W - 2 * margin));
    for (let x = 0; x <= FIELD.w; x += B.wallGap) {
      if (holes.some((h) => x > h && x < h + W)) continue;
      add(x, y, Math.PI / 2);
    }
  }
  return { id, at, r: B.r, shots };
}

/** 직선 운동. 발사 전이면 null */
export function shotPos(v: Volley, i: number, t: number): Point | null {
  const s = v.shots[i];
  const el = t - v.at - s.d;
  if (el < 0) return null;
  const dist = s.v * el / 1000;
  return { x: s.x + Math.cos(s.a) * dist, y: s.y + Math.sin(s.a) * dist };
}

/** 판 밖(탄 반지름 이상)으로 나갔는가. 발사 전은 false */
export function shotGone(v: Volley, i: number, t: number): boolean {
  const p = shotPos(v, i, t);
  if (!p) return false;
  return p.x < -v.r || p.x > FIELD.w + v.r || p.y < -v.r || p.y > FIELD.h + v.r;
}

export function volleyDone(v: Volley, t: number): boolean {
  for (let i = 0; i < v.shots.length; i++) if (!shotGone(v, i, t)) return false;
  return true;
}

/** 커서가 닿은 첫 탄. skip 키는 `${volleyId}:${shot}` */
export function hitShot(cursor: Point, volleys: readonly Volley[], t: number, skip: ReadonlySet<string>): { volleyId: number; shot: number } | null {
  for (const v of volleys) {
    for (let i = 0; i < v.shots.length; i++) {
      if (skip.has(key(v.id, i))) continue;
      const p = shotPos(v, i, t);
      if (p && Math.hypot(p.x - cursor.x, p.y - cursor.y) <= v.r) return { volleyId: v.id, shot: i };
    }
  }
  return null;
}
