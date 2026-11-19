/**
 * Canvas 그리기. 필드 좌표(1600x900)를 화면 크기에 맞춰 확대해서 그린다.
 * 나중에 Phaser/PixiJS로 바꾸려면 이 파일만 교체하면 된다.
 */
import {
  COLORS, COOP_BOSSES, FIELD, RULES, YELLOW, auraAt, barSegment, beamAngles, bossState, circlePos, fogAt, isGuarded, lensWarp, moverAt, ringE, shotGone, shotPos, vortexAlive, vortexWarned,
  type Volley, type BlindKind, type BossType, type Circle, type CircleKind, type SpecialKind, type ColorIndex, type MapPattern, safeZoneAt, type Slam, type SafeZones, type Seal, type Beam, type Homing, homingAlpha, homingRule } from '@color-burst/shared';

import { COOP_SPECIALS, attackSpecialRule, type CoopSpecialAttack, type CoopWard } from '@color-burst/shared';

/** 시드로 같은 모양을 다시 만드는 난수 (시야 방해 모양이 재접속해도 같게) */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 보스 종류별 몸통 색 [밝은 곳, 가운데, 가장자리] */
const BOSS_BODY: Record<BossType, [string, string, string]> = {
  normal: ['#fff7cf', '#ffc23a', '#c47a00'],
  guard: ['#e8f4ff', '#6fa8dc', '#2b5c8a'],
  rage: ['#fff0d6', '#ff9f43', '#b35400'],
  runner: ['#d6fff6', '#2ec4b6', '#0b6e66'],
  raid: ['#f3e0ff', '#9b5de5', '#4a1d7a'],
};
const RAGE_BODY: [string, string, string] = ['#ffd0d0', '#ff4d4d', '#8a0000'];

/** 보스 처치 타격감: 멈칫(히트스톱), 흔들림 */
export const BOSS_HITSTOP_MS = 80;
export const BOSS_SHAKE = { sec: 0.2, amp: 8 } as const;
/** 협력전 처치 연출의 진행 시각. 결과창은 전체 연출 뒤에 표시한다. */
export const COOP_DEFEAT = { whiteMs: 2200, burstMs: 2500, clearMs: 3000, totalMs: 4000 } as const;
/** 피버 중 원이 터질 때 파편 배율 */
export const FEVER_BURST = 1.5;
/**
 * 점수 글자 단계 (증강 등급처럼): 1 흰색 평소 / 2 파랑 콤보 보너스·반격 / 3 보라 피버 / 4 노랑 잭팟·황금 원 / 5 프리즘 잭팟 ×3·보스 막타.
 * 4단계부터 튀어 오르며 등장, 5단계는 무지개가 흐르는 글자 + 금빛 테두리 + 파편
 */
export type ScoreTier = 1 | 2 | 3 | 4 | 5;
const SCORE_TIER: Record<ScoreTier, { col: string; size: number }> = {
  1: { col: '#ffffff', size: 1 },
  2: { col: '#4d9bff', size: 1.2 },
  3: { col: '#b26cff', size: 1.35 },
  4: { col: '#ffd43b', size: 1.6 },
  5: { col: '#ffd43b', size: 2 },
};
/** 배너: 화면 가운데보다 살짝 위, 보이는 시간(초) */
/** 보스 처치 배너 높이: 판 중앙에서 220 위 (화면 문구와 안 겹치게) */
const BANNER_Y = FIELD.h / 2 - 220, BANNER_LIFE = 1.2;

type BasicKind = Exclude<CircleKind, 'boss' | 'item' | 'threat' | 'crystal' | SpecialKind>;
const GOLD_TRAIL = [40, 80, 120];

type Fx =
  /** r0 → r1로 퍼지는 링 (기본 28 → 73) */
  | { type: 'ring'; x: number; y: number; col: string; t: number; life: number; r0?: number; r1?: number; w?: number }
  /** g: 중력(동전 파편), round: 동그란 입자 */
  | { type: 'spark'; x: number; y: number; vx: number; vy: number; col: string; t: number; life: number; g?: number; size?: number; round?: boolean }
  | { type: 'miss'; x: number; y: number; t: number; life: number }
  | { type: 'text'; x: number; y: number; txt: string; col: string; size: number; t: number; life: number; pop?: boolean; prism?: boolean }
  | { type: 'banner'; txt: string; col: string; t: number; life: number }
  /** 자석 끌림 선 */
  | { type: 'line'; x: number; y: number; x1: number; y1: number; col: string; t: number; life: number }
  /** 화면 전체 번쩍임 */
  | { type: 'flash'; t: number; life: number }
  /** 폭탄 원 십자 폭발: 중심에서 가로·세로 판 끝까지 뻗는 빛줄기 (w: 줄 굵기) */
  | { type: 'cross'; x: number; y: number; w: number; t: number; life: number };

/** 한 번에 화면에 있을 수 있는 효과 수. 넘으면 새 파티클은 버린다 (링·글자는 유지) */
const MAX_FX = 400;
const SKY = '#7fd3ff';
const GOLD = '#ffd166';
const ITEM_TIER_COLOR = ['#ffffff', '#4d9bff'] as const;
/** 협력전 ? 원 테두리 */
const COOP_ITEM_COLOR = '#5ce1e6';
const PRISM = ['#ff5d73', '#ffb347', '#ffd43b', '#51cf66', '#4dabf7', '#b26cff'];

const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; // 테스트(node)에서는 matchMedia가 없다
let reduceMotion = prefersReduced;
/** 설정의 '화면 효과 줄이기' (흔들림, 파티클 끔). 운영체제 설정이 켜져 있으면 항상 줄인다 */
export function setReduceFx(on: boolean) { reduceMotion = prefersReduced || on; }

export interface DrawState {
  specials?: { attacks: readonly CoopSpecialAttack[]; to: { x: number; y: number } };
  /** 협력전이면 가운데 보호 구역 점선을 안 그린다 */
  coop?: boolean;
  /** 협력전 보호막이 올라와 있음 (판 테두리가 붉게 맥동, 보스가 떨림) */
  coopShield?: boolean;
  /** 협력전 단계 (보스 테두리 색) */
  coopPhase?: 1 | 2 | 3;
  circles: Iterable<Circle>;
  hidden: Set<number>;
  myColor: ColorIndex | null;
  myFever: boolean;
  /** 색 → 표적 여부 */
  markedColors: Set<number>;
  now: number;
  /** 협력전 폭딜 반격 발동 시각 (발동 뒤 잠깐 화면이 붉게 번쩍인다, 0이면 없음) */
  counterFireAt?: number;
  /** 폭딜 반격 예고 중 (보스가 붉게 맥동) */
  counterWarn?: boolean;
  /** 방해 전파를 맞아 원이 흐려 보이는 중 */
  /** 장판 (color: 주인 색) */
  zones?: { x: number; y: number; r: number; until: number; color: ColorIndex }[];
  /** 시간 정지 중 */
  frozen?: boolean;
  /** 게임 커서 (내 커서만): 스턴이면 회색, 넓은 손·자석 범위 */
  /** barrier: 우클릭 보호막 남은 비율 1→0 (0이면 꺼짐) */
  /** frost: 얼어 가는 정도 0→1, iced: 얼음 원에 얼어붙은 중 */
  cursor?: { x: number; y: number; stunned: boolean; reach: number; magnet: number; barrier?: number; frost?: number; iced?: boolean } | null;
  /** 레이저: at 전에는 경고선, at부터 fireMs 동안 빛줄기 */
  lasers?: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number }[];
  /** 시야 방해: 종류·시드·끝나는 시각 */
  blind?: { kind: BlindKind; seed: number; until: number } | null;
  /** 내 커서가 이동형 보스 오오라 안 (오오라를 더 진하게) */
  myAura?: boolean;
  /** 자석에 끌려가는 원: from에서 to(내가 끌면 내 커서, 남이면 null → 제자리에서 작아짐)로 */
  pulls?: Map<number, { from: { x: number; y: number }; to: { x: number; y: number } | null; at: number; ms: number }>;
  /** 맵 패턴 (경고 중이면 반투명 미리보기), 사라진 가시 공 번호 */
  pattern?: MapPattern | null;
  popped?: ReadonlySet<number>;
  /** 내 커서가 갇힌 소용돌이 번호 (없으면 −1) */
  trapped?: number;
  /** 협력전: 사람 id → 색 (공격 원 표적 테두리), 내 id */
  colorOf?: ReadonlyMap<string, ColorIndex>;
  meId?: string;
  /** 협력전: 내려찍기 경고, 안전지대 */
  slams?: readonly Slam[];
  safe?: SafeZones | null;
  /** 협력전: 구역 봉인, 회전 빔(보스 중심 from에서) */
  seal?: Seal | null;
  beam?: { b: Beam; from: { x: number; y: number } } | null;
  /** 협력전 엑스퍼트 유도탄 (예고는 보스 중심 from에서), still이면 외삽하지 않음(일시정지 화면) */
  homing?: { h: Homing; from: { x: number; y: number }; still: boolean } | null;
  /** 협력전: 탄막 (원보다 위, 수정보다 아래) */
  volleys?: readonly Volley[];
  /** 협력전 보스 약점 노출 종료 시각 */
  coopWeakUntil?: number;
  coopRampageUntil?: number;
  coopBindUntil?: number;
  coopWards?: readonly CoopWard[];
  /** 협력전 미사일: from에서 to(보스)로 곡선 비행, at에 닿는다 (flyMs 동안 날아감) */
  missiles?: { list: readonly { from: { x: number; y: number }; at: number; side: number }[]; to: { x: number; y: number }; flyMs: number } | null;
}

export class Renderer {
  private coopDefeat: { x: number; y: number; r: number; at: number; exploded: boolean; onExplosion: () => void } | null = null;
  /** 레이저 맞는 거리 (빔 폭의 절반, 방 규칙 레이저 두께) */
  laserHalf: number = RULES.laser.width;
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0;
  private scale = 1; private ox = 0; private oy = 0;
  private fx: Fx[] = [];
  private shake = 0;
  private shakeAmp = 8;
  /** 히트스톱: 이 시각(performance.now)까지 원·보스 위치 계산 시각을 멈춘다 */
  private stopUntil = 0;
  private stopNow: number | null = null;
  private last = performance.now();
  /** 보스 원 id → 마지막으로 맞은 시각 (흔들림 연출) */
  private bossPoked = new Map<number, number>();
  /** 렌즈 시야 방해 중이면 물체 위치·크기를 휘는 함수 */
  private warp: ((p: { x: number; y: number }, size: number) => { x: number; y: number; size: number }) | null = null;
  /** 저격당함: 이 시각까지 붉은 조준선 */
  private snipeUntil = 0;
  /** 웨이브 예고: 이 시각까지 중앙 원이 밝게 번쩍인다 */
  private warnUntil = 0;
  /** 순서대로 터질 폭발 (폭죽·필드 클리어 연쇄) */
  private delayed: { at: number; x: number; y: number; col: string }[] = [];

