import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, DEFAULT_RULES, RULES, makeCircle, modsOf, newPlayer, resolveClaim, spawnInterval, toGameRules } from '../src/index.ts';

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

test('원의 기본 발사 속도 +15%, 극초반 시작 속도 170 (예전 130)', () => {
  // 판 시작 직후, 난수 0이면 가장 느린 원: 170 × 1.15
  const c = makeCircle(1, 0, 0, [0, 1], G, () => 0);
  assert.ok(Math.abs(c.speed - 170 * 1.15) < 1e-9, String(c.speed));
});

test('후반 속도는 그대로: 진행률 끝에서 가장 느린 원 310 × 1.15', () => {
  const c = makeCircle(1, 0, G.roundMs - RULES.finalRushMs - 1, [0, 1], G, () => 0);
  const prog = (G.roundMs - RULES.finalRushMs - 1) / G.roundMs;
  assert.ok(Math.abs(c.speed - (170 + prog * 140) * 1.15) < 1e-9);
  assert.ok(Math.abs((170 + 1 * 140) - 310) < 1e-9);
});

test('극초반 원 간격 0.32초 (예전 0.42초), 끝은 0.2초 그대로', () => {
  assert.equal(spawnInterval(0, G), 320);
  assert.ok(Math.abs(spawnInterval(G.roundMs - RULES.finalRushMs - 1, G) - (320 - 120 * ((G.roundMs - RULES.finalRushMs - 1) / G.roundMs))) < 1e-9);
});
