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
  /** 선택 차례(0 = 1라운드 뒤)별 고르는 카드 수 */
  picksPerRound: [1, 1, 2, 2],
  /** 이 차례부터 모두 노말 등급이 안 나온다 */
  noNormalFrom: 1,
  /** 꼴찌: 차례별로 이 등급 이상 카드가 1장 이상 (2장 고르는 차례는 첫 묶음에만) */
  lastGuarantee: [1, 2, 2, 3],
  /**
   * 역전 기회: 꼴찌 점수 < 1등 × ratio이면 켜짐. from 차례부터 판정(2라운드 끝),
   * specialAt 차례에 특별 카드 1장, legendAt 차례에 전부 레전드. 켜진 동안 꼴찌 점수에 방 인원별 배율
   */
  comeback: { ratio: 0.6, from: 1, specialAt: 2, legendAt: 3, roomMult: { 2: 1.1, 3: 1.2, 4: 1.3 } as Record<number, number> },
} as const;

/** 레전드 전용 효과 수치 */
export const LEGEND = {
  hammerChance: 0.15, hammerDmg: 3, comboBonusAdd: 10, headStartMs: 10_000, headStartMult: 1.5, jackpotMults: [2, 3, 5],
  preheatMult: 2, overtimeMs: 100, overchargeKeep: 50, afterglowMult: 2, shieldDrain: 3, plunderTopMult: 2,
  jammerSlowMs: 2_000, wideHandMult: 1.5, magnetPerSec: 2, missSaveMult: 1.5, rapidStreak: 5, laserFever: 20,
  collectorUp: 0.5, chainEvery: 5, tauntMs: 1_000, zoneComboAdd: 1, counterFever: 20,
  pickyFeverMult: 2, frenzyComboMult: 2, vanguardMult: 2, rainbowFeverMult: 2,
} as const;

/** 증강 조합 보너스 수치 */
export const COMBO = {
  feverAdd: 1, comboBonusMult: 2, bossDmgAdd: 1, bossHitMult: 1.5, bossKillMult: 2, stealMult: 3, stealMarkCutMs: 1_000,
  jackpotAdd: 10, outskirtsMult: 1.5, ironKeepPct: 80,
} as const;
/** 빌드 가중치: 가진 증강과 같은 분류 ×sameCat, 가진 조합의 나머지 ×comboPart (곱함) */
export const WEIGHT = { sameCat: 2, comboPart: 3 } as const;

/** 새 증강 수치 */
/** magnetPointPct: 자석으로 끌어온 원 점수(%, 콤보·콤보 보너스·잭팟·피버 게이지 없음) */
export const AUG = { reboundMs: 3_000, rapidMs: 400, chainEvery: 10, chainR: 150, vanguardMs: 3_000, afterglowMult: 1.5, magnetPointPct: 70 } as const;

/** 특별 카드 수치 */
export const SPECIAL = {
  boost: 1.5, flipPct: 20, focusMult: 2, hyenaChance: 0.2, hyenaGain: 3, momentumEvery: 5,
  chainChance: 0.15, chainR: 120, feastMult: 2, flameMs: 15_000, flameMult: 2, hunterDur: 2, chaserAdd: 1,
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
  | 'insurance' | 'shield'
  | 'thickSkin' | 'plunder' | 'counterPro' | 'jammer'
  | 'jackpot' | 'wideHand' | 'magnet' | 'reflect' | 'edge'
  | 'missSave' | 'rebound' | 'rapid' | 'laserProof' | 'collector' | 'chainCombo' | 'centerKing' | 'ignite' | 'vanguard' | 'taunt'
  | CurseId | SpecialId;

export type SpecialId =
  | 'comebackBoost' | 'flip' | 'focusFire' | 'hyena' | 'chaser' | 'momentum'
  | 'allHands' | 'fortress' | 'chainBlast' | 'bossFeast' | 'lastFlame' | 'itemHunter';

export type CurseId = 'glassCannon' | 'gambler' | 'berserker' | 'oneWay' | 'vampire' | 'timeBomb' | 'selfTarget' | 'devilPact';

export type AbilityCategory = '점수' | '피버' | '보스' | '유지' | '견제' | '보조' | '저주' | '특별';

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
  /** 특별 카드: 역전 기회인 꼴찌만 받는 카드 (등급 없음, 게임 끝까지) */
  special?: true;
}

