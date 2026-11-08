import { ABILITY, ARCADE, AUG, COMBO, CURSE, LEGEND, SPECIAL, combosOf, hasLegend, legendOf, bossDamage, comboPeriod, jackpotMult, modsOf, type Mods, type Pick, type RoundEffect } from './arcade.ts';

/**
 * 게임 규칙. 프레임워크와 무관한 순수 TypeScript.
 * 서버(판정)와 클라이언트(표시)가 같은 파일을 쓴다.
 * 밸런스 조정은 RULES 값만 바꾸면 된다.
 */

/** 논리 필드 크기. 클라이언트는 화면 크기에 맞춰 이 좌표계를 확대/축소해서 그린다. */
export const FIELD = { w: 1600, h: 900 } as const;
export const MAX_PLAYERS = 4;

export const COLORS = [
  { name: '코랄', hex: '#ff5d73', shape: 'tri' },
  { name: '블루', hex: '#4dabf7', shape: 'square' },
  { name: '그린', hex: '#51cf66', shape: 'diamond' },
  { name: '퍼플', hex: '#c39bff', shape: 'plus' },
] as const;
export const YELLOW = '#ffd43b';

/** 방 규칙과 상관없이 고정인 값 */
export const RULES = {
  countdownMs: 3_000,
  finalRushMs: 10_000,
  comboBonusEvery: 10,
  comboBonus: 5,
  points: { own: 3, yellow: 2, rainbow: 5, stealCalm: 1, counter: 6 },
  fever: { own: 12, yellow: 6, rainbow: 25, stealCalm: -20, miss: -10 },
  yellowChance: 0.33,
  /** 원의 기본 발사 속도 배율 (방 규칙의 게임 속도와 따로) */
  launchSpeed: 1.15,
  /**
   * 원 생성 곡선: 판 진행률(0→1)에 따라 속도는 speedStart → speedStart + speedGain (+ 무작위 speedRand),
   * 생성 간격(ms)은 gapStart → gapStart − gapDrop. 극초반이 심심하지 않게 시작 값을 높였다 (예전 130, 420ms)
   */
  spawn: { speedStart: 170, speedGain: 140, speedRand: 60, gapStart: 320, gapDrop: 120, gapMin: 170 },
  /** 꼴찌 보정이 켜졌을 때 꼴찌의 피버 충전 배율 */
  comebackGain: 1.25,
  /** 꼴찌 보정이 켜졌을 때 넓은 손 순위 보정 [꼴찌, 4인 방의 3등] */
  rankReach: [20, 10],
  /** 클릭 판정 여유(필드 단위) */
  hitPad: 12,
  /** 게임 커서: 서버로 보내는 빈도, 이보다 오래된 커서는 레이저·자석 판정에서 뺀다 */
  cursor: { sendHz: 15, staleMs: 500 },
  /**
   * 레이저 발사기: 간격, 경고, 발사 시간, 맞는 거리(중심선에서, 빔 폭은 그 2배), 스턴, 판 시작·끝 조용한 시간,
   * 스턴이 끝난 뒤 레이저 무적 시간, 평행 두 줄 사이에 남기는 틈, 한 번에 쏘는 줄 모양 확률(%)
   */
  laser: {
    everyMin: 10_000, everyMax: 15_000, warnMs: 1_200, fireMs: 300, width: 135, stunMs: 1_500, startQuietMs: 3_000, endQuietMs: 1_000,
    immuneMs: 1_000, safeGap: 160, volleyOdds: { single: 40, parallel: 25, cross: 20, radial: 15 },
  },
  /** 커서 자석: 끌려오는 시간, 플레이어마다 1초에 끌 수 있는 원 수 */
  magnet: { pullMs: 250, perSec: 2 },
  /** 방해 아이템: 효과 시간, 감도 감소 배율, 1등 저격 스턴, 효과가 끝난 뒤 커서가 마우스로 돌아오는 시간 */
  /** 방해: 효과 시간, 감도 감소 때 커서가 진짜 마우스를 따라가는 시간 상수(ms), 저격 스턴, 효과가 바뀔 때 미끄러지는 시간 */
  sabotage: { ms: 5_000, slowLagMs: 350, snipeStunMs: 3_000, slideMs: 150 },
  /** 이동형 보스 오오라: 몸통 밖 반경 +extra, 커서를 초당 pullSpeed로 끌고, tickMs마다 −touchPenalty, 클릭하면 −clickPenalty */
  aura: { extra: 80, pullSpeed: 120, tickMs: 500, touchPenalty: 1, clickPenalty: 2 },
  /**
   * 점수 구역: 가운데에서의 타원 거리 e = √(((x−800)/800)² + ((y−450)/450)²)로 나눈다.
   * e < bounds[0] 중앙, e < bounds[1] 사이, 그 밖은 가장자리. 일반 원 점수에 mult를 곱한다
   */
  zones: { bounds: [0.35, 0.7], mult: [1, 2, 3] },
  /**
   * 황금 원: 작고 빠르며 벽에서 튕기고 lifeSec 뒤 사라진다. 직접 클릭으로만 잡고 고정 points점 (배율 없음).
   * 한 판에 1/2/3번 확률 countOdds, 판 시작 startMs 뒤 ~ 끝나기 endMs 전 사이
   */
  gold: { r: 22, speed: 520, lifeSec: 5, points: 20, countOdds: [25, 50, 25], startMs: 3_000, endMs: 6_000 },
  /** 카오스 모드 배율. 레이저는 laserEveryMs마다, laserQuickChance 확률로 laserQuickMs 뒤 한 번 더 (겹쳐 나옴) */
  chaos: { itemMult: 3, waveIntervalMult: 0.5, laserEveryMs: 2_000, laserQuickChance: 0.35, laserQuickMs: 600, bossCountOdds: [20, 40, 40], eventChance: 0.3 },
  /** 아케이드: 라운드가 끝나고 능력 선택 화면이 열리기까지 ("라운드 종료!" 표시) */
  roundEndMs: 1_500,
  /** 네트워크 지연을 감안해 과거 몇 ms까지 클릭 위치를 인정할지 (서버 판정과 화면 예측 공통) */
  lagWindowMs: 250,
  /**
   * 발사 보호 구역: 원 중심이 필드 가운데에서 이 거리 안에 있으면 어떤 방법으로도 잡을 수 없다.
   * 모든 원이 가운데에서 태어나므로, 가운데만 눌러 태어나는 원을 다 가져가는 것을 막는다
   */
  spawnGuardR: 90,
  /** 매크로 방지: 1인 초당 최대 클릭 */
  maxClicksPerSec: 15,
  boss: {
    /** 때릴 때마다 */
    hit: 1,
    /** 막타 */
    kill: 20,
    /** 가장 많이 때린 사람 */
    mvp: 5,
    /** 보스 점수에 붙는 피버 배율 상한 */
    feverMultCap: 2,
    /** 체력 = 참가 인원 × 이 값 */
    hpPerPlayer: 6,
    r: 90,
    /** 화면 밖으로 나가기까지 걸리는 시간(초, 속도 ×1 기준) */
    lifeSec: 8,
    /** 보스가 터진 뒤 이 시간 동안 빈 곳 클릭 페널티 없음 */
    killGraceMs: 1000,
    /** 보스 종류 확률(%) */
    typeOdds: { normal: 40, guard: 20, rage: 20, runner: 20 },
    /** 동시에 화면에 있을 수 있는 보스 수 */
    maxAlive: 3,
    /** 한 번에 나오는 보스 수 확률(%) [1마리, 2마리, 3마리] (보스 러시는 2~3마리) */
    countOdds: [60, 30, 10],
    /** 방어형: guardCycleMs마다 마지막 guardOnMs 동안 보호막 (피해·점수 0) */
    guardCycleMs: 3000,
    guardOnMs: 1000,
    /** 공격형: rageCycleMs마다 마지막 rageOnMs 동안 붉어짐. 그때 때리면 라운드 안에서 때린 횟수 × ragePenaltyStep 감점 */
    rageCycleMs: 4000,
    rageOnMs: 1500,
    ragePenaltyStep: 2,
    /** 이동형: 작고 빠르며 화면 가장자리에서 튕긴다. lifeSec 뒤에 도망 */
    runnerR: 60,
    runnerSpeed: 380,
    runnerHpRate: 0.6,
  },
  /** 아케이드 라운드 테마 (랜덤 이벤트) */
  themes: {
    goldRushYellow: 0.6,
    /** 보스 러시: 라운드 진행률 지점마다 보스 */
    bossRushAt: [0.25, 0.55, 0.85],
    rainbowRain: 0.15,
    itemRushMult: 4,
  },
  /** 아이템 원 */
  items: {
    /** 일반 원이 생길 때 대신 아이템 원이 나올 확률 */
    chance: 0.025,
    /** 등급 확률(%) [흔함, 희귀, 전설] */
    tierOdds: [70, 25, 5],
    r: 34,
    /** 넓은 손 아이템의 범위, 자석 아이템의 커서 자석 반경 (능력과 더하고 능력 상한 적용) */
    wideHand: 35,
    magnet: 90,
    /** 효과 시간(ms) */
    ms: { wideHand: 5000, magnet: 5000, missGuard: 8000, comboLock: 5000, guard: 5000, double: 5000, paint: 5000, rain: 3000 },
    goldCount: 5,
    zoneR: 90,
    zoneMs: 4000,
    bombR: 180,
    freezeMs: 1500,
    feverCharge: 50,
    /** 즉시 피버를 피버 중에 잡으면 늘어나는 시간 */
    feverExtendMs: 3000,
    /** 꼴찌 보정이 켜진 방에서 꼴찌가 잡은 아이템 효과 시간 배율 */
    comebackDur: 1.5,
  },
  /** 발사 패턴 (웨이브) */
  waves: {
    /** 다음 웨이브까지 걸리는 시간(ms) 범위 */
    everyMin: 12_000,
    everyMax: 18_000,
    /** 웨이브 직전 예고(중앙 번쩍임) 시간 */
    warnMs: 400,
    fanCount: 5,
    /** 부채꼴: 가운데 방향에서 양쪽으로 벌어지는 각도 */
    fanSpreadDeg: 30,
    burstCount: 8,
    spiralCount: 8,
    spiralGapMs: 100,
    /** 이중 링: 두 번째 링이 늦게 나가는 시간 */
    ring2GapMs: 300,
    /** 쌍나선: 갈래마다 원 수 (나선과 같은 간격·45°씩) */
    twinCount: 6,
    /** 연속 사출: 한 방향으로 */
    streamCount: 6,
    streamGapMs: 120,
    /** 쓸기: 가운데 방향에서 양쪽으로 sweepDeg만큼 쓸며 */
    sweepCount: 8,
    sweepDeg: 60,
    sweepGapMs: 100,
  },
} as const;

