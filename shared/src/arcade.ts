/**
 * 아케이드 모드: 라운드 사이에 고르는 능력(증강).
 * 능력은 등급과 따로 정해져 있고, 어느 등급으로 뜨느냐에 따라 수치만 달라진다.
 * 같은 능력을 다시 고르면 수치가 합쳐진다(중첩).
 * 밸런스는 이 파일의 ABILITIES 수치와 TIER_ODDS만 고치면 된다.
 */

import { RULES } from './rules.ts';

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
  wideHandMult: 1.5, magnetPerSec: 2, missSaveMult: 1.5, rapidStreak: 5, laserFever: 20,
  tauntMs: 1_000, zoneComboAdd: 1, preciseComboAdd: 1, treasureTierOdds: [50, 45, 5], itemLoverExtra: 2, counterFever: 20,
  pickyFeverMult: 2, frenzyComboMult: 2, vanguardMult: 2, rainbowFeverMult: 2,
  autoCharge: 30, luckHighMult: 2, crownSoloStacks: 2,
} as const;

/**
 * 성장 증강 수치. 스택형: 한 칸 효과 (drillEvery콤보마다 단련 한 칸). 자동 시전형: 효과 시간·양
 * (발동 간격은 60초 ÷ 등급 수치)
 */
export const GROWTH = { drillEvery: 10, drillPts: 1, crown: { assistPct: 25, feverPerStack: 0.6, atThree: 1, atFive: 2 }, luckPct: 1, magneticField: { clicks: 5, radius: 140 }, autoCharge: 20, autoChargeOverflow: 0.5, guardScorePct: 50, guardScoreCap: 100 } as const;

/** 증강 조합 보너스 수치 */
export const COMBO = {
  feverAdd: 1, bossDmgAdd: 1, bossHitMult: 1.5, bossKillMult: 2, stealMult: 3, stealMarkCutMs: 1_000,
  jackpotAdd: 10, outskirtsMult: 1.5, ironKeepPct: 80, bossSoloFever: 25, bazaarDur: 1.5, bazaarFever: 25, shieldBashPoints: 40,
} as const;
/** 빌드 가중치: 가진 증강과 같은 분류 ×sameCat, 가진 조합의 나머지 ×comboPart (곱함) */
export const WEIGHT = { sameCat: 2, comboPart: 3 } as const;

/** 새 증강 수치 */
/**
 * magnetPointPct: 자석으로 끌어온 원 점수(%, 콤보·콤보 보너스·잭팟·피버 게이지 없음).
 * plunderMax: 강탈 한 번에 빼앗는 최대 점수. headStartMult: 출발 신호 배율
 */
export const AUG = { reboundMs: 3_000, rapidMs: 400, preciseR: 0.4, treasureFloor: 6, treasureRate: 1000, vanguardMs: 3_000, afterglowMult: 1.5, magnetPointPct: 70, plunderMax: 30, headStartMult: 1.3 } as const;

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
  /** 빼앗는 양: 점수를 잃는 쪽 총점의 drainPct% (최소 drainMin, 최대 drainMax) */
  vampire: { drainPct: 2, drainMin: 10, drainMax: 150 },
  timeBomb: { bonus: 40, comboGoal: 10, penalty: 60 },
  selfTarget: { boostPct: 30 },
  devilPact: { keepPct: 50 },
} as const;

/** 능력 선택 차례(0 = 1라운드 뒤)별 등급 확률(%) [노말, 레어, 에픽, 레전드] */
export const TIER_ODDS: readonly (readonly [number, number, number, number])[] = [
  [70, 25, 5, 0],
  [55, 32, 12, 1],
  [40, 27, 30, 3],
  [25, 22, 48, 5],
];
/** 꼴찌는 한 단계 다음 차례의 확률을 쓰고, 마지막 차례에서는 이 확률을 쓴다 */
export const LAST_PLACE_FINAL_ODDS = [15, 20, 50, 15] as const;

export type AbilityId =
  | 'picky' | 'yellowTaste' | 'rainbowHunt' | 'comboArtist' | 'headStart'
  | 'preheat' | 'overtime' | 'overcharge' | 'frenzy' | 'afterglow'
  | 'hammer' | 'hunter' | 'crusher'
  | 'insurance' | 'shield'
  | 'thickSkin' | 'plunder' | 'counterPro'
  | 'precise' | 'treasure' | 'itemLover' | 'firstFlame' | 'finisher' | 'spacing' | 'riposte' | 'regularCustomer' | UniqueId
  | 'jackpot' | 'wideHand' | 'magnet' | 'autoMagnet' | 'reflect' | 'edge'
  | 'missSave' | 'rebound' | 'rapid' | 'laserProof' | 'centerKing' | 'ignite' | 'vanguard' | 'taunt'
  | StackId | AutoId
  | CurseId | SpecialId;

export type SpecialId =
  | 'comebackBoost' | 'flip' | 'focusFire' | 'hyena' | 'chaser' | 'momentum'
  | 'allHands' | 'fortress' | 'chainBlast' | 'bossFeast' | 'lastFlame' | 'itemHunter';

/** 스택형 증강 (조건마다 한 칸, 게임 끝까지) */
export type StackId = 'drill' | 'crownMark' | 'luckStack';
/** 자동 시전형 증강 (1분에 등급 수치만큼 저절로) */
export type AutoId = 'autoCharge' | 'autoGuard';
export const STACK_IDS: readonly StackId[] = ['drill', 'crownMark', 'luckStack'];
export const AUTO_IDS: readonly AutoId[] = ['autoCharge', 'autoGuard'];

export type CurseId = 'glassCannon' | 'gambler' | 'berserker' | 'oneWay' | 'vampire' | 'timeBomb' | 'selfTarget' | 'devilPact';

