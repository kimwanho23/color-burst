/** 게임 커서: 화면이 직접 그리는 내 커서. 평소에는 진짜 마우스 위치와 같고, 효과가 걸리면 움직임이 바뀐다 */
import {
  FIELD, RULES, cursorTarget, followCursor, iceStep, movesCursor, patternActive, pushOut, relativeCursor, slideBack, vortexStep,
  type CursorMode, type MapPattern, type Point,
} from '@color-burst/shared';

/** 커서에 영향을 주는 맵 패턴과 지금 (서버) 시각 */
export interface FieldFx { pattern: MapPattern; t: number }
/** 맵 패턴 중 한 번에 옮기는 최대 거리 (벽을 뚫고 지나가지 않게 쪼갬) */
const STEP = 10;

export class GameCursor {
  /** 필드 좌표. 아직 마우스를 움직인 적 없거나 창을 떠났으면 null */
  pos: Point | null = null;
  /** 마지막 진짜 마우스 위치 (필드 좌표, 캔버스 밖이면 필드 밖 값일 수 있음) */
  private real: Point | null = null;
  /** 지난 프레임 뒤로 쌓인 진짜 마우스 이동량 (오오라 끌림 중에만 씀) */
  private delta: Point = { x: 0, y: 0 };
  /** 지금 효과: '' 없음, 'a' 오오라만, 's' 감도 감소, 'i' 반대, 'si' 둘 다 */
  private key = '';
  private slideFrom: Point | null = null;
  private slideAt = 0;
  /** 반대·감도 감소 중 오오라에 끌려간 양 (목표 위치에 더한다. 오오라를 벗어나면 미끄러져 0으로) */
  private off: Point = { x: 0, y: 0 };
  /** 빙판: 따라가는 목표와 속도 */
  private iceTarget: Point | null = null;
  private iceVel: Point = { x: 0, y: 0 };

  /** real: 진짜 마우스의 필드 좌표, delta: 이번 이동량(필드 단위) */
  move(real: Point, delta: Point) {
    this.real = real;
    this.delta = { x: this.delta.x + delta.x, y: this.delta.y + delta.y };
    if (!this.pos) { this.pos = cursorTarget(real, null); return; }
    // 효과가 없으면 프레임을 기다리지 않고 바로 따라간다
    if (!this.key && !this.slideFrom) this.pos = cursorTarget(real, null);
  }

  /**
   * 매 프레임: 효과에 맞춰 커서를 옮긴다. 반대는 거울 위치, 감도 감소는 늦게 따라감, 오오라만이면 이동량 그대로.
   * 효과가 바뀌어 목표가 튀는 순간(반대가 걸리거나 풀림, 효과가 끝남)은 slideMs 동안 미끄러져 옮겨 간다
   */
  frame(mode: CursorMode | null, dtMs: number, inAura = false, fx: FieldFx | null = null) {
    const d = this.delta;
    this.delta = { x: 0, y: 0 };
    if (!this.real || !this.pos) return;
    // 벽·회전 막대·소용돌이·빙판이 나와 있으면 커서는 움직인 양으로 움직인다 ('p')
    const field = fx && patternActive(fx.pattern, fx.t) && movesCursor(fx.pattern.id) ? fx : null;
    const key = field ? 'p' : mode ? `${mode.slow ? 's' : ''}${mode.invert ? 'i' : ''}` || 'a' : '';
    if (key !== this.key) {
      // 감도 감소가 남아 있으면 따라가기가 알아서 부드럽고, 오오라·맵 패턴은 지금 자리에서 이어서 움직인다
      if (!key.includes('s') && key !== 'a' && key !== 'p') { this.slideFrom = this.pos; this.slideAt = performance.now(); }
      else this.slideFrom = null;
      this.key = key;
      this.off = { x: 0, y: 0 };
      this.iceTarget = null; this.iceVel = { x: 0, y: 0 };
    }
    if (field) { this.fieldStep(field, d, mode, dtMs); return; }
    if (key === 'a') { this.pos = relativeCursor(this.pos, d); return; }
    // 오오라를 벗어나면 끌려간 양을 버리고 미끄러져 돌아간다
    if (!inAura && (this.off.x || this.off.y)) {
      this.off = { x: 0, y: 0 };
      if (!key.includes('s')) { this.slideFrom = this.pos; this.slideAt = performance.now(); }
    }
    const target = this.targetOf(mode);
    if (this.slideFrom) {
      const e = performance.now() - this.slideAt;
      if (e < RULES.sabotage.slideMs) { this.pos = slideBack(this.slideFrom, target, e); return; }
      this.slideFrom = null;
    }
    this.pos = followCursor(this.pos, target, dtMs, !!mode?.slow);
  }

