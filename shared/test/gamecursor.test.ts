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
