/** 대기실의 방 규칙 화면: 프리셋 버튼 + 고급 설정 (점수표는 도감 '규칙' 탭) */
import { ARCADE, COOP_LEVELS, MODE_KEYS, PRESETS, RULES, RULE_CHOICES, matchPreset, type CoopLevel, type PresetId, type RoomRules } from '@color-burst/shared';
import type { IconNode } from 'lucide';
import { UI, icon } from './icons.ts';
import { baselineOf, rulePanel } from './lobbyUI.ts';
import { RULE_ICON, rulePanelBody, rulePanelHead } from './rulePanelUI.ts';

type NumKey = keyof typeof RULE_CHOICES;
type BoolKey = 'stealPenalty' | 'comeback' | 'boss' | 'missPenalty' | 'items' | 'specialCircles' | 'waves' | 'laser' | 'sabotage';
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
  { key: 'laserFreq', label: '레이저 빈도', fmt: (v) => (v < 1 ? '드물게' : v > 1 ? '자주' : '보통') },
  { key: 'circleScale', label: '원 크기', fmt: (v) => (v < 1 ? '작게' : '보통') },
];
/** 아케이드에서만 보이는 설정 */
const ARCADE_NUM_FIELDS: { key: NumKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'themePct', label: '라운드 테마', fmt: pct3 },
  { key: 'eventPct', label: '랜덤 이벤트', fmt: pct3 },
];
/** 세부 설정 묶음: 대기실 규칙 패널과 같은 아이콘 어휘. num은 선택지가 4개 이하면 세그먼트 버튼, 5개 이상이면 선택 상자 */
type GroupField =
  | { t: 'num'; key: NumKey; arcadeOnly?: true; hideInArcade?: true; when?: (r: RoomRules) => boolean }
  | { t: 'bool'; key: BoolKey; label: string; icon: IconNode; when?: (r: RoomRules) => boolean };
const GROUPS: { id: string; label: string; icon: IconNode; fields: GroupField[] }[] = [
  { id: 'flow', label: '판 진행', icon: RULE_ICON.timer, fields: [
    { t: 'num', key: 'roundSec', hideInArcade: true }, { t: 'num', key: 'speed' }, { t: 'num', key: 'density' }, { t: 'num', key: 'circleScale' },
  ] },
  { id: 'fever', label: '피버', icon: RULE_ICON.fever, fields: [
    { t: 'num', key: 'feverMult' }, { t: 'num', key: 'feverSec' }, { t: 'num', key: 'feverGain' },
  ] },
  { id: 'penalty', label: '견제·감점', icon: RULE_ICON.mark, fields: [
    { t: 'bool', key: 'stealPenalty', label: '견제 페널티', icon: RULE_ICON.mark },
    { t: 'num', key: 'markSec', when: (r) => r.stealPenalty },
    { t: 'bool', key: 'missPenalty', label: '빈 곳 감점', icon: RULE_ICON.miss },
    { t: 'bool', key: 'comeback', label: '꼴찌 보정', icon: RULE_ICON.up },
  ] },
  { id: 'appear', label: '나오는 요소', icon: RULE_ICON.boss, fields: [
    { t: 'bool', key: 'boss', label: '보스', icon: RULE_ICON.boss },
    { t: 'bool', key: 'items', label: '아이템', icon: RULE_ICON.item },
    { t: 'bool', key: 'specialCircles', label: '특수 원', icon: RULE_ICON.special },
    { t: 'bool', key: 'waves', label: '웨이브', icon: UI.waves },
    { t: 'num', key: 'rainbowPct' },
  ] },
  { id: 'hazard', label: '위험 요소', icon: RULE_ICON.laser, fields: [
    { t: 'bool', key: 'laser', label: '레이저', icon: RULE_ICON.laser },
    { t: 'num', key: 'laserWidth', when: (r) => r.laser }, { t: 'num', key: 'laserFreq', when: (r) => r.laser },
    { t: 'num', key: 'mapPct' },
    { t: 'bool', key: 'sabotage', label: '방해 아이템', icon: UI.chaos },
  ] },
  { id: 'arcade', label: '아케이드', icon: UI.arcade, fields: [
    { t: 'num', key: 'themePct', arcadeOnly: true }, { t: 'num', key: 'eventPct', arcadeOnly: true },
  ] },
];
const ALL_NUM = [...NUM_FIELDS, ...ARCADE_NUM_FIELDS];