  /**
   * 맵 패턴 중: 이동량(반대면 반대로, 감도 감소면 절반)으로 움직인다.
   * 벽·막대는 STEP씩 쪼개 밀어내서 뚫고 지나가지 않고, 막대가 쓸고 와도 밀려난다. 소용돌이는 끌리고, 빙판은 미끄러진다
   */
  private fieldStep(fx: FieldFx, d: Point, mode: CursorMode | null, dtMs: number) {
    const k = (mode?.invert ? -1 : 1) * (mode?.slow ? 0.5 : 1);
    const dx = d.x * k, dy = d.y * k;
    const p = fx.pattern, t = fx.t;
    if (p.id === 'ice') {
      this.iceTarget = clampField({ x: (this.iceTarget ?? this.pos!).x + dx, y: (this.iceTarget ?? this.pos!).y + dy });
      const r = iceStep(this.pos!, this.iceVel, this.iceTarget, dtMs);
      this.pos = r.pos; this.iceVel = r.vel;
      return;
    }
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP));
    let q = this.pos!;
    for (let i = 0; i < n; i++) q = pushOut(p, clampField({ x: q.x + dx / n, y: q.y + dy / n }), t);
    q = vortexStep(p, q, t, dtMs);
    this.pos = pushOut(p, q, t);
  }

  /** 오오라 끌림: target 쪽으로 dist만큼 (넘어가지 않음). 반대·감도 감소 중이면 끌린 양을 따로 쌓아 다음 프레임에도 유지 */
  pull(target: Point, dist: number) {
    if (!this.pos) return;
    const dx = target.x - this.pos.x, dy = target.y - this.pos.y, dd = Math.hypot(dx, dy);
    if (dd < 1e-6) return;
    const k = Math.min(1, dist / dd);
    const next = clampField({ x: this.pos.x + dx * k, y: this.pos.y + dy * k });
    if (this.key && this.key !== 'a' && this.key !== 'p') this.off = { x: this.off.x + next.x - this.pos.x, y: this.off.y + next.y - this.pos.y };
    this.pos = next;
  }

  /**
   * 누르는 순간: 터치처럼 움직임 없이 누르면 이번 진짜 위치로 바로 맞춘다 (다음 프레임을 기다리지 않음).
   * 미끄러지는 중·감도 감소·오오라만 걸린 때는 그대로 (그때는 늦게 따라가는 게 효과)
   */
  snap(mode: CursorMode | null) {
    if (!this.real || !this.pos || this.slideFrom || mode?.slow || this.key === 'a' || this.key === 'p') return;
    this.pos = this.targetOf(mode);
  }

  /** 효과에 맞는 목표 위치 + 오오라에 끌린 양 (필드 안) */
  private targetOf(mode: CursorMode | null) {
    const t = cursorTarget(this.real!, mode);
    return clampField({ x: t.x + this.off.x, y: t.y + this.off.y });
  }

  /** 창을 떠남(탭 전환·다른 창): 커서를 지운다 */
  leave() { this.pos = null; this.real = null; this.key = ''; this.slideFrom = null; this.delta = { x: 0, y: 0 }; this.off = { x: 0, y: 0 }; }
}

const clampField = (p: Point): Point => ({ x: Math.max(0, Math.min(FIELD.w, p.x)), y: Math.max(0, Math.min(FIELD.h, p.y)) });

/**
 * 커서 위치를 서버로 보낸다 (초당 sendHz번). 움직이지 않아도 0.25초마다 한 번은 보내서
 * 가만히 있는 커서가 "오래된 커서"로 빠지지 않게 한다. get이 null이면 보내지 않는다. 해제 함수를 돌려준다
 */
export function startCursorSync(get: () => Point | null, send: (p: Point) => void) {
  let last = '', lastAt = 0;
  const id = window.setInterval(() => {
    const p = get();
    if (!p) return;
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const key = `${q.x},${q.y}`;
    const now = performance.now();
    if (key === last && now - lastAt < 250) return;
    last = key; lastAt = now;
    send(q);
  }, 1000 / RULES.cursor.sendHz);
  return () => clearInterval(id);
}
