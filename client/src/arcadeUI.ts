/** 아케이드 화면: 능력 선택 카드, 내 빌드, 점수판·결과의 능력 아이콘 */
import {
  ABILITY, ARCADE, COMBOS, EVENTS, LEGEND_TEXT, THEMES, TIERS, STACK_IDS, abilityText, comboProgress, combosCompletedBy, combosOf, groupPicks, modsOf, isSpecial,
  type ArcadeOffer, type ArcadeState, type Pick, type PlayerState, type RoundEffect, type StackId,
} from '@color-burst/shared';
import { UI, abilityIcon, categoryIcon, eventIcon, icon } from './icons.ts';
import { shapeSVG } from './render.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** 설명 속 숫자(+3, 50%, ×2, 1.5초 등)를 강조 */
const emph = (s: string) => esc(s).replace(/([+−\-×]?\d+(?:\.\d+)?(?:%|초|점|콤보|번|타)?)/g, '<b>$1</b>');

/** 등급 표시용 클래스: t0 노말, t1 레어, t2 에픽, t3 레전드, curse 저주 */
export const tierClass = (p: Pick) => (ABILITY[p.id].curse ? 'curse' : ABILITY[p.id].special ? 'special' : `t${p.tier}`);
const tierLabel = (p: Pick) => (ABILITY[p.id].curse ? '저주' : ABILITY[p.id].special ? '특별' : TIERS[p.tier].name);
const COMBO_OF = (id: string) => COMBOS.filter((c) => (c.needs as readonly string[]).includes(id));
/** data-tip 속성 값 (설명 카드 HTML, tooltip.ts가 띄움) */
const tipAttr = (html: string) => `data-tip="${esc(html)}"`;

/**
 * 증강 설명 카드: 이름·등급, (가진 사람이면 합친) 수치 설명, 레전드 효과, 이 증강이 들어가는 조합과 진행도.
 * picks: 그 증강을 가진(또는 고를) 사람의 증강, card: 아직 안 고른 선택지 카드면 그 카드
 */
export function augTip(id: Pick['id'], picks: readonly Pick[] = [], card?: Pick) {
  const a = ABILITY[id];
  const mine = picks.filter((p) => p.id === id);
  const tier = card?.tier ?? Math.max(0, ...mine.map((p) => p.tier)) as Pick['tier'];
  const pk: Pick = { id, tier };
  const legendOn = card ? card.tier === 3 : mine.some((p) => p.tier === 3);
  const desc = a.curse
    ? `<p class="tg">${emph(a.curse.gain)}</p><p class="tc">대가: ${emph(a.curse.cost)}</p>`
    : `<p>${emph(card ? abilityText(card) : a.desc(modsOf(picks)[id]))}${!card && mine.length > 1 ? ` <em>(${mine.length}개 합침)</em>` : ''}</p>`;
  const lg = LEGEND_TEXT[id] && !a.curse && !a.special
    ? `<p class="tl${legendOn ? ' on' : ''}">${legendOn ? '레전드 효과' : '레전드면'}: ${esc(LEGEND_TEXT[id]!)}</p>` : '';
  const combos = COMBO_OF(id).map((c) => comboLine(c.id, picks, card)).join('');
  return `<div class="tip-h ${tierClass(pk)}">${abilityIcon(id, 18)}<b>${esc(a.name)}</b><span>${tierLabel(pk)}${a.cat !== '저주' && a.cat !== '특별' ? ` · ${a.cat}` : ''}</span></div>${desc}${lg}${combos ? `<div class="tip-c">${combos}</div>` : ''}`;
}

/** 조합 한 줄: 이름·진행 (카드를 고르면 오르는 진행은 2→3/3) */
function comboLine(cid: string, picks: readonly Pick[], card?: Pick) {
  const c = COMBOS.find((x) => x.id === cid)!;
  const have = new Set(picks.map((p) => p.id));
  const n = c.needs.filter((x) => have.has(x)).length;
  const up = card && !have.has(card.id) && (c.needs as readonly string[]).includes(card.id) ? n + 1 : n;
  const done = up >= c.needs.length;
  return `<span class="${done ? 'done' : ''}">${icon(UI.combo, 12)}${esc(c.name)} ${up !== n ? `${n}→${up}` : n}/${c.needs.length}</span>`;
}