export type AbilityCategory = '점수' | '피버' | '보스' | '유지' | '견제' | '보조' | '성장' | '저주' | '특별' | '유니크';

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
  unique?: true;
  solo?: true;
  aim?: AbilityCategory;
}

const sec = (ms: number) => `${+(ms / 1000).toFixed(1)}초`;

export const treasureEvery = (rate: number) => Math.max(AUG.treasureFloor, Math.round(AUG.treasureRate / rate));

export const SOLO_SYNERGY = { scorePct: 15, finisherHpPct: 20, riposteMs: 3_000 } as const;

export const ABILITIES: readonly AbilityDef[] = [
  // 점수
  { id: 'precise', name: '정밀 사격', cat: '점수', values: [0.3, 0.5, 0.8, 1.5], cap: 2, desc: (v) => `원 가운데(반지름 ${pct(AUG.preciseR)} 안)를 직접 누르면 점수 ×${+(1 + v).toFixed(2)}` },
  { id: 'picky', name: '편식가', cat: '점수', values: [1, 2, 3, 6], desc: (v) => `내 색 +${v}점, 대신 노란색 −1점` },
  { id: 'yellowTaste', name: '노란 맛', cat: '점수', values: [1, 2, 3, 6], desc: (v) => `노란색 +${v}점` },
  { id: 'rainbowHunt', name: '무지개 사냥', cat: '점수', values: [3, 6, 9, 18], desc: (v) => `무지개 +${v}점` },
  { id: 'comboArtist', name: '콤보 장인', cat: '점수', values: [1, 2, 3, 6], cap: 7, desc: (v) => `콤보 보너스가 ${comboPeriod(v)}콤보마다` },
  { id: 'headStart', name: '출발 신호', cat: '점수', values: [5, 8, 10, 15], cap: 20, desc: (v) => `라운드 처음 ${v}초 동안 점수 ×${AUG.headStartMult}` },
  { id: 'jackpot', name: '잭팟', cat: '점수', values: [5, 10, 15, 30], cap: 35, desc: (v) => `원을 잡을 때 ${v}% 확률로 잭팟 (×1.5~×3)` },
  { id: 'rapid', name: '속사', cat: '점수', values: [1, 2, 3, 6], cap: 12, desc: (v) => `${AUG.rapidMs / 1000}초 안에 연달아 잡으면 두 번째부터 +${v}점` },

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
  { id: 'vanguard', name: '선봉', cat: '보스', values: [2, 3, 4, 6], desc: (v) => `보스마다 내 첫 타 점수 ×${v}` },
  // 유지
  { id: 'insurance', name: '보험', cat: '유지', values: [20, 40, 60, 100], cap: 100, desc: (v) => `콤보가 끊겨도 ${v}% 유지` },
  { id: 'shield', name: '방패', cat: '유지', values: [1, 2, 3, 6], desc: (v) => `콤보가 끊길 때 통째로 막음, 라운드당 ${v}번` },
  { id: 'rebound', name: '리바운드', cat: '유지', values: [30, 50, 70, 120], cap: 200, desc: (v) => `콤보가 끊긴 뒤 ${AUG.reboundMs / 1000}초 동안 점수 +${v}%` },
  { id: 'laserProof', name: '방해 내성', cat: '유지', values: [25, 40, 60, 100], cap: 100, desc: (v) => (v >= 100 ? '레이저·위험 패턴·방해 아이템에 걸리지 않음' : `레이저·위험 패턴 스턴과 방해 아이템 시간 −${v}%`) },
  // 견제
  { id: 'thickSkin', name: '철면피', cat: '견제', values: [1, 2, 3, 99], provisional: true, desc: (v) => (v >= 99 ? '견제해도 표적이 되지 않음' : `표적 시간 −${v}초`) },
  { id: 'plunder', name: '강탈', cat: '견제', values: [1, 2, 3, 5], provisional: true, desc: (v) => `견제하면 상대의 이번 라운드 점수 ${v}%를 빼앗음 (최대 ${AUG.plunderMax}점)` },
  { id: 'counterPro', name: '반격 전문가', cat: '견제', values: [2, 4, 6, 12], provisional: true, desc: (v) => `반격 +${v}점` },
  { id: 'reflect', name: '견제 반사', cat: '견제', values: [1, 2, 3, 6], desc: (v) => `내 색을 견제당하면 내가 잡은 것으로, 견제한 사람은 콤보 끊김·표적 (라운드당 ${v}번)` },

  { id: 'taunt', name: '도발', cat: '견제', values: [5, 10, 15, 25], cap: 50, desc: (v) => `견제하면 상대 피버 게이지 ${v}%를 빼앗아 내 게이지에` },
  // 보조
  { id: 'treasure', name: '보물 상자', cat: '보조', values: [50, 67, 83, 125], cap: 167, desc: (v) => `${treasureEvery(v)}콤보마다 무작위 아이템이 바로 발동 (아이템으로 잡은 원 제외)` },
  { id: 'itemLover', name: '아이템 애호가', cat: '보조', values: [40, 60, 80, 100], cap: 100, desc: (v) => `라운드 시작 후 ${RULES.itemLoverDelayMs / 1000}초에 무작위 아이템 1개 발동. 아이템이 발동하면 ${v}% 확률로 새 아이템이 한 번 더` },
  { id: 'wideHand', name: '넓은 손', cat: '보조', values: [15, 25, 35, 70], cap: 80, desc: (v) => `클릭 둘레 ${v} 안의 내 원을 한 번에` },
  { id: 'magnet', name: '자석', cat: '보조', values: [45, 65, 90, 180], cap: 180, desc: (v) => `커서 둘레 ${v} 안의 내 원을 끌어당겨 잡음 (무지개 제외, 점수 ${AUG.magnetPointPct}%만)` },
  { id: 'missSave', name: '헛손질 보정', cat: '보조', values: [40, 60, 80, 120], cap: 160, desc: (v) => `빈 곳을 클릭하면 반경 ${v} 안의 가장 가까운 내 원을 대신 잡음` },

  { id: 'autoMagnet', name: '자기장', cat: '보조', values: [1, 2, 3, 4], cap: 4, desc: (v) => `내 색 원 ${GROWTH.magneticField.clicks}개를 직접 잡으면 충전. 다음 내 색 클릭에서 반경 ${GROWTH.magneticField.radius} 안 내 색 원 최대 ${v}개를 끌어와 점수 100% 획득 (콤보·피버 충전 없음). 주변에 내 색 원이 없으면 충전 유지` },
  { id: 'autoCharge', name: '충전기', cat: '보조', values: [6, 7.5, 10, 15], cap: 20, desc: (v) => `${+(60 / v).toFixed(1)}초마다 저절로 피버 게이지 +${GROWTH.autoCharge}. 이 충전으로 피버가 시작되면 100 초과분의 ${pct(GROWTH.autoChargeOverflow)}를 피버 종료 후 이월` },
  { id: 'autoGuard', name: '보호막 발생기', cat: '보조', values: [6, 7.5, 10, 15], cap: 15, desc: (v) => `시작 시 및 ${+(60 / v).toFixed(1)}초마다 보호막과 득점 충전 각 1회. 보호막은 견제의 콤보 끊김·강탈·도발을 막고, 득점 충전은 다음 내 색 직접 클릭에 +${GROWTH.guardScorePct}% (최대 +${GROWTH.guardScoreCap}점)` },
  { id: 'firstFlame', name: '첫 불꽃', cat: '피버', solo: true, values: [8, 12, 16, 24], desc: (v) => `피버 중 첫 내 색 직접 클릭에 고정 +${v}점` },
  { id: 'finisher', name: '결정타', cat: '보스', solo: true, values: [12, 18, 25, 36], desc: (v) => `체력 ${SOLO_SYNERGY.finisherHpPct}% 이하인 보스를 때리면 고정 +${v}점 (보스당 1회)` },
  { id: 'spacing', name: '거리 조절', cat: '점수', solo: true, values: [2, 3, 4, 6], desc: (v) => `내 색 원을 연속으로 직접 잡을 때 직전과 다른 점수 구역이면 고정 +${v}점` },
  { id: 'riposte', name: '응수', cat: '견제', solo: true, values: [8, 12, 18, 26], desc: (v) => `반격 성공 후 ${sec(SOLO_SYNERGY.riposteMs)} 안에 다음 내 색 직접 클릭에 고정 +${v}점 (1회)` },
  { id: 'regularCustomer', name: '단골손님', cat: '보조', solo: true, values: [5, 8, 12, 18], desc: (v) => `아이템 발동 묶음이 끝나면 다음 내 색 직접 클릭에 고정 +${v}점 (최대 1회 보관)` },
  // 성장: 조건을 채울 때마다 한 칸씩 쌓여 게임 끝까지 (수치 = 최대 칸)
  { id: 'drill', name: '단련', cat: '성장', values: [2, 3, 5, 8], cap: 12, desc: (v) => `${GROWTH.drillEvery}콤보마다 내 색 +${GROWTH.drillPts}점이 쌓임 (최대 ${v}칸)` },
  { id: 'crownMark', name: '왕의 증표', cat: '성장', values: [2, 3, 4, 5], cap: 5, desc: (v) => `보스 체력 ${GROWTH.crown.assistPct}% 이상 피해 또는 막타 시 1칸 (최대 ${v}칸). 피버 배율은 칸당 +${GROWTH.crown.feverPerStack}, 3칸에서 +${GROWTH.crown.atThree}, 5칸에서 추가 +${GROWTH.crown.atFive}` },
  { id: 'luckStack', name: '행운 축적', cat: '성장', values: [3, 5, 7, 10], cap: 15, desc: (v) => `잭팟이 터지거나 황금 원·무지개 원을 잡을 때마다 잭팟 확률 +${GROWTH.luckPct}%가 쌓임 (최대 ${v}칸)` },
];