// ---------- 방 규칙 (방장이 대기실에서 설정) ----------

export interface RoomRules {
  /** 원 속도 배율 */
  speed: number;
  /** 원 개수 배율 (생성 간격의 역수) */
  density: number;
  /** 한 판 시간(초) */
  roundSec: number;
  feverMult: number;
  feverSec: number;
  /** 피버 게이지 충전 속도 배율 */
  feverGain: number;
  /** 무지개 원 확률(%) */
  rainbowPct: number;
  /** 평상시 견제 시 페널티(콤보 끊김, 게이지 감소, 표적) */
  stealPenalty: boolean;
  /** 표적 시간(초) */
  markSec: number;
  /** 꼴찌는 피버 게이지가 더 빨리 참 */
  comeback: boolean;
  /** 보스 원 등장 */
  boss: boolean;
  /** 빈 곳 클릭 페널티 (콤보 끊김, 피버 게이지 감소) */
  missPenalty: boolean;
  /** 클래식: 한 판 / 아케이드: 5라운드 + 라운드마다 능력 선택 */
  mode: 'classic' | 'arcade';
  /** 아케이드 라운드 시간(초) */
  arcadeRoundSec: number;
  /** 아이템 원 등장 */
  items: boolean;
  /** 발사 패턴(부채꼴·동시 다발·나선 웨이브) */
  waves: boolean;
  /** 레이저 발사기 (커서가 맞으면 스턴) */
  laser: boolean;
  /** 방해 아이템 (감도 감소·마우스 반대·시야 방해·1등 저격) */
  sabotage: boolean;
  /** 카오스 모드: 아이템·웨이브·레이저·보스·랜덤 이벤트가 더 자주 (카오스 프리셋이 켬) */
  chaos: boolean;
  /** 아케이드: 라운드 사이 랜덤 이벤트 */
  randomEvents: boolean;
}

/** 프리셋을 골라도 바뀌지 않는 설정 (모드 관련) */
export const MODE_KEYS = ['mode', 'arcadeRoundSec', 'randomEvents'] as const;

/** 각 설정에서 고를 수 있는 값. 화면의 선택지와 서버 검사에 같이 쓴다 */
export const RULE_CHOICES = {
  speed: [0.75, 1, 1.25, 1.5],
  density: [0.75, 1, 1.3],
  roundSec: [30, 60, 90, 120],
  feverMult: [2, 3, 4, 5],
  feverSec: [4, 5, 7, 10, 12],
  feverGain: [0.7, 1, 1.4],
  rainbowPct: [0, 3, 6, 10],
  markSec: [0, 2, 4, 6, 8],
  arcadeRoundSec: [30, 45, 60, 90],
} as const satisfies Partial<Record<keyof RoomRules, readonly number[]>>;

export const DEFAULT_RULES: RoomRules = {
  speed: 1, density: 1, roundSec: 60,
  feverMult: 3, feverSec: 7, feverGain: 1,
  rainbowPct: 3, stealPenalty: true, markSec: 4,
  comeback: false, boss: true, missPenalty: true,
  mode: 'classic', arcadeRoundSec: 30, items: true, waves: true, laser: true, sabotage: true, chaos: false, randomEvents: true,
};

export const PRESETS = {
  basic: { name: '기본', desc: '표준 규칙', rules: DEFAULT_RULES },
  party: {
    name: '파티', desc: '피버가 자주, 세게 터지는 정신없는 판',
    rules: { ...DEFAULT_RULES, density: 1.3, feverMult: 5, feverSec: 10, feverGain: 1.4, rainbowPct: 10, comeback: true },
  },
  hardcore: {
    name: '하드코어', desc: '빠르고 많은 원, 짧은 피버',
    rules: { ...DEFAULT_RULES, speed: 1.5, density: 1.3, feverMult: 2, feverSec: 4, feverGain: 0.7, rainbowPct: 0, items: false },
  },
  chill: {
    name: '느긋하게', desc: '천천히, 처음 하는 친구와 함께',
    rules: { ...DEFAULT_RULES, speed: 0.75, density: 0.75, roundSec: 90, comeback: true, missPenalty: false, laser: false, sabotage: false },
  },
  chaos: {
    name: '카오스', desc: '모든 게 켜진 진정한 난장판',
    rules: { ...DEFAULT_RULES, speed: 1.25, density: 1.3, feverMult: 5, rainbowPct: 10, comeback: true, chaos: true },
  },
} as const satisfies Record<string, { name: string; desc: string; rules: RoomRules }>;
export type PresetId = keyof typeof PRESETS;

/** 현재 규칙이 어떤 프리셋과 같은지. 다르면 null(사용자 설정) */
export function matchPreset(r: RoomRules): PresetId | null {
  for (const [id, p] of Object.entries(PRESETS)) {
    const keys = (Object.keys(r) as (keyof RoomRules)[]).filter((k) => !(MODE_KEYS as readonly string[]).includes(k));
    if (keys.every((k) => r[k] === p.rules[k])) return id as PresetId;
  }
  return null;
}

/** 클라이언트가 보낸 값을 허용된 선택지로만 반영 */
export function sanitizeRules(base: RoomRules, input: Partial<RoomRules>): RoomRules {
  const out = { ...base };
  for (const [k, choices] of Object.entries(RULE_CHOICES) as [keyof typeof RULE_CHOICES, readonly number[]][]) {
    const v = input[k];
    if (typeof v === 'number' && choices.includes(v)) out[k] = v;
  }
  for (const k of ['stealPenalty', 'comeback', 'boss', 'missPenalty', 'items', 'waves', 'laser', 'sabotage', 'chaos', 'randomEvents'] as const) {
    if (typeof input[k] === 'boolean') out[k] = input[k]!;
  }
  if (input.mode === 'classic' || input.mode === 'arcade') out.mode = input.mode;
  return out;
}

/** 판정에 쓰는 계산용 규칙 */
export interface GameRules {
  roundMs: number;
  feverMs: number;
  feverMult: number;
  markMs: number;
  stealPenalty: boolean;
  speed: number;
  density: number;
  feverGain: number;
  rainbowChance: number;
  comeback: boolean;
  boss: boolean;
  missPenalty: boolean;
  arcade: boolean;
  items: boolean;
  waves: boolean;
  laser: boolean;
  sabotage: boolean;
  chaos: boolean;
  randomEvents: boolean;
}

export function toGameRules(r: RoomRules): GameRules {
  return {
    roundMs: (r.mode === 'arcade' ? r.arcadeRoundSec : r.roundSec) * 1000,
    feverMs: r.feverSec * 1000,
    feverMult: r.feverMult,
    markMs: r.markSec * 1000,
    stealPenalty: r.stealPenalty,
    speed: r.speed,
    density: r.density,
    feverGain: r.feverGain,
    rainbowChance: r.rainbowPct / 100,
    comeback: r.comeback,
    boss: r.boss,
    missPenalty: r.missPenalty,
    arcade: r.mode === 'arcade',
    items: r.items,
    waves: r.waves,
    laser: r.laser,
    sabotage: r.sabotage,
    chaos: r.chaos,
    randomEvents: r.randomEvents,
  };
}

