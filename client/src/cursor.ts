/** 게임 커서: 화면이 직접 그리는 내 커서. 평소에는 진짜 마우스 위치와 같고, 효과가 걸리면 움직임이 바뀐다 */
import { FIELD, RULES, nextCursor, slideBack, type CursorMode, type Point } from '@color-burst/shared';

export class GameCursor {
  /** 필드 좌표. 캔버스 밖이면 null */
  pos: Point | null = null;
  /** 마지막 진짜 마우스 위치 */
  private real: Point | null = null;
  /** 효과가 걸려 있던 중인지 (끝나면 진짜 위치로 미끄러져 돌아온다) */
  private wasMode = false;
  private slideFrom: Point | null = null;
  private slideAt = 0;

  /** real: 진짜 마우스의 필드 좌표, delta: 이번 이동량(필드 단위), mode: 감도 감소·반대·오오라 (없으면 null) */
  move(real: Point, delta: Point, mode: CursorMode | null) {
    this.real = real;
    if (!this.pos) { this.pos = real; return; }
    if (mode) { this.pos = nextCursor(this.pos, real, delta, mode); this.wasMode = true; this.slideFrom = null; return; }
    this.settle();
  }

  /** 매 프레임: 효과가 막 끝났으면 진짜 위치로 돌아오는 중 */
  frame(mode: CursorMode | null) {
    if (mode) { this.wasMode = true; return; }
    this.settle();
  }

  /** 오오라 끌림: target 쪽으로 dist만큼 (넘어가지 않음) */
  pull(target: Point, dist: number) {
    if (!this.pos) return;
    const dx = target.x - this.pos.x, dy = target.y - this.pos.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const k = Math.min(1, dist / d);
    this.pos = { x: Math.max(0, Math.min(FIELD.w, this.pos.x + dx * k)), y: Math.max(0, Math.min(FIELD.h, this.pos.y + dy * k)) };
    this.wasMode = true;
  }

  leave() { this.pos = null; this.real = null; this.wasMode = false; this.slideFrom = null; }

  private settle() {
    if (!this.real || !this.pos) return;
    if (this.wasMode) { this.wasMode = false; this.slideFrom = this.pos; this.slideAt = performance.now(); }
    if (!this.slideFrom) { this.pos = this.real; return; }
    const e = performance.now() - this.slideAt;
    this.pos = slideBack(this.slideFrom, this.real, e);
    if (e >= RULES.sabotage.slideMs) this.slideFrom = null;
  }
}

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
