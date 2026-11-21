/**
 * 점수표: 행 데이터(scoreSheet)와 화면(scoreSheetHTML).
 * 대기실 점수표 창과 도감 '점수표' 탭이 같은 함수를 쓴다. 숫자는 모두 RULES와 방 규칙(RoomRules)에서 온다.
 */
import { BOMB_DESC, ICE_DESC, RULES, SPLIT_DESC, type RoomRules } from '@color-burst/shared';
import { shapeSVG, specialSVG } from './render.ts';

/** 견본: 도형 색(`own` 내 색, `y` 노랑, `rainbow`, `boss`) 또는 특수 원 */
export type ScoreSwatch = 'own' | 'y' | 'rainbow' | 'boss' | 'other' | 'marked' | 'bomb' | 'ice' | 'split' | 'item' | 'empty';

export interface ScoreRow {
  id: string;
  swatch: ScoreSwatch;
  label: string;
  /** 점수 두 칸: 평상시, 피버 중. 없으면 설명만 있는 행 */
  calm?: string;
  fever?: string;
  /** 보스처럼 점수가 여럿이면 칩으로 */
  chips?: string[];
  /** 부연 문장 */
  note?: string;
}
export interface ScoreSection { label: string; rows: ScoreRow[] }
export interface ScoreSheet {
  /** 점수 열 제목 */
  calmHead: string;
  feverHead: string;
  sections: ScoreSection[];
}

const plus = (n: number) => `+${n}`;

/** 방 규칙 기준 점수표 행 (규칙으로 꺼진 요소의 행은 없다, 협력전은 특수 원 없음) */
export function scoreSheet(r: RoomRules): ScoreSheet {
  const m = r.feverMult, P = RULES.points;
  const circles: ScoreRow[] = [
    { id: 'own', swatch: 'own', label: '내 색', calm: plus(P.own), fever: plus(P.own * m) },
    { id: 'yellow', swatch: 'y', label: '노란색', calm: plus(P.yellow), fever: plus(P.own * m), note: '피버 중에는 내 색으로 쳐요' },
  ];
  if (r.rainbowPct) circles.push({ id: 'rainbow', swatch: 'rainbow', label: '무지개', calm: plus(P.rainbow), fever: plus(P.rainbow * m) });
  const steal: ScoreRow[] = [
    { id: 'steal', swatch: 'other', label: '남의 색 (견제)', calm: plus(P.stealCalm), fever: plus(P.stealCalm * m),
      note: r.stealPenalty ? `내 콤보가 끊겨요${r.markSec ? `, ${r.markSec}초 동안 표적이 돼요` : ''}` : '페널티 없음' },
  ];
  if (r.stealPenalty && r.markSec) steal.push({ id: 'counter', swatch: 'marked', label: '표적의 색 (반격)', calm: plus(P.counter), fever: plus(P.counter * m) });
  const sections: ScoreSection[] = [{ label: '원', rows: circles }, { label: '견제', rows: steal }];
  const special: ScoreRow[] = [];
  if (r.boss) {
    special.push({ id: 'boss', swatch: 'boss', label: '보스 원', fever: `×${m}`,
      chips: [`때릴 때 +${RULES.boss.hit}`, `막타 +${RULES.boss.kill}`, `가장 많이 때림 +${RULES.boss.mvp}`, `독식 +${RULES.boss.solo.points}`],
      note: `독식은 체력 ${RULES.boss.solo.pct}% 이상을 깎으면 받고, 막타까지 치면 막타 ×${RULES.boss.solo.killMult}. 콤보·피버 게이지도 차요` });
  }
  if (r.items) special.push({ id: 'item', swatch: 'item', label: '아이템 원', note: '잡으면 무작위 아이템이 바로 발동해요 (점수 없음)' });
  if (r.specialCircles && !r.coop) {
    special.push(
      { id: 'bomb', swatch: 'bomb', label: '폭탄 원', note: BOMB_DESC },
      { id: 'ice', swatch: 'ice', label: '얼음 원', note: ICE_DESC },
      { id: 'split', swatch: 'split', label: '분열 원', note: SPLIT_DESC },
    );
  }
  if (special.length) sections.push({ label: '특별한 원', rows: special });
  sections.push({ label: '감점', rows: [{ id: 'miss', swatch: 'empty', label: '빈 공간', calm: r.missPenalty ? '콤보 끊김, 피버 감소' : '페널티 없음', fever: r.missPenalty ? '콤보 끊김' : '페널티 없음' }] });
  return { calmHead: '평상시', feverHead: `피버 중 (×${m}, ${r.feverSec}초)`, sections };
}

/** 숫자(+3, ×3)로 시작하면 큰 숫자 글꼴, 아니면 문장(작은 글꼴) */
const numLike = (s: string) => /^[+×]/.test(s);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function swatchHTML(s: ScoreSwatch): string {
  switch (s) {
    case 'own': return shapeSVG(0, 28);
    case 'y': return shapeSVG('y', 28);
    case 'rainbow': return shapeSVG('rainbow', 28);
    case 'boss': return shapeSVG('boss', 28);
    case 'other': return shapeSVG(1, 28);
    case 'marked': return `<span class="ss-marked">${shapeSVG(2, 28)}</span>`;
    case 'bomb': case 'ice': case 'split': return specialSVG(s, 28);
    case 'item': return `<span class="ss-q" aria-hidden="true">?</span>`;
    default: return `<span class="ss-empty" aria-hidden="true"></span>`;
  }
}

/** 점수 카드 행 목록 HTML */
export function scoreSheetHTML(r: RoomRules): string {
  const sheet = scoreSheet(r);
  return `<div class="ss" role="table" aria-label="점수표">
    <div class="ss-head" role="row"><span></span><span role="columnheader">${esc(sheet.calmHead)}</span><span role="columnheader">${esc(sheet.feverHead)}</span></div>
    ${sheet.sections.map((sec) => `<section class="ss-sec"><h4>${esc(sec.label)}</h4>${sec.rows.map((row) => `
      <div class="ss-row" role="row" data-row="${row.id}">
        <span class="ss-who" role="rowheader">${swatchHTML(row.swatch)}<b>${esc(row.label)}</b></span>
        ${row.calm !== undefined ? `<span class="ss-num${numLike(row.calm) ? '' : ' txt'}" role="cell">${esc(row.calm)}</span>` : ''}
        ${row.fever !== undefined ? `<span class="ss-num fever${numLike(row.fever) ? '' : ' txt'}" role="cell">${esc(row.fever)}</span>` : ''}
        ${row.chips ? `<span class="ss-chips">${row.chips.map((c) => `<em>${esc(c)}</em>`).join('')}</span>` : ''}
        ${row.note ? `<small class="ss-note">${esc(row.note)}</small>` : ''}
      </div>`).join('')}</section>`).join('')}
  </div>`;
}
