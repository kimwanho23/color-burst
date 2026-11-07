import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY, DEFAULT_RULES, applyEvent, bossHitInfo, comboProgress, combosCompletedBy, combosOf, feverMultOf, magnetOf, newPlayer,
  resolveClaim, resolveMiss, rollEvent, rollOptions, startRound, toGameRules, type AbilityId, type EventId, type Pick,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const picks = (...ids: AbilityId[]): Pick[] => ids.map((id) => ({ id, tier: 0 }));
const pl = (color: 0 | 1, ...ids: AbilityId[]) => { const p = newPlayer(`p${color}`, 'P', color); p.picks = picks(...ids); return p; };

test('combosOf: 모두 가져야 완성, 여러 번 골라도 한 번, 진행도는 가진 것만', () => {
  assert.deepEqual([...combosOf(picks('preheat', 'overtime'))], []);
  assert.deepEqual([...combosOf(picks('preheat', 'overtime', 'frenzy', 'frenzy'))], ['feverMaster']);
  assert.deepEqual(comboProgress(picks('preheat', 'jackpot')).map((c) => [c.id, c.have, c.need]), [['feverMaster', 1, 3], ['lucky', 1, 2]]);
  assert.deepEqual(combosCompletedBy(picks('jackpot'), { id: 'rainbowHunt', tier: 1 }).map((c) => c.id), ['lucky']);
});

test('조합 효과: 피버 마스터·콤보 머신·보스 헌터·견제왕·미식가', () => {
  const f = pl(0, 'preheat', 'overtime', 'frenzy');
  assert.equal(feverMultOf(f, G), G.feverMult + 0.5 + 1);
  const c = pl(0, 'comboArtist', 'insurance');
  c.combo = 8; // 주기 9
  assert.equal(resolveClaim(c, 0, [c], 100, G).gained, 3 + 5 + 5);
  assert.equal(bossHitInfo(pl(0, 'hammer', 'hunter', 'crusher'), () => 0.99).damage, 2); // 기본 1 + 파쇄 0.5(이번엔 안 터짐) + 조합 1
  const s = pl(0, 'plunder', 'counterPro', 'thickSkin'), o = newPlayer('o', 'O', 1);
  assert.equal(resolveClaim(s, 1, [s, o], 100, G).gained, 1 + 2);
  const g = pl(0, 'picky', 'yellowTaste');
  assert.equal(resolveClaim(g, 'y', [g], 100, G).gained, 2 + 1);
});

test('행운아: 잭팟 확률 +10 / 변두리: 가장자리 커서면 자석 ×1.5', () => {
  const l = pl(0, 'jackpot', 'rainbowHunt'); // 잭팟 5% + 10%
  assert.ok(resolveClaim(l, 0, [l], 100, G, { rand: () => 0.12 }).jackpot > 1);
  const n = pl(0, 'jackpot');
  assert.equal(resolveClaim(n, 0, [n], 100, G, { rand: () => 0.12 }).jackpot, 1);
  const m = pl(0, 'edge', 'magnet');
  assert.equal(magnetOf(m, 0, { x: 800, y: 450 }), 60);
  assert.equal(magnetOf(m, 0, { x: 30, y: 450 }), 90);
});

test('철옹성: 라운드마다 한 번만 콤보 끊김을 막고, 기세로 이미 안 끊기면 안 씀', () => {
  const p = pl(0, 'shield', 'insurance', 'rebound');
  startRound(p, 0, G);
  p.combo = 5;
  resolveMiss(p, 100, G, [p]);
  assert.deepEqual([p.combo, p.ironLeft], [5, 0]);
  resolveMiss(p, 200, G, [p]);
  assert.equal(p.combo, 1); // 보험 20%
  const q = pl(0, 'shield', 'insurance', 'rebound', 'momentum');
  startRound(q, 0, G);
  q.combo = 5;
  resolveMiss(q, 100, G, [q]);
  assert.deepEqual([q.combo, q.ironLeft], [5, 1]);
});

test('빌드 가중치: 같은 분류가 더 자주, 다른 분류도 나오고 3장은 서로 다름', () => {
  const owned = picks('preheat', 'overtime');
  let fever = 0, other = 0;
  for (let n = 0; n < 1000; n++) {
    const opts = rollOptions(1, false, Math.random, { owned });
    assert.equal(new Set(opts.map((o) => o.id)).size, opts.length);
    for (const o of opts) { if (ABILITY[o.id].cat === '피버') fever++; else if (!ABILITY[o.id].curse) other++; }
  }
  const share = fever / (fever + other), even = 6 / 34;
  assert.ok(share > even * 1.5, `피버 비율 ${share.toFixed(3)}`);
  assert.ok(other > 0);
});

test('대평등: 평균 쪽으로 절반, 음수도', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  a.score = 1000; b.score = 200;
  applyEvent('equality', [a, b], G);
  assert.deepEqual([a.score, b.score], [800, 400]);
  const c = newPlayer('c', 'C', 0), d = newPlayer('d', 'D', 1), e = newPlayer('e', 'E', 2);
  c.score = 100; d.score = -50; e.score = 10;
  applyEvent('equality', [c, d, e], G);
  assert.deepEqual([c.score, d.score, e.score], [60, -15, 15]); // 평균 20
});

test('대평등은 3라운드가 끝난 뒤부터, 한 게임 한 번', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  a.score = 1000; b.score = 200;
  const roll = (round: number, used: EventId[]) => {
    const seen = new Set<EventId>();
    for (let n = 0; n < 400; n++) { const id = rollEvent([a, b], 0, Math.random, 1, { round, usedIds: new Set(used) }); if (id) seen.add(id); }
    return seen.has('equality');
  };
  assert.equal(roll(2, []), false);
  assert.equal(roll(3, []), true);
  assert.equal(roll(4, ['equality']), false);
  assert.equal(rollEvent([a, b], 0, () => 0.5, 1) === 'equality', false, '라운드 정보가 없으면 안 나옴');
});
