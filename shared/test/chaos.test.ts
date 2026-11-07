import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, PRESETS, newPlayer, nextLaserIn, nextWaveIn, rollBossCount, rollEvent, sanitizeRules, toGameRules,
} from '../src/index.ts';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

test('카오스 프리셋만 chaos가 켜짐, 방해 아이템은 느긋하게만 꺼짐', () => {
  assert.equal(PRESETS.chaos.rules.chaos, true);
  for (const id of ['basic', 'party', 'hardcore', 'chill'] as const) assert.equal(PRESETS[id].rules.chaos, false, id);
  assert.equal(DEFAULT_RULES.sabotage, true);
  assert.equal(PRESETS.chill.rules.sabotage, false);
  assert.equal(sanitizeRules(DEFAULT_RULES, { chaos: true, sabotage: false }).chaos, true);
  assert.equal(toGameRules(PRESETS.chaos.rules).chaos, true);
});

test('카오스: 웨이브 간격 절반, 레이저는 2초마다 (35% 확률로 0.6초 뒤 겹침)', () => {
  assert.equal(nextWaveIn(() => 0, true), 6000);
  assert.equal(nextLaserIn(() => 0, true), 600);
  assert.equal(nextLaserIn(() => 0.5, true), 2000);
  assert.equal(nextWaveIn(() => 0), 12_000);
});

test('카오스: 보스 수 1마리 20 / 2마리 40 / 3마리 40', () => {
  assert.equal(rollBossCount(0, null, () => 0.19, true), 1);
  assert.equal(rollBossCount(0, null, () => 0.21, true), 2);
  assert.equal(rollBossCount(0, null, () => 0.61, true), 3);
});

test('랜덤 이벤트 확률을 바꿀 수 있다 (카오스 30%)', () => {
  const ps = [0, 1, 2, 3].map((i) => Object.assign(newPlayer(`p${i}`, `P${i}`, i as 0), { score: 10 * i }));
  assert.equal(rollEvent(ps, 0, seq(0.25, 0.5)), null);
  assert.notEqual(rollEvent(ps, 0, seq(0.25, 0.5), 0.3), null);
});
