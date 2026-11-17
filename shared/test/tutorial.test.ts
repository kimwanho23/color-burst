import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEATS, enterStep, freeDone, freeKinds } from '../../server/src/tutorial.ts';
import { RULES, newPlayer } from '../src/index.ts';

test('단계 순서와 장면 목록', () => {
  assert.deepEqual(RULES.tutorial.steps, ['own', 'combo', 'steal', 'fever', 'zones']);
  assert.deepEqual(BEATS.own.map((b) => b.kind), ['focus', 'card', 'focus', 'card']);
  assert.deepEqual(BEATS.combo.map((b) => b.id), ['combo.intro', 'combo.ten', 'combo.tenCard', 'combo.empty', 'combo.emptyCard']);
  assert.equal((BEATS.combo[3] as { accept: string }).accept, 'empty');
  assert.ok(BEATS.steal.some((b) => b.kind === 'botSteal'));
  const go = BEATS.fever.find((b) => b.id === 'fever.go') as { prep?: { fever?: number } };
  assert.equal(go.prep?.fever, 99);
  const ids = Object.values(BEATS).flat().map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, '장면 id는 겹치지 않음');
});

test('단계 시작: 콤보 단계는 콤보 9, 그 밖은 0, 피버는 꺼짐', () => {
  const me = newPlayer('a', 'A', 0);
  me.combo = 3; me.fever = 50; me.feverUntil = Date.now() + 5000;
  enterStep('combo', me);
  assert.deepEqual([me.combo, me.fever, me.feverUntil], [9, 0, 0]);
  enterStep('steal', me);
  assert.equal(me.combo, 0);
});

test('자유 연습 끝 판정', () => {
  const me = newPlayer('a', 'A', 0), now = 10_000;
  me.markedUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), false);
  me.markedUntil = now;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), true);
  me.feverUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'feverEnd' }, me, now, 0), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 2), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 3), true);
});

test('자유 연습 원 종류', () => {
  const me = newPlayer('a', 'A', 0), bot = newPlayer('b', 'B', 2, true);
  assert.deepEqual(freeKinds('steal', me, bot), [0]);
  assert.deepEqual(freeKinds('fever', me, bot), [0, 'y', 2]);
  assert.deepEqual(freeKinds('zones', me, null), [0]);
});
