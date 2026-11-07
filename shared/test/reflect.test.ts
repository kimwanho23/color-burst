import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, modsOf, newPlayer, resolveClaim, startRound, toGameRules, type PlayerState } from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
/** a가 견제하는 사람, b가 반사 능력을 가진 색 1의 주인 */
const setup = (tier: 0 | 1 | 2 | 3 = 0): [PlayerState, PlayerState] => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  b.picks = [{ id: 'reflect', tier }];
  startRound(a, 0, G); startRound(b, 0, G);
  return [a, b];
};

test('견제 반사: 라운드당 1 / 2 / 3 / 6번', () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => modsOf([{ id: 'reflect', tier: t as 0 }]).reflect), [1, 2, 3, 6]);
  const [, b] = setup(1);
  assert.equal(b.reflectLeft, 2);
});

test('반사되면 그 원은 주인이 잡은 것으로, 견제한 사람은 0점·콤보 끊김·표적', () => {
  const [a, b] = setup();
  a.combo = 6; b.combo = 2;
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.equal(r.gained, 0);
  assert.equal(r.reflectedTo, 'b');
  assert.equal(r.reflected?.gained, 3);
  assert.equal(r.marked, true);
  assert.deepEqual([a.score, a.combo, b.score, b.combo, b.reflectLeft], [0, 0, 3, 3, 0]);
  assert.ok(a.markedUntil > 100);
});

test('반사 횟수를 다 쓰면 평소 견제', () => {
  const [a, b] = setup();
  resolveClaim(a, 1, [a, b], 100, G);
  const r = resolveClaim(a, 1, [a, b], 200, G);
  assert.equal(r.reflectedTo, undefined);
  assert.equal(r.gained, 1);
});

test('반격(주인이 표적일 때)과 폭죽·필드 클리어는 반사되지 않는다', () => {
  const [a, b] = setup();
  b.markedUntil = 10_000;
  assert.equal(resolveClaim(a, 1, [a, b], 100, G).type, 'counter');
  assert.equal(b.reflectLeft, 1);
  b.markedUntil = 0;
  assert.equal(resolveClaim(a, 1, [a, b], 200, G, { via: 'blast' }).reflectedTo, undefined);
  assert.equal(b.reflectLeft, 1);
});

test('라운드가 바뀌면 반사 횟수가 다시 찬다', () => {
  const [a, b] = setup();
  resolveClaim(a, 1, [a, b], 100, G);
  startRound(b, 1000, G);
  assert.equal(b.reflectLeft, 1);
});
