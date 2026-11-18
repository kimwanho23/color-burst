import { RULES } from './rules.ts';
import type { Point } from './cursor.ts';

export type CoopSpecialId = 'laser' | 'meteor' | 'blades';
export const COOP_SPECIAL_IDS: readonly CoopSpecialId[] = ['laser', 'meteor', 'blades'];
export const COOP_SPECIALS: Record<CoopSpecialId, { name: string; desc: string; color: string }> = {
  laser: { name: '레이저', desc: '빠르게 충전해 보스에게 연속 빔 공격', color: '#64efff' },
  meteor: { name: '유성 폭격', desc: '충전을 모아 강력한 유성 5연타', color: '#ffbd73' },
  blades: { name: '회전 칼날', desc: '가장 오래 충전해 보스 주위를 칼날로 연속 타격', color: '#d6a4ff' },
};

export const specialId = (id: unknown): CoopSpecialId => COOP_SPECIAL_IDS.find((x) => x === id) ?? 'laser';
export const specialRule = (id: unknown) => RULES.coop.special.attacks[specialId(id)];

/** 진행 중인 자동 공격. 서버 시각으로 재접속·일시정지 후에도 같은 연출을 그린다. */
export interface CoopSpecialAttack {
  by: string;
  kind: CoopSpecialId;
  from: Point;
  at: number;
}
