import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY, DEFAULT_RULES, RULES, addFever, bossHitInfo, buildWeight, evolvedOf, hasLegend, legendOf, modsOf, newPlayer, resolveClaim,
  combosOf, luckyMods, makeBoss, soloSynergyActive, synergiesFor, synergiesOf, synergyProgress, toGameRules, type Pick,
} from '../src/index.ts';
import { applyItem } from '../src/items.ts';
import { strikeBoss } from '../src/bossScore.ts';

const G = toGameRules(DEFAULT_RULES);
const P = (...ids: Pick['id'][]): Pick[] => ids.map((id) => ({ id, tier: 0 }));
const withPicks = (picks: Pick[]) => { const p = newPlayer('a', 'A', 0); p.picks = picks; return p; };

test('시너지: 피버 2종이면 활성, 같은 증강 2번은 1종, 저주·특별·성장은 세지 않음', () => {
  assert.ok(synergiesOf(P('overtime', 'frenzy')).has('피버'));
  assert.ok(!synergiesOf(P('overtime', 'overtime')).has('피버'));
  assert.ok(!synergiesOf(P('picky', 'yellowTaste')).has('점수'), '점수는 3종');
  assert.ok(synergiesOf(P('picky', 'yellowTaste', 'jackpot')).has('점수'));
  assert.equal(synergiesOf(P('drill', 'crownMark', 'luckStack', 'glassCannon', 'flip')).size, 0);
  assert.deepEqual(synergyProgress(P('overtime', 'hammer')).map((x) => [x.cat, x.have, x.need]), [['피버', 1, 2], ['보스', 1, 2]]);
});

test('연결: 모든 분류에 한 종류를 더하고 실제 증강이 필요한 조합에는 세지 않는다', () => {
  const onlyLink = P('synergyLink');
  assert.deepEqual(synergyProgress(onlyLink).map((x) => [x.cat, x.have]), [
    ['점수', 1], ['피버', 1], ['보스', 1], ['유지', 1], ['견제', 1], ['보조', 1],
  ]);
  assert.equal(synergiesOf(P('synergyLink', 'synergyLink')).size, 0);

  const picks = P('synergyLink', 'comboArtist', 'jackpot', 'frenzy', 'hammer', 'shield', 'taunt', 'autoCharge');
  const p = withPicks(picks);
  assert.deepEqual([...synergiesFor(p)], ['점수', '피버', '보스', '유지', '견제', '보조']);
  assert.equal(combosOf(picks).has('comboMachine'), false);
  assert.equal(combosOf(picks).has('bossHunter'), false);
  addFever(p, 20, 1000, G, [p]);
  assert.equal(p.fever, 20 * 1.15);
  p.silenced = true;
  assert.equal(synergiesFor(p).size, 0);
});

test('독주: 한 종류의 중첩은 유지하고 연결, 다른 독주, 분류 시너지, 조합은 비활성화한다', () => {
  assert.equal(soloSynergyActive([]), false);
  assert.equal(soloSynergyActive(P('synergyLink')), false);
  assert.equal(soloSynergyActive(P('spacing', 'spacing')), true);
  assert.equal(soloSynergyActive(P('spacing', 'firstFlame')), false);
  assert.equal(soloSynergyActive(P('spacing', 'synergyLink')), false);
  assert.equal(soloSynergyActive(P('spacing', 'frenzy', 'overtime')), false);
  assert.equal(soloSynergyActive(P('firstFlame', 'shield', 'autoGuard')), false);
});

test('독주 득점과 거리 조절: 직접 클릭만, 구역 변경 고정 점수는 +15% 계산 뒤에 더한다', () => {
  const a = withPicks(P('spacing'));
  const players = [a, newPlayer('b', 'B', 1)];
  const claim = (kind: 0 | 1 | 'y' | 'rainbow', zone: 1 | 2, via: 'click' | 'range' = 'click') =>
    resolveClaim(a, kind, players, 1000, G, { via, zone, rand: () => 0.99 }).gained;
  assert.equal(claim(0, 1), 7);
  assert.equal(claim(0, 2), 12);
  assert.equal(claim(0, 1, 'range'), 6);
  assert.equal(claim('y', 2), 7);
  assert.equal(claim(0, 1), 7);
  assert.equal(claim('rainbow', 2), 17);
  assert.equal(claim(1, 2), 3);
  a.silenced = true;
  assert.equal(claim(0, 2), 9);
});

test('첫 불꽃은 피버를 켠 클릭 다음부터 한 번만 지급한다', () => {
  const a = withPicks(P('firstFlame', 'overtime'));
  a.fever = 88;
  assert.equal(resolveClaim(a, 0, [a], 1000, G).gained, 3);
  assert.ok(a.feverUntil > 1000);
  assert.equal(resolveClaim(a, 0, [a], 1001, G, { via: 'range' }).gained, 9);
  assert.equal(resolveClaim(a, 0, [a], 1002, G).gained, 17);
  assert.equal(resolveClaim(a, 0, [a], 1003, G).gained, 9);
});

test('응수는 반격 후 내 색 클릭에 한 번 지급하고 3초 뒤 만료된다', () => {
  const a = withPicks(P('riposte', 'synergyLink'));
  const b = newPlayer('b', 'B', 1);
  b.markedUntil = 10_000;
  const players = [a, b];
  assert.equal(resolveClaim(a, 1, players, 1000, G).type, 'counter');
  assert.equal(resolveClaim(a, 0, players, 3999, G).gained, 11);
  assert.equal(resolveClaim(a, 0, players, 4000, G).gained, 3);
  assert.equal(resolveClaim(a, 1, players, 5000, G).type, 'counter');
  assert.equal(resolveClaim(a, 0, players, 8000, G).gained, 3);
});

