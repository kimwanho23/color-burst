import { RULES } from '@color-burst/shared';

/** 보호막 요청 뒤 서버 응답(players)을 기다리는 최대 시간(ms). 이 안에는 맞은 연출을 미리 내지 않는다 */
export const BARRIER_PENDING_MS = 500;

type BarrierFx = { barrierUntil: number; barrierLeft: number };

/** 보호막을 요청해도 되는지: 남은 횟수가 있고, 켜져 있지 않고, 끝난 뒤 쿨타임도 지났으면 true (서버와 같은 조건) */
export function barrierReady(fx: BarrierFx | undefined, now: number): boolean {
  if (!fx || fx.barrierLeft <= 0) return false;
  return !fx.barrierUntil || now >= fx.barrierUntil + RULES.coop.barrier.cooldownMs;
}

/** 화면 예측을 건너뛸지: 보호막이 켜져 있거나, 방금 요청했고 서버가 켜 줄 것 같으면 true */
export function barrierGuarding(fx: BarrierFx | undefined, requestedAt: number, now: number): boolean {
  if (!fx) return false;
  if (now < fx.barrierUntil) return true;
  return barrierReady(fx, now) && requestedAt > 0 && now - requestedAt < BARRIER_PENDING_MS;
}

/** 다른 버튼을 누른 채 버튼을 새로 누름 (브라우저는 pointerdown 대신 pointermove로 알린다). button은 바뀐 버튼, buttons는 지금 눌린 버튼 비트 */
export function chordPress(pointerType: string, button: number, buttons: number): boolean {
  if (pointerType !== 'mouse') return false;
  return button === 0 ? (buttons & 1) !== 0 : button === 2 ? (buttons & 2) !== 0 : false;
}

/** 게임 화면 누르기 구분: 마우스 왼쪽·터치·펜은 클릭 판정, 마우스 오른쪽은 보호막, 그 밖의 마우스 버튼은 무시 */
export function pointerAction(pointerType: string, button: number): 'click' | 'barrier' | 'ignore' {
  if (pointerType !== 'mouse') return 'click';
  return button === 0 ? 'click' : button === 2 ? 'barrier' : 'ignore';
}
