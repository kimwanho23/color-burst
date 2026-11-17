import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RULES, RULE_CHOICES, nextLaserIn, sanitizeRules, toGameRules } from '../src/index.ts';
import { rulesChips } from '../../client/src/lobbyUI.ts';

test('레이저 빈도: 기본 보통, 고를 수 있는 값은 드물게·보통·자주, 이상한 값은 무시', () => {
  assert.equal(DEFAULT_RULES.laserFreq, 1);
  assert.deepEqual([...RULE_CHOICES.laserFreq], [0.5, 1, 2]);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laserFreq: 2 }).laserFreq, 2);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laserFreq: 7 }).laserFreq, 1);
  assert.equal(toGameRules({ ...DEFAULT_RULES, laserFreq: 0.5 }).laserFreq, 0.5);
});

test('레이저 빈도: 간격이 빈도에 반비례 (카오스는 그대로)', () => {
  const mid = () => 0.5;
  const base = RULES.laser.everyMin + 0.5 * (RULES.laser.everyMax - RULES.laser.everyMin);
  assert.equal(nextLaserIn(mid, false, 1), base);
  assert.equal(nextLaserIn(mid, false, 2), base / 2);
  assert.equal(nextLaserIn(mid, false, 0.5), base * 2);
  assert.equal(nextLaserIn(() => 0.9, true, 2), RULES.chaos.laserEveryMs);
});

test('레이저 빈도: 대기실 규칙 칩에 빈도 표시', () => {
  const texts = (r: typeof DEFAULT_RULES) => rulesChips(r).map((c) => c.text);
  assert.ok(texts(DEFAULT_RULES).includes('레이저 · 보통'));
  assert.ok(texts({ ...DEFAULT_RULES, laserFreq: 2 }).includes('레이저 · 자주'));
});
