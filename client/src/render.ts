/**
 * Canvas 그리기. 필드 좌표(1600x900)를 화면 크기에 맞춰 확대해서 그린다.
 * 나중에 Phaser/PixiJS로 바꾸려면 이 파일만 교체하면 된다.
 */
import { COLORS, FIELD, RULES, YELLOW, bossState, circlePos, isGuarded, type BossType, type Circle, type CircleKind, type ColorIndex } from '@color-burst/shared';

/** 보스 종류별 몸통 색 [밝은 곳, 가운데, 가장자리] */
const BOSS_BODY: Record<BossType, [string, string, string]> = {
  normal: ['#fff7cf', '#ffc23a', '#c47a00'],
  guard: ['#e8f4ff', '#6fa8dc', '#2b5c8a'],
  rage: ['#fff0d6', '#ff9f43', '#b35400'],
  runner: ['#d6fff6', '#2ec4b6', '#0b6e66'],
};
const RAGE_BODY: [string, string, string] = ['#ffd0d0', '#ff4d4d', '#8a0000'];

type BasicKind = Exclude<CircleKind, 'boss' | 'item'>;

type Fx =
  /** r0 → r1로 퍼지는 링 (기본 28 → 73) */
  | { type: 'ring'; x: number; y: number; col: string; t: number; life: number; r0?: number; r1?: number; w?: number }
  /** g: 중력(동전 파편), round: 동그란 입자 */
  | { type: 'spark'; x: number; y: number; vx: number; vy: number; col: string; t: number; life: number; g?: number; size?: number; round?: boolean }
  | { type: 'miss'; x: number; y: number; t: number; life: number }
  | { type: 'text'; x: number; y: number; txt: string; col: string; size: number; t: number; life: number }
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
  /** 넓은 손: 커서 둘레 범위 표시 */
  reachRing?: { x: number; y: number; r: number } | null;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0;
  private scale = 1; private ox = 0; private oy = 0;
  private fx: Fx[] = [];
  private shake = 0;
  private last = performance.now();
  /** 보스 원 id → 마지막으로 맞은 시각 (흔들림 연출) */
  private bossPoked = new Map<number, number>();
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

  burst(x: number, y: number, col: string, big: boolean) {
    this.add({ type: 'ring', x, y, col, t: 0, life: 0.35 });
    this.sparks(x, y, col, big ? 10 : 5);
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
  miss(x: number, y: number, soft = false) {
    this.fx.push({ type: 'miss', x, y, t: 0, life: soft ? 0.2 : 0.35 });
    if (!reduceMotion && !soft) this.shake = 0.15;
  }

  draw(s: DrawState) {
    const now = performance.now();
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
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
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
    ctx.beginPath(); ctx.arc(cx, cy, RULES.spawnGuardR, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);

    for (const z of s.zones ?? []) this.drawZone(z, s.now);
    if (s.reachRing) {
      ctx.strokeStyle = 'rgba(127, 211, 255, .55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.reachRing.x, s.reachRing.y, s.reachRing.r, 0, Math.PI * 2); ctx.stroke();
    }

    // 방해 전파: 원을 흐리고 옅게 / 시간 정지: 채도를 낮춘다
    const filters = [s.blurred ? 'blur(7px)' : '', s.frozen ? 'saturate(0.25)' : ''].filter(Boolean);
    if (filters.length) ctx.filter = filters.join(' ');
    if (s.blurred) ctx.globalAlpha = 0.55;
    // 보스를 먼저 그려서 작은 원이 위에 보이게
    const list = [...s.circles].filter((c) => !s.hidden.has(c.id));
    const base = ctx.globalAlpha;
    // 발사 보호 구역 안의 원은 반투명 (아직 잡을 수 없음)
    const fade = (c: Circle) => { ctx.globalAlpha = isGuarded(c, s.now) ? base * 0.4 : base; };
    for (const c of list) if (c.kind === 'boss') { fade(c); this.drawBoss(c, s.now, now); }
    for (const c of list) {
      if (c.kind === 'boss') continue;
      const p = circlePos(c, s.now);
      fade(c);
      if (c.kind === 'item') this.drawItem(c, p.x, p.y, now);
      else this.drawCircle(c.kind, p.x, p.y, c.r, (s.now - c.born) / 700 + c.id, s);
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
        ctx.globalAlpha = 1 - k * k; ctx.fillStyle = f.col;
        ctx.font = `${Math.round(28 * f.size)}px 'Black Han Sans', sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(f.txt, f.x, f.y - k * 45);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawBoss(c: Circle, t: number, frameNow: number) {
    const ctx = this.ctx;
    let { x, y } = circlePos(c, t);
    const poked = frameNow - (this.bossPoked.get(c.id) ?? -1e9);
    if (poked < 120 && !reduceMotion) { x += (Math.random() - 0.5) * 10; y += (Math.random() - 0.5) * 10; }
    const r = c.r * (poked < 120 ? 0.96 : 1);
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

  /** 아이템 원: 등급색 테두리 + 천천히 흔들리는 ? (전설은 프리즘이 돈다) */
  private drawItem(c: Circle, x: number, y: number, frameNow: number) {
    const ctx = this.ctx, r = c.r, tier = c.itemTier ?? 0;
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

  private drawCircle(kind: BasicKind, x: number, y: number, r: number, rot: number, s: DrawState) {
    const ctx = this.ctx;
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
export function shapeSVG(color: Exclude<CircleKind, 'item'>, size = 22) {
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
