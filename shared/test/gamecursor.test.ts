import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameCursor } from '../../client/src/cursor.ts';
import { RULES } from '../src/index.ts';

/** performance.now를 손으로 넘기는 시계 */
function clock(t: { mock: { method: (o: object, k: string, f: () => number) => void } }) {
  const c = { now: 1000 };
  t.mock.method(performance, 'now', () => c.now);
  return c;
}
const round = (p: { x: number; y: number } | null) => p && { x: Math.round(p.x), y: Math.round(p.y) };

test('GameCursor: 반대가 걸리면 미끄러져 거울 위치로', (t) => {
  const c = clock(t);
  const g = new GameCursor();
  g.move({ x: 1200, y: 300 }, { x: 0, y: 0 });
  g.frame(null, 16, false);
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 1200, y: 300 });
  c.now += RULES.sabotage.slideMs / 2;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 800, y: 450 });
  c.now += RULES.sabotage.slideMs;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 400, y: 600 });
});

test('GameCursor: 반대 중에도 오오라 끌림이 유지되고, 오오라를 벗어나면 미끄러져 돌아옴', (t) => {
  const c = clock(t);
  const g = new GameCursor();
  g.move({ x: 1200, y: 300 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false); // (400, 600)
  g.pull({ x: 400, y: 800 }, 50);
  g.frame({ invert: true }, 16, true);
  g.frame({ invert: true }, 16, true);
  assert.deepEqual(round(g.pos), { x: 400, y: 650 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 400, y: 600 });
});

test('GameCursor: 감도 감소 중에도 오오라 끌림이 쌓임', (t) => {
  clock(t);
  const g = new GameCursor();
  g.move({ x: 800, y: 450 }, { x: 0, y: 0 });
  g.frame({ slow: true }, 16, false);
  for (let i = 0; i < 60; i++) { g.pull({ x: 800, y: 900 }, 5); g.frame({ slow: true }, 16, true); }
  assert.ok(g.pos!.y > 450 + 150, `${g.pos!.y}`);
});

test('GameCursor: 누르는 순간(터치)에는 이번 위치의 거울 자리로 바로', (t) => {
  const c = clock(t);
  const g = new GameCursor();
  g.move({ x: 1200, y: 300 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false);
  g.move({ x: 1000, y: 200 }, { x: 0, y: 0 });
  g.snap({ invert: true });
  assert.deepEqual(round(g.pos), { x: 600, y: 700 });
});

// ---------- 맵 패턴 ----------
const walls = { id: 'walls' as const, warnAt: -1500, at: 0, until: 10_000, walls: [{ x: 500, y: 300, w: 40, h: 300 }] };

test('GameCursor 벽: 빠르게 움직여도 벽을 뚫지 않고, 생길 때 안에 있으면 밖으로', (t) => {
  clock(t);
  const g = new GameCursor();
  g.move({ x: 400, y: 450 }, { x: 0, y: 0 });
  g.frame(null, 16, false, { pattern: walls, t: 100 });
  g.move({ x: 700, y: 450 }, { x: 300, y: 0 }); // 한 프레임에 벽 너머까지
  g.frame(null, 16, false, { pattern: walls, t: 116 });
  assert.ok(g.pos!.x < 500, `벽 앞에서 멈춤 ${g.pos!.x}`);
  const h = new GameCursor();
  h.move({ x: 520, y: 450 }, { x: 0, y: 0 }); // 벽 자리
  h.frame(null, 16, false, { pattern: walls, t: 100 });
  assert.ok(h.pos!.x < 500 || h.pos!.x > 540, '밖으로 밀려남');
});

test('GameCursor 소용돌이: 가만히 있어도 중심 쪽으로 끌림', (t) => {
  clock(t);
  const v = { id: 'vortex' as const, warnAt: -1500, at: 0, until: 8000, vortex: { x: 800, y: 450 } };
  const g = new GameCursor();
  g.move({ x: 1000, y: 450 }, { x: 0, y: 0 });
  for (let i = 0; i < 60; i++) g.frame(null, 16, false, { pattern: v, t: 100 + i * 16 });
  assert.ok(g.pos!.x < 1000 - 60, `${g.pos!.x}`);
});

test('GameCursor 빙판: 멈춘 뒤에도 조금 더 가다 돌아옴', (t) => {
  clock(t);
  const ice = { id: 'ice' as const, warnAt: -1500, at: 0, until: 8000 };
  const g = new GameCursor();
  g.move({ x: 400, y: 450 }, { x: 0, y: 0 });
  g.frame(null, 16, false, { pattern: ice, t: 0 });
  g.move({ x: 600, y: 450 }, { x: 200, y: 0 });
  let maxX = 0;
  for (let i = 0; i < 200; i++) { g.frame(null, 16, false, { pattern: ice, t: 16 + i * 16 }); maxX = Math.max(maxX, g.pos!.x); }
  assert.ok(maxX > 610, `지나침 ${maxX}`);
  assert.ok(Math.abs(g.pos!.x - 600) < 3);
});

test('GameCursor 패턴 + 반대: 이동이 반대로, 패턴이 끝나면 미끄러져 거울 위치로', (t) => {
  const c = clock(t);
  const v = { id: 'vortex' as const, warnAt: -1500, at: 0, until: 8000, vortex: { x: 100, y: 100 } }; // 멀리 있어 끌림 없음
  const g = new GameCursor();
  g.move({ x: 800, y: 450 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false, { pattern: v, t: 100 });
  g.move({ x: 900, y: 450 }, { x: 100, y: 0 });
  g.frame({ invert: true }, 16, false, { pattern: v, t: 116 });
  assert.equal(Math.round(g.pos!.x), 700, '반대로 100');
  g.frame({ invert: true }, 16, false, { pattern: v, t: 8000 });
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false, { pattern: v, t: 8100 });
  assert.deepEqual(round(g.pos), { x: 700, y: 450 }, '진짜 900의 거울 위치');
});
