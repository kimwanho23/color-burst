import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, ITEMS, RULES, addDebuff, applyItem, debuffOn, newPlayer, rollItem, shiftTimes, snipeTarget, startRound,
  toGameRules, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const four = (...scores: number[]): PlayerState[] =>
  scores.map((s, i) => Object.assign(newPlayer(`p${i}`, `P${i}`, i as 0 | 1 | 2 | 3), { score: s }));

test('감도 감소: 잡은 사람 뺀 모두 5초, 다시 맞으면 10초까지', () => {
  const ps = four(10, 20, 30, 40);
  applyItem(ps[0], 'slowCursor', 100, G, ps);
  assert.equal(ps[0].debuffs.slow, undefined);
  assert.deepEqual(ps.slice(1).map((p) => p.debuffs.slow), [5100, 5100, 5100]);
  applyItem(ps[0], 'slowCursor', 200, G, ps);
  assert.equal(ps[1].debuffs.slow, 10_100);
  assert.equal(debuffOn(ps[1], 'slow', 10_099), true);
  assert.equal(debuffOn(ps[1], 'slow', 10_100), false);
});

test('마우스 반대·시야 방해도 잡은 사람 뺀 모두, 시야 방해 종류는 넷 중 하나', () => {
  const ps = four(10, 20, 30, 40);
  applyItem(ps[2], 'invertCursor', 0, G, ps);
  assert.deepEqual(ps.map((p) => p.debuffs.invert ?? 0), [5000, 5000, 0, 5000]);
  applyItem(ps[2], 'blind', 0, G, ps, () => 0.6);
  assert.equal(ps[2].blind, null);
  for (const p of [ps[0], ps[1], ps[3]]) {
    assert.ok(['ink', 'half', 'doodle', 'lens'].includes(p.blind!.kind));
    assert.equal(p.debuffs.blind, 5000);
  }
});

test('addDebuff: 남은 시간에 더하되 2배까지 (버프와 같은 규칙)', () => {
  const [p] = four(0);
  addDebuff(p, 'slow', 5000, 0);
  addDebuff(p, 'slow', 5000, 1000);
  addDebuff(p, 'slow', 5000, 2000);
  assert.equal(p.debuffs.slow, 12_000);
});

test('방해 시간도 일시정지가 풀리면 밀리고, 라운드가 바뀌면 사라진다', () => {
  const [p] = four(0);
  p.debuffs.slow = 5000; p.blind = { kind: 'ink', seed: 1 }; p.debuffs.blind = 5000;
  shiftTimes(p, 1000, 2000);
  assert.equal(p.debuffs.slow, 7000);
  startRound(p, 0, G);
  assert.deepEqual([p.debuffs, p.blind], [{}, null]);
});

test('snipeTarget: 1등, 잡은 사람이 1등이면 2등, 혼자면 없음, 동점은 앞 순번', () => {
  const ps = four(10, 50, 30, 20);
  assert.equal(snipeTarget(ps[0], ps)?.id, 'p1');
  assert.equal(snipeTarget(ps[1], ps)?.id, 'p2');
  assert.equal(snipeTarget(ps[0], [ps[0]]), null);
  const tie = four(40, 40, 10);
  assert.equal(snipeTarget(tie[2], tie)?.id, 'p0');
});

test('1등 저격: 대상 3초 스턴 + 콤보 끊김, 점수는 그대로', () => {
  const ps = four(10, 50, 30, 20);
  ps[1].combo = 9;
  const act = applyItem(ps[0], 'snipe', 100, G, ps);
  assert.deepEqual(act, { kind: 'snipe', target: 'p1' });
  assert.deepEqual([ps[1].stunUntil, ps[1].combo, ps[1].score], [100 + RULES.sabotage.snipeStunMs, 0, 50]);
  assert.deepEqual(applyItem(ps[0], 'snipe', 100, G, [ps[0]]), { kind: 'snipe', target: null });
});

test('방해 아이템 4종: 등급 흔함 2 / 희귀 1 / 전설 1', () => {
  assert.deepEqual(['slowCursor', 'invertCursor', 'blind', 'snipe'].map((id) => ITEMS[id as 'blind'].tier), [0, 0, 1, 2]);
  assert.ok(['slowCursor', 'invertCursor', 'blind', 'snipe'].every((id) => ITEMS[id as 'blind'].sabotage));
});

test('방해 아이템을 끈 방에서는 절대 안 나오고, 켠 방에서는 나온다', () => {
  const off = toGameRules({ ...DEFAULT_RULES, sabotage: false });
  const rolls = (g: typeof G) => [0, 1, 2].flatMap((t) => Array.from({ length: 60 }, (_, i) => rollItem(t as 0, g, () => i / 60)));
  assert.ok(rolls(off).every((id) => !ITEMS[id].sabotage));
  const on = rolls(G);
  for (const id of ['slowCursor', 'invertCursor', 'blind', 'snipe']) assert.ok(on.includes(id as 'blind'), id);
});
