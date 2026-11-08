import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURSE, DEFAULT_RULES, LEGEND, RULES, SRC_KEYS, newPlayer, otherOf, resolveClaim, resolveMiss, strikeBoss, toGameRules,
  type Circle, type Pick, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const pl = (id: string, color: 0 | 1 | 2 | 3, ...picks: Pick[]): PlayerState => { const p = newPlayer(id, id, color); p.picks = picks; return p; };
const P = (id: Pick['id'], tier: 0 | 1 | 2 | 3 = 0): Pick => ({ id, tier });
const NOW = 1_000_000;
const boss = (hp: number, type: Circle['boss'] = 'normal', bornAgo = 100_000): Circle =>
  ({ id: 1, kind: 'boss', boss: type, angle: 0, speed: 0, r: 90, born: NOW - bornAgo, hp, maxHp: 24 });
const no = () => 0.99;
const sum = (p: PlayerState) => SRC_KEYS.reduce((a, k) => a + p.stats.src[k], 0);

test('출처: 직접 클릭은 circle, 콤보 보너스 몫은 combo로 나뉨', () => {
  const p = pl('p', 0);
  p.combo = 9;
  const r = resolveClaim(p, 0, [p], 100, G, { rand: no }); // 3 + 콤보 보너스 5 = 8
  assert.equal(r.gained, RULES.points.own + RULES.comboBonus);
  assert.deepEqual([p.stats.src.circle, p.stats.src.combo], [RULES.points.own, RULES.comboBonus]);
});

test('출처: 자석·견제(강탈 포함)·보스(타격·막타·독식·MVP)가 제 칸에', () => {
  const p = pl('p', 0);
  resolveClaim(p, 0, [p], 100, G, { via: 'magnet' });
  assert.equal(p.stats.src.magnet, Math.round(RULES.points.own * 0.7));
  const c = pl('c', 0, P('plunder', 2)), o = pl('o', 1);
  o.score = 100;
  const r = resolveClaim(c, 1, [c, o], 100, G);
  assert.equal(c.stats.src.steal, r.gained);
  assert.ok(r.plundered > 0);
  const b = pl('b', 0), x = pl('x', 1);
  const s = strikeBoss(b, boss(1), new Map([['b', 11], ['x', 1]]), [b, x], NOW, G, no);
  assert.equal(b.stats.src.boss, s.gained + s.killGained + s.mvpGained);
  assert.equal(b.score, b.stats.src.boss);
});

test('잃은 점수: 강탈·방패 레전드·공격형·유리 대포', () => {
  const c = pl('c', 0, P('plunder', 2)), o = pl('o', 1);
  o.score = 100;
  const r = resolveClaim(c, 1, [c, o], 100, G);
  assert.equal(o.stats.src.lost, r.plundered);
  const a = pl('a', 0), s = pl('s', 1, P('shield', 3));
  a.score = 10; s.score = 50;
  resolveClaim(a, 1, [a, s], 100, G);
  assert.deepEqual([a.stats.src.lost, s.stats.src.steal], [LEGEND.shieldDrain, LEGEND.shieldDrain]);
  const e = pl('e', 0);
  e.score = 50;
  strikeBoss(e, boss(24, 'rage', 3000), new Map(), [e], NOW, G, no);
  assert.equal(e.stats.src.lost, 50 - e.score);
  const g = pl('g', 0, P('glassCannon'));
  g.score = 20;
  resolveMiss(g, 100, G, [g]);
  assert.equal(g.stats.src.lost, CURSE.glassCannon.missPenalty);
});

test('참고값: 피버 중 점수, 잭팟 추가분', () => {
  const p = pl('p', 0, P('jackpot', 3));
  p.feverUntil = 10_000;
  const r = resolveClaim(p, 0, [p], 100, G, { rand: () => 0 }); // 잭팟 ×2
  assert.equal(r.jackpot, 2);
  assert.equal(p.stats.src.fever, r.gained);
  assert.equal(p.stats.src.jackpot, r.gained - Math.round(r.gained / 2));
});

test('출처 합 − 잃은 점수 + 기타 = 총점, 따로 오간 점수는 기타가 맞춰 줌(음수 가능)', () => {
  const c = pl('c', 0, P('plunder', 2)), o = pl('o', 1);
  o.score = 100;
  resolveClaim(o, 1, [c, o], 100, G); // o: 내 원
  resolveClaim(c, 1, [c, o], 100, G); // c가 o를 견제 (강탈)
  for (const p of [c, o]) assert.equal(otherOf(p), p.score - sum(p) + p.stats.src.lost);
  assert.equal(otherOf(c), 0);
  assert.equal(otherOf(o), 100); // 처음 준 100점은 기록 밖
  o.score += 40; // 이벤트 정산
  assert.equal(otherOf(o), 140);
  c.score -= 3; // 세금 같은 감점
  assert.equal(otherOf(c), -3);
});
