/**
 * 규칙 패널 그리기 (대기실과 게임 설정 창 미리보기가 같이 쓴다).
 * 데이터는 lobbyUI.ts의 rulePanel()이 만들고, 여기서는 HTML 문자열로만 바꾼다.
 */
import type { IconNode } from 'lucide';
import type { RoomRules } from '@color-burst/shared';
import { rulePanel, type RuleIconId, type RulePanel, type RuleStat, type RuleTile } from './lobbyUI.ts';
import { UI, icon } from './icons.ts';

/** 규칙 아이콘 어휘 (대기실 패널 = 설정 창, 1:1) */
export const RULE_ICON: Record<RuleIconId, IconNode> = {
  coop: UI.coop, level: UI.expert, heart: UI.heart, timer: UI.timer, fever: UI.fever, speed: UI.speed, mark: UI.mark, miss: UI.miss,
  boss: UI.boss, item: UI.item, special: UI.sparkle, laser: UI.laser, map: UI.map, rainbow: UI.rainbow, up: UI.up,
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 모드 아이콘: 협력전 · 서바이벌 · 아케이드 · 클래식 */
const modeIconOf = (r: RoomRules): IconNode => (r.coop ? UI.coop : r.survival ? UI.survival : r.mode === 'arcade' ? UI.arcade : UI.classic);

/** 1단: 모드 아이콘 + 제목 + 프리셋 배지 */
export function rulePanelHead(r: RoomRules, panel: RulePanel = rulePanel(r)): string {
  return `${icon(modeIconOf(r), 26)}<b>${esc(panel.title)}</b>${panel.preset ? `<em class="rp-preset">${esc(panel.preset)}</em>` : ''}`;
}

const statHTML = (s: RuleStat) =>
  `<div class="rstat${s.changed ? ' rchg' : ''}" ${s.changed ? 'title="기본 규칙과 다른 값"' : ''}>${icon(RULE_ICON[s.icon], 18)}<b>${esc(s.big)}</b><span>${esc(s.small)}</span></div>`;

/** 켜짐/꺼짐은 색뿐 아니라 슬래시(.off)와 aria-label로도 알린다 */
export function ruleTileHTML(t: RuleTile): string {
  const label = `${t.label} ${t.on ? '켜짐' : '꺼짐'}${t.badge ? ` ${t.badge}` : ''}${t.changed ? ' (기본과 다름)' : ''}`;
  return `<span class="rtile${t.on ? '' : ' off'}${t.changed ? ' rchg' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">`
    + `${icon(RULE_ICON[t.icon], 20)}<span class="rt-label">${esc(t.label)}</span>${t.badge ? `<em>${esc(t.badge)}</em>` : ''}</span>`;
}

/** 2·3단: 핵심 숫자 3칸 + 켜진 요소 타일 묶음 */
export function rulePanelBody(panel: RulePanel): string {
  const groups = panel.groups.map((g) =>
    `<div class="rp-group"><span class="rp-label">${esc(g.label)}</span><div class="rp-tiles">${g.tiles.map(ruleTileHTML).join('')}</div></div>`).join('');
  return `<div class="rp-stats">${panel.stats.map(statHTML).join('')}</div>${groups}`;
}