export type ColorIndex = 0 | 1 | 2 | 3;
/** 보스 종류: 일반, 방어형(보호막), 공격형(붉어짐), 이동형(튕김) */
export type BossType = 'normal' | 'guard' | 'rage' | 'runner';
/** 아케이드 라운드 테마 */
export type ThemeId = 'goldRush' | 'bossRush' | 'reverse' | 'rainbowRain' | 'itemRush' | 'allYellow';
export type CircleKind = ColorIndex | 'y' | 'rainbow' | 'boss' | 'item' | 'gold';

export interface Circle {
  id: number;
  kind: CircleKind;
  /** 발사 방향(라디안) */
  angle: number;
  /** 필드 단위/초 */
  speed: number;
  r: number;
  /** 서버 시각(ms) */
  born: number;
  /** 보스 원만: 남은 체력 / 최대 체력 */
  hp?: number;
  maxHp?: number;
  /** 보스 원만: 종류 (없으면 일반) */
  boss?: BossType;
  /** 아이템 원만: 등급 (0 흔함, 1 희귀, 2 전설). 무슨 아이템인지는 잡을 때 정해진다 */
  itemTier?: 0 | 1 | 2;
  /** 시간 정지로 멈춘 구간 [시작 서버 시각, 길이 ms] */
  holds?: [from: number, ms: number][];
  /** 역발사: 가장자리에서 중앙으로 */
  rev?: boolean;
}

/** 결과 화면 칭호 계산용 기록 (한 판 단위) */
export interface PlayerStats {
  /** 가져간 원 수 (보스 제외) */
  hits: number;
  misses: number;
  /** 남의 색을 가져간 횟수 (반격 제외) */
  steals: number;
  counters: number;
  fevers: number;
  maxCombo: number;
  bossHits: number;
  bossKills: number;
}

export const emptyStats = (): PlayerStats => ({ hits: 0, misses: 0, steals: 0, counters: 0, fevers: 0, maxCombo: 0, bossHits: 0, bossKills: 0 });

export interface PlayerState {
  id: string;
  name: string;
  color: ColorIndex;
  bot: boolean;
  connected: boolean;
  score: number;
  combo: number;
  /** 0~100. 피버 중에는 0 */
  fever: number;
  feverUntil: number;
  markedUntil: number;
  stats: PlayerStats;
  /** 아케이드: 고른 능력 */
  picks: Pick[];
  /** 여운: 피버가 끝난 뒤 점수 ×1.5가 유지되는 시각 */
  afterUntil: number;
  /** 방해 전파를 맞아 내 화면의 원이 흐려지는 시각 */
  blurUntil: number;
  /** 이번 라운드에 남은 방패 횟수 */
  shieldLeft: number;
  /** 라운드 시작 때 점수 (도박사·악마의 계약 계산용) */
  roundStart: number;
  /** 이번 라운드 최대 콤보 (시한폭탄) */
  roundMaxCombo: number;
  /** 악마의 계약: 다음 라운드 끝에 점수 절반 */
  pactPending: boolean;
  /** 악마의 계약: 다음 능력 선택이 전부 레전드 */
  legendNext: boolean;
  /** 아이템 효과가 끝나는 서버 시각 */
  buffs: Partial<Record<BuffId, number>>;
  /** 황금 손: 점수 2배가 남은 원 수 */
  goldLeft: number;
  /** 이번 라운드에 붉은 공격형 보스를 때린 횟수 (감점이 커진다) */
  rageHits: number;
  /** 이번 라운드에 남은 견제 반사 횟수 */
  reflectLeft: number;
  /** 스턴이 끝나는 서버 시각 (그때까지 클릭이 무시된다) */
  stunUntil: number;
  /** 방해 효과가 끝나는 서버 시각 */
  debuffs: Partial<Record<DebuffId, number>>;
  /** 시야 방해 모양 (서버가 정해서 재접속해도 같음) */
  blind: { kind: BlindKind; seed: number } | null;
  /** 역전 기회 (아케이드, 라운드 끝에 판정). 꼴찌를 벗어나면 꺼진다 */
  comeback: boolean;
  /** 넓은 손 순위 보정 (꼴찌 보정 방에서 낮은 순위일수록) */
  rankReach: number;
  /** 이번 라운드가 끝나는 서버 시각 (마지막 불꽃) */
  roundEnd: number;
  /** 이번 라운드 시작 서버 시각 (출발 신호 레전드) */
  roundBegin: number;
  /** 이번 라운드 첫 피버 전인지, 지금 피버에 더해지는 배율 (예열 레전드) */
  firstFever: boolean;
  feverBonus: number;
  /** 피버가 끝나면 게이지에 더할 양 (과충전 레전드) */
  feverCarry: number;
  /** 리바운드: 끝나는 시각, 끊긴 콤보 수, 레전드로 되찾았는지 */
  reboundUntil: number;
  reboundLost: number;
  reboundUsed: boolean;
  /** 철옹성 조합: 이번 라운드에 남은 콤보 끊김 막기 */
  ironLeft: number;
  /** 속사: 마지막 획득 시각, 연속 수, 다음 잭팟 확정 (레전드) */
  lastClaimAt: number;
  rapidStreak: number;
  rapidJackpot: boolean;
}

/** 방해 효과: 감도 감소, 마우스 반대, 시야 방해 */
export type DebuffId = 'slow' | 'invert' | 'blind';
export type BlindKind = 'ink' | 'half' | 'doodle' | 'lens';
export const BLIND_KINDS: readonly BlindKind[] = ['ink', 'half', 'doodle', 'lens'];

export const debuffOn = (p: PlayerState, id: DebuffId, now: number) => now < (p.debuffs[id] ?? 0);

/** 방해 걸기: 이미 걸려 있으면 남은 시간에 더하되 원래 시간의 2배까지 (버프와 같은 규칙) */
export function addDebuff(p: PlayerState, id: DebuffId, ms: number, now: number) {
  p.debuffs[id] = Math.min(Math.max(p.debuffs[id] ?? 0, now) + ms, now + ms * 2);
}

/** 시간 제한이 있는 아이템 효과 */
export type BuffId = 'wideHand' | 'magnet' | 'missGuard' | 'comboLock' | 'guard' | 'double' | 'paint';

export const buffOn = (p: PlayerState, id: BuffId, now: number) => now < (p.buffs[id] ?? 0);

/** 효과 걸기. 이미 걸려 있으면 남은 시간에 더하되 원래 시간의 2배까지 */
export function addBuff(p: PlayerState, id: BuffId, ms: number, now: number) {
  p.buffs[id] = Math.min(Math.max(p.buffs[id] ?? 0, now) + ms, now + ms * 2);
}

/** 일시정지가 풀렸을 때: since 이후에 끝나는 시각을 delta만큼 뒤로 */
export function shiftTimes(p: PlayerState, since: number, delta: number) {
  for (const k of ['feverUntil', 'markedUntil', 'afterUntil', 'blurUntil', 'stunUntil', 'roundEnd', 'reboundUntil', 'lastClaimAt'] as const) if (p[k] > since) p[k] += delta;
  // 라운드 시작 시각: 출발 신호 레전드 창이 아직 안 끝났으면 멈춘 만큼 늦춘다
  if (p.roundBegin + LEGEND.headStartMs > since) p.roundBegin += delta;
  for (const k of Object.keys(p.buffs) as BuffId[]) if (p.buffs[k]! > since) p.buffs[k]! += delta;
  for (const k of Object.keys(p.debuffs) as DebuffId[]) if (p.debuffs[k]! > since) p.debuffs[k]! += delta;
}

/** 넓은 손 범위: 능력 + 아이템, 능력 상한 */
export function reachOf(p: PlayerState, now: number) {
  const v = modsOf(p.picks).wideHand + (buffOn(p, 'wideHand', now) ? RULES.items.wideHand : 0) + (p.rankReach ?? 0);
  return Math.min(ABILITY.wideHand.cap ?? Infinity, v);
}
/** 자석 거리: 능력 + 아이템, 능력 상한 */
/** cursor: 변두리 조합이면 커서가 가장자리 구역일 때 범위 ×1.5 */
export function magnetOf(p: PlayerState, now: number, cursor?: { x: number; y: number } | null) {
  const v = Math.min(ABILITY.magnet.cap ?? Infinity, modsOf(p.picks).magnet + (buffOn(p, 'magnet', now) ? RULES.items.magnet : 0));
  return cursor && combosOf(p.picks).has('outskirts') && zoneOf(cursor) === 2 ? v * COMBO.outskirtsMult : v;
}

/**
 * 점수 2배·황금 손 배율 (서로 겹치지 않음). consume이면 황금 손 하나를 쓴다.
 * gold가 false면 황금 손은 쓰지 않는다 (0점 원, 폭죽·필드 클리어)
 */
