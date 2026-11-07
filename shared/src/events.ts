/**
 * 아케이드 랜덤 이벤트: 라운드 사이에 가끔 깜짝 룰렛이 돌아 무작위 이벤트가 일어난다.
 * 수치는 RANDOM_EVENT(등장·점수)와 rules.ts의 RULES.themes(라운드 테마)에 있다.
 */
import { ranking, isLast, type GameRules, type PlayerState, type ThemeId } from './rules.ts';
import { ABILITY, ARCADE, isCurse, isSpecial, type AbilityId, type RoundEffect, type Tier } from './arcade.ts';

export const RANDOM_EVENT = {
  /** 라운드 사이마다 등장 확률, 한 게임 최대 횟수 */
  chance: 0.1,
  maxPerGame: 2,
  /** 이벤트가 일어나면 능력 선택 시간이 이만큼 늘어난다 (룰렛 연출 + 결과 읽는 시간) */
  pickBonusMs: 4000,
  robinPct: 10,
  taxPct: 5,
  lottery: 30,
  /** 순위 역전 룰렛만 드물게 (다른 이벤트 가중치는 1) */
  swapWeight: 0.2,
} as const;

export const THEMES: Record<ThemeId, { name: string; desc: string }> = {
  goldRush: { name: '골드 러시', desc: '노란 원이 쏟아져요' },
  bossRush: { name: '보스 러시', desc: '보스가 세 번 나와요' },
  reverse: { name: '역발사', desc: '원이 가장자리에서 중앙으로 날아와요' },
  rainbowRain: { name: '무지개 비', desc: '무지개 원이 자주 나와요' },
  itemRush: { name: '아이템 폭주', desc: '아이템 원이 4배 자주 나와요' },
  allYellow: { name: '전원 같은 색', desc: '모든 원이 노란색, 견제 없는 속도 대결' },
};
const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export type EventId = 'robinHood' | 'tax' | 'lottery' | 'swap' | 'abilitySwap' | 'demote' | 'gift' | 'curseDelivery' | 'theme';

export const EVENTS: Record<EventId, { name: string }> = {
  robinHood: { name: '로빈 후드' },
  tax: { name: '세금' },
  lottery: { name: '복권' },
  swap: { name: '순위 역전 룰렛' },
  abilitySwap: { name: '능력 교환' },
  demote: { name: '강등' },
  gift: { name: '선물' },
  curseDelivery: { name: '저주 배달' },
  theme: { name: '라운드 테마' },
};
export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export interface EventResult {
  id: EventId;
  /** 결과 카드에 보여 줄 문장 */
  text: string;
  /** 점수 변화 */
  changes: { playerId: string; delta: number }[];
  theme?: ThemeId;
  /** 세금으로 걷은 합 (다음 라운드에 가장 많이 번 사람이 받는다) */
  pot?: number;
  giftTo?: string;
  curseTo?: string;
  swapped?: [string, string];
  demoted?: { playerId: string; id: AbilityId };
}

/** 이벤트가 건드릴 수 있는 능력: 저주·특별 카드 제외 */
const plainPicks = (p: PlayerState) => p.picks.filter((x) => !isCurse(x.id) && !isSpecial(x.id));
const curseCount = (p: PlayerState) => p.picks.filter((x) => isCurse(x.id)).length;
/** 저주 배달을 받을 수 있는 사람: 저주 상한이 아니고, 다음 선택이 전부 레전드(악마의 계약)가 아님 */
const canGetCurse = (p: PlayerState) => curseCount(p) < ARCADE.maxCurses && !p.legendNext;
const lastOf = (players: PlayerState[]) => players.find((p) => isLast(p, players));
const pickOne = <T,>(list: readonly T[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** 지금 상황에서 일으킬 수 있는 이벤트 */
function available(players: PlayerState[]): EventId[] {
  const hasLast = !!lastOf(players);
  const top = ranking(players)[0];
  return EVENT_IDS.filter((id) => {
    if (id === 'robinHood' || id === 'swap' || id === 'gift') return hasLast;
    if (id === 'abilitySwap') return players.filter((p) => plainPicks(p).length).length >= 2;
    if (id === 'demote') return !!top && plainPicks(top).some((x) => x.tier > 0);
    if (id === 'curseDelivery') return players.some(canGetCurse);
    return true;
  });
}

/** 라운드 사이: 이벤트가 일어날지, 일어나면 어떤 이벤트인지. used: 이번 게임에 이미 나온 횟수 */
/** chance: 등장 확률 (카오스는 RULES.chaos.eventChance) */
export function rollEvent(players: PlayerState[], used: number, rand = Math.random, chance: number = RANDOM_EVENT.chance): EventId | null {
  if (used >= RANDOM_EVENT.maxPerGame || !(rand() < chance)) return null;
  const ids = available(players);
  const w = ids.map((id) => (id === 'swap' ? RANDOM_EVENT.swapWeight : 1));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r < 0) return ids[i]; }
  return ids[ids.length - 1] ?? null;
}

