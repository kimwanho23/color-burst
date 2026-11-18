import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOP_BOSSES, RULES, homingAlpha, homingHits, homingRule, steerHoming } from '../src/index.ts';

test('유도탄 수치·스킬 목록', () => {
  const boss = COOP_BOSSES.core;
  assert.ok(boss.expertSkills[2]!.includes('homing') && boss.expertSkills[3]!.includes('homing'));
  assert.ok(!boss.expertSkills[1]?.includes('homing'));
  for (const ph of [1, 2, 3] as const) assert.ok(!boss.skills[ph].includes('homing'));
  const L = RULES.coop.levels;
  assert.deepEqual([L.easy.hurt.homing, L.normal.hurt.homing, L.hard.hurt.homing, L.expert.hurt.homing], [15, 20, 25, 30]);
  assert.deepEqual(RULES.coop.hurtFx.homing, { immuneMs: 1_000, stunMs: 0 });
  assert.equal(homingRule(2).speed, 300);
  assert.equal(homingRule(3).speed, 340);
  assert.ok(Math.abs(homingRule(3).turnRad - (160 * Math.PI) / 180) < 1e-9);
});

test('선회 상한: 뒤쪽 목표여도 한 번에 turnRad×dt만큼만 돈다', () => {
  const s = steerHoming({ x: 0, y: 0, angle: 0 }, { x: -100, y: 1 }, 300, Math.PI, 100);
  assert.ok(Math.abs(Math.abs(s.angle) - Math.PI / 10) < 1e-9);
  assert.ok(Math.abs(Math.hypot(s.x, s.y) - 30) < 1e-9);
});

test('선회 상한 안이면 목표를 정확히 향한다', () => {
  const s = steerHoming({ x: 0, y: 0, angle: 0 }, { x: 100, y: 10 }, 300, Math.PI, 1000);
  assert.ok(Math.abs(s.angle - Math.atan2(10, 100)) < 1e-9);
});

test('목표 없으면 직진, 각도 경계(±π)를 짧은 쪽으로 돈다', () => {
  assert.deepEqual(steerHoming({ x: 0, y: 0, angle: 0 }, null, 100, 1, 1000), { x: 100, y: 0, angle: 0 });
  const s = steerHoming({ x: 0, y: 0, angle: Math.PI - 0.05 }, { x: -100, y: -10 }, 0, 1, 1000);
  assert.ok(Math.cos(s.angle) < -0.99);
});

test('선분 판정: 틱 사이에 건너뛴 커서도 맞는다', () => {
  assert.ok(homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 15 }, 16));
  assert.ok(!homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 17 }, 16));
  assert.ok(!homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 130, y: 0 }, 16));
});

test('흐려짐: 수명 전 1, 수명 + fadeMs에 0', () => {
  const s = { id: 1, target: 'a', x: 0, y: 0, angle: 0, born: 1000 };
  const H = RULES.coop.homing;
  assert.equal(homingAlpha(s, 1000 + H.lifeMs - 1), 1);
  assert.equal(homingAlpha(s, 1000 + H.lifeMs + H.fadeMs), 0);
});
