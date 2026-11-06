import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHit, type Circle } from '../src/index.ts';

/** 필드 중앙에 멈춰 있는 원 */
const still = (r = 40): Circle => ({ id: 1, kind: 0, angle: 0, speed: 0, r, born: 0 });

test('isHit 기본 여유 12', () => {
  assert.equal(isHit(still(), 0, 800 + 52, 450), true);
  assert.equal(isHit(still(), 0, 800 + 53, 450), false);
});
