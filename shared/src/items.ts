/**
 * 아이템 원: 잡으면 무작위 아이템이 바로 발동한다 (클래식·아케이드 공통).
 * 수치는 rules.ts의 RULES.items에 있다.
 */
import {
  RULES, BLIND_KINDS, addBuff, addDebuff, addFever, isFever, isLast, startFever,
  type BuffId, type Circle, type GameRules, type PlayerState,
} from './rules.ts';
import { modsOf } from './arcade.ts';

export type ItemId =
  | 'wideHand' | 'magnet' | 'missGuard' | 'comboLock' | 'guard' | 'markClear' | 'feverCharge'
  | 'instantFever' | 'goldHand' | 'double' | 'paint' | 'rain' | 'zone' | 'bomb'
  | 'timeStop' | 'fieldClear'
  | 'slowCursor' | 'invertCursor' | 'blind' | 'snipe';

export type ItemTier = 0 | 1 | 2;
export const ITEM_TIERS = [
  { name: '흔함', color: '#ffffff' },
  { name: '희귀', color: '#4d9bff' },
  { name: '전설', color: 'prism' },
] as const;

export interface ItemDef {
  name: string;
  desc: string;
  tier: ItemTier;
  /** 시간 제한 효과면 그 버프 */
  buff?: BuffId;
  /** 방해 아이템 (방 규칙 '방해 아이템'이 꺼지면 안 나옴) */
  sabotage?: boolean;
}

