import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import {
  CURSE, DEFAULT_RULES, LEGEND, LEGEND_TEXT, SPECIAL, bossHitInfo, crossedCombo, extraMult, feverMultOf, hyenaGains, newPlayer,
  resetForRound, resolveClaim, resolveMiss, settleFever, shiftTimes, startFever, startRound, toGameRules, modsOf,
  type AbilityId, type GameRules, type Pick,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const pl = (id: string, color: 0 | 1 | 2 | 3, ...picks: Pick[]) => { const p = newPlayer(id, id, color); p.picks = picks; return p; };
const L = (id: AbilityId): Pick => ({ id, tier: 3 });
const N = (id: AbilityId): Pick => ({ id, tier: 0 });

test('하이에나: 1등이 0점을 얻은 획득에는 발동하지 않음', () => {
  const a = pl('a', 0), b = pl('b', 1), c = pl('c', 2, N('hyena'));
  a.score = 100; b.score = 50;
  assert.deepEqual(hyenaGains(a, [a, b, c], 0, () => 0), []);
  assert.deepEqual(hyenaGains(a, [a, b, c], 3, () => 0), [{ playerId: 'c', delta: SPECIAL.hyenaGain }]);
});

test('crossedCombo: 배수를 건너뛰어도 잡고, 콤보가 안 오르면 아님', () => {
  assert.equal(crossedCombo(9, 11, 10), true);
  assert.equal(crossedCombo(8, 9, 10), false);
  assert.equal(crossedCombo(10, 10, 10), false); // 반격처럼 콤보가 그대로
  assert.equal(crossedCombo(19, 20, 10), true);
});

test('콤보 보너스: 중앙의 왕 레전드로 9 → 11이 돼도 10콤보 보너스', () => {
  const p = pl('p', 0, L('centerKing'));
  p.combo = 9;
  const r = resolveClaim(p, 0, [p], 100, G, { zone: 0 });
  assert.equal(p.combo, 11);
  assert.equal(r.comboBonus, true);
});

test('무지개 사냥 레전드로 게이지가 차서 터진 피버도 방해 전파가 걸림', () => {
  const p = pl('p', 0, L('rainbowHunt'), N('jammer')), o = pl('o', 1);
  p.fever = 60;
  const r = resolveClaim(p, 'rainbow', [p, o], 100, G);
  assert.equal(r.feverStarted, true);
  assert.ok(o.blurUntil > 100);
});

test('출발 신호 레전드: 일시정지한 만큼 창이 늦게 끝남', () => {
  const p = pl('p', 0, L('headStart'));
  startRound(p, 0, G);
  shiftTimes(p, 5_000, 3_000); // 5초에 멈춰 3초 뒤 재개 (레전드 15초 창 → 18초까지)
  assert.equal(extraMult(p, 17_999, [p]), LEGEND.headStartMult);
  assert.equal(extraMult(p, 18_000, [p]), 1);
  // 창이 끝난 뒤에 멈추면 그대로
  const q = pl('q', 0, L('headStart'));
  startRound(q, 0, G);
  shiftTimes(q, 20_000, 3_000);
  assert.equal(q.roundBegin, 0);
});

test('피버가 끝나면 예열 레전드 배율을 지우고, 과충전 채움은 true', () => {
  const p = pl('p', 0, L('preheat'));
  startFever(p, 0, G, modsOf(p.picks));
  assert.equal(feverMultOf(p, G), G.feverMult + LEGEND.preheatMult + 0); // 예열 레전드 수치 100 → 레전드 배율
  assert.equal(settleFever(p, p.feverUntil), false);
  assert.equal(p.feverBonus, 0);
  const q = pl('q', 0, L('overcharge'));
  startFever(q, 0, G, modsOf(q.picks));
  assert.equal(settleFever(q, q.feverUntil - 1), false);
  assert.equal(settleFever(q, q.feverUntil), true);
  assert.equal(q.fever, LEGEND.overchargeKeep);
});

test('철옹성: 보험 100%면 보험 쪽(그대로), 아니면 80% 유지', () => {
  const p = pl('p', 0, N('shield'), L('insurance'), N('rebound'));
  startRound(p, 0, G);
  p.combo = 5;
  resolveMiss(p, 100, G, [p]);
  assert.equal(p.combo, 5);
  const q = pl('q', 0, N('shield'), N('insurance'), N('rebound'));
  startRound(q, 0, G);
  q.combo = 10;
  resolveMiss(q, 100, G, [q]);
  assert.equal(q.combo, 8);
});

test('해머 레전드 3타 뒤에도 보스 헌터 +1', () => {
  const p = pl('p', 0, L('hammer'), N('hunter'), N('crusher'));
  assert.equal(bossHitInfo(p, seq(0.99, 0)).damage, LEGEND.hammerDmg + 1);
});

test('새 게임: 넓은 손 순위 보정도 초기화', () => {
  const p = pl('p', 0);
  p.rankReach = 20;
  resetForRound(p);
  assert.equal(p.rankReach, 0);
});

test('철벽: 견제한 사람의 흡혈을 막고, 자기 흡혈 저주 대가는 그대로', () => {
  const vamp = pl('v', 0, N('vampire')), fort = pl('f', 1, N('fortress'));
  fort.score = 10;
  const r = resolveClaim(vamp, 1, [vamp, fort], 100, G);
  assert.equal(r.plundered, 0);
  assert.equal(fort.score, 10);
  const a = pl('a', 0), self = pl('s', 1, N('fortress'), N('vampire'));
  self.score = 10;
  assert.equal(resolveClaim(a, 1, [a, self], 100, G).plundered, CURSE.vampire.drain);
});

test('카드 풀: 레이저·방해 아이템·맵 패턴이 모두 꺼지면 방해 내성 없음, 아이템이 꺼지면 수집가 없음', () => {
  const io = { to: () => ({ emit() {} }), sockets: { sockets: new Map() } } as never;
  const room = new Room(io, 'POOL', () => {});
  const r = room as unknown as { G: GameRules; offPool(): AbilityId[] };
  r.G = { ...G, laser: true, items: true };
  assert.deepEqual(r.offPool(), []);
  r.G = { ...G, laser: false, items: false };
  assert.deepEqual(r.offPool(), ['collector'], '방해 아이템·맵 패턴이 켜져 있으면 방해 내성은 남음');
  r.G = { ...G, laser: false, sabotage: false, mapChance: 0, items: false };
  assert.deepEqual(r.offPool(), ['laserProof', 'collector']);
  room.destroy();
});

test('레전드 문장의 숫자는 수치 상수에서', () => {
  assert.ok(LEGEND_TEXT.shield!.includes(`${LEGEND.shieldDrain}점`));
  assert.ok(LEGEND_TEXT.comboArtist!.includes(`+${LEGEND.comboBonusAdd}`));
  assert.ok(LEGEND_TEXT.jackpot!.includes(`×${LEGEND.jackpotMults.at(-1)}`));
  assert.ok(LEGEND_TEXT.vanguard!.includes(`${LEGEND.vanguardMult}배`));
});

test('새 게임이면 남은 일시정지가 처음 횟수로', () => {
  const p = pl('p', 0);
  p.pausesLeft = 0;
  resetForRound(p);
  assert.equal(p.pausesLeft, 3);
});
