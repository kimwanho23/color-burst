import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY, DEFAULT_RULES, DICE, bossHitInfo, endRoundDice, extraMult, isFever, newPlayer, RULES, startRound, toGameRules,
  type AbilityId, type Pick, type Tier,
} from '../src/index.ts';

const G = toGameRules({ ...DEFAULT_RULES, mode: 'arcade', comeback: false });
const pick = (id: AbilityId, tier: Tier = 0): Pick => ({ id, tier });
const player = (...picks: Pick[]) => Object.assign(newPlayer('a', 'A', 0), { picks });
const END = 30_000;
/** face번 눈이 나온 다음 라운드를 시작한다 */
const roll = (p: ReturnType<typeof player>, face: number, G2 = G) => { p.diceFace = face; startRound(p, 0, G2, END); };

test('주사위: 일반 증강(보조), 등급 배율 ×1 / ×2 / ×3 / ×5', () => {
  assert.equal(ABILITY.dice.cat, '보조');
  assert.deepEqual(ABILITY.dice.values, [1, 2, 3, 5]);
});

test('endRoundDice: 눈은 1~6, 효과 문장과 함께 결과로 돌려준다. 주사위가 없으면 굴리지 않는다', () => {
  const p = player(pick('dice'));
  for (const [r, face] of [[0, 1], [0.17, 2], [0.34, 3], [0.5, 4], [0.67, 5], [0.99, 6]] as const) {
    const eff = endRoundDice(p, () => r);
    assert.deepEqual(eff.map((e) => [e.id, e.delta]), [['dice', face]]);
    assert.equal(p.diceFace, face);
    assert.ok(eff[0].text && eff[0].text.length > 0);
  }
  const none = player();
  none.diceFace = 4;
  assert.deepEqual(endRoundDice(none, () => 0), []);
  assert.equal(none.diceFace, 0);
});

test('눈 1·6: 다음 라운드 모든 점수 +3% / +8% (등급 배율을 곱함), 눈은 한 번 쓰면 사라진다', () => {
  const a = player(pick('dice')), b = player(pick('dice', 3));
  roll(a, 1);
  assert.equal(a.diceScorePct, DICE.score1);
  assert.equal(a.diceFace, 0);
  assert.ok(Math.abs(extraMult(a, 1000, [a]) - 1.03) < 1e-9);
  roll(b, 6);
  assert.equal(b.diceScorePct, DICE.score6 * 5);
  assert.ok(Math.abs(extraMult(b, 1000, [b]) - 1.4) < 1e-9);
  roll(a, 0);
  assert.equal(a.diceScorePct, 0, '다음 라운드는 눈이 없으면 효과도 없음');
});

test('눈 2: 라운드를 피버 게이지 20%로 시작, 100% 이상이면 피버로 시작 (예열과 큰 쪽)', () => {
  const p = player(pick('dice'));
  roll(p, 2);
  assert.equal(p.fever, 20);
  const big = player(pick('dice', 3)); // ×5 → 100%
  roll(big, 2);
  assert.equal(isFever(big, 1), true);
  const both = player(pick('dice'), pick('preheat', 1)); // 예열 40% > 주사위 20%
  roll(both, 2);
  assert.equal(both.fever, 40);
});

test('눈 3: 보스 타격 점수 +1, 눈 4: 견제 보호막 +1회 (방패 증강과 합쳐짐)', () => {
  const p = player(pick('dice'));
  const base = bossHitInfo(p, () => 0.99).hit;
  roll(p, 3);
  assert.equal(bossHitInfo(p, () => 0.99).hit, base + DICE.boss3);
  const q = player(pick('dice'), pick('shield', 1));
  roll(q, 4);
  assert.equal(q.shieldLeft, 2 + DICE.shield4);
});

test('눈 5: 라운드 시작 3초 뒤 아이템을 발동할 예약 (노말 1개, 에픽 ×3 → 2개). 아이템이 꺼진 방은 눈 1과 같은 효과', () => {
  const p = player(pick('dice'));
  roll(p, 5);
  assert.deepEqual([p.diceItems, p.diceItemAt], [1, RULES.itemLoverDelayMs]);
  const e = player(pick('dice', 2));
  roll(e, 5);
  assert.equal(e.diceItems, 2);
  const off = toGameRules({ ...DEFAULT_RULES, mode: 'arcade', items: false });
  const q = player(pick('dice'));
  roll(q, 5, off);
  assert.deepEqual([q.diceItems, q.diceScorePct], [0, DICE.score1]);
});

test('주사위 증강 없이 눈만 남아 있어도 효과는 없다', () => {
  const p = player();
  roll(p, 6);
  assert.deepEqual([p.diceScorePct, p.diceItems, p.diceBossHit], [0, 0, 0]);
});
