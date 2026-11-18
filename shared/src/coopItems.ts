/**
 * 협력전 보스전 아이템: 보스가 뿜는 원 중 가끔 ? 원이 섞이고, 잡을 때 종류를 굴린다. 잡은 사람이 받는다(모두 회복은 살아 있는 사람 모두).
 * 효과 계산은 서버 CoopRun(server/src/coop.ts), 수치는 RULES.coop.items.
 */
import { RULES, type CoopLevel } from './rules.ts';

export type CoopItemId = 'clear' | 'guard' | 'heal' | 'healAll' | 'fire' | 'power' | 'weak' | 'chain' | 'combo' | 'missile';
export const COOP_ITEM_IDS: readonly CoopItemId[] = ['clear', 'guard', 'heal', 'healAll', 'fire', 'power', 'weak', 'chain', 'combo', 'missile'];

/** 화면 이름·한 줄 설명 */
export const COOP_ITEMS: Record<CoopItemId, { name: string; desc: string }> = {
  clear: { name: '탄막 지우기', desc: '판의 탄을 모두 지워요' },
  guard: { name: '방어막', desc: '3초 안에 한 번 막아요' },
  heal: { name: '회복', desc: '내 체력 +20' },
  healAll: { name: '모두 회복', desc: '살아 있는 모두 체력 +10' },
  fire: { name: '화력 강화', desc: '5초 동안 피해 ×1.5' },
  power: { name: '공격력 강화', desc: '피해 +20% (단계가 오르면 사라져요)' },
  weak: { name: '약점 노출', desc: '5초 동안 보스 약점을 누르면 피해' },
  chain: { name: '연쇄 폭발', desc: '다음 원 3개 피해 ×2' },
  combo: { name: '콤보 +10', desc: '콤보가 10 올라요' },
  missile: { name: '미사일', desc: '보스에게 미사일 8발' },
};

/** 사람마다 걸린 아이템 효과 (서버 시각). power 0~powerMax, chain 남은 원 수 */
export interface CoopFx { guardUntil: number; fireUntil: number; power: number; chain: number }

export const newCoopFx = (): CoopFx => ({ guardUntil: 0, fireUntil: 0, power: 0, chain: 0 });

/** 아이템 종류: 가중치대로 (엑스퍼트는 회복·모두 회복 제외) */
export function rollCoopItem(level: CoopLevel, rand: () => number): CoopItemId {
  const W = RULES.coop.items.weight;
  const pool = COOP_ITEM_IDS.filter((id) => level !== 'expert' || (id !== 'heal' && id !== 'healAll'));
  const total = pool.reduce((a, id) => a + W[id], 0);
  let r = rand() * total;
  for (const id of pool) { r -= W[id]; if (r < 0) return id; }
  return pool[pool.length - 1]!;
}

/** 원 피해 배율: (1 + powerStep × power) × (화력 강화 중이면 fireMult). 연쇄 폭발은 따로 곱한다 */
export function coopDamageMult(fx: CoopFx | undefined, now: number): number {
  if (!fx) return 1;
  const I = RULES.coop.items;
  return (1 + I.powerStep * fx.power) * (now < fx.fireUntil ? I.fireMult : 1);
}
