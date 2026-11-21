import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RULES, RULE_CHOICES, nextLaserIn, sanitizeRules, toGameRules } from '../src/index.ts';
import { rulePanel } from '../../client/src/lobbyUI.ts';

test('레이저 빈도: 기본 보통, 고를 수 있는 값은 드물게·보통·자주, 이상한 값은 무시', () => {
  assert.equal(DEFAULT_RULES.laserFreq, 1);
  assert.deepEqual([...RULE_CHOICES.laserFreq], [0.5, 1, 2]);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laserFreq: 2 }).laserFreq, 2);
  assert.equal(sanitizeRules(DEFAULT_RULES, { laserFreq: 7 }).laserFreq, 1);
  assert.equal(toGameRules({ ...DEFAULT_RULES, laserFreq: 0.5 }).laserFreq, 0.5);
});

test('레이저 빈도: 간격이 빈도에 반비례', () => {
  const mid = () => 0.5;
  const base = RULES.laser.everyMin + 0.5 * (RULES.laser.everyMax - RULES.laser.everyMin);
  assert.equal(nextLaserIn(mid, false, 1), base);
  assert.equal(nextLaserIn(mid, false, 2), base / 2);
  assert.equal(nextLaserIn(mid, false, 0.5), base * 2);
});

test('레이저 빈도: 카오스에도 적용, 겹쳐 나오는 0.6초는 그대로', () => {
  assert.equal(nextLaserIn(() => 0.9, true, 1), RULES.chaos.laserEveryMs);
  assert.equal(nextLaserIn(() => 0.9, true, 2), RULES.chaos.laserEveryMs / 2);
  assert.equal(nextLaserIn(() => 0.9, true, 0.5), RULES.chaos.laserEveryMs * 2);
  assert.equal(nextLaserIn(() => 0, true, 2), RULES.chaos.laserQuickMs);
});

test('레이저 빈도: 대기실 규칙 패널의 레이저 타일 배지에 빈도 표시 (카오스도)', () => {
  const badge = (r: typeof DEFAULT_RULES) => rulePanel(r).groups.flatMap((g) => g.tiles).find((x) => x.id === 'laser')!.badge;
  assert.equal(badge(DEFAULT_RULES), '보통');
  assert.equal(badge({ ...DEFAULT_RULES, laserFreq: 2 }), '자주');
  assert.equal(badge({ ...DEFAULT_RULES, chaos: true, laserFreq: 0.5 }), '카오스 · 드물게');
  assert.equal(badge({ ...DEFAULT_RULES, laser: false }), undefined);
});
