/**
 * 협력전 폭딜 반격의 분노 게이지 (새는 양동이). 단위는 보스 최대 체력 대비 %.
 * 원 획득 피해만큼 차고 초당 drain%씩 빠진다. cap%에 닿으면 warnMs 뒤 반격, 판정은 그 뒤 barrier.lagMs에 한다.
 * 서버 CoopRun이 상태를 들고, 화면은 counterValue로 지난 시간만큼 빼서 그린다. 수치는 RULES.coop.counter.
 */
import { RULES, type CoopLevel } from './rules.ts';
import type { CoopFx } from './coopItems.ts';

export interface CoopCounter {
  /** at 시각의 게이지 (%) */
  value: number;
  at: number;
  /** 반격 발동 시각 (0이면 예고 없음) */
  fireAt: number;
  /** 재사용 대기가 끝나는 시각 (그 전에는 차지 않음) */
  coolUntil: number;
}

export const newCounter = (now: number): CoopCounter => ({ value: 0, at: now, fireAt: 0, coolUntil: 0 });

/** now 시각의 게이지: 초당 drain만큼 빠지고 0 아래로 내려가지 않는다 */
export function counterValue(g: CoopCounter, now: number, level: CoopLevel): number {
  return Math.max(0, g.value - (RULES.coop.counter.drain[level] * Math.max(0, now - g.at)) / 1000);
}

/** 게이지에 pct%를 넣는다 (용량에서 멈춤). 예고 중·재사용 대기 중이면 무시. 처음 용량에 닿으면 예고를 시작하고 true */
export function fillCounter(g: CoopCounter, pct: number, now: number, level: CoopLevel): boolean {
  if (g.fireAt > 0 || now < g.coolUntil) return false;
  const K = RULES.coop.counter;
  g.value = Math.min(K.cap[level], counterValue(g, now, level) + pct);
  g.at = now;
  if (g.value < K.cap[level]) return false;
  g.fireAt = now + K.warnMs;
  return true;
}

/** 반격(fireAt)을 우클릭 보호막이 지키는지: 켜진 구간을 양쪽으로 lagMs 늘려 fireAt에 걸치면 지킴 */
export function barrierCovers(fx: CoopFx | undefined, fireAt: number): boolean {
  if (!fx || fx.barrierUntil <= 0) return false;
  const B = RULES.coop.barrier;
  return fx.barrierUntil - B.durationMs <= fireAt + B.lagMs && fireAt < fx.barrierUntil + B.lagMs;
}
