/**
 * Canvas 그리기. 필드 좌표(1600x900)를 화면 크기에 맞춰 확대해서 그린다.
 * 나중에 Phaser/PixiJS로 바꾸려면 이 파일만 교체하면 된다.
 */
import { COLORS, FIELD, RULES, YELLOW, auraAt, bossState, circlePos, isGuarded, lensWarp, type BlindKind, type BossType, type Circle, type CircleKind, type ColorIndex } from '@color-burst/shared';

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
};
const RAGE_BODY: [string, string, string] = ['#ffd0d0', '#ff4d4d', '#8a0000'];

/** 보스 처치 타격감: 멈칫(히트스톱), 흔들림 */
export const BOSS_HITSTOP_MS = 80;
export const BOSS_SHAKE = { sec: 0.2, amp: 8 } as const;
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
const BANNER_Y = 230, BANNER_LIFE = 1.2;

type BasicKind = Exclude<CircleKind, 'boss' | 'item'>;
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
  | { type: 'flash'; t: number; life: number };

/** 한 번에 화면에 있을 수 있는 효과 수. 넘으면 새 파티클은 버린다 (링·글자는 유지) */
const MAX_FX = 400;
const SKY = '#7fd3ff';
const GOLD = '#ffd166';
const ITEM_TIER_COLOR = ['#ffffff', '#4d9bff'] as const;
const PRISM = ['#ff5d73', '#ffb347', '#ffd43b', '#51cf66', '#4dabf7', '#b26cff'];

const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let reduceMotion = prefersReduced;
/** 설정의 '화면 효과 줄이기' (흔들림, 파티클 끔). 운영체제 설정이 켜져 있으면 항상 줄인다 */
export function setReduceFx(on: boolean) { reduceMotion = prefersReduced || on; }

export interface DrawState {
  circles: Iterable<Circle>;
  hidden: Set<number>;
  myColor: ColorIndex | null;
  myFever: boolean;
  /** 색 → 표적 여부 */
  markedColors: Set<number>;
  now: number;
  /** 방해 전파를 맞아 원이 흐려 보이는 중 */
  blurred?: boolean;
  /** 장판 (color: 주인 색) */
  zones?: { x: number; y: number; r: number; until: number; color: ColorIndex }[];
  /** 시간 정지 중 */
  frozen?: boolean;
  /** 게임 커서 (내 커서만): 스턴이면 회색, 넓은 손·자석 범위 */
  cursor?: { x: number; y: number; stunned: boolean; reach: number; magnet: number } | null;
  /** 레이저: at 전에는 경고선, at부터 fireMs 동안 빛줄기 */
  lasers?: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number }[];
  /** 시야 방해: 종류·시드·끝나는 시각 */
  blind?: { kind: BlindKind; seed: number; until: number } | null;
  /** 내 커서가 이동형 보스 오오라 안 (오오라를 더 진하게) */
  myAura?: boolean;
  /** 자석에 끌려가는 원: from에서 to(내가 끌면 내 커서, 남이면 null → 제자리에서 작아짐)로 */
  pulls?: Map<number, { from: { x: number; y: number }; to: { x: number; y: number } | null; at: number; ms: number }>;
}