const sec = (ms: number) => `${+(ms / 1000).toFixed(1)}초`;

export const ABILITIES: readonly AbilityDef[] = [
  // 점수
  { id: 'picky', name: '편식가', cat: '점수', values: [1, 2, 3, 6], desc: (v) => `내 색 +${v}점, 대신 노란색 −1점` },
  { id: 'yellowTaste', name: '노란 맛', cat: '점수', values: [1, 2, 3, 6], desc: (v) => `노란색 +${v}점` },
  { id: 'rainbowHunt', name: '무지개 사냥', cat: '점수', values: [3, 6, 9, 18], desc: (v) => `무지개 +${v}점` },
  { id: 'comboArtist', name: '콤보 장인', cat: '점수', values: [1, 2, 3, 6], cap: 7, desc: (v) => `콤보 보너스가 ${comboPeriod(v)}콤보마다` },
  { id: 'headStart', name: '출발 신호', cat: '점수', values: [5, 10, 15, 30], desc: (v) => `라운드 시작할 때 +${v}점` },
  { id: 'jackpot', name: '잭팟', cat: '점수', values: [5, 10, 15, 30], cap: 35, desc: (v) => `원을 잡을 때 ${v}% 확률로 잭팟 (×1.5~×3)` },
  { id: 'rapid', name: '속사', cat: '점수', values: [1, 2, 3, 6], cap: 12, desc: (v) => `${AUG.rapidMs / 1000}초 안에 연달아 잡으면 두 번째부터 +${v}점` },
  { id: 'chainCombo', name: '연쇄 콤보', cat: '점수', values: [1, 1, 2, 3], cap: 5, desc: (v) => `${AUG.chainEvery}콤보마다 근처(반경 ${AUG.chainR}) 내 원 ${v}개 자동 획득` },
  { id: 'centerKing', name: '중앙의 왕', cat: '점수', values: [30, 50, 70, 120], cap: 200, desc: (v) => `중앙 구역 원 점수 +${v}%` },
  { id: 'edge', name: '찰나의 순간', cat: '점수', values: [0.5, 1, 1.5, 3], cap: 4, desc: (v) => `가장자리 점수 배율 +${v} (기본 ×3)` },
  // 피버
  { id: 'preheat', name: '예열', cat: '피버', values: [20, 40, 60, 100], cap: 100, desc: (v) => (v >= 100 ? '라운드를 피버 상태로 시작' : `라운드를 피버 게이지 ${v}%로 시작`) },
  { id: 'overtime', name: '연장전', cat: '피버', values: [1, 2, 3, 6], desc: (v) => `피버 시간 +${v}초` },
  { id: 'overcharge', name: '과충전', cat: '피버', values: [15, 30, 45, 90], desc: (v) => `피버 게이지 충전 +${v}%` },
  { id: 'frenzy', name: '폭주', cat: '피버', values: [0.5, 1, 1.5, 3], desc: (v) => `피버 배율 +${v}` },
  { id: 'afterglow', name: '여운', cat: '피버', values: [1, 2, 3, 6], desc: (v) => `피버가 끝난 뒤 ${v}초 동안 점수 ×${AUG.afterglowMult}` },
  { id: 'ignite', name: '점화', cat: '피버', values: [1, 2, 3, 5], cap: 10, desc: (v) => `피버가 터질 때 화면의 내 원 ${v}개 자동 획득` },
  // 보스
  { id: 'hammer', name: '해머', cat: '보스', values: [1, 2, 3, 6], desc: (v) => `보스 타격 +${v}점` },
  { id: 'hunter', name: '사냥꾼', cat: '보스', values: [10, 20, 30, 60], desc: (v) => `보스 막타 +${v}점` },
  { id: 'crusher', name: '파쇄', cat: '보스', values: [0.5, 1, 2, 4], desc: (v) => (v < 1 ? `보스를 때리면 ${Math.round(v * 100)}% 확률로 2타` : `보스를 때리면 ${crushText(v)}`) },
  { id: 'vanguard', name: '선봉', cat: '보스', values: [5, 10, 15, 25], desc: (v) => `보스에게 첫 타를 넣으면 +${v}` },
  // 유지
  { id: 'insurance', name: '보험', cat: '유지', values: [20, 40, 60, 100], cap: 100, desc: (v) => `콤보가 끊겨도 ${v}% 유지` },
  { id: 'shield', name: '방패', cat: '유지', values: [1, 2, 3, 6], desc: (v) => `견제당해도 콤보 유지, 라운드당 ${v}번` },
  { id: 'rebound', name: '리바운드', cat: '유지', values: [30, 50, 70, 120], cap: 200, desc: (v) => `콤보가 끊긴 뒤 ${AUG.reboundMs / 1000}초 동안 점수 +${v}%` },
  { id: 'laserProof', name: '방해 내성', cat: '유지', values: [25, 40, 60, 100], cap: 100, desc: (v) => (v >= 100 ? '레이저·위험 패턴·방해 아이템에 걸리지 않음' : `레이저·위험 패턴 스턴과 방해 아이템 시간 −${v}%`) },
  // 견제
  { id: 'thickSkin', name: '철면피', cat: '견제', values: [1, 2, 3, 99], provisional: true, desc: (v) => (v >= 99 ? '견제해도 표적이 되지 않음' : `표적 시간 −${v}초`) },
  { id: 'plunder', name: '강탈', cat: '견제', values: [1, 1, 2, 4], provisional: true, desc: (v) => `견제하면 상대 점수 ${v}점을 빼앗음` },
  { id: 'counterPro', name: '반격 전문가', cat: '견제', values: [2, 4, 6, 12], provisional: true, desc: (v) => `반격 +${v}점` },
  { id: 'reflect', name: '견제 반사', cat: '견제', values: [1, 2, 3, 6], desc: (v) => `내 색을 견제당하면 내가 잡은 것으로, 견제한 사람은 콤보 끊김·표적 (라운드당 ${v}번)` },
  { id: 'jammer', name: '방해 전파', cat: '견제', values: [500, 1000, 1500, 3000], provisional: true, desc: (v) => `내 피버가 터지면 상대 원이 ${sec(v)} 동안 흐려짐` },
  { id: 'taunt', name: '도발', cat: '견제', values: [5, 10, 15, 25], cap: 50, desc: (v) => `견제하면 상대 피버 게이지 −${v}%` },
  // 보조
  { id: 'wideHand', name: '넓은 손', cat: '보조', values: [15, 25, 35, 70], cap: 80, desc: (v) => `클릭 둘레 ${v} 안의 내 원을 한 번에` },
  { id: 'magnet', name: '자석', cat: '보조', values: [45, 65, 90, 180], cap: 180, desc: (v) => `커서 둘레 ${v} 안의 내 원을 끌어당겨 잡음 (무지개 제외, 점수 ${AUG.magnetPointPct}%만)` },
  { id: 'missSave', name: '헛손질 보정', cat: '보조', values: [40, 60, 80, 120], cap: 160, desc: (v) => `빈 곳을 클릭하면 반경 ${v} 안의 가장 가까운 내 원을 대신 잡음` },
  { id: 'collector', name: '수집가', cat: '보조', values: [20, 40, 60, 100], cap: 200, desc: (v) => `아이템 효과 시간 +${v}%` },
];