/** 봇은 고르지 않는 능력 (봇은 원을 정확히 눌러서 효과가 없음) */
export const ASSIST_ABILITIES: readonly AbilityId[] = ['wideHand', 'magnet', 'missSave', 'autoMagnet', 'precise'];

/** 레전드 전용 효과 문장 (그 능력을 레전드로 한 번이라도 고르면 붙는다) */
const L_ = LEGEND;
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const LEGEND_TEXT: Partial<Record<AbilityId, string>> = {
  precise: `정밀하게 맞히면 콤보 +${1 + L_.preciseComboAdd}`, treasure: `상자 아이템 확률 흔함 ${L_.treasureTierOdds[0]}%, 희귀 ${L_.treasureTierOdds[1]}%, 전설 ${L_.treasureTierOdds[2]}%`,
  itemLover: `추가 발동에 성공하면 한 번 더 (최대 ${1 + L_.itemLoverExtra}개)`,
  picky: `내 색 원을 잡으면 피버 게이지가 ${L_.pickyFeverMult}배로 참`, yellowTaste: '노란 원도 피버 게이지가 내 색 원만큼 참',
  rainbowHunt: `무지개 원의 피버 게이지 ${L_.rainbowFeverMult}배`, comboArtist: `콤보 보너스 점수 +${L_.comboBonusAdd}`,
  headStart: `배율 ×${AUG.headStartMult} → ×${L_.headStartMult}, 최소 ${sec(L_.headStartMs)}`, jackpot: `잭팟 배율 ×${L_.jackpotMults[0]}~×${L_.jackpotMults.at(-1)}`,
  edge: `가장자리에서 잡으면 콤보 +${1 + L_.zoneComboAdd}`,
  preheat: `라운드 첫 피버 배율 +${L_.preheatMult}`, overtime: `피버 중 원을 잡을 때마다 피버 시간 +${sec(L_.overtimeMs)}`,
  overcharge: `피버가 끝나도 게이지 ${L_.overchargeKeep}%가 남음`,
  frenzy: `피버 중 콤보 보너스 ${L_.frenzyComboMult}배`, afterglow: `여운 배율 ×${AUG.afterglowMult} → ×${L_.afterglowMult}`,
  hammer: `보스를 때리면 ${pct(L_.hammerChance)} 확률로 ${L_.hammerDmg}타`,
  hunter: '보스 막타 때 화면의 내 원을 전부 잡음', crusher: '방어형 보스의 보호막을 무시', insurance: '콤보가 끊겨도 피버 게이지가 안 깎임',
  shield: `견제당하면 견제한 사람 점수 ${L_.shieldDrain}점을 빼앗음`, thickSkin: '견제해도 피버 게이지가 안 깎임',
  plunder: `1등을 견제하면 빼앗는 점수 ${L_.plunderTopMult}배`,
  counterPro: `반격하면 피버 게이지 +${L_.counterFever}`, reflect: '횟수 제한 없음',
  wideHand: `범위로 같이 잡은 원 점수 ×${L_.wideHandMult}`, magnet: `1초에 ${L_.magnetPerSec}개까지 끌어옴`, missSave: `대신 잡은 원 점수 ×${L_.missSaveMult}`,
  rebound: `끊긴 콤보의 절반을 그 ${sec(AUG.reboundMs)} 안에 되찾음`, rapid: `연속 ${L_.rapidStreak}개면 다음 원 잭팟 확정`,
  laserProof: `레이저·위험 패턴에 닿으면 피버 게이지 +${L_.laserFever}`,
  centerKing: `중앙에서 잡으면 콤보 +${1 + L_.zoneComboAdd}`,
  drill: '한 칸 쌓일 때 콤보 보너스도 받음', crownMark: `보스 체력 절반 이상을 깎으면 ${L_.crownSoloStacks}칸 획득`, luckStack: `잭팟 배율 ×3 이상 확률 ${L_.luckHighMult}배`,
  autoCharge: `피버 게이지 +${GROWTH.autoCharge} → +${L_.autoCharge}`,
  ignite: '화면의 내 원 전부', vanguard: `보스 등장 후 ${sec(AUG.vanguardMs)} 동안 주는 피해 ${L_.vanguardMult}배`,
  taunt: `피버 중인 상대를 견제하면 그 피버가 ${sec(L_.tauntMs)} 짧아짐`,
};

