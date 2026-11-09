/** 대기실의 방 규칙 화면: 프리셋 버튼 + 고급 설정 (점수표는 도감 '규칙' 탭) */
import { ARCADE, MODE_KEYS, PRESETS, RULES, RULE_CHOICES, matchPreset, type PresetId, type RoomRules } from '@color-burst/shared';
import { shapeSVG } from './render.ts';
import { UI, icon } from './icons.ts';

type NumKey = keyof typeof RULE_CHOICES;
type BoolKey = 'stealPenalty' | 'comeback' | 'boss' | 'missPenalty' | 'items' | 'waves' | 'laser' | 'sabotage';
const MAP_LABEL: Record<number, string> = { 0: '끄기', 20: '가끔', 35: '보통', 50: '자주', 80: '많이', 100: '항상' };
const pct3 = (v: number) => (v === 0 ? '끄기' : v >= 30 ? `자주 (${v}%)` : `가끔 (${v}%)`);

const NUM_FIELDS: { key: NumKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'speed', label: '게임 속도', fmt: (v) => `×${v}` },
  { key: 'density', label: '원 개수', fmt: (v) => (v < 1 ? '적게' : v > 1 ? '많이' : '보통') },
  { key: 'roundSec', label: '한 판 시간', fmt: (v) => `${v}초` },
  { key: 'feverMult', label: '피버 배율', fmt: (v) => `×${v}` },
  { key: 'feverSec', label: '피버 시간', fmt: (v) => `${v}초` },
  { key: 'feverGain', label: '피버 충전', fmt: (v) => (v < 1 ? '느림' : v > 1 ? '빠름' : '보통') },
  { key: 'rainbowPct', label: '무지개 원', fmt: (v) => (v ? `${v}%` : '없음') },
  { key: 'markSec', label: '표적 시간', fmt: (v) => (v ? `${v}초` : '없음') },
  { key: 'mapPct', label: '맵 패턴', fmt: (v) => `${MAP_LABEL[v] ?? v} (${v}%)` },
  { key: 'laserWidth', label: '레이저 두께', fmt: (v) => (v <= 15 ? '얇게' : v >= 30 ? '굵게' : '보통') },
  { key: 'circleScale', label: '원 크기', fmt: (v) => (v < 1 ? '작게' : '보통') },
];
/** 아케이드에서만 보이는 설정 */
const ARCADE_NUM_FIELDS: { key: NumKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'themePct', label: '라운드 테마', fmt: pct3 },
  { key: 'eventPct', label: '랜덤 이벤트', fmt: pct3 },
];
const BOOL_FIELDS: { key: BoolKey; label: string }[] = [
  { key: 'boss', label: '보스 원 등장' },
  { key: 'missPenalty', label: '빈 곳 클릭 페널티' },
  { key: 'stealPenalty', label: '평상시 견제 페널티' },
  { key: 'comeback', label: '꼴찌 보정 (피버 빨리 참)' },
  { key: 'items', label: '아이템 원' },
  { key: 'waves', label: '발사 패턴 (웨이브)' },
  { key: 'laser', label: '레이저 (맞으면 스턴)' },
  { key: 'sabotage', label: '방해 아이템 (감도·반대·시야·저격)' },
];
/** 커스텀 규칙: 방장 브라우저에만 저장 (모드 설정은 빼고) */
const CUSTOM_KEY = 'cb-custom-rules';
function loadCustom(): Partial<RoomRules> | null {
  try { const s = localStorage.getItem(CUSTOM_KEY); return s ? JSON.parse(s) as Partial<RoomRules> : null; } catch { return null; }
}
function saveCustom(r: RoomRules) {
  const out: Partial<RoomRules> = { ...r };
  for (const k of MODE_KEYS) delete out[k];
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(out)); } catch { /* 저장 못 해도 게임에는 지장 없음 */ }
}

export interface RulesUIHandlers {
  preset: (id: PresetId) => void;
  change: (patch: Partial<RoomRules>) => void;
}

