/**
 * 게임 방법: 처음 하는 사람을 위한 그림 슬라이드 (처음 화면·대기실에서 열고, 처음 접속 때 한 번 자동).
 * 화면 전체를 덮는 전용 화면. 한 장에 규칙 하나(큰 그림 + 한두 줄), 기본 → 심화 순서로 넘긴다
 */
import { ARCADE, EVOLVE, RULES, comboPeriod, type RoomRules } from '@color-burst/shared';
import { ART, type ArtNums } from './guideArt.ts';
import { UI, icon } from './icons.ts';

export type GuideTab = 'basic' | 'more';
const TABS: [GuideTab, string][] = [['basic', '기본'], ['more', '심화']];

export interface GuideSlide { id: string; tab: GuideTab; title: string; text: string; off: boolean; art: string }

/**
 * 슬라이드 목록 (DOM 없이 만든다). 숫자는 방 규칙(rules)과 RULES에서.
 * inRoom이면 그 방에서 꺼진 요소를 off로 (방 밖에서는 표시하지 않음)
 */
export function guideSlides(tab: GuideTab, rules: RoomRules, inRoom = true): GuideSlide[] {
  const P = RULES.points, F = RULES.fever, B = RULES.boss;
  const nums: ArtNums = {
    own: P.own, yellow: P.yellow, rainbow: P.rainbow, combo: comboPeriod(0), comboBonus: RULES.comboBonus,
    feverMult: rules.feverMult, feverSec: rules.feverSec, steal: P.stealCalm, markSec: rules.markSec, counter: P.counter,
    missGauge: -F.miss, zones: RULES.zones.mult, bossKill: B.kill, bossMvp: B.mvp, bossSolo: B.solo.points,
    gold: RULES.gold.points, rounds: ARCADE.rounds,
  };
  const s = (id: string, title: string, text: string, offInRoom = false): GuideSlide =>
    ({ id, tab, title, text, off: inRoom && offInRoom, art: ART[id]!(nums) });
  if (tab === 'basic') {
    const z = RULES.zones.mult;
    return [
      s('controls', '조작', '판 위의 원을 클릭해서 잡아요. Esc나 P로 멈추고, M으로 소리를 꺼요. 마우스 감도는 설정에서 바꿀 수 있어요.'),
      s('goal', '목표', '가운데에서 터져 나오는 원을 4명이 동시에 노려요. 점수가 가장 높은 사람이 이겨요.'),
      s('points', '원 점수', `내 색 원 +${P.own}, 노란 원 +${P.yellow}(누구나 잡을 수 있음), 무지개 원 +${P.rainbow}.`),
      s('combo', '콤보', `쉬지 않고 원을 잡으면 콤보가 올라요. ${comboPeriod(0)}콤보마다 콤보 보너스 +${RULES.comboBonus}.`),
      s('fever', '피버', `원을 잡으면 피버 게이지가 차요(내 색 +${F.own}). 가득 차면 ${rules.feverSec}초 동안 점수 ×${rules.feverMult}. 피버 중에는 노란 원도 내 색이고, 남의 색을 잡아도 페널티가 없어요.`),
      s('steal', '견제', `남의 색 원을 잡으면 +${P.stealCalm}. 그 사람 콤보를 끊지만, 내 콤보도 끊기고 피버 게이지가 ${-F.stealCalm} 줄고 ${rules.markSec}초 동안 표적이 돼요.`, !rules.stealPenalty),
      s('counter', '반격', `표적이 된 사람의 색 원을 잡으면 +${P.counter}. 견제한 사람에게 되갚아 주세요.`, !rules.stealPenalty || !rules.markSec),
      s('miss', '페널티', `빈 곳을 누르면 콤보가 끊기고 피버 게이지가 ${-F.miss} 줄어요.`, !rules.missPenalty),
      s('zones', '점수 구역', `판은 가운데부터 중앙 ×${z[0]} / 사이 ×${z[1]} / 가장자리 ×${z[2]}. 원을 잡은 자리의 배율이 곱해져요.`),
    ];
  }
  return [
    s('boss', '보스', `큰 보스 원은 여럿이 함께 때려요. 깎은 체력 1마다 +${B.hit}, 막타 +${B.kill}, 가장 많이 때린 사람 +${B.mvp}. 처치될 때 체력의 ${B.solo.pct}% 이상을 깎았으면 독식 +${B.solo.points}.`, !rules.boss),
    s('bossTypes', '보스 종류', '방어형은 보호막이 있을 때 막혀요. 공격형은 붉을 때 때리면 감점. 이동형은 둘레의 고리에 커서가 끌려가요.', !rules.boss),
    s('gold', '황금 원', `가끔 나오는 작고 빠른 금빛 원. 직접 눌러야 잡히고 +${RULES.gold.points}에 배율이 붙어요.`),
    s('items', '아이템 원', '? 원을 잡으면 무작위 아이템(넓은 손, 자석, 점수 2배, 시간 정지 등)이 바로 발동해요.', !rules.items),
    s('laser', '레이저', '경고 띠가 보인 뒤 레이저가 지나가요. 커서가 닿으면 잠깐 클릭할 수 없어요.', !rules.laser),
    s('patterns', '맵 패턴', '라운드 중에 벽·가시 공·소용돌이·빙판 같은 패턴이 경고 뒤 잠깐 나타나요.', rules.mapPct <= 0),
    s('growth', '성장 증강 · 시너지 · 진화', `아케이드에서 성장 증강은 조건을 채울 때마다 한 칸씩 쌓여 게임 끝까지 남아요. 같은 분류의 서로 다른 증강을 모으면 시너지 보너스, 같은 증강을 ${EVOLVE.count}번 고르면 진화해서 레전드 효과를 얻어요.`, rules.mode !== 'arcade'),
    s('team', '팀전 2:2', '두 명씩 팀을 나눠요. 같은 팀 색 원은 내 색처럼 잡고, 견제는 상대 팀에게만 돼요. 두 사람 점수의 합으로 이겨요.', !rules.team),
    s('survival', '서바이벌', `${rules.mode === 'arcade' ? '뒤쪽 라운드가 끝날 때마다' : `${RULES.survival.everyMs / 1000}초마다`} 꼴찌가 탈락해요. 탈락하면 구경만 할 수 있고, 마지막까지 남은 사람이 이겨요.`, !rules.survival),
    s('coop', '협력전', `모두 같은 편이 되어 ${RULES.coop.timeSec}초 안에 레이드 보스를 잡아요. 사람마다 생명 ${RULES.coop.lives}개. 레이저·장판에 맞거나 내 색 테두리의 공격 원을 놓치면 −1이고, 맞은 뒤 ${RULES.coop.immuneMs / 1000}초는 무적이에요. 피버 중에는 보스 피해 ×${RULES.coop.feverDmg}. 보스 체력 단계마다 다 같이 카드 하나를 골라요.`, !rules.coop),
    s('arcade', '아케이드', `${ARCADE.rounds}라운드를 이어서 해요. 라운드가 끝날 때마다 증강을 골라요(노말·레어·에픽·레전드). 정해진 증강을 모으면 조합 보너스, 가끔 큰 보상과 대가가 붙은 저주 카드도 나와요. 꼴찌에게는 역전 기회가 있어요.`, rules.mode !== 'arcade'),
  ];
}

