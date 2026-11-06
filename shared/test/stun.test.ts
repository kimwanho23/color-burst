import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, PRESETS, isStunned, newPlayer, sanitizeRules, shiftTimes, startRound, toGameRules } from '../src/index.ts';

test('isStunned: until 직전까지', () => {
  const p = newPlayer('a', 'A', 0);
  p.stunUntil = 1000;
  assert.equal(isStunned(p, 999), true);
  assert.equal(isStunned(p, 1000), false);
});

test('일시정지가 풀리면 스턴 남은 시간도 밀린다', () => {
  const p = newPlayer('a', 'A', 0);
  p.stunUntil = 1500;
  shiftTimes(p, 1000, 2000);
  assert.equal(p.stunUntil, 3500);
});

test('라운드가 바뀌면 스턴이 풀린다', () => {
  const p = newPlayer('a', 'A', 0);
  p.stunUntil = 99_999;
  startRound(p, 0, toGameRules(DEFAULT_RULES));
  assert.equal(p.stunUntil, 0);
});

test('방 규칙 레이저: 기본 켜짐, 느긋하게 꺼짐', () => {
  assert.equal(DEFAULT_RULES.laser, true);
  assert.equal(PRESETS.chill.rules.laser, false);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laser: false }).laser, false);
  assert.equal(toGameRules(DEFAULT_RULES).laser, true);
});
