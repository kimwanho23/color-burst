import { RULES } from './rules.ts';
import type { Point } from './cursor.ts';

export const COOP_ATTACK_SPECIAL_IDS = ['laser', 'meteor', 'blades'] as const;
export type CoopAttackSpecialId = (typeof COOP_ATTACK_SPECIAL_IDS)[number];
export type CoopSupportSpecialId = 'ward' | 'bind' | 'link';
export type CoopSpecialId = CoopAttackSpecialId | CoopSupportSpecialId;
export const COOP_SPECIAL_IDS: readonly CoopSpecialId[] = [...COOP_ATTACK_SPECIAL_IDS, 'ward', 'bind', 'link'];

const { support } = RULES.coop.special;
export const COOP_SPECIALS: Record<CoopSpecialId, { name: string; desc: string; color: string }> = {
  laser: { name: '레이저', desc: '빠르게 충전해 보스에게 연속 빔 공격', color: '#64efff' },
  meteor: { name: '유성 폭격', desc: '충전을 모아 강력한 유성 5연타', color: '#ffbd73' },
  blades: { name: '회전 칼날', desc: '가장 오래 충전해 보스 주위를 칼날로 연속 타격', color: '#d6a4ff' },
  ward: { name: '수호 결계', desc: `결계 안 팀원이 받는 모든 피해 ${Math.round(support.ward.damageReduction * 100)}% 감소`, color: '#63f2d4' },
  bind: { name: '중력 족쇄', desc: `보스를 묶고 팀 색 원만 생성 · 해제 후 ${support.bind.immunityMs / 1000}초 내성`, color: '#c9a4ff' },
  link: { name: '연계 신호', desc: `팀원이 자기 색·노란 원을 잡을 때 콤보 +${support.link.comboAdd} 추가`, color: '#91e5ff' },
};

export const specialId = (id: unknown): CoopSpecialId => COOP_SPECIAL_IDS.find((x) => x === id) ?? 'laser';
export function isAttackSpecial(id: CoopSpecialId): id is CoopAttackSpecialId {
  return id in RULES.coop.special.attacks;
}
export const attackSpecialRule = (id: CoopAttackSpecialId) => RULES.coop.special.attacks[id];
export const specialRule = (id: unknown) => {
  const kind = specialId(id);
  return isAttackSpecial(kind) ? attackSpecialRule(kind) : support[kind];
};

export interface CoopWard extends Point {
  until: number;
}

/** 진행 중인 자동 공격. 서버 시각으로 재접속·일시정지 후에도 같은 연출을 그린다. */
export interface CoopSpecialAttack {
  by: string;
  kind: CoopAttackSpecialId;
  from: Point;
  at: number;
}