/** 봇은 고르지 않는 능력 (봇은 원을 정확히 눌러서 효과가 없음) */
export const ASSIST_ABILITIES: readonly AbilityId[] = ['wideHand', 'magnet', 'missSave'];

/** 레전드 전용 효과 문장 (그 능력을 레전드로 한 번이라도 고르면 붙는다) */
const L_ = LEGEND;
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const LEGEND_TEXT: Partial<Record<AbilityId, string>> = {
  picky: `내 색 원을 잡으면 피버 게이지가 ${L_.pickyFeverMult}배로 참`, yellowTaste: '노란 원도 피버 게이지가 내 색 원만큼 참',
  rainbowHunt: `무지개 원의 피버 게이지 ${L_.rainbowFeverMult}배`, comboArtist: `콤보 보너스 점수 +${L_.comboBonusAdd}`,
  headStart: `라운드 처음 ${sec(L_.headStartMs)} 동안 점수 ×${L_.headStartMult}`, jackpot: `잭팟 배율 ×${L_.jackpotMults[0]}~×${L_.jackpotMults.at(-1)}`,
  edge: `가장자리에서 잡으면 콤보 +${1 + L_.zoneComboAdd}`,
  preheat: `라운드 첫 피버 배율 +${L_.preheatMult}`, overtime: `피버 중 원을 잡을 때마다 피버 시간 +${sec(L_.overtimeMs)}`,
  overcharge: `피버가 끝나도 게이지 ${L_.overchargeKeep}%가 남음`,
  frenzy: `피버 중 콤보 보너스 ${L_.frenzyComboMult}배`, afterglow: `여운 배율 ×${AUG.afterglowMult} → ×${L_.afterglowMult}`,
  hammer: `보스를 때리면 ${pct(L_.hammerChance)} 확률로 ${L_.hammerDmg}타`,
  hunter: '보스 막타 때 화면의 내 원을 전부 잡음', crusher: '방어형 보스의 보호막을 무시', insurance: '콤보가 끊겨도 피버 게이지가 안 깎임',
  shield: `견제당하면 견제한 사람 점수 ${L_.shieldDrain}점을 빼앗음`, thickSkin: '견제해도 피버 게이지가 안 깎임',
  plunder: `1등을 견제하면 빼앗는 점수 ${L_.plunderTopMult}배`,
  counterPro: `반격하면 피버 게이지 +${L_.counterFever}`, reflect: '횟수 제한 없음', jammer: `내 피버가 터지면 상대 커서 ${sec(L_.jammerSlowMs)} 감도 감소`,
  wideHand: `범위로 같이 잡은 원 점수 ×${L_.wideHandMult}`, magnet: `1초에 ${L_.magnetPerSec}개까지 끌어옴`, missSave: `대신 잡은 원 점수 ×${L_.missSaveMult}`,
  rebound: `끊긴 콤보의 절반을 그 ${sec(AUG.reboundMs)} 안에 되찾음`, rapid: `연속 ${L_.rapidStreak}개면 다음 원 잭팟 확정`,
  laserProof: `레이저·위험 패턴에 닿으면 피버 게이지 +${L_.laserFever}`,
  collector: `아이템 원을 잡으면 ${pct(L_.collectorUp)} 확률로 한 등급 위`, chainCombo: `${L_.chainEvery}콤보마다`,
  centerKing: `중앙에서 잡으면 콤보 +${1 + L_.zoneComboAdd}`,
  ignite: '화면의 내 원 전부', vanguard: `보스 등장 후 ${sec(AUG.vanguardMs)} 동안 주는 피해 ${L_.vanguardMult}배`,
  taunt: `피버 중인 상대를 견제하면 그 피버가 ${sec(L_.tauntMs)} 짧아짐`,
};

