/**
 * 튜토리얼 장면 목록과 판단: 단계마다 장면(짚기·설명 카드·자유 연습·봇 견제)을 차례로 보여 준다.
 * 방 상태(원 목록 등)는 건드리지 않고 방이 묻는 것에만 답한다. 수치는 RULES.tutorial, 문구는 화면(client/src/tutorial.ts)
 */
import { RULES, clearCombo, isFever, type CircleKind, type PlayerState, type TutorialStep } from '@color-burst/shared';

const T = RULES.tutorial;

export type Beat =
  /** 원 하나를 짚고 멈춘다. 그 원 클릭만 받는다 (edge: 가장자리 구역에 닿으면 멈춤). prep: 장면 시작 때 맞출 값 */
  | { id: string; kind: 'focus'; accept: 'circle'; spawn: 'me' | 'yellow' | 'bot'; edge?: boolean; prep?: { combo?: number; fever?: number } }
  /** 멈추고 빈 곳 클릭만 받는다 */
  | { id: string; kind: 'focus'; accept: 'empty' }
  /** 멈추고 설명 카드. 넘기기(tutorial:next)로 진행 */
  | { id: string; kind: 'card'; point?: 'me' | 'bot' | 'gauge' | 'zones' }
  /** 판이 움직이는 자유 연습. until을 채우면 진행 */
  | { id: string; kind: 'free'; until: 'markEnd' | 'feverEnd' | 'zoneCatch' }
  /** 봇이 내 원 하나를 가져간다 (서버가 일으키는 견제) */
  | { id: string; kind: 'botSteal' };

export type FreeBeat = Extract<Beat, { kind: 'free' }>;

export const BEATS: Record<TutorialStep, readonly Beat[]> = {
  own: [
    { id: 'own.mine', kind: 'focus', accept: 'circle', spawn: 'me' },
    { id: 'own.mineCard', kind: 'card' },
    { id: 'own.yellow', kind: 'focus', accept: 'circle', spawn: 'yellow' },
    { id: 'own.yellowCard', kind: 'card' },
  ],
  combo: [
    { id: 'combo.intro', kind: 'card', point: 'me' },
    { id: 'combo.ten', kind: 'focus', accept: 'circle', spawn: 'me' },
    { id: 'combo.tenCard', kind: 'card' },
    { id: 'combo.empty', kind: 'focus', accept: 'empty' },
    { id: 'combo.emptyCard', kind: 'card' },
  ],
  steal: [
    { id: 'steal.intro', kind: 'card' },
    { id: 'steal.do', kind: 'focus', accept: 'circle', spawn: 'bot' },
    { id: 'steal.doCard', kind: 'card', point: 'me' },
    { id: 'steal.wait', kind: 'free', until: 'markEnd' },
    { id: 'steal.bot', kind: 'botSteal' },
    { id: 'steal.botCard', kind: 'card', point: 'bot' },
    { id: 'steal.counter', kind: 'focus', accept: 'circle', spawn: 'bot' },
    { id: 'steal.sumCard', kind: 'card' },
  ],
  fever: [
    { id: 'fever.intro', kind: 'card', point: 'gauge' },
    { id: 'fever.go', kind: 'focus', accept: 'circle', spawn: 'me', prep: { fever: T.feverStart } },
    { id: 'fever.onCard', kind: 'card' },
    { id: 'fever.play', kind: 'free', until: 'feverEnd' },
  ],
  zones: [
    { id: 'zones.intro', kind: 'card', point: 'zones' },
    { id: 'zones.edge', kind: 'focus', accept: 'circle', spawn: 'me', edge: true },
    { id: 'zones.play', kind: 'free', until: 'zoneCatch' },
  ],
};

/** 자유 연습 장면에 나올 원 종류 */
export function freeKinds(step: TutorialStep, me: PlayerState, bot: PlayerState | null): CircleKind[] {
  if (step === 'fever') return bot ? [me.color, 'y', bot.color] : [me.color, 'y'];
  return [me.color];
}

/** 자유 연습을 채웠는지 (zoneCatches: 이 장면에서 사이·가장자리 구역에서 잡은 수) */
export function freeDone(b: FreeBeat, me: PlayerState, now: number, zoneCatches: number): boolean {
  if (b.until === 'markEnd') return me.markedUntil <= now;
  if (b.until === 'feverEnd') return !isFever(me, now);
  return zoneCatches >= T.zoneGoal;
}

/** 단계 시작 준비: 콤보 단계는 시작 콤보, 그 밖은 0. 피버는 끈다 */
export function enterStep(step: TutorialStep, me: PlayerState): void {
  clearCombo(me);
  if (step === 'combo') me.combo = T.comboStart;
  me.feverUntil = 0;
  me.fever = 0;
}
