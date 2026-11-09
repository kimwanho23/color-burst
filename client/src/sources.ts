/** 결과 화면: 점수 출처 막대 (어디서 점수를 벌었는지) */
import { emptyStats, otherOf, type PlayerState, type SrcKey } from '@color-burst/shared';
import { shapeSVG } from './render.ts';

type Part = SrcKey | 'other';
const PARTS: readonly { key: Part; name: string; color: string }[] = [
  { key: 'circle', name: '원', color: '#4dabf7' },
  { key: 'combo', name: '콤보 보너스', color: '#b197fc' },
  { key: 'magnet', name: '자석', color: '#63e6be' },
  { key: 'gold', name: '황금 원', color: '#ffd43b' },
  { key: 'boss', name: '보스', color: '#ff8787' },
  { key: 'steal', name: '견제', color: '#ffa94d' },
  { key: 'threat', name: '공격 원 막기', color: '#c77dff' },
  { key: 'other', name: '기타', color: '#868e96' },
];

/** 기타는 음수일 수 있어 막대·비율은 플러스 출처의 합을 기준으로 한다 */
export const OTHER_NOTE = '기타 = 이벤트·저주 정산(음수 가능), 비율은 플러스 출처 합 기준';

const esc =(s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

/** 플레이어마다 출처별 가로 막대 한 줄. 마우스를 올리면 출처별 점수·비율, 잃은 점수, 참고값 */
export function sourcesHtml(ranking: readonly PlayerState[], myId: string) {
  if (!ranking.length) return '';
  const rows = ranking.map((p) => {
    const s = p.stats?.src ?? emptyStats().src;
    const val = (k: Part) => (k === 'other' ? otherOf(p) : s[k]);
    const total = PARTS.reduce((a, x) => a + Math.max(0, val(x.key)), 0);
    const bar = PARTS.filter((x) => val(x.key) > 0)
      .map((x) => `<i style="width:${(val(x.key) / total) * 100}%;background:${x.color}"></i>`).join('');
    const lines = PARTS.filter((x) => val(x.key) !== 0)
      .map((x) => `<div><span class="dot" style="background:${x.color}"></span>${x.name} <b>${val(x.key)}</b>${val(x.key) > 0 ? ` (${pct(val(x.key), total)}%)` : ''}</div>`).join('');
    const extra = [
      s.lost ? `<div>잃은 점수 <b>−${s.lost}</b></div>` : '',
      otherOf(p) !== 0 ? `<div class="ref">${OTHER_NOTE}</div>` : '',
      s.fever ? `<div class="ref">피버 중 얻은 점수 ${s.fever}</div>` : '',
      s.jackpot ? `<div class="ref">잭팟으로 더 얻은 점수 ${s.jackpot}</div>` : '',
    ].join('');
    const tip = `<div class="tiphead">${esc(p.name)} · ${p.score}점</div>${lines || '<div>점수 없음</div>'}${extra}`;
    return `<div class="srcrow${p.id === myId ? ' me' : ''}" data-tip="${esc(tip)}">
      ${shapeSVG(p.color, 16)}<span class="nm">${esc(p.name)}</span><span class="srcbar">${bar}</span></div>`;
  }).join('');
  const legend = PARTS.map((x) => `<span><span class="dot" style="background:${x.color}"></span>${x.name}</span>`).join('');
  return `<div class="srcbox"><div class="lbl">점수 출처</div>${rows}<div class="srclegend">${legend}</div></div>`;
}
