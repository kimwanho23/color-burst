/**
 * 게임 방법 슬라이드 그림 (SVG 문자열, DOM 없이 만든다). 모두 viewBox 320×180.
 * 게임 화면과 같은 모양: 내 색 원(안쪽 무늬), 노란 원, 무지개 원, 게임 커서(동그라미 + 십자)
 */
import { COLORS, YELLOW } from '@color-burst/shared';

const W = 320, H = 180;
const ME = 1; // 그림 속 '나'는 블루
const RIVAL = 0; // 견제·반격 상대는 코랄

type Kind = 0 | 1 | 2 | 3 | 'y' | 'rainbow' | 'gold' | 'item';

/** 원 하나. kind가 숫자면 그 사람 색과 무늬 */
export function ball(x: number, y: number, r: number, kind: Kind, uid = 'a') {
  if (kind === 'rainbow') {
    return `<defs><linearGradient id="rb-${uid}" x1="0" x2="1"><stop offset="0" stop-color="#ff5d73"/><stop offset=".5" stop-color="#ffd43b"/><stop offset="1" stop-color="#4dabf7"/></linearGradient></defs>`
      + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#rb-${uid})"/>`;
  }
  if (kind === 'gold') return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffc23a" stroke="#fff6c8" stroke-width="2"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .3}" fill="#fff6c8" opacity=".7"/>`;
  if (kind === 'item') return `<circle cx="${x}" cy="${y}" r="${r}" fill="#2b3070" stroke="#7fd3ff" stroke-width="2.5"/><text x="${x}" y="${y + r * .38}" text-anchor="middle" font-size="${r * 1.1}" font-weight="900" fill="#7fd3ff">?</text>`;
  const fill = kind === 'y' ? YELLOW : COLORS[kind].hex;
  const shape = kind === 'y' ? 'dot' : COLORS[kind].shape;
  const w = 'fill="#fff" fill-opacity=".85"', s = r * 2, l = x - r, t = y - r;
  const inner = {
    tri: `<polygon points="${x},${t + s * .28} ${l + s * .74},${t + s * .7} ${l + s * .26},${t + s * .7}" ${w}/>`,
    square: `<rect x="${l + s * .32}" y="${t + s * .32}" width="${s * .36}" height="${s * .36}" ${w}/>`,
    diamond: `<polygon points="${x},${t + s * .26} ${l + s * .74},${y} ${x},${t + s * .74} ${l + s * .26},${y}" ${w}/>`,
    plus: `<rect x="${l + s * .43}" y="${t + s * .27}" width="${s * .14}" height="${s * .46}" ${w}/><rect x="${l + s * .27}" y="${t + s * .43}" width="${s * .46}" height="${s * .14}" ${w}/>`,
    dot: `<circle cx="${x}" cy="${y}" r="${s * .14}" fill="#5c4400" fill-opacity=".7"/>`,
  }[shape];
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>${inner}`;
}

/** 게임 커서 (게임 화면과 같은 동그라미 + 십자) */
export function cur(x: number, y: number, col = '#fff', k = 1) {
  const a = 11 * k, b = 6 * k, c = 18 * k;
  const lines = `M${x - c} ${y}H${x - b}M${x + b} ${y}H${x + c}M${x} ${y - c}V${y - b}M${x} ${y + b}V${y + c}`;
  return `<g fill="none" stroke-linecap="round"><circle cx="${x}" cy="${y}" r="${a}" stroke="rgba(0,0,0,.5)" stroke-width="${5 * k}"/><path d="${lines}" stroke="rgba(0,0,0,.5)" stroke-width="${5 * k}"/>`
    + `<circle cx="${x}" cy="${y}" r="${a}" stroke="${col}" stroke-width="${2.5 * k}"/><path d="${lines}" stroke="${col}" stroke-width="${2.5 * k}"/></g>`;
}

/** 굵은 글씨 (테두리가 있어 어디서나 읽힘) */
export function label(x: number, y: number, text: string, col = '#f1f2ff', size = 16, anchor: 'middle' | 'start' | 'end' = 'middle') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${col}" class="ga-t" stroke="#10122a" stroke-width="${size / 4}" paint-order="stroke">${text}</text>`;
}

