import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, applyEvent, bossTimes, payTax, circlePos, isCurse, isOut, newPlayer, rollEvent, rollOptions, toGameRules,
  type Circle, type EventId, type PlayerState,
} from '../src/index.ts';

const G = toGameRules({ ...DEFAULT_RULES, mode: 'arcade' });
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const four = (...scores: number[]): PlayerState[] =>
  scores.map((s, i) => Object.assign(newPlayer(`p${i}`, `P${i}`, i as 0 | 1 | 2 | 3), { score: s }));

test('rollEvent: 10% 확률, 한 게임 최대 2번', () => {
  const ps = four(50, 40, 30, 20);
  assert.notEqual(rollEvent(ps, 0, seq(0.05, 0.5)), null);
  assert.equal(rollEvent(ps, 0, seq(0.2)), null);
  assert.equal(rollEvent(ps, 2, () => 0), null);
});

test('rollEvent: 모두 동점이면 꼴찌가 필요한 이벤트는 안 나온다', () => {
  const ps = four(10, 10, 10, 10);
  const need: EventId[] = ['robinHood', 'swap', 'gift'];
  for (let i = 0; i < 100; i++) {
    const id = rollEvent(ps, 0, seq(0, i / 100));
    assert.ok(id && !need.includes(id), String(id));
  }
});

test('로빈 후드: 1등 점수 10%를 꼴찌에게', () => {
  const ps = four(100, 50, 40, 20);
  const r = applyEvent('robinHood', ps, G);
  assert.deepEqual([ps[0].score, ps[3].score], [90, 30]);
  assert.equal(r.changes.length, 2);
});

test('순위 역전 룰렛: 1등과 꼴찌 점수 맞바꿈', () => {
  const ps = four(100, 50, 40, 20);
  applyEvent('swap', ps, G);
  assert.deepEqual([ps[0].score, ps[3].score], [20, 100]);
});

test('세금: 모두 5% 내림, 걷은 합은 pot', () => {
  const ps = four(100, 50, 39, 20);
  const r = applyEvent('tax', ps, G);
  assert.deepEqual(ps.map((p) => p.score), [95, 48, 38, 19]);
  assert.equal(r.pot, 5 + 2 + 1 + 1);
});

test('강등: 1등의 올라간 등급 능력이 한 단계 내려감', () => {
  const ps = four(100, 50, 40, 20);
  ps[0].picks = [{ id: 'picky', tier: 1 }, { id: 'gambler', tier: 0 }];
  const r = applyEvent('demote', ps, G);
  assert.equal(ps[0].picks[0].tier, 0);
  assert.deepEqual(r.demoted, { playerId: 'p0', id: 'picky' });
});

test('선물·저주 배달은 대상만 정한다', () => {
  const ps = four(100, 50, 40, 20);
  assert.equal(applyEvent('gift', ps, G).giftTo, 'p3');
  ps[1].picks = [{ id: 'gambler', tier: 0 }];
  for (let i = 0; i < 20; i++) assert.notEqual(applyEvent('curseDelivery', ps, G, seq(i / 20)).curseTo, 'p1');
});

test('저주 배달: 다음 선택이 전부 레전드인 사람(악마의 계약)은 대상이 아니다', () => {
  const ps = four(100, 50, 40, 20);
  ps[0].legendNext = true; ps[1].legendNext = true; ps[2].legendNext = true;
  for (let i = 0; i < 20; i++) assert.equal(applyEvent('curseDelivery', ps, G, seq(i / 20)).curseTo, 'p3');
  ps[3].legendNext = true;
  for (let i = 0; i < 50; i++) assert.notEqual(rollEvent(ps, 0, seq(0, i / 50)), 'curseDelivery');
});

test('세금 지급: 라운드에 가장 많이 번 사람, 동점이면 나누고 나머지는 총점이 낮은 사람에게', () => {
  const ps = four(100, 60, 40, 20);
  ps.forEach((p, i) => { p.roundStart = [70, 30, 30, 0][i]; });
  // 라운드 증가량: 30, 30, 10, 20 → p0·p1 동점, 7점을 3·3 + 나머지 1은 총점이 낮은 p1
  const fx = payTax(ps, 7);
  assert.deepEqual(ps.map((p) => p.score), [103, 64, 40, 20]);
  assert.deepEqual(fx.map((e) => [e.playerId, e.delta]), [['p0', 3], ['p1', 4]]);
  assert.ok(fx.every((e) => e.id === 'tax'));
});

test('테마: 보스가 꺼진 방에서는 보스 러시가 안 나온다', () => {
  const noBoss = toGameRules({ ...DEFAULT_RULES, mode: 'arcade', boss: false });
  for (let i = 0; i < 50; i++) assert.notEqual(applyEvent('theme', four(1, 2, 3, 4), noBoss, () => i / 50).theme, 'bossRush');
});

test('보스 러시: 라운드 25%·55%·85% 지점', () => {
  assert.deepEqual(bossTimes(G, 'bossRush'), [7500, 16500, 25500]);
});

test('역발사 원: 가장자리에서 중앙으로, 중앙에 닿으면 나감', () => {
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 100, r: 40, born: 0, rev: true };
  assert.equal(circlePos(c, 0).x, 1640);
  assert.ok(circlePos(c, 1000).x < circlePos(c, 0).x);
  assert.equal(isOut(c, 0), false);
  assert.equal(isOut(c, 8400), true);
  assert.equal(isOut(c, 9000), true);
  assert.equal(isOut(c, 8000), false);
});

test('rollOptions forceCurse: 저주 1장 포함', () => {
  const opts = rollOptions(0, false, seq(0.5, 0.3, 0.7, 0.1, 0.9), { forceCurse: true });
  assert.equal(opts.filter((o) => isCurse(o.id)).length, 1);
});

test('능력 교환·강등은 특별 카드를 건드리지 않음', () => {
  for (let n = 0; n < 50; n++) {
    const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
    a.picks = [{ id: 'comebackBoost', tier: 0 }, { id: 'hammer', tier: 1 }];
    b.picks = [{ id: 'jackpot', tier: 2 }];
    a.score = 100; b.score = 1000;
    applyEvent('abilitySwap', [a, b], toGameRules(DEFAULT_RULES));
    assert.ok(a.picks.some((x) => x.id === 'comebackBoost'));
    assert.ok(!b.picks.some((x) => x.id === 'comebackBoost'));
  }
});
