import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, PRESETS, RULES, BOMB_DESC } from '../src/index.ts';
import { scoreSheet } from '../../client/src/scoreSheet.ts';

const rows = (r: Parameters<typeof scoreSheet>[0]) => Object.fromEntries(scoreSheet(r).sections.flatMap((s) => s.rows).map((x) => [x.id, x]));
const P = RULES.points;

test('점수표: 기본 규칙의 숫자는 이전 표와 같다', () => {
  const r = rows(DEFAULT_RULES), m = DEFAULT_RULES.feverMult;
  assert.deepEqual([r.own.calm, r.own.fever], [`+${P.own}`, `+${P.own * m}`]);
  assert.deepEqual([r.yellow.calm, r.yellow.fever], [`+${P.yellow}`, `+${P.own * m}`]);
  assert.deepEqual([r.steal.calm, r.steal.fever], [`+${P.stealCalm}`, `+${P.stealCalm * m}`]);
  assert.ok(r.steal.note!.includes(`${DEFAULT_RULES.markSec}초`));
  assert.deepEqual([r.counter.calm, r.counter.fever], [`+${P.counter}`, `+${P.counter * m}`]);
  assert.deepEqual([r.rainbow.calm, r.rainbow.fever], [`+${P.rainbow}`, `+${P.rainbow * m}`]);
  assert.equal(r.boss.fever, `×${m}`);
  assert.deepEqual(r.boss.chips, [`때릴 때 +${RULES.boss.hit}`, `막타 +${RULES.boss.kill}`, `가장 많이 때림 +${RULES.boss.mvp}`, `독식 +${RULES.boss.solo.points}`]);
  assert.equal(r.bomb.note, BOMB_DESC);
  assert.equal(scoreSheet(DEFAULT_RULES).feverHead, `피버 중 (×${m}, ${DEFAULT_RULES.feverSec}초)`);
});

test('점수표: 규칙으로 꺼진 요소의 줄은 없다 (무지개·보스·아이템·특수 원·반격)', () => {
  const r = rows({ ...DEFAULT_RULES, rainbowPct: 0, boss: false, items: false, specialCircles: false, markSec: 0 });
  for (const id of ['rainbow', 'boss', 'item', 'bomb', 'ice', 'split', 'counter']) assert.equal(r[id], undefined, id);
  assert.equal(rows({ ...DEFAULT_RULES, stealPenalty: false }).counter, undefined, '견제 페널티가 없으면 반격 줄도 없음');
  assert.ok(rows({ ...DEFAULT_RULES, stealPenalty: false }).steal.note!.includes('페널티 없음'));
});

test('점수표: 협력전은 특수 원 줄이 없고, 빈 공간 줄은 규칙을 따른다', () => {
  assert.equal(rows({ ...DEFAULT_RULES, coop: true }).bomb, undefined);
  assert.equal(rows({ ...DEFAULT_RULES, missPenalty: false }).miss.calm, '페널티 없음');
  assert.equal(rows(DEFAULT_RULES).miss.calm, '콤보 끊김, 피버 감소');
});

test('점수표: 프리셋마다 피버 배율이 곱해진 숫자를 낸다', () => {
  for (const p of Object.values(PRESETS)) {
    const r = { ...DEFAULT_RULES, ...p.rules }, own = rows(r).own;
    assert.equal(own.fever, `+${P.own * r.feverMult}`);
  }
});