export function itemMult(p: PlayerState, now: number, consume: boolean, gold = true) {
  if (buffOn(p, 'double', now)) return 2;
  if (gold && p.goldLeft > 0) { if (consume) p.goldLeft--; return 2; }
  return 1;
}

export type ClaimType = 'own' | 'yellow' | 'rainbow' | 'steal' | 'feverSteal' | 'counter';
/** 어떻게 잡았는지: 직접 클릭, 넓은 손 범위, 자석, 장판, 폭죽·필드 클리어 */
/** save: 헛손질 보정으로 대신 잡음 */
export type ClaimVia = 'click' | 'range' | 'magnet' | 'zone' | 'blast' | 'save';

export interface ClaimResult {
  type: ClaimType;
  gained: number;
  comboBonus: boolean;
  feverStarted: boolean;
  /** 이 클릭으로 콤보가 끊긴 상대 id */
  brokeComboOf: string | null;
  /** 이 클릭으로 표적이 됐는지 */
  marked: boolean;
  /** 강탈로 빼앗은 점수 */
  plundered: number;
  /** 상대의 방패로 콤보 끊기가 막혔는지 */
  shielded: boolean;
  via: ClaimVia;
  /** 잭팟 배율 (안 터지면 1) */
  jackpot: number;
  /** 방패 레전드로 원 주인에게 빼앗긴 점수 */
  drained?: number;
  /** 잡은 자리의 점수 구역 (0 중앙, 1 사이, 2 가장자리) */
  zone: ZoneIndex;
  /** 견제 반사: 원 주인이 반사해서 주인이 잡은 것으로 처리됐으면 그 주인 id와 주인 쪽 결과 */
  reflectedTo?: string;
  reflected?: ClaimResult;
}

export function newPlayer(id: string, name: string, color: ColorIndex, bot = false): PlayerState {
  return {
    id, name, color, bot, connected: true, score: 0, combo: 0, fever: 0, feverUntil: 0, markedUntil: 0, stats: emptyStats(),
    picks: [], afterUntil: 0, blurUntil: 0, shieldLeft: 0,
    roundStart: 0, roundMaxCombo: 0, pactPending: false, legendNext: false, buffs: {}, goldLeft: 0, rageHits: 0, reflectLeft: 0, stunUntil: 0, debuffs: {}, blind: null,
    comeback: false, rankReach: 0, roundEnd: 0, roundBegin: 0, firstFever: true, feverBonus: 0, feverCarry: 0,
    reboundUntil: 0, reboundLost: 0, reboundUsed: false, lastClaimAt: 0, rapidStreak: 0, rapidJackpot: false, ironLeft: 0,
  };
}

/** 새 게임 시작: 점수, 기록, 능력 모두 초기화 */
export function resetForRound(p: PlayerState) {
  p.score = 0; p.stats = emptyStats(); p.picks = []; p.pactPending = false; p.legendNext = false; p.comeback = false; p.rankReach = 0;
}

/** 능력(또는 저주)을 고른 직후 처리 */
export function applyPick(p: PlayerState, pick: Pick) {
  p.picks.push(pick);
  if (pick.id === 'devilPact') p.pactPending = true;
}

/** 라운드 시작(클래식은 판 시작): 라운드 단위 상태 초기화와 능력 적용. 점수는 누적 */
export function startRound(p: PlayerState, startAt: number, G: GameRules, endAt = 0) {
  const m = modsOf(p.picks);
  p.combo = 0; p.fever = 0; p.feverUntil = 0; p.markedUntil = 0; p.afterUntil = 0; p.blurUntil = 0;
  p.shieldLeft = m.shield; p.reflectLeft = m.reflect; p.stunUntil = 0;
  p.debuffs = {}; p.blind = null;
  p.buffs = {}; p.goldLeft = 0;
  p.roundStart = p.score; p.roundMaxCombo = 0; p.rageHits = 0;
  p.roundEnd = endAt || startAt + G.roundMs;
  p.roundBegin = startAt; p.firstFever = true; p.feverBonus = 0; p.feverCarry = 0;
  p.reboundUntil = 0; p.reboundLost = 0; p.reboundUsed = false; p.lastClaimAt = 0; p.rapidStreak = 0; p.rapidJackpot = false;
  p.ironLeft = combosOf(p.picks).has('ironWall') ? COMBO.ironPerRound : 0;
  p.score += m.headStart;
  if (m.timeBomb) p.score += CURSE.timeBomb.bonus;
  // 표적 자처: 라운드 내내 표적
  if (m.selfTarget) p.markedUntil = endAt || startAt + G.roundMs;
  // 예열 100 또는 집중 포화: 라운드를 피버로 시작
  if (m.preheat >= 100 || m.focusFire) startFever(p, startAt, G, m);
  else p.fever = m.preheat;
}

/** 능력을 반영한 피버 시간·배율 */
export const feverMsOf = (p: PlayerState, G: GameRules) => G.feverMs + modsOf(p.picks).overtime * 1000;
export const feverMultOf = (p: PlayerState, G: GameRules) => {
  const m = modsOf(p.picks);
  return G.feverMult + m.frenzy + (m.berserker ? CURSE.berserker.multAdd : 0) + (m.focusFire ? SPECIAL.focusMult : 0) + (p.feverBonus ?? 0)
    + (combosOf(p.picks).has('feverMaster') ? COMBO.feverAdd : 0);
};
/** 유리 대포·표적 자처·대역전: 모든 점수 배율 */
export const scoreBoostOf = (m: Mods) =>
  1 + ((m.glassCannon ? CURSE.glassCannon.boostPct : 0) + (m.selfTarget ? CURSE.selfTarget.boostPct : 0)) / 100
  + (m.comebackBoost ? SPECIAL.boost - 1 : 0);

/** 역전 기회 배율: 켜져 있고 아직 꼴찌면 방 인원별 배율. 꼴찌를 벗어나면 끈다 (다음 라운드 끝 판정까지) */
export function comebackMult(p: PlayerState, players: PlayerState[]) {
  if (!p.comeback) return 1;
  if (!isLast(p, players)) { p.comeback = false; return 1; }
  return ARCADE.comeback.roomMult[players.length] ?? 1;
}

/** 점수가 바뀔 때마다: 역전 기회인데 꼴찌가 아니게 된 사람은 바로 끈다 (다음 라운드 끝 판정까지 다시 안 켜짐) */
export function sweepComeback(players: PlayerState[]) {
  for (const p of players) if (p.comeback && !isLast(p, players)) p.comeback = false;
}

/** 원·보스·황금 원 점수에 더 곱하는 배율: 역전 기회 × 마지막 불꽃 */
export function extraMult(p: PlayerState, now: number, players: PlayerState[]) {
  const flame = modsOf(p.picks).lastFlame && p.roundEnd && now >= p.roundEnd - SPECIAL.flameMs ? SPECIAL.flameMult : 1;
  // 출발 신호 레전드: 라운드 처음 10초 ×1.5
  const start = hasLegend(p, 'headStart') && now < p.roundBegin + LEGEND.headStartMs ? LEGEND.headStartMult : 1;
  return comebackMult(p, players) * flame * start;
}

/** 피버가 끝나는 시각을 옮긴다 (여운도 같은 만큼 옮겨 길이를 지킴) */
function shiftFeverEnd(p: PlayerState, delta: number) {
  p.feverUntil += delta;
  if (p.afterUntil) p.afterUntil += delta;
}

/** 행운아 조합: 잭팟 확률 +10 (보스 잭팟에도) */
export const luckyMods = (p: PlayerState, m: Mods): Mods => (combosOf(p.picks).has('lucky') ? { ...m, jackpot: m.jackpot + COMBO.jackpotAdd } : m);

/** 여운 배율 (여운 레전드면 ×2) */
export const afterMultOf = (p: PlayerState) => (hasLegend(p, 'afterglow') ? LEGEND.afterglowMult : AUG.afterglowMult);

/**
 * 피버가 끝난 뒤 처음 불릴 때 정리한다 (서버 틱·원 획득 때): 예열 레전드 배율을 지우고,
 * 과충전 레전드면 남겨 둔 게이지를 채운다. 게이지가 바뀌었으면 true (상태를 다시 보내야 함)
 */
export function settleFever(p: PlayerState, now: number) {
  if (!(p.feverUntil > 0 && now >= p.feverUntil)) return false;
  p.feverBonus = 0;
  if (p.feverCarry <= 0) return false;
  p.fever = Math.min(100, p.fever + p.feverCarry);
  p.feverCarry = 0;
  return true;
}

/** 판 뒤집기: 라운드가 끝날 때 1등과의 점수 차의 일부를 내 점수에 더한다 (1등 점수는 그대로) */
export function endRoundSpecials(players: PlayerState[]): RoundEffect[] {
  if (!players.length) return [];
  const top = Math.max(...players.map((p) => p.score));
  const out: RoundEffect[] = [];
  for (const p of players) {
    if (!modsOf(p.picks).flip || p.score >= top) continue;
    const d = Math.round(((top - p.score) * SPECIAL.flipPct) / 100);
    if (d > 0) { p.score += d; out.push({ playerId: p.id, id: 'flip', delta: d }); }
  }
  return out;
}