const OFF_NOTE = '이 방에선 꺼져 있어요';

/** 슬라이드 한 장 HTML */
export function slideHTML(sl: GuideSlide): string {
  return `<div class="gs-art${sl.off ? ' off' : ''}">${sl.art}</div>`
    + `<h2>${sl.title}${sl.off ? `<em class="gs-off">${OFF_NOTE}</em>` : ''}</h2><p>${sl.text}</p>`;
}

/** 한 탭의 슬라이드를 모두 이어 붙인 HTML (테스트용: 숫자·꺼짐 표시 확인) */
export function guideBody(tab: GuideTab, rules: RoomRules, inRoom = true): string {
  return guideSlides(tab, rules, inRoom).map(slideHTML).join('');
}

let closeCurrent: (() => void) | null = null;

/**
 * 게임 방법 화면을 연다 (inRoom: 방 안이면 꺼진 요소 표시). 닫기 버튼·Esc·마지막 장의 [다 봤어요]로 닫힌다.
 * onPractice: 방 밖에서 열었을 때 '기본' 마지막 장과 전체 마지막 장에 [직접 해 보기] (누르면 닫고 튜토리얼)
 */
export function openGuide(_host: HTMLElement, rules: RoomRules, inRoom: boolean, onPractice?: () => void) {
  closeCurrent?.();
  const all = [...guideSlides('basic', rules, inRoom), ...guideSlides('more', rules, inRoom)];
  let at = 0;
  const el = document.createElement('div');
  el.className = 'guide-screen';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '게임 방법');
  el.innerHTML = `<header class="gs-head">
      <b class="gs-title">게임 방법</b>
      <div class="seg gs-tabs">${TABS.map(([id, name]) => `<button type="button" data-tab="${id}">${name}</button>`).join('')}</div>
      <button class="iconbtn x" type="button" data-close aria-label="닫기">${icon(UI.close, 20)}</button>
    </header>
    <article class="gs-slide" aria-live="polite"></article>
    <footer class="gs-foot">
      <button class="btn ghost gs-prev" type="button" data-prev>${icon(UI.prev, 20)}<span>이전</span></button>
      <div class="gs-dots"></div>
      <div class="gs-right"><button class="btn ghost gs-practice" type="button" data-practice hidden>직접 해 보기</button>
      <button class="btn gs-next" type="button" data-next></button></div>
    </footer>`;
  document.body.appendChild(el);
  const slide = el.querySelector<HTMLElement>('.gs-slide')!;
  const dots = el.querySelector<HTMLElement>('.gs-dots')!;
  const prev = el.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = el.querySelector<HTMLButtonElement>('[data-next]')!;
  const practice = el.querySelector<HTMLButtonElement>('[data-practice]')!;
  const canPractice = !!onPractice && !inRoom;

  const show = (i: number, dir = 0) => {
    at = Math.max(0, Math.min(all.length - 1, i));
    const sl = all[at]!;
    slide.innerHTML = slideHTML(sl);
    slide.classList.remove('in-l', 'in-r');
    if (dir) { void slide.offsetWidth; slide.classList.add(dir > 0 ? 'in-r' : 'in-l'); }
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === sl.tab)));
    const same = all.map((x, j) => [x, j] as const).filter(([x]) => x.tab === sl.tab);
    dots.innerHTML = same.map(([x, j]) =>
      `<button type="button" data-go="${j}" aria-label="${x.title}" aria-current="${j === at}"></button>`).join('');
    prev.disabled = at === 0;
    const last = at === all.length - 1;
    const toMore = sl.tab === 'basic' && all[at + 1]?.tab === 'more';
    practice.hidden = !(canPractice && (last || toMore));
    next.innerHTML = last ? '<span>다 봤어요</span>' : `<span>${toMore ? '심화로' : '다음'}</span>${icon(UI.next, 20)}`;
  };
  const go = (d: number) => { if (d > 0 && at === all.length - 1) { close(); return; } if (at + d >= 0 && at + d < all.length) show(at + d, d); };

  const close = () => {
    el.remove();
    window.removeEventListener('keydown', onKey, true);
    if (closeCurrent === close) closeCurrent = null;
  };
  closeCurrent = close;
  const onKey = (e: KeyboardEvent) => {
    const k = { Escape: 0, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (k === undefined) return;
    e.stopPropagation(); e.preventDefault();
    if (k === 0) close(); else go(k);
  };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { close(); return; }
    if (t.closest('[data-practice]')) { close(); onPractice?.(); return; }
    if (t.closest('[data-prev]')) { go(-1); return; }
    if (t.closest('[data-next]')) { go(1); return; }
    const goTo = t.closest<HTMLElement>('[data-go]')?.dataset.go;
    if (goTo !== undefined) { show(Number(goTo), Number(goTo) - at); return; }
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as GuideTab | undefined;
    if (tab) { const j = all.findIndex((x) => x.tab === tab); show(j, j - at); }
  });
  // 터치: 좌우로 밀어 넘기기
  let sx = 0, sy = 0;
  slide.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  slide.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });
  show(0);
  next.focus();
}

/** 게임 방법 화면이 열려 있으면 닫는다 (게임이 시작될 때) */
export function closeGuide() { closeCurrent?.(); }
