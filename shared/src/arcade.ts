/**
 * 아케이드 모드: 라운드 사이에 고르는 능력(증강).
 * 능력은 등급과 따로 정해져 있고, 어느 등급으로 뜨느냐에 따라 수치만 달라진다.
 * 같은 능력을 다시 고르면 수치가 합쳐진다(중첩).
 * 밸런스는 이 파일의 ABILITIES 수치와 TIER_ODDS만 고치면 된다.
 */

export type Tier = 0 | 1 | 2 | 3;
export const TIERS = [
  { name: '노말', color: '#ffffff' },
  { name: '레어', color: '#4d9bff' },
  { name: '에픽', color: '#b26cff' },
  { name: '레전드', color: 'prism' },
] as const;

export const ARCADE = {
  rounds: 5,
  pickSec: 30,
  optionCount: 3,
  rerollsPerPick: 1,
  /** 선택지 하나가 저주 카드로 바뀔 확률 (꼴찌는 lastPlace) */
  curseChance: 0.15,
  curseChanceLastPlace: 0.3,
  /** 한 게임에 가질 수 있는 저주 수 */
  maxCurses: 1,
} as const;

/** 저주 카드 수치 */
export const CURSE = {
  glassCannon: { boostPct: 50, missPenalty: 5 },
  gambler: { winPct: 30, losePct: 15, chance: 0.5 },
  berserker: { multAdd: 3, gainDiv: 1.5 },
  oneWay: { ownMult: 3 },
  vampire: { drain: 3 },
  timeBomb: { bonus: 40, comboGoal: 10, penalty: 60 },
  selfTarget: { boostPct: 30 },
  devilPact: { keepPct: 50 },
} as const;

/** 능력 선택 차례(0 = 1라운드 뒤)별 등급 확률(%) [노말, 레어, 에픽, 레전드] */
export const TIER_ODDS: readonly (readonly [number, number, number, number])[] = [
  [70, 25, 5, 0],
  [55, 32, 12, 1],
  [40, 37, 20, 3],
  [25, 40, 30, 5],
];
/** 꼴찌는 한 단계 다음 차례의 확률을 쓰고, 마지막 차례에서는 이 확률을 쓴다 */
export const LAST_PLACE_FINAL_ODDS = [15, 35, 35, 15] as const;

export type AbilityId =
  | 'picky' | 'yellowTaste' | 'rainbowHunt' | 'comboArtist' | 'headStart'
  | 'preheat' | 'overtime' | 'overcharge' | 'frenzy' | 'afterglow'
  | 'hammer' | 'hunter' | 'crusher'
  | 'insurance' | 'calm' | 'shield'
  | 'thickSkin' | 'plunder' | 'counterPro' | 'jammer'
  | 'jackpot' | 'wideHand' | 'magnet' | 'reflect'
  | CurseId;

export type CurseId = 'glassCannon' | 'gambler' | 'berserker' | 'oneWay' | 'vampire' | 'timeBomb' | 'selfTarget' | 'devilPact';

export type AbilityCategory = '점수' | '피버' | '보스' | '유지' | '견제' | '보조' | '저주';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cat: AbilityCategory;
  /** 등급별 수치 [노말, 레어, 에픽, 레전드] */
  values: readonly [number, number, number, number];
  /** 수치(중첩 합계 포함)를 받아 설명 문장을 만든다 */
  desc: (v: number) => string;
  /** 중첩 상한 */
  cap?: number;
  /** 견제 관련: 플레이 후기 뒤 수치 확정 */
  provisional?: boolean;
  /** 저주 카드: 등급 없음, 보상과 대가를 따로 표시 */
  curse?: { gain: string; cost: string };
}

const sec = (ms: number) => `${+(ms / 1000).toFixed(1)}초`;

