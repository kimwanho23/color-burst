/**
 * 맵 패턴: 라운드마다 확률로 한 번, 경고·현수막 뒤에 짧게 나타나 커서를 방해한다.
 * 모양(벽 위치, 공 출발점 등)은 만들 때 정하고, 움직임은 시각 t만으로 계산한다 (서버·화면이 같은 결과).
 * 수치는 rules.ts의 RULES.patterns.
 */
import { FIELD, RULES } from './rules.ts';
import { distToSegment, type Point } from './cursor.ts';

export type PatternId = 'walls' | 'spikes' | 'bar' | 'vortex' | 'ice' | 'ring' | 'fog';
export const PATTERN_IDS: readonly PatternId[] = ['walls', 'spikes', 'bar', 'vortex', 'ice', 'ring', 'fog'];

/** 이름, 현수막 문구, 위험 패턴(닿으면 스턴)인지 */
export const PATTERNS: Record<PatternId, { name: string; text: string; danger: boolean }> = {
  walls: { name: '가로막기', text: '지나갈 수 없는 벽이 생성됩니다.', danger: false },
  spikes: { name: '가시 공', text: '움직임을 멈추는 가시 공이 나옵니다.', danger: true },
  bar: { name: '회전 막대', text: '커서를 밀어내는 회전 막대가 생성됩니다.', danger: false },
  vortex: { name: '소용돌이', text: '커서를 빨아들이는 소용돌이가 생성됩니다.', danger: false },
  ice: { name: '빙판', text: '커서가 미끄러지는 빙판이 생성됩니다.', danger: false },
  ring: { name: '좁아지는 링', text: '가장자리를 막는 링이 좁혀옵니다.', danger: true },
  fog: { name: '안개', text: '원을 가리는 안개가 깔립니다.', danger: false },
};

/** 커서 움직임을 바꾸는 패턴 (그동안 커서는 움직인 양으로 움직인다) */
export const movesCursor = (id: PatternId) => id === 'walls' || id === 'bar' || id === 'vortex' || id === 'ice';

export interface Rect { x: number; y: number; w: number; h: number }
/** 시각 at에 (x, y)에서 초당 (vx, vy)로 출발해 필드 벽에서 튕기는 물체 */
export interface Mover { x: number; y: number; vx: number; vy: number }

export interface MapPattern {
  id: PatternId;
  /** 경고 시작, 등장, 사라지는 시각 */
  warnAt: number;
  at: number;
  until: number;
  walls?: Rect[];
  balls?: Mover[];
  bar?: { cx: number; cy: number; a0: number };
  /** 소용돌이 중심들: [0]은 at에, [1]은 at + secondAfterMs에 생긴다 */
  vortices?: Point[];
  fog?: Mover[];
}

const P = () => RULES.patterns;
const C = { x: FIELD.w / 2, y: FIELD.h / 2 };
const between = (lo: number, hi: number, rand: () => number) => lo + rand() * (hi - lo);

/** 등장 시각: [라운드 시작 + startMs, 라운드 끝 − endQuietMs] 안에서 고르게. 구간이 없으면 −1 */
export function rollPatternAt(roundStart: number, roundEnd: number, rand = Math.random) {
  const lo = roundStart + P().startMs, hi = roundEnd - P().endQuietMs;
  return hi < lo ? -1 : between(lo, hi, rand);
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
/** 사각형과 원이 겹치는지 */
const rectHitsCircle = (r: Rect, c: Point, rad: number) => {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(c.x - nx, c.y - ny) < rad;
};
const mover = (r: number, speed: number, rand: () => number): Mover => {
  const a = rand() * Math.PI * 2;
  return { x: between(r + 40, FIELD.w - r - 40, rand), y: between(r + 40, FIELD.h - r - 40, rand), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
};

/** 패턴 하나를 만든다: 경고는 at − warnMs, 끝은 at + 그 패턴 유지 시간 */
export function makePattern(id: PatternId, at: number, rand = Math.random): MapPattern {
  const R = P();
  const p: MapPattern = { id, warnAt: at - R.warnMs, at, until: at + R[id].ms };
  if (id === 'walls') {
    const W = R.walls, n = W.count[0] + Math.floor(rand() * (W.count[1] - W.count[0] + 1));
    const out: Rect[] = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const len = between(W.len[0], W.len[1], rand), horiz = rand() < 0.5;
        const w = horiz ? len : W.thick, h = horiz ? W.thick : len;
        const r = { x: between(60, FIELD.w - 60 - w, rand), y: between(60, FIELD.h - 60 - h, rand), w, h };
        // 중앙 발사 지점은 비워 두고, 벽끼리는 커서가 지나갈 틈을 남긴다
        if (rectHitsCircle(r, C, W.centerClear) || out.some((o) => overlaps(o, r, W.thick * 2))) continue;
        out.push(r);
        break;
      }
    }
    p.walls = out;
  } else if (id === 'spikes') {
    p.balls = Array.from({ length: R.spikes.count }, () => mover(R.spikes.r, R.spikes.speed, rand));
  } else if (id === 'bar') {
    p.bar = { cx: C.x, cy: C.y, a0: rand() * Math.PI };
  } else if (id === 'vortex') {
    // 둘 다 중앙 발사 지점을 피하고, 서로의 눈이 끌림 구역에 들어가지 않게 떨어뜨린다
    const V = R.vortex, out: Point[] = [];
    for (let i = 0; i < 2; i++) {
      let v: Point = C;
      for (let tries = 0; tries < 40; tries++) {
        v = { x: between(V.eye + 30, FIELD.w - V.eye - 30, rand), y: between(V.eye + 30, FIELD.h - V.eye - 30, rand) };
        if (Math.hypot(v.x - C.x, v.y - C.y) >= V.centerClear && out.every((o) => Math.hypot(o.x - v.x, o.y - v.y) >= V.r + V.eye)) break;
      }
      out.push(v);
    }
    p.vortices = out;
  } else if (id === 'fog') {
    p.fog = Array.from({ length: R.fog.count }, () => mover(0, R.fog.speed, rand));
  }
  return p;
}

