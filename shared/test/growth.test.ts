import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, addStack, autoEveryMs, newPlayer, shiftTimes, stackBonus, type Pick } from '../src/index.ts';

const withPicks = (...picks: Pick[]) => { const p = newPlayer('p', 'P', 0); p.picks = picks; return p; };

test('성장 증강 6개: 분류와 등급 수치', () => {
  assert.deepEqual([ABILITY.drill.cat, ABILITY.crownMark.cat, ABILITY.luckStack.cat], ['성장', '성장', '성장']);
  assert.deepEqual([ABILITY.autoMagnet.cat, ABILITY.autoCharge.cat, ABILITY.autoGuard.cat], ['보조', '보조', '보조']);
  assert.deepEqual(ABILITY.drill.values, [2, 3, 5, 8]);
  assert.deepEqual(ABILITY.crownMark.values, [1, 2, 3, 5]);
  assert.deepEqual(ABILITY.luckStack.values, [3, 5, 7, 10]);
  assert.deepEqual(ABILITY.autoMagnet.values, [3, 4, 6, 10]);
  assert.deepEqual(ABILITY.autoCharge.values, [4, 6, 8, 12]);
  assert.deepEqual(ABILITY.autoGuard.values, [3, 4, 6, 10]);
});

test('스택: 최대 칸까지만 쌓이고 같은 증강을 또 고르면 최대 칸이 늘어남', () => {
  const p = withPicks({ id: 'drill', tier: 0 });
  assert.deepEqual([addStack(p, 'drill'), addStack(p, 'drill'), addStack(p, 'drill')], [true, true, false]);
  assert.equal(p.stacks.drill, 2);
  p.picks.push({ id: 'drill', tier: 1 });
  for (let i = 0; i < 10; i++) addStack(p, 'drill');
  assert.equal(p.stacks.drill, 5);
  // 없는 증강은 쌓이지 않음
  assert.equal(addStack(p, 'crownMark'), false);
});

test('스택 보너스: 단련 3칸 = 내 색 +3, 왕의 증표 2칸 = 피버 배율 +0.4, 행운 축적 4칸 = 잭팟 +4%', () => {
  const p = withPicks({ id: 'drill', tier: 2 }, { id: 'crownMark', tier: 2 }, { id: 'luckStack', tier: 1 });
  p.stacks = { drill: 3, crownMark: 2, luckStack: 4 };
  const b = stackBonus(p);
  assert.equal(b.own, 3);
  assert.ok(Math.abs(b.feverMult - 0.4) < 1e-9);
  assert.equal(b.jackpot, 4);
  assert.deepEqual(stackBonus(withPicks()), { own: 0, feverMult: 0, jackpot: 0 });
});

test('자동 시전 간격: 1분에 3번 = 20초, 겹쳐 고르면 합산, cap 넘지 않음, 없으면 Infinity', () => {
  assert.equal(autoEveryMs(withPicks({ id: 'autoMagnet', tier: 0 }), 'autoMagnet'), 20_000);
  assert.equal(autoEveryMs(withPicks({ id: 'autoMagnet', tier: 0 }, { id: 'autoMagnet', tier: 1 }), 'autoMagnet'), 60_000 / 7);
  assert.equal(autoEveryMs(withPicks({ id: 'autoCharge', tier: 3 }, { id: 'autoCharge', tier: 3 }), 'autoCharge'), 60_000 / 20);
  assert.equal(autoEveryMs(withPicks(), 'autoGuard'), Infinity);
});

test('shiftTimes가 다음 자동 발동 시각도 민다', () => {
  const p = withPicks({ id: 'autoCharge', tier: 0 });
  p.autoAt = { autoCharge: 5_000 };
  shiftTimes(p, 1_000, 2_000);
  assert.equal(p.autoAt.autoCharge, 7_000);
  p.autoAt = { autoCharge: 500 };
  shiftTimes(p, 1_000, 2_000);
  assert.equal(p.autoAt.autoCharge, 500, '멈추기 전에 지난 시각은 그대로');
});