export function renderRules(el: HTMLElement, rules: RoomRules, editable: boolean, on: RulesUIHandlers) {
  const current = matchPreset(rules);
  // 방장이 프리셋과 다른 규칙을 만들면 커스텀으로 기억
  if (editable && !current) saveCustom(rules);
  const advOpen = el.querySelector<HTMLDetailsElement>('details.adv')?.open ?? false;
  const dis = editable ? '' : 'disabled';
  const arcade = rules.mode === 'arcade';
  el.innerHTML = `
    <div class="lbl">모드${editable ? '' : ' (방장이 정해요)'}</div>
    <div class="modes">
      <button type="button" class="mode" data-m="classic" aria-pressed="${!arcade}" ${dis}>${icon(UI.classic, 26, 'mi')}<b>클래식</b><span>${rules.roundSec}초 한 판 승부</span></button>
      <button type="button" class="mode" data-m="arcade" aria-pressed="${arcade}" ${dis}>${icon(UI.arcade, 26, 'mi')}<b>아케이드</b><span>${ARCADE.rounds}라운드, 라운드마다 능력 선택</span></button>
    </div>
    <div class="modeopts">
      <button type="button" class="mopt" data-o="team" aria-pressed="${rules.team}" ${dis}><b>팀전 2:2</b><span>같은 팀 색은 내 색, 팀 점수 합으로 승부</span></button>
      <button type="button" class="mopt" data-o="survival" aria-pressed="${rules.survival}" ${dis}><b>서바이벌</b><span>${arcade ? '뒤쪽 라운드가 끝날 때마다' : `${RULES.survival.everyMs / 1000}초마다`} 꼴찌 탈락, 마지막 1명이 승리</span></button>
    </div>
    ${arcade ? `<label class="adv-row" for="rule-arcadeRoundSec"><span>라운드 시간</span>
      <select id="rule-arcadeRoundSec" data-k="arcadeRoundSec" ${dis}>
        ${RULE_CHOICES.arcadeRoundSec.map((v) => `<option value="${v}" ${rules.arcadeRoundSec === v ? 'selected' : ''}>${v}초</option>`).join('')}
      </select></label>` : ''}
    <div class="lbl">방 규칙${editable ? '' : ' (방장이 정해요)'}</div>
    <div class="presets">
      ${(Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]).map(([id, p]) =>
        `<button type="button" class="preset" data-p="${id}" aria-pressed="${current === id}" ${dis}>${icon(UI[id], 20, 'pi')}<b>${p.name}</b><span>${p.desc}</span>${'warn' in p ? `<em class="pwarn">${p.warn}</em>` : ''}</button>`).join('')}
      <button type="button" class="preset custom" aria-pressed="${!current}" ${dis}>${icon(UI.custom, 20, 'pi')}<b>커스텀</b><span>고급 설정에서 직접 정한 규칙</span></button>
    </div>
    <details class="adv">
      <summary>고급 설정</summary>
      <div class="adv-grid">
        ${[...NUM_FIELDS.filter((f) => !(arcade && f.key === 'roundSec')), ...(arcade ? ARCADE_NUM_FIELDS : [])].map((f) => `
          <label class="adv-row" for="rule-${f.key}"><span>${f.label}</span>
            <select id="rule-${f.key}" data-k="${f.key}" ${dis}>
              ${RULE_CHOICES[f.key].map((v) => `<option value="${v}" ${rules[f.key] === v ? 'selected' : ''}>${f.fmt(v)}</option>`).join('')}
            </select>
          </label>`).join('')}
        ${BOOL_FIELDS.map((f) => `
          <label class="adv-row check" for="rule-${f.key}"><span>${f.label}</span>
            <input type="checkbox" id="rule-${f.key}" data-b="${f.key}" ${rules[f.key] ? 'checked' : ''} ${dis}>
          </label>`).join('')}
      </div>
    </details>`;

  // 다시 그려도 열려 있던 상태 유지
  el.querySelector<HTMLDetailsElement>('details.adv')!.open = advOpen;
  el.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => { b.onclick = () => on.change({ mode: b.dataset.m as RoomRules['mode'] }); });
  // 모드 옵션(팀전·서바이벌): 누르면 켜고 끔
  el.querySelectorAll<HTMLButtonElement>('.mopt').forEach((b) => {
    const k = b.dataset.o as 'team' | 'survival';
    b.onclick = () => on.change({ [k]: !rules[k] });
  });
  el.querySelectorAll<HTMLButtonElement>('.preset[data-p]').forEach((b) => { b.onclick = () => on.preset(b.dataset.p as PresetId); });
  // 커스텀: 저장해 둔 규칙을 불러오고 고급 설정을 펼친다
  el.querySelector<HTMLButtonElement>('.preset.custom')!.onclick = () => {
    el.querySelector<HTMLDetailsElement>('details.adv')!.open = true;
    const saved = loadCustom();
    if (saved && current) on.change(saved);
  };
  el.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((s) => { s.onchange = () => on.change({ [s.dataset.k!]: Number(s.value) }); });
  el.querySelectorAll<HTMLInputElement>('input[data-b]').forEach((c) => { c.onchange = () => on.change({ [c.dataset.b!]: c.checked }); });
}

export function scoreTable(r: RoomRules) {
  const m = r.feverMult, P = RULES.points;
  const steal = r.stealPenalty
    ? `+${P.stealCalm}, 내 콤보 끊김${r.markSec ? `, ${r.markSec}초 표적` : ''}`
    : `+${P.stealCalm}, 페널티 없음`;
  return `<table>
    <tr><th>대상</th><th>평상시</th><th>피버 중 (×${m}, ${r.feverSec}초)</th></tr>
    <tr><td>${shapeSVG(0, 16)} 내 색</td><td>+${P.own}</td><td>+${P.own * m}</td></tr>
    <tr><td>${shapeSVG('y', 16)} 노란색</td><td>+${P.yellow}</td><td>내 색 취급 +${P.own * m}</td></tr>
    ${r.rainbowPct ? `<tr><td>${shapeSVG('rainbow', 16)} 무지개</td><td>+${P.rainbow}</td><td>+${P.rainbow * m}</td></tr>` : ''}
    <tr><td>남의 색 (견제)</td><td>${steal}</td><td>+${P.stealCalm * m}, 페널티 없음</td></tr>
    ${r.stealPenalty && r.markSec ? `<tr><td>표적의 색 (반격)</td><td>+${P.counter}</td><td>+${P.counter * m}</td></tr>` : ''}
    ${r.boss ? `<tr><td>${shapeSVG('boss', 16)} 보스 원</td><td>피해 1마다 +${RULES.boss.hit}, 막타 +${RULES.boss.kill}, 최다 타격 +${RULES.boss.mvp}, 독식(체력 ${RULES.boss.solo.pct}% 이상) +${RULES.boss.solo.points}·막타 ×${RULES.boss.solo.killMult}</td><td>×${m} (콤보·게이지도 참)</td></tr>` : ''}
    <tr><td>빈 공간</td>${r.missPenalty ? '<td>콤보 끊김, 피버 감소</td><td>콤보 끊김</td>' : '<td>페널티 없음</td><td>페널티 없음</td>'}</tr>
    ${r.items ? '<tr><td>? 아이템 원</td><td colspan="2">잡으면 무작위 아이템이 바로 발동 (점수 없음)</td></tr>' : ''}
  </table>`;
}
