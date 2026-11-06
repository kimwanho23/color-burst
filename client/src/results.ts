/** 결과 화면: 순위, 칭호, 점수 그래프 */
import { COLORS, type GameOver, type PlayerState } from '@color-burst/shared';
import { shapeSVG } from './render.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderResult(d: GameOver, myId: string) {
  const byId = new Map(d.ranking.map((p) => [p.id, p]));
  const titlesOf = (id: string) => d.titles.filter((t) => t.playerId === id);

  const rank = d.ranking.map((p, i) => {
    const w = d.wins[p.id];
    const tags = titlesOf(p.id).map((t) => `<span class="title" title="${esc(t.desc)}">${t.name}</span>`).join('');
    return `<div class="${p.id === myId ? 'me' : ''}">
      <span class="pos">${i + 1}</span>${shapeSVG(p.color, 24)}
      <span class="who"><span>${esc(p.name)}${p.id === myId ? ' (나)' : ''}${w ? ` <em>${w}승</em>` : ''}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</span>
      <span class="v">${p.score}</span></div>`;
  }).join('');

  const titles = d.titles.length
    ? `<ul class="titlelist">${d.titles.map((t) => {
        const p = byId.get(t.playerId);
        return `<li><b>${t.name}</b><span>${p ? esc(p.name) : ''}</span><em>${esc(t.desc)}</em></li>`;
      }).join('')}</ul>`
    : '';

  return { rank, titles, graph: scoreGraph(d, myId) };
}

/** 시간에 따른 점수 선 그래프 (SVG) */
function scoreGraph(d: GameOver, myId: string) {
  const W = 520, H = 180, L = 34, R = 92, T = 12, B = 24;
  const series = d.ranking.map((p) => ({ p, ys: d.history.scores[p.id] ?? [0] }));
  const n = Math.max(...series.map((s) => s.ys.length));
  if (n < 2) return '';
  const maxY = niceMax(Math.max(10, ...series.flatMap((s) => s.ys)));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const totalSec = Math.round(((n - 1) * d.history.stepMs) / 1000);

  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(maxY * f);
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="g-axis" text-anchor="end">${v}</text>`;
  }).join('');
  const xAxis = [0, Math.round(totalSec / 2), totalSec].map((sec) =>
    `<text x="${x((sec * 1000) / d.history.stepMs)}" y="${H - 6}" class="g-axis" text-anchor="middle">${sec}초</text>`).join('');

  // 오른쪽 끝 이름표가 겹치지 않게 아래로 밀기
  const ends = series.map((s) => ({ s, ly: y(s.ys[s.ys.length - 1]) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 15);

  // 아래 순위부터 그려서 1등 선이 위에 오게
  const lines = [...series].reverse().map(({ p, ys }) => {
    const pts = ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const mine = p.id === myId;
    return `<polyline points="${pts}" fill="none" stroke="${COLORS[p.color].hex}" stroke-width="${mine ? 3.5 : 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${mine ? 1 : 0.85}"/>
      <circle cx="${x(ys.length - 1)}" cy="${y(ys[ys.length - 1])}" r="${mine ? 4.5 : 3.5}" fill="${COLORS[p.color].hex}"/>`;
  }).join('');
  const labels = ends.map(({ s, ly }) =>
    `<text x="${W - R + 8}" y="${ly + 4}" class="g-label" fill="${COLORS[s.p.color].hex}">${esc(short(s.p))} ${s.ys[s.ys.length - 1]}</text>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="graph" role="img" aria-label="시간에 따른 점수 변화">${grid}${xAxis}${lines}${labels}</svg>`;
}

const short = (p: PlayerState) => (p.name.length > 6 ? p.name.slice(0, 6) + '…' : p.name);
function niceMax(v: number) {
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * step) return m * step;
  return 10 * step;
}
