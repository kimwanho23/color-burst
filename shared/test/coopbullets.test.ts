import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOP_BOSSES, FIELD, RULES, hitShot, makeVolley, shotGone, shotPos, volleyDone, type BulletShape } from '../src/index.ts';

const FROM = { x: 550, y: 190 };
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

test('링: 발 수와 아래쪽 퍼짐', () => {
  const v = makeVolley('ring', 1, 0, FROM, { speed: 260, phase: 1 }, () => 0.5);
  assert.equal(v.shots.length, RULES.coop.bullets.ringCount);
  assert.equal(v.r, RULES.coop.bullets.r);
  for (const s of v.shots) { assert.ok(s.a > 0 && s.a < Math.PI); assert.equal(s.x, FROM.x); assert.equal(s.y, FROM.y); }
  const v3 = makeVolley('ring', 2, 0, FROM, { speed: 260, phase: 3 }, () => 0.5);
  assert.equal(v3.shots.length, RULES.coop.bullets.ringCount * 2);
  for (const s of v3.shots) assert.ok(s.a > 0 && s.a < Math.PI);
  assert.equal(new Set(v3.shots.map((s) => s.a)).size, v3.shots.length);
});

test('조준 부채꼴: 가운데 탄이 aim을 향함', () => {
  const aim = { x: 800, y: 700 };
  const v = makeVolley('aimed', 1, 0, FROM, { speed: 260, phase: 2, aim }, () => 0.5);
  assert.equal(v.shots.length, RULES.coop.bullets.aimedCount);
  const mid = v.shots[Math.floor(v.shots.length / 2)];
  assert.ok(Math.abs(mid.a - Math.atan2(aim.y - FROM.y, aim.x - FROM.x)) < 1e-9);
  const spread = Math.max(...v.shots.map((s) => s.a)) - Math.min(...v.shots.map((s) => s.a));
  assert.ok(Math.abs(spread - 2 * RULES.coop.bullets.aimedSpread) < 1e-9);
  const d = makeVolley('aimed', 2, 0, FROM, { speed: 260, phase: 1 }, () => 0.5);
  assert.ok(Math.abs(d.shots[2].a - Math.PI / 2) < 1e-9);
});

test('나선·흩뿌리기: 발 수, 아래쪽', () => {
  const sp = makeVolley('spiral', 1, 0, FROM, { speed: 260, phase: 1 }, () => 0.3);
  assert.equal(sp.shots.length, RULES.coop.bullets.spiralCount);
  assert.ok(sp.shots.some((s) => s.d > 0));
  const sc = makeVolley('scatter', 1, 0, FROM, { speed: 260, phase: 1 }, () => 0.7);
  assert.equal(sc.shots.length, RULES.coop.bullets.scatterCount);
  for (const s of [...sp.shots, ...sc.shots]) assert.ok(s.a > 0 && s.a < Math.PI);
});

test('shotPos: 발사 전 null, 1초 뒤 v만큼 이동', () => {
  const v = makeVolley('aimed', 1, 1000, FROM, { speed: 300, phase: 1, aim: { x: 550, y: 900 } }, () => 0.5);
  const i = 2;
  assert.equal(shotPos(v, i, 999), null);
  const p0 = shotPos(v, i, 1000 + v.shots[i].d)!;
  const p1 = shotPos(v, i, 1000 + v.shots[i].d + 1000)!;
  assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - v.shots[i].v) < 1e-6);
  assert.equal(shotGone(v, i, 1000), false);
  assert.equal(shotGone(v, i, 1000 + 20_000), true);
  assert.equal(volleyDone(v, 1000), false);
  assert.equal(volleyDone(v, 1000 + 20_000), true);
});

test('hitShot: 반지름 안이면 맞음, skip에 있으면 무시', () => {
  const v = makeVolley('aimed', 7, 0, FROM, { speed: 300, phase: 1, aim: { x: 550, y: 900 } }, () => 0.5);
  const t = 500;
  const p = shotPos(v, 2, t)!;
  const near = { x: p.x + v.r - 1, y: p.y };
  assert.deepEqual(hitShot(near, [v], t, new Set()), { volleyId: 7, shot: 2 });
  assert.equal(hitShot(near, [v], t, new Set(['7:2'])), null);
  assert.equal(hitShot({ x: p.x + v.r + 5, y: p.y }, [v], t, new Set(['7:2'])), null);
  assert.equal(hitShot({ x: 5, y: 1090 }, [v], t, new Set()), null);
});

for (const r of [0, 0.5, 0.999]) {
  test(`벽: 틈이 gaps개, 틈마다 폭 ≥ 120 (rand=${r})`, () => {
    for (const gaps of [1, 2, 3]) {
      const v = makeVolley('wall', 1, 0, FROM, { speed: 260, phase: 2, gaps }, seq([r, 1 - r, r, 0.3]));
      const ys = new Set(v.shots.map((s) => s.y));
      assert.equal(ys.size, 1);
      assert.ok([...ys][0] > FROM.y);
      for (const s of v.shots) { assert.ok(Math.abs(s.a - Math.PI / 2) < 1e-9); assert.equal(s.d, 0); }
      const xs = v.shots.map((s) => s.x).sort((a, b) => a - b);
      const edges = [0, ...xs, FIELD.w];
      let holes = 0;
      for (let k = 1; k < edges.length; k++) {
        const w = edges[k] - edges[k - 1];
        if (w >= RULES.coop.bullets.gapW) holes++;
        else assert.ok(w <= 2 * v.r + 2, `간격 ${w}`);
      }
      assert.equal(holes, gaps);
    }
  });
}

test('보스 정의: 단계마다 skills가 spec 표와 같다', () => {
  const b = COOP_BOSSES.core;
  assert.deepEqual(b.skills[1], ['laser', 'threat']);
  assert.deepEqual(b.skills[2], ['laser', 'threat', 'slam', 'seal', 'wall', 'beam']);
  assert.deepEqual(b.skills[3], ['laser', 'threat', 'slam', 'seal', 'wall', 'beam', 'safe']);
  assert.deepEqual(b.bullets[1], ['ring', 'scatter']);
  assert.deepEqual(b.bullets[2], ['ring', 'scatter', 'aimed', 'spiral']);
  assert.ok(!b.bullets[3].includes('wall'));
  assert.deepEqual([...new Set<BulletShape>(b.bullets[3])].sort(), ['aimed', 'ring', 'scatter', 'spiral']);
  assert.deepEqual(b.shieldBullets, [['spiral', 'ring'], ['spiral', 'ring', 'aimed']]);
  assert.equal(b.rims.length, 3);
  for (const lv of Object.values(RULES.coop.levels)) assert.ok(lv.bulletEveryMs > 0 && lv.bulletSpeed > 0);
  assert.deepEqual(Object.values(RULES.coop.levels).map((l) => l.bulletEveryMs), [1600, 1200, 950, 750]);
  assert.deepEqual(Object.values(RULES.coop.levels).map((l) => l.bulletSpeed), [220, 260, 300, 340]);
});
