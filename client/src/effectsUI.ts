/** 캔버스 위 DOM 연출: 아이템 룰렛 팝업, 내 버프 바, 점수판 버프 아이콘 */
import {
  COMBOS, EVENTS, EVENT_IDS, ITEMS, ITEM_IDS, combosOf,
  type BuffId, type ComboId, type DebuffId, type EventResult, type ItemId, type ItemTier, type PlayerState,
} from '@color-burst/shared';
import { UI, eventIcon, icon, itemIcon } from './icons.ts';
import { comboTip } from './arcadeUI.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 게임 중 내 완성 조합 칩: "이름 · 효과" (철옹성은 남은 횟수). p가 없으면 비움.
 * 원 클릭을 가리지 않게 마우스 반응이 없어서 설명을 칩 안에 글자로 쓴다. 바뀔 때만 다시 그린다
 */
export function renderComboBar(el: HTMLElement, p: PlayerState | undefined) {
  const ids = p ? [...combosOf(p.picks)] : [];
  const sig = `${ids.join(',')}|${ids.includes('ironWall') ? p!.ironLeft : ''}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = ids.map((id) => {
    const c = COMBOS.find((x) => x.id === id)!;
    const n = id === 'ironWall' ? ` ${p!.ironLeft}` : '';
    return `<span class="cbchip${id === 'ironWall' && !p!.ironLeft ? ' spent' : ''}" data-c="${id}" data-tip="${esc(comboTip(id, p!.picks))}">${icon(UI.combo, 13)}<b>${esc(c.name)}${n}</b><span>${esc(c.text)}</span></span>`;
  }).join('');
}

/** 조합 효과가 발동하면 그 칩을 잠깐 반짝인다 (그 조합이 없으면 아무것도 안 함) */
export function flashCombo(el: HTMLElement, id: ComboId) {
  const c = el.querySelector<HTMLElement>(`[data-c="${id}"]`);
  if (!c) return;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
}

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

/** 아이템 획득 알림: 화면 위쪽에 "이름: 아이템" 줄을 쌓는다 (최대 3줄, 줄마다 1.2초) */
export function pushFeed(el: HTMLElement, iconHtml: string, text: string, col: string) {
  const row = document.createElement('div');
  row.className = 'feedrow';
  row.style.setProperty('--pc', col);
  row.innerHTML = `${iconHtml}<span>${esc(text)}</span>`;
  el.appendChild(row);
  while (el.children.length > 3) el.firstElementChild!.remove();
  setTimeout(() => row.remove(), 1200);
}

/** 점수판 칩 위로 아이콘이 떠오른다 (0.8초). 점수판이 다시 그려져도 지워지지 않게 body에 붙인다 */
export function popOnChip(scoresEl: HTMLElement, playerId: string, iconHtml: string) {
  const chip = scoresEl.querySelector<HTMLElement>(`.chip[data-id="${CSS.escape(playerId)}"]`);
  if (!chip) return;
  const r = chip.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'chippop';
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  el.innerHTML = iconHtml;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

/** 내 버프: 아이콘 + 원형 남은 시간, 끝나기 1초 전 깜빡임. 황금 손은 남은 개수 */
/** 방해 디버프 → 아이콘으로 보여 줄 아이템 */
const DEBUFF_ITEM: Record<DebuffId, ItemId> = { slow: 'slowCursor', invert: 'invertCursor', blind: 'blind' };

export function renderBuffBar(el: HTMLElement, p: PlayerState | undefined, now: number, durOf: (id: BuffId) => number, debuffMs: (id: DebuffId) => number, comebackMult = 0) {
  if (!p) { el.innerHTML = ''; return; }
  const items: string[] = [];
  // 역전 기회 배율 (꼴찌인 동안)
  if (comebackMult > 1) items.push(`<span class="buff comeback" title="역전 기회: 꼴찌인 동안 점수 배율">×${comebackMult}</span>`);
  // 방해 (붉은 테두리)
  for (const id of Object.keys(DEBUFF_ITEM) as DebuffId[]) {
    const left = (p.debuffs[id] ?? 0) - now;
    if (left <= 0) continue;
    const it = DEBUFF_ITEM[id];
    items.push(`<span class="buff debuff${left < 1000 ? ' blink' : ''}" style="--f:${Math.min(1, left / debuffMs(id))}" title="${ITEMS[it].name}">${itemIcon(it, 18)}</span>`);
  }
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

/** 랜덤 이벤트 결과를 읽을 수 있게 띄워 두는 시간 (선택 시간 보너스 안에서 끝나야 한다) */
const RESULT_MS = 2200;

/**
 * 랜덤 이벤트: 카드가 가운데에서 커지며 나타나고, 이벤트 칸 9개를 불빛이 돌다가 결과에서 멈춘 뒤 결과를 보여 준다 (약 2.5초).
 * reduce면 룰렛 없이 결과 카드만. onTick: 룰렛이 한 칸 넘어갈 때(false)와 결과가 나올 때(true). 끝나면 resolve
 */
export function showRandomEvent(host: HTMLElement, r: EventResult, players: PlayerState[], myId: string, reduce: boolean, onTick?: (result: boolean) => void): Promise<void> {
  const el = document.createElement('div');
  el.className = 'eventov';
  const cells = EVENT_IDS.map((id) => `<span class="ecell" data-id="${id}" title="${EVENTS[id].name}">${eventIcon(id, 22)}</span>`).join('');
  const changes = r.changes.filter((c) => c.delta).map((c) => {
    const p = players.find((x) => x.id === c.playerId);
    return `<li class="${c.delta > 0 ? 'plus' : 'minus'}"><span>${esc(c.playerId === myId ? '나' : p?.name ?? '')}</span><b>${c.delta > 0 ? '+' : ''}${c.delta}</b></li>`;
  }).join('');
  el.innerHTML = `<div class="eventcard">
    <div class="eventhead">${icon(UI.event, 26)}<b>랜덤 이벤트!</b></div>
    <div class="ewheel">${cells}</div>
    <div class="eresult"><h3>${eventIcon(r.id, 20)} ${EVENTS[r.id].name}</h3><p>${esc(r.text)}</p>${changes ? `<ul>${changes}</ul>` : ''}</div>
  </div>`;
  host.appendChild(el);
  const cellEls = [...el.querySelectorAll<HTMLElement>('.ecell')];
  const target = EVENT_IDS.indexOf(r.id);
  return new Promise((resolve) => {
    let closed = false;
    const close = () => { if (closed) return; closed = true; el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 250); };
    // 결과가 나온 뒤에는 화면을 눌러 바로 닫을 수 있다
    el.addEventListener('pointerdown', () => { if (el.classList.contains('done')) close(); });
    const finish = (ms: number) => setTimeout(close, ms);
    const reveal = () => { cellEls[target]?.classList.add('on', 'hit'); el.classList.add('done'); onTick?.(true); };
    if (reduce) { reveal(); finish(RESULT_MS); return; }
    // 불빛이 한 바퀴 넘게 돌고 점점 느려지다 결과 칸에서 멈춘다
    const steps = EVENT_IDS.length + target;
    let i = 0;
    const tick = () => {
      cellEls.forEach((c, k) => c.classList.toggle('on', k === i % cellEls.length));
      onTick?.(false);
      if (i >= steps) { reveal(); finish(RESULT_MS); return; }
      i++;
      setTimeout(tick, 30 + (i / steps) ** 2 * 120);
    };
    setTimeout(tick, 250);
  });
}
