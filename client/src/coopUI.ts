/** 협력전 화면: 보스 체력 바(위쪽), 결과 요약 */
import { RULES, counterValue, type CoopCounter, type CoopLevel, type CoopResult, type CoopState, type PlayerState } from '@color-burst/shared';
import { UI, icon, coopSpecialIcon } from './icons.ts';
import { COOP_SPECIAL_IDS, COOP_SPECIALS, specialId, specialRule } from '@color-burst/shared';

export function specialPickerHtml(p: PlayerState | undefined): string {
  const chosen = specialId(p?.coopSpecial);
  const maxCharge = Math.max(...COOP_SPECIAL_IDS.map((id) => specialRule(id).charge));
  const maxDamage = Math.max(...COOP_SPECIAL_IDS.map((id) => specialRule(id).damage));
  return `<b>스페셜 어택</b><p>원 획득 +${RULES.coop.special.gain.orb} · 수정 타격 +${RULES.coop.special.gain.crystal} · 큰 원 제거 +${RULES.coop.special.gain.threat}<br>SPACE로 자동 공격 · 딜 타임 피해 ${RULES.coop.burst.mult}배<br>우클릭(휴대폰은 화면 버튼) 보호막: ${RULES.coop.barrier.durationMs / 1000}초 동안 피해를 막아요 · 판마다 이지 ${RULES.coop.barrier.uses.easy} · 노말 ${RULES.coop.barrier.uses.normal} · 하드 ${RULES.coop.barrier.uses.hard}회<br>피해를 너무 몰아 넣으면 보스가 반격해 콤보가 0이 됩니다.</p><div class="special-choices">${COOP_SPECIAL_IDS.map((id) => {
    const a = COOP_SPECIALS[id], r = specialRule(id);
    return `<button type="button" class="special-choice${id === chosen ? ' selected' : ''}" data-special="${id}" aria-pressed="${id === chosen}" style="--special-color:${a.color}">
      <div class="special-emblem">${coopSpecialIcon(id, 48)}</div>
      <strong>${a.name}${id === chosen ? '<em>선택됨</em>' : ''}</strong><span>${a.desc}</span>
      <div class="special-stats" aria-hidden="true"><div>충전량<i><s style="width:${r.charge / maxCharge * 100}%"></s></i></div><div>위력<i><s style="width:${r.damage / maxDamage * 100}%"></s></i></div></div>
      <small>충전 ${r.charge} · 기본 총피해 ${r.damage} · ${r.durationMs / 1000}초</small></button>`;
  }).join('')}</div>`;
}

export function renderSpecialHud(stage: HTMLElement, p: PlayerState | undefined, shield: boolean, active: boolean) {
  const el = ensure(stage, 'coopSpecialHud', 'special-hud');
  el.hidden = !p || p.bot;
  if (!p || p.bot) return;
  const id = specialId(p.coopSpecial), r = specialRule(id), a = COOP_SPECIALS[id];
  const charge = p.coopCharge ?? 0, ready = charge >= r.charge && !p.outAt;
  el.style.setProperty('--special-color', a.color);
  el.classList.toggle('ready', ready && !shield && !active);
  const hint = p.outAt ? '관전 중' : active ? '공격 중' : shield ? '수정 파훼 후 사용 가능' : ready ? '<kbd>SPACE</kbd> 발동' : '원 획득 · 수정 타격 · 큰 원 제거로 충전';
  el.innerHTML = `<div><b>${coopSpecialIcon(id)}${a.name}</b><span>${Math.floor(charge)} / ${r.charge}</span></div><div class="special-meter"><i style="width:${Math.min(100, charge / r.charge * 100)}%"></i></div><small>${hint}</small>`;
}

