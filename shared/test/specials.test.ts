import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, applyItem, applyRankReach, bossHitInfo, canLaserStun, comebackMult, endRoundSpecials, extraMult, feverMultOf,
  hyenaGains, modsOf, newPlayer, reachOf, resolveClaim, startRound, toGameRules, zoneMult, type AbilityId, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const GC = toGameRules({ ...DEFAULT_RULES, comeback: true });
const withCard = (p: PlayerState, id: AbilityId) => { p.picks.push({ id, tier: 0 }); return p; };
const trio = () => [newPlayer('a', 'A', 0), newPlayer('b', 'B', 1), newPlayer('c', 'C', 2)];

test('comebackMult: 3인 ×1.2, 꼴찌를 벗어나면 1이고 꺼짐', () => {
  const [a, b, c] = trio();
  a.score = 100; b.score = 500; c.score = 900; a.comeback = true;
  assert.equal(comebackMult(a, [a, b, c]), 1.2);
  a.score = 1000;
  assert.equal(comebackMult(a, [a, b, c]), 1);
  assert.equal(a.comeback, false);
  a.score = 0;
  assert.equal(comebackMult(a, [a, b, c]), 1, '다시 꼴찌가 돼도 다음 판정까지 꺼짐');
});

test('extraMult: 마지막 불꽃은 라운드 끝 15초 안에서만 ×2', () => {
  const p = withCard(newPlayer('a', 'A', 0), 'lastFlame');
  p.roundEnd = 100_000;
  assert.equal(extraMult(p, 84_999, [p]), 1);
  assert.equal(extraMult(p, 85_000, [p]), 2);
});

test('대역전: 모든 점수 ×1.5 (내 색 3 → 5)', () => {
  const p = withCard(newPlayer('a', 'A', 0), 'comebackBoost');
  assert.equal(resolveClaim(p, 0, [p], 100, G).gained, 5);
});

test('추격자: 구역 배율이 한 단계씩 (2·3·4)', () => {
  const m = modsOf([{ id: 'chaser', tier: 0 }]);
  assert.deepEqual(([0, 1, 2] as const).map((z) => zoneMult(z, m)), [2, 3, 4]);
});

test('기세: 견제당해도 콤보 유지, 콤보 보너스 5콤보마다', () => {
  const a = newPlayer('a', 'A', 0), b = withCard(newPlayer('b', 'B', 1), 'momentum');
  b.combo = 5;
  resolveClaim(a, 1, [a, b], 100, G);
  assert.equal(b.combo, 5);
  b.combo = 4;
  assert.equal(resolveClaim(b, 1, [a, b], 200, G).comboBonus, true);
});

test('만능 손: 남의 색도 내 색처럼 +3, 표적 없음', () => {
  const a = withCard(newPlayer('a', 'A', 0), 'allHands'), b = newPlayer('b', 'B', 1);
  b.combo = 7;
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.deepEqual([r.type, r.gained, a.markedUntil, b.combo], ['own', 3, 0, 7]);
});

test('철벽: 견제당해도 콤보·점수 지킴, 레이저·방해에 안 걸림', () => {
  const a = newPlayer('a', 'A', 0), b = withCard(newPlayer('b', 'B', 1), 'fortress');
  b.combo = 6; b.score = 50; a.picks.push({ id: 'plunder', tier: 3 });
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.deepEqual([b.combo, b.score, r.shielded], [6, 50, true]);
  assert.equal(canLaserStun(b, 1_000_000), false);
  applyItem(a, 'slowCursor', 100, G, [a, b]);
  assert.equal(b.debuffs.slow, undefined);
});

test('집중 포화: 라운드를 피버로 시작, 피버 배율 +2', () => {
  const p = withCard(newPlayer('a', 'A', 0), 'focusFire');
  startRound(p, 1000, G);
  assert.ok(p.feverUntil > 1000);
  assert.equal(feverMultOf(p, G), G.feverMult + 2);
});

test('막타 독식: 피해·막타 점수 2배', () => {
  const info = bossHitInfo(withCard(newPlayer('a', 'A', 0), 'bossFeast'), () => 0.99);
  assert.deepEqual([info.damage, info.kill], [2, 40]);
});

test('판 뒤집기: 1등과 차이의 20%를 더함, 1등은 그대로', () => {
  const a = withCard(newPlayer('a', 'A', 0), 'flip'), b = withCard(newPlayer('b', 'B', 1), 'flip');
  a.score = 1000; b.score = 400;
  const fx = endRoundSpecials([a, b]);
  assert.deepEqual([a.score, b.score], [1000, 520]);
  assert.deepEqual(fx, [{ playerId: 'b', id: 'flip', delta: 120 }]);
});

test('하이에나: 1등이 잡을 때만 20% 확률로 +3', () => {
  const [a, b, c] = trio();
  withCard(c, 'hyena');
  a.score = 100; b.score = 50;
  assert.deepEqual(hyenaGains(a, [a, b, c], 1, () => 0.19), [{ playerId: 'c', delta: 3 }]);
  assert.deepEqual(hyenaGains(a, [a, b, c], 1, () => 0.2), []);
  assert.deepEqual(hyenaGains(b, [a, b, c], 1, () => 0), []);
});

test('넓은 손 순위 보정: 4인 꼴찌 +20·3등 +10, 3인은 꼴찌만, 꼴찌 보정 꺼진 방은 없음, 상한 80', () => {
  const four = [...trio(), newPlayer('d', 'D', 3)];
  [10, 20, 30, 40].forEach((s, i) => { four[i].score = s; });
  applyRankReach(four, GC);
  assert.deepEqual(four.map((p) => p.rankReach), [20, 10, 0, 0]);
  const three = trio();
  [10, 20, 30].forEach((s, i) => { three[i].score = s; });
  applyRankReach(three, GC);
  assert.deepEqual(three.map((p) => p.rankReach), [20, 0, 0]);
  applyRankReach(four, G);
  assert.deepEqual(four.map((p) => p.rankReach), [0, 0, 0, 0]);
  const p = newPlayer('a', 'A', 0);
  p.picks = [{ id: 'wideHand', tier: 3 }, { id: 'wideHand', tier: 3 }]; p.rankReach = 20;
  assert.equal(reachOf(p, 0), 80);
});