/** 조합 설명 카드: 이름·효과, 필요한 증강 (가진 것 ✓ 밝게, 없는 것 흐리게), 진행 */
export function comboTip(cid: string, picks: readonly Pick[] = [], card?: Pick) {
  const c = COMBOS.find((x) => x.id === cid)!;
  const have = new Set(picks.map((p) => p.id));
  if (card) have.add(card.id);
  const n = c.needs.filter((x) => have.has(x)).length;
  return `<div class="tip-h combo">${icon(UI.combo, 16)}<b>${esc(c.name)}</b><span>${n >= c.needs.length ? '완성' : `${n}/${c.needs.length}`}</span></div>
    <p>${esc(c.text)}</p>
    <ul class="tip-needs">${c.needs.map((x) => `<li class="${have.has(x) ? 'have' : ''}">${have.has(x) ? '✓' : '·'} ${abilityIcon(x, 14)} ${esc(ABILITY[x].name)}${card?.id === x && !picks.some((p) => p.id === x) ? ' <em>이 카드</em>' : ''}</li>`).join('')}</ul>
    <p class="tip-note">필요한 증강을 모두 가지면(등급 무관) 완성</p>`;
}

/** 완성한 조합 목록 설명 카드 (점수판 "조합 N" 배지) */
const combosTip = (picks: readonly Pick[]) => {
  const done = COMBOS.filter((c) => combosOf(picks).has(c.id));
  return `<div class="tip-h combo">${icon(UI.combo, 16)}<b>완성한 조합</b></div>${done.map((c) => `<p><b>${esc(c.name)}</b> · ${esc(c.text)}</p>`).join('')}`;
};

/** 점수판에 붙는 작은 능력 아이콘 (같은 능력은 하나로 묶고 ×N). 특별 카드·완성 조합은 배지로 따로 */
/** 스택형 증강: 지금 칸/최대 칸 ("3/5"), 아니면 '' */
function stackText(id: Pick['id'], picks: readonly Pick[], stacks?: PlayerState['stacks']) {
  if (!stacks || !STACK_IDS.includes(id as StackId)) return '';
  return `<em class="stk">${stacks[id as StackId] ?? 0}/${modsOf(picks)[id]}</em>`;
}

export function pickChips(picks: readonly Pick[], size = 16, stacks?: PlayerState['stacks']) {
  if (!picks.length) return '';
  const combos = combosOf(picks).size;
  const special = picks.find((p) => isSpecial(p.id));
  return `<span class="picks-mini">${special ? `<span class="pk badge sp" ${tipAttr(augTip(special.id, picks))}>${icon(UI.special, 12)}</span>` : ''}${combos ? `<span class="pk badge cb" ${tipAttr(combosTip(picks))}>${icon(UI.combo, 11)}${combos}</span>` : ''}${groupPicks(picks).map((g) =>
    `<span class="pk ${tierClass(g)}" ${tipAttr(augTip(g.id, picks))}>${abilityIcon(g.id, size)}${stackText(g.id, picks, stacks) || (g.count > 1 ? `<em>×${g.count}</em>` : '')}</span>`).join('')}</span>`;
}

/** 빌드 타일: 증강 아이콘·이름 (같은 증강은 묶어 ×N), 레전드 ★, 특별·저주는 색을 따로. 설명은 마우스를 올리면 */
export function buildTiles(picks: readonly Pick[], size = 18, stacks?: PlayerState['stacks']) {
  if (!picks.length) return '';
  const legend = new Set(picks.filter((p) => p.tier === 3).map((p) => p.id));
  return `<ul class="tiles">${groupPicks(picks).map((g) => {
    const a = ABILITY[g.id];
    const star = legend.has(g.id) && !a.curse && !a.special ? '<i>★</i>' : '';
    return `<li class="${tierClass(g)}" ${tipAttr(augTip(g.id, picks))}>${abilityIcon(g.id, size)}<span>${esc(a.name)}</span>${g.count > 1 ? `<em>×${g.count}</em>` : ''}${stackText(g.id, picks, stacks)}${star}</li>`;
  }).join('')}</ul>`;
}