export type ComboId = 'feverMaster' | 'comboMachine' | 'bossHunter' | 'stealKing' | 'lucky' | 'outskirts' | 'gourmet' | 'ironWall' | 'bazaar' | 'counterStance' | 'shieldBash'
  | 'gambit' | 'encore' | 'marksman' | 'raidParty' | 'allHandsCombo' | 'riposteCombo';
/** 증강 조합: 필요한 증강을 모두 가지면(등급 무관) 보너스. 같은 조합은 한 번 */
export const COMBOS: readonly { id: ComboId; name: string; needs: readonly AbilityId[]; text: string }[] = [
  { id: 'feverMaster', name: '피버 마스터', needs: ['preheat', 'overtime', 'frenzy'], text: `피버 배율 +${COMBO.feverAdd}` },
  { id: 'comboMachine', name: '콤보 머신', needs: ['comboArtist', 'insurance'], get text() { return `콤보 보너스 ×${RULES.comboMachineMult}`; } },
  { id: 'bossHunter', name: '보스 헌터', needs: ['hammer', 'hunter', 'crusher'], text: `보스 피해 +${COMBO.bossDmgAdd}, 타격 점수 ×${COMBO.bossHitMult}, 막타 점수 ×${COMBO.bossKillMult}, 붉은 공격형도 감점 없이 때림, 독식하면 피버 게이지 +${COMBO.bossSoloFever}` },
  { id: 'stealKing', name: '견제왕', needs: ['plunder', 'counterPro', 'thickSkin'], text: `견제·반격 점수 ×${COMBO.stealMult}, 표적 시간 −${COMBO.stealMarkCutMs / 1000}초` },
  { id: 'lucky', name: '행운아', needs: ['jackpot', 'rainbowHunt'], text: `잭팟 확률 +${COMBO.jackpotAdd}%` },
  { id: 'outskirts', name: '변두리', needs: ['edge', 'magnet'], text: `커서가 가장자리 구역이면 자석 범위 ×${COMBO.outskirtsMult}` },
  { id: 'gourmet', name: '미식가', needs: ['picky', 'yellowTaste'], text: '노란 원도 내 색 원처럼 (점수·피버 게이지)' },
  { id: 'bazaar', name: '잡화점', needs: ['treasure', 'itemLover'], text: `아이템 효과 시간 ×${COMBO.bazaarDur}, 아이템 원을 잡거나 보물 상자를 열면 피버 게이지 +${COMBO.bazaarFever}` },
  { id: 'shieldBash', name: '보호막 강타', needs: ['autoGuard', 'shield'], text: `반격에 성공하면 보호막 발생기의 충전 1회를 써서 +${COMBO.shieldBashPoints}점. 추가 점수에는 피버 배율만 적용` },
  { id: 'counterStance', name: '반격 태세', needs: ['autoGuard', 'counterPro'], text: '보호막 발생기로 견제를 막으면 반격권 1회. 표적이 아닌 상대 색 원을 직접 누르면 반격권을 써서 반격' },
  { id: 'ironWall', name: '철옹성', needs: ['shield', 'insurance', 'rebound'], text: `콤보가 끊기지 않고 ${100 - COMBO.ironKeepPct}%만 줄어듦` },
  { id: 'gambit', name: '타짜', needs: ['jackpot', 'luckStack', 'rapid'], get text() { return `잭팟이 터지면 피버 게이지 +${RULES.combos.gambitFever}, 다음 원 1개는 속사 허용 시간 ${RULES.combos.gambitRapidMs / 1000}초`; } },
  { id: 'encore', name: '앙코르', needs: ['overcharge', 'afterglow', 'ignite'], get text() { return `피버가 끝날 때 피버 게이지 +${RULES.combos.encoreFever}`; } },
  { id: 'marksman', name: '명사수', needs: ['precise', 'centerKing', 'headStart'], get text() { return `직접 클릭한 원 점수 +${RULES.combos.marksmanPct}%, 정밀 사격 판정이면 콤보 +1`; } },
  { id: 'raidParty', name: '토벌대', needs: ['vanguard', 'crownMark', 'hunter'], get text() { return `보스가 나오면 피버 게이지 +${RULES.combos.raidFever}, 왕의 증표 기여도 계산에서 내 보스 피해 ×${RULES.combos.raidCrownMult}`; } },
  { id: 'allHandsCombo', name: '만능 손', needs: ['wideHand', 'missSave', 'autoMagnet'], get text() { return `자기장으로 끌어온 원도 콤보·피버 게이지를 채움, 넓은 손·헛손질 보정으로 잡은 원 +${RULES.combos.allHandsPts}점`; } },
  { id: 'riposteCombo', name: '역습', needs: ['laserProof', 'reflect', 'taunt'], get text() { return `견제당할 때마다 피버 게이지 +${RULES.combos.riposteFever} (반격·폭죽·막힌 견제 제외)`; } },
];

