import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, RULES, hitWithin, rangeTargets, isGuarded, isHit, isMine, type Circle } from '../src/index.ts';

/** 판 중앙 (예전 1600×900 판의 (800, 450) 자리) */
const CX = FIELD.w / 2, CY = FIELD.h / 2;
/** t=0에 (CX+400, CY)에 있는 원 (가운데 발사 보호 구역 밖) */
const still = (r = 40): Circle => ({ id: 1, kind: 0, angle: 0, speed: 400, r, born: -1000 });

test('isHit 기본 여유 12', () => {
  assert.equal(isHit(still(), 0, CX + 400 + 52, CY), true);
  assert.equal(isHit(still(), 0, CX + 400 + 53, CY), false);
});

const at = (id: number, kind: Circle['kind'], dx: number, dy: number, r = 40): Circle =>
  // 위치는 각도·속도·시간으로 만든다: t=1000에 (CX+400+dx, CY+dy) (가운데 발사 보호 구역 밖)
  ({ id, kind, angle: Math.atan2(dy, 400 + dx), speed: Math.hypot(400 + dx, dy), r, born: 0 });

test('발사 보호 구역: 원 중심이 가운데에서 90 안이면 정확히 눌러도 안 잡힌다', () => {
  // 초당 100으로 오른쪽: t=800에 중심이 가운데에서 80, t=1000에 100
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 100, r: 40, born: 0 };
  assert.equal(isGuarded(c, 800), true);
  assert.equal(isHit(c, 800, CX + 80, CY), false);
  assert.equal(isGuarded(c, 1000), false);
  assert.equal(isHit(c, 1000, CX + 100, CY), true);
  assert.equal(RULES.spawnGuardR, 90);
});

test('발사 보호 구역: 넓은 손도 보호 구역 안의 원은 못 잡는다', () => {
  const fresh: Circle = { id: 9, kind: 0, angle: 0, speed: 0, r: 40, born: 0 };
  assert.deepEqual(rangeTargets([fresh], 0, CX, CY, 1000, 55), []);
});

test('isHit 여유를 직접 줄 수 있다', () => {
  assert.equal(isHit(still(), 0, CX + 452 + 20, CY, 12 + 20), true);
  assert.equal(isHit(still(), 0, CX + 452 + 21, CY, 12 + 20), false);
});

test('isMine: 내 색·노란색·무지개만', () => {
  assert.equal(isMine(0, 0), true);
  assert.equal(isMine('y', 2), true);
  assert.equal(isMine('rainbow', 1), true);
  assert.equal(isMine(1, 0), false);
  assert.equal(isMine('boss', 0), false);
});

test('rangeTargets 넓은 손: 범위 안의 내 원 전부, 남의 색 제외', () => {
  const cs = [at(1, 0, 60, 0), at(2, 'y', -60, 0), at(3, 1, 0, 70)];
  assert.deepEqual(rangeTargets(cs, 0, CX + 400, CY, 1000, 25).map((c) => c.id).sort(), [1, 2]);
  assert.deepEqual(rangeTargets(cs, 0, CX + 400, CY, 1000, 0), []);
});

test('rangeTargets: 지연 보정 안에서 닿았던 원도 잡힌다 (서버와 같은 판정)', () => {
  // 초당 400으로 오른쪽으로 가는 원: t=1000에 중심 CX+400, t=800에는 CX+320
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 400, r: 40, born: 0 };
  // x=1120 클릭: 지금(t=1000)은 둘레에서 40 떨어짐 → 범위 20으로는 안 닿지만 200ms 전에는 정확히 맞음
  assert.deepEqual(rangeTargets([c], 0, CX + 320, CY, 1000, 20), []);
  assert.deepEqual(rangeTargets([c], 0, CX + 320, CY, 1000, 20, undefined, RULES.lagWindowMs).map((x) => x.id), [1]);
  assert.equal(hitWithin(c, 1000, CX + 320, CY, RULES.hitPad, 250), true);
  assert.equal(hitWithin(c, 1000, CX + 320, CY, RULES.hitPad, 0), false);
});

test('rangeTargets: skip에 있는 원은 제외', () => {
  const cs = [at(1, 0, 60, 0)];
  assert.deepEqual(rangeTargets(cs, 0, CX + 400, CY, 1000, 25, new Set([1])), []);
});
