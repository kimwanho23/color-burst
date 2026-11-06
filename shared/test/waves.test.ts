import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, PRESETS, RULES, WAVE_PATTERNS, makeWave, nextWaveIn, sanitizeRules, toGameRules } from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const kinds = [0, 1, 2, 3] as const;
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('부채꼴: 5개, 같은 시각·같은 속도, 가운데 방향 ±30° 안', () => {
  const w = makeWave('fan', 100, 1000, 5000, [...kinds], G, () => 0.5);
  assert.equal(w.length, RULES.waves.fanCount);
  const mid = w[2].angle;
  for (const c of w) {
    assert.equal(c.born, 1000);
    assert.equal(c.speed, w[0].speed);
    assert.ok(angleDiff(c.angle, mid) <= (30 * Math.PI) / 180 + 1e-9);
  }
  assert.ok(angleDiff(w[0].angle, w[4].angle) > 0.9);
});

test('동시 다발: 8개, 같은 간격으로 사방', () => {
  const w = makeWave('burst', 1, 0, 0, [...kinds], G, Math.random);
  assert.equal(w.length, RULES.waves.burstCount);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(angleDiff(w[i].angle, w[i - 1].angle) - Math.PI / 4) < 1e-9);
  assert.ok(w.every((c) => c.born === 0));
});

test('나선: 0.1초 간격으로 45°씩 돌며 발사', () => {
  const w = makeWave('spiral', 1, 2000, 0, [...kinds], G, Math.random);
  assert.equal(w.length, RULES.waves.spiralCount);
  w.forEach((c, i) => assert.equal(c.born, 2000 + i * RULES.waves.spiralGapMs));
  assert.ok(Math.abs(angleDiff(w[1].angle, w[0].angle) - Math.PI / 4) < 1e-9);
});

test('웨이브에는 아이템 원이 없고 id가 이어진다', () => {
  const w = makeWave('burst', 50, 0, 0, [...kinds], G, () => 0, { itemChance: 1 });
  assert.ok(w.every((c) => c.kind !== 'item'));
  assert.deepEqual(w.map((c) => c.id), [50, 51, 52, 53, 54, 55, 56, 57]);
});

test('웨이브도 색 고정(전원 같은 색·내 색 비)을 따른다', () => {
  const w = makeWave('fan', 1, 0, 0, [...kinds], G, Math.random, { forceKind: 'y' });
  assert.ok(w.every((c) => c.kind === 'y'));
});

test('다음 웨이브까지 12~18초', () => {
  assert.equal(nextWaveIn(() => 0), 12000);
  assert.equal(nextWaveIn(() => 0.999999), 17999.994);
});

test('방 규칙 waves: 기본 켜짐, 끌 수 있음', () => {
  assert.equal(DEFAULT_RULES.waves, true);
  assert.equal(sanitizeRules(DEFAULT_RULES, { waves: false }).waves, false);
  assert.equal(PRESETS.basic.rules.waves, true);
});

test('이중 링: 8개 + 0.3초 뒤 엇갈린 8개', () => {
  const w = makeWave('ring2', 1, 1000, 0, [...kinds], G, () => 0);
  assert.equal(w.length, 16);
  assert.ok(w.slice(0, 8).every((c) => c.born === 1000));
  assert.ok(w.slice(8).every((c) => c.born === 1000 + RULES.waves.ring2GapMs));
  assert.ok(Math.abs(angleDiff(w[8].angle, w[0].angle) - Math.PI / 8) < 1e-9);
});

test('쌍나선: 두 갈래가 정반대에서 같은 시각에, 0.1초마다 45°씩', () => {
  const w = makeWave('twin', 1, 0, 0, [...kinds], G, () => 0);
  assert.equal(w.length, RULES.waves.twinCount * 2);
  const [a0, b0, a1] = [w[0], w[1], w[2]];
  assert.equal(a0.born, b0.born);
  assert.ok(Math.abs(angleDiff(a0.angle, b0.angle) - Math.PI) < 1e-9);
  assert.equal(a1.born - a0.born, RULES.waves.spiralGapMs);
  assert.ok(Math.abs(angleDiff(a1.angle, a0.angle) - Math.PI / 4) < 1e-9);
});

test('연속 사출: 한 방향으로 0.12초 간격 6개', () => {
  const w = makeWave('stream', 1, 0, 0, [...kinds], G, () => 0.25);
  assert.equal(w.length, RULES.waves.streamCount);
  assert.ok(w.every((c) => c.angle === w[0].angle));
  w.forEach((c, i) => assert.equal(c.born, i * RULES.waves.streamGapMs));
});

test('쓸기: 방향이 한쪽(−60°)에서 반대쪽(+60°)으로 쓸며 8개', () => {
  const w = makeWave('sweep', 1, 0, 0, [...kinds], G, () => 0.5);
  assert.equal(w.length, RULES.waves.sweepCount);
  const span = angleDiff(w[0].angle, w[w.length - 1].angle);
  assert.ok(Math.abs(span - (2 * RULES.waves.sweepDeg * Math.PI) / 180) < 1e-9);
  w.forEach((c, i) => assert.equal(c.born, i * RULES.waves.sweepGapMs));
});

test('패턴은 7가지', () => {
  assert.deepEqual([...WAVE_PATTERNS].sort(), ['burst', 'fan', 'ring2', 'spiral', 'stream', 'sweep', 'twin']);
});