/** 7개 중 하나를 고르게 */
export const rollPattern = (at: number, rand = Math.random) => makePattern(PATTERN_IDS[Math.floor(rand() * PATTERN_IDS.length)], at, rand);

/** 등장해 있는지 (경고 중은 아님) */
export const patternActive = (p: MapPattern | null | undefined, t: number): p is MapPattern => !!p && t >= p.at && t < p.until;

/** [lo, hi] 사이를 왕복 (벽에서 튕김) */
function fold(v: number, lo: number, hi: number) {
  const span = hi - lo;
  if (span <= 0) return lo;
  const m = (((v - lo) % (2 * span)) + 2 * span) % (2 * span);
  return lo + (m <= span ? m : 2 * span - m);
}

/** 움직이는 물체의 위치 (반지름 r만큼 벽 안쪽에서 튕김) */
export function moverAt(m: Mover, t0: number, t: number, r: number): Point {
  const s = Math.max(0, t - t0) / 1000;
  return { x: fold(m.x + m.vx * s, r, FIELD.w - r), y: fold(m.y + m.vy * s, r, FIELD.h - r) };
}

/** 회전 막대 선분 */
export function barSegment(p: MapPattern, t: number): { a: Point; b: Point } {
  const B = P().bar, bar = p.bar ?? { cx: C.x, cy: C.y, a0: 0 };
  const ang = bar.a0 + (B.degPerSec * Math.PI / 180) * (Math.max(0, t - p.at) / 1000);
  const dx = Math.cos(ang) * B.len / 2, dy = Math.sin(ang) * B.len / 2;
  return { a: { x: bar.cx - dx, y: bar.cy - dy }, b: { x: bar.cx + dx, y: bar.cy + dy } };
}

/** 화면 비율 타원 거리 (점수 구역과 같은 기준: 가운데 0, 변 가운데 1) */
const ellipseE = (pt: Point) => Math.hypot((pt.x - C.x) / C.x, (pt.y - C.y) / C.y);

/** 좁아지는 링의 안전 구역 타원 반경: shrinkMs 동안 startE → minE, 그 뒤 유지 */
export function ringE(p: MapPattern, t: number) {
  const R = P().ring;
  const k = Math.min(1, Math.max(0, t - p.at) / R.shrinkMs);
  return R.startE - (R.startE - R.minE) * k;
}

/** 링 위험 구역(안전 구역 밖)인지 */
export const inRingDanger = (p: MapPattern | null | undefined, pt: Point, t: number) =>
  patternActive(p, t) && p.id === 'ring' && ellipseE(pt) > ringE(p, t);

const inRect = (r: Rect, pt: Point) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;

/** 벽이나 회전 막대 안인지 (커서가 들어갈 수 없고, 서버는 그 클릭을 무시) */
export function blockedAt(p: MapPattern | null | undefined, pt: Point, t: number) {
  if (!patternActive(p, t)) return false;
  if (p.id === 'walls') return (p.walls ?? []).some((r) => inRect(r, pt));
  if (p.id === 'bar') { const s = barSegment(p, t); return distToSegment(pt, s.a, s.b) <= P().bar.thick / 2; }
  return false;
}

/** 막힌 점이면 가장 가까운 바깥 점으로 (벽은 가까운 변 밖, 막대는 선분에서 수직 방향 밖). 아니면 그대로 */
export function pushOut(p: MapPattern | null | undefined, pt: Point, t: number): Point {
  let q = pt;
  for (let i = 0; i < 4 && blockedAt(p, q, t); i++) {
    if (p!.id === 'walls') {
      const r = p!.walls!.find((w) => inRect(w, q))!;
      const opts = [
        { d: q.x - r.x, x: r.x - 1, y: q.y }, { d: r.x + r.w - q.x, x: r.x + r.w + 1, y: q.y },
        { d: q.y - r.y, x: q.x, y: r.y - 1 }, { d: r.y + r.h - q.y, x: q.x, y: r.y + r.h + 1 },
      ].sort((a, b) => a.d - b.d);
      q = { x: opts[0].x, y: opts[0].y };
    } else {
      const s = barSegment(p!, t);
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((q.x - s.a.x) * dx + (q.y - s.a.y) * dy) / len2));
      const near = { x: s.a.x + u * dx, y: s.a.y + u * dy };
      let nx = q.x - near.x, ny = q.y - near.y, nl = Math.hypot(nx, ny);
      if (nl < 1e-6) { nx = -dy; ny = dx; nl = Math.hypot(nx, ny); }
      const out = P().bar.thick / 2 + 1;
      q = { x: near.x + (nx / nl) * out, y: near.y + (ny / nl) * out };
    }
    q = { x: Math.max(0, Math.min(FIELD.w, q.x)), y: Math.max(0, Math.min(FIELD.h, q.y)) };
  }
  return q;
}