/** 하이에나: 1등(동점 포함)이 원을 잡아 점수를 얻을 때 하이에나를 가진 다른 사람마다 확률로 점수를 더한다 */
export function hyenaGains(claimer: PlayerState, players: PlayerState[], gained: number, rand = Math.random) {
  const out: { playerId: string; delta: number }[] = [];
  if (gained <= 0 || claimer.score < Math.max(...players.map((p) => p.score))) return out;
  for (const p of players) {
    if (p === claimer || !modsOf(p.picks).hyena || !(rand() < SPECIAL.hyenaChance)) continue;
    p.score += SPECIAL.hyenaGain;
    out.push({ playerId: p.id, delta: SPECIAL.hyenaGain });
  }
  return out;
}

/** 넓은 손 순위 보정 (꼴찌 보정 방): 최저 점수 무리 +20, 4인 방이면 그다음 낮은 무리 +10 (1등 점수 무리는 제외) */
export function applyRankReach(players: PlayerState[], G: GameRules) {
  for (const p of players) p.rankReach = 0;
  if (!G.comeback || players.length < 2) return;
  const distinct = [...new Set(players.map((p) => p.score))].sort((a, b) => a - b);
  if (distinct.length < 2) return;
  const top = distinct[distinct.length - 1];
  for (const p of players) {
    if (p.score === distinct[0]) p.rankReach = RULES.rankReach[0];
    else if (players.length >= 4 && p.score === distinct[1] && distinct[1] !== top) p.rankReach = RULES.rankReach[1];
  }
}

/** 라운드가 끝날 때 저주 효과 적용 (시한폭탄 → 악마의 계약 → 도박사 순) */
export function endRoundCurses(p: PlayerState, rand = Math.random): RoundEffect[] {
  const m = modsOf(p.picks);
  const out: RoundEffect[] = [];
  const add = (id: RoundEffect['id'], delta: number) => {
    const d = Math.max(-p.score, Math.round(delta));
    p.score += d;
    out.push({ playerId: p.id, id, delta: d });
  };
  if (m.timeBomb && p.roundMaxCombo < CURSE.timeBomb.comboGoal) add('timeBomb', -CURSE.timeBomb.penalty);
  if (p.pactPending) {
    // 계약을 맺은 다음 라운드가 끝났을 때 (계약은 라운드 사이에 고르므로 이 시점이 곧 다음 라운드 끝)
    add('devilPact', -Math.max(0, p.score - p.roundStart) * (1 - CURSE.devilPact.keepPct / 100));
    p.pactPending = false;
    p.legendNext = true;
  }
  if (m.gambler) {
    const round = Math.max(0, p.score - p.roundStart);
    add('gambler', rand() < CURSE.gambler.chance ? (round * CURSE.gambler.winPct) / 100 : (-round * CURSE.gambler.losePct) / 100);
  }
  return out;
}

export function startFever(p: PlayerState, now: number, G: GameRules, m: Mods) {
  p.fever = 0;
  const L = legendOf(p.picks);
  // 예열 레전드: 라운드 첫 피버만 배율 +2
  p.feverBonus = L.has('preheat') && p.firstFever ? LEGEND.preheatMult : 0;
  p.firstFever = false;
  // 과충전 레전드: 피버가 끝나면 게이지 50%
  p.feverCarry = L.has('overcharge') ? LEGEND.overchargeKeep : 0;
  p.feverUntil = now + G.feverMs + m.overtime * 1000;
  p.afterUntil = m.afterglow ? p.feverUntil + m.afterglow * 1000 : 0;
}

/** 콤보 끊기 (보험이 있으면 일부 유지, 콤보 고정 중이면 그대로). 실제로 줄었으면 true */
/** byOther: 남이 끊었는지 (견제당함). 리바운드는 남이 끊었을 때만 켜진다 */
function breakCombo(p: PlayerState, m: Mods, now: number, byOther = false) {
  // 콤보 고정 아이템·기세 특별 카드: 끊기지 않음
  if (buffOn(p, 'comboLock', now) || m.momentum) return false;
  // 철옹성 조합: 라운드마다 한 번 막음 (끊을 콤보가 있을 때만 씀)
  const before = p.combo, kept = Math.floor((p.combo * m.insurance) / 100);
  if (kept < before && (p.ironLeft ?? 0) > 0) { p.ironLeft--; return false; }
  p.combo = kept;
  // 리바운드: 끊긴 뒤 잠깐 점수 보너스 (레전드는 끊긴 콤보 절반을 되찾을 수 있음)
  if (byOther && p.combo < before && m.rebound > 0) { p.reboundUntil = now + AUG.reboundMs; p.reboundLost = before - p.combo; p.reboundUsed = false; }
  return p.combo < before;
}

/** 점수 구역: 0 중앙 ×1, 1 사이 ×2, 2 가장자리 ×3 */
export type ZoneIndex = 0 | 1 | 2;

/** 이 점이 어느 점수 구역인지 (화면 비율에 맞춘 타원) */
export function zoneOf(p: { x: number; y: number }): ZoneIndex {
  const e = Math.hypot((p.x - FIELD.w / 2) / (FIELD.w / 2), (p.y - FIELD.h / 2) / (FIELD.h / 2));
  const [b0, b1] = RULES.zones.bounds;
  return e < b0 ? 0 : e < b1 ? 1 : 2;
}

/** 구역 배율. 찰나의 순간 증강은 가장자리 배율을 올린다 */
export const zoneMult = (zone: ZoneIndex, m: Mods) =>
  (RULES.zones.mult[zone] + (m.chaser ? SPECIAL.chaserAdd : 0) + (zone === 2 ? m.edge : 0)) * (zone === 0 ? 1 + m.centerKing / 100 : 1);

export const isFever = (p: PlayerState, now: number) => now < p.feverUntil;
export const isStunned = (p: PlayerState, now: number) => now < p.stunUntil;
export const isMarked = (p: PlayerState, now: number) => now < p.markedUntil;

/** 원의 위치는 발사 정보와 시각만으로 결정된다. 그래서 서버는 생성 정보만 보내면 된다. */
export function circlePos(c: Circle, t: number) {
  // 역발사: 같은 방향의 화면 가장자리에서 출발해 중앙으로
  const d = c.rev ? edgeDist(c) - traveled(c, t) : traveled(c, t);
  const x = FIELD.w / 2 + Math.cos(c.angle) * d, y = FIELD.h / 2 + Math.sin(c.angle) * d;
  // 이동형 보스·황금 원: 화면 가장자리에서 튕긴다 (직선 경로를 화면 안으로 접어서 계산)
  if (c.boss === 'runner' || c.kind === 'gold') return { x: fold(x, c.r, FIELD.w - c.r), y: fold(y, c.r, FIELD.h - c.r) };
  return { x, y };
}

/** v를 [lo, hi] 사이에서 벽에 튕기는 것처럼 접는다 */
function fold(v: number, lo: number, hi: number) {
  const L = hi - lo;
  const u = (((v - lo) % (2 * L)) + 2 * L) % (2 * L);
  return lo + (u <= L ? u : 2 * L - u);
}

/** 출발 후 움직인 거리 */
function traveled(c: Circle, t: number) {
  let el = Math.max(0, t - c.born);
  // 시간 정지: 멈춘 구간과 겹친 시간만큼 덜 움직인다
  for (const [from, ms] of c.holds ?? []) el -= Math.max(0, Math.min(t, from + ms) - Math.max(c.born, from));
  return (c.speed * Math.max(0, el)) / 1000;
}

/** 중앙에서 그 방향으로 원이 화면 밖에 완전히 나가는 거리 */
function edgeDist(c: Circle) {
  const cx = Math.abs(Math.cos(c.angle)), sy = Math.abs(Math.sin(c.angle));
  return Math.min(cx ? (FIELD.w / 2 + c.r) / cx : Infinity, sy ? (FIELD.h / 2 + c.r) / sy : Infinity);
}

export function isOut(c: Circle, t: number) {
  // 역발사 원은 중앙에 닿으면 사라진다
  if (c.rev) return traveled(c, t) >= edgeDist(c);
  // 이동형 보스는 튕기므로 화면 밖으로 안 나간다: 정해진 시간만큼 움직이면 도망
  if (c.boss === 'runner') return traveled(c, t) >= c.speed * RULES.boss.lifeSec;
  // 황금 원도 튕기므로 정해진 시간만큼 움직이면 사라진다 (시간 정지만큼 늘어남)
  if (c.kind === 'gold') return traveled(c, t) >= c.speed * RULES.gold.lifeSec;
  const p = circlePos(c, t);
  return p.x < -c.r || p.x > FIELD.w + c.r || p.y < -c.r || p.y > FIELD.h + c.r;
}