/** 이벤트 적용: 점수·능력을 바꾸고 결과를 돌려준다. 선물·저주 배달·테마·세금 지급은 서버가 결과를 보고 처리한다 */
export function applyEvent(id: EventId, players: PlayerState[], G: GameRules, rand = Math.random): EventResult {
  const res: EventResult = { id, text: '', changes: [] };
  const add = (p: PlayerState, delta: number) => {
    const d = Math.max(-p.score, Math.trunc(delta));
    p.score += d;
    res.changes.push({ playerId: p.id, delta: d });
  };
  const top = ranking(players)[0];
  const last = lastOf(players);
  switch (id) {
    case 'robinHood': {
      const amt = Math.floor((top.score * RANDOM_EVENT.robinPct) / 100);
      add(top, -amt); add(last!, amt);
      res.text = `${top.name}님의 점수 ${amt}점이 ${last!.name}님에게!`;
      break;
    }
    case 'tax': {
      let pot = 0;
      for (const p of players) { const d = Math.floor((p.score * RANDOM_EVENT.taxPct) / 100); pot += d; add(p, -d); }
      res.pot = pot;
      res.text = `모두 ${RANDOM_EVENT.taxPct}%씩 세금! 모인 ${pot}점은 다음 라운드에 가장 많이 번 사람에게`;
      break;
    }
    case 'lottery': {
      const p = pickOne(players, rand);
      add(p, RANDOM_EVENT.lottery);
      res.text = `${p.name}님 복권 당첨! +${RANDOM_EVENT.lottery}점`;
      break;
    }
    case 'swap': {
      const a = top.score, b = last!.score;
      add(top, b - a); add(last!, a - b);
      res.text = `${top.name}님과 ${last!.name}님의 점수가 뒤바뀌었어요!`;
      break;
    }
    case 'abilitySwap': {
      const pool = players.filter((p) => plainPicks(p).length);
      const a = pickOne(pool, rand);
      const b = pickOne(pool.filter((p) => p !== a), rand);
      const pa = pickOne(plainPicks(a), rand), pb = pickOne(plainPicks(b), rand);
      a.picks[a.picks.indexOf(pa)] = pb;
      b.picks[b.picks.indexOf(pb)] = pa;
      res.swapped = [a.id, b.id];
      res.text = `${a.name}님의 ${ABILITY[pa.id].name} ↔ ${b.name}님의 ${ABILITY[pb.id].name}`;
      break;
    }
    case 'demote': {
      const pk = pickOne(plainPicks(top).filter((x) => x.tier > 0), rand);
      pk.tier = (pk.tier - 1) as Tier;
      res.demoted = { playerId: top.id, id: pk.id };
      res.text = `${top.name}님의 ${ABILITY[pk.id].name} 등급이 한 단계 내려갔어요`;
      break;
    }
    case 'gift':
      res.giftTo = last!.id;
      res.text = `${last!.name}님은 다음 능력 선택에서 선택지가 하나 더!`;
      break;
    case 'curseDelivery': {
      const p = pickOne(players.filter(canGetCurse), rand);
      res.curseTo = p.id;
      res.text = `${p.name}님의 다음 선택지에 저주 카드가 배달됐어요`;
      break;
    }
    case 'theme': {
      const ids = THEME_IDS.filter((t) => !(t === 'bossRush' && !G.boss) && !(t === 'itemRush' && !G.items));
      res.theme = pickOne(ids, rand);
      res.text = `다음 라운드는 ${THEMES[res.theme].name}! ${THEMES[res.theme].desc}`;
      break;
    }
  }
  return res;
}

/**
 * 세금 지급: 이번 라운드에 가장 많이 번 사람(라운드 점수 증가량)이 받는다.
 * 동점이면 똑같이 나누고, 나누어떨어지지 않는 나머지는 그중 총점이 가장 낮은 사람에게
 */
export function payTax(players: PlayerState[], pot: number): RoundEffect[] {
  const gain = (p: PlayerState) => p.score - p.roundStart;
  const best = Math.max(...players.map(gain));
  const winners = players.filter((p) => gain(p) === best);
  const share = Math.floor(pot / winners.length);
  const lowest = winners.reduce((a, b) => (b.score < a.score ? b : a));
  return winners.map((p) => {
    const delta = share + (p === lowest ? pot - share * winners.length : 0);
    p.score += delta;
    return { playerId: p.id, id: 'tax' as const, delta };
  });
}
