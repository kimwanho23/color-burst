/** 게임 화면 누르기 구분: 마우스 왼쪽·터치·펜은 클릭 판정, 마우스 오른쪽은 보호막, 그 밖의 마우스 버튼은 무시 */
export function pointerAction(pointerType: string, button: number): 'click' | 'barrier' | 'ignore' {
  if (pointerType !== 'mouse') return 'click';
  return button === 0 ? 'click' : button === 2 ? 'barrier' : 'ignore';
}
