import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD, LEGEND, RULES, auraAt, canLaserStun, holdLasers, cursorActive, cursorModeOf, distToSegment, inAura, laserHits, lensWarp, modsOf, newPlayer, cursorTarget, followCursor, relativeCursor, nextLaserIn,
  pickMagnetTargets, rollLaser, rollVolley, slideBack, volleyHits, type Circle, type Point,
} from '../src/index.ts';

/** 순서대로 값을 돌려주는 난수 */
const seq = (v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
/** 판 크기·중앙 */
const W = FIELD.w, H = FIELD.h, CX = W / 2, CY = H / 2;

test('cursorTarget: 반대는 화면 가운데 기준 거울 위치, 필드 밖 진짜 위치는 잘라서', () => {
  assert.deepEqual(cursorTarget({ x: W, y: 0 }, { invert: true }), { x: 0, y: H });
  assert.deepEqual(cursorTarget({ x: W - 200, y: 300 }, { invert: true }), { x: 200, y: H - 300 });
  assert.deepEqual(cursorTarget({ x: W + 100, y: -50 }, { invert: true }), { x: 0, y: H });
  assert.deepEqual(cursorTarget({ x: W + 100, y: -50 }, null), { x: W, y: 0 });
  assert.deepEqual(cursorTarget({ x: 500, y: 300 }, { slow: true }), { x: 500, y: 300 });
});

test('cursorTarget: 반대 중에도 진짜 마우스가 화면 안을 오가면 네 구석 모두 닿음', () => {
  for (const [rx, ry, gx, gy] of [[0, 0, W, H], [W, 0, 0, H], [0, H, W, 0], [W, H, 0, 0]]) {
    assert.deepEqual(cursorTarget({ x: rx, y: ry }, { invert: true }), { x: gx, y: gy });
  }
});

test('followCursor: 감도 감소는 늦게 따라가 결국 도착, 아니면 바로', () => {
  const a = followCursor({ x: 0, y: 0 }, { x: 1000, y: 0 }, 16, true);
  assert.ok(a.x > 0 && a.x < 100, `${a.x}`);
  let p = { x: 0, y: 0 };
  for (let i = 0; i < 200; i++) p = followCursor(p, { x: 1000, y: 0 }, 16, true);
  assert.ok(Math.abs(p.x - 1000) < 1);
  assert.deepEqual(followCursor({ x: 0, y: 0 }, { x: 1000, y: 0 }, 16, false), { x: 1000, y: 0 });
  // 시간 상수만큼 지나면 약 63%
  assert.ok(Math.abs(followCursor({ x: 0, y: 0 }, { x: 1000, y: 0 }, RULES.sabotage.slowLagMs, true).x - 632) < 1);
});

test('relativeCursor: 오오라 끌림 중에는 이동량 그대로, 필드 밖으로 안 나감', () => {
  assert.deepEqual(relativeCursor({ x: 500, y: 300 }, { x: 10, y: -20 }), { x: 510, y: 280 });
  assert.deepEqual(relativeCursor({ x: W - 2, y: 10 }, { x: 50, y: -50 }), { x: W, y: 0 });
});

test('반대가 걸리는 순간: 거울 위치까지 slideMs 동안 미끄러짐', () => {
  const from = { x: W - 200, y: 300 }, to = cursorTarget(from, { invert: true });
  assert.deepEqual(slideBack(from, to, RULES.sabotage.slideMs / 2), { x: CX, y: CY });
  assert.deepEqual(slideBack(from, to, RULES.sabotage.slideMs), to);
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
  assert.ok(distToSegment({ x: CX, y: CY }, a, b) <= RULES.laser.width);
});

test('nextLaserIn: 10~15초', () => {
  assert.equal(nextLaserIn(() => 0), 10_000);
  assert.ok(Math.abs(nextLaserIn(() => 0.999999) - 15_000) < 1);
});

/** 멈춰 있는 원: t=1000에 (x, y) */
const at = (id: number, kind: Circle['kind'], x: number, y: number): Circle =>
  ({ id, kind, angle: Math.atan2(y - CY, x - CX), speed: Math.hypot(x - CX, y - CY), r: 40, born: 0 });

test('pickMagnetTargets: 내 원·노란 원만(무지개 제외), 가까운 순, 최대 개수, 보호 구역·skip·범위 밖 제외', () => {
  const cur = { x: CX + 400, y: CY };
  const cs = [
    at(1, 0, CX + 450, CY), // 내 색, 50
    at(2, 'y', CX + 380, CY), // 노란색, 20
    at(3, 1, CX + 410, CY), // 남의 색
    at(4, 0, CX + 400, CY + 91), // 범위 밖 (91)
    at(5, 'rainbow', CX + 400, CY + 60), // 무지개, 60
    at(6, 0, CX + 20, CY), // 가운데 보호 구역
  ];
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 2).map((c) => c.id), [2, 1]);
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 5).map((c) => c.id), [2, 1]);
  assert.deepEqual(pickMagnetTargets(cs, 0, cur, 1000, 90, 5, new Set([2])).map((c) => c.id), [1]);
  assert.deepEqual(pickMagnetTargets(cs, 0, { x: CX + 20, y: CY }, 1000, 90, 5).map((c) => c.id), []);
});

