/** 캔버스 위 DOM 연출: 아이템 룰렛 팝업, 내 버프 바, 점수판 버프 아이콘 */
import { ITEMS, ITEM_IDS, type BuffId, type ItemId, type ItemTier, type PlayerState } from '@color-burst/shared';
import { itemIcon } from './icons.ts';

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
