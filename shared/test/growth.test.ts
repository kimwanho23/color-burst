import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, addStack, autoEveryMs, newPlayer, shiftTimes, stackBonus, type Pick } from '../src/index.ts';

const withPicks = (...picks: Pick[]) => { const p = newPlayer('p', 'P', 0); p.picks = picks; return p; };

test('성장 증강 6개: 분류와 등급 수치', () => {
  assert.deepEqual([ABILITY.drill.cat, ABILITY.crownMark.cat, ABILITY.luckStack.cat], ['성장', '성장', '성장']);
  assert.deepEqual([ABILITY.autoMagnet.cat, ABILITY.autoCharge.cat, ABILITY.autoGuard.cat], ['보조', '보조', '보조']);
  assert.deepEqual(ABILITY.drill.values, [2, 3, 5, 8]);
  assert.deepEqual(ABILITY.crownMark.values, [2, 3, 4, 5]);
  assert.deepEqual(ABILITY.luckStack.values, [3, 5, 7, 10]);
  assert.deepEqual(ABILITY.autoMagnet.values, [1, 2, 3, 4]);
  assert.deepEqual(([0, 1, 2, 3] as const).map((tier) => autoEveryMs(withPicks({ id: 'autoCharge', tier }), 'autoCharge')), [10_000, 8_000, 6_000, 4_000]);
  assert.deepEqual(ABILITY.autoGuard.values.map((_, tier) => autoEveryMs(withPicks({ id: 'autoGuard', tier: tier as Pick['tier'] }), 'autoGuard')), [10_000, 8_000, 6_000, 4_000]);
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

test('스택 보너스: 단련 3칸 = 내 색 +3, 왕의 증표 2칸 = 피버 배율 +1.2, 행운 축적 4칸 = 잭팟 +4%', () => {
  const p = withPicks({ id: 'drill', tier: 2 }, { id: 'crownMark', tier: 2 }, { id: 'luckStack', tier: 1 });
  p.stacks = { drill: 3, crownMark: 2, luckStack: 4 };
  const b = stackBonus(p);
  assert.equal(b.own, 3);
  assert.ok(Math.abs(b.feverMult - 1.2) < 1e-9);
  assert.equal(b.jackpot, 4);
  assert.deepEqual(stackBonus(withPicks()), { own: 0, feverMult: 0, jackpot: 0 });
});

test('자동 시전 간격: 겹쳐 고르면 합산, cap 넘지 않음, 없으면 Infinity', () => {
  assert.equal(autoEveryMs(withPicks({ id: 'autoCharge', tier: 0 }, { id: 'autoCharge', tier: 1 }), 'autoCharge'), 60_000 / 13.5);
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

// ---------- 게임에 연결 ----------
import { DEFAULT_RULES, RULES, feverMultOf, resolveClaim, startRound, toGameRules, luckyMods, modsOf, makeBoss } from '../src/index.ts';
import { strikeBoss } from '../src/bossScore.ts';

const G = toGameRules(DEFAULT_RULES);
const two = (...picks: Pick[]) => { const a = withPicks(...picks); const b = newPlayer('b', 'B', 1); return { a, players: [a, b] }; };

test('보호막 발생기는 직접 잡은 내 색에 득점 보너스 한 번, 최대 100점을 준다', () => {
  const { a, players } = two({ id: 'autoGuard', tier: 3 });
  startRound(a, 1000, G);
  assert.equal(a.autoAt.autoGuard, 5000);
  assert.equal(a.generatorGuard, true);
  assert.equal(resolveClaim(a, 'y', players, 1001, G).gained, 2);
  assert.equal(resolveClaim(a, a.color, players, 1002, G, { via: 'range' }).gained, 3);
  assert.equal(a.generatorScore, true);
  assert.equal(resolveClaim(a, a.color, players, 1003, G).gained, 5);
  assert.equal(resolveClaim(a, a.color, players, 1004, G).gained, 3);
  assert.equal(a.generatorGuard, true);

  a.picks.push({ id: 'jackpot', tier: 3 }, { id: 'precise', tier: 3 });
  startRound(a, 2000, G);
  a.feverUntil = 9000;
  a.buffs.double = 9000;
  let roll = 0;
  const rolls = () => (++roll % 2 === 1 ? 0.01 : 0.99);
  const first = resolveClaim(a, a.color, players, 2100, G, { zone: 2, precise: true, rand: rolls });
  const second = resolveClaim(a, a.color, players, 2200, G, { zone: 2, precise: true, rand: rolls });
  assert.equal(first.jackpot, 5);
  assert.equal(first.gained - second.gained, 100);
});

test('반격 태세는 콤보·강탈·도발을 막고 표적이 아닌 상대를 한 번 반격한다', () => {
  const { a, players } = two({ id: 'autoGuard', tier: 3 }, { id: 'counterPro', tier: 3 });
  const b = players[1];
  const c = newPlayer('c', 'C', 2);
  players.push(c);
  b.picks = [{ id: 'plunder', tier: 3 }, { id: 'taunt', tier: 3 }];
  startRound(a, 1000, G);
  a.combo = 5;
  a.score = 200;
  a.fever = 30;
  const hit = resolveClaim(b, a.color, players, 1100, G);
  assert.equal(hit.generatorBlocked, true);
  assert.equal(a.combo, 5);
  assert.equal(a.fever, 30);
  assert.equal(a.score, 200);
  assert.equal(a.generatorGuard, false);
  assert.equal(a.counterReady, true);

  resolveClaim(a, 'y', players, 1110, G);
  assert.equal(a.counterReady, true);
  resolveClaim(a, b.color, players, 1115, G); // 이미 표적인 상대
  assert.equal(a.counterReady, true);
  const fever = a.fever;
  const counter = resolveClaim(a, c.color, players, 1120, G);
  assert.equal(counter.type, 'counter');
  assert.equal(counter.forcedCounter, true);
  assert.equal(counter.gained, 18);
  assert.equal(a.fever, fever + 20);
  assert.equal(a.counterReady, false);
  assert.equal(resolveClaim(a, c.color, players, 1130, G).type, 'steal');
});

test('보호막 강타는 일반 반격과 강제 반격을 강화하고 견제 보호막만 소모한다', () => {
  const { a, players } = two(
    { id: 'autoGuard', tier: 3 }, { id: 'shield', tier: 0 }, { id: 'counterPro', tier: 0 }, { id: 'jackpot', tier: 3 },
  );
  const b = players[1];
  startRound(a, 1000, G);
  const steal = resolveClaim(a, b.color, players, 1001, G, { rand: () => 0.99 });
  assert.equal(steal.type, 'steal');
  assert.equal(steal.shieldBash, undefined);
  assert.equal(a.generatorGuard, true);

  b.markedUntil = 9000;
  const counter = resolveClaim(a, b.color, players, 1002, G, { rand: () => 0.99 });
  assert.equal(counter.type, 'counter');
  assert.equal(counter.shieldBash, 40);
  assert.equal(counter.gained, 48);
  assert.equal(a.generatorGuard, false);
  assert.equal(a.generatorScore, true);
  assert.equal(a.shieldLeft, 1);
  assert.equal(resolveClaim(a, b.color, players, 1003, G, { rand: () => 0.99 }).shieldBash, undefined);

  a.feverUntil = 9000;
  a.generatorGuard = true;
  a.counterReady = true;
  b.markedUntil = 0;
  let roll = 0;
  const forced = resolveClaim(a, b.color, players, 6000, G, { zone: 2, rand: () => (++roll % 2 ? 0.01 : 0.99) });
  assert.equal(forced.forcedCounter, true);
  assert.equal(forced.jackpot, 5);
  assert.equal(forced.shieldBash, 120);
  assert.equal(forced.gained, 8 * 3 * 3 * 5 + 120);
  assert.equal(a.generatorGuard, false);
  assert.equal(a.counterReady, false);
});

test('단련: 10콤보에 닿으면 한 칸, 그다음 내 색 원이 +1점', () => {
  const { a, players } = two({ id: 'drill', tier: 0 });
  const now = 1_000_000;
  const r1 = resolveClaim(a, 0, players, now, G, { rand: () => 0.99 });
  a.combo = 9;
  resolveClaim(a, 0, players, now, G, { rand: () => 0.99 });
  assert.equal(a.stacks.drill, 1);
  a.combo = 3;
  const r2 = resolveClaim(a, 0, players, now, G, { rand: () => 0.99 });
  assert.equal(r2.gained - r1.gained, 1);
});

test('행운 축적: 잭팟이 터지면 한 칸, 잭팟 확률에 더해지되 잭팟 증강 상한(35%)은 그대로', () => {
  const { a, players } = two({ id: 'luckStack', tier: 0 }, { id: 'jackpot', tier: 3 }, { id: 'jackpot', tier: 3 });
  resolveClaim(a, 0, players, 1_000_000, G, { rand: () => 0 });
  assert.equal(a.stacks.luckStack, 1);
  a.stacks.luckStack = 3;
  assert.equal(luckyMods(a, modsOf(a.picks)).jackpot, 35);
  const b = withPicks({ id: 'luckStack', tier: 0 }, { id: 'jackpot', tier: 0 });
  b.stacks.luckStack = 3;
  assert.equal(luckyMods(b, modsOf(b.picks)).jackpot, 8);
});

test('왕의 증표: 막타와 25% 피해는 1칸, 레전드가 보스 체력 절반을 깎으면 2칸', () => {
  const { a, players } = two({ id: 'crownMark', tier: 3 });
  const lastHit = players[1]!;
  const contributor = newPlayer('c', 'C', 2);
  const below = newPlayer('d', 'D', 3);
  for (const p of [lastHit, contributor, below]) p.picks = [{ id: 'crownMark', tier: 0 }];
  players.push(contributor, below);
  const boss = Object.assign(makeBoss(1, 0, players.length, G, () => 0.5), { hp: 1, maxHp: 100 });
  const hits = new Map([[a.id, 50], [contributor.id, 25], [below.id, 24]]);
  assert.equal(strikeBoss(lastHit, boss, hits, players, 10, G, () => 0.99).killed, true);
  assert.deepEqual(players.map((p) => p.stacks.crownMark ?? 0), [2, 1, 1, 0]);
});

test('왕의 증표: 3칸과 5칸에서 보너스가 뛰고 레전드 독식과 막타가 한 번만 적용된다', () => {
  const { a, players } = two({ id: 'crownMark', tier: 3 });
  for (const [count, want] of [[0, 3], [1, 3.6], [2, 4.2], [3, 5.8], [4, 6.4], [5, 9]]) {
    a.stacks.crownMark = count;
    assert.ok(Math.abs(feverMultOf(a, G) - want) < 1e-9);
  }
  a.stacks.crownMark = 1;
  for (const [index, expected] of [3, 5, 5].entries()) {
    const boss = Object.assign(makeBoss(index + 1, 0, players.length, G, () => 0.5), { hp: 1, maxHp: 100 });
    const hits = new Map([[a.id, 99]]);
    assert.equal(strikeBoss(a, boss, hits, players, 10, G, () => 0.99).killed, true);
    assert.equal(a.stacks.crownMark, expected);
  }
});

test('자동 시전: 라운드 시작 때 첫 발동 시각 = 시작 + 간격 (가진 것만)', () => {
  const a = withPicks({ id: 'autoCharge', tier: 1 });
  startRound(a, 5_000, G);
  assert.deepEqual(a.autoAt, { autoCharge: 5_000 + 8_000 });
  assert.equal(RULES.fever.own > 0, true);
});
