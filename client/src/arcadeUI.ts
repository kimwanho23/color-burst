/** 아케이드 화면: 능력 선택 카드, 내 빌드, 점수판·결과의 능력 아이콘 */
import {
  ABILITY, EVENTS, THEMES, TIERS, abilityText, modsOf,
  type ArcadeOffer, type ArcadeState, type Pick, type PlayerState, type RoundEffect,
} from '@color-burst/shared';
import { UI, abilityIcon, categoryIcon, eventIcon, icon } from './icons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** 설명 속 숫자(+3, 50%, ×2, 1.5초 등)를 강조 */
const emph = (s: string) => esc(s).replace(/([+−\-×]?\d+(?:\.\d+)?(?:%|초|점|콤보|번|타)?)/g, '<b>$1</b>');

/** 등급 표시용 클래스: t0 노말, t1 레어, t2 에픽, t3 레전드, curse 저주 */
export const tierClass = (p: Pick) => (ABILITY[p.id].curse ? 'curse' : `t${p.tier}`);
const tierLabel = (p: Pick) => (ABILITY[p.id].curse ? '저주' : TIERS[p.tier].name);
const tipOf = (p: Pick) => `${tierLabel(p)} ${ABILITY[p.id].name}: ${abilityText(p)}`;

/** 점수판·결과 화면에 붙는 작은 능력 아이콘 */
export function pickChips(picks: readonly Pick[], size = 13) {
  if (!picks.length) return '';
  return `<span class="picks-mini">${picks.map((p) =>
    `<span class="pk ${tierClass(p)}" title="${esc(tipOf(p))}">${abilityIcon(p.id, size)}</span>`).join('')}</span>`;
}

/** 내 능력: 아이콘 타일 (같은 능력은 하나로 합치고 개수 표시, 설명은 마우스를 올리면) */
export function buildSummary(picks: readonly Pick[], newest?: Pick) {
  if (!picks.length) return '<p class="hint">아직 고른 능력이 없어요</p>';
  const m = modsOf(picks);
  const ids = [...new Set(picks.map((p) => p.id))];
  return `<ul class="build">${ids.map((id) => {
    const mine = picks.filter((p) => p.id === id);
    const best = mine.reduce((a, b) => (b.tier > a.tier ? b : a));
    const a = ABILITY[id];
    const desc = a.curse ? `${a.curse.gain} / 대가: ${a.curse.cost}` : a.desc(m[id]);
    return `<li class="${tierClass(best)}${newest?.id === id ? ' new' : ''}" title="${esc(`${a.name}: ${desc}`)}">
      <span class="ic">${abilityIcon(id, 22)}${mine.length > 1 ? `<em>×${mine.length}</em>` : ''}</span>
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
    : `<span class="adesc">${emph(abilityText(o))}</span>`;
  return `<button type="button" class="acard ${tierClass(o)}" data-i="${i}" style="--i:${i}">
    <span class="tier">${tierLabel(o)}</span>
    <span class="cat" title="${a.cat}">${categoryIcon(a.cat)}</span>
    <span class="aicon">${abilityIcon(o.id, 34)}</span>
    <b class="aname">${a.name}</b>
    ${body}
    ${owned ? `<span class="stack">보유 ${owned} → ${emph(total)}</span>` : ''}
    <kbd>${i + 1}</kbd>
  </button>`;
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
        <div class="pick-title">${roundPips(state)}<h2>능력 선택</h2></div>
        <div class="pick-timer" id="pickTimer"></div>
      </div>
      ${state.event ? `<p class="event-now">${eventIcon(state.event.id, 16)}<b>랜덤 이벤트 · ${EVENTS[state.event.id].name}</b><span>${esc(state.event.text)}</span></p>` : ''}
      ${state.theme ? `<p class="theme-next">${icon(UI.event, 15)} 다음 라운드: <b>${THEMES[state.theme].name}</b> · ${THEMES[state.theme].desc}</p>` : ''}
      ${effects ? `<ul class="effects">${effects}</ul>` : ''}
      ${offer?.lastPlace && !chosen ? `<p class="boost">${icon(UI.up, 15)} 꼴찌 보너스: 높은 등급·저주 카드가 더 잘 나와요</p>` : ''}
      ${chosen || !offer
        ? `<div class="waiting">${waiting.length
            ? waiting.map((p) => `<span class="who-wait">${icon(p.bot ? UI.bot : UI.classic, 14)}${esc(p.name)}</span>`).join('') + '<span class="hint">고르는 중…</span>'
            : '<span class="hint">곧 다음 라운드가 시작돼요</span>'}</div>`
        : `<div class="acards${v.deal ? ' deal' : ''}${offer.options.length > 3 ? ' four' : ''}">${offer.options.map((o, i) => card(o, i, me)).join('')}</div>
           <button type="button" class="btn ghost small reroll" id="rerollBtn" ${offer.rerollLeft ? '' : 'disabled'}>
             ${icon(UI.reroll, 16)} 다시 뽑기 ${offer.rerollLeft ? `<em>${offer.rerollLeft}</em>` : ''} <kbd>R</kbd></button>`}
      <div class="lbl">내 능력</div>
      ${buildSummary(me?.picks ?? [], chosen ? me?.picks.at(-1) : undefined)}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('.acard').forEach((b) => { b.onclick = () => on.choose(Number(b.dataset.i)); });
  const rr = el.querySelector<HTMLButtonElement>('#rerollBtn');
  if (rr) rr.onclick = on.reroll;
}
