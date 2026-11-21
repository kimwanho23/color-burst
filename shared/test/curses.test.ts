import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURSE, DEFAULT_RULES, addFever, endRoundCurses, makeBoss, newPlayer, shiftTimes, startRound, strikeBoss, toGameRules,
  type AbilityId, type Pick, type Tier,
} from '../src/index.ts';

const G = toGameRules({ ...DEFAULT_RULES, mode: 'arcade', comeback: false });
const pick = (id: AbilityId, tier: Tier = 0): Pick => ({ id, tier });
const player = (...picks: Pick[]) => Object.assign(newPlayer('a', 'A', 0), { picks });
const enemy = () => newPlayer('b', 'B', 1);
const raw = { rand: () => 0.99 };
const END = 30_000;

/** 라운드를 0~END에 시작한다. 시한폭탄은 라운드 시간의 절반(15초)이 시한 */
const begin = (p: ReturnType<typeof player>) => startRound(p, 0, G, END);

test('시한폭탄: 점화 때는 아무것도 받지 않고, 시한은 라운드 시간의 절반', () => {
  const p = player(pick('timeBomb'));
  p.score = 1000;
  begin(p);
  assert.equal(p.score, 1000);
  assert.equal(p.bombDefused, false);
  assert.equal(p.bombDeadline, END * CURSE.timeBomb.deadlineFrac);
});

test('시한폭탄: 시한 안에 피버를 발동하면 해체되어 지난 라운드 득점의 25%를 받는다', () => {
  const p = player(pick('timeBomb'));
  p.score = 1000;
  p.prevRoundGain = 800;
  begin(p);
  addFever(p, 100, 10_000, G, [p], true);
  assert.equal(p.bombDefused, true);
  p.score += 400; // 이번 라운드 득점
  const eff = endRoundCurses(p, raw.rand);
  assert.deepEqual(eff.map((e) => [e.id, e.delta]), [['timeBomb', 200]]);
  assert.equal(p.score, 1000 + 400 + 200);
  assert.equal(p.prevRoundGain, 400, '다음 라운드의 지난 라운드 득점');
});

test('시한폭탄: 시한이 지난 뒤의 피버는 해체가 아니고, 폭발하면 이번 라운드 득점의 35%를 잃는다', () => {
  const p = player(pick('timeBomb'));
  p.score = 1000;
  p.prevRoundGain = 800;
  begin(p);
  addFever(p, 100, 20_000, G, [p], true);
  assert.equal(p.bombDefused, false);
  p.score += 1000;
  const eff = endRoundCurses(p, raw.rand);
  assert.deepEqual(eff.map((e) => [e.id, e.delta]), [['timeBomb', -350]]);
  assert.equal(p.score, 2000 - 350);
});

test('시한폭탄: 시한 안에 보스를 때려도 해체된다', () => {
  const p = player(pick('timeBomb')), o = enemy();
  begin(p);
  const boss = makeBoss(1, 1000, 2, G, raw.rand);
  strikeBoss(p, boss, new Map(), [p, o], 5_000, G, raw.rand);
  assert.equal(p.bombDefused, true);
  const p2 = player(pick('timeBomb'));
  begin(p2);
  const boss2 = makeBoss(2, 1000, 2, G, raw.rand);
  strikeBoss(p2, boss2, new Map(), [p2, o], 16_000, G, raw.rand);
  assert.equal(p2.bombDefused, false, '시한 뒤의 타격은 해체가 아님');
});

test('시한폭탄: 일시정지로 멈춘 시간만큼 시한도 늦어지고, 라운드 시작 때 해체 상태는 초기화된다', () => {
  const p = player(pick('timeBomb'));
  begin(p);
  shiftTimes(p, 5_000, 3_000);
  assert.equal(p.bombDeadline, END * CURSE.timeBomb.deadlineFrac + 3_000);
  p.bombDefused = true;
  begin(p);
  assert.equal(p.bombDefused, false);
});

test('시한폭탄이 없으면 해체·폭발과 상관없다. 그래도 지난 라운드 득점은 기록한다', () => {
  const p = player();
  p.score = 500;
  begin(p);
  p.score += 300;
  assert.deepEqual(endRoundCurses(p, raw.rand), []);
  assert.equal(p.bombDeadline, 0);
  assert.equal(p.prevRoundGain, 300);
});
