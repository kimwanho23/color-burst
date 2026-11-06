/**
 * Canvas 그리기. 필드 좌표(1600x900)를 화면 크기에 맞춰 확대해서 그린다.
 * 나중에 Phaser/PixiJS로 바꾸려면 이 파일만 교체하면 된다.
 */
import { COLORS, FIELD, YELLOW, circlePos, type Circle, type CircleKind, type ColorIndex } from '@color-burst/shared';

type BasicKind = Exclude<CircleKind, 'boss'>;

type Fx =
  | { type: 'ring'; x: number; y: number; col: string; t: number; life: number }
  | { type: 'spark'; x: number; y: number; vx: number; vy: number; col: string; t: number; life: number }
  | { type: 'miss'; x: number; y: number; t: number; life: number }
  | { type: 'text'; x: number; y: number; txt: string; col: string; size: number; t: number; life: number };

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface DrawState {
  circles: Iterable<Circle>;
  hidden: Set<number>;
  myColor: ColorIndex | null;
  myFever: boolean;
  /** 색 → 표적 여부 */
  markedColors: Set<number>;
  now: number;
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

  /** 화면 좌표 → 필드 좌표 */
  toField(clientX: number, clientY: number) {
    const r = this.cv.getBoundingClientRect();
    return { x: (clientX - r.left - this.ox) / this.scale, y: (clientY - r.top - this.oy) / this.scale };
  }

  burst(x: number, y: number, col: string, big: boolean) {
    this.fx.push({ type: 'ring', x, y, col, t: 0, life: 0.35 });
    if (reduceMotion) return;
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 240;
      this.fx.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, col, t: 0, life: 0.4 + Math.random() * 0.2 });
    }
  }
  bossPoke(id: number) { this.bossPoked.set(id, performance.now()); }

  text(x: number, y: number, txt: string, col: string, size = 1) { this.fx.push({ type: 'text', x, y, txt, col, size, t: 0, life: 0.8 }); }
  miss(x: number, y: number) {
    this.fx.push({ type: 'miss', x, y, t: 0, life: 0.35 });
    if (!reduceMotion) this.shake = 0.15;
  }

  draw(s: DrawState) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    for (const f of this.fx) { f.t += dt; if (f.type === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; } }
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
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.beginPath(); ctx.arc(cx, cy, 70 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.myFever ? 'rgba(255,159,28,.8)' : 'rgba(255,255,255,.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.stroke();

    // 보스를 먼저 그려서 작은 원이 위에 보이게
    const list = [...s.circles].filter((c) => !s.hidden.has(c.id));
    for (const c of list) if (c.kind === 'boss') this.drawBoss(c, s.now, now);
    for (const c of list) {
      if (c.kind === 'boss') continue;
      const p = circlePos(c, s.now);
      this.drawCircle(c.kind, p.x, p.y, c.r, (s.now - c.born) / 700 + c.id, s);
    }

    for (const f of this.fx) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.type === 'ring') { ctx.strokeStyle = f.col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f.x, f.y, 28 + k * 45, 0, Math.PI * 2); ctx.stroke(); }
      if (f.type === 'spark') { ctx.fillStyle = f.col; ctx.fillRect(f.x - 3, f.y - 3, 6, 6); }
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

    ctx.save();
    ctx.translate(x, y);
    // 몸통
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff7cf'); g.addColorStop(0.55, '#ffc23a'); g.addColorStop(1, '#c47a00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    // 왕관 무늬
    ctx.fillStyle = 'rgba(80,45,0,.55)';
    ctx.beginPath();
    const w = r * 0.55, h = r * 0.32, top = -r * 0.62;
    ctx.moveTo(-w, top + h); ctx.lineTo(-w, top); ctx.lineTo(-w / 2, top + h * 0.55); ctx.lineTo(0, top - h * 0.1);
    ctx.lineTo(w / 2, top + h * 0.55); ctx.lineTo(w, top); ctx.lineTo(w, top + h); ctx.closePath(); ctx.fill();
    // 체력 숫자
    ctx.fillStyle = '#3a2200'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
export function shapeSVG(color: CircleKind, size = 22) {
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
