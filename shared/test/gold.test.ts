import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, RULES, circlePos, goldTimes, isMine, isOut, makeGold } from '../src/index.ts';

const seq = (v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

test('makeGold·circlePos: 벽에서 튕겨 화면 안에 머묾', () => {
  const g = makeGold(1, 0, () => 0.13);
  assert.deepEqual([g.kind, g.r, g.speed], ['gold', RULES.gold.r, RULES.gold.speed]);
  for (let t = 0; t <= 30_000; t += 100) {
    const p = circlePos(g, t);
    assert.ok(p.x >= g.r - 1e-6 && p.x <= FIELD.w - g.r + 1e-6 && p.y >= g.r - 1e-6 && p.y <= FIELD.h - g.r + 1e-6, `${t}: ${p.x},${p.y}`);
  }
});

test('isOut: 황금 원은 5초 뒤 사라짐', () => {
  const g = makeGold(1, 1000);
  assert.equal(isOut(g, 1000 + 4999), false);
  assert.equal(isOut(g, 1000 + 5000), true);
});

test('황금 원 수명은 시간 정지만큼 늘어남', () => {
  const g = { ...makeGold(1, 0), holds: [[1000, 1500]] as [number, number][] };
  assert.equal(isOut(g, 6000), false);
  assert.equal(isOut(g, 6500), true);
});

test('goldTimes: 1~3개, 3초 ~ 끝 6초 전, 오름차순', () => {
  assert.equal(goldTimes(60_000, seq([0, 0.5])).length, 1);
  assert.equal(goldTimes(60_000, seq([0.5, 0.5])).length, 2);
  const ts = goldTimes(60_000, seq([0.99, 0.9, 0.1, 0.5]));
  assert.equal(ts.length, 3);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  for (const t of ts) assert.ok(t >= 3000 && t <= 54_000, String(t));
});

test('황금 원은 내 원이 아니다 (넓은 손·자석·장판 대상 아님)', () => {
  assert.equal(isMine('gold', 0), false);
});
