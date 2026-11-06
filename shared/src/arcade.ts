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
  pickSec: 15,
  optionCount: 3,
  rerollsPerPick: 1,
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
  | 'thickSkin' | 'plunder' | 'counterPro' | 'jammer';

export type AbilityCategory = '점수' | '피버' | '보스' | '유지' | '견제';

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
}

const sec = (ms: number) => `${+(ms / 1000).toFixed(1)}초`;

export const ABILITIES: readonly AbilityDef[] = [
  // 점수
  { id: 'picky', name: '편식가', cat: '점수', values: [1, 2, 3, 5], desc: (v) => `내 색 +${v}점, 대신 노란색 −1점` },
  { id: 'yellowTaste', name: '노란 맛', cat: '점수', values: [1, 2, 3, 5], desc: (v) => `노란색 +${v}점` },
  { id: 'rainbowHunt', name: '무지개 사냥', cat: '점수', values: [3, 6, 9, 15], desc: (v) => `무지개 +${v}점` },
  { id: 'comboArtist', name: '콤보 장인', cat: '점수', values: [1, 2, 3, 5], cap: 7, desc: (v) => `콤보 보너스가 ${comboPeriod(v)}콤보마다` },
  { id: 'headStart', name: '출발 신호', cat: '점수', values: [5, 10, 15, 25], desc: (v) => `라운드 시작할 때 +${v}점` },
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
  { id: 'plunder', name: '강탈', cat: '견제', values: [1, 2, 3, 5], provisional: true, desc: (v) => `견제하면 상대 점수 ${v}점을 빼앗음` },
  { id: 'counterPro', name: '반격 전문가', cat: '견제', values: [2, 4, 6, 10], provisional: true, desc: (v) => `반격 +${v}점` },
  { id: 'jammer', name: '방해 전파', cat: '견제', values: [500, 1000, 1500, 2500], provisional: true, desc: (v) => `내 피버가 터지면 상대 원이 ${sec(v)} 동안 흐려짐` },
];

export const ABILITY = Object.fromEntries(ABILITIES.map((a) => [a.id, a])) as Record<AbilityId, AbilityDef>;

export interface Pick { id: AbilityId; tier: Tier }
export type Mods = Record<AbilityId, number>;

const ZERO = Object.fromEntries(ABILITIES.map((a) => [a.id, 0])) as Mods;

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
export function rollOptions(pickIndex: number, lastPlace: boolean, rand = Math.random, count: number = ARCADE.optionCount): Pick[] {
  const i = Math.min(pickIndex, TIER_ODDS.length - 1);
  const odds = lastPlace ? (i + 1 < TIER_ODDS.length ? TIER_ODDS[i + 1] : LAST_PLACE_FINAL_ODDS) : TIER_ODDS[i];
  const pool = [...ABILITIES];
  const out: Pick[] = [];
  while (out.length < count && pool.length) {
    const a = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push({ id: a.id, tier: rollTier(odds, rand) });
  }
  return out;
}