const S = (ms: number) => `${ms / 1000}초`;
const M = RULES.items.ms;
export const ITEMS: Record<ItemId, ItemDef> = {
  wideHand: { name: '넓은 손', tier: 0, buff: 'wideHand', desc: `${S(M.wideHand)}간 범위 클릭` },
  magnet: { name: '자석', tier: 0, buff: 'magnet', desc: `${S(M.magnet)}간 커서 근처 내 원을 끌어당겨 잡음` },
  missGuard: { name: '헛클릭 무효', tier: 0, buff: 'missGuard', desc: `${S(M.missGuard)}간 빈 곳 클릭 페널티 없음` },
  comboLock: { name: '콤보 고정', tier: 0, buff: 'comboLock', desc: `${S(M.comboLock)}간 콤보가 끊기지 않음` },
  guard: { name: '보호막', tier: 0, buff: 'guard', desc: `${S(M.guard)}간 견제당해도 페널티 없음` },
  markClear: { name: '표적 해제', tier: 0, desc: '내 표적 상태가 바로 풀림' },
  feverCharge: { name: '피버 충전', tier: 0, desc: `피버 게이지 +${RULES.items.feverCharge}%` },
  instantFever: { name: '즉시 피버', tier: 1, desc: '바로 피버 (피버 중이면 시간 연장)' },
  goldHand: { name: '황금 손', tier: 1, desc: `다음에 잡는 원 ${RULES.items.goldCount}개 점수 2배` },
  double: { name: '점수 2배', tier: 1, buff: 'double', desc: `${S(M.double)}간 점수 2배` },
  paint: { name: '물들이기', tier: 1, buff: 'paint', desc: `${S(M.paint)}간 노란 원을 내 색 점수로` },
  rain: { name: '내 색 비', tier: 1, desc: `${S(M.rain)}간 내 색 원만 쏟아짐` },
  zone: { name: '장판', tier: 1, desc: `${S(RULES.items.zoneMs)}간 장판 위를 지나는 내 원을 자동으로 잡음` },
  bomb: { name: '폭죽', tier: 1, desc: '주변 원을 남의 색까지 전부 터뜨림' },
  timeStop: { name: '시간 정지', tier: 2, desc: `모든 원이 ${S(RULES.items.freezeMs)} 멈춤` },
  fieldClear: { name: '필드 클리어', tier: 2, desc: '화면의 원을 남의 색까지 전부 터뜨림' },
  slowCursor: { name: '감도 감소', tier: 0, sabotage: true, desc: `잡은 사람 뺀 모두의 커서가 ${S(RULES.sabotage.ms)}간 느려짐` },
  invertCursor: { name: '마우스 반대', tier: 0, sabotage: true, desc: `잡은 사람 뺀 모두의 커서가 ${S(RULES.sabotage.ms)}간 반대로 움직임` },
  blind: { name: '시야 방해', tier: 1, sabotage: true, desc: `잡은 사람 뺀 모두의 화면을 ${S(RULES.sabotage.ms)}간 가림 (잉크·반코트·낙서·렌즈)` },
  snipe: { name: '1등 저격', tier: 2, sabotage: true, desc: `1등(내가 1등이면 2등)을 ${S(RULES.sabotage.snipeStunMs)} 스턴, 콤보 끊김` },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** 잡은 아이템 원의 등급 안에서 무작위로 고른다. 빈 곳 페널티가 꺼진 방에서는 헛클릭 무효 제외 */
export function rollItem(tier: ItemTier, G: GameRules, rand = Math.random): ItemId {
  const pool = ITEM_IDS.filter((id) => ITEMS[id].tier === tier && !(id === 'missGuard' && !G.missPenalty) && !(ITEMS[id].sabotage && !G.sabotage));
  return pool[Math.floor(rand() * pool.length)];
}

/** 플레이어 혼자로 끝나지 않는 효과. 서버가 방 단위로 처리한다 */
export type RoomActionKind = 'zone' | 'bomb' | 'fieldClear' | 'timeStop' | 'rain';
/** snipe: 저격 대상(없으면 null)을 서버가 알린다 */
export type RoomAction = null | { kind: RoomActionKind } | { kind: 'snipe'; target: string | null };

/** 1등 저격 대상: 점수 1등(동점은 앞 순번), 잡은 사람이 1등이면 2등, 없으면 null */
export function snipeTarget(p: PlayerState, players: PlayerState[]): PlayerState | null {
  const order = [...players].sort((a, b) => b.score - a.score);
  return order.find((x) => x !== p) ?? null;
}

/** 아이템 발동: 플레이어 효과를 적용하고, 방 단위 효과면 그 종류를 돌려준다 */
export function applyItem(p: PlayerState, id: ItemId, now: number, G: GameRules, players: PlayerState[], rand = Math.random): RoomAction {
  const def = ITEMS[id];
  if (def.buff) {
    const ms = M[def.buff] * (G.comeback && isLast(p, players) ? RULES.items.comebackDur : 1);
    addBuff(p, def.buff, ms, now);
    return null;
  }
  const m = modsOf(p.picks);
  switch (id) {
    case 'markClear':
      // 표적 자처(저주)의 대가는 풀리지 않는다
      if (!m.selfTarget) p.markedUntil = Math.min(p.markedUntil, now);
      return null;
    case 'feverCharge':
      addFever(p, RULES.items.feverCharge, now, G, players, true);
      return null;
    case 'instantFever':
      if (isFever(p, now)) p.feverUntil += RULES.items.feverExtendMs;
      else { startFever(p, now, G, m); p.stats.fevers++; }
      return null;
    case 'goldHand':
      p.goldLeft += RULES.items.goldCount;
      return null;
    // 방해: 잡은 사람을 뺀 모두에게
    case 'slowCursor':
    case 'invertCursor':
    case 'blind': {
      const debuff = id === 'slowCursor' ? 'slow' : id === 'invertCursor' ? 'invert' : 'blind';
      for (const o of players) {
        if (o === p) continue;
        addDebuff(o, debuff, RULES.sabotage.ms, now);
        if (debuff === 'blind') o.blind = { kind: BLIND_KINDS[Math.floor(rand() * BLIND_KINDS.length)], seed: Math.floor(rand() * 1e9) };
      }
      return null;
    }
    case 'snipe': {
      const t = snipeTarget(p, players);
      if (t) { t.stunUntil = Math.max(t.stunUntil, now + RULES.sabotage.snipeStunMs); t.combo = 0; }
      return { kind: 'snipe', target: t?.id ?? null };
    }
    default:
      return { kind: id as RoomActionKind };
  }
}

/**
 * 시간 정지: 지금 있는 모든 원(보스 포함)에 정지 구간을 붙이고 id 목록을 돌려준다.
 * 이미 멈춰 있으면 겹치지 않게 앞 구간이 끝나는 시각부터 이어 붙인다 (겹치면 원이 뒤로 간다)
 */
export function holdCircles(circles: Iterable<Circle>, now: number, ms: number): number[] {
  const ids: number[] = [];
  for (const c of circles) {
    const holds = (c.holds ??= []);
    const from = Math.max(now, ...holds.map(([a, l]) => a + l));
    if (now + ms > from) holds.push([from, now + ms - from]);
    ids.push(c.id);
  }
  return ids;
}
