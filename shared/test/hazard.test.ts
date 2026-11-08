import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, LEGEND, RULES, applyItem, hazardStun, newPlayer, toGameRules, type AbilityId, type Tier } from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const pl = (id: string, ...picks: [AbilityId, Tier][]) => { const p = newPlayer(id, id, 0); p.picks = picks.map(([x, tier]) => ({ id: x, tier })); return p; };

test('hazardStun: 기본은 baseMs, 방해 내성 40%면 60%, 100%면 0, 철벽 0, 무적 중 0', () => {
  const now = 100_000;
  const a = pl('a');
  assert.equal(hazardStun(a, now, 1000, G, [a]), 1000);
  assert.equal(a.stunUntil, now + 1000);
  assert.equal(hazardStun(a, now + 1500, 1000, G, [a]), 0, '스턴이 끝나고 1초 안은 무적');
  assert.equal(hazardStun(a, now + 2000, 1000, G, [a]), 1000);
  const b = pl('b', ['laserProof', 1]); // 40%
  assert.equal(hazardStun(b, now, 1000, G, [b]), 600);
  const c = pl('c', ['laserProof', 3]); // 100%
  assert.equal(hazardStun(c, now, 1000, G, [c]), 0);
  assert.equal(c.stunUntil, 0);
  const d = pl('d', ['fortress', 0]);
  assert.equal(hazardStun(d, now, 1000, G, [d]), 0);
});

test('hazardStun: 피버 중이면 남은 피버 시간 절반(여운도), 방해 내성 레전드면 게이지 +20', () => {
  const now = 100_000;
  const a = pl('a');
  a.feverUntil = now + 6000; a.afterUntil = now + 8000;
  hazardStun(a, now, 1000, G, [a]);
  assert.deepEqual([a.feverUntil, a.afterUntil], [now + 3000, now + 5000]);
  const b = pl('b', ['laserProof', 3]);
  b.fever = 10;
  hazardStun(b, now, 1000, G, [b]);
  assert.equal(b.fever, 10 + LEGEND.laserFever);
});

test('방해 아이템: 감도 감소·반대 3초, 시야 방해 5초, 방해 내성 60%면 40%, 1등 저격은 내성과 무관', () => {
  const now = 0;
  const giver = pl('g'), plain = pl('p'), proof = pl('r', ['laserProof', 2]); // 60%
  giver.color = 0; plain.color = 1; proof.color = 2;
  const ps = [giver, plain, proof];
  applyItem(giver, 'slowCursor', now, G, ps);
  applyItem(giver, 'invertCursor', now, G, ps);
  applyItem(giver, 'blind', now, G, ps, () => 0);
  assert.deepEqual([plain.debuffs.slow, plain.debuffs.invert, plain.debuffs.blind], [RULES.sabotage.slowMs, RULES.sabotage.invertMs, RULES.sabotage.blindMs]);
  assert.deepEqual([proof.debuffs.slow, proof.debuffs.blind], [1200, 2000]);
  // 1등 저격: 방해 내성이 있어도 그대로
  proof.score = 1000;
  applyItem(giver, 'snipe', now, G, ps);
  assert.equal(proof.stunUntil, RULES.sabotage.snipeStunMs);
});