/** 완성한 조합 */
export function combosOf(picks: readonly Pick[] | undefined): Set<ComboId> {
  const have = new Set((picks ?? []).map((p) => p.id));
  return new Set(COMBOS.filter((c) => comboHave(c, have) >= comboNeed(c, have)).map((c) => c.id));
}

/** 연결: 필요 증강이 3장인 조합은 2장으로 완성 */
export const comboNeed = (c: { needs: readonly AbilityId[] }, have: ReadonlySet<AbilityId>) =>
  have.has('synergyLink') && c.needs.length === 3 ? 2 : c.needs.length;
const comboHave = (c: { needs: readonly AbilityId[] }, have: ReadonlySet<AbilityId>) => c.needs.filter((n) => have.has(n)).length;

/** 조합 진행도: 하나 이상 가진 조합만. 완성한 조합이 먼저, 그다음 많이 모은 순 (같으면 COMBOS 순서) */
export function comboProgress(picks: readonly Pick[] | undefined) {
  const have = new Set((picks ?? []).map((p) => p.id));
  const rate = (c: { have: number; need: number }) => (c.have >= c.need ? 2 : c.have / c.need);
  return COMBOS.map((c) => ({ id: c.id, name: c.name, text: c.text, have: comboHave(c, have), need: comboNeed(c, have) }))
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
  const cats = new Set(owned.map((p) => ABILITY[p.id]?.aim ?? ABILITY[p.id]?.cat));
  let w = cats.has(ABILITY[id].aim ?? ABILITY[id].cat) ? WEIGHT.sameCat : 1;
  const done = combosOf(owned);
  if (COMBOS.some((c) => !done.has(c.id) && c.needs.some((n) => have.has(n)) && c.needs.includes(id) && !have.has(id))) w *= WEIGHT.comboPart;
  // 진화를 노릴 수 있게: 진화 한 장 전인 증강
  if (owned.filter((p) => p.id === id).length === EVOLVE.count - 1) w *= EVOLVE.weight;
  return w;
}

/** 레전드로 한 번이라도 고른 능력 */
export function legendOf(picks: readonly Pick[] | undefined): Set<AbilityId> {
  const out = new Set((picks ?? []).filter((p) => p.tier === 3 && isOrdinary(p.id)).map((p) => p.id));
  for (const id of evolvedOf(picks)) out.add(id);
  return out;
}
/** 레전드 전용 효과가 있는지: 레전드로 고름 또는 진화 */
export const hasLegend = (p: PickHolder, id: AbilityId) => legendsFor(p).has(id);

/** 잭팟 배율과 그 확률(%) */
export const JACKPOT = { mults: [1.5, 2, 3], odds: [70, 25, 5] } as const;

const C = CURSE;
/** 저주 카드: 큰 보상 + 확실한 대가. 등급이 없고 수치는 고정(값 1 = 보유) */
export const CURSES: readonly AbilityDef[] = ([
  ['glassCannon', '유리 대포', `모든 점수 +${C.glassCannon.boostPct}%`, `빈 곳 클릭하면 −${C.glassCannon.missPenalty}점`],
  ['gambler', '도박사', `라운드가 끝날 때 ${C.gambler.chance * 100}% 확률로 그 라운드 점수 +${C.gambler.winPct}%`, `아니면 −${C.gambler.losePct}%`],
  ['berserker', '광전사', `피버 배율 +${C.berserker.multAdd}`, `피버 게이지가 ${C.berserker.gainDiv}배 느리게 참`],
  ['oneWay', '외길', `내 색 점수 ×${C.oneWay.ownMult}`, '노란색·무지개 0점'],
  ['vampire', '흡혈귀', `견제할 때마다 상대 총점의 ${C.vampire.drainPct}%(${C.vampire.drainMin}~${C.vampire.drainMax}점)를 빼앗음`, '견제당하면 내 총점의 같은 비율을 빼앗김'],
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
  ['allHands', '탐욕', '남의 색 원도 내 색 원처럼 점수, 견제 페널티·표적 없음'],
  ['fortress', '철벽', '견제(콤보 끊김·강탈·흡혈)·레이저·위험 패턴·방해 아이템에 걸리지 않음'],
  ['chainBlast', '연쇄 폭발', `원을 잡으면 ${Math.round(S.chainChance * 100)}% 확률로 반지름 ${S.chainR} 안의 내 원도 함께`],
  ['bossFeast', '막타 독식', `보스에게 주는 피해 ${S.feastMult}배, 막타 점수 ${S.feastMult}배`],
  ['lastFlame', '마지막 불꽃', `라운드 마지막 ${sec(S.flameMs)} 동안 점수 ×${S.flameMult}`],
  ['itemHunter', '아이템 사냥꾼', `아이템 원을 잡으면 한 등급 위 아이템, 효과 시간 ${S.hunterDur}배`],
] as const).map(([id, name, text]) => ({
  id, name, cat: '특별' as const, values: [1, 1, 1, 1] as const, cap: 1, special: true as const, desc: () => text,
}));