export type ComboId = 'feverMaster' | 'comboMachine' | 'bossHunter' | 'stealKing' | 'lucky' | 'outskirts' | 'gourmet' | 'ironWall';
/** 증강 조합: 필요한 증강을 모두 가지면(등급 무관) 보너스. 같은 조합은 한 번 */
export const COMBOS: readonly { id: ComboId; name: string; needs: readonly AbilityId[]; text: string }[] = [
  { id: 'feverMaster', name: '피버 마스터', needs: ['preheat', 'overtime', 'frenzy'], text: `피버 배율 +${COMBO.feverAdd}` },
  { id: 'comboMachine', name: '콤보 머신', needs: ['comboArtist', 'insurance'], text: `콤보 보너스 ×${COMBO.comboBonusMult}` },
  { id: 'bossHunter', name: '보스 헌터', needs: ['hammer', 'hunter', 'crusher'], text: `보스 피해 +${COMBO.bossDmgAdd}, 타격 점수 ×${COMBO.bossHitMult}, 막타 점수 ×${COMBO.bossKillMult}` },
  { id: 'stealKing', name: '견제왕', needs: ['plunder', 'counterPro', 'thickSkin'], text: `견제·반격 점수 ×${COMBO.stealMult}, 표적 시간 −${COMBO.stealMarkCutMs / 1000}초` },
  { id: 'lucky', name: '행운아', needs: ['jackpot', 'rainbowHunt'], text: `잭팟 확률 +${COMBO.jackpotAdd}%` },
  { id: 'outskirts', name: '변두리', needs: ['edge', 'magnet'], text: `커서가 가장자리 구역이면 자석 범위 ×${COMBO.outskirtsMult}` },
  { id: 'gourmet', name: '미식가', needs: ['picky', 'yellowTaste'], text: '노란 원도 내 색 원처럼 (점수·피버 게이지)' },
  { id: 'ironWall', name: '철옹성', needs: ['shield', 'insurance', 'rebound'], text: `콤보가 끊기지 않고 ${100 - COMBO.ironKeepPct}%만 줄어듦` },
];

