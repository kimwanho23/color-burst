/**
 * 튜토리얼 단계 규칙: 단계마다 나올 원 종류, 진행 판정, 단계 시작 준비.
 * 방 상태(원 목록 등)는 건드리지 않고 방이 묻는 것에만 답한다. 수치는 RULES.tutorial.
 */
import { RULES, type CircleKind, type PlayerState, type TutorialStep } from '@color-burst/shared';

const T = RULES.tutorial;

/** 이번 단계에 나올 원 종류 (견제 단계는 봇 색도) */
export function spawnKinds(step: TutorialStep, me: PlayerState, bot: PlayerState | null): CircleKind[] {
  if (step === 'fever') return [me.color, 'y'];
  if (step === 'steal' && bot) return [me.color, bot.color];
  return [me.color];
}

export type TutorialEvent = { kind: 'claim'; circleKind: CircleKind; feverStarted: boolean };

/** 사건 하나를 받아 새 진행 수를 돌려준다 (목표 수를 넘지 않음) */
export function progress(step: TutorialStep, ev: TutorialEvent, me: PlayerState, bot: PlayerState | null, count: number): number {
  const goal = T.goal[step];
  let next = count;
  if (step === 'own' && ev.circleKind === me.color) next = count + 1;
  else if (step === 'combo') next = me.combo; // 지금 콤보 그대로 (끊기면 0부터)
  else if (step === 'fever' && ev.feverStarted) next = 1;
  else if (step === 'steal' && bot && ev.circleKind === bot.color) next = count + 1;
  return Math.min(goal, next);
}

/** 단계 시작 준비: 콤보 0, 피버 단계면 피버를 끄고 게이지를 맞춘다 */
export function enterStep(step: TutorialStep, me: PlayerState): void {
  me.combo = 0;
  if (step === 'fever') { me.feverUntil = 0; me.fever = T.feverStart; }
}