export class Renderer {
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
  reachRing(x: number, y: number, r: number) { this.add({ type: 'ring', x, y, col: SKY, t: 0, life: 0.25, r0: 4, r1: r + 12, w: 3 }); }
  /** 자석: 클릭 지점 → 잡힌 원 */
  pullLine(x0: number, y0: number, x1: number, y1: number) { this.add({ type: 'line', x: x0, y: y0, x1, y1, col: SKY, t: 0, life: 0.22 }); }
  /** 충격파 (폭죽·필드 클리어). 효과 줄이기여도 링은 그린다 */
  shockwave(x: number, y: number, R: number) { this.add({ type: 'ring', x, y, col: '#fff', t: 0, life: 0.35, r0: 10, r1: R, w: 6 }); }
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
    ctx.setLineDash([6, 8]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(cx, cy, RULES.spawnGuardR, 0, Math.PI * 2); ctx.stroke();
    // 점수 구역 경계: 사이(×2)·가장자리(×3)가 시작되는 타원
    RULES.zones.bounds.forEach((b, i) => {
      ctx.setLineDash([4, 12]); ctx.lineWidth = 2; ctx.strokeStyle = `rgba(126, 224, 255, ${i ? 0.1 : 0.07})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, cx * b, cy * b, 0, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.setLineDash([]);

    for (const z of s.zones ?? []) this.drawZone(z, s.now);


    // 방해 전파: 원을 흐리고 옅게 / 시간 정지: 채도를 낮춘다
    const filters = [s.blurred ? 'blur(7px)' : '', s.frozen ? 'saturate(0.25)' : ''].filter(Boolean);
    if (filters.length) ctx.filter = filters.join(' ');
    if (s.blurred) ctx.globalAlpha = 0.55;
    // 보스를 먼저 그려서 작은 원이 위에 보이게
    const list = [...s.circles].filter((c) => !s.hidden.has(c.id));
    for (const l of s.lasers ?? []) this.drawLaser(l, s.now, now);
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
    for (const c of list) if (c.kind === 'boss') { fade(c); this.drawBoss(c, s.now, now); }
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
      else this.drawCircle(c.kind, p.x, p.y, r, (s.now - c.born) / 700 + c.id, s);
    }
    ctx.globalAlpha = base;
    ctx.filter = 'none'; ctx.globalAlpha = 1;
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
        ctx.strokeText(f.txt, FIELD.w / 2, BANNER_Y);
        ctx.fillStyle = f.col; ctx.fillText(f.txt, FIELD.w / 2, BANNER_Y);
      }
      ctx.globalAlpha = 1;
    }
    if (s.blind && s.blind.kind !== 'lens') this.drawBlind(s.blind, s.now);
    if (now < this.snipeUntil && !reduceMotion) this.drawSnipe(1 - (this.snipeUntil - now) / 600);
    if (s.cursor) this.drawCursor(s.cursor, now);
    ctx.restore();
  }

  private drawBoss(c: Circle, t: number, frameNow: number) {
    const ctx = this.ctx;
    let { x, y } = circlePos(c, t);
    let size = c.r;
    if (this.warp) { const w = this.warp({ x, y }, c.r); x = w.x; y = w.y; size = w.size; }
    const poked = frameNow - (this.bossPoked.get(c.id) ?? -1e9);
    if (poked < 120 && !reduceMotion) { x += (Math.random() - 0.5) * 10; y += (Math.random() - 0.5) * 10; }
    const r = size * (poked < 120 ? 0.96 : 1);
    const frac = (c.hp ?? 0) / (c.maxHp ?? 1);
    const low = frac <= 0.2;
    const type = c.boss ?? 'normal';
    const st = bossState(c, t);

    ctx.save();
    ctx.translate(x, y);
    // 몸통 (붉은 공격형은 빨갛게)
    const [c0, c1, c2] = st.enraged ? RAGE_BODY : BOSS_BODY[type];
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = st.enraged ? '#ff4d4d' : '#fff'; ctx.stroke();
    this.bossEmblem(type, r, st.enraged);
    // 체력 숫자
    ctx.fillStyle = 'rgba(30,20,10,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(r * 0.55)}px 'Black Han Sans', sans-serif`;
    ctx.fillText(String(c.hp ?? 0), 0, r * 0.12);
    // 체력 링
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.arc(0, 0, r + 14, 0, Math.PI * 2); ctx.stroke();
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(frameNow / 90)) : 1;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = low ? '#ff5d73' : '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.globalAlpha = 1;
    // 방어형 보호막: 밝은 하늘색 육각 테두리 (이때는 피해가 안 들어감)
    if (st.shielded) {
      ctx.lineWidth = 6; ctx.strokeStyle = `rgba(127, 211, 255, ${0.6 + 0.4 * Math.abs(Math.sin(frameNow / 120))})`;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const a = (Math.PI / 3) * i + frameNow / 900; ctx.lineTo(Math.cos(a) * (r + 26), Math.sin(a) * (r + 26)); }
      ctx.stroke();
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
    const fire = RULES.laser.fireMs, W = RULES.laser.width * 2;
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
  private drawCursor(c: NonNullable<DrawState['cursor']>, frameNow: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(c.x, c.y);
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
    if (c.stunned) {
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
        const x = 200 + rnd() * 1200, y = 120 + rnd() * 660, r = 120 + rnd() * 90;
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
    } else ctx.strokeStyle = ITEM_TIER_COLOR[tier];
    ctx.stroke();
    ctx.rotate(Math.sin(frameNow / 500) * 0.35);
    ctx.fillStyle = tier === 2 ? '#ffd43b' : ITEM_TIER_COLOR[tier];
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
export function shapeSVG(color: Exclude<CircleKind, 'item' | 'gold'>, size = 22) {
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