/** 완성한 조합 */
export function combosOf(picks: readonly Pick[] | undefined): Set<ComboId> {
  const have = new Set((picks ?? []).map((p) => p.id));
  return new Set(COMBOS.filter((c) => c.needs.every((n) => have.has(n))).map((c) => c.id));
}

/** 조합 진행도: 하나 이상 가진 조합만. 완성한 조합이 먼저, 그다음 많이 모은 순 (같으면 COMBOS 순서) */
export function comboProgress(picks: readonly Pick[] | undefined) {
  const have = new Set((picks ?? []).map((p) => p.id));
  const rate = (c: { have: number; need: number }) => (c.have >= c.need ? 2 : c.have / c.need);
  return COMBOS.map((c) => ({ id: c.id, name: c.name, text: c.text, have: c.needs.filter((n) => have.has(n)).length, need: c.needs.length }))
    .filter((c) => c.have > 0)
    .sort((a, b) => rate(b) - rate(a));
}

/** 이 카드를 고르면 새로 완성되는 조합 */
export function combosCompletedBy(picks: readonly Pick[] | undefined, card: Pick) {
  const before = combosOf(picks), after = combosOf([...(picks ?? []), card]);
  return COMBOS.filter((c) => after.has(c.id) && !before.has(c.id));
}

/** 빌드 가중치: 같은 분류 ×2, 가진 조합(미완성)의 나머지 ×3 */
export function buildWeight(id: AbilityId, owned: readonly Pick[] | undefined) {
  if (!owned?.length) return 1;
  const have = new Set(owned.map((p) => p.id));
  const cats = new Set(owned.map((p) => ABILITY[p.id]?.cat));
  let w = cats.has(ABILITY[id].cat) ? WEIGHT.sameCat : 1;
  if (COMBOS.some((c) => !c.needs.every((n) => have.has(n)) && c.needs.some((n) => have.has(n)) && c.needs.includes(id) && !have.has(id))) w *= WEIGHT.comboPart;
  return w;
}

/** 레전드로 한 번이라도 고른 능력 */
export function legendOf(picks: readonly Pick[] | undefined): Set<AbilityId> {
  return new Set((picks ?? []).filter((p) => p.tier === 3 && !ABILITY[p.id]?.curse && !ABILITY[p.id]?.special).map((p) => p.id));
}
export const hasLegend = (p: { picks: readonly Pick[] }, id: AbilityId) => p.picks.some((x) => x.id === id && x.tier === 3);

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

