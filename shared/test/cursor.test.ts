import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES, auraAt, canLaserStun, cursorActive, cursorModeOf, distToSegment, inAura, laserHits, lensWarp, modsOf, newPlayer, nextCursor, nextLaserIn,
  pickMagnetTargets, rollLaser, rollVolley, slideBack, volleyHits, type Circle, type Point,
} from '../src/index.ts';

/** 순서대로 값을 돌려주는 난수 */
const seq = (v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

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

test('laserHits: 135 안이면 맞음 (빔 폭 270)', () => {
  const a = { x: 0, y: 100 }, b = { x: 1600, y: 100 };
  assert.equal(laserHits({ x: 800, y: 235 }, a, b), true);
  assert.equal(laserHits({ x: 800, y: 236 }, a, b), false);
  assert.equal(RULES.laser.warnMs, 1200);
});

test('rollVolley: 확률 순서 single 40 / parallel 25 / cross 20 / radial 15', () => {
  const kind = (r: number) => rollVolley(seq([r, 0.5, 0.5, 0.5])).kind;
  assert.deepEqual([kind(0), kind(0.39), kind(0.4), kind(0.64), kind(0.65), kind(0.84), kind(0.85)],
    ['single', 'single', 'parallel', 'parallel', 'cross', 'cross', 'radial']);
});

test('rollVolley: 평행 두 줄 사이에 safeGap 틈', () => {
  const { lines } = rollVolley(seq([0.5, 0.5, 0.5, 0.5]));
  assert.equal(lines.length, 2);
  // 두 선분은 길이·중심이 같고 수직으로만 밀려 있어 끝점의 수선이 선분 안에 떨어진다
  const d = distToSegment(lines[1].a, lines[0].a, lines[0].b);
  assert.ok(Math.abs(d - (2 * RULES.laser.width + RULES.laser.safeGap)) < 1e-6, String(d));
});

test('rollVolley: X자는 한 점에서 수직, 방사는 3줄', () => {
  const cross = rollVolley(seq([0.7, 0.5, 0.5, 0.5])).lines;
  assert.equal(cross.length, 2);
  const ang = (l: { a: Point; b: Point }) => Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
  assert.ok(Math.abs(Math.cos(ang(cross[0]) - ang(cross[1]))) < 1e-9);
  assert.equal(rollVolley(seq([0.9, 0.5, 0.5, 0.5])).lines.length, 3);
});

test('volleyHits: 한 줄이라도 닿으면 true', () => {
  const lines = [{ a: { x: 0, y: 100 }, b: { x: 1600, y: 100 } }, { a: { x: 0, y: 800 }, b: { x: 1600, y: 800 } }];
  assert.equal(volleyHits({ x: 5, y: 790 }, lines), true);
  assert.equal(volleyHits({ x: 5, y: 450 }, lines), false);
});

test('canLaserStun: 스턴 중·스턴 끝나고 1초 안에는 안 됨', () => {
  const p = newPlayer('a', 'A', 0); const now = 1_000_000;
  assert.equal(canLaserStun(p, now), true);
  p.stunUntil = now + 500; assert.equal(canLaserStun(p, now), false);
  p.stunUntil = now - 999; assert.equal(canLaserStun(p, now), false);
  p.stunUntil = now - 1000; assert.equal(canLaserStun(p, now), true);
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

test('cursorModeOf: 방해 없으면 null, 감도·반대는 합쳐짐, 끝난 방해는 무시', () => {
  const p = newPlayer('a', 'A', 0);
  assert.equal(cursorModeOf(p, 0), null);
  p.debuffs.slow = 1000;
  assert.deepEqual(cursorModeOf(p, 0), { slow: 0.3 });
  p.debuffs.invert = 1000;
  assert.deepEqual(cursorModeOf(p, 0), { slow: 0.3, invert: true });
  assert.equal(cursorModeOf(p, 1000), null);
});

test('slideBack: 0.15초 동안 진짜 마우스 위치로 돌아온다', () => {
  assert.deepEqual(slideBack({ x: 0, y: 0 }, { x: 100, y: 40 }, 75), { x: 50, y: 20 });
  assert.deepEqual(slideBack({ x: 0, y: 0 }, { x: 100, y: 40 }, 150), { x: 100, y: 40 });
  assert.deepEqual(slideBack({ x: 0, y: 0 }, { x: 100, y: 40 }, 999), { x: 100, y: 40 });
});

test('auraAt·inAura: 이동형 보스만, 몸통 밖 +80 고리 안', () => {
  const runner: Circle = { id: 1, kind: 'boss', boss: 'runner', angle: 0, speed: 0, r: 60, born: 0, hp: 5, maxHp: 5 };
  const normal: Circle = { ...runner, boss: 'normal', r: 90 };
  assert.equal(auraAt(normal, 0), null);
  assert.equal(auraAt(at(2, 0, 900, 450), 1000), null);
  const a = auraAt(runner, 0)!;
  assert.deepEqual([a.x, a.y, a.r, a.inner], [800, 450, 140, 60]);
  assert.equal(inAura({ x: 830, y: 450 }, a), false); // 몸통 안
  assert.equal(inAura({ x: 900, y: 450 }, a), true); // 고리 안
  assert.equal(inAura({ x: 941, y: 450 }, a), false); // 밖
});

test('lensWarp: 렌즈 밖·가운데는 그대로, 볼록은 바깥으로 크게, 오목은 안쪽으로 작게', () => {
  assert.deepEqual(lensWarp({ x: 800 + 400, y: 450 }, 40, true), { x: 1200, y: 450, size: 40 });
  const c = lensWarp({ x: 800, y: 450 }, 40, true);
  assert.deepEqual([c.x, c.y], [800, 450]);
  const vex = lensWarp({ x: 900, y: 450 }, 40, true), cave = lensWarp({ x: 900, y: 450 }, 40, false);
  assert.ok(vex.x > 900 && vex.size > 40, JSON.stringify(vex));
  assert.ok(cave.x < 900 && cave.size < 40, JSON.stringify(cave));
});
