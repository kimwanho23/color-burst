/** 아케이드 화면: 능력 선택 카드, 내 빌드, 점수판·결과의 능력 아이콘 */
import {
  ABILITY, TIERS, abilityText, modsOf,
  type ArcadeOffer, type ArcadeState, type Pick, type PlayerState,
} from '@color-burst/shared';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 등급 표시용 클래스: t0 노말, t1 레어, t2 에픽, t3 레전드 */
export const tierClass = (p: Pick) => `t${p.tier}`;

/** 점수판·결과 화면에 붙는 작은 능력 칩 */
export function pickChips(picks: readonly Pick[], withName = false) {
  if (!picks.length) return '';
  return `<span class="picks-mini">${picks.map((p) =>
    `<span class="pk ${tierClass(p)}" title="${esc(`${TIERS[p.tier].name} ${ABILITY[p.id].name}: ${abilityText(p)}`)}">${withName ? esc(ABILITY[p.id].name) : ''}</span>`).join('')}</span>`;
}

/** 내가 고른 능력을 합친 효과 목록 (같은 능력은 합계로) */
export function buildSummary(picks: readonly Pick[]) {
  if (!picks.length) return '<p class="hint">아직 고른 능력이 없어요</p>';
  const m = modsOf(picks);
  const ids = [...new Set(picks.map((p) => p.id))];
  return `<ul class="build">${ids.map((id) => {
    const best = Math.max(...picks.filter((p) => p.id === id).map((p) => p.tier)) as Pick['tier'];
    const count = picks.filter((p) => p.id === id).length;
    return `<li class="t${best}"><b>${ABILITY[id].name}${count > 1 ? ` ×${count}` : ''}</b><span>${esc(ABILITY[id].desc(m[id]))}</span></li>`;
  }).join('')}</ul>`;
}

export interface PickView {
  state: ArcadeState;
  offer: ArcadeOffer | null;
  me: PlayerState | undefined;
  players: PlayerState[];
  /** 이미 골랐는지 */
  chosen: boolean;
}

/** 능력 선택 화면 그리기 (매 프레임이 아니라 상태가 바뀔 때만) */
export function renderPick(el: HTMLElement, v: PickView, on: { choose: (i: number) => void; reroll: () => void }) {
  const { state, offer, me, chosen } = v;
  const owned = new Map<string, number>();
  for (const p of me?.picks ?? []) owned.set(p.id, (owned.get(p.id) ?? 0) + 1);
  const waitingNames = state.waiting
    .map((id) => v.players.find((p) => p.id === id))
    .filter((p): p is PlayerState => !!p && p.id !== me?.id)
    .map((p) => esc(p.name));

  const cards = offer && !chosen
    ? offer.options.map((o, i) => {
        const a = ABILITY[o.id];
        const have = owned.get(o.id);
        const total = have ? a.desc(modsOf([...(me?.picks ?? []), o])[o.id]) : '';
        return `<button type="button" class="acard ${tierClass(o)}" data-i="${i}">
          <span class="tier">${TIERS[o.tier].name}</span>
          <span class="cat">${a.cat}</span>
          <b class="aname">${a.name}</b>
          <span class="adesc">${esc(abilityText(o))}</span>
          ${have ? `<span class="stack">보유 ${have}개 → 합계: ${esc(total)}</span>` : ''}
          <kbd>${i + 1}</kbd>
        </button>`;
      }).join('')
    : '';

  el.innerHTML = `
    <div class="card wide pickcard">
      <div class="pick-head">
        <div><div class="lbl">라운드 ${state.round} / ${state.rounds} 종료</div><h2>능력 선택</h2></div>
        <div class="pick-timer" id="pickTimer"></div>
      </div>
      ${offer?.lastPlace && !chosen ? '<p class="boost">꼴찌 보너스: 높은 등급이 나올 확률이 올라갔어요</p>' : ''}
      ${chosen || !offer
        ? `<p class="hint">${waitingNames.length ? `${waitingNames.join(', ')} 님이 고르는 중…` : '곧 다음 라운드가 시작돼요'}</p>`
        : `<div class="acards">${cards}</div>
           <button type="button" class="btn ghost small" id="rerollBtn" ${offer.rerollLeft ? '' : 'disabled'}>
             다시 뽑기 ${offer.rerollLeft ? `(${offer.rerollLeft}번 남음)` : '(사용함)'} <kbd>R</kbd></button>`}
      <div class="lbl">내 능력</div>
      ${buildSummary(me?.picks ?? [])}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('.acard').forEach((b) => { b.onclick = () => on.choose(Number(b.dataset.i)); });
  const rr = el.querySelector<HTMLButtonElement>('#rerollBtn');
  if (rr) rr.onclick = on.reroll;
}
