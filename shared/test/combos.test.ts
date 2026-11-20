import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBO, COMBOS, SYN, WEIGHT, buildWeight,
  ABILITY, DEFAULT_RULES, applyEvent, bossHitInfo, comboProgress, combosCompletedBy, combosOf, feverMultOf, magnetOf, newPlayer,
  resolveClaim, resolveMiss, rollEvent, rollOptions, startRound, toGameRules, type AbilityId, type ComboId, type EventId, type Pick,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const picks = (...ids: AbilityId[]): Pick[] => ids.map((id) => ({ id, tier: 0 }));
const pl = (color: 0 | 1, ...ids: AbilityId[]) => { const p = newPlayer(`p${color}`, 'P', color); p.picks = picks(...ids); return p; };

test('combosOf: 모두 가져야 완성, 여러 번 골라도 한 번, 진행도는 가진 것만', () => {
  assert.deepEqual([...combosOf(picks('preheat', 'overtime'))], []);
  assert.deepEqual([...combosOf(picks('preheat', 'overtime', 'frenzy', 'frenzy'))], ['feverMaster']);
  // 많이 모은 순: 행운아 1/2가 피버 마스터 1/3보다 먼저
  assert.deepEqual(comboProgress(picks('preheat', 'jackpot')).map((c) => [c.id, c.have, c.need]), [['lucky', 1, 2], ['feverMaster', 1, 3], ['gambit', 1, 3]]);
  // 완성한 조합이 맨 앞
  assert.equal(comboProgress(picks('jackpot', 'picky', 'preheat', 'overtime', 'frenzy')).map((c) => c.id)[0], 'feverMaster');
  assert.deepEqual(combosCompletedBy(picks('jackpot'), { id: 'rainbowHunt', tier: 1 }).map((c) => c.id), ['lucky']);
});

test('조합 효과: 피버 마스터·콤보 머신·보스 헌터·견제왕·미식가', () => {
  const f = pl(0, 'preheat', 'overtime', 'frenzy');
  assert.equal(feverMultOf(f, G), G.feverMult + 0.5 + 1);
  const c = pl(0, 'comboArtist', 'insurance');
  c.combo = 8; // 주기 9
  assert.equal(resolveClaim(c, 0, [c], 100, G).gained, 11, '콤보 머신: 기본 3점과 콤보 보너스 5점 ×1.5를 합산한 뒤 반올림');
  const h = bossHitInfo(pl(0, 'hammer', 'hunter', 'crusher'), () => 0.99);
  assert.equal(h.damage, 2); // 기본 1 + 파쇄 0.5(이번엔 안 터짐) + 조합 1
  const hb = bossHitInfo(pl(0, 'hammer', 'hunter'), () => 0.99);
  assert.equal(h.hit, hb.hit * COMBO.bossHitMult, '보스 헌터: 타격 점수 ×1.5');
  assert.equal(h.kill, hb.kill * COMBO.bossKillMult, '막타 ×2');
  const s = pl(0, 'plunder', 'counterPro', 'thickSkin'), o = newPlayer('o', 'O', 1);
  // 견제 증강 3종이라 견제 시너지(+SYN.stealAdd)도 함께 붙는다
  assert.equal(resolveClaim(s, 1, [s, o], 100, G).gained, 1 * COMBO.stealMult + SYN.stealAdd, '견제왕: 견제 점수 ×3 (+ 견제 시너지)');
  assert.equal(s.markedUntil, 100 + G.markMs - 1000 - COMBO.stealMarkCutMs, '표적 시간: 철면피 1초 + 견제왕 1초');
  const g = pl(0, 'picky', 'yellowTaste');
  assert.equal(resolveClaim(g, 'y', [g], 100, G).gained, 3 + 1 + 1, '미식가: 노란 원 = 내 색 (편식가 +1, 노란 맛 +1)');
});

test('행운아: 잭팟 확률 +10 / 변두리: 가장자리 커서면 자석 ×1.5', () => {
  const l = pl(0, 'jackpot', 'rainbowHunt'); // 잭팟 5% + 10%
  assert.ok(resolveClaim(l, 0, [l], 100, G, { rand: () => 0.12 }).jackpot > 1);
  const n = pl(0, 'jackpot');
  assert.equal(resolveClaim(n, 0, [n], 100, G, { rand: () => 0.12 }).jackpot, 1);
  const m = pl(0, 'edge', 'magnet');
  assert.equal(magnetOf(m, 0, { x: 800, y: 450 }), 45);
  assert.equal(magnetOf(m, 0, { x: 30, y: 450 }), 67.5);
});

test('철옹성: 방패를 먼저 소모하고 이후 80% 유지, 기세는 방패보다 먼저', () => {
  const p = pl(0, 'shield', 'insurance', 'rebound');
  startRound(p, 0, G);
  p.combo = 10;
  resolveMiss(p, 100, G, [p]);
  assert.deepEqual([p.combo, p.shieldLeft], [10, 0]);
  resolveMiss(p, 200, G, [p]);
  assert.equal(p.combo, 8);
  resolveMiss(p, 300, G, [p]);
  assert.equal(p.combo, 6);
  const q = pl(0, 'shield', 'insurance', 'rebound', 'momentum');
  startRound(q, 0, G);
  q.combo = 5;
  resolveMiss(q, 100, G, [q]);
  assert.deepEqual([q.combo, q.shieldLeft], [5, 1]);
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

test('연결: 3장 조합은 2장으로 완성, 2장 조합은 그대로', () => {
  assert.ok(combosOf(picks('synergyLink', 'hammer', 'hunter')).has('bossHunter'));
  assert.ok(!combosOf(picks('hammer', 'hunter')).has('bossHunter'));
  assert.ok(!combosOf(picks('synergyLink', 'hammer')).has('bossHunter'));
  assert.ok(!combosOf(picks('synergyLink', 'jackpot')).has('lucky'));
  assert.deepEqual(comboProgress(picks('synergyLink', 'hammer')).find((c) => c.id === 'bossHunter'),
    { id: 'bossHunter', name: '보스 헌터', text: COMBOS.find((c) => c.id === 'bossHunter')!.text, have: 1, need: 2 });
});

test('봇 가중치: 연결로 완성된 3장 조합의 남은 1장에는 조합 가중치 없음', () => {
  assert.equal(buildWeight('crusher', picks('synergyLink', 'hammer', 'hunter')), WEIGHT.sameCat);
  assert.equal(buildWeight('crusher', picks('hammer', 'hunter')), WEIGHT.sameCat * WEIGHT.comboPart);
});

test('새 3장 조합: 구성과 연결 2장 완성', () => {
  const want: [ComboId, AbilityId[]][] = [
    ['gambit', ['jackpot', 'luckStack', 'rapid']],
    ['encore', ['overcharge', 'afterglow', 'ignite']],
    ['marksman', ['precise', 'centerKing', 'headStart']],
    ['raidParty', ['vanguard', 'crownMark', 'hunter']],
    ['allHandsCombo', ['wideHand', 'missSave', 'autoMagnet']],
    ['riposteCombo', ['laserProof', 'reflect', 'taunt']],
  ];
  for (const [id, needs] of want) {
    assert.deepEqual(COMBOS.find((c) => c.id === id)?.needs, needs);
    assert.ok(combosOf(picks(...needs)).has(id));
    assert.ok(combosOf(picks('synergyLink', needs[0], needs[2])).has(id));
  }
  assert.deepEqual(want.map(([id]) => COMBOS.find((c) => c.id === id)?.name), ['타짜', '앙코르', '명사수', '토벌대', '만능 손', '역습']);
});
