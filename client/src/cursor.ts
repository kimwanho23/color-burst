/** 게임 커서: 화면이 직접 그리는 내 커서. 평소에는 진짜 마우스 위치와 같고, 효과가 걸리면 움직임이 바뀐다 */
import { RULES, nextCursor, type CursorMode, type Point } from '@color-burst/shared';

export class GameCursor {
  /** 필드 좌표. 캔버스 밖이면 null */
  pos: Point | null = null;

  /** real: 진짜 마우스의 필드 좌표, delta: 이번 이동량(필드 단위) */
  move(real: Point, delta: Point, mode: CursorMode | null) {
    this.pos = this.pos ? nextCursor(this.pos, real, delta, mode) : real;
  }

  leave() { this.pos = null; }
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