/** 순위 (동점은 같은 순위) */
export const rankOf = (p: PlayerState, players: readonly PlayerState[]) => 1 + players.filter((x) => x.score > p.score).length;

/** 한 사람의 빌드 카드: 이름·순위·점수, 완성 조합 금색 띠, 증강 타일 */
export function buildCard(p: PlayerState, rank: number, meId?: string) {
  const done = COMBOS.filter((c) => combosOf(p.picks).has(c.id));
  return `<div class="bcard${p.id === meId ? ' me' : ''}">
    <div class="bhead">${shapeSVG(p.color, 20)}<b>${esc(p.name)}${p.id === meId ? ' (나)' : ''}</b><span class="brank">${rank}등</span><span class="bscore">${p.score}</span></div>
    ${done.length ? `<div class="bcombos">${done.map((c) => `<span ${tipAttr(comboTip(c.id, p.picks))}>${icon(UI.combo, 12)}${esc(c.name)} · ${esc(c.text)}</span>`).join('')}</div>` : ''}
    ${p.picks?.length ? buildTiles(p.picks, 18, p.stacks) : '<p class="hint">아직 고른 증강이 없어요</p>'}
  </div>`;
}

/** 증강 선택 화면의 상대 빌드: 나를 뺀 사람을 점수 순으로 */
export function rivalsPanel(players: readonly PlayerState[], meId?: string) {
  const others = players.filter((p) => p.id !== meId).sort((a, b) => b.score - a.score);
  if (!others.length) return '';
  return `<div class="lbl">상대 빌드</div><div class="rivals">${others.map((p) => buildCard(p, rankOf(p, players), meId)).join('')}</div>`;
}

/** 내 능력: 아이콘 타일 (같은 능력은 하나로 합치고 개수 표시, 설명은 마우스를 올리면) */
export function buildSummary(picks: readonly Pick[], newest?: Pick) {
  if (!picks.length) return '<p class="hint">아직 고른 능력이 없어요</p>';
  return `<ul class="build">${groupPicks(picks).map((g) => {
    const id = g.id;
    const a = ABILITY[id];
    return `<li class="${tierClass(g)}${newest?.id === id ? ' new' : ''}" ${tipAttr(augTip(id, picks))}>
      <span class="ic">${abilityIcon(id, 22)}${g.count > 1 ? `<em>×${g.count}</em>` : ''}</span>
      <span class="nm">${a.name}</span></li>`;
  }).join('')}</ul>`;
}

/** 라운드 끝에 적용된 저주·세금 결과 목록 (li들) */
export function effectItems(effects: readonly RoundEffect[], players: readonly PlayerState[], meId: string | undefined) {
  return effects.map((e) => {
    const who = players.find((p) => p.id === e.playerId);
    const [ic, name] = e.id === 'tax' ? [icon(UI.tax, 15), '세금 수령'] : [abilityIcon(e.id, 15), ABILITY[e.id].name];
    return `<li class="${e.delta >= 0 ? 'plus' : 'minus'}">${ic}<span>${esc(who?.id === meId ? '나' : who?.name ?? '')} · ${name}</span><b>${e.delta >= 0 ? '+' : ''}${e.delta}</b></li>`;
  }).join('');
}

/** 라운드 진행 표시 (점 5개) */
function roundPips(state: ArcadeState) {
  return `<span class="pips" aria-label="라운드 ${state.round} / ${state.rounds}">${Array.from({ length: state.rounds }, (_, i) =>
    `<i class="${i < state.round ? 'done' : ''}"></i>`).join('')}</span>`;
}

