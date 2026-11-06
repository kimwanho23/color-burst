import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, addBuff, buffOn, itemMult, newPlayer, resolveClaim, resolveMiss, shiftTimes, toGameRules,
  type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const two = (): [PlayerState, PlayerState] => [newPlayer('a', 'A', 0), newPlayer('b', 'B', 1)];

test('addBuff: 남은 시간에 더하되 원래 시간의 2배까지', () => {
  const [p] = two();
  addBuff(p, 'double', 5000, 0);
  assert.equal(p.buffs.double, 5000);
  addBuff(p, 'double', 5000, 1000);
  assert.equal(p.buffs.double, 10000);
  addBuff(p, 'double', 5000, 2000);
  assert.equal(p.buffs.double, 12000);
  assert.equal(buffOn(p, 'double', 11999), true);
  assert.equal(buffOn(p, 'double', 12000), false);
});

test('shiftTimes: since 이후에 끝나는 시각만 민다', () => {
  const [p] = two();
  p.buffs.double = 10000; p.markedUntil = 400; p.feverUntil = 900;
  shiftTimes(p, 500, 3000);
  assert.equal(p.buffs.double, 13000);
  assert.equal(p.markedUntil, 400);
  assert.equal(p.feverUntil, 3900);
});

test('comboLock: 견제당해도 콤보 유지', () => {
  const [a, b] = two();
  b.combo = 5;
  addBuff(b, 'comboLock', 5000, 0);
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.equal(b.combo, 5);
  assert.equal(r.brokeComboOf, null);
});

test('missGuard: 빈 곳 페널티 없음, 침착 횟수 유지', () => {
  const [p] = two();
  p.combo = 4; p.fever = 50; p.calmLeft = 2;
  addBuff(p, 'missGuard', 8000, 0);
  resolveMiss(p, 100, G, [p]);
  assert.deepEqual([p.combo, p.fever, p.calmLeft], [4, 50, 2]);
});

test('missGuard: 유리 대포 −5는 그대로', () => {
  const [p] = two();
  p.score = 20; p.picks = [{ id: 'glassCannon', tier: 0 }];
  addBuff(p, 'missGuard', 8000, 0);
  resolveMiss(p, 100, G, [p]);
  assert.equal(p.score, 15);
});

test('paint: 노란 원을 내 색 점수로, 외길이면 0점', () => {
  const [a, b] = two();
  addBuff(a, 'paint', 5000, 0);
  assert.equal(resolveClaim(a, 'y', [a, b], 100, G).gained, 3);
  a.picks = [{ id: 'oneWay', tier: 0 }];
  assert.equal(resolveClaim(a, 'y', [a, b], 100, G).gained, 0);
});

test('점수 2배와 황금 손은 겹치지 않음', () => {
  const [a, b] = two();
  addBuff(a, 'double', 5000, 0);
  assert.equal(resolveClaim(a, 0, [a, b], 100, G).gained, 6);
  const [c, d] = two();
  c.goldLeft = 2;
  assert.equal(resolveClaim(c, 0, [c, d], 100, G).gained, 6);
  assert.equal(c.goldLeft, 1);
  addBuff(c, 'double', 5000, 0);
  assert.equal(resolveClaim(c, 0, [c, d], 100, G).gained, 6);
  assert.equal(c.goldLeft, 1);
  assert.equal(itemMult(c, 100, false), 2);
});

test('황금 손: 0점 원(외길의 노란색)에는 소모되지 않는다', () => {
  const [a, b] = two();
  a.goldLeft = 3; a.picks = [{ id: 'oneWay', tier: 0 }];
  assert.equal(resolveClaim(a, 'y', [a, b], 100, G).gained, 0);
  assert.equal(a.goldLeft, 3);
});

test('황금 손: 폭죽·필드 클리어로 잡은 원에는 소모되지 않는다', () => {
  const [a, b] = two();
  a.goldLeft = 3;
  assert.equal(resolveClaim(a, 0, [a, b], 100, G, { via: 'blast' }).gained, 3);
  assert.equal(a.goldLeft, 3);
});

test('guard: 견제당해도 콤보·강탈 없음', () => {
  const [a, b] = two();
  a.picks = [{ id: 'plunder', tier: 3 }];
  b.combo = 3; b.score = 30;
  addBuff(b, 'guard', 5000, 0);
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.equal(r.brokeComboOf, null);
  assert.equal(r.shielded, true);
  assert.equal(r.plundered, 0);
  assert.equal(b.combo, 3);
});