/** 커서가 닿은 가시 공 번호 (사라진 공은 빼고). 없으면 −1 */
export function spikeHit(p: MapPattern | null | undefined, pt: Point, t: number, popped: ReadonlySet<number>) {
  if (!patternActive(p, t) || p.id !== 'spikes') return -1;
  const r = P().spikes.r;
  return (p.balls ?? []).findIndex((b, i) => !popped.has(i) && Math.hypot(pt.x - moverAt(b, p.at, t, r).x, pt.y - moverAt(b, p.at, t, r).y) <= r);
}

/** 소용돌이가 생기는 시각들 */
export const vortexTimes = (p: MapPattern) => (p.vortices ?? []).map((_, i) => p.at + i * P().vortex.secondAfterMs);

/** 지금 나와 있는 소용돌이 번호들 */
export const vortexAlive = (p: MapPattern | null | undefined, t: number) =>
  patternActive(p, t) && p.id === 'vortex' ? vortexTimes(p).flatMap((at, i) => (t >= at ? [i] : [])) : [];

/** 미리보기(경고) 중인 소용돌이 번호들: 생기기 warnMs 전부터 */
export const vortexWarned = (p: MapPattern | null | undefined, t: number) =>
  p?.id === 'vortex' ? vortexTimes(p).flatMap((at, i) => (t >= at - P().warnMs && t < at ? [i] : [])) : [];

/** 끌림: 가장 가까운 소용돌이의 끌림 구역 안이면 그 중심 쪽으로 쏠린 자리 (가까울수록 많이, 최대 maxBend, 중심을 넘지 않음) */
export function vortexBend(p: MapPattern | null | undefined, pt: Point, t: number): Point {
  const V = P().vortex;
  let best = -1, bd = Infinity;
  for (const i of vortexAlive(p, t)) { const c = p!.vortices![i], d = Math.hypot(c.x - pt.x, c.y - pt.y); if (d < bd) { bd = d; best = i; } }
  if (best < 0 || bd > V.r || bd < 1e-6) return pt;
  const c = p!.vortices![best], s = Math.min(bd, V.maxBend * (1 - bd / V.r)) / bd;
  return { x: pt.x + (c.x - pt.x) * s, y: pt.y + (c.y - pt.y) * s };
}

/** 이 점이 들어 있는 소용돌이 눈 번호, 없으면 −1 */
export function eyeOf(p: MapPattern | null | undefined, pt: Point, t: number) {
  for (const i of vortexAlive(p, t)) { const c = p!.vortices![i]; if (Math.hypot(c.x - pt.x, c.y - pt.y) <= P().vortex.eye) return i; }
  return -1;
}

/** 갇힌 커서: i번 눈 안으로 (밖이면 테두리 안쪽에 붙음) */
export function trapIn(p: MapPattern, i: number, pt: Point): Point {
  const c = p.vortices![i], r = P().vortex.eye - 1, d = Math.hypot(pt.x - c.x, pt.y - c.y);
  return d <= r ? pt : { x: c.x + (pt.x - c.x) * (r / d), y: c.y + (pt.y - c.y) * (r / d) };
}

/** 빙판: 목표를 스프링으로 따라간다 (멈춰도 조금 지나쳤다 돌아옴). 16ms 이하로 쪼개 계산, 속도는 초당 */
export function iceStep(pos: Point, vel: Point, target: Point, dtMs: number): { pos: Point; vel: Point } {
  const I = P().ice;
  let x = pos.x, y = pos.y, vx = vel.x, vy = vel.y;
  for (let left = Math.max(0, dtMs); left > 0; left -= 16) {
    const dt = Math.min(16, left) / 1000;
    vx += ((target.x - x) * I.stiff - vx * I.damp) * dt;
    vy += ((target.y - y) * I.stiff - vy * I.damp) * dt;
    x += vx * dt; y += vy * dt;
  }
  return { pos: { x: Math.max(0, Math.min(FIELD.w, x)), y: Math.max(0, Math.min(FIELD.h, y)) }, vel: { x: vx, y: vy } };
}

/** 안개 덩어리 위치들 */
export const fogAt = (p: MapPattern, t: number): Point[] => (p.fog ?? []).map((m) => moverAt(m, p.at, t, 0));

/** 일시정지: 모든 시각을 delta만큼 민다 */
export const shiftPattern = (p: MapPattern, delta: number): MapPattern => ({ ...p, warnAt: p.warnAt + delta, at: p.at + delta, until: p.until + delta });