export type UniqueId = 'silence' | 'mirror' | 'resonance' | 'huntInstinct' | 'harvest' | 'ember' | 'goldCollector' | 'synergyLink';
export const UNIQUE_ODDS = [0, 3, 8, 10] as const;
export const UNIQUE_LAST_FINAL = 10;
export const UNIQUE = {
  silenceMs: 3_000, resonanceFever: 20,
  hunt: { assist: 1, solo: 3, pct: 10, max: 10, shortRoundMs: 60_000 },
  harvest: { every: 20, pct: 2, max: 15 },
  ember: { ms: 1_000, max: 5 },
  gold: { points: 20, pct: 5, max: 3 },
} as const;

export type UniqueStackId = 'huntInstinct' | 'harvest' | 'ember' | 'goldCollector';
export const UNIQUE_STACK_MAX: Record<UniqueStackId, number> = {
  huntInstinct: UNIQUE.hunt.max, harvest: UNIQUE.harvest.max, ember: UNIQUE.ember.max, goldCollector: UNIQUE.gold.max,
};

export const UNIQUES: readonly AbilityDef[] = ([
  { id: 'silence', name: '무의 시간', aim: '견제', desc: () => `내 피버가 시작되면 ${sec(UNIQUE.silenceMs)} 동안 상대의 증강 효과가 꺼짐 (저주·특별 제외)` },
  { id: 'mirror', name: '거울', aim: '보조', desc: () => '라운드 시작 시 점수가 가장 높은 상대의 일반 증강 하나를 그 라운드 동안 복사' },
  { id: 'resonance', name: '공명', aim: '피버', desc: () => `다른 사람의 피버가 시작될 때마다 내 피버 게이지 +${UNIQUE.resonanceFever}` },
  { id: 'huntInstinct', name: '사냥 본능', aim: '보스', desc: () => `보스 처치 관여 +${UNIQUE.hunt.assist}칸, 독식 +${UNIQUE.hunt.solo}칸. 칸당 보스 점수 +${UNIQUE.hunt.pct}% (최대 ${UNIQUE.hunt.max}칸, ${sec(UNIQUE.hunt.shortRoundMs)} 미만 라운드는 2배 적립)` },
  { id: 'harvest', name: '수확', aim: '점수', desc: () => `원 ${UNIQUE.harvest.every}개 획득마다 한 칸. 칸당 모든 점수 +${UNIQUE.harvest.pct}% (최대 ${UNIQUE.harvest.max}칸)` },
  { id: 'ember', name: '불씨', aim: '피버', desc: () => `피버가 끝날 때마다 한 칸. 칸당 피버 시간 +${sec(UNIQUE.ember.ms)} (최대 ${UNIQUE.ember.max}칸)` },
  { id: 'goldCollector', name: '황금 수집가', aim: '점수', desc: () => `황금 원 +${UNIQUE.gold.points}점, 획득마다 한 칸. 칸당 모든 점수 +${UNIQUE.gold.pct}% (최대 ${UNIQUE.gold.max}칸)` },
  { id: 'synergyLink', name: '연결', aim: '보조', desc: () => '필요한 증강이 3장인 조합을 2장만 모아도 완성' },
] satisfies { id: UniqueId; name: string; aim: AbilityCategory; desc: () => string }[]).map((a) => ({
  ...a, cat: '유니크', values: [1, 1, 1, 1], cap: 1, unique: true,
}));

export const ALL_ABILITIES: readonly AbilityDef[] = [...ABILITIES, ...CURSES, ...SPECIALS, ...UNIQUES];
export const isCurse = (id: AbilityId) => !!ABILITY[id]?.curse;
export const isSpecial = (id: AbilityId) => !!ABILITY[id]?.special;
export const isUnique = (id: AbilityId) => !!ABILITY[id]?.unique;
export const isOrdinary = (id: AbilityId) => !!ABILITY[id] && !isCurse(id) && !isSpecial(id) && !isUnique(id);
export const hasLegendPick = (picks: readonly Pick[]) => picks.some((p) => p.tier === 3 && isOrdinary(p.id));

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

export type PickHolder = { picks: readonly Pick[]; silenced?: boolean; mirror?: Pick | null };

export function activePicks(p: PickHolder): readonly Pick[] {
  return p.silenced ? p.picks.filter(({ id }) => isCurse(id) || isSpecial(id)) : p.picks;
}

export function modsFor(p: PickHolder): Mods {
  const picks = activePicks(p);
  const m = modsOf(picks);
  const copy = p.silenced ? null : p.mirror;
  if (!copy || !isOrdinary(copy.id)) return m;
  const cap = evolvedCap(copy.id, evolvedOf(picks).has(copy.id));
  return { ...m, [copy.id]: Math.min(cap, m[copy.id] + abilityValue(copy)) };
}