/** 발사 보호 구역 안에 있는지 (잡을 수 없는 상태) */
export function isGuarded(c: Circle, t: number) {
  const p = circlePos(c, t);
  return Math.hypot(p.x - FIELD.w / 2, p.y - FIELD.h / 2) < RULES.spawnGuardR;
}

/** pad: 원 둘레 바깥으로 인정하는 여유(필드 단위). 넓은 손·자석은 이 값을 늘려서 판정한다. 발사 보호 구역 안의 원은 안 맞는다 */
export function isHit(c: Circle, t: number, x: number, y: number, pad: number = RULES.hitPad) {
  if (isGuarded(c, t)) return false;
  const p = circlePos(c, t);
  const rr = c.r + pad;
  return (p.x - x) ** 2 + (p.y - y) ** 2 <= rr * rr;
}

/** 지금부터 lagMs 전까지 25ms 간격으로 살펴 한 번이라도 맞았는지 (지연 보정) */
export function hitWithin(c: Circle, now: number, x: number, y: number, pad: number, lagMs: number) {
  for (let t = now; t >= now - lagMs; t -= 25) if (isHit(c, t, x, y, pad)) return true;
  return false;
}

/** 내 원: 내 색, 노란색, 무지개. 넓은 손·자석·장판은 내 원만 잡는다 */
export function isMine(kind: CircleKind, color: ColorIndex) {
  return typeof kind === 'number' ? kind === color : kind === 'y' || kind === 'rainbow';
}

/** 넓은 손 범위 클릭으로 같이 잡히는 내 원 전부. lagMs: 지연 보정 (서버와 같게 하려면 RULES.lagWindowMs) */
export function rangeTargets(
  circles: Iterable<Circle>, color: ColorIndex, x: number, y: number, t: number,
  reach: number, skip?: ReadonlySet<number>, lagMs = 0,
): Circle[] {
  if (reach <= 0) return [];
  return [...circles].filter((c) => isMine(c.kind, color) && !skip?.has(c.id) && hitWithin(c, t, x, y, RULES.hitPad + reach, lagMs));
}

/** 경과 시간에 따른 원 생성 간격(ms) */
export function spawnInterval(elapsedMs: number, G: GameRules) {
  const prog = Math.min(1, elapsedMs / G.roundMs);
  const S = RULES.spawn;
  let iv = Math.max(S.gapMin, S.gapStart - prog * S.gapDrop);
  if (elapsedMs > G.roundMs - RULES.finalRushMs) iv *= 0.75;
  return iv / G.density;
}

/** 원 생성 옵션: 아이템 원 확률, 색 고정(내 색 비·전원 같은 색), 확률 덮어쓰기(라운드 테마) */
export interface SpawnOpts {
  itemChance?: number;
  forceKind?: CircleKind;
  yellowChance?: number;
  rainbowChance?: number;
}

/** kinds: 이번 판에 참가한 색 목록(주인 없는 색은 나오지 않음) */
export function makeCircle(id: number, now: number, elapsedMs: number, kinds: ColorIndex[], G: GameRules, rand = Math.random, opts: SpawnOpts = {}): Circle {
  const prog = Math.min(1, elapsedMs / G.roundMs);
  const rush = elapsedMs > G.roundMs - RULES.finalRushMs ? 1.25 : 1;
  const item = rand() < (opts.itemChance ?? 0);
  const rainbow = opts.rainbowChance ?? G.rainbowChance;
  const roll = rand();
  let kind: CircleKind;
  if (item) kind = 'item';
  else if (opts.forceKind !== undefined) kind = opts.forceKind;
  else if (roll < rainbow) kind = 'rainbow';
  else if (roll < rainbow + (opts.yellowChance ?? RULES.yellowChance)) kind = 'y';
  else kind = kinds[Math.floor(rand() * kinds.length)];
  const c: Circle = {
    id,
    kind,
    angle: rand() * Math.PI * 2,
    speed: (RULES.spawn.speedStart + prog * RULES.spawn.speedGain + rand() * RULES.spawn.speedRand) * rush * G.speed * RULES.launchSpeed,
    r: 40 * (0.85 + rand() * 0.3),
    born: now,
  };
  if (item) { c.r = RULES.items.r; c.itemTier = rollItemTier(rand); }
  return c;
}

/** 황금 원: 중앙에서 무작위 방향으로 (게임 속도 배율 안 받음) */
export function makeGold(id: number, now: number, rand = Math.random): Circle {
  return { id, kind: 'gold', angle: rand() * Math.PI * 2, speed: RULES.gold.speed, r: RULES.gold.r, born: now };
}

/** 이번 판 황금 원이 나오는 시점(판 시작 후 ms), 오름차순 */
export function goldTimes(roundMs: number, rand = Math.random): number[] {
  const G = RULES.gold;
  let r = rand() * G.countOdds.reduce((a, b) => a + b, 0), n = G.countOdds.length;
  for (let i = 0; i < G.countOdds.length; i++) { r -= G.countOdds[i]; if (r < 0) { n = i + 1; break; } }
  const lo = G.startMs, hi = Math.max(lo, roundMs - G.endMs);
  return Array.from({ length: n }, () => lo + rand() * (hi - lo)).sort((a, b) => a - b);
}

function rollItemTier(rand: () => number): 0 | 1 | 2 {
  const odds = RULES.items.tierOdds;
  let r = rand() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) return i as 0 | 1 | 2; }
  return 0;
}

/** 보스가 나오는 시점(판 시작 후 ms). 마지막 10초에 한 번은 꼭 나온다 */
export function bossTimes(G: GameRules, theme?: ThemeId | null): number[] {
  if (!G.boss) return [];
  const L = G.roundMs, last = L - 9_000;
  if (theme === 'bossRush') return RULES.themes.bossRushAt.map((f) => L * f);
  return L >= 60_000 ? [L * 0.3, L * 0.62, last] : [last];
}

/** angle: 여러 마리가 함께 나올 때 서로 다른 방향으로 보내려고 지정 */
export function makeBoss(id: number, now: number, playerCount: number, G: GameRules, rand = Math.random, type: BossType = 'normal', angle = rand() * Math.PI * 2): Circle {
  const B = RULES.boss;
  if (type === 'runner') {
    const hp = Math.ceil(B.hpPerPlayer * playerCount * B.runnerHpRate);
    return { id, kind: 'boss', boss: type, angle, speed: B.runnerSpeed * G.speed, r: B.runnerR, born: now, hp, maxHp: hp };
  }
  // 어느 방향으로 가도 lifeSec 만에 화면 밖으로 나가도록 속도를 맞춘다
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const dist = Math.min(c ? (FIELD.w / 2 + B.r) / c : Infinity, s ? (FIELD.h / 2 + B.r) / s : Infinity);
  const hp = B.hpPerPlayer * playerCount;
  return { id, kind: 'boss', boss: type, angle, speed: (dist / B.lifeSec) * G.speed, r: B.r, born: now, hp, maxHp: hp };
}

export function rollBossType(rand = Math.random): BossType {
  const odds = Object.entries(RULES.boss.typeOdds) as [BossType, number][];
  let r = rand() * odds.reduce((a, [, w]) => a + w, 0);
  for (const [type, w] of odds) { r -= w; if (r < 0) return type; }
  return 'normal';
}

/** 이번에 나올 보스 수. alive: 이미 화면에 있는 보스 수 (합쳐서 maxAlive를 넘지 않음) */
export function rollBossCount(alive: number, theme: ThemeId | null | undefined, rand = Math.random, chaos = false) {
  const room = RULES.boss.maxAlive - alive;
  if (room <= 0) return 0;
  let n: number;
  if (theme === 'bossRush') n = rand() < 0.5 ? 2 : 3;
  else {
    let r = rand() * 100;
    n = 1;
    const odds = chaos ? RULES.chaos.bossCountOdds : RULES.boss.countOdds;
    for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) { n = i + 1; break; } }
  }
  return Math.min(n, room);
}

/** 보스의 지금 상태: 방어형 보호막, 공격형 붉어짐 (태어난 뒤 시간으로 정해져 서버·화면이 같다) */
export function bossState(c: Circle, t: number) {
  const B = RULES.boss;
  const el = Math.max(0, t - c.born);
  return {
    shielded: c.boss === 'guard' && el % B.guardCycleMs >= B.guardCycleMs - B.guardOnMs,
    enraged: c.boss === 'rage' && el % B.rageCycleMs >= B.rageCycleMs - B.rageOnMs,
  };
}

/** 붉은 공격형 보스를 때렸을 때 잃는 점수 (라운드 안에서 때릴수록 커짐) */
export function ragePenalty(p: PlayerState) {
  p.rageHits++;
  return RULES.boss.ragePenaltyStep * p.rageHits;
}

/** 보스 점수에 붙는 배율 */
export function bossMult(p: PlayerState, now: number, G: GameRules) {
  return isFever(p, now) ? Math.min(feverMultOf(p, G), RULES.boss.feverMultCap) : 1;
}