export const ABILITIES: readonly AbilityDef[] = [
  // 점수
  { id: 'picky', name: '편식가', cat: '점수', values: [1, 2, 3, 5], desc: (v) => `내 색 +${v}점, 대신 노란색 −1점` },
  { id: 'yellowTaste', name: '노란 맛', cat: '점수', values: [1, 2, 3, 5], desc: (v) => `노란색 +${v}점` },
  { id: 'rainbowHunt', name: '무지개 사냥', cat: '점수', values: [3, 6, 9, 15], desc: (v) => `무지개 +${v}점` },
  { id: 'comboArtist', name: '콤보 장인', cat: '점수', values: [1, 2, 3, 5], cap: 7, desc: (v) => `콤보 보너스가 ${comboPeriod(v)}콤보마다` },
  { id: 'headStart', name: '출발 신호', cat: '점수', values: [5, 10, 15, 25], desc: (v) => `라운드 시작할 때 +${v}점` },
  { id: 'jackpot', name: '잭팟', cat: '점수', values: [5, 10, 15, 25], cap: 50, desc: (v) => `원을 잡을 때 ${v}% 확률로 잭팟 (×1.5~×3)` },
  // 피버
  { id: 'preheat', name: '예열', cat: '피버', values: [20, 40, 60, 100], cap: 100, desc: (v) => (v >= 100 ? '라운드를 피버 상태로 시작' : `라운드를 피버 게이지 ${v}%로 시작`) },
  { id: 'overtime', name: '연장전', cat: '피버', values: [1, 2, 3, 5], desc: (v) => `피버 시간 +${v}초` },
  { id: 'overcharge', name: '과충전', cat: '피버', values: [15, 30, 45, 75], desc: (v) => `피버 게이지 충전 +${v}%` },
  { id: 'frenzy', name: '폭주', cat: '피버', values: [0.5, 1, 1.5, 2.5], desc: (v) => `피버 배율 +${v}` },
  { id: 'afterglow', name: '여운', cat: '피버', values: [1, 2, 3, 5], desc: (v) => `피버가 끝난 뒤 ${v}초 동안 점수 ×1.5` },
  // 보스
  { id: 'hammer', name: '해머', cat: '보스', values: [1, 2, 3, 5], desc: (v) => `보스 타격 +${v}점` },
  { id: 'hunter', name: '사냥꾼', cat: '보스', values: [10, 20, 30, 50], desc: (v) => `보스 막타 +${v}점` },
  { id: 'crusher', name: '파쇄', cat: '보스', values: [0.5, 1, 2, 4], desc: (v) => (v < 1 ? `보스를 때리면 ${Math.round(v * 100)}% 확률로 2타` : `보스를 때리면 ${crushText(v)}`) },
  // 유지
  { id: 'insurance', name: '보험', cat: '유지', values: [20, 40, 60, 100], cap: 100, desc: (v) => `콤보가 끊겨도 ${v}% 유지` },
  { id: 'calm', name: '침착', cat: '유지', values: [1, 2, 3, 5], desc: (v) => `빈 곳 클릭 페널티를 라운드당 ${v}번 무시` },
  { id: 'shield', name: '방패', cat: '유지', values: [1, 2, 3, 5], desc: (v) => `견제당해도 콤보 유지, 라운드당 ${v}번` },
  // 견제
  { id: 'thickSkin', name: '철면피', cat: '견제', values: [1, 2, 3, 99], provisional: true, desc: (v) => (v >= 99 ? '견제해도 표적이 되지 않음' : `표적 시간 −${v}초`) },
  { id: 'plunder', name: '강탈', cat: '견제', values: [1, 1, 2, 3], provisional: true, desc: (v) => `견제하면 상대 점수 ${v}점을 빼앗음` },
  { id: 'counterPro', name: '반격 전문가', cat: '견제', values: [2, 4, 6, 10], provisional: true, desc: (v) => `반격 +${v}점` },
  { id: 'reflect', name: '견제 반사', cat: '견제', values: [1, 2, 3, 5], desc: (v) => `내 색을 견제당하면 내가 잡은 것으로, 견제한 사람은 콤보 끊김·표적 (라운드당 ${v}번)` },
  { id: 'jammer', name: '방해 전파', cat: '견제', values: [500, 1000, 1500, 2500], provisional: true, desc: (v) => `내 피버가 터지면 상대 원이 ${sec(v)} 동안 흐려짐` },
  // 보조
  { id: 'wideHand', name: '넓은 손', cat: '보조', values: [15, 25, 35, 55], cap: 80, desc: (v) => `클릭 둘레 ${v} 안의 내 원을 한 번에` },
  { id: 'magnet', name: '자석', cat: '보조', values: [60, 90, 120, 160], cap: 200, desc: (v) => `커서 둘레 ${v} 안의 내 원을 끌어당겨 잡음 (1초에 2개)` },
];

