import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, ITEMS, PRESETS, applyItem, buffOn, circlePos, holdCircles, isMine, makeCircle, newPlayer, rollItem,
  sanitizeRules, toGameRules, type Circle, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const two = (): [PlayerState, PlayerState] => [newPlayer('a', 'A', 0), newPlayer('b', 'B', 1)];

test('circlePos: 멈춘 구간만큼 이동이 늦어진다', () => {
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 100, r: 40, born: 0, holds: [[1000, 1500]] };
  const plain: Circle = { ...c, holds: undefined };
  assert.equal(circlePos(c, 1000).x, circlePos(c, 2500).x);
  assert.equal(circlePos(c, 3500).x, circlePos(plain, 2000).x);
  assert.equal(circlePos(c, 500).x, circlePos(plain, 500).x);
});

test('holdCircles: 모든 원에 같은 정지 구간을 붙이고 id를 돌려준다', () => {
  const cs: Circle[] = [{ id: 3, kind: 'y', angle: 0, speed: 100, r: 40, born: 0 }, { id: 4, kind: 'boss', angle: 1, speed: 50, r: 90, born: 0 }];
  assert.deepEqual(holdCircles(cs, 2000, 1500), [3, 4]);
  assert.deepEqual(cs[1].holds, [[2000, 1500]]);
});

test('holdCircles: 정지 중에 또 정지하면 이어 붙여 뒤로 가지 않는다', () => {
  const c: Circle = { id: 1, kind: 0, angle: 0, speed: 1000, r: 40, born: -1000 };
  holdCircles([c], 0, 1500);
  holdCircles([c], 500, 1500);
  const xs = [0, 500, 1000, 1500, 2000].map((t) => circlePos(c, t).x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], `t=${i * 500} 뒤로 감: ${xs}`);
  // 두 번째 정지가 끝나는 2000부터 다시 움직인다
  assert.equal(circlePos(c, 2000).x, circlePos(c, 0).x);
  assert.ok(circlePos(c, 2100).x > circlePos(c, 2000).x);
});

test('makeCircle: 아이템 확률 1이면 아이템 원', () => {
  const c = makeCircle(1, 0, 0, [0, 1], G, Math.random, { itemChance: 1 });
  assert.equal(c.kind, 'item');
  assert.equal(c.r, 34);
  assert.ok(c.itemTier === 0 || c.itemTier === 1 || c.itemTier === 2);
});

test('isMine: 아이템 원은 내 원이 아니다', () => {
  assert.equal(isMine('item', 0), false);
});

test('아이템 20종: 일반 16종 7 / 7 / 2 + 방해 4종 2 / 1 / 1', () => {
  const count = (sab: boolean) => [0, 1, 2].map((t) => Object.values(ITEMS).filter((i) => i.tier === t && !!i.sabotage === sab).length);
  assert.deepEqual(count(false), [7, 7, 2]);
  assert.deepEqual(count(true), [2, 1, 1]);
});

test('rollItem: 빈 곳 페널티가 꺼진 방에서는 헛클릭 무효가 안 나온다', () => {
  const off = toGameRules({ ...DEFAULT_RULES, missPenalty: false });
  for (let i = 0; i < 50; i++) assert.notEqual(rollItem(0, off, () => i / 50), 'missGuard');
  assert.ok(Array.from({ length: 50 }, (_, i) => rollItem(0, G, () => i / 50)).includes('missGuard'));
});

test('applyItem 버프: 꼴찌 보정이 켜진 방의 꼴찌는 시간 ×1.5', () => {
  const [a, b] = two();
  applyItem(a, 'double', 100, G, [a, b]);
  assert.equal(buffOn(a, 'double', 100), true);
  assert.equal(a.buffs.double, 5100);
  const Gc = toGameRules({ ...DEFAULT_RULES, comeback: true });
  const [c, d] = two();
  d.score = 10;
  applyItem(c, 'double', 100, Gc, [c, d]);
  assert.equal(c.buffs.double, 7600);
});

test('applyItem 표적 해제: 표적 자처가 있으면 그대로', () => {
  const [a, b] = two();
  a.markedUntil = 9000;
  applyItem(a, 'markClear', 100, G, [a, b]);
  assert.equal(a.markedUntil, 100);
  a.markedUntil = 9000; a.picks = [{ id: 'selfTarget', tier: 0 }];
  applyItem(a, 'markClear', 100, G, [a, b]);
  assert.equal(a.markedUntil, 9000);
});

test('applyItem 즉시 피버: 피버 시작, 피버 중이면 +3초', () => {
  const [a, b] = two();
  applyItem(a, 'instantFever', 100, G, [a, b]);
  assert.equal(a.feverUntil, 100 + 7000);
  applyItem(a, 'instantFever', 200, G, [a, b]);
  assert.equal(a.feverUntil, 100 + 7000 + 3000);
});

test('applyItem 피버 충전·황금 손', () => {
  const [a, b] = two();
  a.fever = 20;
  applyItem(a, 'feverCharge', 100, G, [a, b]);
  assert.equal(a.fever, 70);
  applyItem(a, 'goldHand', 100, G, [a, b]);
  assert.equal(a.goldLeft, 5);
});

test('applyItem 방 단위 효과는 종류를 돌려준다', () => {
  const [a, b] = two();
  assert.deepEqual(applyItem(a, 'bomb', 100, G, [a, b]), { kind: 'bomb' });
  assert.deepEqual(applyItem(a, 'fieldClear', 100, G, [a, b]), { kind: 'fieldClear' });
  assert.equal(applyItem(a, 'magnet', 100, G, [a, b]), null);
});

test('방 규칙 items·randomEvents', () => {
  assert.equal(DEFAULT_RULES.items, true);
  assert.equal(DEFAULT_RULES.randomEvents, true);
  assert.equal(sanitizeRules(DEFAULT_RULES, { items: false }).items, false);
  assert.equal(PRESETS.hardcore.rules.items, false);
});
