import { RULES } from './rules.ts';
import type { Point } from './cursor.ts';

/** 폭탄 원의 십자 폭발: 중심을 지나는 가로·세로 줄(판 끝까지)에 반지름 r인 원이 걸리는지 */
export function inCross(center: Point, q: Point, r: number, halfWidth: number = RULES.specialCircles.bomb.halfWidth): boolean {
  return Math.abs(q.x - center.x) <= r + halfWidth || Math.abs(q.y - center.y) <= r + halfWidth;
}

/** 폭탄 원 설명 (대기실 규칙 표·도감 공용) */
export const BOMB_DESC = '누르면 가로·세로 판 끝까지 십자로 터져 걸린 원을 모두 가져감. 남의 색도 견제 없이, 보스도 때림. 다른 폭탄에 닿으면 연쇄';
