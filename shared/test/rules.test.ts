import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, PRESETS, makeCircle, rollEvent, rollTheme, sanitizeRules, toGameRules, newPlayer } from '../src/index.ts';

test('프리셋: 새 키 값과 새 프리셋 2개', () => {
  assert.deepEqual([DEFAULT_RULES.mapPct, DEFAULT_RULES.laserWidth, DEFAULT_RULES.themePct, DEFAULT_RULES.eventPct, DEFAULT_RULES.circleScale], [35, 22, 15, 10, 1]);
  assert.equal(PRESETS.party.rules.mapPct, 50);
  assert.deepEqual([PRESETS.hardcore.rules.mapPct, PRESETS.hardcore.rules.laserWidth], [50, 30]);
  assert.equal(PRESETS.chill.rules.mapPct, 0);
  const c = PRESETS.chaos.rules;
  assert.deepEqual([c.mapPct, c.themePct, c.eventPct, c.laserWidth], [80, 30, 30, 30]);
  const o = PRESETS.obstacle.rules;
  assert.deepEqual([o.mapPct, o.sabotage], [100, false]);
  const p = PRESETS.precision.rules;
  assert.deepEqual([p.circleScale, p.missPenalty, p.mapPct, p.sabotage, p.laser], [0.75, true, 0, false, false]);
});

test('sanitizeRules: 선택지 밖 값은 무시, 옛 randomEvents false → eventPct 0', () => {
  assert.equal(sanitizeRules(DEFAULT_RULES, { mapPct: 42 }).mapPct, 35);
  assert.equal(sanitizeRules(DEFAULT_RULES, { mapPct: 80 }).mapPct, 80);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laserWidth: 99 }).laserWidth, 22);
  assert.equal(sanitizeRules(DEFAULT_RULES, { randomEvents: false } as never).eventPct, 0);
  assert.equal(sanitizeRules(DEFAULT_RULES, { randomEvents: true } as never).eventPct, 10);
});

test('toGameRules: 레이저 반폭 보통 99, 굵게 135, 얇게 67.5 · 확률은 0~1', () => {
  assert.equal(toGameRules(DEFAULT_RULES).laserHalf, 99);
  assert.equal(toGameRules({ ...DEFAULT_RULES, laserWidth: 30 }).laserHalf, 135);
  assert.equal(toGameRules({ ...DEFAULT_RULES, laserWidth: 15 }).laserHalf, 67.5);
  const G = toGameRules(DEFAULT_RULES);
  assert.deepEqual([G.mapChance, G.themeChance, G.eventChance], [0.35, 0.15, 0.1]);
});

test('makeCircle: 원 크기 작게면 색 원 반지름 0.75배, 아이템 원은 그대로', () => {
  const rand = () => 0.5;
  const big = makeCircle(1, 0, 0, [0], toGameRules(DEFAULT_RULES), rand);
  const small = makeCircle(1, 0, 0, [0], toGameRules({ ...DEFAULT_RULES, circleScale: 0.75 }), rand);
  assert.equal(small.r, big.r * 0.75);
  const item = makeCircle(1, 0, 0, [0], toGameRules({ ...DEFAULT_RULES, circleScale: 0.75 }), () => 0, { itemChance: 1 });
  assert.equal(item.kind, 'item');
  assert.equal(item.r, makeCircle(1, 0, 0, [0], toGameRules(DEFAULT_RULES), () => 0, { itemChance: 1 }).r);
});

test('랜덤 이벤트는 테마를 뽑지 않고, 테마는 따로: 2라운드부터·한 게임 최대 2번·확률', () => {
  const ps = [newPlayer('a', 'A', 0), newPlayer('b', 'B', 1)];
  ps[0].score = 100;
  for (let n = 0; n < 300; n++) assert.notEqual(rollEvent(ps, 0, Math.random, 1, { round: 2, usedIds: new Set() }), 'theme');
  const G = toGameRules({ ...DEFAULT_RULES, themePct: 30 });
  assert.equal(rollTheme(G, 0, 0, () => 0), null, '1라운드는 테마 없음');
  assert.ok(rollTheme(G, 1, 1, () => 0));
  assert.equal(rollTheme(G, 2, 2, () => 0), null, '한 게임 최대 2번');
  assert.equal(rollTheme(G, 2, 0, () => 0.31), null);
  assert.equal(rollTheme(toGameRules({ ...DEFAULT_RULES, themePct: 0 }), 2, 0, () => 0), null);
});
