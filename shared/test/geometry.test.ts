import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, assistTargets, hitWithin, isGuarded, isHit, isMine, type Circle } from '../src/index.ts';

/** t=0에 (1200, 450)에 있는 원 (가운데 발사 보호 구역 밖) */
const still = (r = 40): Circle => ({ id: 1, kind: 0, angle: 0, speed: 400, r, born: -1000 });

test('isHit 기본 여유 12', () => {
  assert.equal(isHit(still(), 0, 1200 + 52, 450), true);
  assert.equal(isHit(still(), 0, 1200 + 53, 450), false);
});

const at = (id: number, kind: Circle['kind'], dx: number, dy: number, r = 40): Circle =>
  // 위치는 각도·속도·시간으로 만든다: t=1000에 (1200+dx, 450+dy) (가운데 발사 보호 구역 밖)
  ({ id, kind, angle: Math.atan2(dy, 400 + dx), speed: Math.hypot(400 + dx, dy), r, born: 0 });

test('발사 보호 구역: 원 중심이 가운데에서 90 안이면 정확히 눌러도 안 잡힌다', () => {
  // 초당 100으로 오른쪽: t=800에 중심 x=880 (거리 80), t=1000에 x=900 (거리 100)
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 100, r: 40, born: 0 };
  assert.equal(isGuarded(c, 800), true);
  assert.equal(isHit(c, 800, 880, 450), false);
  assert.equal(isGuarded(c, 1000), false);
  assert.equal(isHit(c, 1000, 900, 450), true);
  assert.equal(RULES.spawnGuardR, 90);
});

test('발사 보호 구역: 넓은 손·자석도 보호 구역 안의 원은 못 잡는다', () => {
  const fresh: Circle = { id: 9, kind: 0, angle: 0, speed: 0, r: 40, born: 0 };
  const r = assistTargets([fresh], 0, 800, 450, 1000, 55, 150);
  assert.deepEqual([r.range.length, r.magnet], [0, null]);
});

test('isHit 여유를 직접 줄 수 있다', () => {
  assert.equal(isHit(still(), 0, 1252 + 20, 450, 12 + 20), true);
  assert.equal(isHit(still(), 0, 1252 + 21, 450, 12 + 20), false);
});

test('isMine: 내 색·노란색·무지개만', () => {
  assert.equal(isMine(0, 0), true);
  assert.equal(isMine('y', 2), true);
  assert.equal(isMine('rainbow', 1), true);
  assert.equal(isMine(1, 0), false);
  assert.equal(isMine('boss', 0), false);
});

test('assistTargets 넓은 손: 범위 안의 내 원 전부, 남의 색 제외', () => {
  const cs = [at(1, 0, 60, 0), at(2, 'y', -60, 0), at(3, 1, 0, 70)];
  const r = assistTargets(cs, 0, 1200, 450, 1000, 25, 0);
  assert.deepEqual(r.range.map((c) => c.id).sort(), [1, 2]);
  assert.equal(r.magnet, null);
});

test('assistTargets 자석: 빗나가면 가장 가까운 내 원 하나', () => {
  // 내 색 원 둘레에서 40 떨어진 곳 클릭 (중심 거리 80)
  const cs = [at(1, 0, 80, 0), at(2, 'y', -120, 0), at(3, 1, 0, 50)];
  const r = assistTargets(cs, 0, 1200, 450, 1000, 0, 50);
  assert.deepEqual(r.range, []);
  assert.equal(r.magnet?.id, 1);
});

test('assistTargets: 넓은 손으로 잡히면 자석은 없음', () => {
  const cs = [at(1, 0, 60, 0), at(2, 'y', -100, 0)];
  const r = assistTargets(cs, 0, 1200, 450, 1000, 25, 150);
  assert.deepEqual(r.range.map((c) => c.id), [1]);
  assert.equal(r.magnet, null);
});

test('assistTargets: 지연 보정 안에서 닿았던 원도 잡힌다 (서버와 같은 판정)', () => {
  // 초당 400으로 오른쪽으로 가는 원: t=1000에 중심 x=1200, t=800에는 x=1120
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 400, r: 40, born: 0 };
  // x=1120 클릭: 지금(t=1000)은 둘레에서 40 떨어짐 → 자석 20으로는 안 닿지만 200ms 전에는 정확히 맞음
  assert.equal(assistTargets([c], 0, 1120, 450, 1000, 0, 20).magnet, null);
  assert.equal(assistTargets([c], 0, 1120, 450, 1000, 0, 20, undefined, RULES.lagWindowMs).magnet?.id, 1);
  assert.equal(hitWithin(c, 1000, 1120, 450, RULES.hitPad, 250), true);
  assert.equal(hitWithin(c, 1000, 1120, 450, RULES.hitPad, 0), false);
});

test('assistTargets: skip에 있는 원은 제외', () => {
  const cs = [at(1, 0, 60, 0)];
  assert.deepEqual(assistTargets(cs, 0, 1200, 450, 1000, 25, 0, new Set([1])).range, []);
});