function card(o: Pick, i: number, me: PlayerState | undefined) {
  const a = ABILITY[o.id];
  const owned = (me?.picks ?? []).filter((p) => p.id === o.id).length;
  const total = owned && !a.curse ? a.desc(modsOf([...(me?.picks ?? []), o])[o.id]) : '';
  const body = a.curse
    ? `<span class="gain">${icon(UI.up, 15)}<span>${emph(a.curse.gain)}</span></span>
       <span class="cost">${icon(UI.down, 15)}<span>${emph(a.curse.cost)}</span></span>`
    : `<span class="adesc">${emph(abilityText(o))}</span>${LEGEND_TEXT[o.id]
      ? `<span class="alegend${o.tier === 3 ? ' on' : ''}">${o.tier === 3 ? '레전드' : '레전드면'}: ${esc(LEGEND_TEXT[o.id]!)}</span>` : ''}`;
  return `<button type="button" class="acard ${tierClass(o)}" data-i="${i}" style="--i:${i}">
    <span class="tier">${tierLabel(o)}</span>
    <span class="cat" title="${a.cat}">${categoryIcon(a.cat)}</span>
    <span class="aicon">${abilityIcon(o.id, 34)}</span>
    <b class="aname">${a.name}</b>
    ${body}
    ${owned ? `<span class="stack">보유 ${owned} → ${emph(total)}</span>` : ''}
    ${cardCombos(o, me?.picks ?? [])}
    <kbd>${i + 1}</kbd>
  </button>`;
}

/** 카드의 조합 배지: 이 증강이 들어가는 조합마다. 고르면 진행이 오르면 2→3/3 강조, 완성되면 "조합 완성" */
function cardCombos(o: Pick, picks: readonly Pick[]) {
  const list = COMBO_OF(o.id);
  if (!list.length) return '';
  const completes = new Set(combosCompletedBy(picks, o).map((c) => c.id));
  return `<span class="ctags">${list.map((c) => {
    const have = new Set(picks.map((p) => p.id));
    const n = c.needs.filter((x) => have.has(x)).length;
    const up = !have.has(o.id);
    const label = completes.has(c.id) ? `조합 완성: ${esc(c.name)}` : `${esc(c.name)} ${up ? `${n}→${n + 1}` : n}/${c.needs.length}`;
    return `<span class="ctag${completes.has(c.id) ? ' done' : up && n > 0 ? ' up' : ''}" ${tipAttr(comboTip(c.id, picks, o))}>${icon(UI.combo, 11)}${label}</span>`;
  }).join('')}</span>`;
}

export interface PickView {
  state: ArcadeState;
  offer: ArcadeOffer | null;
  me: PlayerState | undefined;
  players: PlayerState[];
  /** 이미 골랐는지 */
  chosen: boolean;
  /** 이번 라운드 끝에 적용된 저주 결과 */
  effects: RoundEffect[];
  /** 새 선택지라서 카드 나눠 주기 연출을 할지 */
  deal: boolean;
  /** 선택 화면이 처음 열리는 순간인지 */
  opening: boolean;
}

/** 조합 진행: 하나 이상 가진 조합만, 완성은 금색 */
/**
 * 조합 패널 (오토체스 시너지처럼): 모든 조합을 늘 보여 준다. 완성은 밝게, 진행 중은 ●●○, 시작 안 한 조합은 흐리게.
 * 마우스를 올리면 효과와 필요한 증강
 */
function comboList(me: PlayerState | undefined) {
  const picks = me?.picks ?? [];
  const prog = comboProgress(picks);
  const seen = new Set(prog.map((c) => c.id));
  const rest = COMBOS.filter((c) => !seen.has(c.id)).map((c) => ({ id: c.id, name: c.name, have: 0, need: c.needs.length }));
  const pips = (have: number, need: number) => Array.from({ length: need }, (_, k) => `<i class="${k < have ? 'on' : ''}"></i>`).join('');
  return `<div class="lbl">조합</div><ul class="synergy">${[...prog, ...rest].map((c) => {
    const cls = c.have >= c.need ? 'done' : c.have > 0 ? 'prog' : 'off';
    return `<li class="${cls}" ${tipAttr(comboTip(c.id, picks))}>${icon(UI.combo, 13)}<b>${esc(c.name)}</b><span class="pips">${pips(c.have, c.need)}</span></li>`;
  }).join('')}</ul>`;
}

