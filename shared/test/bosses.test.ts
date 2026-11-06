import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, FIELD, RULES, bossState, circlePos, isOut, makeBoss, newPlayer, ragePenalty, rollBossCount, rollBossType,
  startRound, toGameRules, type Circle,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

test('보스 종류 비율: 일반 40 / 방어형 20 / 공격형 20 / 이동형 20', () => {
  assert.equal(rollBossType(() => 0.39), 'normal');
  assert.equal(rollBossType(() => 0.41), 'guard');
  assert.equal(rollBossType(() => 0.61), 'rage');
  assert.equal(rollBossType(() => 0.81), 'runner');
});

test('동시 등장 수: 1 (60%) / 2 (30%) / 3 (10%), 살아 있는 보스까지 합쳐 3마리 넘지 않음', () => {
  assert.equal(rollBossCount(0, null, () => 0.59), 1);
  assert.equal(rollBossCount(0, null, () => 0.6), 2);
  assert.equal(rollBossCount(0, null, () => 0.95), 3);
  assert.equal(rollBossCount(2, null, () => 0.95), 1);
  assert.equal(rollBossCount(3, null, () => 0.95), 0);
  // 보스 러시는 2~3마리
  assert.equal(rollBossCount(0, 'bossRush', () => 0), 2);
  assert.equal(rollBossCount(0, 'bossRush', () => 0.99), 3);
});

test('방어형: 3초마다 마지막 1초 동안 보호막', () => {
  const b = makeBoss(1, 0, 4, G, () => 0.3, 'guard');
  assert.equal(b.boss, 'guard');
  assert.equal(bossState(b, 1999).shielded, false);
  assert.equal(bossState(b, 2000).shielded, true);
  assert.equal(bossState(b, 2999).shielded, true);
  assert.equal(bossState(b, 3000).shielded, false);
  assert.equal(bossState(b, 2500).enraged, false);
});

test('공격형: 4초마다 마지막 1.5초 동안 붉어짐', () => {
  const b = makeBoss(1, 0, 4, G, () => 0.3, 'rage');
  assert.equal(bossState(b, 2499).enraged, false);
  assert.equal(bossState(b, 2500).enraged, true);
  assert.equal(bossState(b, 3999).enraged, true);
  assert.equal(bossState(b, 4000).enraged, false);
});

test('일반 보스는 보호막도 붉어짐도 없다', () => {
  const b = makeBoss(1, 0, 4, G, () => 0.3);
  assert.equal(b.boss, 'normal');
  for (const t of [0, 2500, 3500]) assert.deepEqual(bossState(b, t), { shielded: false, enraged: false });
});

test('붉을 때 때린 횟수만큼 감점이 커진다: −2, −4, −6, 라운드가 바뀌면 처음부터', () => {
  const p = newPlayer('a', 'A', 0);
  assert.deepEqual([ragePenalty(p), ragePenalty(p), ragePenalty(p)], [2, 4, 6]);
  startRound(p, 0, G);
  assert.equal(ragePenalty(p), 2);
});

test('이동형: 작고, 화면 안에서 튕기며, 8초 뒤에 나간다', () => {
  const b = makeBoss(1, 0, 4, G, () => 0, 'runner');
  assert.equal(b.r, RULES.boss.runnerR);
  assert.ok(b.speed > makeBoss(2, 0, 4, G, () => 0).speed);
  for (let t = 0; t < RULES.boss.lifeSec * 1000; t += 97) {
    const p = circlePos(b, t);
    assert.ok(p.x >= b.r - 1e-6 && p.x <= FIELD.w - b.r + 1e-6, `x=${p.x} t=${t}`);
    assert.ok(p.y >= b.r - 1e-6 && p.y <= FIELD.h - b.r + 1e-6, `y=${p.y} t=${t}`);
  }
  // 오른쪽(각도 0)으로 가다 벽에 닿으면 되돌아온다
  const tWall = ((FIELD.w / 2 - b.r) / b.speed) * 1000;
  assert.ok(circlePos(b, tWall + 300).x < circlePos(b, tWall).x);
  assert.equal(isOut(b, RULES.boss.lifeSec * 1000 - 1), false);
  assert.equal(isOut(b, RULES.boss.lifeSec * 1000), true);
});

test('이동형 체력은 일반의 60%', () => {
  const n = makeBoss(1, 0, 4, G, () => 0), r = makeBoss(2, 0, 4, G, () => 0, 'runner');
  assert.equal(r.maxHp, Math.ceil(n.maxHp! * 0.6));
});

test('보스 종류가 없는 옛 원 데이터는 일반 보스로 본다', () => {
  const old: Circle = { id: 1, kind: 'boss', angle: 0, speed: 100, r: 90, born: 0, hp: 5, maxHp: 5 };
  assert.deepEqual(bossState(old, 2500), { shielded: false, enraged: false });
});
