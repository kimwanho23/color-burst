import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, RULES, barSegment, circlePos, distToSegment, isOut, makePattern, rollLaser, rollVolley, zoneOf, type Circle, type MapPattern } from '../src/index.ts';

const C = FIELD.w / 2;

test('판은 1100×1100 정사각형, 점수 구역은 원 (같은 거리면 방향과 상관없이 같은 구역)', () => {
  assert.deepEqual([FIELD.w, FIELD.h], [1100, 1100]);
  for (const d of [100, 250, 450]) {
    const zones = new Set<number>();
    for (let a = 0; a < Math.PI * 2; a += 0.2) zones.add(zoneOf({ x: C + Math.cos(a) * d, y: C + Math.sin(a) * d }));
    assert.equal(zones.size, 1, `거리 ${d}`);
  }
});

test('원은 판 끝(반지름까지 포함)을 지나야 사라짐 — 위·아래·왼쪽·오른쪽 같은 거리', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const c: Circle = { id: 1, kind: 0, angle, speed: 100, r: 40, born: 0 };
    const reach = ((C + 40) / 100) * 1000;
    assert.equal(isOut(c, reach - 100), false);
    assert.equal(isOut(c, reach + 100), true);
    const p = circlePos(c, reach - 100);
    assert.ok(Math.abs(p.x - C) + Math.abs(p.y - C) > C, '판 끝 근처까지 감');
  }
});

test('레이저 통과점은 판 안, 선분은 판 대각선을 덮음', () => {
  for (let n = 0; n < 200; n++) {
    const { a, b } = rollLaser();
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    assert.ok(mx > 0 && mx < FIELD.w && my > 0 && my < FIELD.h);
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) / 2 >= Math.hypot(FIELD.w, FIELD.h));
    for (const l of rollVolley().lines) assert.ok(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) / 2 >= Math.hypot(FIELD.w, FIELD.h) / 2);
  }
});

test('회전 막대는 어느 각도에서도 판 끝까지 닿음', () => {
  const p: MapPattern = { id: 'bar', warnAt: -3000, at: 0, until: 9000, bar: { cx: C, cy: C, a0: Math.PI / 4 } };
  const s = barSegment(p, 0);
  assert.ok(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / 2 >= Math.hypot(C, C), '대각선(구석)까지');
  assert.equal(RULES.patterns.bar.len, 1560);
});

test('리뷰: 평행 레이저 사이 빈 틈은 레이저 두께와 상관없이 safeGap', () => {
  for (const half of [0.15 * FIELD.h / 2, 0.22 * FIELD.h / 2, 0.3 * FIELD.h / 2]) {
    const { lines } = rollVolley(() => 0.5, half); // 0.5 → parallel
    const gap = distToSegment(lines[1].a, lines[0].a, lines[0].b) - 2 * half;
    assert.ok(Math.abs(gap - RULES.laser.safeGap) < 1e-6, `${half}: ${gap}`);
  }
});

test('리뷰: 소용돌이 두 개는 언제나 중앙을 피하고 서로 떨어짐 (2000번)', () => {
  const V = RULES.patterns.vortex;
  for (let n = 0; n < 2000; n++) {
    const v = makePattern('vortex', 0, Math.random).vortices!;
    assert.ok(Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) >= V.r + V.eye);
    for (const c of v) assert.ok(Math.hypot(c.x - C, c.y - C) >= V.centerClear);
  }
});