/** 봇은 고르지 않는 능력 (봇은 원을 정확히 눌러서 효과가 없음) */
export const ASSIST_ABILITIES: readonly AbilityId[] = ['wideHand', 'magnet'];

/** 잭팟 배율과 그 확률(%) */
export const JACKPOT = { mults: [1.5, 2, 3], odds: [70, 25, 5] } as const;

const C = CURSE;
/** 저주 카드: 큰 보상 + 확실한 대가. 등급이 없고 수치는 고정(값 1 = 보유) */
export const CURSES: readonly AbilityDef[] = ([
  ['glassCannon', '유리 대포', `모든 점수 +${C.glassCannon.boostPct}%`, `빈 곳 클릭하면 −${C.glassCannon.missPenalty}점`],
  ['gambler', '도박사', `라운드가 끝날 때 ${C.gambler.chance * 100}% 확률로 그 라운드 점수 +${C.gambler.winPct}%`, `아니면 −${C.gambler.losePct}%`],
  ['berserker', '광전사', `피버 배율 +${C.berserker.multAdd}`, `피버 게이지가 ${C.berserker.gainDiv}배 느리게 참`],
  ['oneWay', '외길', `내 색 점수 ×${C.oneWay.ownMult}`, '노란색·무지개 0점'],
  ['vampire', '흡혈귀', `견제할 때마다 상대 점수 ${C.vampire.drain}점을 빼앗음`, `견제당하면 내 점수도 ${C.vampire.drain}점 빼앗김`],
  ['timeBomb', '시한폭탄', `라운드 시작할 때 +${C.timeBomb.bonus}점`, `그 라운드에 ${C.timeBomb.comboGoal}콤보를 못 넘기면 −${C.timeBomb.penalty}점`],
  ['selfTarget', '표적 자처', `모든 점수 +${C.selfTarget.boostPct}%`, '라운드 내내 표적 (누구나 반격 가능)'],
  ['devilPact', '악마의 계약', '다음 능력 선택이 전부 레전드', `다음 라운드 점수 ${C.devilPact.keepPct}%만 인정`],
] as const).map(([id, name, gain, cost]) => ({
  id, name, cat: '저주' as const, values: [1, 1, 1, 1] as const, cap: 1, curse: { gain, cost },
  desc: () => `${gain} / 대가: ${cost}`,
}));

export const ALL_ABILITIES: readonly AbilityDef[] = [...ABILITIES, ...CURSES];
export const isCurse = (id: AbilityId) => !!ABILITY[id]?.curse;

export const ABILITY = Object.fromEntries(ALL_ABILITIES.map((a) => [a.id, a])) as Record<AbilityId, AbilityDef>;

export interface Pick { id: AbilityId; tier: Tier }
export type Mods = Record<AbilityId, number>;

const ZERO = Object.fromEntries(ALL_ABILITIES.map((a) => [a.id, 0])) as Mods;

/** 고른 능력들을 합친 수치 (중첩, 상한 적용) */
export function modsOf(picks: readonly Pick[] | undefined): Mods {
  if (!picks?.length) return ZERO;
  const m = { ...ZERO };
  for (const p of picks) {
    const a = ABILITY[p.id];
    if (!a) continue;
    m[p.id] = Math.min(a.cap ?? Infinity, m[p.id] + a.values[p.tier]);
  }
  return m;
}