/** 작은 설명 글씨 */
const small = (x: number, y: number, text: string, col = '#9ca2d6', anchor: 'middle' | 'start' | 'end' = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11.5" fill="${col}" class="ga-s">${text}</text>`;

/** 누른 자리의 짧은 빛살 */
const pop = (x: number, y: number, r: number, col = '#fff') => {
  const rays = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = (Math.PI / 4) * i, c = Math.cos(a), s = Math.sin(a);
    return `M${(x + c * r).toFixed(1)} ${(y + s * r).toFixed(1)}L${(x + c * (r + 8)).toFixed(1)} ${(y + s * (r + 8)).toFixed(1)}`;
  }).join('');
  return `<path d="${rays}" stroke="${col}" stroke-width="2.5" stroke-linecap="round" opacity=".9"/>`;
};

/** 판 (게임 판과 같은 색의 둥근 사각형) */
const field = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#171a3a" stroke="#30366b" stroke-width="2"/>`;

const arrow = (x1: number, y1: number, x2: number, y2: number, col = '#9ca2d6') => {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 8;
  const p1 = `${(x2 - Math.cos(a - .5) * h).toFixed(1)},${(y2 - Math.sin(a - .5) * h).toFixed(1)}`;
  const p2 = `${(x2 - Math.cos(a + .5) * h).toFixed(1)},${(y2 - Math.sin(a + .5) * h).toFixed(1)}`;
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/><polygon points="${x2},${y2} ${p1} ${p2}" fill="${col}"/>`;
};

/** 피버·콤보 게이지 */
const gauge = (x: number, y: number, w: number, pct: number, col: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="12" rx="6" fill="#1e2247" stroke="#30366b"/><rect x="${x}" y="${y}" width="${Math.max(12, w * pct)}" height="12" rx="6" fill="${col}"/>`;

/** 점수판 칩: "나" 또는 상대 */
const chip = (x: number, y: number, kind: 0 | 1 | 2 | 3, name: string) =>
  `<rect x="${x - 34}" y="${y - 14}" width="68" height="28" rx="14" fill="#1e2247" stroke="${COLORS[kind].hex}" stroke-width="2"/>${ball(x - 18, y, 8, kind)}${small(x + 8, y + 4, name, '#f1f2ff')}`;

/** 표적 표시: 점수판 칩 둘레의 붉은 점선 테두리와 조준 표시 */
const target = (x: number, y: number) =>
  `<rect x="${x - 42}" y="${y - 21}" width="84" height="42" rx="21" fill="none" stroke="#ff5d73" stroke-width="2.5" stroke-dasharray="6 5"/>`
  + `<g stroke="#ff5d73" stroke-width="2.5" fill="none"><circle cx="${x + 50}" cy="${y - 18}" r="7"/><path d="M${x + 40} ${y - 18}h6M${x + 54} ${y - 18}h6M${x + 50} ${y - 28}v6M${x + 50} ${y - 14}v6"/></g>`;

const svg = (body: string) => `<svg class="ga" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true" font-family="'Black Han Sans','Malgun Gothic',sans-serif">${body}</svg>`;

/** 그림에 쓰는 숫자 (방 규칙에서) */
export interface ArtNums {
  own: number; yellow: number; rainbow: number;
  combo: number; comboBonus: number;
  feverMult: number; feverSec: number;
  steal: number; markSec: number; counter: number; missGauge: number;
  zones: readonly [number, number, number];
  bossKill: number; bossMvp: number; bossSolo: number;
  gold: number; rounds: number;
}

export const ART: Record<string, (n: ArtNums) => string> = {
  controls: () => svg(
    field(18, 14, 160, 152)
    + ball(98, 82, 26, ME) + pop(98, 82, 30) + cur(98, 82)
    + label(98, 150, '클릭 = 잡기', '#f1f2ff', 15)
    + [['Esc', '일시정지', 40], ['P', '일시정지', 82], ['M', '음소거', 124]].map(([k, t, y]) =>
      `<rect x="196" y="${Number(y) - 18}" width="${k === 'Esc' ? 44 : 30}" height="28" rx="7" fill="#1e2247" stroke="#9ca2d6" stroke-width="1.5"/>`
      + `<text x="${k === 'Esc' ? 218 : 211}" y="${Number(y) + 1}" text-anchor="middle" font-size="13" font-weight="800" fill="#f1f2ff" font-family="system-ui">${k}</text>`
      + small(k === 'Esc' ? 250 : 236, Number(y), String(t), '#9ca2d6', 'start')).join(''),
  ),

  goal: () => {
    const rays = [[-1, -.55, 0], [1, -.6, 1], [-.9, .6, 2], [.95, .55, 3], [0, -1, 'y'], [.1, 1, 'y']] as const;
    return svg(
      field(70, 6, 180, 168)
      + `<circle cx="160" cy="90" r="14" fill="#ffd43b" opacity=".25"/><circle cx="160" cy="90" r="6" fill="#ffd43b"/>`
      + rays.map(([dx, dy, k], i) => {
        const x = 160 + dx * 62, y = 90 + dy * 58;
        return `<path d="M${160 + dx * 16} ${90 + dy * 15}L${x - dx * 16} ${y - dy * 15}" stroke="#30366b" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>` + ball(x, y, 13, k as Kind, `g${i}`);
      }).join('')
      + cur(86, 50, '#fff', .8) + cur(232, 120, COLORS[3].hex, .8)
      + label(40, 96, '4명이', '#f1f2ff', 15) + label(282, 96, '동시에', '#f1f2ff', 15),
    );
  },

  points: (n) => svg(
    ball(64, 78, 30, ME) + ball(160, 78, 30, 'y') + ball(256, 78, 30, 'rainbow', 'pt')
    + small(64, 30, '내 색', '#4dabf7') + small(160, 30, '노란 원 (누구나)', YELLOW) + small(256, 30, '무지개 원', '#c39bff')
    + label(64, 148, `+${n.own}`, '#f1f2ff', 30) + label(160, 148, `+${n.yellow}`, '#f1f2ff', 30) + label(256, 148, `+${n.rainbow}`, '#f1f2ff', 30),
  ),

  combo: (n) => {
    const xs = [30, 72, 114, 156, 198];
    return svg(
      `<path d="M${xs.map((x, i) => `${x} ${108 - i * 10}`).join('L')}" stroke="#ffd43b" stroke-width="3" stroke-dasharray="3 6" stroke-linecap="round" fill="none"/>`
      + xs.map((x, i) => ball(x, 108 - i * 10, 15, ME) + small(x, 140 - i * 10, String(i + 1), '#ffd43b')).join('')
      + cur(198, 68) + pop(198, 68, 20, '#ffd43b')
      + `<rect x="226" y="28" width="82" height="70" rx="14" fill="#2a2208" stroke="#ffd43b" stroke-width="2"/>`
      + label(267, 56, `${n.combo}콤보`, '#ffd43b', 18) + label(267, 86, `+${n.comboBonus}`, '#f1f2ff', 24)
      + small(160, 172, '쉬지 않고 잡으면 콤보가 올라요', '#9ca2d6'),
    );
  },

  fever: (n) => svg(
    `<defs><linearGradient id="fv" x1="0" x2="1"><stop offset="0" stop-color="#ffd43b"/><stop offset="1" stop-color="#ff9f1c"/></linearGradient></defs>`
    + `<path d="M160 18c18 22 34 34 34 58a34 34 0 0 1-68 0c0-14 8-22 14-30 2 10 8 14 12 14 0-14 4-28 8-42z" fill="#ff9f1c"/>`
    + `<path d="M160 58c8 10 14 16 14 26a14 14 0 0 1-28 0c0-8 6-14 14-26z" fill="#ffd43b"/>`
    + label(160, 140, `${n.feverSec}초 동안 점수 ×${n.feverMult}`, '#ff9f1c', 22)
    + `<rect x="60" y="152" width="200" height="12" rx="6" fill="#1e2247" stroke="#30366b"/><rect x="60" y="152" width="200" height="12" rx="6" fill="url(#fv)"/>`
    + small(52, 162, '게이지', '#9ca2d6', 'end') + small(268, 162, '가득!', '#ff9f1c', 'start')
    + ball(58, 70, 13, ME) + ball(262, 64, 13, 'y'),
  ),

  steal: (n) => svg(
    ball(70, 78, 28, RIVAL) + cur(70, 78) + pop(70, 78, 32, COLORS[RIVAL].hex)
    + small(70, 30, '남의 색 원', COLORS[RIVAL].hex) + label(70, 140, `+${n.steal}`, '#f1f2ff', 26)
    + arrow(118, 78, 160, 78)
    + chip(230, 42, RIVAL, '상대') + small(230, 72, '상대 콤보 끊김', '#ff5d73')
    + chip(230, 110, ME, '나') + target(230, 110)
    + small(230, 146, `내 콤보도 끊기고 ${n.markSec}초 동안 표적`, '#ff5d73'),
  ),

  counter: (n) => svg(
    chip(70, 60, RIVAL, '상대') + target(70, 60) + small(70, 96, '견제한 사람 = 표적', '#ff5d73')
    + arrow(122, 78, 168, 78)
    + ball(236, 78, 28, RIVAL) + cur(236, 78) + pop(236, 78, 32, '#ffd43b')
    + small(236, 30, '표적의 색 원', COLORS[RIVAL].hex) + label(236, 140, `+${n.counter}`, '#ffd43b', 28) + small(236, 160, '반격!', '#ffd43b'),
  ),

  miss: (n) => svg(
    field(40, 14, 130, 152)
    + cur(105, 80, '#8a8fb8') + `<path d="M93 68l24 24M117 68l-24 24" stroke="#ff5d73" stroke-width="4" stroke-linecap="round"/>`
    + small(105, 130, '빈 곳 클릭', '#9ca2d6')
    + label(188, 58, '콤보 끊김', '#ff5d73', 18, 'start')
    + gauge(188, 84, 100, .35, '#ff9f1c') + small(188, 116, `피버 게이지 −${n.missGauge}`, '#ff5d73', 'start'),
  ),

  zones: (n) => {
    const cx = 110, cy = 90, R = 80;
    return svg(
      `<defs><clipPath id="zf"><rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" rx="12"/></clipPath></defs>`
      + `<g clip-path="url(#zf)"><rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" fill="#2a2208"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${R * .7 * 1.1}" fill="#1f2350"/><circle cx="${cx}" cy="${cy}" r="${R * .35 * 1.1}" fill="#171a3a"/></g>`
      + `<rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" rx="12" fill="none" stroke="#30366b" stroke-width="2"/>`
      + label(cx, cy + 6, `×${n.zones[0]}`, '#9ca2d6', 16) + label(cx, cy - R * .53, `×${n.zones[1]}`, '#c3c8f0', 16) + label(cx - R + 16, cy - R + 22, `×${n.zones[2]}`, '#ffd43b', 16)
      + small(214, 60, '가운데', '#9ca2d6', 'start') + small(214, 90, '사이', '#c3c8f0', 'start') + small(214, 120, '가장자리', '#ffd43b', 'start')
      + label(290, 60, `×${n.zones[0]}`, '#9ca2d6', 16) + label(290, 90, `×${n.zones[1]}`, '#c3c8f0', 16) + label(290, 120, `×${n.zones[2]}`, '#ffd43b', 16),
    );
  },

  boss: (n) => {
    const x = 120, y = 92, r = 54;
    const arc = (p: number) => { const a = -Math.PI / 2 + p * Math.PI * 2; return `${(x + Math.cos(a) * (r + 9)).toFixed(1)} ${(y + Math.sin(a) * (r + 9)).toFixed(1)}`; };
    return svg(
      `<circle cx="${x}" cy="${y}" r="${r + 9}" fill="none" stroke="#30366b" stroke-width="6"/>`
      + `<path d="M${arc(0)}A${r + 9} ${r + 9} 0 0 1 ${arc(.3)}" fill="none" stroke="#ff5d73" stroke-width="6" stroke-linecap="round"/>`
      + `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffc23a" stroke="#fff" stroke-width="2"/>`
      + `<path d="M${x - 24} ${y + 14}V${y - 12}L${x - 12} ${y + 2}L${x} ${y - 20}L${x + 12} ${y + 2}L${x + 24} ${y - 12}V${y + 14}Z" fill="#502d00" fill-opacity=".6"/>`
      + cur(x - 30, y + 28) + cur(x + 34, y - 26, COLORS[0].hex, .8) + cur(x + 30, y + 34, COLORS[2].hex, .8)
      + label(214, 54, `막타 +${n.bossKill}`, '#ffd43b', 18, 'start')
      + label(214, 92, `MVP +${n.bossMvp}`, '#f1f2ff', 18, 'start')
      + label(214, 130, `독식 +${n.bossSolo}`, '#ff9f1c', 18, 'start'),
    );
  },

  bossTypes: () => svg(
    `<circle cx="60" cy="78" r="30" fill="#ffc23a"/><polygon points="60,36 96,57 96,99 60,120 24,99 24,57" fill="none" stroke="#7fd3ff" stroke-width="4"/>`
    + `<circle cx="160" cy="78" r="38" fill="#ff5d73" opacity=".25"/><circle cx="160" cy="78" r="30" fill="#e0314e" stroke="#ff5d73" stroke-width="3"/>`
    + `<circle cx="260" cy="78" r="44" fill="#b26cff" opacity=".18"/><circle cx="260" cy="78" r="44" fill="none" stroke="#b26cff" stroke-width="2.5" stroke-dasharray="7 7"/><circle cx="260" cy="78" r="26" fill="#ffc23a"/>`
    + label(60, 148, '방어형', '#7fd3ff', 16) + small(60, 166, '보호막이면') + small(60, 179, '막혀요')
    + label(160, 148, '공격형', '#ff5d73', 16) + small(160, 166, '붉을 때 때리면') + small(160, 179, '감점')
    + label(260, 148, '이동형', '#c39bff', 16) + small(260, 166, '고리 안에서') + small(260, 179, '커서가 끌려가요'),
  ),

  gold: (n) => svg(
    field(20, 14, 180, 152)
    + `<path d="M40 140L96 24L150 120L196 60" fill="none" stroke="#ffc23a" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" opacity=".8"/>`
    + ball(190, 68, 17, 'gold') + cur(190, 68, '#fff', .75) + pop(190, 68, 22, '#ffc23a')
    + label(262, 82, `+${n.gold}`, '#ffc23a', 34) + small(262, 108, '빠르고 작아요', '#9ca2d6') + small(262, 124, '직접 눌러야 잡혀요', '#9ca2d6'),
  ),

  items: () => svg(
    ball(56, 90, 30, 'item') + cur(74, 108, '#fff', .8) + arrow(100, 90, 142, 90)
    + [['넓은 손', 34], ['자석', 72], ['점수 2배', 110], ['시간 정지', 148]].map(([t, y]) =>
      `<rect x="156" y="${Number(y) - 16}" width="148" height="28" rx="14" fill="#1e2247" stroke="#7fd3ff" stroke-width="1.5"/>${small(230, Number(y) + 3, String(t), '#f1f2ff')}`).join(''),
  ),

  laser: () => svg(
    field(14, 14, 292, 152)
    + `<rect x="14" y="40" width="292" height="26" fill="#ff5d73" opacity=".18"/><path d="M14 40H306M14 66H306" stroke="#ff5d73" stroke-width="2" stroke-dasharray="8 6"/>`
    + small(160, 32, '① 경고 띠', '#ff5d73')
    + `<rect x="14" y="114" width="292" height="14" fill="#ff5d73"/><rect x="14" y="118" width="292" height="6" fill="#fff" opacity=".8"/>`
    + small(160, 104, '② 레이저', '#ff5d73')
    + cur(200, 121, '#8a8fb8') + `<circle cx="188" cy="94" r="3.5" fill="#ffd43b"/><circle cx="200" cy="92" r="3.5" fill="#ffd43b"/><circle cx="212" cy="94" r="3.5" fill="#ffd43b"/>`
    + small(160, 156, '닿으면 잠깐 클릭 못 해요', '#f1f2ff'),
  ),

  patterns: () => {
    const tile = (x: number, name: string, art: string) => `<rect x="${x}" y="22" width="68" height="100" rx="10" fill="#171a3a" stroke="#30366b" stroke-width="2"/>${art}${small(x + 34, 146, name, '#f1f2ff')}`;
    return svg(
      tile(10, '벽', '<rect x="20" y="64" width="48" height="14" rx="3" fill="#8a8fb8"/><rect x="40" y="36" width="12" height="28" rx="3" fill="#8a8fb8"/>')
      + tile(88, '가시 공', '<circle cx="122" cy="72" r="14" fill="#ff5d73"/><path d="M122 50v-6M122 94v6M100 72h-6M144 72h6M106 56l-5-5M138 88l5 5M138 56l5-5M106 88l-5 5" stroke="#ff5d73" stroke-width="4" stroke-linecap="round"/>')
      + tile(166, '소용돌이', '<path d="M200 72m-4 0a4 4 0 1 1 8 0a9 9 0 1 1 -18 0a14 14 0 1 1 28 0a19 19 0 1 1 -38 0" fill="none" stroke="#b26cff" stroke-width="3" stroke-linecap="round"/>')
      + tile(244, '빙판', '<rect x="252" y="40" width="52" height="64" rx="6" fill="#7fd3ff" opacity=".25"/><path d="M262 92l30-38" stroke="#dff6ff" stroke-width="3" stroke-linecap="round"/><path d="M270 60l6 6M284 78l6 6" stroke="#dff6ff" stroke-width="2"/>')
      + small(160, 172, '경고가 뜬 뒤 잠깐 나타나요', '#9ca2d6'),
    );
  },

  growth: () => svg(
    // 쌓이는 칸
    `<rect x="18" y="34" width="132" height="44" rx="12" fill="#1e2247" stroke="#51cf66" stroke-width="2"/>`
    + label(84, 62, '단련 3/5', '#51cf66', 18)
    + [0, 1, 2, 3, 4].map((i) => `<rect x="${30 + i * 22}" y="90" width="16" height="16" rx="4" fill="${i < 3 ? '#51cf66' : '#30366b'}"/>`).join('')
    + small(84, 128, '조건마다 한 칸씩', '#9ca2d6')
    // 진화: 같은 카드 3장
    + [0, 1, 2].map((i) => `<rect x="${182 + i * 14}" y="${30 + i * 8}" width="54" height="74" rx="9" fill="#1e2247" stroke="#b26cff" stroke-width="2.5"/>`).join('')
    + label(237, 132, '3장 = 진화', '#d4bcff', 16)
    + small(160, 168, '같은 분류를 모으면 시너지', '#ffd43b'),
  ),

  team: () => svg(
    `<rect x="14" y="26" width="132" height="110" rx="14" fill="#2a1420" stroke="#ff8fa0" stroke-width="2"/><rect x="174" y="26" width="132" height="110" rx="14" fill="#10223a" stroke="#7fc8ff" stroke-width="2"/>`
    + label(80, 52, '팀 A', '#ff8fa0', 16) + label(240, 52, '팀 B', '#7fc8ff', 16)
    + ball(54, 92, 20, 0) + ball(106, 92, 20, 2) + ball(214, 92, 20, 1) + ball(266, 92, 20, 3)
    + small(160, 160, '같은 팀 색 = 내 색 · 점수 합으로 승부', '#f1f2ff'),
  ),

  survival: () => svg(
    [0, 1, 2, 3].map((i) => {
      const x = 44 + i * 78, out = i === 3;
      return `<rect x="${x - 30}" y="40" width="60" height="70" rx="12" fill="#1e2247" stroke="${out ? '#ff5d73' : '#30366b'}" stroke-width="2" ${out ? 'opacity=".55"' : ''}/>`
        + ball(x, 66, 15, i as 0) + small(x, 98, out ? '탈락' : '생존', out ? '#ff5d73' : '#9ca2d6')
        + (out ? `<path d="M${x - 22} 48l44 54M${x + 22} 48l-44 54" stroke="#ff5d73" stroke-width="3" stroke-linecap="round"/>` : '');
    }).join('')
    + label(160, 150, '30초마다 꼴찌 탈락', '#ff5d73', 18),
  ),

  coop: () => svg(
    `<circle cx="160" cy="54" r="34" fill="#9b5de5" stroke="#f3e0ff" stroke-width="3"/><rect x="70" y="10" width="180" height="8" rx="4" fill="#2b1838"/><rect x="70" y="10" width="110" height="8" rx="4" fill="#c77dff"/>`
    + [0, 1, 2, 3].map((i) => ball(52 + i * 72, 118, 13, i as 0)).join('')
    + [0, 1, 2].map((i) => `<path d="M${132 + i * 28} 92l6 10 6-10" fill="none" stroke="#ff5d73" stroke-width="3" stroke-linecap="round"/>`).join('')
    + small(160, 150, '다 같이 보스를 잡아요 · 사람마다 생명 3개', '#f1f2ff'),
  ),

  arcade: (n) => {
    const card = (x: number, col: string, name: string, prism = false) =>
      `<rect x="${x}" y="30" width="62" height="88" rx="10" fill="#1e2247" stroke="${prism ? 'url(#pr)' : col}" stroke-width="3"/>`
      + `<circle cx="${x + 31}" cy="64" r="14" fill="none" stroke="${prism ? 'url(#pr)' : col}" stroke-width="3"/>${small(x + 31, 104, name, prism ? '#ffd43b' : col)}`;
    return svg(
      `<defs><linearGradient id="pr" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ff5d73"/><stop offset=".35" stop-color="#ffd43b"/><stop offset=".65" stop-color="#51cf66"/><stop offset="1" stop-color="#b26cff"/></linearGradient></defs>`
      + card(22, '#ffffff', '노말') + card(94, '#4d9bff', '레어') + card(166, '#b26cff', '에픽') + card(238, '', '레전드', true)
      + label(160, 152, `${n.rounds}라운드 · 라운드마다 증강 고르기`, '#f1f2ff', 16),
    );
  },
};