const COOP_LEVEL_LABEL: Record<CoopLevel, [string, string, keyof typeof UI]> = {
  easy: ['이지', '레이저가 얇고 공격이 느려요', 'chill'],
  normal: ['노말', '보통 세기의 공격', 'basic'],
  hard: ['하드', '굵은 레이저와 빠른 공격 원', 'hardcore'],
  expert: ['엑스퍼트', '촘촘한 탄막, 단단한 수정과 중앙 프리즘', 'expert'],
};
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
  if (editable && !current && !rules.coop) saveCustom(rules);
  const advOpen = el.querySelector<HTMLDetailsElement>('details.adv')?.open ?? false;
  const dis = editable ? '' : 'disabled';
  const coop = !!rules.coop;
  const arcade = rules.mode === 'arcade' && !coop;
  const solo = !rules.team && !rules.survival;
  const by = editable ? '' : ' (방장이 정해요)';
  // 게임 모드: 클래식·아케이드·협력전. 둘째 줄은 같은 모양의 버튼 세 칸으로, 협력전이면 인원 모드 대신 난이도
  const second = coop
    ? `<div class="lbl">협력전 난이도${by}</div>
    <div class="modeopts coop-levels">
      ${COOP_LEVELS.map((l) => `<button type="button" class="mopt" data-lv="${l}" aria-pressed="${rules.coopLevel === l}" title="${COOP_LEVEL_LABEL[l][1]}" ${dis}>${icon(UI[COOP_LEVEL_LABEL[l][2]], 22, 'mi')}<b>${COOP_LEVEL_LABEL[l][0]}</b></button>`).join('')}
    </div>`
    : `<div class="lbl">인원 모드${by}</div>
    <div class="modeopts">
      <button type="button" class="mopt" data-o="solo" aria-pressed="${solo}" title="모두가 각자 경쟁, 점수가 가장 높은 사람이 승리" ${dis}>${icon(UI.solo, 22, 'mi')}<b>개인전</b></button>
      <button type="button" class="mopt" data-o="team" aria-pressed="${rules.team}" title="같은 팀 색은 내 색, 팀 점수 합으로 승부" ${dis}>${icon(UI.team, 22, 'mi')}<b>팀전 2:2</b></button>
      <button type="button" class="mopt" data-o="survival" aria-pressed="${rules.survival}" title="${arcade ? '뒤쪽 라운드가 끝날 때마다' : `${RULES.survival.everyMs / 1000}초마다`} 꼴찌 탈락, 마지막 1명이 승리" ${dis}>${icon(UI.survival, 22, 'mi')}<b>서바이벌</b></button>
    </div>`;
  const head = `
    <div class="lbl">게임 모드${by}</div>
    <div class="modes three">
      <button type="button" class="mode" data-m="classic" aria-pressed="${!arcade && !coop}" title="${rules.roundSec}초 한 판 승부" ${dis}>${icon(UI.classic, 26, 'mi')}<b>클래식</b></button>
      <button type="button" class="mode" data-m="arcade" aria-pressed="${arcade}" title="${ARCADE.rounds}라운드, 라운드마다 능력 선택" ${dis}>${icon(UI.arcade, 26, 'mi')}<b>아케이드</b></button>
      <button type="button" class="mode" data-m="coop" aria-pressed="${coop}" title="다 같이 거대 보스를 잡아요, 체력 ${RULES.coop.hpMax} · ${RULES.coop.timeSec}초" ${dis}>${icon(UI.coop, 26, 'mi')}<b>협력전</b></button>
    </div>
    ${second}
    ${coop ? '<p class="coop-note">다 같이 거대 보스를 잡아요. 난이도가 오를수록 공격이 빨라지고 수정이 단단해져요.</p>' : ''}
    ${arcade ? `<label class="adv-row" for="rule-arcadeRoundSec"><span>라운드 시간</span>
      <select id="rule-arcadeRoundSec" data-k="arcadeRoundSec" ${dis}>
        ${RULE_CHOICES.arcadeRoundSec.map((v) => `<option value="${v}" ${rules.arcadeRoundSec === v ? 'selected' : ''}>${v}초</option>`).join('')}
      </select></label>` : ''}`;
  // 세부 설정 묶음: 아이콘 제목 + 세그먼트 버튼(선택지 4개 이하) / 선택 상자(5개 이상) / 아이콘 토글 타일. 프리셋과 다른 값에는 노란 점
  const base = baselineOf(rules);
  const numField = (key: NumKey) => {
    const f = ALL_NUM.find((x) => x.key === key)!;
    const choices = RULE_CHOICES[key] as readonly number[];
    const chg = rules[key] !== base[key];
    const control = choices.length <= 4
      ? `<div class="seg segs" role="group" aria-label="${f.label}">${choices.map((v) =>
        `<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${rules[key] === v}" ${dis}>${f.fmt(v)}</button>`).join('')}</div>`
      : `<select id="rule-${key}" data-k="${key}" aria-label="${f.label}" ${dis}>${choices.map((v) =>
        `<option value="${v}" ${rules[key] === v ? 'selected' : ''}>${f.fmt(v)}</option>`).join('')}</select>`;
    return `<div class="adv-field${chg ? ' rchg' : ''}"><span class="af-label">${f.label}</span>${control}</div>`;
  };
  const boolField = (key: BoolKey, label: string, ic: IconNode) => {
    const on = !!rules[key];
    return `<button type="button" class="rtog${on ? '' : ' off'}${rules[key] !== base[key] ? ' rchg' : ''}" data-b="${key}" aria-pressed="${on}" ${dis}>${icon(ic, 20)}<span>${label}</span></button>`;
  };
  const groupsHTML = GROUPS.map((g) => {
    const items = g.fields.filter((fl) => {
      if (fl.t === 'num' && ((fl.arcadeOnly && !arcade) || (fl.hideInArcade && arcade))) return false;
      return !fl.when || fl.when(rules);
    }).map((fl) => (fl.t === 'num' ? numField(fl.key) : boolField(fl.key, fl.label, fl.icon))).join('');
    return items ? `<section class="adv-group"><h4>${icon(g.icon, 18)}<span>${g.label}</span></h4><div class="adv-items">${items}</div></section>` : '';
  }).join('');
  const rest = `
    <div class="lbl">방 규칙${by}</div>
    <div class="presets">
      ${(Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]).map(([id, p]) =>
        `<button type="button" class="preset" data-p="${id}" aria-pressed="${current === id}" title="${p.desc}${'warn' in p ? ` · ${p.warn}` : ''}" ${dis}>${icon(UI[id], 20, 'pi')}<b>${p.name}</b></button>`).join('')}
      <button type="button" class="preset custom" aria-pressed="${!current}" title="고급 설정에서 직접 정한 규칙" ${dis}>${icon(UI.custom, 20, 'pi')}<b>커스텀</b></button>
    </div>
    <details class="adv">
      <summary>세부 설정</summary>
      ${groupsHTML}
    </details>`;

  // 협력전은 난이도만 고른다 (방 규칙 프리셋·고급 설정·라운드 시간은 그리지 않음)
  const panel = rulePanel(rules);
  const preview = `<div class="rp-preview" aria-label="지금 규칙 미리보기"><div class="rp-mode">${rulePanelHead(rules, panel)}</div>${rulePanelBody(panel)}</div>`;
  el.innerHTML = preview + (coop ? head : head + rest);
  if (!coop) el.querySelector<HTMLDetailsElement>('details.adv')!.open = advOpen; // 다시 그려도 열려 있던 상태 유지
  // 게임 모드: 협력전은 클래식 위에서 도는 별도 모드 (서버가 아케이드·팀전·서바이벌을 끈다)
  el.querySelectorAll<HTMLButtonElement>('.mode[data-m]').forEach((b) => {
    const m = b.dataset.m as 'classic' | 'arcade' | 'coop';
    b.onclick = () => on.change(m === 'coop' ? { coop: true } : { mode: m, coop: false });
  });
  // 인원 모드: 셋 중 하나 (개인전 = 팀전·서바이벌 모두 끔)
  el.querySelectorAll<HTMLButtonElement>('.mopt[data-o]').forEach((b) => {
    const o = b.dataset.o as 'solo' | 'team' | 'survival';
    b.onclick = () => on.change({ team: o === 'team', survival: o === 'survival' });
  });
  el.querySelectorAll<HTMLButtonElement>('.mopt[data-lv]').forEach((b) => { b.onclick = () => on.change({ coopLevel: b.dataset.lv as CoopLevel }); });
  if (coop) return;
  el.querySelectorAll<HTMLButtonElement>('.preset[data-p]').forEach((b) => { b.onclick = () => on.preset(b.dataset.p as PresetId); });
  // 커스텀: 저장해 둔 규칙을 불러오고 고급 설정을 펼친다
  el.querySelector<HTMLButtonElement>('.preset.custom')!.onclick = () => {
    el.querySelector<HTMLDetailsElement>('details.adv')!.open = true;
    const saved = loadCustom();
    if (saved && current) on.change(saved);
  };
  el.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((s) => { s.onchange = () => on.change({ [s.dataset.k!]: Number(s.value) }); });
  el.querySelectorAll<HTMLButtonElement>('button[data-k][data-v]').forEach((b) => { b.onclick = () => on.change({ [b.dataset.k!]: Number(b.dataset.v) }); });
  el.querySelectorAll<HTMLButtonElement>('button[data-b]').forEach((b) => { b.onclick = () => on.change({ [b.dataset.b!]: b.getAttribute('aria-pressed') !== 'true' }); });
}