export const abilityValue = (p: Pick) => ABILITY[p.id].values[p.tier];
export const abilityText = (p: Pick) => ABILITY[p.id].desc(abilityValue(p));

/** 콤보 보너스 주기: 기본 10콤보, 최소 3콤보 */
export const comboPeriod = (cut: number) => Math.max(3, 10 - cut);

function crushText(v: number) {
  const whole = 1 + Math.floor(v);
  const frac = v - Math.floor(v);
  return frac ? `${whole}타, ${Math.round(frac * 100)}% 확률로 ${whole + 1}타` : `${whole}타`;
}

/** 잭팟: 터지면 배율, 아니면 1 */
export function jackpotMult(m: Mods, rand = Math.random) {
  if (!(rand() < m.jackpot / 100)) return 1;
  let r = rand() * 100;
  for (let i = 0; i < JACKPOT.mults.length; i++) { r -= JACKPOT.odds[i]; if (r < 0) return JACKPOT.mults[i]; }
  return JACKPOT.mults[JACKPOT.mults.length - 1];
}

/** 파쇄: 보스에 주는 피해 */
export function bossDamage(m: Mods, rand = Math.random) {
  const v = m.crusher;
  return 1 + Math.floor(v) + (rand() < v - Math.floor(v) ? 1 : 0);
}

function rollTier(odds: readonly number[], rand: () => number): Tier {
  let r = rand() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) return i as Tier; }
  return 0;
}

/**
 * 능력 선택지 뽑기. 서로 다른 능력 optionCount개, 등급은 각각 따로 굴린다.
 * pickIndex: 0 = 1라운드 뒤. lastPlace면 상위 등급 확률이 올라간다.
 */
export interface RollOpts {
  /** 이미 가진 저주 수 (상한이면 저주가 안 나옴) */
  curses?: number;
  /** 악마의 계약: 이번 선택은 전부 레전드 */
  allLegend?: boolean;
  /** 랜덤 이벤트 '저주 배달': 선택지 하나를 반드시 저주로 (저주 상한이면 무시) */
  forceCurse?: boolean;
  /** 이 방 규칙에서 의미 없는 능력 (예: 빈 곳 페널티가 꺼져 있으면 침착) */
  exclude?: readonly AbilityId[];
}

export function rollOptions(pickIndex: number, lastPlace: boolean, rand = Math.random, opts: RollOpts = {}, count: number = ARCADE.optionCount): Pick[] {
  const i = Math.min(pickIndex, TIER_ODDS.length - 1);
  const odds = lastPlace ? (i + 1 < TIER_ODDS.length ? TIER_ODDS[i + 1] : LAST_PLACE_FINAL_ODDS) : TIER_ODDS[i];
  const pool = ABILITIES.filter((a) => !opts.exclude?.includes(a.id));
  const out: Pick[] = [];
  while (out.length < count && pool.length) {
    const a = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push({ id: a.id, tier: opts.allLegend ? 3 : rollTier(odds, rand) });
  }
  // 저주 카드: 선택지 하나를 바꿔 끼운다
  const chance = opts.forceCurse ? 1 : lastPlace ? ARCADE.curseChanceLastPlace : ARCADE.curseChance;
  if (!opts.allLegend && (opts.curses ?? 0) < ARCADE.maxCurses && rand() < chance) {
    // 악마의 계약은 마지막 선택에서는 대가만 남아서 제외
    const curses = CURSES.filter((c) => !(c.id === 'devilPact' && pickIndex >= ARCADE.rounds - 2));
    const c = curses[Math.floor(rand() * curses.length)];
    out[Math.floor(rand() * out.length)] = { id: c.id, tier: 0 };
  }
  return out;
}

/** 라운드가 끝날 때 적용되는 저주 결과 */
/** 'tax': 랜덤 이벤트 세금을 받은 사람 */
export interface RoundEffect { playerId: string; id: CurseId | 'tax'; delta: number }
