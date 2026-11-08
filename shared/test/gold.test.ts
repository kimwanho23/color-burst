import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, FIELD, RULES, circlePos, goldGain, goldTimes, isMine, isOut, makeGold, newPlayer, toGameRules } from '../src/index.ts';

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

test('황금 원: 피버·구역·아이템 2배·잭팟 배율이 곱해짐, 콤보·게이지 그대로', () => {
  const G = toGameRules(DEFAULT_RULES), now = 100_000;
  const p = newPlayer('p', 'P', 0);
  p.combo = 7; p.fever = 40;
  assert.equal(goldGain(p, now, [p], G, 0).gained, RULES.gold.points, '평소 중앙 20');
  assert.equal(goldGain(p, now, [p], G, 2).gained, RULES.gold.points * 3, '가장자리 ×3');
  p.feverUntil = now + 5000;
  assert.equal(goldGain(p, now, [p], G, 2).gained, RULES.gold.points * 3 * G.feverMult, '피버');
  p.buffs.double = now + 5000;
  assert.equal(goldGain(p, now, [p], G, 2).gained, RULES.gold.points * 3 * G.feverMult * 2, '점수 2배 아이템');
  assert.deepEqual([p.combo, p.fever], [7, 40]);
  const j = newPlayer('j', 'J', 1);
  j.picks = [{ id: 'jackpot', tier: 3 }];
  const r = goldGain(j, now, [j], G, 0, () => 0);
  assert.ok(r.jackpot > 1 && r.gained === Math.round(RULES.gold.points * r.jackpot), '잭팟');
});
