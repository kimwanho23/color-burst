/** 캔버스 위 DOM 연출: 아이템 룰렛 팝업, 내 버프 바, 점수판 버프 아이콘 */
import {
  HOST_EVENTS, HOST_EVENT_IDS, ITEMS, ITEM_IDS,
  type BuffId, type HostResult, type ItemId, type ItemTier, type PlayerState,
} from '@color-burst/shared';
import { UI, hostIcon, icon, itemIcon } from './icons.ts';

/** 진행자 이름 (캐릭터가 정해지면 여기만 바꾸면 된다) */
export const HOST_NAME = '진행자';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 버프 바·점수판에 보여 줄 순서 (버프 이름 = 그 아이템 id) */
const BUFF_IDS: BuffId[] = ['double', 'wideHand', 'magnet', 'paint', 'comboLock', 'guard', 'missGuard'];

/**
 * 아이템을 잡은 자리에 아이콘 룰렛을 띄운다: 0.4초 동안 무작위 아이콘이 바뀌다가 결과에서 멈추고 이름을 보여 준다.
 * sx, sy: #stage 기준 화면 좌표
 */
export function showItemPop(host: HTMLElement, sx: number, sy: number, item: ItemId, tier: ItemTier, reduce: boolean) {
  const el = document.createElement('div');
  el.className = `itempop it${tier}`;
  el.style.left = `${sx}px`;
  el.style.top = `${sy}px`;
  el.innerHTML = `<span class="ic"></span><b></b>`;
  host.appendChild(el);
  const ic = el.querySelector<HTMLElement>('.ic')!;
  const name = el.querySelector<HTMLElement>('b')!;
  const settle = () => {
    ic.innerHTML = itemIcon(item, 26);
    name.textContent = ITEMS[item].name;
    el.classList.add('done');
  };
  if (reduce) settle();
  else {
    let n = 0;
    const spin = window.setInterval(() => {
      ic.innerHTML = itemIcon(ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)], 26);
      if (++n >= 8) { clearInterval(spin); settle(); }
    }, 50);
  }
  setTimeout(() => el.remove(), 1400);
}

/** 내 버프: 아이콘 + 원형 남은 시간, 끝나기 1초 전 깜빡임. 황금 손은 남은 개수 */
export function renderBuffBar(el: HTMLElement, p: PlayerState | undefined, now: number, durOf: (id: BuffId) => number) {
  if (!p) { el.innerHTML = ''; return; }
  const items: string[] = [];
  for (const id of BUFF_IDS) {
    const left = (p.buffs[id] ?? 0) - now;
    if (left <= 0) continue;
    const frac = Math.min(1, left / durOf(id));
    items.push(`<span class="buff it${ITEMS[id].tier}${left < 1000 ? ' blink' : ''}" style="--f:${frac}" title="${ITEMS[id].name}">${itemIcon(id, 18)}</span>`);
  }
  if (p.goldLeft > 0) items.push(`<span class="buff it1 gold" style="--f:1" title="${ITEMS.goldHand.name}">${itemIcon('goldHand', 18)}<em>${p.goldLeft}</em></span>`);
  const html = items.join('');
  if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; }
}

/** 점수판 칩용 작은 버프 아이콘 */
export function buffChips(p: PlayerState, now: number, size = 12) {
  const ids: ItemId[] = BUFF_IDS.filter((id) => (p.buffs[id] ?? 0) > now);
  if (p.goldLeft > 0) ids.push('goldHand');
  if (!ids.length) return '';
  return `<span class="buffs-mini">${ids.map((id) => `<span class="bm it${ITEMS[id].tier}" title="${ITEMS[id].name}">${itemIcon(id, size)}</span>`).join('')}</span>`;
}

/**
 * 진행자 이벤트: 진행자가 내려오고, 이벤트 칸 9개를 불빛이 돌다가 결과에서 멈춘 뒤 결과 카드를 보여 준다 (약 2.5초).
 * reduce면 룰렛 없이 결과 카드만. 끝나면 resolve
 */
export function showHost(host: HTMLElement, r: HostResult, players: PlayerState[], myId: string, reduce: boolean): Promise<void> {
  const el = document.createElement('div');
  el.className = 'hostov';
  const cells = HOST_EVENT_IDS.map((id) => `<span class="hcell" data-id="${id}" title="${HOST_EVENTS[id].name}">${hostIcon(id, 22)}</span>`).join('');
  const changes = r.changes.filter((c) => c.delta).map((c) => {
    const p = players.find((x) => x.id === c.playerId);
    return `<li class="${c.delta > 0 ? 'plus' : 'minus'}"><span>${esc(c.playerId === myId ? '나' : p?.name ?? '')}</span><b>${c.delta > 0 ? '+' : ''}${c.delta}</b></li>`;
  }).join('');
  el.innerHTML = `<div class="hostcard">
    <div class="hosthead">${icon(UI.host, 26)}<b>${HOST_NAME} 등장!</b></div>
    <div class="hwheel">${cells}</div>
    <div class="hresult"><h3>${hostIcon(r.id, 20)} ${HOST_EVENTS[r.id].name}</h3><p>${esc(r.text)}</p>${changes ? `<ul>${changes}</ul>` : ''}</div>
  </div>`;
  host.appendChild(el);
  const cellEls = [...el.querySelectorAll<HTMLElement>('.hcell')];
  const target = HOST_EVENT_IDS.indexOf(r.id);
  return new Promise((resolve) => {
    const finish = (ms: number) => setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 250); }, ms);
    const reveal = () => { cellEls[target]?.classList.add('on', 'hit'); el.classList.add('done'); };
    if (reduce) { reveal(); finish(1200); return; }
    // 불빛이 한 바퀴 넘게 돌고 점점 느려지다 결과 칸에서 멈춘다
    const steps = HOST_EVENT_IDS.length + target;
    let i = 0;
    const tick = () => {
      cellEls.forEach((c, k) => c.classList.toggle('on', k === i % cellEls.length));
      if (i >= steps) { reveal(); finish(900); return; }
      i++;
      setTimeout(tick, 30 + (i / steps) ** 2 * 120);
    };
    setTimeout(tick, 250);
  });
}
