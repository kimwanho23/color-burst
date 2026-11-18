/** 보호막 요청 뒤 서버 응답(players)을 기다리는 최대 시간(ms). 이 안에는 맞은 연출을 미리 내지 않는다 */
export const BARRIER_PENDING_MS = 500;

/** 화면 예측을 건너뛸지: 보호막이 켜져 있거나, 방금 요청했고 남은 횟수가 있어 서버가 켜 줄 것 같으면 true */
export function barrierGuarding(fx: { barrierUntil: number; barrierLeft: number } | undefined, requestedAt: number, now: number): boolean {
  if (!fx) return false;
  if (now < fx.barrierUntil) return true;
  return fx.barrierLeft > 0 && requestedAt > 0 && now - requestedAt < BARRIER_PENDING_MS;
}

/** 게임 화면 누르기 구분: 마우스 왼쪽·터치·펜은 클릭 판정, 마우스 오른쪽은 보호막, 그 밖의 마우스 버튼은 무시 */
export function pointerAction(pointerType: string, button: number): 'click' | 'barrier' | 'ignore' {
  if (pointerType !== 'mouse') return 'click';
  return button === 0 ? 'click' : button === 2 ? 'barrier' : 'ignore';
}
