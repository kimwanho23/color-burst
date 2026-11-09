import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RULES } from '../src/index.ts';
import { guideBody, guideSlides } from '../../client/src/guide.ts';

const R = { ...DEFAULT_RULES, mode: 'arcade' as const };

test('게임 방법 기본 탭: 점수·콤보·피버·견제·반격·페널티·점수 구역 숫자가 규칙을 따름', () => {
  const h = guideBody('basic', R);
  for (const s of ['내 색 원 +3', '노란 원 +2', '무지개 원 +5', '10콤보마다 콤보 보너스 +5', '7초 동안 점수 ×3', '4초 동안 표적', '+6', '중앙 ×1 / 사이 ×2 / 가장자리 ×3']) assert.ok(h.includes(s), s);
  const h2 = guideBody('basic', { ...R, feverMult: 5, feverSec: 10, markSec: 6 });
  for (const s of ['10초 동안 점수 ×5', '6초 동안 표적']) assert.ok(h2.includes(s), s);
  assert.ok(!h.includes('이 방에선 꺼져 있어요'));
});

test('게임 방법 심화 탭: 보스(막타·최다 타격·독식), 아케이드 항목', () => {
  const h = guideBody('more', R);
  for (const s of [`막타 +${RULES.boss.kill}`, `+${RULES.boss.mvp}`, `독식 +${RULES.boss.solo.points}`, `${RULES.boss.solo.pct}%`, '5라운드']) assert.ok(h.includes(s), s);
});

test('꺼진 요소는 "이 방에선 꺼져 있어요" (보스·레이저·아이템·빈 곳 페널티·견제 페널티)', () => {
  const off = (h: string) => (h.match(/이 방에선 꺼져 있어요/g) ?? []).length;
  assert.equal(off(guideBody('basic', { ...R, missPenalty: false })), 1);
  assert.equal(off(guideBody('basic', { ...R, stealPenalty: false })), 2); // 견제·반격
  assert.equal(off(guideBody('more', { ...R, boss: false, laser: false, items: false })), 4); // 보스 2 + 레이저 + 아이템
  assert.equal(off(guideBody('more', { ...R, mode: 'classic' })), 1); // 아케이드
});

test('방 밖(처음 화면)에서는 꺼짐 표시 없음', () => {
  const h = guideBody('more', { ...R, mode: 'classic', boss: false }, false);
  assert.ok(!h.includes('이 방에선 꺼져 있어요'));
});

test('게임 방법 슬라이드: 한 장에 규칙 하나, 모두 그림(SVG)이 있고 id가 겹치지 않음', () => {
  const all = [...guideSlides('basic', R), ...guideSlides('more', R)];
  assert.equal(guideSlides('basic', R).length, 9);
  assert.equal(guideSlides('more', R).length, 7);
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  for (const s of all) {
    assert.ok(s.art.startsWith('<svg') && s.art.endsWith('</svg>'), s.id);
    assert.ok(!s.art.includes('undefined') && !s.art.includes('NaN'), s.id);
  }
  // 그림 속 숫자도 방 규칙을 따른다
  const fever = guideSlides('basic', { ...R, feverMult: 5, feverSec: 10 }).find((s) => s.id === 'fever')!;
  assert.ok(fever.art.includes('10초 동안 점수 ×5'));
});
