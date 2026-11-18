import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOP_DEFEAT, Renderer, setReduceFx, type DrawState } from '../../client/src/render.ts';

test('협력전 처치: 폭발은 한 번, 3초부터 CLEAR, 취소 후 예약 효과 없음', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const originalDpr = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} } });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  t.after(() => {
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    if (originalDpr) Object.defineProperty(globalThis, 'devicePixelRatio', originalDpr);
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
    setReduceFx(false);
  });
  const labels: string[] = [];
  const context = new Proxy({
    globalAlpha: 1,
    createRadialGradient: () => ({ addColorStop() {} }),
    fillText: (text: string) => labels.push(text),
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const stage = { getBoundingClientRect: () => ({ width: 1100, height: 1100 }) } as unknown as HTMLElement;
  const renderer = new Renderer(canvas, stage);
  const scene: DrawState = { circles: [], hidden: new Set(), myColor: null, myFever: false, markedColors: new Set(), now: 0, coop: true };
  let explosions = 0;
  for (const reduced of [false, true]) {
    setReduceFx(reduced);
    const start = now;
    renderer.startCoopDefeat({ x: 550, y: 190, r: 145 }, () => explosions++);
    const before = explosions;
    labels.length = 0;
    now = start + COOP_DEFEAT.burstMs - 1;
    renderer.draw(scene);
    assert.equal(explosions, before);
    assert.ok(!labels.includes('CLEAR'));
    now = start + COOP_DEFEAT.burstMs;
    renderer.draw(scene);
    renderer.draw(scene);
    assert.equal(explosions, before + 1);
    now = start + COOP_DEFEAT.clearMs + 100;
    renderer.draw(scene);
    assert.ok(labels.includes('CLEAR'));
    assert.equal(COOP_DEFEAT.totalMs, 4000);
    renderer.stopCoopDefeat();
    labels.length = 0;
    now = start + COOP_DEFEAT.totalMs;
    renderer.draw(scene);
    assert.ok(!labels.includes('CLEAR'));
    renderer.startCoopDefeat({ x: 550, y: 190, r: 145 }, () => explosions++);
    renderer.stopCoopDefeat();
    now += COOP_DEFEAT.totalMs;
    renderer.draw(scene);
    assert.equal(explosions, before + 1);
  }
});