/** 우클릭 보호막 남은 횟수. 터치면 누를 수 있는 버튼이 된다. 판당 횟수가 0인 난이도(엑스퍼트)·관전·봇이면 숨긴다 */
export function renderBarrierHud(stage: HTMLElement, p: PlayerState | undefined, level: CoopLevel, touch: boolean, onUse: () => void) {
  let el = document.getElementById('coopBarrierHud') as HTMLButtonElement | null;
  if (!el) {
    el = document.createElement('button'); el.id = 'coopBarrierHud'; el.type = 'button'; el.className = 'barrier-hud';
    // 버튼을 누른 터치가 캔버스 클릭으로 이어지지 않게 막는다
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (!el!.disabled) onUse(); });
    // 버튼 위 터치 이동·떼기가 창의 게임 커서 이동으로 새지 않게 막는다 (누르는 순간 커서가 버튼으로 순간이동하지 않게)
    for (const ev of ['pointermove', 'pointerup'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.appendChild(el);
  }
  const uses = RULES.coop.barrier.uses[level];
  el.hidden = !p || p.bot || !!p.outAt || uses <= 0;
  if (el.hidden || !p) return;
  const left = p.coopFx?.barrierLeft ?? 0;
  // 남은 횟수·입력 방식이 그대로면 다시 그리지 않는다
  const key = `${left}:${touch}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.disabled = left <= 0;
  el.classList.toggle('touch', touch);
  el.innerHTML =`<span class="barrier-dot" aria-hidden="true"></span><b>보호막 ${left}</b><small>${touch ? '눌러서 사용' : '우클릭'}</small>`;
  el.setAttribute('aria-label', `보호막 ${left}회 남음`);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LEVEL_NAME = { easy: '이지', normal: '노말', hard: '하드', expert: '엑스퍼트' } as const;

function ensure(stage: HTMLElement, id: string, cls: string) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; stage.appendChild(el); }
  return el;
}

/**
 * 화면 번쩍임 시각을 서버 상태에 맞춘다. prev: 지금 들고 있는 발동 시각, g: 받은 게이지, synced: 재개·재접속(경고음 없이 시각만 맞춤).
 * 발동 전에 fireAt이 0으로 오면 취소(번쩍임 지움), 발동 뒤에 0으로 오면 판정이 끝난 것(번쩍임 유지)
 */
export function counterFlashAt(prev: number, g: CoopCounter | null | undefined, now: number, synced = false): { fireAt: number; warn: boolean } {
  if (!g) return { fireAt: 0, warn: false };
  if (g.fireAt > 0) return { fireAt: g.fireAt, warn: !synced && g.fireAt !== prev };
  return { fireAt: prev > now ? 0 : prev, warn: false };
}

/** 분노 게이지를 계속 다시 그려야 하는지: 남은 값이 있거나 예고·재사용 대기 중 */
export function counterHudLive(g: CoopCounter | null | undefined, level: CoopLevel, now: number): boolean {
  return !!g && (g.fireAt > 0 || now < g.coolUntil || counterValue(g, now, level) > 0);
}

/** 보스 체력 바 아래 분노 게이지: 차오를수록 진해지고, 예고 중이면 가득, 재사용 대기 중이면 흐리게 남은 초 */
function counterGauge(g: CoopCounter, level: CoopLevel, now: number) {
  const cap = RULES.coop.counter.cap[level];
  const cooling = now < g.coolUntil;
  const fill = g.fireAt > 0 ? 1 : cooling ? 0 : Math.min(1, counterValue(g, now, level) / cap);
  const label = cooling ? `<span>반격 대기 ${Math.ceil((g.coolUntil - now) / 1000)}초</span>` : '';
  return `<div class="ch-rage-gauge${cooling ? ' cooling' : ''}${g.fireAt > 0 ? ' firing' : ''}" title="분노 게이지"><i style="width:${fill * 100}%;opacity:${0.45 + 0.55 * fill}"></i>${label}</div>`;
}

/** 위쪽 보스 체력 바 (null이면 숨김). 보호막이면 자물쇠와 남은 초, 분노 경고·큰 피해 구간 표시 */
export function renderCoopHud(stage: HTMLElement, s: CoopState | null, now = Date.now()) {
  const el = ensure(stage, 'coopHud', 'coophud');
  el.hidden = !s;
  if (!s) return;
  const pct = s.maxHp > 0 ? Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100)) : 0;
  const [a, b] = RULES.coop.phaseAt;
  const left = (t: number) => Math.max(0, Math.ceil((t - now) / 1000));
  const g = s.counter;
  const warn = g && g.fireAt > now
    ? `<em class="ch-rage">보스 반격! ${left(g.fireAt)}초 · ${RULES.coop.barrier.uses[s.level] > 0 ? '보호막으로 콤보를 지키세요' : '콤보가 초기화됩니다'}</em>` : '';
  const status = s.rageAt ? '<em class="ch-rage">분노!</em>'
    : warn ? warn
    : s.shield ? `<em class="ch-shield">${icon(UI.lock, 14)}보호막 · 수정 깨기 ${left(s.shield.until)}초</em>`
    : s.threatAt && s.threatAt > now ? `<em class="ch-rage">보스가 큰 원을 발사합니다! 클릭해서 제거하세요! (${left(s.threatAt)}초)</em>`
    : s.burstUntil > now ? `<em class="ch-burst">보스가 무너졌다! ${left(s.burstUntil)}초</em>` : '';
  el.classList.toggle('shielded', !!s.shield);
  el.classList.toggle('raging', !!s.rageAt);
  el.innerHTML = `
    <div class="ch-top"><b>레이드 보스</b><span>${s.phase}단계 · ${LEVEL_NAME[s.level]}</span>${status}<em>${Math.ceil(pct)}%</em></div>
    <div class="ch-bar"><i style="width:${pct}%"></i><s style="left:${a * 100}%"></s><s style="left:${b * 100}%"></s></div>${g ? counterGauge(g, s.level, now) : ''}`;
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