/** 보스를 한 번 때렸을 때: 피해, 타격 점수(배율 전), 막타 점수(배율 전) */
export function bossHitInfo(p: PlayerState, rand = Math.random) {
  const m = modsOf(p.picks);
  // 막타 독식: 피해·막타 점수 ×2
  const feast = m.bossFeast ? SPECIAL.feastMult : 1;
  // 해머 레전드: 15% 확률로 3타, 그다음 보스 헌터 조합 피해 +1
  let dmg = bossDamage(m, rand);
  if (hasLegend(p, 'hammer') && rand() < LEGEND.hammerChance) dmg = Math.max(dmg, LEGEND.hammerDmg);
  if (combosOf(p.picks).has('bossHunter')) dmg += COMBO.bossDmgAdd;
  return { damage: dmg * feast, hit: RULES.boss.hit + m.hammer, kill: (RULES.boss.kill + m.hunter) * feast, boost: scoreBoostOf(m) };
}

/** 꼴찌인지 (동점이면 모두 꼴찌가 아님) */
export function isLast(p: PlayerState, players: PlayerState[]) {
  const min = Math.min(...players.map((x) => x.score));
  return p.score === min && players.some((x) => x.score > min);
}

/**
 * 피버 게이지 증감. 가득 차면 피버 시작 후 true 반환. 피버 중에는 변화 없음.
 * raw: 충전 속도 보정 없이 그대로 (피버 충전 아이템)
 */
export function addFever(p: PlayerState, amt: number, now: number, G: GameRules, players: PlayerState[], raw = false): boolean {
  if (isFever(p, now)) return false;
  const m = modsOf(p.picks);
  // 보험 레전드: 피버 게이지가 깎이지 않음
  if (amt < 0 && hasLegend(p, 'insurance')) return false;
  if (amt > 0 && !raw) amt *= G.feverGain * (1 + m.overcharge / 100) * (G.comeback && isLast(p, players) ? RULES.comebackGain : 1) / (m.berserker ? CURSE.berserker.gainDiv : 1);
  p.fever = Math.max(0, Math.min(100, p.fever + amt));
  if (p.fever >= 100) {
    burstFever(p, now, G, m, players);
    return true;
  }
  return false;
}

/** 게임 중 피버가 터질 때: 피버 시작과 방해 전파 (라운드 시작 피버에는 방해 전파 없음) */
function burstFever(p: PlayerState, now: number, G: GameRules, m: Mods, players: PlayerState[]) {
  startFever(p, now, G, m);
  // 방해 전파: 다른 사람 화면의 원을 흐리게
  if (m.jammer) for (const o of players) if (o !== p) o.blurUntil = Math.max(o.blurUntil, now + m.jammer);
  // 방해 전파 레전드: 상대 커서 감도 감소 (철벽 제외)
  if (hasLegend(p, 'jammer')) for (const o of players) if (o !== p && !modsOf(o.picks).fortress) addDebuff(o, 'slow', LEGEND.jammerSlowMs, now);
}

/** 콤보가 before에서 after로 오르며 every의 배수를 넘었는지 (한 번에 여러 칸 올라도 놓치지 않음) */
export const crossedCombo = (before: number, after: number, every: number) =>
  after > before && Math.floor(after / every) > Math.floor(before / every);

/**
 * 원을 가져갔을 때의 결과를 계산하고 플레이어 상태를 바꾼다.
 * - 피버 중: 노란 원은 내 색 취급, 남의 색은 페널티 없는 견제
 * - 평상시 견제: +1, 내 콤보 끊김, 피버 감소, 표적이 됨
 * - 표적인 사람의 색: 반격 보너스
 */