export function legendsFor(p: PickHolder): Set<AbilityId> {
  const legends = legendOf(activePicks(p));
  if (!p.silenced && p.mirror?.tier === 3 && isOrdinary(p.mirror.id)) legends.add(p.mirror.id);
  return legends;
}

export const combosFor = (p?: PickHolder) => combosOf(p && activePicks(p));
export const synergiesFor = (p?: PickHolder) => synergiesOf(p && activePicks(p));

type MirrorPlayer = PickHolder & { id: string; score: number; team?: number; outAt?: number };
export function pickMirror(p: MirrorPlayer, players: readonly MirrorPlayer[], team: boolean, rand = Math.random): Pick | null {
  if (!p.picks.some(({ id }) => id === 'mirror')) return null;
  const target = players.filter((o) => o.id !== p.id && !o.outAt && (!team || o.team !== p.team))
    .reduce<MirrorPlayer | undefined>((best, o) => !best || o.score > best.score ? o : best, undefined);
  const pool = target?.picks.filter(({ id }) => isOrdinary(id));
  return pool?.length ? { ...pool[Math.floor(rand() * pool.length)] } : null;
}

const ZERO = Object.fromEntries(ALL_ABILITIES.map((a) => [a.id, 0])) as Mods;

/** 고른 능력들을 합친 수치 (중첩, 상한 적용. 진화한 능력은 상한 ×EVOLVE.capMult) */
export function modsOf(picks: readonly Pick[] | undefined): Mods {
  if (!picks?.length) return ZERO;
  const m = { ...ZERO };
  const evolved = evolvedOf(picks);
  for (const p of picks) {
    const a = ABILITY[p.id];
    if (!a) continue;
    const cap = evolvedCap(p.id, evolved.has(p.id));
    m[p.id] = Math.min(cap, m[p.id] + a.values[p.tier]);
  }
  return m;
}

/** 중첩 상한: 진화하면 ×capMult, 잭팟만은 +jackpotCapAdd(%p)만 (확률 상한이 너무 커지지 않게) */
export function evolvedCap(id: AbilityId, evolved: boolean) {
  const cap = ABILITY[id].cap ?? Infinity;
  if (id === 'itemLover' || id === 'autoGuard' || id === 'autoMagnet' || id === 'crownMark') return cap;
  if (!evolved) return cap;
  return id === 'jackpot' ? cap + EVOLVE.jackpotCapAdd : cap * EVOLVE.capMult;
}

/** 진화: 같은 증강을 count번 고르면 레전드 전용 효과 + 중첩 상한 ×capMult. 빌드 가중치: count−1번 고른 증강 ×weight */
export const EVOLVE = { count: 3, capMult: 1.5, weight: 2, jackpotCapAdd: 5 } as const;

/** 진화한 능력 (저주·특별 제외) */
export function evolvedOf(picks: readonly Pick[] | undefined): Set<AbilityId> {
  const n = new Map<AbilityId, number>();
  for (const p of picks ?? []) n.set(p.id, (n.get(p.id) ?? 0) + 1);
  return new Set([...n].filter(([id, c]) => c >= EVOLVE.count && isOrdinary(id)).map(([id]) => id));
}

/** 시너지: 같은 분류의 서로 다른 증강 수가 need 이상이면 보너스 (저주·특별·성장 제외, 증강 조합과 따로) */
export type SynergyCat = '점수' | '피버' | '보스' | '유지' | '견제' | '보조';
/** 시너지 보너스 수치: 내 색 +, 피버 게이지 ×, 보스 타격 점수 ×, 콤보가 끊길 때 남는 %, 견제·반격 +, 아이템 버프 시간 +ms */
export const SYN = { ownAdd: 1, feverGain: 1.15, bossHit: 1.2, keepPct: 50, stealAdd: 2, buffAddMs: 1_000 } as const;
export const SYNERGY: Record<SynergyCat, { need: number; text: string }> = {
  점수: { need: 3, text: `내 색 원 +${SYN.ownAdd}점` },
  피버: { need: 2, text: `피버 게이지 ${Math.round((SYN.feverGain - 1) * 100)}% 더 빨리 참` },
  보스: { need: 2, text: `보스 타격 점수 ×${SYN.bossHit}` },
  유지: { need: 2, text: `콤보가 끊길 때 ${SYN.keepPct}%는 남음` },
  견제: { need: 2, text: `견제·반격 점수 +${SYN.stealAdd}` },
  보조: { need: 2, text: `아이템 효과 시간 +${SYN.buffAddMs / 1000}초` },
};
const SYN_CATS = Object.keys(SYNERGY) as SynergyCat[];

/** 시너지 진행도: 분류별 서로 다른 증강 수 */
export function synergyProgress(picks: readonly Pick[] | undefined) {
  const ids = new Set((picks ?? []).map((p) => p.id));
  const categories = [...ids].map((id) => ABILITY[id]?.cat);
  return SYN_CATS.map((cat) => ({
    cat, have: categories.filter((category) => category === cat).length, need: SYNERGY[cat].need, text: SYNERGY[cat].text,
  })).filter((x) => x.have > 0);
}

/** 활성 시너지 */
export function synergiesOf(picks: readonly Pick[] | undefined): Set<SynergyCat> {
  return new Set(synergyProgress(picks).filter((x) => x.have >= x.need).map((x) => x.cat));
}

export function soloSynergyActive(picks: readonly Pick[], hasOther?: boolean) {
  const kinds = new Set(picks.filter(({ id }) => ABILITY[id]?.solo).map(({ id }) => id));
  if (kinds.size !== 1 || picks.some(({ id }) => id === 'synergyLink')) return false;
  return !(hasOther ?? (synergiesOf(picks).size > 0 || combosOf(picks).size > 0));
}

