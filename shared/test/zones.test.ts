import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, feverMultOf, modsOf, newPlayer, resolveClaim, toGameRules, zoneMult, zoneOf, type Pick } from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);

test('zoneOf: 타원 0.35 / 0.7 경계', () => {
  assert.equal(zoneOf({ x: 800, y: 450 }), 0);
  assert.equal(zoneOf({ x: 800 + 0.34 * 800, y: 450 }), 0);
  assert.equal(zoneOf({ x: 800 + 0.35 * 800, y: 450 }), 1);
  assert.equal(zoneOf({ x: 800, y: 450 + 0.69 * 450 }), 1);
  assert.equal(zoneOf({ x: 800, y: 450 + 0.7 * 450 }), 2);
  assert.equal(zoneOf({ x: 0, y: 0 }), 2);
});

test('zoneMult: 1/2/3, 찰나의 순간은 가장자리만, 상한 +4', () => {
  const m = modsOf([{ id: 'edge', tier: 3 }]);
  assert.deepEqual(([0, 1, 2] as const).map((z) => zoneMult(z, m)), [1, 2, 6]);
  assert.equal(modsOf(Array<Pick>(5).fill({ id: 'edge', tier: 3 })).edge, 4);
});

test('구역 배율은 다른 배율과 곱하고 0점은 그대로', () => {
  const a = newPlayer('a', 'A', 0);
  const r = resolveClaim(a, 0, [a], 100, G, { zone: 2 });
  assert.deepEqual([r.gained, r.zone], [9, 2]);
  const b = newPlayer('b', 'B', 0);
  b.feverUntil = 10_000;
  assert.equal(resolveClaim(b, 0, [b], 100, G, { zone: 1 }).gained, Math.round(3 * feverMultOf(b, G) * 2));
  const c = newPlayer('c', 'C', 0);
  c.picks = [{ id: 'oneWay', tier: 0 }];
  assert.equal(resolveClaim(c, 'y', [c], 100, G, { zone: 2 }).gained, 0);
});