test('결정타는 타격 직전 체력이 20% 이하인 보스에서 플레이어당 한 번 지급한다', () => {
  const a = withPicks(P('finisher'));
  const boss = Object.assign(makeBoss(1, 0, 2, G, () => 0.5), { hp: 21, maxHp: 100 });
  const hits = new Map<string, number>();
  const claim = () => strikeBoss(a, boss, hits, [a], 1000, G, () => 0.99).gained;
  assert.equal(claim(), RULES.boss.hit);
  assert.equal(claim(), RULES.boss.hit + 12);
  assert.equal(claim(), RULES.boss.hit);
});

test('시너지 보너스: 점수 3종 → 내 색 +1', () => {
  const players = [withPicks(P('picky', 'yellowTaste', 'jackpot')), newPlayer('b', 'B', 1)];
  const base = [withPicks(P('picky', 'yellowTaste')), newPlayer('b', 'B', 1)];
  const r = resolveClaim(players[0], 0, players, 1e6, G, { rand: () => 0.99 });
  const r0 = resolveClaim(base[0], 0, base, 1e6, G, { rand: () => 0.99 });
  assert.equal(r.gained - r0.gained, 1);
});

test('시너지 보너스: 견제 2종 → 견제 점수 +2', () => {
  const a = withPicks(P('counterPro', 'taunt')), b = newPlayer('b', 'B', 1);
  const r = resolveClaim(a, 1, [a, b], 1e6, G, { rand: () => 0.99 });
  assert.equal(r.gained, RULES.points.stealCalm + 2);
});

test('시너지 보너스: 유지 2종 → 콤보가 끊길 때 절반은 남음', () => {
  const a = withPicks(P('laserProof', 'rebound')), b = newPlayer('b', 'B', 1);
  a.combo = 10;
  resolveClaim(a, 1, [a, b], 1e6, G, { rand: () => 0.99 });
  assert.equal(a.combo, 5);
});

test('시너지 보너스: 피버 2종 → 게이지 ×1.15, 보스 2종 → 타격 점수 ×1.2, 보조 2종 → 아이템 시간 +1초', () => {
  const f = withPicks(P('overtime', 'afterglow')), f0 = withPicks(P('overtime'));
  addFever(f, 10, 0, G, [f]); addFever(f0, 10, 0, G, [f0]);
  assert.ok(Math.abs(f.fever / f0.fever - 1.15) < 1e-9);
  const b = bossHitInfo(withPicks(P('vanguard', 'crusher')), () => 0.99), b0 = bossHitInfo(withPicks(P('vanguard')), () => 0.99);
  assert.ok(Math.abs(b.hit / b0.hit - 1.2) < 1e-9);
  const s = withPicks(P('wideHand', 'missSave')), s0 = withPicks(P('wideHand'));
  applyItem(s, 'double', 0, G, [s]); applyItem(s0, 'double', 0, G, [s0]);
  assert.equal(s.buffs.double! - s0.buffs.double!, 1000);
});

test('진화: 같은 증강 3번이면 hasLegend 참, 중첩 상한 1.5배', () => {
  const two = withPicks(P('frenzy', 'frenzy'));
  assert.ok(!hasLegend(two, 'frenzy'));
  const three = withPicks(P('frenzy', 'frenzy', 'frenzy'));
  assert.ok(hasLegend(three, 'frenzy'));
  assert.ok(legendOf(three.picks).has('frenzy'));
  assert.deepEqual([...evolvedOf(three.picks)], ['frenzy']);
  // 다른 증강은 진화하면 상한 ×1.5 (연장전 cap 없음 → 폭주로 확인: 상한 없는 증강은 그대로 합)
  const e = Array.from({ length: 3 }, () => ({ id: 'edge' as const, tier: 3 as const }));
  assert.equal(modsOf(e).edge, ABILITY.edge.cap! * 1.5);
  // 잭팟만은 진화해도 상한이 조금만 (+5%p, 35 → 40). 실제 잭팟 확률도 40까지
  const j = Array.from({ length: 4 }, () => ({ id: 'jackpot' as const, tier: 3 as const }));
  assert.equal(modsOf(j.slice(0, 2)).jackpot, ABILITY.jackpot.cap);
  assert.equal(modsOf(j.slice(0, 3)).jackpot, ABILITY.jackpot.cap! + 5);
  const jp = withPicks(j.slice(0, 3));
  assert.equal(luckyMods(jp, modsOf(jp.picks)).jackpot, 40);
  // 저주·특별은 진화하지 않음
  assert.equal(evolvedOf(P('glassCannon', 'glassCannon', 'glassCannon')).size, 0);
});

test('진화: 레전드로 고른 뒤 진화해도 레전드 효과는 한 번', () => {
  const a = withPicks([{ id: 'comboArtist', tier: 3 }, { id: 'comboArtist', tier: 0 }, { id: 'comboArtist', tier: 0 }]);
  assert.equal(hasLegend(a, 'comboArtist'), true);
  assert.equal([...legendOf(a.picks)].filter((x) => x === 'comboArtist').length, 1);
});

test('빌드 가중치: 2번 고른 증강은 ×2 (같은 분류 ×2와 곱함)', () => {
  const owned = P('frenzy', 'frenzy');
  assert.equal(buildWeight('frenzy', owned), 2 * 2);
  assert.equal(buildWeight('frenzy', P('frenzy')), 2);
});
