import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBO, DEFAULT_RULES, RULES, newPlayer, strikeBoss, toGameRules, type BossType, type Circle, type Pick, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const NOW = 1_000_000;
const pl = (id: string, color: 0 | 1 | 2 | 3, ...picks: Pick[]): PlayerState => { const p = newPlayer(id, id, color); p.picks = picks; return p; };
const P = (id: Pick['id'], tier: 0 | 1 | 2 | 3 = 0): Pick => ({ id, tier });
const HUNTER = [P('hammer'), P('hunter'), P('crusher')];
/**
 * NOW에 가운데에서 오른쪽 d만큼 떨어진 보스 (거의 안 움직임). bornAgo로 방어형·공격형 주기를 고른다
 * (100초: 보호막·붉어짐 없음, 2.5초: 방어형 보호막, 3초: 공격형 붉어짐)
 */
const boss = (d: number, hp = 24, type: BossType = 'normal', bornAgo = 100_000): Circle =>
  ({ id: 1, kind: 'boss', boss: type, angle: 0, speed: d / (bornAgo / 1000), r: 90, born: NOW - bornAgo, hp, maxHp: 24 });
const no = () => 0.99;

test('보스 점수에 피버 배율 전부(상한 없음)와 점수 구역 배율', () => {
  const p = pl('p', 0);
  p.feverUntil = NOW + 5000; p.feverBonus = 3; // 피버 ×6
  const r = strikeBoss(p, boss(500), new Map(), [p], NOW, G, no); // 가장자리 ×3
  assert.equal(r.gained, 1 * 6 * 3);
});

test('보스 타격: 콤보 +1, 피버 게이지 +4, 문턱 넘으면 콤보 보너스. 보호막·공격형은 없음', () => {
  const p = pl('p', 0);
  p.combo = 9;
  const r = strikeBoss(p, boss(0), new Map(), [p], NOW, G, no);
  assert.deepEqual([p.combo, p.fever, r.comboBonus, r.gained], [10, RULES.boss.feverGain, true, 1 + RULES.comboBonus]);
  const g = pl('g', 0);
  g.combo = 3;
  const rg = strikeBoss(g, boss(0, 24, 'guard', 2500), new Map(), [g], NOW, G, no);
  assert.deepEqual([rg.blocked, g.combo, g.fever], [true, 3, 0]);
  const e = pl('e', 0);
  e.combo = 3; e.score = 50;
  const re = strikeBoss(e, boss(0, 24, 'rage', 3000), new Map(), [e], NOW, G, no);
  assert.deepEqual([re.enraged, e.combo, e.fever, e.score < 50], [true, 3, 0, true]);
});

test('타격 점수는 피해 비례: 파쇄 3타면 3배, 남은 체력보다 큰 피해는 남은 만큼만', () => {
  const p = pl('p', 0, P('crusher', 2)); // 3타
  const c = boss(0);
  const r = strikeBoss(p, c, new Map(), [p], NOW, G, no);
  assert.deepEqual([r.damage, r.gained, c.hp], [3, 3, 21]);
  const q = pl('q', 0, P('crusher', 2));
  const c2 = boss(0, 2);
  const hits = new Map([['x', 22]]);
  const r2 = strikeBoss(q, c2, hits, [q], NOW, G, no);
  assert.deepEqual([r2.damage, r2.gained, hits.get('q'), r2.killed], [2, 2, 2, true]);
});

test('독식: 최대 체력 50% 이상이면 +60×배율, 49%면 없음', () => {
  // 4인 체력 24: 마지막 1을 깎아 12가 되면 독식
  const p = pl('p', 0), x = pl('x', 1);
  const r = strikeBoss(p, boss(0, 1), new Map([['p', 11], ['x', 12]]), [p, x], NOW, G, no);
  assert.deepEqual([r.solo, r.killGained], [true, RULES.boss.kill * RULES.boss.solo.killMult + RULES.boss.solo.points]);
  const q = pl('q', 0);
  const r2 = strikeBoss(q, boss(0, 1), new Map([['q', 10], ['x', 13]]), [q, x], NOW, G, no);
  assert.deepEqual([r2.solo, r2.killGained], [false, RULES.boss.kill]);
});

test('독식은 실제로 깎은 양 기준: 막타 초과 피해는 세지 않음', () => {
  const p = pl('p', 0, P('crusher', 3)); // 5타
  const r = strikeBoss(p, boss(0, 1), new Map([['p', 10], ['x', 13]]), [p], NOW, G, no);
  assert.deepEqual([r.damage, r.solo], [1, false]); // 10 + 1 = 11 < 12
});

test('독식한 사람이 막타면 막타 점수 2배, 독식 아닌 막타는 그대로, 보스 헌터 ×2와 곱함', () => {
  const p = pl('p', 0, ...HUNTER); // 피해 1 + 1, 막타 (20 + 10) × 2
  p.fever = 0;
  const r = strikeBoss(p, boss(0, 2), new Map([['p', 11], ['x', 11]]), [p], NOW, G, no);
  const kill = (RULES.boss.kill + 10) * COMBO.bossKillMult;
  assert.deepEqual([r.solo, r.killGained], [true, kill * RULES.boss.solo.killMult + RULES.boss.solo.points]);
  // 독식하면 피버 게이지 +25 (타격 +4와 별도)
  assert.equal(p.fever, RULES.boss.feverGain + COMBO.bossSoloFever);
  const q = pl('q', 0, ...HUNTER);
  const r2 = strikeBoss(q, boss(0, 2), new Map([['q', 5], ['x', 17]]), [q], NOW, G, no);
  assert.deepEqual([r2.solo, r2.killGained, q.fever], [false, kill, RULES.boss.feverGain]);
});

test('선봉: 남이 먼저 때린 보스도 내 첫 타면 ×N, 같은 보스 두 번째는 보통', () => {
  const p = pl('p', 0, P('vanguard', 0)); // ×2
  const hits = new Map([['x', 3]]);
  const c = boss(0);
  assert.equal(strikeBoss(p, c, hits, [p], NOW, G, no).gained, 2);
  assert.equal(strikeBoss(p, c, hits, [p], NOW, G, no).gained, 1);
});

test('보스 헌터: 붉은 공격형도 감점 없이 피해·점수', () => {
  const p = pl('p', 0, ...HUNTER);
  p.score = 50;
  const c = boss(0, 24, 'rage', 3000);
  const r = strikeBoss(p, c, new Map(), [p], NOW, G, no);
  assert.deepEqual([r.enraged, r.damage, p.score > 50, c.hp], [false, 2, true, 22]);
});

test('배율 쌓임 상한은 보스에도 적용, 잭팟은 그 위', () => {
  const p = pl('p', 0, P('jackpot', 3));
  p.feverUntil = NOW + 5000; p.feverBonus = 17; // 피버 ×20 × 가장자리 ×3 → ×20
  const r = strikeBoss(p, boss(500), new Map(), [p], NOW, G, () => 0); // 잭팟 터짐, 레전드 첫 배율 ×2
  assert.deepEqual([r.jackpot, r.gained], [2, 1 * 20 * 2]);
});

test('MVP: 가장 많이 깎은 사람이 고정 +5', () => {
  const p = pl('p', 0), x = pl('x', 1);
  const r = strikeBoss(p, boss(0, 1), new Map([['p', 3], ['x', 20]]), [p, x], NOW, G, no);
  assert.deepEqual([r.mvp, r.mvpGained, x.score], ['x', RULES.boss.mvp, RULES.boss.mvp]);
});
