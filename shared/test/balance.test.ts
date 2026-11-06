import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, DEFAULT_RULES, makeCircle, modsOf, newPlayer, resolveClaim, toGameRules } from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);

test('반격 +6, 견제 +1 유지', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  b.markedUntil = 10_000;
  assert.equal(resolveClaim(a, 1, [a, b], 100, G).gained, 6);
  b.markedUntil = 0;
  assert.equal(resolveClaim(a, 1, [a, b], 200, G).gained, 1);
});

test('강탈 능력 1 / 1 / 2 / 3', () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => modsOf([{ id: 'plunder', tier: t as 0 }]).plunder), [1, 1, 2, 3]);
});

test('증강 선택 시간 30초', () => {
  assert.equal(ARCADE.pickSec, 30);
});

test('원의 기본 발사 속도 +15%', () => {
  // 판 시작 직후, 난수 0이면 가장 느린 원: 130 × 1.15
  const c = makeCircle(1, 0, 0, [0, 1], G, () => 0);
  assert.ok(Math.abs(c.speed - 130 * 1.15) < 1e-9, String(c.speed));
});
