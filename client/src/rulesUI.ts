/** 대기실의 방 규칙 화면: 프리셋 버튼 + 고급 설정 + 점수표 */
import { ARCADE, PRESETS, RULES, RULE_CHOICES, matchPreset, type PresetId, type RoomRules } from '@color-burst/shared';
import { shapeSVG } from './render.ts';
import { UI, icon } from './icons.ts';

type NumKey = keyof typeof RULE_CHOICES;
type BoolKey = 'stealPenalty' | 'comeback' | 'boss' | 'missPenalty' | 'items' | 'waves' | 'laser' | 'sabotage' | 'randomEvents';

const NUM_FIELDS: { key: NumKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'speed', label: '게임 속도', fmt: (v) => `×${v}` },
  { key: 'density', label: '원 개수', fmt: (v) => (v < 1 ? '적게' : v > 1 ? '많이' : '보통') },
  { key: 'roundSec', label: '한 판 시간', fmt: (v) => `${v}초` },
  { key: 'feverMult', label: '피버 배율', fmt: (v) => `×${v}` },
  { key: 'feverSec', label: '피버 시간', fmt: (v) => `${v}초` },
  { key: 'feverGain', label: '피버 충전', fmt: (v) => (v < 1 ? '느림' : v > 1 ? '빠름' : '보통') },
  { key: 'rainbowPct', label: '무지개 원', fmt: (v) => (v ? `${v}%` : '없음') },
  { key: 'markSec', label: '표적 시간', fmt: (v) => (v ? `${v}초` : '없음') },
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
/** 아케이드에서만 보이는 설정 */
const ARCADE_BOOL_FIELDS: { key: BoolKey; label: string }[] = [
  { key: 'randomEvents', label: '랜덤 이벤트' },
];

export interface RulesUIHandlers {
  preset: (id: PresetId) => void;
  change: (patch: Partial<RoomRules>) => void;
}

export function renderRules(el: HTMLElement, rules: RoomRules, editable: boolean, on: RulesUIHandlers) {
  const current = matchPreset(rules);
  const advOpen = el.querySelector<HTMLDetailsElement>('details.adv')?.open ?? false;
  const tblOpen = el.querySelector<HTMLDetailsElement>('details.rules')?.open ?? false;
  const dis = editable ? '' : 'disabled';
  const arcade = rules.mode === 'arcade';
  el.innerHTML = `
    <div class="lbl">모드${editable ? '' : ' (방장이 정해요)'}</div>
    <div class="modes">
      <button type="button" class="mode" data-m="classic" aria-pressed="${!arcade}" ${dis}>${icon(UI.classic, 26, 'mi')}<b>클래식</b><span>${rules.roundSec}초 한 판 승부</span></button>
      <button type="button" class="mode" data-m="arcade" aria-pressed="${arcade}" ${dis}>${icon(UI.arcade, 26, 'mi')}<b>아케이드</b><span>${ARCADE.rounds}라운드, 라운드마다 능력 선택</span></button>
    </div>
    ${arcade ? `<label class="adv-row" for="rule-arcadeRoundSec"><span>라운드 시간</span>
      <select id="rule-arcadeRoundSec" data-k="arcadeRoundSec" ${dis}>
        ${RULE_CHOICES.arcadeRoundSec.map((v) => `<option value="${v}" ${rules.arcadeRoundSec === v ? 'selected' : ''}>${v}초</option>`).join('')}
      </select></label>` : ''}
    <div class="lbl">방 규칙${editable ? '' : ' (방장이 정해요)'}</div>
    <div class="presets">
      ${(Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]).map(([id, p]) =>
        `<button type="button" class="preset" data-p="${id}" aria-pressed="${current === id}" ${dis}>${icon(UI[id], 20, 'pi')}<b>${p.name}</b><span>${p.desc}</span></button>`).join('')}
    </div>
    ${current ? '' : '<p class="hint">사용자 설정 규칙</p>'}
    <details class="adv">
      <summary>고급 설정</summary>
      <div class="adv-grid">
        ${NUM_FIELDS.filter((f) => !(arcade && f.key === 'roundSec')).map((f) => `
          <label class="adv-row" for="rule-${f.key}"><span>${f.label}</span>
            <select id="rule-${f.key}" data-k="${f.key}" ${dis}>
              ${RULE_CHOICES[f.key].map((v) => `<option value="${v}" ${rules[f.key] === v ? 'selected' : ''}>${f.fmt(v)}</option>`).join('')}
            </select>
          </label>`).join('')}
        ${[...BOOL_FIELDS, ...(arcade ? ARCADE_BOOL_FIELDS : [])].map((f) => `
          <label class="adv-row check" for="rule-${f.key}"><span>${f.label}</span>
            <input type="checkbox" id="rule-${f.key}" data-b="${f.key}" ${rules[f.key] ? 'checked' : ''} ${dis}>
          </label>`).join('')}
      </div>
    </details>
    <details class="rules">
      <summary>점수표 보기</summary>
      ${scoreTable(rules)}
    </details>`;

  // 다시 그려도 열려 있던 상태 유지
  el.querySelector<HTMLDetailsElement>('details.adv')!.open = advOpen;
  el.querySelector<HTMLDetailsElement>('details.rules')!.open = tblOpen;
  el.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => { b.onclick = () => on.change({ mode: b.dataset.m as RoomRules['mode'] }); });
  el.querySelectorAll<HTMLButtonElement>('.preset').forEach((b) => { b.onclick = () => on.preset(b.dataset.p as PresetId); });
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
    ${r.boss ? `<tr><td>${shapeSVG('boss', 16)} 보스 원</td><td>때릴 때 +${RULES.boss.hit}, 막타 +${RULES.boss.kill}, 최다 타격 +${RULES.boss.mvp}</td><td>배율 최대 ×${Math.min(m, RULES.boss.feverMultCap)}</td></tr>` : ''}
    <tr><td>빈 공간</td>${r.missPenalty ? '<td>콤보 끊김, 피버 감소</td><td>콤보 끊김</td>' : '<td>페널티 없음</td><td>페널티 없음</td>'}</tr>
    ${r.items ? '<tr><td>? 아이템 원</td><td colspan="2">잡으면 무작위 아이템이 바로 발동 (점수 없음)</td></tr>' : ''}
  </table>`;
}