const S = SPECIAL;
/** 특별 카드 12장: 역전 기회인 꼴찌의 3번째 선택에 1장 섞인다. 남의 점수를 깎지 않는다 */
export const SPECIALS: readonly AbilityDef[] = ([
  ['comebackBoost', '대역전', `내 모든 점수 ×${S.boost}`],
  ['flip', '판 뒤집기', `라운드가 끝날 때 1등과의 점수 차의 ${S.flipPct}%를 내 점수에 더함`],
  ['focusFire', '집중 포화', `라운드를 피버로 시작, 피버 배율 +${S.focusMult}`],
  ['hyena', '하이에나', `1등이 원을 잡아 점수를 얻을 때마다 ${Math.round(S.hyenaChance * 100)}% 확률로 내 점수 +${S.hyenaGain}`],
  ['chaser', '추격자', `모든 구역 점수 배율 +${S.chaserAdd}`],
  ['momentum', '기세', `콤보가 끊기지 않고, 콤보 보너스가 ${S.momentumEvery}콤보마다`],
  ['allHands', '만능 손', '남의 색 원도 내 색 원처럼 점수, 견제 페널티·표적 없음'],
  ['fortress', '철벽', '견제(콤보 끊김·강탈·흡혈)·레이저·위험 패턴·방해 아이템에 걸리지 않음'],
  ['chainBlast', '연쇄 폭발', `원을 잡으면 ${Math.round(S.chainChance * 100)}% 확률로 반지름 ${S.chainR} 안의 내 원도 함께`],
  ['bossFeast', '막타 독식', `보스에게 주는 피해 ${S.feastMult}배, 막타 점수 ${S.feastMult}배`],
  ['lastFlame', '마지막 불꽃', `라운드 마지막 ${sec(S.flameMs)} 동안 점수 ×${S.flameMult}`],
  ['itemHunter', '아이템 사냥꾼', `아이템 원을 잡으면 한 등급 위 아이템, 효과 시간 ${S.hunterDur}배`],
] as const).map(([id, name, text]) => ({
  id, name, cat: '특별' as const, values: [1, 1, 1, 1] as const, cap: 1, special: true as const, desc: () => text,
}));

export const ALL_ABILITIES: readonly AbilityDef[] = [...ABILITIES, ...CURSES, ...SPECIALS];
export const isCurse = (id: AbilityId) => !!ABILITY[id]?.curse;
export const isSpecial = (id: AbilityId) => !!ABILITY[id]?.special;

/**
 * 역전 기회 판정: 1등 점수가 0보다 크고, 꼴찌(최저 점수, 모두 동점이면 없음) 점수가 1등 × ratio 미만이면 그 꼴찌들
 */
export function judgeComeback(players: readonly { id: string; score: number }[]): Set<string> {
  const out = new Set<string>();
  if (!players.length) return out;
  const scores = players.map((p) => p.score);
  const top = Math.max(...scores), min = Math.min(...scores);
  if (top <= 0 || min === top || min >= top * ARCADE.comeback.ratio) return out;
  for (const p of players) if (p.score === min) out.add(p.id);
  return out;
}

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

