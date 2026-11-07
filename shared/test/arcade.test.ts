import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, addBuff, groupPicks, jackpotMult, magnetOf, modsOf, newPlayer, reachOf, resolveClaim, toGameRules,
  type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const two = (): [PlayerState, PlayerState] => [newPlayer('a', 'A', 0), newPlayer('b', 'B', 1)];
/** 정해진 순서로 값을 내는 난수 */
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

test('잭팟 확률 중첩 상한 50%', () => {
  assert.equal(modsOf([{ id: 'jackpot', tier: 3 }, { id: 'jackpot', tier: 3 }]).jackpot, 50);
});

test('jackpotMult: 확률을 넘으면 1, 터지면 ×1.5 / ×2 / ×3', () => {
  const m = modsOf([{ id: 'jackpot', tier: 3 }]);
  assert.equal(jackpotMult(m, seq(0.1, 0.5)), 1.5);
  assert.equal(jackpotMult(m, seq(0.1, 0.8)), 2);
  assert.equal(jackpotMult(m, seq(0.1, 0.97)), 3);
  assert.equal(jackpotMult(m, seq(0.3)), 1);
  assert.equal(jackpotMult(modsOf([]), seq(0)), 1);
});

test('잭팟은 피버 배율까지 붙은 점수에 곱한다', () => {
  const [a, b] = two();
  a.picks = [{ id: 'jackpot', tier: 2 }];
  const r = resolveClaim(a, 0, [a, b], 100, G, { rand: seq(0.1, 0.8) });
  assert.deepEqual([r.gained, r.jackpot], [6, 2]);
  a.feverUntil = 10_000;
  assert.equal(resolveClaim(a, 0, [a, b], 200, G, { rand: seq(0.1, 0.8) }).gained, 18);
});

test('블라스트: 남의 색 +1, 페널티·표적·주인 콤보 끊기 없음, 견제 기록 안 남음', () => {
  const [a, b] = two();
  a.combo = 2; b.combo = 5;
  const r = resolveClaim(a, 1, [a, b], 100, G, { via: 'blast' });
  assert.equal(r.gained, 1);
  assert.equal(r.type, 'feverSteal');
  assert.equal(r.marked, false);
  assert.equal(r.via, 'blast');
  assert.deepEqual([a.combo, b.combo, a.stats.steals], [2, 5, 0]);
});

test('블라스트: 표적인 주인이어도 반격이 아니고 잭팟도 없음', () => {
  const [a, b] = two();
  a.picks = [{ id: 'jackpot', tier: 3 }];
  b.markedUntil = 10_000;
  const r = resolveClaim(a, 1, [a, b], 100, G, { via: 'blast', rand: seq(0) });
  assert.notEqual(r.type, 'counter');
  assert.equal(r.jackpot, 1);
});

test('reachOf·magnetOf: 능력 + 아이템, 능력 상한', () => {
  const [a] = two();
  a.picks = [{ id: 'wideHand', tier: 3 }, { id: 'wideHand', tier: 3 }];
  assert.equal(reachOf(a, 0), 80);
  const [c] = two();
  c.picks = [{ id: 'wideHand', tier: 3 }];
  assert.equal(reachOf(c, 0), 70);
  addBuff(c, 'wideHand', 5000, 0);
  assert.equal(reachOf(c, 0), 80);
  addBuff(c, 'magnet', 5000, 0);
  assert.equal(magnetOf(c, 0), 90);
  c.picks = [{ id: 'magnet', tier: 3 }];
  assert.equal(magnetOf(c, 0), 240); // 레전드 240 + 아이템 90, 상한 240
});

test('groupPicks: 같은 증강은 하나로, 가장 높은 등급, 개수', () => {
  assert.deepEqual(groupPicks([{ id: 'hammer', tier: 0 }, { id: 'jackpot', tier: 1 }, { id: 'hammer', tier: 2 }]),
    [{ id: 'hammer', tier: 2, count: 2 }, { id: 'jackpot', tier: 1, count: 1 }]);
  assert.deepEqual(groupPicks([]), []);
});