/** 같은 능력을 하나로 묶는다: 처음 고른 순서대로, 그중 가장 높은 등급, 고른 횟수 */
export function groupPicks(picks: readonly Pick[]): { id: AbilityId; tier: Tier; count: number }[] {
  const out = new Map<AbilityId, { id: AbilityId; tier: Tier; count: number }>();
  for (const p of picks) {
    if (!ABILITY[p.id]) continue;
    const g = out.get(p.id);
    if (g) { g.count++; if (p.tier > g.tier) g.tier = p.tier; } else out.set(p.id, { id: p.id, tier: p.tier, count: 1 });
  }
  return [...out.values()];
}

export const abilityValue = (p: Pick) => ABILITY[p.id]?.values[p.tier] ?? 0;
export const abilityText = (p: Pick) => ABILITY[p.id]?.desc(abilityValue(p)) ?? '';

/** 콤보 보너스 주기: 기본 10콤보, 최소 3콤보 */
export const comboPeriod = (cut: number) => Math.max(3, 10 - cut);

function crushText(v: number) {
  const whole = 1 + Math.floor(v);
  const frac = v - Math.floor(v);
  return frac ? `${whole}타, ${Math.round(frac * 100)}% 확률로 ${whole + 1}타` : `${whole}타`;
}

/** 잭팟: 터지면 배율, 아니면 1 */
export function jackpotMult(m: Mods, rand = Math.random, legend = false, highBoost = 1) {
  if (!(rand() < m.jackpot / 100)) return 1;
  // 잭팟 레전드: 배율 ×2~×5 (확률은 그대로). 행운 축적 레전드: ×3 이상이 나올 확률 highBoost배
  const mults = legend ? LEGEND.jackpotMults : JACKPOT.mults;
  const odds = JACKPOT.odds.map((o, i) => (mults[i] >= 3 ? o * highBoost : o));
  let r = rand() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < mults.length; i++) { r -= odds[i]; if (r < 0) return mults[i]; }
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
  unique?: boolean;
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
  const uniquePct = lastPlace ? UNIQUE_ODDS[i + 1] ?? UNIQUE_LAST_FINAL : UNIQUE_ODDS[i];
  const uniques = opts.unique && !opts.allLegend && !opts.owned?.some(({ id }) => isUnique(id))
    ? UNIQUES.filter((a) => !opts.exclude?.includes(a.id)) : [];
  const replaceRare = odds[1] ? uniquePct * odds.reduce((a, b) => a + b, 0) / (100 * odds[1]) : 0;
  let offeredUnique = false;
  // 빌드 가중치에 비례해 하나씩 뽑고 풀에서 뺀다 (중복 없음)
  const weights = pool.map((a) => buildWeight(a.id, opts.owned));
  while (out.length < count && pool.length) {
    let r = rand() * weights.reduce((x, y) => x + y, 0), k = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { r -= weights[j]; if (r < 0) { k = j; break; } }
    const tier = opts.allLegend ? 3 : rollTier(odds, rand);
    if (tier === 1 && uniques.length && !offeredUnique && replaceRare > 0 && rand() < replaceRare) {
      let draw = rand() * uniques.reduce((sum, a) => sum + buildWeight(a.id, opts.owned), 0);
      const a = uniques.find(({ id }) => (draw -= buildWeight(id, opts.owned)) < 0) ?? uniques[uniques.length - 1];
      out.push({ id: a.id, tier: 0 });
      offeredUnique = true;
      continue;
    }
    const a = pool.splice(k, 1)[0];
    weights.splice(k, 1);
    out.push({ id: a.id, tier });
  }
  let curseAt = -1;
  // 저주 카드: 선택지 하나를 바꿔 끼운다
  const chance = opts.forceCurse ? 1 : lastPlace ? ARCADE.curseChanceLastPlace : ARCADE.curseChance;
  if (!opts.allLegend && (opts.curses ?? 0) < ARCADE.maxCurses && rand() < chance) {
    // 악마의 계약은 마지막 선택에서는 대가만 남아서 제외
    const curses = CURSES.filter((c) => !(c.id === 'devilPact' && pickIndex >= ARCADE.rounds - 2));
    const c = curses[Math.floor(rand() * curses.length)];
    const spots = out.flatMap(({ id }, k) => isOrdinary(id) ? [k] : []);
    const reserve = Number(!!opts.special) + Number(opts.guarantee !== undefined);
    if (spots.length > reserve) {
      curseAt = spots[Math.floor(rand() * spots.length)];
      out[curseAt] = { id: c.id, tier: 0 };
    }
  }
  // 특별 카드: 저주가 아닌 자리 하나를 바꾼다
  if (opts.special && out.length) {
    const spots = out.map((_, k) => k).filter((k) => k !== curseAt && isOrdinary(out[k].id));
    const s = SPECIALS[Math.floor(rand() * SPECIALS.length)];
    if (spots.length > Number(opts.guarantee !== undefined)) out[spots[Math.floor(rand() * spots.length)]] = { id: s.id, tier: 0 };
  }
  // 꼴찌 등급 보장: 저주·특별 카드를 끼운 뒤, 남은 일반 카드 중에서
  const g = opts.guarantee;
  const plain = out.filter((o) => isOrdinary(o.id));
  if (g !== undefined && plain.length && !plain.some((o) => o.tier >= g)) plain[Math.floor(rand() * plain.length)].tier = g;
  return out;
}

/** 라운드가 끝날 때 적용되는 저주·특별 카드 결과 */
/** 'tax': 랜덤 이벤트 세금을 받은 사람 */
export interface RoundEffect { playerId: string; id: CurseId | 'flip' | 'tax'; delta: number }
