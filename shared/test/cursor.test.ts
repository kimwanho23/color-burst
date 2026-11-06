import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES, cursorActive, distToSegment, laserHits, modsOf, nextCursor, nextLaserIn, pickMagnetTargets, rollLaser, type Circle,
} from '../src/index.ts';

test('nextCursor: 효과가 없으면 진짜 마우스 위치 그대로', () => {
  assert.deepEqual(nextCursor({ x: 0, y: 0 }, { x: 500, y: 300 }, { x: 5, y: 5 }, null), { x: 500, y: 300 });
});

test('nextCursor: 감도 감소·반대, 필드 밖으로 안 나감', () => {
  assert.deepEqual(nextCursor({ x: 500, y: 300 }, { x: 900, y: 900 }, { x: 10, y: -20 }, { slow: 0.3 }), { x: 503, y: 294 });
  assert.deepEqual(nextCursor({ x: 500, y: 300 }, { x: 900, y: 900 }, { x: 10, y: -20 }, { invert: true }), { x: 490, y: 320 });
  assert.equal(nextCursor({ x: 1598, y: 10 }, { x: 0, y: 0 }, { x: 50, y: -50 }, {}).x, 1600);
  assert.equal(nextCursor({ x: 1598, y: 10 }, { x: 0, y: 0 }, { x: 50, y: -50 }, {}).y, 0);
});

test('distToSegment: 선분까지 거리, 끝 너머는 끝점까지', () => {
  assert.equal(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(distToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
});

test('laserHits: 18 안이면 맞음', () => {
  const a = { x: 0, y: 100 }, b = { x: 1600, y: 100 };
  assert.equal(laserHits({ x: 800, y: 118 }, a, b), true);
  assert.equal(laserHits({ x: 800, y: 119 }, a, b), false);
});

test('rollLaser: 길이 4000, 필드 안쪽을 지난다', () => {
  const { a, b } = rollLaser(() => 0.5);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 4000) < 1e-6);
  assert.ok(distToSegment({ x: 800, y: 450 }, a, b) <= RULES.laser.width);
});

test('nextLaserIn: 10~15초', () => {
  assert.equal(nextLaserIn(() => 0), 10_000);
  assert.ok(Math.abs(nextLaserIn(() => 0.999999) - 15_000) < 1);
});

/** 멈춰 있는 원: t=1000에 (x, y) */
const at = (id: number, kind: Circle['kind'], x: number, y: number): Circle =>
  ({ id, kind, angle: Math.atan2(y - 450, x - 800), speed: Math.hypot(x - 800, y - 450), r: 40, born: 0 });

test('pickMagnetTargets: 내 원만, 가까운 순, 최대 개수, 보호 구역·skip·범위 밖 제외', () => {
  const cur = { x: 1200, y: 450 };
  const cs = [
    at(1, 0, 1250, 450), // 내 색, 50
    at(2, 'y', 1180, 450), // 노란색, 20
    at(3, 1, 1210, 450), // 남의 색
    at(4, 0, 1200, 450 + 91), // 범위 밖 (91)
    at(5, 'rainbow', 1200, 450 + 60), // 무지개, 60
    at(6, 0, 820, 450), // 가운데 보호 구역
  ];
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 2).map((c) => c.id), [2, 1]);
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 5).map((c) => c.id), [2, 1, 5]);
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 5, new Set([2])).map((c) => c.id), [1, 5]);
  assert.deepEqual(pickMagnetTargets(cs, 0, { x: 820, y: 450 }, 1000, 90, 5).map((c) => c.id), []);
});

test('자석 능력 60 / 90 / 120 / 160, 상한 200, 아이템 +90', () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => modsOf([{ id: 'magnet', tier: t as 0 }]).magnet), [60, 90, 120, 160]);
  assert.equal(modsOf([{ id: 'magnet', tier: 3 }, { id: 'magnet', tier: 3 }]).magnet, 200);
  assert.equal(RULES.items.magnet, 90);
});

test('cursorActive: 탭이 숨겨졌거나 창이 포커스를 잃으면 커서를 보내지 않는다', () => {
  const on = { playing: true, picking: false, roundOver: false, paused: false, hidden: false, focused: true };
  assert.equal(cursorActive(on), true);
  assert.equal(cursorActive({ ...on, hidden: true }), false);
  assert.equal(cursorActive({ ...on, focused: false }), false);
  assert.equal(cursorActive({ ...on, paused: true }), false);
  assert.equal(cursorActive({ ...on, picking: true }), false);
  assert.equal(cursorActive({ ...on, roundOver: true }), false);
  assert.equal(cursorActive({ ...on, playing: false }), false);
});

test('pickMagnetTargets: 이미 화면 밖으로 나간 원은 끌지 않는다', () => {
  // 오른쪽 끝(1600)을 넘어 중심이 1650에 있는 원, 커서는 가장자리
  const gone = at(7, 0, 1650, 450);
  assert.deepEqual(pickMagnetTargets([gone], 0, { x: 1600, y: 450 }, 1000, 200, 5), []);
});
