/** 협력전 화면: 보스 체력 바(위쪽), 결과 요약 */
import { RULES, type CoopResult, type CoopState, type PlayerState } from '@color-burst/shared';
import { UI, icon } from './icons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LEVEL_NAME = { easy: '이지', normal: '노말', hard: '하드' } as const;

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
`;
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
  </div>`;
}

/** 결과 화면 개인 줄에 붙이는 협력전 기록: 보스 피해 점수, 막은 공격 원, 남은 생명/탈락 */
export function coopLine(p: PlayerState, startAt: number) {
  if (p.bot) return '';
  const blocked = Math.round((p.stats.src.threat ?? 0) / RULES.coop.threatPoints);
  const life = p.outAt ? `${Math.max(0, Math.round((p.outAt - startAt) / 1000))}초에 탈락` : `생명 ${p.lives}`;
  return `<span class="coopline">보스 ${p.stats.src.boss}점 · 공격 원 ${blocked}개 · ${life}</span>`;
}
