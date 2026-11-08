/** 게임 방법: 처음 하는 사람을 위한 기본·심화 규칙 설명 (처음 화면·대기실에서 열고, 처음 접속 때 한 번 자동) */
import { ARCADE, RULES, comboPeriod, type RoomRules } from '@color-burst/shared';
import { UI, icon } from './icons.ts';

export type GuideTab = 'basic' | 'more';
const TABS: [GuideTab, string][] = [['basic', '기본'], ['more', '심화']];

/**
 * 탭 내용 HTML (DOM 없이 만든다). 숫자는 방 규칙(rules)과 RULES에서.
 * inRoom이면 그 방에서 꺼진 요소를 흐리게 + "이 방에선 꺼져 있어요" (방 밖에서는 표시하지 않음)
 */
export function guideBody(tab: GuideTab, rules: RoomRules, inRoom = true): string {
  const item = (title: string, text: string, offInRoom = false) => {
    const off = inRoom && offInRoom;
    return `<div class="gd-item${off ? ' off' : ''}"><b>${title}</b><p>${text}</p>${off ? '<em>이 방에선 꺼져 있어요</em>' : ''}</div>`;
  };
  const P = RULES.points, F = RULES.fever, B = RULES.boss;
  if (tab === 'basic') {
    const z = RULES.zones.mult;
    return [
      item('목표', '가운데에서 터져 나오는 원을 4명이 동시에 노려요. 점수가 가장 높은 사람이 이겨요.'),
      item('원 점수', `내 색 원 +${P.own}, 노란 원 +${P.yellow}(누구나 잡을 수 있음), 무지개 원 +${P.rainbow}.`),
      item('콤보', `쉬지 않고 원을 잡으면 콤보가 올라요. ${comboPeriod(0)}콤보마다 콤보 보너스 +${RULES.comboBonus}.`),
      item('피버', `원을 잡으면 피버 게이지가 차요(내 색 +${F.own}). 가득 차면 ${rules.feverSec}초 동안 점수 ×${rules.feverMult}. 피버 중에는 노란 원도 내 색이고, 남의 색을 잡아도 페널티가 없어요.`),
      item('견제', `남의 색 원을 잡으면 +${P.stealCalm}. 그 사람 콤보를 끊지만, 내 콤보도 끊기고 피버 게이지가 ${-F.stealCalm} 줄고 ${rules.markSec}초 동안 표적이 돼요.`, !rules.stealPenalty),
      item('반격', `표적이 된 사람의 색 원을 잡으면 +${P.counter}. 견제한 사람에게 되갚아 주세요.`, !rules.stealPenalty || !rules.markSec),
      item('페널티', `빈 곳을 누르면 콤보가 끊기고 피버 게이지가 ${-F.miss} 줄어요.`, !rules.missPenalty),
      item('점수 구역', `판은 가운데부터 중앙 ×${z[0]} / 사이 ×${z[1]} / 가장자리 ×${z[2]}. 원을 잡은 자리의 배율이 곱해져요.`),
    ].join('');
  }
  return [
    item('보스', `큰 보스 원은 여럿이 함께 때려요. 깎은 체력 1마다 +${B.hit}, 막타 +${B.kill}, 가장 많이 때린 사람 +${B.mvp}. 처치될 때 체력의 ${B.solo.pct}% 이상을 깎았으면 독식 +${B.solo.points}.`, !rules.boss),
    item('보스 종류', '방어형은 보호막이 있을 때 막혀요. 공격형은 붉을 때 때리면 감점. 이동형은 둘레의 고리에 커서가 끌려가요.', !rules.boss),
    item('황금 원', `가끔 나오는 작고 빠른 금빛 원. 직접 눌러야 잡히고 +${RULES.gold.points}에 배율이 붙어요.`),
    item('아이템 원', '? 원을 잡으면 무작위 아이템(넓은 손, 자석, 점수 2배, 시간 정지 등)이 바로 발동해요.', !rules.items),
    item('레이저', '경고 띠가 보인 뒤 레이저가 지나가요. 커서가 닿으면 잠깐 클릭할 수 없어요.', !rules.laser),
    item('맵 패턴', '라운드 중에 벽·가시 공·소용돌이·빙판 같은 패턴이 경고 뒤 잠깐 나타나요.', rules.mapPct <= 0),
    item('아케이드', `${ARCADE.rounds}라운드를 이어서 해요. 라운드가 끝날 때마다 증강을 골라요(노말·레어·에픽·레전드). 정해진 증강을 모으면 조합 보너스, 가끔 큰 보상과 대가가 붙은 저주 카드도 나와요. 꼴찌에게는 역전 기회가 있어요.`, rules.mode !== 'arcade'),
  ].join('');
}

let closeCurrent: (() => void) | null = null;

/** 게임 방법 창을 연다 (inRoom: 방 안이면 꺼진 요소 표시). 닫기 버튼·Esc·바깥 클릭으로 닫힌다 */
export function openGuide(host: HTMLElement, rules: RoomRules, inRoom: boolean) {
  closeCurrent?.();
  const el = document.createElement('div');
  el.className = 'overlay codex guide';
  el.innerHTML = `<div class="card wide cx-card" role="dialog" aria-label="게임 방법">
    <div class="cx-head"><b>게임 방법</b><button class="iconbtn x" type="button" data-close aria-label="닫기">${icon(UI.close, 18)}</button></div>
    <div class="seg cx-tabs">${TABS.map(([id, name], i) => `<button type="button" data-tab="${id}" aria-pressed="${i === 0}">${name}</button>`).join('')}</div>
    <div class="cx-body gd-body"></div>
  </div>`;
  host.appendChild(el);
  const body = el.querySelector<HTMLElement>('.gd-body')!;
  const show = (tab: GuideTab) => {
    body.innerHTML = guideBody(tab, rules, inRoom);
    body.scrollTop = 0;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  };
  show('basic');
  const close = () => { el.remove(); window.removeEventListener('keydown', onKey, true); if (closeCurrent === close) closeCurrent = null; };
  closeCurrent = close;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) close();
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as GuideTab | undefined;
    if (tab) show(tab);
  });
}

/** 게임 방법 창이 열려 있으면 닫는다 (게임이 시작될 때) */
export function closeGuide() { closeCurrent?.(); }