export function resolveClaim(
  claimer: PlayerState, kind: CircleKind, players: PlayerState[], now: number, G: GameRules,
  opts: { via?: ClaimVia; rand?: () => number; zone?: ZoneIndex } = {},
): ClaimResult {
  const via = opts.via ?? 'click';
  const blast = via === 'blast';
  const fever = isFever(claimer, now);
  const after = !fever && now < claimer.afterUntil;
  settleFever(claimer, now);
  const m = modsOf(claimer.picks);
  const L = legendOf(claimer.picks);
  const K = combosOf(claimer.picks);
  // 속사 레전드: 이전 획득까지 쌓인 '다음 잭팟 확정' (이번 획득으로 새로 생긴 것은 다음 원에)
  const rapidForced = claimer.rapidJackpot;
  const comboBefore = claimer.combo;
  const P = RULES.points;
  const res: ClaimResult = { type: 'own', gained: 0, comboBonus: false, feverStarted: false, brokeComboOf: null, marked: false, plundered: 0, shielded: false, via, jackpot: 1, zone: 0 };
  let pts = 0;
  let steal = false;

  // 외길: 내 색 ×3, 노란색·무지개 0점
  const own = (P.own + m.picky) * (m.oneWay ? CURSE.oneWay.ownMult : 1);
  if (kind === 'rainbow') {
    res.type = 'rainbow'; pts = m.oneWay ? 0 : P.rainbow + m.rainbowHunt; claimer.combo++;
    // 무지개 사냥 레전드: 즉시 피버
    if (L.has('rainbowHunt') && !fever) { burstFever(claimer, now, G, m, players); res.feverStarted = true; }
    else res.feverStarted = addFever(claimer, RULES.fever.rainbow, now, G, players);
  } else if (kind === 'y' && !fever && buffOn(claimer, 'paint', now)) {
    // 물들이기: 노란 원을 내 색으로 계산 (외길이면 그대로 0점)
    res.type = 'own'; pts = m.oneWay ? 0 : P.own + m.picky + m.yellowTaste; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own, now, G, players);
  } else if (kind === 'y' && fever) {
    res.type = 'own'; pts = m.oneWay ? 0 : P.own + m.picky + m.yellowTaste; claimer.combo++;
  } else if (kind === 'y') {
    // 미식가 조합: 편식가의 노란색 −1 대가 없음
    res.type = 'yellow'; pts = m.oneWay ? 0 : Math.max(0, P.yellow + m.yellowTaste - (m.picky && !K.has('gourmet') ? 1 : 0)); claimer.combo++;
    // 노란 맛 레전드: 피버 게이지가 내 색만큼
    res.feverStarted = addFever(claimer, L.has('yellowTaste') ? RULES.fever.own : RULES.fever.yellow, now, G, players);
  } else if (kind === claimer.color || (typeof kind === 'number' && m.allHands)) {
    // 만능 손: 남의 색 원도 내 색처럼 (견제 판정 없음). 편식가 레전드: 피버 게이지 2배
    res.type = 'own'; pts = own; claimer.combo++;
    res.feverStarted = addFever(claimer, RULES.fever.own * (L.has('picky') ? LEGEND.pickyFeverMult : 1), now, G, players);
  } else {
    steal = true;
    const owner = players.find((p) => p.color === kind);
    if (blast) {
      // 폭죽·필드 클리어: 남의 색도 +1만, 견제 페널티·표적·반격·강탈 없음
      res.type = 'feverSteal'; pts = P.stealCalm;
    } else if (owner && (owner.reflectLeft > 0 || hasLegend(owner, 'reflect')) && !isMarked(owner, now)) {
      // 견제 반사: 원은 주인이 잡은 것으로, 견제한 사람은 0점·콤보 끊김·표적 (반격은 반사하지 않음). 레전드는 횟수 제한 없음
      if (!hasLegend(owner, 'reflect')) owner.reflectLeft--;
      res.type = 'steal'; res.reflectedTo = owner.id;
      res.reflected = resolveClaim(owner, kind, players, now, G, opts);
      breakCombo(claimer, m, now);
      const markMs = m.thickSkin >= 99 ? 0 : G.markMs - m.thickSkin * 1000;
      if (markMs > 0) { claimer.markedUntil = now + markMs; res.marked = true; }
      return res;
    } else {
      if (owner && isMarked(owner, now)) {
        res.type = 'counter'; pts = P.counter + m.counterPro;
        // 반격 전문가 레전드: 반격하면 피버 게이지
        if (L.has('counterPro')) res.feverStarted = addFever(claimer, LEGEND.counterFever, now, G, players, true);
      } else if (fever || !G.stealPenalty) {
        res.type = 'feverSteal'; pts = P.stealCalm;
      } else {
        res.type = 'steal'; pts = P.stealCalm;
        breakCombo(claimer, m, now);
        // 철면피 레전드: 견제해도 피버 게이지가 안 깎임
        if (!L.has('thickSkin')) addFever(claimer, RULES.fever.stealCalm, now, G, players);
        // 철면피: 표적 시간 감소 (99 이상이면 표적 안 됨)
        const markMs = m.thickSkin >= 99 ? 0 : G.markMs - m.thickSkin * 1000;
        if (markMs > 0) { claimer.markedUntil = now + markMs; res.marked = true; }
      }
      // 보호막 아이템·철벽 특별 카드: 콤보 끊김·강탈을 막는다
      const guarded = !!owner && (buffOn(owner, 'guard', now) || !!modsOf(owner.picks).fortress);
      if (owner && owner.combo > 0) {
        // 보호막 아이템이 먼저 막는다 (방패 횟수는 그대로)
        if (guarded) res.shielded = true;
        else if (owner.shieldLeft > 0) { owner.shieldLeft--; res.shielded = true; }
        else if (breakCombo(owner, modsOf(owner.picks), now, true)) res.brokeComboOf = owner.id;
      }
      // 강탈·흡혈귀: 상대 점수를 빼앗음 (배율 없음). 흡혈귀를 가진 사람은 견제당할 때도 빼앗긴다
      if (owner && res.type !== 'counter') {
        // 강탈 레전드: 1등을 견제하면 2배
        const top = owner.score >= Math.max(...players.map((x) => x.score));
        const plunder = m.plunder * (L.has('plunder') && top ? LEGEND.plunderTopMult : 1);
        // 보호막·철벽은 강탈과 견제한 사람의 흡혈을 막는다 (견제당한 사람 자신의 흡혈 저주 대가는 그대로)
        const take = (guarded ? 0 : plunder + (m.vampire ? CURSE.vampire.drain : 0)) + (modsOf(owner.picks).vampire ? CURSE.vampire.drain : 0);
        res.plundered = Math.min(take, owner.score);
        owner.score -= res.plundered;
        // 방패 레전드: 견제당하면 견제한 사람 점수를 빼앗음
        if (hasLegend(owner, 'shield')) {
          const d = Math.min(LEGEND.shieldDrain, claimer.score);
          claimer.score -= d; owner.score += d; res.drained = d;
        }
      }
      // 도발: 상대 피버 게이지 감소, 레전드면 피버 중인 상대의 피버 단축 (보호막·철벽은 안 걸림)
      if (owner && m.taunt && !guarded) {
        if (!isFever(owner, now)) owner.fever = Math.max(0, owner.fever - m.taunt);
        else if (L.has('taunt')) shiftFeverEnd(owner, -Math.min(LEGEND.tauntMs, owner.feverUntil - now));
      }
    }
  }

  // 견제왕 조합: 견제할 때마다 +2 (폭죽·필드 클리어 제외)
  if (steal && !blast && K.has('stealKing')) pts += COMBO.stealAdd;
  res.zone = opts.zone ?? 0;
  if (!steal) {
    // 찰나의 순간·중앙의 왕 레전드: 그 구역에서 잡으면 콤보 +1 더
    if ((res.zone === 2 && L.has('edge')) || (res.zone === 0 && L.has('centerKing'))) claimer.combo += LEGEND.zoneComboAdd;
    // 연장전 레전드: 피버 중 잡을 때마다 피버 시간 연장
    if (fever && L.has('overtime')) shiftFeverEnd(claimer, LEGEND.overtimeMs);
    // 리바운드 레전드: 창 안 첫 획득에 끊긴 콤보 절반을 되찾음
    if (now < claimer.reboundUntil && L.has('rebound') && !claimer.reboundUsed) {
      claimer.combo += Math.floor(claimer.reboundLost / 2); claimer.reboundUsed = true;
    }
    // 속사: 짧은 간격으로 연달아 잡으면 보너스, 레전드는 5연속에 다음 잭팟 확정 (자동 획득·폭죽은 세지 않음)
    if (via === 'click' || via === 'save') {
      claimer.rapidStreak = now - claimer.lastClaimAt <= AUG.rapidMs ? claimer.rapidStreak + 1 : 1;
      claimer.lastClaimAt = now;
      if (claimer.rapidStreak >= 2) pts += m.rapid;
      if (L.has('rapid') && claimer.rapidStreak >= LEGEND.rapidStreak) { claimer.rapidJackpot = true; claimer.rapidStreak = 0; }
    }
  }
  // 기세: 콤보 보너스가 더 자주. 콤보 장인 레전드 +10, 폭주 레전드는 피버 중 2배
  const every = m.momentum ? Math.min(SPECIAL.momentumEvery, comboPeriod(m.comboArtist)) : comboPeriod(m.comboArtist);
  if (!steal && crossedCombo(comboBefore, claimer.combo, every)) {
    res.comboBonus = true;
    pts += (RULES.comboBonus + (L.has('comboArtist') ? LEGEND.comboBonusAdd : 0) + (K.has('comboMachine') ? COMBO.comboBonusAdd : 0)) * (fever && L.has('frenzy') ? LEGEND.frenzyComboMult : 1);
  }
  const st = claimer.stats;
  st.hits++;
  if (!blast && (res.type === 'steal' || res.type === 'feverSteal')) st.steals++;
  if (res.type === 'counter') st.counters++;
  if (res.feverStarted) st.fevers++;
  st.maxCombo = Math.max(st.maxCombo, claimer.combo);
  claimer.roundMaxCombo = Math.max(claimer.roundMaxCombo, claimer.combo);
  // 피버 시작 직후의 원은 배율 미적용(시작 시점 기준). 점수 구역 배율도 곱한다
  const rebound = now < claimer.reboundUntil ? 1 + m.rebound / 100 : 1;
  const viaLegend = (via === 'range' && L.has('wideHand')) ? LEGEND.wideHandMult : (via === 'save' && L.has('missSave')) ? LEGEND.missSaveMult : 1;
  const mult = (fever ? feverMultOf(claimer, G) : after ? afterMultOf(claimer) : 1) * scoreBoostOf(m) * itemMult(claimer, now, true, !blast && pts > 0)
    * zoneMult(res.zone, m) * extraMult(claimer, now, players) * rebound * viaLegend;
  // 잭팟은 맨 마지막에 곱한다 (블라스트는 없음). 속사 레전드면 이번 잭팟 확정
  if (!blast) {
    const forced = rapidForced && pts > 0;
    if (forced) claimer.rapidJackpot = false;
    res.jackpot = jackpotMult(forced ? { ...m, jackpot: 100 } : luckyMods(claimer, m), opts.rand, L.has('jackpot'));
  }
  res.gained = Math.round(pts * mult * res.jackpot) + res.plundered;
  claimer.score += res.gained;
  return res;
}

/** 빈 공간 클릭 */
export function resolveMiss(p: PlayerState, now: number, G: GameRules, players: PlayerState[]) {
  p.stats.misses++;
  const m = modsOf(p.picks);
  // 헛클릭 무효 아이템이 먼저 막는다 (유리 대포 감점은 아래에서 그대로 적용)
  if (G.missPenalty && !buffOn(p, 'missGuard', now)) {
    breakCombo(p, m, now);
    addFever(p, RULES.fever.miss, now, G, players);
  }
  // 유리 대포: 빈 곳 클릭 감점 (저주의 대가라서 방 규칙과 상관없이 적용)
  if (m.glassCannon) p.score = Math.max(0, p.score - CURSE.glassCannon.missPenalty);
}

export function ranking(players: PlayerState[]) {
  return [...players].sort((a, b) => b.score - a.score);
}

// ---------- 결과 화면 칭호 ----------

export interface Title {
  playerId: string;
  name: string;
  desc: string;
}

/**
 * 한 판 기록으로 칭호를 준다. 칭호마다 한 명(동점이면 점수가 높은 사람).
 * 조건을 넘는 사람이 없으면 그 칭호는 없다.
 */
export function awardTitles(players: PlayerState[]): Title[] {
  const out: Title[] = [];
  const pick = (name: string, value: (p: PlayerState) => number, min: number, desc: (v: number) => string) => {
    let best: PlayerState | null = null, bv = -Infinity;
    for (const p of players) {
      const v = value(p);
      if (v >= min && (v > bv || (v === bv && best && p.score > best.score))) { best = p; bv = v; }
    }
    if (best) out.push({ playerId: best.id, name, desc: desc(bv) });
  };
  pick('막타 장인', (p) => p.stats.bossKills, 1, (v) => `보스 막타 ${v}번`);
  pick('견제왕', (p) => p.stats.steals + p.stats.counters, 3, (v) => `견제·반격 ${v}번`);
  pick('피버 머신', (p) => p.stats.fevers, 2, (v) => `피버 ${v}번`);
  pick('콤보 마스터', (p) => p.stats.maxCombo, 10, (v) => `최대 ${v}콤보`);
  pick('정밀 사격', (p) => (p.stats.hits >= 15 ? Math.round((p.stats.hits / (p.stats.hits + p.stats.misses)) * 100) : -1), 85, (v) => `명중률 ${v}%`);
  // 평화주의자: 견제 0번이면서 열심히 한 사람
  const peace = players.filter((p) => p.stats.steals + p.stats.counters === 0 && p.stats.hits >= 10).sort((a, b) => b.score - a.score)[0];
  if (peace) out.push({ playerId: peace.id, name: '평화주의자', desc: '견제 0번' });
  return out;
}