/** 같은 능력을 하나로 묶는다: 처음 고른 순서대로, 그중 가장 높은 등급, 고른 횟수 */
export function groupPicks(picks: readonly Pick[]): { id: AbilityId; tier: Tier; count: number }[] {
  const out = new Map<AbilityId, { id: AbilityId; tier: Tier; count: number }>();
  for (const p of picks) {
    const g = out.get(p.id);
    if (g) { g.count++; if (p.tier > g.tier) g.tier = p.tier; } else out.set(p.id, { id: p.id, tier: p.tier, count: 1 });
  }
  return [...out.values()];
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
export function jackpotMult(m: Mods, rand = Math.random, legend = false) {
  if (!(rand() < m.jackpot / 100)) return 1;
  // 잭팟 레전드: 배율 ×2~×5 (확률은 그대로)
  const mults = legend ? LEGEND.jackpotMults : JACKPOT.mults;
  let r = rand() * 100;
  for (let i = 0; i < mults.length; i++) { r -= JACKPOT.odds[i]; if (r < 0) return mults[i]; }
  return mults[mults.length - 1];
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
  /** 이 방 규칙에서 의미 없는 능력 */
  exclude?: readonly AbilityId[];
  /** 이 등급 미만은 나오지 않음 (노말 제외) */
  minTier?: Tier;
  /** 이 등급 이상 카드가 1장 이상 (없으면 무작위 1장을 그 등급으로) */
  guarantee?: Tier;
  /** 역전 기회: 1장을 무작위 특별 카드로 (저주와 다른 자리) */
  special?: boolean;
  /** 지금 가진 능력 (빌드 가중치) */
  owned?: readonly Pick[];
}

export function rollOptions(pickIndex: number, lastPlace: boolean, rand = Math.random, opts: RollOpts = {}, count: number = ARCADE.optionCount): Pick[] {
  const i = Math.min(pickIndex, TIER_ODDS.length - 1);
  const base = lastPlace ? (i + 1 < TIER_ODDS.length ? TIER_ODDS[i + 1] : LAST_PLACE_FINAL_ODDS) : TIER_ODDS[i];
  // 노말 제외: 낮은 등급 확률을 0으로 (모두 0이 되면 가장 높은 등급만)
  const min = opts.minTier ?? 0;
  let odds: readonly number[] = base.map((w, t) => (t < min ? 0 : w));
  if (odds.every((w) => w === 0)) odds = base.map((_, t) => (t === base.length - 1 ? 1 : 0));
  const pool = ABILITIES.filter((a) => !opts.exclude?.includes(a.id));
  const out: Pick[] = [];
  // 빌드 가중치에 비례해 하나씩 뽑고 풀에서 뺀다 (중복 없음)
  const weights = pool.map((a) => buildWeight(a.id, opts.owned));
  while (out.length < count && pool.length) {
    let r = rand() * weights.reduce((x, y) => x + y, 0), k = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { r -= weights[j]; if (r < 0) { k = j; break; } }
    const a = pool.splice(k, 1)[0];
    weights.splice(k, 1);
    out.push({ id: a.id, tier: opts.allLegend ? 3 : rollTier(odds, rand) });
  }
  let curseAt = -1;
  // 저주 카드: 선택지 하나를 바꿔 끼운다
  const chance = opts.forceCurse ? 1 : lastPlace ? ARCADE.curseChanceLastPlace : ARCADE.curseChance;
  if (!opts.allLegend && (opts.curses ?? 0) < ARCADE.maxCurses && rand() < chance) {
    // 악마의 계약은 마지막 선택에서는 대가만 남아서 제외
    const curses = CURSES.filter((c) => !(c.id === 'devilPact' && pickIndex >= ARCADE.rounds - 2));
    const c = curses[Math.floor(rand() * curses.length)];
    curseAt = Math.floor(rand() * out.length);
    out[curseAt] = { id: c.id, tier: 0 };
  }
  // 특별 카드: 저주가 아닌 자리 하나를 바꾼다
  if (opts.special && out.length) {
    const spots = out.map((_, k) => k).filter((k) => k !== curseAt);
    const s = SPECIALS[Math.floor(rand() * SPECIALS.length)];
    if (spots.length) out[spots[Math.floor(rand() * spots.length)]] = { id: s.id, tier: 0 };
  }
  // 꼴찌 등급 보장: 저주·특별 카드를 끼운 뒤, 남은 일반 카드 중에서
  const g = opts.guarantee;
  const plain = out.filter((o) => !isCurse(o.id) && !isSpecial(o.id));
  if (g !== undefined && plain.length && !plain.some((o) => o.tier >= g)) plain[Math.floor(rand() * plain.length)].tier = g;
  return out;
}

/** 라운드가 끝날 때 적용되는 저주·특별 카드 결과 */
/** 'tax': 랜덤 이벤트 세금을 받은 사람 */
export interface RoundEffect { playerId: string; id: CurseId | 'flip' | 'tax'; delta: number }
