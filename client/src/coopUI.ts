/** 협력전 화면: 보스 체력 바(위쪽), 결과 요약 */
import { RULES, type CoopResult, type CoopState, type PlayerState } from '@color-burst/shared';
import { UI, icon } from './icons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LEVEL_NAME = { easy: '이지', normal: '노말', hard: '하드', expert: '엑스퍼트' } as const;

function ensure(stage: HTMLElement, id: string, cls: string) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; stage.appendChild(el); }
  return el;
}

/** 위쪽 보스 체력 바 (null이면 숨김). 보호막이면 자물쇠와 남은 초, 분노 경고·큰 피해 구간 표시 */
export function renderCoopHud(stage: HTMLElement, s: CoopState | null, now = Date.now()) {
  const el = ensure(stage, 'coopHud', 'coophud');
  el.hidden = !s;
  if (!s) return;
  const pct = s.maxHp > 0 ? Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100)) : 0;
  const [a, b] = RULES.coop.phaseAt;
  const left = (t: number) => Math.max(0, Math.ceil((t - now) / 1000));
  const status = s.rageAt ? '<em class="ch-rage">분노!</em>'
    : s.shield ? `<em class="ch-shield">${icon(UI.lock, 14)}보호막 · 수정 깨기 ${left(s.shield.until)}초</em>`
    : s.threatAt && s.threatAt > now ? `<em class="ch-rage">보스가 큰 원을 발사합니다! 클릭해서 제거하세요! (${left(s.threatAt)}초)</em>`
    : s.burstUntil > now ? `<em class="ch-burst">보스가 무너졌다! ${left(s.burstUntil)}초</em>` : '';
  el.classList.toggle('shielded', !!s.shield);
  el.classList.toggle('raging', !!s.rageAt);
  el.innerHTML = `
    <div class="ch-top"><b>레이드 보스</b><span>${s.phase}단계 · ${LEVEL_NAME[s.level]}</span>${status}<em>${Math.ceil(pct)}%</em></div>
    <div class="ch-bar"><i style="width:${pct}%"></i><s style="left:${a * 100}%"></s><s style="left:${b * 100}%"></s></div>`;
}

/** 체력 막대: 칸 안은 hp/hpMax 비율, 낮으면 붉게 */
const hpFill = (hp: number) => `<i style="width:${Math.max(0, Math.min(100, (hp / RULES.coop.hpMax) * 100))}%"></i>`;
const hpLow = (hp: number) => hp <= RULES.coop.hpMax * RULES.coop.hpLowRatio;

/** 점수판 칩에 붙이는 작은 체력 막대 + 숫자 */
export const hpBarHtml = (p: PlayerState) =>
  p.bot ? '' : p.outAt ? '<span class="hpbar out" aria-label="탈락">탈락</span>'
    : `<span class="hpbar${hpLow(p.hp) ? ' low' : ''}" aria-label="체력 ${p.hp}"><span class="hb-track">${hpFill(p.hp)}</span><b>${p.hp}</b></span>`;

/** 아래 줄(피버 자리)의 내 체력 막대 (크게) */
export const myHpHtml = (p: PlayerState | undefined) =>
  !p || p.bot ? '' : `<span class="hb-label">${icon(UI.heart, 16)}<span>체력</span></span><span class="hb-track">${hpFill(p.outAt ? 0 : p.hp)}</span><b>${p.outAt ? '탈락' : p.hp}</b>`;

export interface CoopRow { id: string; name: string; dmg: number; pct: number; burstDmg: number; crystals: number; threats: number; top: boolean }

/** 결과 화면 기여도 줄: 대미지 큰 순, 반올림, 최대 체력 대비 %, 1등(대미지가 있을 때)만 top */
export function coopResultRows(r: CoopResult, players: readonly PlayerState[]): CoopRow[] {
  const rows = players.filter((p) => r.players[p.id]).map((p) => {
    const x = r.players[p.id]!;
    return { id: p.id, name: p.name, dmg: Math.round(x.dmg), pct: r.maxHp > 0 ? Math.round((x.dmg / r.maxHp) * 100) : 0, burstDmg: Math.round(x.burstDmg), crystals: x.crystals, threats: x.threats, top: false, raw: x.dmg };
  }).sort((p, q) => q.raw - p.raw);
  if (rows[0] && rows[0].raw > 0) rows[0].top = true;
  return rows.map(({ raw: _raw, ...row }) => row);
}

/** 보호막마다 수정을 다 깨는 데 걸린 시간 (그 사이 분노 횟수) */
export function coopBreaksText(breaks: readonly { ms: number; rages: number }[]): string[] {
  return breaks.map((b, i) => `${i + 1}번째 보호막 ${(Math.round(b.ms / 100) / 10).toFixed(1)}초${b.rages ? ` (분노 ${b.rages}번)` : ''}`);
}

/** 결과 화면 맨 위 요약: 별, 걸린 시간/남은 체력, 파훼 기록 */
export function coopResultHtml(r: CoopResult) {
  const sec = Math.round(r.timeMs / 1000);
  const stars = r.win ? `<div class="cr-stars">${[1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}">★</span>`).join('')}</div>` : '';
  const breaks = coopBreaksText(r.breaks);
  return `<div class="coopres ${r.win ? 'win' : 'lose'}">
    ${stars}
    <p>${r.win ? `${Math.floor(sec / 60)}분 ${sec % 60}초 만에 처치` : `${r.reason === 'crystal' ? '수정 구간 실패 · ' : ''}보스 체력 ${r.bossHpPct}% 남음 · ${r.phase}단계`}</p>
    ${breaks.length ? `<p class="cr-breaks">${breaks.join(' · ')}</p>` : ''}
  </div>`;
}

/** 결과 화면 기여도: 사람마다 가한 대미지(큰 숫자)와 %막대, 작은 글씨로 큰 피해 대미지·수정·추적 원·체력 */
export function coopRankHtml(r: CoopResult, players: readonly PlayerState[], myId: string, startAt: number, swatch: (p: PlayerState) => string) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return coopResultRows(r, players).map((row, i) => {
    const p = byId.get(row.id)!;
    const life = p.bot ? '' : p.outAt ? ` · ${Math.max(0, Math.round((p.outAt - startAt) / 1000))}초에 탈락` : ` · 체력 ${p.hp}`;
    return `<div class="coopdmg${row.id === myId ? ' me' : ''}">
      <span class="pos">${i + 1}</span>${swatch(p)}
      <span class="who"><span>${esc(row.name)}${row.id === myId ? ' (나)' : ''}${row.top ? ' <em class="cd-top">최다 대미지</em>' : ''}</span>
        <span class="cd-bar"><i style="width:${Math.min(100, row.pct)}%"></i></span>
        <span class="coopline">큰 피해 ${row.burstDmg} · 수정 ${row.crystals} · 추적 원 ${row.threats}${life}</span></span>
      <span class="v">${row.dmg}<small>${row.pct}%</small></span></div>`;
  }).join('');
}
