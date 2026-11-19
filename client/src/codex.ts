/** 도감: 증강(등급별 수치)·조합·저주·특별·아이템·보스·규칙(점수표)을 한 화면에서 본다 (위쪽 바·처음 화면·대기실에서 연다) */
import { ABILITIES, ABILITY, COMBOS, treasureEvery, CURSES, EVOLVE, SYNERGY, ITEMS, ITEM_IDS, ITEM_TIERS, LEGEND_TEXT, RULES, SPECIALS, TIERS, UNIQUES, DEFAULT_RULES, comboProgress, type AbilityCategory, type AbilityId, type Pick } from '@color-burst/shared';
import { UI, abilityIcon, categoryIcon, comboIcon, icon, itemIcon } from './icons.ts';
import { scoreTable } from './rulesUI.ts';

/** 도감을 여는 곳의 상태: 내 증강(조합 진행도) */
export interface CodexCtx { picks?: readonly Pick[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Tab = 'ability' | 'unique' | 'combo' | 'curse' | 'special' | 'item' | 'boss' | 'rules';
const TABS: [Tab, string][] = [['ability', '증강'], ['unique', '유니크'], ['combo', '조합'], ['curse', '저주'], ['special', '특별'], ['item', '아이템'], ['boss', '보스'], ['rules', '규칙']];

/** 보스 종류 설명 (README '보스 종류'와 같은 내용) */
const BOSSES: [string, string][] = [
  ['일반', '여럿이 함께 때려 잡는 큰 원. 때릴 때 +1, 막타 +20, 가장 많이 때린 사람 +5'],
  ['방어형', '주기적으로 보호막을 두른다. 보호막 중에는 때려도 막힘(0점)'],
  ['공격형', '주기적으로 붉어진다. 붉을 때 때리면 감점(라운드 안에서 때린 횟수만큼 커짐)'],
  ['이동형', `작고 빠르며 벽에서 튕긴다. 둘레의 보랏빛 오오라에 커서가 들어가면 보스 쪽으로 끌리고 ${RULES.aura.tickMs / 1000}초마다 피버 게이지 −${RULES.aura.feverLoss}, 콤보 ${100 - RULES.aura.comboKeepPct}% 감소 (피버 중이면 들어갈 때 남은 피버 시간 절반)`],
  ['레이드 보스 (협력전)', `화면 위쪽에서 좌우로 움직이며 색 원을 뿜는 거대 보스. 보스를 직접 눌러서는 피해가 들어가지 않고, 보스가 뿜은 내 색 원(과 노란 원)을 잡아야 피해가 들어가요. 원을 이어 잡을수록 피해가 커져요. 체력 ${Math.round(RULES.coop.phaseAt[0] * 100)}%·${Math.round(RULES.coop.phaseAt[1] * 100)}%에서 보호막을 둘러요`],
  ['수정 (협력전)', `보호막이 올라오면 판 가장자리에 사람마다 자기 색 수정이 생겨요. 주인만 깰 수 있고, 여러 번 눌러야 깨져요. 모두 깨면 보스가 무너져 잠깐 동안 피해가 크게 들어가고, 제한 시간 안에 못 깨면 분노 공격으로 모두 체력이 깎여요(엑스퍼트는 곧바로 패배). 수정 자리에는 위험한 탄막이 쏟아지고, 빨리 깰수록 큰 피해 구간이 길어져요`],
  ['탄막 (협력전)', `보스가 무늬(부채꼴·소용돌이·조준·벽 등) 단위로 쏘는 탄. ${RULES.coop.skillEveryMs / 1000}초마다 고유 패턴이 바뀌고, 보스 판에는 구역 봉인·내려오는 벽·회전 빔이 더해져요. 탄에 맞으면 체력이 깎이고 잠깐 무적이에요. 크게 맞으면 기절해 커서가 멈춰요`],
  ['추적 원 (협력전)', `보스가 뿌리는 가시 원. 테두리 색 사람이 표적이고, 화면 밖으로 놓치면 그 사람 체력이 깎여요. 누구나 터뜨릴 수 있어요`],
  ['내려찍기 (협력전)', '2단계부터. 내 커서 자리에 원형 경고가 차오르고, 다 차면 그 자리를 내려쳐요. 원 밖으로 피하세요'],
  ['안전지대 (협력전)', '3단계부터. 판이 붉게 덮이고 밝은 안전지대만 남아요. 안전지대는 줄어들며 옮겨 가고, 발동할 때 밖에 있으면 체력이 깎여요'],
  ['황금 원 (보스 아님)', `작고 아주 빠르게 벽에서 튕기는 금빛 원. 한 판에 1~3번, 5초 뒤 사라짐. 직접 클릭으로 잡으면 +${RULES.gold.points}에 일반 원과 같은 배율(피버·점수 구역·아이템·잭팟 등)`],
];

function capText(id: AbilityId, cap: number) {
  if (id === 'treasure') return `최소 ${treasureEvery(cap)}콤보 간격`;
  return `중첩 상한 ${id === 'precise' ? `×${1 + cap}` : cap}`;
}

export function abilityTab() {
  const cats = [...new Set(ABILITIES.map((a) => a.cat))] as AbilityCategory[];
  const syn = (Object.keys(SYNERGY) as (keyof typeof SYNERGY)[]).map((c) => `<li><b>${c} ${SYNERGY[c].need}종</b> · ${esc(SYNERGY[c].text)}</li>`).join('');
  const rules = `<p class="hint">같은 증강을 ${EVOLVE.count}번 고르면 <b>진화</b>: 레전드 효과를 얻고 중첩 상한이 ${EVOLVE.capMult}배가 돼요. 성장 증강은 조건을 채울 때마다 한 칸씩 쌓여 게임 끝까지 남아요.</p>
    <h3>시너지 (같은 분류의 서로 다른 증강)</h3><ul class="cx-syn">${syn}</ul>`;
  return rules + cats.map((cat) => `<h3>${categoryIcon(cat, 16)} ${cat}</h3><ul class="cx-list">${ABILITIES.filter((a) => a.cat === cat).map((a) => `
    <li><span class="cx-ic">${abilityIcon(a.id, 22)}</span><div><b>${esc(a.name)}</b>${a.cap !== undefined ? `<em class="cx-cap">${capText(a.id, a.cap)}</em>` : ''}
      <ol class="cx-tiers">${a.values.map((v, t) => `<li class="t${t}"><span>${TIERS[t].name}</span>${esc(a.desc(v))}</li>`).join('')}</ol>
      ${LEGEND_TEXT[a.id] ? `<p class="cx-legend">레전드 효과: ${esc(LEGEND_TEXT[a.id]!)}</p>` : ''}</div></li>`).join('')}</ul>`).join('');
}

export function uniqueTab() {
  return `<p class="hint">플레이어마다 한 게임에 한 장을 고를 수 있어요.</p><ul class="cx-list">${UNIQUES.map((a) => `
    <li><span class="cx-ic unique">${abilityIcon(a.id, 22)}</span><div><b>${esc(a.name)}</b><p>${esc(a.desc(1))}</p></div></li>`).join('')}</ul>`;
}

function curseTab() {
  return `<p class="hint">가끔 선택지에 섞여 나오는 카드. 큰 보상과 확실한 대가가 함께 온다 (한 게임 1장)</p><ul class="cx-list">${CURSES.map((c) => `
    <li><span class="cx-ic">${abilityIcon(c.id, 22)}</span><div><b>${esc(c.name)}</b><p class="cx-gain">${esc(c.curse!.gain)}</p><p class="cx-cost">대가: ${esc(c.curse!.cost)}</p></div></li>`).join('')}</ul>`;
}

export function comboTab(ctx: CodexCtx) {
  // 게임 중에 열면 내 진행도: 완성 / 2/3
  const prog = new Map(comboProgress(ctx.picks).map((c) => [c.id, c]));
  const tag = (id: string) => {
    const p = prog.get(id as never);
    if (!p) return '';
    return p.have >= p.need ? '<em class="cx-done">완성</em>' : `<em class="cx-prog">${p.have}/${p.need}</em>`;
  };
  return `<p class="hint">조합의 증강을 모두 가지면(등급 무관) 보너스가 붙어요. 가진 증강과 같은 분류·조합 조각은 선택지에 더 자주 나와요</p><ul class="cx-list">${COMBOS.map((c) => `
    <li class="${prog.get(c.id)?.have === c.needs.length ? 'cx-mine' : ''}"><span class="cx-ic">${comboIcon(c.id, 22)}</span><div><b>${esc(c.name)}</b>${tag(c.id)}<p>${c.needs.map((n) => `${abilityIcon(n, 14)} ${esc(ABILITY[n].name)}`).join(' + ')}</p><p class="cx-legend">${esc(c.text)}</p></div></li>`).join('')}</ul>`;
}

function specialTab() {
  return `<p class="hint">역전 기회(꼴찌 점수가 1등의 60% 미만)인 꼴찌만 3라운드가 끝난 뒤 선택에서 1장을 받아요. 효과는 게임 끝까지</p><ul class="cx-list">${SPECIALS.map((c) => `
    <li><span class="cx-ic cx-special">${abilityIcon(c.id, 22)}</span><div><b>${esc(c.name)}</b><p>${esc(c.desc(1))}</p></div></li>`).join('')}</ul>`;
}

function itemTab() {
  return `<p class="hint"><code>?</code> 아이템 원을 잡으면 그 자리에서 바로 발동. 테두리 색이 등급</p>${ITEM_TIERS.map((tier, t) => `<h3 class="it${t}">${tier.name}</h3><ul class="cx-list">${ITEM_IDS.filter((id) => ITEMS[id].tier === t).map((id) => `
    <li><span class="cx-ic it${t}">${itemIcon(id, 22)}</span><div><b>${esc(ITEMS[id].name)}</b>${ITEMS[id].sabotage ? '<em class="cx-sab">방해</em>' : ''}<p>${esc(ITEMS[id].desc)}</p></div></li>`).join('')}</ul>`).join('')}`;
}

/** 보스 탭 (테스트에서 문구를 확인한다) */
export function bossTabHTML() {
  return `<ul class="cx-list">${BOSSES.map(([n, d]) => `<li><div><b>${n}</b><p>${esc(d)}</p></div></li>`).join('')}</ul>`;
}

/** 규칙 탭: 늘 기본 규칙 기준 점수표 (방마다 다른 점수는 대기실의 [이 방 점수표]) */
export function rulesTabHTML() {
  return `<p class="hint">기본 규칙 기준이에요. 방 규칙과 증강에 따라 달라질 수 있어요. 이 방의 점수는 대기실에서 볼 수 있어요. 점수 구역(중앙 ×1 · 사이 ×2 · 가장자리 ×3)·잭팟 등은 이 위에 곱해져요</p>${scoreTable(DEFAULT_RULES)}`;
}

const BODY: Record<Tab, (ctx: CodexCtx) => string> = { ability: abilityTab, unique: uniqueTab, combo: comboTab, curse: curseTab, special: specialTab, item: itemTab, boss: bossTabHTML, rules: rulesTabHTML };

/** 열려 있는 도감을 닫는 함수 */
let closeCurrent: (() => void) | null = null;

/** 도감이 열려 있으면 닫는다 (게임이 시작될 때) */
export function closeCodex() { closeCurrent?.(); }

/** 도감 창을 연다. 닫기 버튼·Esc·바깥 클릭으로 닫힌다 */
export function openCodex(host: HTMLElement, ctx: CodexCtx) {
  closeCodex();
  const el = document.createElement('div');
  el.className = 'overlay codex';
  el.innerHTML = `<div class="card wide cx-card" role="dialog" aria-label="도감">
    <div class="cx-head"><b>도감</b><button class="iconbtn x" type="button" data-close aria-label="닫기">${icon(UI.close, 18)}</button></div>
    <p class="hint cx-note">같은 증강을 또 고르면 수치가 더해져요 (중첩). 일부는 상한이 있어요</p>
    <div class="seg cx-tabs">${TABS.map(([id, name], i) => `<button type="button" data-tab="${id}" aria-pressed="${i === 0}">${name}</button>`).join('')}</div>
    <div class="cx-body"></div>
  </div>`;
  host.appendChild(el);
  const body = el.querySelector<HTMLElement>('.cx-body')!;
  const show = (tab: Tab) => {
    body.innerHTML = BODY[tab](ctx);
    body.scrollTop = 0;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  };
  show('ability');
  const close = () => { el.remove(); window.removeEventListener('keydown', onKey, true); if (closeCurrent === close) closeCurrent = null; };
  closeCurrent = close;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) close();
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tab) show(tab);
  });
}
