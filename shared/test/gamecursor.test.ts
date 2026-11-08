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
  g.move({ x: 900, y: 300 }, { x: 0, y: 0 });
  g.frame(null, 16, false);
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 900, y: 300 });
  c.now += RULES.sabotage.slideMs / 2;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 550, y: 550 });
  c.now += RULES.sabotage.slideMs;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 200, y: 800 });
});

test('GameCursor: 반대 중에도 오오라 끌림이 유지되고, 오오라를 벗어나면 미끄러져 돌아옴', (t) => {
  const c = clock(t);
  const g = new GameCursor();
  g.move({ x: 900, y: 300 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false); // (200, 800)
  g.pull({ x: 200, y: 1000 }, 50);
  g.frame({ invert: true }, 16, true);
  g.frame({ invert: true }, 16, true);
  assert.deepEqual(round(g.pos), { x: 200, y: 850 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false);
  assert.deepEqual(round(g.pos), { x: 200, y: 800 });
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
  g.move({ x: 900, y: 300 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false);
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false);
  g.move({ x: 1000, y: 200 }, { x: 0, y: 0 });
  g.snap({ invert: true });
  assert.deepEqual(round(g.pos), { x: 100, y: 900 });
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

test('GameCursor 소용돌이: 끌림 구역이면 쏠리고, 눈에 들어가면 끝날 때까지 갇힘 (안에서는 자유)', (t) => {
  const c = clock(t);
  const v = { id: 'vortex' as const, warnAt: -3000, at: 0, until: 10_000, vortices: [{ x: 400, y: 450 }, { x: 1300, y: 450 }] };
  const g = new GameCursor();
  const step = (x: number, y: number, tt: number, n = 30) => { g.move({ x, y }, { x: 0, y: 0 }); for (let i = 0; i < n; i++) g.frame(null, 16, false, { pattern: v, t: tt + i * 16 }); };
  step(700, 450, 100);
  assert.ok(g.pos!.x < 700 && g.pos!.x > 600, `쏠림 ${g.pos!.x}`);
  assert.equal(g.trapped, -1);
  step(450, 450, 600);
  assert.equal(g.trapped, 0, '눈에 들어가면 갇힘');
  step(480, 500, 1100);
  assert.deepEqual(round(g.pos), { x: 480, y: 500 }, '눈 안에서는 자유');
  step(900, 450, 1600);
  assert.ok(Math.hypot(g.pos!.x - 400, g.pos!.y - 450) < 170, '밖으로 못 나감');
  // 끝나면 풀려 진짜 위치로 미끄러져 돌아옴
  g.frame(null, 16, false, { pattern: v, t: 10_000 });
  c.now += 1000;
  g.frame(null, 16, false, { pattern: v, t: 10_100 });
  assert.deepEqual([round(g.pos), g.trapped], [{ x: 900, y: 450 }, -1]);
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
  const v = { id: 'walls' as const, warnAt: -3000, at: 0, until: 8000, walls: [{ x: 10, y: 10, w: 40, h: 40 }] }; // 멀리 있는 벽
  const g = new GameCursor();
  g.move({ x: 550, y: 550 }, { x: 0, y: 0 });
  g.frame({ invert: true }, 16, false, { pattern: v, t: 100 });
  g.move({ x: 650, y: 550 }, { x: 100, y: 0 });
  g.frame({ invert: true }, 16, false, { pattern: v, t: 116 });
  assert.equal(Math.round(g.pos!.x), 450, '반대로 100');
  g.frame({ invert: true }, 16, false, { pattern: v, t: 8000 });
  c.now += RULES.sabotage.slideMs * 2;
  g.frame({ invert: true }, 16, false, { pattern: v, t: 8100 });
  assert.deepEqual(round(g.pos), { x: 450, y: 550 }, '진짜 650의 거울 위치');
});

test('리뷰: 벽은 진짜 위치를 따라가며 막힐 뿐, 마우스를 되돌리면 어긋남 없이 진짜 위치로', (t) => {
  clock(t);
  const g = new GameCursor();
  g.move({ x: 400, y: 450 }, { x: 0, y: 0 });
  g.frame(null, 16, false, { pattern: walls, t: 100 });
  g.move({ x: 700, y: 450 }, { x: 300, y: 0 }); // 벽 너머로 밀어도
  g.frame(null, 16, false, { pattern: walls, t: 116 });
  assert.ok(g.pos!.x < 500);
  g.move({ x: 400, y: 450 }, { x: -300, y: 0 }); // 되돌리면
  g.frame(null, 16, false, { pattern: walls, t: 132 });
  assert.deepEqual(round(g.pos), { x: 400, y: 450 }, '진짜 위치 그대로 (어긋남 쌓이지 않음)');
});

test('리뷰: 맵 패턴 중 오오라에 끌려도 벽 안으로 들어가지 않음', (t) => {
  clock(t);
  const g = new GameCursor();
  g.move({ x: 480, y: 450 }, { x: 0, y: 0 });
  g.frame(null, 16, false, { pattern: walls, t: 100 });
  for (let i = 0; i < 20; i++) { g.pull({ x: 600, y: 450 }, 10); g.frame(null, 16, true, { pattern: walls, t: 116 + i * 16 }); }
  g.pull({ x: 600, y: 450 }, 10);
  assert.ok(g.pos!.x < 500 || g.pos!.x > 540, `벽 밖 ${g.pos!.x}`);
});
