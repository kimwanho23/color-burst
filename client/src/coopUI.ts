/** 협력전 화면: 보스 체력 바·받은 카드(위쪽), 카드 투표 창, 결과 요약 */
import { COLORS, RULES, type CoopCardId, type CoopResult, type CoopState, type CoopVote, type PlayerState } from '@color-burst/shared';
import { UI, icon } from './icons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LEVEL_NAME = { easy: '이지', normal: '노말', hard: '하드' } as const;
const card = (id: CoopCardId) => RULES.coop.cards[id];

function ensure(stage: HTMLElement, id: string, cls: string) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; stage.appendChild(el); }
  return el;
}

/** 위쪽 보스 체력 바 (null이면 숨김) */
export function renderCoopHud(stage: HTMLElement, s: CoopState | null) {
  const el = ensure(stage, 'coopHud', 'coophud');
  el.hidden = !s;
  if (!s) return;
  const pct = s.maxHp > 0 ? Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100)) : 0;
  const [a, b] = RULES.coop.phaseAt;
  el.innerHTML = `
    <div class="ch-top"><b>레이드 보스</b><span>${s.phase}단계 · ${LEVEL_NAME[s.level]}</span><em>${Math.ceil(pct)}%</em></div>
    <div class="ch-bar"><i style="width:${pct}%"></i><s style="left:${a * 100}%"></s><s style="left:${b * 100}%"></s></div>
    ${s.cards.length ? `<div class="ch-cards">${s.cards.map((c) => `<span class="ch-card" title="${esc(card(c).desc)}">${esc(card(c).name)}</span>`).join('')}</div>` : ''}`;
}

/** 카드 투표 창. v가 null이면 닫는다. chosen: 방금 뽑힌 카드(강조 후 닫힘) */
export function renderVote(stage: HTMLElement, v: CoopVote | null, players: readonly PlayerState[], me: string, onPick: (c: CoopCardId) => void, chosen: CoopCardId | null = null) {
  const el = ensure(stage, 'coopVote', 'overlay coopvote');
  el.hidden = !v;
  if (!v) return;
  const left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
  const voters = (id: CoopCardId) => Object.entries(v.votes).filter(([, c]) => c === id)
    .map(([pid]) => players.find((p) => p.id === pid)).filter((p): p is PlayerState => !!p)
    .map((p) => `<i style="background:${COLORS[p.color].hex}" title="${esc(p.name)}"></i>`).join('');
  el.innerHTML = `<div class="card center">
    <h1>${chosen ? `${esc(card(chosen).name)} 선택!` : '다음 단계 카드 고르기'}</h1>
    <p class="hint">${chosen ? '곧 다음 단계가 시작돼요' : `다 같이 하나를 골라요. 가장 많이 고른 카드가 모두에게 적용돼요 · <b class="cv-left" data-until="${v.until}">${left}</b>초`}</p>
    <div class="cv-cards">${v.options.map((id) => `
      <button type="button" class="cv-card" data-card="${id}" aria-pressed="${v.votes[me] === id}" ${chosen ? 'disabled' : ''}${chosen === id ? ' data-win="1"' : ''}>
        <b>${esc(card(id).name)}</b><span>${esc(card(id).desc)}</span><span class="cv-who">${voters(id)}</span>
      </button>`).join('')}</div>
  </div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => { b.onclick = () => onPick(b.dataset.card as CoopCardId); });
}

/** 투표 창 남은 초 (서버 시각 기준) */
export function tickVote(serverNow: number) {
  const el = document.querySelector<HTMLElement>('#coopVote .cv-left');
  if (el) el.textContent = String(Math.max(0, Math.ceil((Number(el.dataset.until) - serverNow) / 1000)));
}

/** 점수판 칩에 붙이는 하트 */
export const heartsHtml = (p: PlayerState) =>
  p.bot ? '' : `<span class="hearts" aria-label="생명 ${p.lives}">${p.outAt ? '탈락' : Array.from({ length: p.lives }, () => icon(UI.heart, 12)).join('')}</span>`;

/** 결과 화면 맨 위 요약 */
export function coopResultHtml(r: CoopResult) {
  const sec = Math.round(r.timeMs / 1000);
  const stars = r.win ? `<div class="cr-stars">${[1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}">★</span>`).join('')}</div>` : '';
  return `<div class="coopres ${r.win ? 'win' : 'lose'}">
    ${stars}
    <p>${r.win ? `${Math.floor(sec / 60)}분 ${sec % 60}초 만에 처치` : `보스 체력 ${r.bossHpPct}% 남음 · ${r.phase}단계`}</p>
    ${r.cards.length ? `<p class="cr-cards">받은 카드: ${r.cards.map((c) => esc(card(c).name)).join(' · ')}</p>` : ''}
  </div>`;
}

/** 결과 화면 개인 줄에 붙이는 협력전 기록: 보스 피해 점수, 막은 공격 원, 남은 생명/탈락 */
export function coopLine(p: PlayerState, startAt: number) {
  if (p.bot) return '';
  const blocked = Math.round((p.stats.src.threat ?? 0) / RULES.coop.threatPoints);
  const life = p.outAt ? `${Math.max(0, Math.round((p.outAt - startAt) / 1000))}초에 탈락` : `생명 ${p.lives}`;
  return `<span class="coopline">보스 ${p.stats.src.boss}점 · 공격 원 ${blocked}개 · ${life}</span>`;
}
