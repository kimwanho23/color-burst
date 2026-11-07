/** 도감: 증강(등급별 수치)·저주·아이템·보스를 한 화면에서 본다 (처음 화면·대기실에서 연다) */
import { ABILITIES, CURSES, ITEMS, ITEM_IDS, ITEM_TIERS, TIERS, type AbilityCategory } from '@color-burst/shared';
import { abilityIcon, categoryIcon, itemIcon } from './icons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Tab = 'ability' | 'curse' | 'item' | 'boss';
const TABS: [Tab, string][] = [['ability', '증강'], ['curse', '저주'], ['item', '아이템'], ['boss', '보스']];

/** 보스 종류 설명 (README '보스 종류'와 같은 내용) */
const BOSSES: [string, string][] = [
  ['일반', '여럿이 함께 때려 잡는 큰 원. 때릴 때 +1, 막타 +20, 가장 많이 때린 사람 +5'],
  ['방어형', '주기적으로 보호막을 두른다. 보호막 중에는 때려도 막힘(0점)'],
  ['공격형', '주기적으로 붉어진다. 붉을 때 때리면 감점(라운드 안에서 때린 횟수만큼 커짐)'],
  ['이동형', '작고 빠르며 벽에서 튕긴다. 둘레의 보랏빛 오오라에 커서가 들어가면 보스 쪽으로 끌리고 0.5초마다 −1, 오오라를 클릭하면 −2'],
];

function abilityTab() {
  const cats = [...new Set(ABILITIES.map((a) => a.cat))] as AbilityCategory[];
  return cats.map((cat) => `<h3>${categoryIcon(cat, 16)} ${cat}</h3><ul class="cx-list">${ABILITIES.filter((a) => a.cat === cat).map((a) => `
    <li><span class="cx-ic">${abilityIcon(a.id, 22)}</span><div><b>${esc(a.name)}</b>${a.cap !== undefined ? `<em class="cx-cap">중첩 상한 ${a.cap}</em>` : ''}
      <ol class="cx-tiers">${a.values.map((v, t) => `<li class="t${t}"><span>${TIERS[t].name}</span>${esc(a.desc(v))}</li>`).join('')}</ol></div></li>`).join('')}</ul>`).join('');
}

function curseTab() {
  return `<p class="hint">가끔 선택지에 섞여 나오는 카드. 큰 보상과 확실한 대가가 함께 온다 (한 게임 1장)</p><ul class="cx-list">${CURSES.map((c) => `
    <li><span class="cx-ic">${abilityIcon(c.id, 22)}</span><div><b>${esc(c.name)}</b><p class="cx-gain">${esc(c.curse!.gain)}</p><p class="cx-cost">대가: ${esc(c.curse!.cost)}</p></div></li>`).join('')}</ul>`;
}

function itemTab() {
  return `<p class="hint"><code>?</code> 아이템 원을 잡으면 그 자리에서 바로 발동. 테두리 색이 등급</p>${ITEM_TIERS.map((tier, t) => `<h3 class="it${t}">${tier.name}</h3><ul class="cx-list">${ITEM_IDS.filter((id) => ITEMS[id].tier === t).map((id) => `
    <li><span class="cx-ic it${t}">${itemIcon(id, 22)}</span><div><b>${esc(ITEMS[id].name)}</b>${ITEMS[id].sabotage ? '<em class="cx-sab">방해</em>' : ''}<p>${esc(ITEMS[id].desc)}</p></div></li>`).join('')}</ul>`).join('')}`;
}

function bossTab() {
  return `<ul class="cx-list">${BOSSES.map(([n, d]) => `<li><div><b>${n}</b><p>${esc(d)}</p></div></li>`).join('')}</ul>`;
}

const BODY: Record<Tab, () => string> = { ability: abilityTab, curse: curseTab, item: itemTab, boss: bossTab };

/** 도감 창을 연다. 닫기 버튼·Esc·바깥 클릭으로 닫힌다 */
export function openCodex(host: HTMLElement) {
  host.querySelector('.codex')?.remove();
  const el = document.createElement('div');
  el.className = 'overlay codex';
  el.innerHTML = `<div class="card wide cx-card" role="dialog" aria-label="도감">
    <div class="cx-head"><b>도감</b><button class="link" type="button" data-close>닫기</button></div>
    <p class="hint cx-note">같은 증강을 또 고르면 수치가 더해져요 (중첩). 일부는 상한이 있어요</p>
    <div class="seg cx-tabs">${TABS.map(([id, name], i) => `<button type="button" data-tab="${id}" aria-pressed="${i === 0}">${name}</button>`).join('')}</div>
    <div class="cx-body"></div>
  </div>`;
  host.appendChild(el);
  const body = el.querySelector<HTMLElement>('.cx-body')!;
  const show = (tab: Tab) => {
    body.innerHTML = BODY[tab]();
    body.scrollTop = 0;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  };
  show('ability');
  const close = () => { el.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) close();
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tab) show(tab);
  });
}