/** 두 장 고르는 차례: "2장 고르기" / 한 장 고른 뒤 "1장 더" */
function needText(state: ArcadeState, offer: ArcadeOffer | null, chosen: boolean) {
  if (!offer || chosen) return '';
  const total = ARCADE.picksPerRound[Math.min(state.round - 1, ARCADE.picksPerRound.length - 1)];
  if (total <= 1) return '';
  return `<span class="need">${offer.need < total ? `${offer.need}장 더` : `${total}장 고르기`}</span>`;
}

/** 능력 선택 화면 그리기 (상태가 바뀔 때만) */
export function renderPick(el: HTMLElement, v: PickView, on: { choose: (i: number) => void; reroll: () => void }) {
  const { state, offer, me, chosen } = v;
  const waiting = state.waiting
    .map((id) => v.players.find((p) => p.id === id))
    .filter((p): p is PlayerState => !!p && p.id !== me?.id);
  const effects = effectItems(v.effects, v.players, me?.id);

  el.innerHTML = `
    <div class="card wide pickcard${v.opening ? ' enter' : ''}">
      <div class="pick-head">
        <div class="pick-title">${roundPips(state)}<h2>능력 선택</h2>${needText(state, offer, chosen)}</div>
        <div class="pick-timer" id="pickTimer"></div>
      </div>
      ${state.event ? `<p class="event-now">${eventIcon(state.event.id, 16)}<b>랜덤 이벤트 · ${EVENTS[state.event.id].name}</b><span>${esc(state.event.text)}</span></p>` : ''}
      ${state.theme ? `<p class="theme-next">${icon(UI.event, 15)} 다음 라운드: <b>${THEMES[state.theme].name}</b> · ${THEMES[state.theme].desc}</p>` : ''}
      ${effects ? `<ul class="effects">${effects}</ul>` : ''}
      ${offer?.comeback && !chosen
        ? `<p class="boost comeback">${icon(UI.up, 15)} 역전 기회! 꼴찌인 동안 내 점수 ×${ARCADE.comeback.roomMult[v.players.length] ?? 1} (꼴찌를 벗어나면 꺼져요)</p>`
        : offer?.lastPlace && !chosen ? `<p class="boost">${icon(UI.up, 15)} 꼴찌 보너스: 높은 등급 카드가 꼭 나오고 저주 카드도 더 잘 나와요</p>` : ''}
      ${chosen || !offer
        ? `<div class="waiting">${waiting.length
            ? waiting.map((p) => `<span class="who-wait">${icon(p.bot ? UI.bot : UI.classic, 14)}${esc(p.name)}</span>`).join('') + '<span class="hint">고르는 중…</span>'
            : '<span class="hint">곧 다음 라운드가 시작돼요</span>'}</div>`
        : `<div class="acards${v.deal ? ' deal' : ''}${offer.options.length > 3 ? ' four' : ''}">${offer.options.map((o, i) => card(o, i, me)).join('')}</div>
           <button type="button" class="btn ghost small reroll" id="rerollBtn" ${offer.rerollLeft ? '' : 'disabled'}>
             ${icon(UI.reroll, 16)} 다시 뽑기 ${offer.rerollLeft ? `<em>${offer.rerollLeft}</em>` : ''} <kbd>R</kbd></button>`}
      <div class="lbl">내 능력</div>
      ${buildSummary(me?.picks ?? [], chosen ? me?.picks.at(-1) : undefined)}
      ${comboList(me)}
      ${rivalsPanel(v.players, me?.id)}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('.acard').forEach((b) => { b.onclick = () => on.choose(Number(b.dataset.i)); });
  const rr = el.querySelector<HTMLButtonElement>('#rerollBtn');
  if (rr) rr.onclick = on.reroll;
}
