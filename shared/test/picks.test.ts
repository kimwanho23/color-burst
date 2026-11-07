import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIALS, isCurse, isSpecial, judgeComeback, rollOptions } from '../src/index.ts';

const ps = (...scores: number[]) => scores.map((score, i) => ({ id: `p${i}`, score }));

test('judgeComeback: 꼴찌 < 1등 × 0.6, 동점 꼴찌는 모두, 모두 동점·1등 0점 이하면 없음', () => {
  assert.deepEqual([...judgeComeback(ps(1000, 500, 900))], ['p1']);
  assert.deepEqual([...judgeComeback(ps(1000, 600))], []);
  assert.deepEqual([...judgeComeback(ps(100, 50, 50))].sort(), ['p1', 'p2']);
  assert.deepEqual([...judgeComeback(ps(0, 0))], []);
  assert.deepEqual([...judgeComeback(ps(-5, -10))], []);
});

const plain = (o: { id: Parameters<typeof isCurse>[0] }) => !isCurse(o.id) && !isSpecial(o.id);

test('rollOptions: 노말 제외면 노말 등급이 안 나옴', () => {
  for (let n = 0; n < 300; n++) {
    for (const o of rollOptions(1, false, Math.random, { minTier: 1 })) if (plain(o)) assert.ok(o.tier >= 1);
  }
});

test('rollOptions: 꼴찌 보장 등급 이상이 1장 이상', () => {
  for (let n = 0; n < 300; n++) {
    const opts = rollOptions(0, true, Math.random, { guarantee: 3 });
    assert.ok(opts.some((o) => plain(o) && o.tier === 3), JSON.stringify(opts));
  }
});

test('rollOptions: 역전 꼴찌 3번째 선택 — 특별 1장, 저주와 다른 자리, 선물이면 4장 중 1장', () => {
  for (let n = 0; n < 200; n++) {
    const opts = rollOptions(2, true, Math.random, { special: true, forceCurse: true });
    assert.equal(opts.filter((o) => isSpecial(o.id)).length, 1);
    assert.equal(opts.filter((o) => isCurse(o.id)).length, 1);
    const four = rollOptions(2, true, Math.random, { special: true }, 4);
    assert.equal(four.length, 4);
    assert.equal(four.filter((o) => isSpecial(o.id)).length, 1);
  }
});

test('특별 카드 12장은 모두 분류 특별, 평소 선택지에는 안 나옴', () => {
  assert.equal(SPECIALS.length, 12);
  assert.ok(SPECIALS.every((s) => s.cat === '특별' && s.special));
  for (let n = 0; n < 500; n++) assert.ok(!rollOptions(3, true, Math.random).some((o) => isSpecial(o.id)));
});