  constructor(private cv: HTMLCanvasElement, stage: HTMLElement) {
    this.ctx = cv.getContext('2d')!;
    new ResizeObserver(() => this.resize(stage)).observe(stage);
    this.resize(stage);
  }

  private resize(stage: HTMLElement) {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.W / FIELD.w, this.H / FIELD.h);
    this.ox = (this.W - FIELD.w * this.scale) / 2;
    this.oy = (this.H - FIELD.h * this.scale) / 2;
  }

  /** 필드 좌표 → #stage 기준 화면 좌표 (DOM 연출 위치) */
  toScreen(x: number, y: number) {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }

  /** 파티클은 상한을 넘으면 버린다 */
  private add(f: Fx) {
    if (f.type === 'spark' && this.fx.length >= MAX_FX) return;
    this.fx.push(f);
  }
  private sparks(x: number, y: number, col: string, n: number, speed = 240, extra: Partial<Extract<Fx, { type: 'spark' }>> = {}) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * speed;
      this.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, col, t: 0, life: 0.4 + Math.random() * 0.2, ...extra });
    }
  }

  /** 화면 좌표 → 필드 좌표 */
  toField(clientX: number, clientY: number) {
    const r = this.cv.getBoundingClientRect();
    return { x: (clientX - r.left - this.ox) / this.scale, y: (clientY - r.top - this.oy) / this.scale };
  }

  /** scale: 파편 수 배율 (피버 중 1.5) */
  burst(x: number, y: number, col: string, big: boolean, scale = 1) {
    this.add({ type: 'ring', x, y, col, t: 0, life: 0.35 });
    this.sparks(x, y, col, Math.round((big ? 10 : 5) * scale));
  }
  /** 히트스톱: ms 동안 원·보스가 멈칫 (파편·글자는 계속). 효과 줄이기면 없음 */
  hitstop(ms: number) {
    if (reduceMotion) return;
    this.stopUntil = performance.now() + ms; this.stopNow = null;
  }
  /** 화면 흔들림: sec초 동안 amp만큼. 효과 줄이기면 없음 */
  shakeFor(sec: number, amp: number) {
    if (reduceMotion) return;
    if (this.shake <= 0 || amp >= this.shakeAmp) this.shakeAmp = amp;
    this.shake = Math.max(this.shake, sec);
  }
  /** 큰 배너 글자: 화면 가운데보다 살짝 위, 커지며 등장 */
  banner(txt: string, col: string) {
    this.fx = this.fx.filter((f) => f.type !== 'banner');
    this.fx.push({ type: 'banner', txt, col, t: 0, life: BANNER_LIFE });
  }
  /** delayMs 뒤에 터진다 (연쇄 폭발) */
  burstDelayed(x: number, y: number, col: string, delayMs: number) {
    this.delayed.push({ at: performance.now() + delayMs, x, y, col });
  }
  /** 넓은 손: 클릭 지점에서 범위만큼 하늘색 링 */
  preciseRing(x: number, y: number) {
    this.add({ type: 'ring', x, y, col: '#fff', t: 0, life: 0.3, r0: 7, r1: 17, w: 2 });
    this.add({ type: 'ring', x, y, col: SKY, t: 0, life: 0.3, r0: 15, r1: 29, w: 2 });
  }

  reachRing(x: number, y: number, r: number) { this.add({ type: 'ring', x, y, col: SKY, t: 0, life: 0.25, r0: 4, r1: r + 12, w: 3 }); }
  /** 자석: 클릭 지점 → 잡힌 원 */
  pullLine(x0: number, y0: number, x1: number, y1: number) { this.add({ type: 'line', x: x0, y: y0, x1, y1, col: SKY, t: 0, life: 0.22 }); }
  /** 충격파 (폭죽·필드 클리어). 효과 줄이기여도 링은 그린다 */
  /** 협력전: 잡은 원에서 보스로 날아가는 빛줄기 */
  beam(x0: number, y0: number, x1: number, y1: number, col: string) { this.add({ type: 'line', x: x0, y: y0, x1, y1, col, t: 0, life: 0.3 }); }
  shockwave(x: number, y: number, R: number) { this.add({ type: 'ring', x, y, col: '#fff', t: 0, life: 0.35, r0: 10, r1: R, w: 6 }); }
  /** 얼음 원 폭발: 하늘색 서리 고리. 효과 줄이기면 고리만 */
  iceBurst(x: number, y: number) {
    this.add({ type: 'ring', x, y, col: '#a5e4ff', t: 0, life: 0.5, r0: 20, r1: 220, w: 8 });
    if (!reduceMotion) this.sparks(x, y, '#e3f7ff', 14, 300);
  }
  /** 분열 원: 짧은 번쩍임 + 파편 조각. 효과 줄이기면 고리만 */
  splitBurst(x: number, y: number) {
    this.add({ type: 'ring', x, y, col: '#e4e7ef', t: 0, life: 0.25, r0: 10, r1: 70, w: 5 });
    if (!reduceMotion) this.sparks(x, y, '#c8ccd8', 10, 260);
  }
  /** 폭탄 원 십자 폭발. 효과 줄이기면 번쩍임·파편 없이 빛줄기만 */
  crossBlast(x: number, y: number, w: number) {
    this.add({ type: 'cross', x, y, w, t: 0, life: 0.45 });
    if (!reduceMotion) { this.add({ type: 'ring', x, y, col: '#ffb347', t: 0, life: 0.3, r0: 10, r1: 90, w: 6 }); this.sparks(x, y, '#ffcf70', 10, 360); }
  }
  crystalFailure() {
    const x = FIELD.w / 2, y = FIELD.h / 2;
    const r = Math.hypot(x, y);
    this.add({ type: 'ring', x, y, col: '#ff8a76', t: 0, life: 0.4, r0: reduceMotion ? x * 0.75 : 25, r1: reduceMotion ? x * 0.75 : r, w: 6 });
    if (!reduceMotion) this.sparks(x, y, '#ffb09f', 12, 420);
  }

  flash() { if (!reduceMotion) this.add({ type: 'flash', t: 0, life: 0.12 }); }
  /** 저격당함: 화면 가운데 붉은 조준선이 좁혀든다 */
  snipe() { this.snipeUntil = performance.now() + 600; }
  /** 웨이브 예고: 중앙 원이 ms 동안 밝게 (효과 줄이기면 링만) */
  waveWarn(ms: number) {
    this.add({ type: 'ring', x: FIELD.w / 2, y: FIELD.h / 2, col: '#fff', t: 0, life: ms / 1000, r0: 110, r1: 40, w: 4 });
    if (!reduceMotion) this.warnUntil = performance.now() + ms;
  }
  /** 잭팟: 배율이 클수록 크게, 보스면 한 단계 더 */
  jackpot(x: number, y: number, mult: number, boss: boolean) {
    const k = boss ? 1.5 : 1;
    const n = (mult >= 3 ? 24 : mult >= 2 ? 16 : 8) * k;
    this.sparks(x, y, GOLD, n, 320 * k);
    if (mult >= 2) this.add({ type: 'ring', x, y, col: GOLD, t: 0, life: 0.45, r0: 20, r1: 120 * k, w: 5 });
    if (mult >= 3) {
      this.sparks(x, y, GOLD, 14 * k, 380, { g: 900, size: 9, round: true, life: 0.9 });
      this.flash();
    }
  }
  bossPoke(id: number) { this.bossPoked.set(id, performance.now()); }

  startCoopDefeat(origin: { x: number; y: number; r: number }, onExplosion: () => void) {
    this.fx = []; this.delayed = []; this.shake = 0; this.stopUntil = 0;
    this.coopDefeat = { ...origin, at: performance.now(), exploded: false, onExplosion };
  }

  stopCoopDefeat() {
    if (this.coopDefeat) { this.fx = []; this.delayed = []; this.shake = 0; }
    this.coopDefeat = null;
  }

  text(x: number, y: number, txt: string, col: string, size = 1) { this.fx.push({ type: 'text', x, y, txt, col, size, t: 0, life: 0.8 }); }
  /** 점수 글자: 단계에 따라 색·크기·등장 연출 (base: 자리에 맞춘 기본 크기) */
  scoreText(x: number, y: number, txt: string, tier: ScoreTier, base = 1) {
    const T = SCORE_TIER[tier];
    this.fx.push({ type: 'text', x, y, txt, col: T.col, size: T.size * base, t: 0, life: tier >= 4 ? 1.1 : 0.8, pop: tier >= 4, prism: tier === 5 });
    if (tier === 5) this.sparks(x, y - 20, GOLD, 12, 260);
  }
  /** 빈 곳 클릭: 회색 X만 (흔들림 없음) */
  miss(x: number, y: number, soft = false) {
    this.fx.push({ type: 'miss', x, y, t: 0, life: soft ? 0.2 : 0.35 });
  }

  draw(s: DrawState) {
    const now = performance.now();
    // 히트스톱 중에는 원·보스·레이저가 멈춘 시각으로 그려진다
    if (now < this.stopUntil) { this.stopNow ??= s.now; s = { ...s, now: this.stopNow }; } else this.stopNow = null;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    for (const f of this.fx) {
      f.t += dt;
      if (f.type === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy = f.vy * 0.92 + (f.g ?? 0) * dt; }
    }
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= now);
      this.delayed = this.delayed.filter((d) => d.at > now);
      for (const d of due) this.burst(d.x, d.y, d.col, false);
    }
    this.fx = this.fx.filter((f) => f.t < f.life);
    if (this.shake > 0) this.shake -= dt;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shakeAmp, (Math.random() - 0.5) * this.shakeAmp);
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    const cx = FIELD.w / 2, cy = FIELD.h / 2;
    const pulse = 1 + Math.sin(now / 180) * 0.08;
    const warn = Math.max(0, (this.warnUntil - now) / RULES.waves.warnMs);
    ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.4 * warn * Math.abs(Math.sin(now / 60))})`;
    ctx.beginPath(); ctx.arc(cx, cy, 70 * pulse * (1 + warn * 0.3), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.myFever ? 'rgba(255,159,28,.8)' : 'rgba(255,255,255,.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.stroke();
    // 발사 보호 구역: 이 안의 원은 아직 잡을 수 없다
    if (!s.coop) {
      ctx.setLineDash([6, 8]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.arc(cx, cy, RULES.spawnGuardR, 0, Math.PI * 2); ctx.stroke();
    }
    // 점수 구역 경계: 사이(×2)·가장자리(×3)가 시작되는 동심원
    RULES.zones.bounds.forEach((b, i) => {
      ctx.setLineDash([4, 12]); ctx.lineWidth = 2; ctx.strokeStyle = `rgba(126, 224, 255, ${i ? 0.2 : 0.14})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, cx * b, cy * b, 0, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.setLineDash([]);

    for (const z of s.zones ?? []) this.drawZone(z, s.now);
    for (const ward of s.coopWards ?? []) this.drawCoopWard(ward, s.now);


    // 방해 전파: 원을 흐리고 옅게 / 시간 정지: 채도를 낮춘다
    const filters = s.frozen ? ['saturate(0.25)'] : [];
    if (filters.length) ctx.filter = filters.join(' ');
    // 보스를 먼저 그려서 작은 원이 위에 보이게
    const list = [...s.circles].filter((c) => !s.hidden.has(c.id));
    for (const l of s.lasers ?? []) this.drawLaser(l, s.now, now);
    if (s.safe) this.drawSafe(s.safe, s.now);
    if (s.seal) this.drawSeal(s.seal, s.now, now);
    if (s.beam) this.drawBeam(s.beam.b, s.beam.from, s.now, now);
    if (s.homing) this.drawHoming(s.homing.h, s.homing.from, s.homing.still, s, now);
    for (const sl of s.slams ?? []) this.drawSlam(sl, s.now, s);
    if (s.pattern) this.drawPattern(s.pattern, s.popped ?? new Set(), s.now, now, s.trapped ?? -1);
    const base = ctx.globalAlpha;
    // 발사 보호 구역 안의 원은 반투명 (아직 잡을 수 없음)
    const fade = (c: Circle) => { ctx.globalAlpha = isGuarded(c, s.now) ? base * 0.4 : base; };
    // 렌즈: 원·보스·아이템 원의 위치와 크기만 휜다 (클릭 판정은 그대로)
    const lens = s.blind?.kind === 'lens' ? s.blind : null;
    this.warp = lens ? (p, size) => lensWarp(p, size, lens.seed % 2 === 0) : null;
    for (const c of list) {
      const a = auraAt(c, s.now);
      if (a) this.drawAura(a, !!s.myAura, now);
    }
    for (const c of list) if (c.kind === 'boss') { fade(c); this.drawBoss(c, s.now, now, s); }
    // 수정은 탄막 위에 그린다
    const crystals: { c: Circle; x: number; y: number; r: number }[] = [];
    for (const c of list) {
      if (c.kind === 'boss') continue;
      let p = circlePos(c, s.now), r = c.r;
      // 자석에 끌려가는 원: 끄는 사람 커서 쪽으로 빨려 들며 작아진다
      const pl = s.pulls?.get(c.id);
      if (pl) {
        const k = Math.max(0, Math.min(1, (s.now - pl.at) / pl.ms)), e = k * k;
        const to = pl.to ?? pl.from;
        p = { x: pl.from.x + (to.x - pl.from.x) * e, y: pl.from.y + (to.y - pl.from.y) * e };
        r = c.r * (1 - 0.6 * k);
      }
      if (this.warp) { const w = this.warp(p, r); p = w; r = w.size; }
      fade(c);
      if (c.kind === 'gold' && !this.warp) this.drawGoldTrail(c, s.now);
      if (c.kind === 'item') this.drawItem(c, p.x, p.y, now, r);
      else if (c.kind === 'bomb') this.drawBomb(p.x, p.y, now, r);
      else if (c.kind === 'ice') this.drawIce(p.x, p.y, now, r);
      else if (c.kind === 'split') this.drawSplit(p.x, p.y, now, r);
      else if (c.kind === 'threat') this.drawThreat(c, p.x, p.y, r, s);
      else if (c.kind === 'crystal') crystals.push({ c, x: p.x, y: p.y, r });
      else {
        this.drawCircle(c.kind, p.x, p.y, r, (s.now - c.born) / 700 + c.id, s);
        if (c.splitBy) this.drawPieceEdge(c, p.x, p.y, r);
      }
    }
    ctx.globalAlpha = base;
    if (s.missiles?.list.length) this.drawMissiles(s.missiles, s.now);
    if (s.specials) this.drawSpecials(s.specials.attacks, s.specials.to, s.now);
    if (s.volleys?.length) this.drawBullets(s.volleys, s.now, now);
    for (const k of crystals) { fade(k.c); this.drawCrystal(k.c, k.x, k.y, k.r, s); }
    ctx.globalAlpha = base;
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // 보호막 중: 판 테두리가 0.5초 주기로 붉게 맥동 (맥동은 효과 줄이기에도 남는다)
    if (s.coopShield) {
      const k = 0.5 + 0.5 * Math.sin((now / 500) * Math.PI * 2);
      ctx.lineWidth = 10; ctx.strokeStyle = `rgba(255, 45, 61, ${0.25 + 0.55 * k})`;
      ctx.strokeRect(5, 5, FIELD.w - 10, FIELD.h - 10);
    }
    // 안개는 원 위에 덮는다
    if (s.pattern?.id === 'fog' && s.now >= s.pattern.warnAt && s.now < s.pattern.until) this.drawFog(s.pattern, s.now);
    if (s.frozen) for (const c of list) if (c.holds?.some(([a, ms]) => s.now >= a && s.now < a + ms)) this.drawClock(circlePos(c, s.now), c.r, now);

    for (const f of this.fx) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.type === 'ring') {
        const r0 = f.r0 ?? 28, r1 = f.r1 ?? 73;
        ctx.strokeStyle = f.col; ctx.lineWidth = f.w ?? 4; ctx.beginPath(); ctx.arc(f.x, f.y, r0 + k * (r1 - r0), 0, Math.PI * 2); ctx.stroke();
      }
      if (f.type === 'spark') {
        const z = f.size ?? 6;
        ctx.fillStyle = f.col;
        if (f.round) { ctx.beginPath(); ctx.arc(f.x, f.y, z / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(f.x - z / 2, f.y - z / 2, z, z);
      }
      if (f.type === 'line') {
        // 원 쪽으로 살짝 휘는 곡선
        const mx = (f.x + f.x1) / 2 + (f.y1 - f.y) * 0.2, my = (f.y + f.y1) / 2 - (f.x1 - f.x) * 0.2;
        ctx.strokeStyle = f.col; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.quadraticCurveTo(mx, my, f.x1, f.y1); ctx.stroke();
      }
      if (f.type === 'cross') {
        // 처음 0.2초에 판 끝까지 뻗고, 나머지 시간 동안 가늘어지며 사라진다
        const reach = Math.min(1, f.t / 0.2), fadeK = Math.max(0, (f.t - 0.2) / (f.life - 0.2));
        const L = Math.max(FIELD.w, FIELD.h) * reach, w = f.w * (1 - 0.6 * fadeK);
        ctx.globalAlpha = 0.85 * (1 - fadeK);
        ctx.fillStyle = '#ffe3a3';
        ctx.fillRect(f.x - L, f.y - w / 2, L * 2, w);
        ctx.fillRect(f.x - w / 2, f.y - L, w, L * 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(f.x - L, f.y - w / 6, L * 2, w / 3);
        ctx.fillRect(f.x - w / 6, f.y - L, w / 3, L * 2);
      }
      if (f.type === 'flash') { ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.55 * (1 - k); ctx.fillRect(0, 0, FIELD.w, FIELD.h); }
      if (f.type === 'miss') { ctx.strokeStyle = '#9ca2d6'; ctx.lineWidth = 3; const m = 12; ctx.beginPath(); ctx.moveTo(f.x - m, f.y - m); ctx.lineTo(f.x + m, f.y + m); ctx.moveTo(f.x + m, f.y - m); ctx.lineTo(f.x - m, f.y + m); ctx.stroke(); }
      if (f.type === 'text') {
        ctx.globalAlpha = 1 - k * k;
        // 튀어 오름: 처음 0.15초 동안 작게 → 크게 → 제자리 (효과 줄이기면 없음)
        const pop = f.pop && !reduceMotion ? (f.t < 0.08 ? 0.6 + (f.t / 0.08) * 0.6 : f.t < 0.15 ? 1.2 - ((f.t - 0.08) / 0.07) * 0.2 : 1) : 1;
        const px = Math.round(28 * f.size * pop);
        ctx.font = `${px}px 'Black Han Sans', sans-serif`; ctx.textAlign = 'center';
        const ty = f.y - k * 45;
        if (f.prism) {
          // 무지개가 글자 안에서 흐른다 + 금빛 테두리
          const w = ctx.measureText(f.txt).width, sh = ((now / 6) % (w * 2)) - w;
          const g = ctx.createLinearGradient(f.x - w / 2 + sh, 0, f.x + w / 2 + sh, 0);
          PRISM.forEach((c, i) => g.addColorStop(i / (PRISM.length - 1), c));
          ctx.lineWidth = Math.max(3, px / 9); ctx.lineJoin = 'round'; ctx.strokeStyle = GOLD;
          ctx.strokeText(f.txt, f.x, ty);
          ctx.fillStyle = g;
        } else ctx.fillStyle = f.col;
        ctx.fillText(f.txt, f.x, ty);
      }
      if (f.type === 'banner') {
        const grow = Math.min(1, f.t / 0.15);
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `${Math.round(28 * 2.2 * (0.6 + 0.4 * grow))}px 'Black Han Sans', sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(8, 9, 22, .85)'; ctx.lineJoin = 'round';
        ctx.strokeText(f.txt, FIELD.w / 2, BANNER_Y, FIELD.w - 80);
        ctx.fillStyle = f.col; ctx.fillText(f.txt, FIELD.w / 2, BANNER_Y, FIELD.w - 80);
      }
      ctx.globalAlpha = 1;
    }
    if (s.blind && s.blind.kind !== 'lens') this.drawBlind(s.blind, s.now);
    if (now < this.snipeUntil && !reduceMotion) this.drawSnipe(1 - (this.snipeUntil - now) / 600);
    if (s.cursor) this.drawCursor(s.cursor, now);
    if (s.counterFireAt) this.drawCounterFlash(s.counterFireAt, s.now);
    if (this.coopDefeat) this.drawCoopDefeat(now);
    this.drawFieldEdge(s.myFever, now);
    ctx.restore();
  }

  /** 폭딜 반격: 발동 뒤 400ms 동안 화면 전체가 붉게 덮였다 흐려진다 (효과 줄이기는 테두리만) */
  private drawCounterFlash(fireAt: number, now: number) {
    const k = (now - fireAt) / 400;
    if (k < 0 || k >= 1) return;
    const ctx = this.ctx;
    ctx.save();
    if (reduceMotion) {
      ctx.strokeStyle = `rgba(255, 70, 90, ${0.9 * (1 - k)})`; ctx.lineWidth = 16;
      ctx.strokeRect(0, 0, FIELD.w, FIELD.h);
    } else {
      ctx.fillStyle = `rgba(255, 50, 70, ${0.45 * (1 - k)})`;
      ctx.fillRect(0, 0, FIELD.w, FIELD.h);
    }
    ctx.restore();
  }

  private drawCoopDefeat(now: number) {
    const d = this.coopDefeat!;
    const elapsed = now - d.at, ctx = this.ctx;
    if (elapsed >= COOP_DEFEAT.burstMs && !d.exploded) {
      d.exploded = true;
      if (!reduceMotion) {
        this.shakeFor(0.2, 7);
        this.burst(d.x, d.y, '#ffd166', true, 2.5);
        this.shockwave(d.x, d.y, 360);
      }
      d.onExplosion();
    }
    ctx.save();
    ctx.fillStyle = 'rgba(8, 9, 22, .45)'; ctx.fillRect(0, 0, FIELD.w, FIELD.h);
    if (elapsed < COOP_DEFEAT.burstMs) {
      const white = Math.min(1, elapsed / COOP_DEFEAT.whiteMs);
      const r = d.r * (reduceMotion ? 1 : 1 + white * 0.08);
      ctx.save(); ctx.translate(d.x, d.y);
      if (!reduceMotion) {
        const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * (1.3 + white));
        glow.addColorStop(0, `rgba(255, 244, 205, ${white * 0.7})`);
        glow.addColorStop(1, 'rgba(255, 244, 205, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, r * (1.3 + white), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = reduceMotion ? 1 - Math.max(0, (elapsed - COOP_DEFEAT.whiteMs) / (COOP_DEFEAT.burstMs - COOP_DEFEAT.whiteMs)) : 1;
      const body = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      BOSS_BODY.raid.forEach((color, i) => body.addColorStop(i / 2, color));
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      this.bossEmblem('raid', r, false);
      ctx.fillStyle = `rgba(255, 255, 255, ${white * white})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (elapsed >= COOP_DEFEAT.burstMs && !reduceMotion) {
      const explosion = Math.min(1, (elapsed - COOP_DEFEAT.burstMs) / 650);
      ctx.globalAlpha = 1 - explosion;
      ctx.strokeStyle = '#fff4c2'; ctx.lineWidth = 12 * (1 - explosion) + 2;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r + explosion * 400, 0, Math.PI * 2); ctx.stroke();
    }
    if (elapsed >= COOP_DEFEAT.clearMs) {
      ctx.globalAlpha = Math.min(1, (elapsed - COOP_DEFEAT.clearMs) / 500);
      ctx.font = "88px 'Black Han Sans', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = '#161323';
      ctx.strokeText('CLEAR', FIELD.w / 2, FIELD.h * 0.55);
      ctx.fillStyle = '#ffd166'; ctx.fillText('CLEAR', FIELD.w / 2, FIELD.h * 0.55);
    }
    ctx.restore();
  }

  /** 판 밖 여백은 어둡게, 판 테두리는 밝게 (내 피버 중이면 주황으로 맥동) */
  private drawFieldEdge(fever: boolean, frameNow: number) {
    const ctx = this.ctx, big = 4000;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.rect(-big, -big, FIELD.w + big * 2, FIELD.h + big * 2); ctx.roundRect(0, 0, FIELD.w, FIELD.h, 18); ctx.fill('evenodd');
    const pulse = fever && !reduceMotion ? 0.5 + 0.5 * Math.sin(frameNow / 160) : 0;
    ctx.strokeStyle = fever ? (pulse > 0.5 ? '#ff4d2e' : '#ff9f1c') : 'rgba(255,255,255,.35)';
    ctx.lineWidth = fever ? 5 + pulse * 2 : 3;
    ctx.shadowColor = fever ? '#ff9f1c' : 'rgba(150,170,255,.5)'; ctx.shadowBlur = fever ? 24 : 10;
    ctx.beginPath(); ctx.roundRect(0, 0, FIELD.w, FIELD.h, 18); ctx.stroke();
    ctx.restore();
  }

  private drawBoss(c: Circle, t: number, frameNow: number, s?: DrawState) {
    const ctx = this.ctx;
    let { x, y } = circlePos(c, t);
    let size = c.r;
    if (this.warp) { const w = this.warp({ x, y }, c.r); x = w.x; y = w.y; size = w.size; }
    const poked = frameNow - (this.bossPoked.get(c.id) ?? -1e9);
    if (poked < 120 && !reduceMotion) { x += (Math.random() - 0.5) * 10; y += (Math.random() - 0.5) * 10; }
    // 보호막 중에는 보스가 떨린다 (효과 줄이기면 안 떨림)
    if (s?.coopShield && !reduceMotion) { x += Math.sin(frameNow / 24) * 4; y += Math.cos(frameNow / 31) * 3; }
    const r = size * (poked < 120 ? 0.96 : 1);
    const frac = (c.hp ?? 0) / (c.maxHp ?? 1);
    const low = frac <= 0.2;
    const type = c.boss ?? 'normal';
    const st = bossState(c, t);
    const rampaging = c.boss === 'raid' && t < (s?.coopRampageUntil ?? 0);

    ctx.save();
    ctx.translate(x, y);
    // 몸통 (붉은 공격형은 빨갛게)
    const [c0, c1, c2] = st.enraged || rampaging ? RAGE_BODY : BOSS_BODY[type];
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    // 보호막 중: 붉은 빛 (효과 줄이기면 없음). 테두리까지만 번지고 바로 끈다
    const glow = !!s?.coopShield && !reduceMotion;
    if (glow) { ctx.shadowColor = 'rgba(255, 45, 61, .9)'; ctx.shadowBlur = 36; }
    // 폭딜 반격 예고: 붉게 맥동 (효과 줄이기는 고정 빛)
    else if (s?.counterWarn && c.boss === 'raid') {
      const k = reduceMotion ? 0.7 : 0.4 + 0.6 * Math.abs(Math.sin(frameNow / 110));
      ctx.shadowColor = `rgba(255, 40, 60, ${k})`; ctx.shadowBlur = 20 + 30 * k;
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = s?.coop && s.coopPhase ? 7 : 4; ctx.strokeStyle = st.enraged || rampaging ? '#ff4d4d' : s?.coop && s.coopPhase ? COOP_BOSSES.core.rims[s.coopPhase - 1] : '#fff'; ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    this.bossEmblem(type, r, st.enraged);
    // 체력 숫자
    ctx.fillStyle = 'rgba(30,20,10,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(r * 0.55)}px 'Black Han Sans', sans-serif`;
    // 레이드 보스는 피해가 소수(봇·콤보 보너스)라 올림해서 보인다
    ctx.fillText(String(Math.ceil(c.hp ?? 0)), 0, r * 0.12);
    // 체력 링
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.arc(0, 0, r + 14, 0, Math.PI * 2); ctx.stroke();
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(frameNow / 90)) : 1;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = low ? '#ff5d73' : '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.globalAlpha = 1;
    // 약점 노출 상태는 보스 바깥 테두리에 표시한다.
    if (c.boss === 'raid' && !s?.coopShield && t < (s?.coopWeakUntil ?? 0)) {
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = '#ffd43b';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, r + 26, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (c.boss === 'raid' && t < (s?.coopBindUntil ?? 0)) {
      ctx.save();
      ctx.strokeStyle = COOP_SPECIALS.bind.color;
      ctx.lineWidth = 5;
      for (const y of [-0.32, 0.32]) {
        ctx.beginPath(); ctx.ellipse(0, r * y, r + 10, r * 0.22, -0.26, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    // 방어형 보호막: 밝은 하늘색 육각 테두리 (이때는 피해가 안 들어감)
    if (st.shielded) {
      ctx.lineWidth = 6; ctx.strokeStyle = `rgba(127, 211, 255, ${0.6 + 0.4 * Math.abs(Math.sin(frameNow / 120))})`;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const a = (Math.PI / 3) * i + frameNow / 900; ctx.lineTo(Math.cos(a) * (r + 26), Math.sin(a) * (r + 26)); }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 미사일: 잡은 자리에서 보스로 휘어 날아가는 작은 탄과 꼬리 */
  private drawMissiles(m: NonNullable<DrawState['missiles']>, t: number) {
    const ctx = this.ctx;
    const at = (q: (typeof m.list)[number], k: number) => {
      // 2차 곡선: 가운데 조절점을 옆으로 밀어 휘게 한다
      const mx = (q.from.x + m.to.x) / 2, my = (q.from.y + m.to.y) / 2;
      const dx = m.to.x - q.from.x, dy = m.to.y - q.from.y, L = Math.hypot(dx, dy) || 1;
      const cx = mx + (-dy / L) * L * 0.35 * q.side, cy = my + (dx / L) * L * 0.35 * q.side;
      const u = 1 - k;
      return { x: u * u * q.from.x + 2 * u * k * cx + k * k * m.to.x, y: u * u * q.from.y + 2 * u * k * cy + k * k * m.to.y };
    };
    ctx.save();
    for (const q of m.list) {
      const k = (t - (q.at - m.flyMs)) / m.flyMs;
      if (k < 0 || k >= 1) continue;
      ctx.strokeStyle = 'rgba(255, 180, 80, .55)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let j = 0; j <= 6; j++) { const p = at(q, Math.max(0, k - 0.12 + 0.02 * j)); if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke();
      const p = at(q, k);
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** 보스 종류 무늬: 일반 왕관, 방어형 방패, 공격형 성난 눈, 이동형 화살표 */
  private bossEmblem(type: BossType, r: number, enraged: boolean) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(30,20,10,.5)'; ctx.strokeStyle = 'rgba(30,20,10,.55)';
    ctx.beginPath();
    const top = -r * 0.62;
    if (type === 'normal') {
      const w = r * 0.55, h = r * 0.32;
      ctx.moveTo(-w, top + h); ctx.lineTo(-w, top); ctx.lineTo(-w / 2, top + h * 0.55); ctx.lineTo(0, top - h * 0.1);
      ctx.lineTo(w / 2, top + h * 0.55); ctx.lineTo(w, top); ctx.lineTo(w, top + h); ctx.closePath(); ctx.fill();
    } else if (type === 'guard') {
      const w = r * 0.32, h = r * 0.42;
      ctx.moveTo(-w, top); ctx.lineTo(w, top); ctx.lineTo(w, top + h * 0.5); ctx.quadraticCurveTo(w, top + h, 0, top + h * 1.15);
      ctx.quadraticCurveTo(-w, top + h, -w, top + h * 0.5); ctx.closePath(); ctx.fill();
    } else if (type === 'rage') {
      // 성난 눈썹 두 개 (붉으면 더 진하게)
      ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
      if (enraged) ctx.strokeStyle = 'rgba(60,0,0,.85)';
      ctx.moveTo(-r * 0.45, top); ctx.lineTo(-r * 0.12, top + r * 0.2);
      ctx.moveTo(r * 0.45, top); ctx.lineTo(r * 0.12, top + r * 0.2); ctx.stroke();
    } else {
      // 겹화살표
      ctx.lineWidth = r * 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const dx of [-r * 0.18, r * 0.12]) { ctx.moveTo(dx - r * 0.12, top - r * 0.05); ctx.lineTo(dx + r * 0.08, top + r * 0.12); ctx.lineTo(dx - r * 0.12, top + r * 0.29); }
      ctx.stroke();
    }
  }

  /** 레이저: 발사 전에는 깜빡이는 빨간 점선, 발사 중에는 굵은 빛줄기와 흰 심지 */
  /** 레이저 볼리: 예고 중에는 맞는 범위(빔 폭)를 반투명 띠 + 가운데 점선으로, 발사 중에는 붉은 띠 + 흰 심 */
  private drawLaser(v: NonNullable<DrawState['lasers']>[number], t: number, frameNow: number) {
    const ctx = this.ctx;
    const fire = RULES.laser.fireMs, W = this.laserHalf * 2;
    if (t >= v.at + fire) return;
    const line = (l: { a: { x: number; y: number }; b: { x: number; y: number } }) => { ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke(); };
    ctx.save();
    ctx.lineCap = 'butt';
    if (t < v.at) {
      const pulse = Math.abs(Math.sin(frameNow / 80));
      ctx.strokeStyle = `rgba(255, 60, 60, ${0.1 + 0.12 * pulse})`; ctx.lineWidth = W;
      v.lines.forEach(line);
      ctx.setLineDash([14, 10]); ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255, 77, 77, ${0.35 + 0.35 * pulse})`;
      v.lines.forEach(line);
    } else {
      const k = 1 - (t - v.at) / fire;
      ctx.strokeStyle = `rgba(255, 60, 60, ${0.55 * k + 0.2})`; ctx.lineWidth = W;
      v.lines.forEach(line);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * k + 0.1})`; ctx.lineWidth = 14;
      v.lines.forEach(line);
    }
    ctx.restore();
  }

  /** 내 게임 커서: 흰 십자 고리 (스턴이면 회색 + 도는 별), 넓은 손 범위(실선)·자석 범위(점선) */
  /** 맵 패턴: 경고 중에는 반투명 미리보기, 나와 있으면 실제 모양. 사라지기 직전 0.5초는 흐려진다 */
  private drawPattern(p: MapPattern, popped: ReadonlySet<number>, t: number, frameNow: number, trapped = -1) {
    if (t < p.warnAt || t >= p.until) return;
    const ctx = this.ctx, R = RULES.patterns;
    const warn = t < p.at;
    const tt = warn ? p.at : t;
    const fade = warn ? 0.25 + 0.15 * Math.abs(Math.sin(frameNow / 120)) : Math.min(1, (p.until - t) / 500);
    ctx.save();
    ctx.globalAlpha = fade;
    if (p.id === 'walls') {
      for (const w of p.walls ?? []) {
        ctx.fillStyle = '#5a6078'; ctx.strokeStyle = '#c5cae9'; ctx.lineWidth = 3;
        ctx.fillRect(w.x, w.y, w.w, w.h); ctx.strokeRect(w.x, w.y, w.w, w.h);
        // 벽돌 줄무늬
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.beginPath();
        const horiz = w.w > w.h, step = 40;
        for (let k = step; k < (horiz ? w.w : w.h); k += step) {
          if (horiz) { ctx.moveTo(w.x + k, w.y); ctx.lineTo(w.x + k, w.y + w.h); } else { ctx.moveTo(w.x, w.y + k); ctx.lineTo(w.x + w.w, w.y + k); }
        }
        ctx.stroke();
      }
    } else if (p.id === 'spikes') {
      const r = R.spikes.r;
      (p.balls ?? []).forEach((b, i) => {
        if (popped.has(i)) return;
        const q = moverAt(b, p.at, tt, r);
        const spin = reduceMotion ? 0 : frameNow / 300;
        ctx.fillStyle = '#ff5d73'; ctx.strokeStyle = '#ffd1d8'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = spin + (k / 16) * Math.PI * 2, rr = k % 2 ? r * 0.72 : r * 1.25;
          ctx[k ? 'lineTo' : 'moveTo'](q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
    } else if (p.id === 'bar') {
      const sg = barSegment(p, tt);
      ctx.strokeStyle = '#aeb6d6'; ctx.lineCap = 'round'; ctx.lineWidth = R.bar.thick;
      ctx.beginPath(); ctx.moveTo(sg.a.x, sg.a.y); ctx.lineTo(sg.b.x, sg.b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sg.a.x, sg.a.y); ctx.lineTo(sg.b.x, sg.b.y); ctx.stroke();
    } else if (p.id === 'vortex' && p.vortices) {
      // 나와 있는 것은 진하게, 생기기 전(경고)은 깜빡이는 반투명. 바깥 점선 = 끌림 구역, 안쪽 실선 = 눈 (갇히면 밝게)
      const alive = new Set(vortexAlive(p, t)), warned = new Set(vortexWarned(p, t));
      const pulse = 0.25 + 0.15 * Math.abs(Math.sin(frameNow / 120));
      const spin = reduceMotion ? 0 : frameNow / 400;
      p.vortices.forEach((v, i) => {
        if (!alive.has(i) && !warned.has(i) && !(warn && i === 0)) return;
        ctx.globalAlpha = alive.has(i) ? fade : pulse;
        ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 3;
        for (let arm = 0; arm < 3; arm++) {
          ctx.beginPath();
          for (let k = 0; k <= 40; k++) {
            const f = k / 40, a = spin + arm * (Math.PI * 2 / 3) + f * Math.PI * 3, rr = f * R.vortex.eye;
            ctx[k ? 'lineTo' : 'moveTo'](v.x + Math.cos(a) * rr, v.y + Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        ctx.setLineDash([10, 12]); ctx.beginPath(); ctx.arc(v.x, v.y, R.vortex.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        const caught = trapped === i;
        ctx.strokeStyle = caught ? '#ffd43b' : '#d4bcff'; ctx.lineWidth = caught ? 6 : 4;
        if (caught && !reduceMotion) { ctx.shadowColor = '#ffd43b'; ctx.shadowBlur = 18; }
        ctx.beginPath(); ctx.arc(v.x, v.y, R.vortex.eye, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
      });
    } else if (p.id === 'ring') {
      // 안전 구역 밖(위험 구역)을 붉게
      const e = ringE(p, tt), cx = FIELD.w / 2, cy = FIELD.h / 2;
      ctx.fillStyle = 'rgba(255,60,90,.28)';
      ctx.beginPath(); ctx.rect(0, 0, FIELD.w, FIELD.h);
      ctx.ellipse(cx, cy, cx * e, cy * e, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(cx, cy, cx * e, cy * e, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (p.id === 'ice') {
      // 가장자리에 얼음빛
      const g = ctx.createRadialGradient(FIELD.w / 2, FIELD.h / 2, FIELD.h * 0.35, FIELD.w / 2, FIELD.h / 2, FIELD.w * 0.62);
      g.addColorStop(0, 'rgba(160,220,255,0)'); g.addColorStop(1, 'rgba(160,220,255,.32)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, FIELD.w, FIELD.h);
    }
    ctx.restore();
  }

  /** 안개: 원 위를 덮는 흐린 덩어리 */
  private drawFog(p: MapPattern, t: number) {
    const ctx = this.ctx, r = RULES.patterns.fog.r;
    const a = t < p.at ? 0.25 : Math.min(1, (p.until - t) / 500) * 0.93;
    ctx.save();
    for (const q of fogAt(p, Math.max(t, p.at))) {
      const g = ctx.createRadialGradient(q.x, q.y, r * 0.2, q.x, q.y, r);
      g.addColorStop(0, `rgba(200,205,225,${a})`); g.addColorStop(0.7, `rgba(180,186,210,${a * 0.85})`); g.addColorStop(1, 'rgba(180,186,210,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** 우클릭 보호막: 커서를 감싸는 투명하고 연한 파란 구체. 남은 비율 0.25 아래에서 줄며 흐려진다 (원점은 커서) */
  private drawBarrier(left: number, frameNow: number) {
    const ctx = this.ctx;
    const fade = Math.min(1, left / 0.25);
    const wobble = reduceMotion ? 0 : Math.sin(frameNow / 120) * 1.5;
    const r = (26 + 8 * fade) + wobble;
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, `rgba(220, 240, 255, ${0.22 * fade})`);
    g.addColorStop(0.7, `rgba(140, 200, 255, ${0.14 * fade})`);
    g.addColorStop(1, `rgba(110, 180, 255, ${0.28 * fade})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(170, 220, 255, ${0.65 * fade})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }

  private drawCursor(c: NonNullable<DrawState['cursor']>, frameNow: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.barrier && c.barrier > 0) this.drawBarrier(c.barrier, frameNow);
    if (c.reach > 0) { ctx.strokeStyle = 'rgba(127, 211, 255, .55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, c.reach + RULES.hitPad, 0, Math.PI * 2); ctx.stroke(); }
    if (c.magnet > 0) {
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(127, 211, 255, .45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, c.magnet, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    const col = c.stunned ? '#8a8fb8' : '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-6, 0); ctx.moveTo(6, 0); ctx.lineTo(18, 0); ctx.moveTo(0, -18); ctx.lineTo(0, -6); ctx.moveTo(0, 6); ctx.lineTo(0, 18); ctx.stroke();
    // 얼어 가는 중: 커서 둘레 서리 고리가 차오른다
    if (c.frost && c.frost > 0) {
      ctx.strokeStyle = 'rgba(165, 228, 255, .9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, c.frost)); ctx.stroke();
    }
    // 얼어붙음: 커서가 얼음 결정(육각형)에 갇힌다
    if (c.iced) {
      ctx.fillStyle = 'rgba(165, 228, 255, .35)'; ctx.strokeStyle = '#d8f3ff'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; if (i === 0) ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26); else ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (c.stunned && !c.iced) {
      ctx.fillStyle = '#ffd43b';
      for (let i = 0; i < 3; i++) {
        const a = frameNow / 250 + (Math.PI * 2 * i) / 3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 22, -26 + Math.sin(a) * 6, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 이동형 보스 오오라: 보랏빛 고리 (내 커서가 안에 있으면 더 진하게) */
  private drawAura(a: { x: number; y: number; r: number; inner: number }, mine: boolean, frameNow: number) {
    const ctx = this.ctx;
    ctx.save();
    const g = ctx.createRadialGradient(a.x, a.y, a.inner, a.x, a.y, a.r);
    g.addColorStop(0, `rgba(178, 108, 255, ${mine ? 0.45 : 0.25})`); g.addColorStop(1, 'rgba(178, 108, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
    ctx.setLineDash([8, 10]); ctx.lineDashOffset = -frameNow / 40;
    ctx.strokeStyle = `rgba(195, 155, 255, ${mine ? 0.9 : 0.5})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /** 시야 방해 (렌즈 제외): 잉크 얼룩·반코트·낙서. 시드로 모양이 정해지고, 끝나기 0.5초 전부터 옅어진다 */
  private drawBlind(b: NonNullable<DrawState['blind']>, t: number) {
    const ctx = this.ctx, rnd = seeded(b.seed);
    const fade = Math.max(0, Math.min(1, (b.until - t) / 500));
    ctx.save();
    ctx.globalAlpha = fade;
    if (b.kind === 'ink') {
      ctx.fillStyle = '#05060f';
      const n = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const x = FIELD.w * (0.12 + rnd() * 0.76), y = FIELD.h * (0.12 + rnd() * 0.76), r = 120 + rnd() * 90;
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) { const a = (Math.PI * 2 * k) / 12, rr = r * (0.75 + rnd() * 0.4); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.fill();
      }
    } else if (b.kind === 'half') {
      ctx.fillStyle = 'rgba(8, 9, 22, .94)';
      const side = Math.floor(rnd() * 4);
      if (side === 0) ctx.fillRect(0, 0, FIELD.w / 2, FIELD.h);
      else if (side === 1) ctx.fillRect(FIELD.w / 2, 0, FIELD.w / 2, FIELD.h);
      else if (side === 2) ctx.fillRect(0, 0, FIELD.w, FIELD.h / 2);
      else ctx.fillRect(0, FIELD.h / 2, FIELD.w, FIELD.h / 2);
    } else if (b.kind === 'doodle') {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const cols = ['#2b2f55', '#3a1f4d', '#1f3d3a', '#4d2a1f'];
      const n = 5 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = cols[i % cols.length]; ctx.lineWidth = 26 + rnd() * 20;
        ctx.beginPath(); ctx.moveTo(rnd() * FIELD.w, rnd() * FIELD.h);
        for (let k = 0; k < 3; k++) ctx.bezierCurveTo(rnd() * FIELD.w, rnd() * FIELD.h, rnd() * FIELD.w, rnd() * FIELD.h, rnd() * FIELD.w, rnd() * FIELD.h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 저격당함: 화면 가운데로 좁혀드는 붉은 조준선 */
  private drawSnipe(k: number) {
    const ctx = this.ctx, cx = FIELD.w / 2, cy = FIELD.h / 2, r = 300 - 220 * k;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 77, 77, ${1 - k * 0.6})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r - 40, cy); ctx.lineTo(cx + r + 40, cy); ctx.moveTo(cx, cy - r - 40); ctx.lineTo(cx, cy + r + 40); ctx.stroke();
    ctx.restore();
  }

  /** 아이템 원: 등급색 테두리 + 천천히 흔들리는 ? (전설은 프리즘이 돈다) */
  /** 얼음 원: 하늘색 반투명 몸체, 흰 눈송이(여섯 갈래) 무늬, 가장자리 반짝임 */
  private drawIce(x: number, y: number, frameNow: number, r: number) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(150, 220, 255, .55)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#d8f3ff'; ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const k = r * 0.62;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const cx = Math.cos(a), sy = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cx * k, sy * k); ctx.stroke();
      // 가지
      const bx = cx * k * 0.6, by = sy * k * 0.6, b = k * 0.25;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 0.7) * b, by + Math.sin(a + 0.7) * b);
      ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a - 0.7) * b, by + Math.sin(a - 0.7) * b);
      ctx.stroke();
    }
    if (!reduceMotion) {
      const a = frameNow / 500;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** 분열 원: 회색 몸체, 가운데서 갈라지는 검은 금, 천천히 맥동 */
  private drawSplit(x: number, y: number, frameNow: number, r: number) {
    const ctx = this.ctx;
    const k = reduceMotion ? 1 : 1 + Math.sin(frameNow / 220) * 0.05;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = '#8d93a3';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#e4e7ef'; ctx.stroke();
    ctx.strokeStyle = '#1b1d24'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    const cracks: [number, number][][] = [
      [[0, 0], [r * 0.25, -r * 0.3], [r * 0.15, -r * 0.6], [r * 0.4, -r * 0.85]],
      [[0, 0], [-r * 0.35, -r * 0.1], [-r * 0.55, r * 0.25], [-r * 0.85, r * 0.3]],
      [[0, 0], [r * 0.2, r * 0.35], [r * 0.55, r * 0.45], [r * 0.7, r * 0.7]],
    ];
    for (const line of cracks) {
      ctx.beginPath(); ctx.moveTo(line[0][0], line[0][1]);
      for (const [px, py] of line.slice(1)) ctx.lineTo(px, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 분열 파편: 주인 색 원 위에 톱니 테두리 + 진행 반대쪽 짧은 잔상 (일반 원과 구분) */
  private drawPieceEdge(c: Circle, x: number, y: number, r: number) {
    const ctx = this.ctx;
    const col = typeof c.kind === 'number' ? COLORS[c.kind].hex : '#ffffff';
    ctx.save();
    if (!reduceMotion) {
      const dx = -Math.cos(c.angle), dy = -Math.sin(c.angle);
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha *= 0.55;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x + dx * r * 0.9 * i, y + dy * r * 0.9 * i, r * (1 - i * 0.22), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    ctx.save(); ctx.translate(x, y);
    const n = 10, out = r + 7;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n, rr = i % 2 === 0 ? out : r;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineJoin = 'miter'; ctx.stroke();
    ctx.restore();
  }

  /** 폭탄 원: 검은 몸체, 흰 십자 무늬, 위쪽 심지 불꽃이 깜빡인다 */
  private drawBomb(x: number, y: number, frameNow: number, r: number) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#16161c';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffb347'; ctx.stroke();
    const k = r * 0.55, t = r * 0.14;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(-k, -t, k * 2, t * 2); ctx.fillRect(-t, -k, t * 2, k * 2);
    // 심지
    ctx.strokeStyle = '#c9a36b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.25, -r * 1.25, r * 0.1, -r * 1.4); ctx.stroke();
    if (reduceMotion || Math.floor(frameNow / 125) % 2 === 0) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(r * 0.1, -r * 1.4, r * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private drawItem(c: Circle, x: number, y: number, frameNow: number, r = c.r) {
    const ctx = this.ctx, tier = c.itemTier ?? 0;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#23285a';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6;
    if (tier === 2) {
      const g = ctx.createConicGradient(frameNow / 600, 0, 0);
      PRISM.forEach((col, i) => g.addColorStop(i / PRISM.length, col));
      g.addColorStop(1, PRISM[0]);
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = c.coopItem ? COOP_ITEM_COLOR : ITEM_TIER_COLOR[tier];
    ctx.stroke();
    ctx.rotate(Math.sin(frameNow / 500) * 0.35);
    ctx.fillStyle = tier === 2 ? '#ffd43b' : c.coopItem ? COOP_ITEM_COLOR : ITEM_TIER_COLOR[tier];
    ctx.font = `${Math.round(r * 1.2)}px 'Black Han Sans', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, r * 0.06);
    ctx.restore();
  }

  /** 장판: 주인 색 반투명 원, 점선 테두리 길이 = 남은 시간 */
  private drawZone(z: NonNullable<DrawState['zones']>[number], now: number) {
    const ctx = this.ctx, col = COLORS[z.color].hex;
    const frac = Math.max(0, Math.min(1, (z.until - now) / RULES.items.zoneMs));
    ctx.save();
    ctx.globalAlpha = 0.18; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.restore();
  }

  private drawCoopWard(ward: CoopWard, now: number) {
    const left = ward.until - now;
    if (left <= 0) return;
    const ctx = this.ctx, r = RULES.coop.special.support.ward.radius;
    const color = COOP_SPECIALS.ward.color;
    ctx.save();
    ctx.translate(ward.x, ward.y);
    ctx.globalAlpha *= Math.min(1, left / 1000);
    ctx.fillStyle = 'rgba(99, 242, 212, .09)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.globalAlpha *= 0.62;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r - 10, 0, Math.PI * 2); ctx.stroke();

    if (!reduceMotion) ctx.rotate((RULES.coop.special.support.ward.durationMs - left) / 3500);
    ctx.beginPath();
    for (let triangle = 0; triangle < 2; triangle++) {
      for (let side = 0; side < 3; side++) {
        const a = triangle * Math.PI + side * 2 * Math.PI / 3 - Math.PI / 2;
        const x = Math.cos(a) * (r - 40), y = Math.sin(a) * (r - 40);
        if (side === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 6);
      ctx.translate(0, -(r - 25));
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(0, -7); ctx.lineTo(5, 0); ctx.lineTo(0, 7); ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** 자동 공격은 탄막 아래에 그려 위험 탄을 가리지 않는다. */
  private drawSpecials(attacks: readonly CoopSpecialAttack[], to: { x: number; y: number }, now: number) {
    const ctx = this.ctx;
    for (const a of attacks) {
      const spec = attackSpecialRule(a.kind), elapsed = now - a.at;
      if (elapsed < 0 || elapsed >= spec.durationMs) continue;
      const progress = elapsed / spec.durationMs;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, elapsed / 100, (spec.durationMs - elapsed) / 150);
      ctx.strokeStyle = COOP_SPECIALS[a.kind].color;
      ctx.fillStyle = COOP_SPECIALS[a.kind].color;
      ctx.lineCap = 'round';
      if (a.kind === 'laser') {
        ctx.globalAlpha *= 0.7;
        ctx.lineWidth = reduceMotion ? 20 : 24 + Math.sin(elapsed / 70) * 4;
        ctx.beginPath(); ctx.moveTo(a.from.x, a.from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(a.from.x, a.from.y, 22, 0, Math.PI * 2); ctx.stroke();
      } else if (a.kind === 'meteor') {
        for (let i = 0; i < spec.hits; i++) {
          const flight = progress * spec.hits - i;
          if (flight < 0 || flight >= 1) continue;
          const side = (i % 2 ? -1 : 1) * (100 + i * 40);
          const x = to.x + side * (1 - flight), y = to.y - 320 * (1 - flight);
          ctx.lineWidth = 14;
          ctx.beginPath(); ctx.moveTo(x + side * 0.25, y - 80); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = '#fff3cf'; ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(to.x, to.y, 65 * (1 - flight) + 15, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const angle = progress * Math.PI * (reduceMotion ? 2 : 10) + i * Math.PI / 2;
          ctx.lineWidth = 9;
          ctx.beginPath(); ctx.arc(to.x, to.y, 110, angle, angle + 0.6); ctx.stroke();
          ctx.save(); ctx.translate(to.x + Math.cos(angle) * 110, to.y + Math.sin(angle) * 110); ctx.rotate(angle);
          ctx.beginPath(); ctx.moveTo(-9, -25); ctx.lineTo(12, 0); ctx.lineTo(-9, 25); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  /** 협력전 큰 원: 빛나는 청록 구체와 표적 색 고리 */
  private drawThreat(c: Circle, x: number, y: number, r: number, s: DrawState) {
    const ctx = this.ctx;
    const col = c.target ? s.colorOf?.get(c.target) : undefined;
    const mine = !!c.target && c.target === s.meId;
    ctx.save(); ctx.translate(x, y);
    const halo = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 1.5);
    halo.addColorStop(0, 'rgba(100, 239, 255, .5)');
    halo.addColorStop(1, 'rgba(100, 239, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2); ctx.fill();
    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
    body.addColorStop(0, '#fff'); body.addColorStop(0.45, '#c6fbff'); body.addColorStop(1, '#28c9e6');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineWidth = mine ? 4 : 2;
    ctx.strokeStyle = col !== undefined ? COLORS[col].hex : '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /** 내려찍기: 경고 원이 at까지 안쪽부터 차오른다 (내 것은 진하게) */
  private drawSlam(sl: Slam, t: number, s: DrawState) {
    if (t > sl.at + 250) return;
    const ctx = this.ctx, warn = RULES.coop.slam.warnMs;
    const f = Math.min(1, Math.max(0, 1 - (sl.at - t) / warn));
    const mine = sl.owner === s.meId;
    ctx.save();
    ctx.fillStyle = `rgba(255, 93, 115, ${mine ? 0.18 : 0.1})`;
    ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 93, 115, ${mine ? 0.45 : 0.25})`;
    ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r * f, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = mine ? 4 : 2; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /** 안전지대: 판 전체를 붉게 덮고 안전한 원만 밝게 뚫는다 (테두리 길이 = 남은 시간) */
  private drawSafe(sz: SafeZones, t: number) {
    if (t > sz.at + 300) return;
    const ctx = this.ctx;
    const f = Math.min(1, Math.max(0, (t - (sz.at - sz.warnMs)) / sz.warnMs));
    ctx.save();
    ctx.fillStyle = `rgba(255, 60, 80, ${0.12 + 0.18 * f})`;
    ctx.beginPath(); ctx.rect(0, 0, FIELD.w, FIELD.h);
    for (let i = 0; i < sz.zones.length; i++) { const z = safeZoneAt(sz, i, t); ctx.moveTo(z.x + z.r, z.y); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2, true); }
    ctx.fill();
    for (let i = 0; i < sz.zones.length; i++) {
      const z = safeZoneAt(sz, i, t);
      ctx.strokeStyle = 'rgba(120, 255, 170, .9)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - f)); ctx.stroke();
    }
    ctx.restore();
  }

  /** 구역 봉인: 판을 세로 3등분한 막힐 줄에 붉은 빗금 (경고 중엔 옅게 흐르고, 막히면 진하게) */
  private drawSeal(sl: Seal, t: number, frameNow: number) {
    if (t >= sl.until) return;
    if (sl.lethal) { this.drawCrush(sl, t); return; }
    const ctx = this.ctx, w = FIELD.w / 3, live = t >= sl.at;
    const f = live ? 1 : Math.min(1, Math.max(0, (t - sl.warnAt) / Math.max(1, sl.at - sl.warnAt)));
    ctx.save();
    for (const l of sl.lanes) {
      const x0 = l * w;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 0, w, FIELD.h); ctx.clip();
      ctx.fillStyle = live ? 'rgba(255, 45, 61, .28)' : `rgba(255, 60, 80, ${0.06 + 0.1 * f})`;
      ctx.fillRect(x0, 0, w, FIELD.h);
      // 빗금: 경고 중에는 흘러내린다
      const step = 46, off = live ? 0 : (frameNow / 20) % step;
      ctx.strokeStyle = live ? 'rgba(255, 70, 90, .75)' : `rgba(255, 93, 115, ${0.35 + 0.4 * f})`;
      ctx.lineWidth = live ? 10 : 6;
      ctx.beginPath();
      for (let k = -FIELD.h; k < w + FIELD.h; k += step) { ctx.moveTo(x0 + k + off, 0); ctx.lineTo(x0 + k + off - FIELD.h, FIELD.h); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 4; ctx.setLineDash(live ? [] : [14, 10]);
      ctx.strokeRect(x0 + 2, 2, w - 4, FIELD.h - 4);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** 압살: 안전한 한 줄을 밝히고 나머지 줄은 위아래 턱이 닫힌다. */
  private drawCrush(sl: Seal, t: number) {
    const ctx = this.ctx, w = FIELD.w / 3, snapMs = RULES.coop.crush.snapMs;
    const closed = t >= sl.at;
    const progress = reduceMotion ? Number(closed) : Math.max(0, Math.min(1, (t - sl.at + snapMs) / snapMs));
    const depth = 35 + progress * (FIELD.h / 2 - 35);
    const countdown = Math.max(0, Math.ceil((sl.at - snapMs - t) / 1000));
    ctx.save();
    ctx.font = "32px Jua, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let lane = 0; lane < 3; lane++) {
      const x = lane * w, danger = sl.lanes.includes(lane);
      ctx.fillStyle = danger ? 'rgba(255, 45, 61, .18)' : 'rgba(90, 255, 180, .2)';
      ctx.fillRect(x, 0, w, FIELD.h);
      ctx.strokeStyle = danger ? '#ff5d73' : '#78ffaa'; ctx.lineWidth = 5;
      ctx.strokeRect(x + 3, 3, w - 6, FIELD.h - 6);
      if (danger) {
        ctx.fillStyle = '#94263c';
        ctx.fillRect(x + 5, 5, w - 10, depth);
        ctx.fillRect(x + 5, FIELD.h - depth - 5, w - 10, depth);
        ctx.strokeStyle = '#ff8a95'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(x + 5, depth); ctx.lineTo(x + w - 5, depth);
        ctx.moveTo(x + 5, FIELD.h - depth); ctx.lineTo(x + w - 5, FIELD.h - depth); ctx.stroke();
      }
      ctx.fillStyle = danger ? '#ffd0d5' : '#b4ffda';
      ctx.fillText(danger ? (countdown ? `즉사 · ${countdown}` : '압살') : '안전 구역', x + w / 2, FIELD.h / 2);
    }
    ctx.restore();
  }

  /** 회전 빔: 경고 중엔 보스에서 뻗는 얇은 선 + 도는 방향 화살표, 나오면 굵은 빔 */
  /**
   * 유도탄: 예고 중에는 보스 둘레에 대상 색 점선 고리, 내가 대상이면 내 커서에 차오르는 고리.
   * 날 때는 받은 위치에서 진행 방향으로 최대 120ms 외삽해 대상 색 탄 + 붉은 테두리 (효과 줄이기가 아니면 꼬리)
   */
  private drawHoming(h: Homing, from: { x: number; y: number }, still: boolean, s: DrawState, frameNow: number) {
    const ctx = this.ctx, t = s.now, H = RULES.coop.homing;
    const hex = (id: string) => COLORS[s.colorOf?.get(id) ?? 0].hex;
    ctx.save();
    if (t < h.at) {
      const f = Math.min(1, Math.max(0, (t - h.warnAt) / (h.at - h.warnAt)));
      const pulse = 0.55 + 0.35 * Math.sin(frameNow / 90);
      h.targets.forEach((id, i) => {
        ctx.strokeStyle = hex(id); ctx.globalAlpha = pulse; ctx.lineWidth = 4; ctx.setLineDash([12, 10]);
        ctx.beginPath(); ctx.arc(from.x, from.y, RULES.coop.bossR + 18 + i * 10, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.setLineDash([]);
      if (s.cursor && s.meId && h.targets.includes(s.meId)) {
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(s.cursor.x, s.cursor.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const ahead = still ? 0 : Math.min(120, Math.max(0, t - h.t)) / 1000;
    const { speed } = homingRule(h.phase);
    for (const sh of h.shots) {
      const a = homingAlpha(sh, t);
      if (a <= 0) continue;
      const x = sh.x + Math.cos(sh.angle) * speed * ahead, y = sh.y + Math.sin(sh.angle) * speed * ahead;
      ctx.globalAlpha = a;
      if (!reduceMotion) {
        ctx.strokeStyle = hex(sh.target); ctx.globalAlpha = a * 0.35; ctx.lineWidth = H.r; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(sh.angle) * H.r * 3, y - Math.sin(sh.angle) * H.r * 3); ctx.stroke();
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = hex(sh.target);
      ctx.beginPath(); ctx.arc(x, y, H.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff2d3d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, H.r + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawBeam(b: Beam, from: { x: number; y: number }, t: number, frameNow: number) {
    if (t >= b.until) return;
    const ctx = this.ctx, live = t >= b.at, len = Math.hypot(FIELD.w, FIELD.h) + 50;
    const half = RULES.coop.beam.halfWidth;
    ctx.save();
    ctx.lineCap = 'round';
    for (const a of beamAngles(b, t)) {
      const ex = from.x + Math.cos(a) * len, ey = from.y + Math.sin(a) * len;
      if (live) {
        ctx.strokeStyle = 'rgba(255, 45, 61, .35)'; ctx.lineWidth = half * 2 + 14;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = half * 2;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 240, 240, .9)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(255, 93, 115, ${0.5 + 0.3 * Math.sin(frameNow / 90)})`; ctx.lineWidth = 3; ctx.setLineDash([16, 12]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([]);
        // 도는 방향 화살표: 빔 끝쪽 원호 + 화살촉
        const R = 330, dir = Math.sign(b.w) || 1, sweep = 0.35 * dir;
        ctx.strokeStyle = '#ffb3a0'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(from.x, from.y, R, a + 0.06 * dir, a + sweep, dir < 0); ctx.stroke();
        const ta = a + sweep, tx = from.x + Math.cos(ta) * R, ty = from.y + Math.sin(ta) * R;
        const fwd = ta + (Math.PI / 2) * dir, hl = 18;
        ctx.fillStyle = '#ffb3a0';
        ctx.beginPath();
        ctx.moveTo(tx + Math.cos(fwd) * hl, ty + Math.sin(fwd) * hl);
        ctx.lineTo(tx + Math.cos(fwd + 2.4) * hl, ty + Math.sin(fwd + 2.4) * hl);
        ctx.lineTo(tx + Math.cos(fwd - 2.4) * hl, ty + Math.sin(fwd - 2.4) * hl);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * 내려오는 벽 미리보기: 벽 줄을 판 너비로 옅게 잇고, 틈에서 아래로 초록 길을 낸다.
   * 경고 중(t < at)에는 출발 줄에 점선 탄 자리와 함께 깜빡이며 그리고, 움직이기 시작하면 벽을 따라간다
   */
  private drawWallGuide(v: Volley, t: number, frameNow: number) {
    const warn = t < v.at;
    const p0 = warn ? { x: v.shots[0]!.x, y: v.shots[0]!.y } : shotPos(v, 0, t);
    if (!p0 || p0.y > FIELD.h + v.r) return;
    const ctx = this.ctx, y = p0.y, gap = RULES.coop.bullets.wallGap;
    const xs = v.shots.map((q) => q.x).sort((a, b) => a - b);
    ctx.save();
    if (warn) {
      // 아직 맞지 않는 탄 자리: 점선 원, 깜빡임
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(frameNow / 110);
      ctx.strokeStyle = '#ff8a95'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      for (const q of v.shots) { ctx.beginPath(); ctx.arc(q.x, q.y, v.r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255, 60, 80, .16)';
    ctx.fillRect(0, y - v.r * 1.6, FIELD.w, v.r * 3.2);
    ctx.fillStyle = 'rgba(120, 255, 170, .12)'; ctx.strokeStyle = 'rgba(120, 255, 170, .55)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]!, b = xs[i]!;
      if (b - a <= gap + 0.01) continue;
      const x0 = a + v.r, x1 = b - v.r;
      ctx.fillRect(x0, y, x1 - x0, FIELD.h - y);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0, FIELD.h); ctx.moveTo(x1, y); ctx.lineTo(x1, FIELD.h); ctx.stroke();
    }
    ctx.restore();
  }

  /** 협력전 탄: 어두운 빨강 몸통 + 밝은 테두리 + 도는 가시 4개 */
  private drawBullets(vs: readonly Volley[], t: number, frameNow: number) {
    const ctx = this.ctx, spin = frameNow / 260;
    for (const v of vs) if (v.wall) this.drawWallGuide(v, t, frameNow);
    ctx.save();
    ctx.lineJoin = 'round';
    for (const v of vs) {
      const r = v.r;
      for (let i = 0; i < v.shots.length; i++) {
        const p = shotPos(v, i, t);
        if (!p || shotGone(v, i, t)) continue;
        ctx.fillStyle = '#ff8a95';
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = spin + i + (k * Math.PI) / 2, w = 0.42;
          ctx.moveTo(p.x + Math.cos(a - w) * r * 0.8, p.y + Math.sin(a - w) * r * 0.8);
          ctx.lineTo(p.x + Math.cos(a) * r * 1.55, p.y + Math.sin(a) * r * 1.55);
          ctx.lineTo(p.x + Math.cos(a + w) * r * 0.8, p.y + Math.sin(a + w) * r * 0.8);
        }
        ctx.fill();
        ctx.fillStyle = '#6e0a18'; ctx.strokeStyle = '#ffd0d5'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 협력전 수정: 색이나 프리즘으로 구분하고 남은 체력을 표시한다. */
  private drawCrystal(c: Circle, x: number, y: number, r: number, s: DrawState) {
    const ctx = this.ctx, col = c.colorOf ?? 0, mine = c.target === s.meId;
    const left = (c.hp ?? 0) / (c.maxHp || 1);
    ctx.save(); ctx.translate(x, y);
    if (c.prism) {
      const prism = ctx.createLinearGradient(-r, -r, r, r);
      prism.addColorStop(0, '#77eeff');
      prism.addColorStop(0.38, '#f6f1ff');
      prism.addColorStop(0.68, '#bc83ff');
      prism.addColorStop(1, '#ffb6d9');
      ctx.fillStyle = prism;
    } else {
      ctx.fillStyle = COLORS[col].hex;
    }
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i / 6) * Math.PI * 2; if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = mine || c.prism ? 6 : 3; ctx.strokeStyle = mine || c.prism ? '#fff' : 'rgba(255,255,255,.6)'; ctx.stroke();
    // 금: 깎인 만큼 선이 늘어난다
    const cracks = Math.round((1 - left) * 6);
    ctx.strokeStyle = 'rgba(16,18,42,.75)'; ctx.lineWidth = 2;
    for (let i = 0; i < cracks; i++) { const a = (i / 6) * Math.PI * 2 + 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.font = `400 ${Math.round(r * 0.7)}px Jua, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.prism) ctx.fillStyle = '#221647';
    ctx.fillText(String(c.hp ?? 0), 0, 2);
    ctx.restore();
  }

  /** 멈춘 원 위의 시계 바늘 */
  private drawClock(p: { x: number; y: number }, r: number, frameNow: number) {
    const ctx = this.ctx, a = frameNow / 400;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.32); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25); ctx.stroke();
    ctx.restore();
  }

  /** 황금 원 잔상: 조금 전 위치들을 옅게 */
  private drawGoldTrail(c: Circle, t: number) {
    const ctx = this.ctx;
    ctx.save();
    GOLD_TRAIL.forEach((ms, i) => {
      if (t - ms < c.born) return;
      const q = circlePos(c, t - ms);
      ctx.globalAlpha = 0.28 - i * 0.08; ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(q.x, q.y, c.r * (0.9 - i * 0.15), 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  private drawCircle(kind: BasicKind, x: number, y: number, r: number, rot: number, s: DrawState) {
    const ctx = this.ctx;
    if (kind === 'gold') {
      // 황금 원: 금빛 그라데이션 + 빛 테두리 + 도는 반짝임
      ctx.save(); ctx.translate(x, y);
      ctx.shadowColor = 'rgba(255, 209, 102, .9)'; ctx.shadowBlur = 18;
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#fffbe6'); g.addColorStop(0.45, '#ffd166'); g.addColorStop(1, '#c98a00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = '#fff3c4'; ctx.stroke();
      ctx.rotate(rot * 2); ctx.fillStyle = '#fff';
      const k = r * 0.55;
      ctx.beginPath(); ctx.moveTo(0, -k); ctx.lineTo(k * 0.18, -k * 0.18); ctx.lineTo(k, 0); ctx.lineTo(k * 0.18, k * 0.18);
      ctx.lineTo(0, k); ctx.lineTo(-k * 0.18, k * 0.18); ctx.lineTo(-k, 0); ctx.lineTo(-k * 0.18, -k * 0.18); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    if (kind === 'rainbow') {
      const g = ctx.createLinearGradient(-r, 0, r, 0);
      ['#ff5d73', '#ffd43b', '#51cf66', '#4dabf7', '#c39bff'].forEach((c, i) => g.addColorStop(i / 4, c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = kind === 'y' ? YELLOW : COLORS[kind].hex;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    if (kind === s.myColor) { ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    else if (kind === 'y' && s.myFever && s.myColor !== null) { ctx.lineWidth = 6; ctx.strokeStyle = COLORS[s.myColor].hex; ctx.stroke(); }
    else if (typeof kind === 'number' && s.markedColors.has(kind)) { ctx.setLineDash([8, 6]); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]); }

    // 색약 배려용 도형
    const m = r * 0.42;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    if (kind === 'y') { ctx.fillStyle = 'rgba(92,68,0,.6)'; ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill(); }
    else if (kind !== 'rainbow') {
      const shape = COLORS[kind].shape;
      if (shape === 'tri') { ctx.moveTo(0, -m); ctx.lineTo(m * 0.95, m * 0.7); ctx.lineTo(-m * 0.95, m * 0.7); ctx.closePath(); ctx.fill(); }
      if (shape === 'square') ctx.fillRect(-m * 0.75, -m * 0.75, m * 1.5, m * 1.5);
      if (shape === 'diamond') { ctx.moveTo(0, -m); ctx.lineTo(m, 0); ctx.lineTo(0, m); ctx.lineTo(-m, 0); ctx.closePath(); ctx.fill(); }
      if (shape === 'plus') { ctx.fillRect(-m * 0.25, -m, m * 0.5, m * 2); ctx.fillRect(-m, -m * 0.25, m * 2, m * 0.5); }
    }
    ctx.restore();
  }
}

/** 점수판, 버튼 등에 쓰는 작은 SVG 아이콘 */
export function shapeSVG(color: Exclude<CircleKind, 'item' | 'gold' | 'threat' | 'crystal' | SpecialKind>, size = 22) {
  const s = size, h = s / 2;
  if (color === 'boss') return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${h - 1}" fill="#ffc23a" stroke="#fff" stroke-width="1.5"/><path d="M${s * .28} ${s * .62}V${s * .36}L${s * .39} ${s * .5}L${h} ${s * .3}L${s * .61} ${s * .5}L${s * .72} ${s * .36}V${s * .62}Z" fill="#502d00" fill-opacity=".6"/></svg>`;
  if (color === 'rainbow') return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><defs><linearGradient id="rg${s}" x1="0" x2="1"><stop offset="0" stop-color="#ff5d73"/><stop offset=".5" stop-color="#ffd43b"/><stop offset="1" stop-color="#4dabf7"/></linearGradient></defs><circle cx="${h}" cy="${h}" r="${h - 1}" fill="url(#rg${s})"/></svg>`;
  const fill = color === 'y' ? YELLOW : COLORS[color].hex;
  const shape = color === 'y' ? 'dot' : COLORS[color].shape;
  const w = 'fill="#fff" fill-opacity=".85"';
  const inner = {
    tri: `<polygon points="${h},${s * .28} ${s * .74},${s * .7} ${s * .26},${s * .7}" ${w}/>`,
    square: `<rect x="${s * .32}" y="${s * .32}" width="${s * .36}" height="${s * .36}" ${w}/>`,
    diamond: `<polygon points="${h},${s * .26} ${s * .74},${h} ${h},${s * .74} ${s * .26},${h}" ${w}/>`,
    plus: `<rect x="${s * .43}" y="${s * .27}" width="${s * .14}" height="${s * .46}" ${w}/><rect x="${s * .27}" y="${s * .43}" width="${s * .46}" height="${s * .14}" ${w}/>`,
    dot: `<circle cx="${h}" cy="${h}" r="${s * .14}" fill="#5c4400" fill-opacity=".7"/>`,
  }[shape];
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${h - 1}" fill="${fill}"/>${inner}</svg>`;
}