test('자석 능력 45 / 65 / 90 / 180(레전드 = 에픽 × 2), 상한 180, 아이템 +70, 0.4초, 1초 1개(레전드 2)', () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => modsOf([{ id: 'magnet', tier: t as 0 }]).magnet), [45, 65, 90, 180]);
  assert.equal(modsOf([{ id: 'magnet', tier: 3 }, { id: 'magnet', tier: 3 }]).magnet, 180);
  assert.equal(RULES.items.magnet, 70);
  assert.deepEqual([RULES.magnet.pullMs, RULES.magnet.perSec, LEGEND.magnetPerSec], [400, 1, 2]);
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
  // 오른쪽 끝(W)을 넘어 중심이 W+50에 있는 원, 커서는 가장자리
  const gone = at(7, 0, W + 50, CY);
  assert.deepEqual(pickMagnetTargets([gone], 0, { x: W, y: CY }, 1000, 200, 5), []);
});

test('cursorModeOf: 방해 없으면 null, 감도·반대는 합쳐짐, 끝난 방해는 무시', () => {
  const p = newPlayer('a', 'A', 0);
  assert.equal(cursorModeOf(p, 0), null);
  p.debuffs.slow = 1000;
  assert.deepEqual(cursorModeOf(p, 0), { slow: true });
  p.debuffs.invert = 1000;
  assert.deepEqual(cursorModeOf(p, 0), { slow: true, invert: true });
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
  assert.equal(auraAt(at(2, 0, CX + 100, CY), 1000), null);
  const a = auraAt(runner, 0)!;
  assert.deepEqual([a.x, a.y, a.r, a.inner], [CX, CY, 140, 60]);
  assert.equal(inAura({ x: CX + 30, y: CY }, a), false); // 몸통 안
  assert.equal(inAura({ x: CX + 100, y: CY }, a), true); // 고리 안
  assert.equal(inAura({ x: CX + 141, y: CY }, a), false); // 밖
});

test('lensWarp: 렌즈 밖·가운데는 그대로, 볼록은 바깥으로 크게, 오목은 안쪽으로 작게', () => {
  assert.deepEqual(lensWarp({ x: CX + 400, y: CY }, 40, true), { x: CX + 400, y: CY, size: 40 });
  const c = lensWarp({ x: CX, y: CY }, 40, true);
  assert.deepEqual([c.x, c.y], [CX, CY]);
  const vex = lensWarp({ x: CX + 100, y: CY }, 40, true), cave = lensWarp({ x: CX + 100, y: CY }, 40, false);
  assert.ok(vex.x > CX + 100 && vex.size > 40, JSON.stringify(vex));
  assert.ok(cave.x < CX + 100 && cave.size < 40, JSON.stringify(cave));
});

test('holdLasers: 아직 안 쏜 볼리만 늦춘다', () => {
  const ls = [{ at: 1000 }, { at: 400 }, { at: 500 }];
  holdLasers(ls, 500, 1500);
  assert.deepEqual(ls.map((l) => l.at), [2500, 400, 500]);
});
