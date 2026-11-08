import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY, DEFAULT_RULES, afterMultOf, applyItem, bossHitInfo, extraMult, feverMultOf, jackpotMult, legendOf, modsOf, newPlayer,
  resolveClaim, resolveMiss, settleFever, startFever, startRound, toGameRules, zoneMult, type AbilityId,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const pl = (id: string, color: 0 | 1 | 2 | 3, ...legends: AbilityId[]) => {
  const p = newPlayer(id, id, color);
  p.picks = legends.map((x) => ({ id: x, tier: 3 as const }));
  return p;
};

test('legendOf: 레전드로 고른 능력만, 저주·특별 카드 제외', () => {
  const L = legendOf([{ id: 'hammer', tier: 3 }, { id: 'jackpot', tier: 1 }, { id: 'oneWay', tier: 0 }, { id: 'flip', tier: 0 }]);
  assert.deepEqual([...L], ['hammer']);
});

test('레전드 수치 = 에픽 × 2 (상한 안에서)', () => {
  for (const id of ['picky', 'rainbowHunt', 'headStart', 'jackpot', 'overcharge', 'hunter', 'counterPro', 'jammer', 'wideHand', 'magnet'] as AbilityId[]) {
    const a = ABILITY[id];
    assert.equal(a.values[3], Math.min(a.cap ?? Infinity, a.values[2] * 2), id);
  }
});

test('편식가·노란 맛 레전드: 피버 게이지', () => {
  const a = newPlayer('a', 'A', 0), b = pl('b', 0, 'picky');
  resolveClaim(a, 0, [a], 100, G); resolveClaim(b, 0, [b], 100, G);
  assert.ok(Math.abs(b.fever - a.fever * 2) < 1e-9);
  const c = newPlayer('c', 'C', 0), d = pl('d', 0, 'yellowTaste');
  resolveClaim(c, 0, [c], 100, G); resolveClaim(d, 'y', [d], 100, G);
  assert.ok(Math.abs(c.fever - d.fever) < 1e-9);
});

test('무지개 사냥 레전드: 피버 게이지 2배 (즉시 피버 아님)', () => {
  const a = newPlayer('a', 'A', 0), p = pl('b', 0, 'rainbowHunt');
  resolveClaim(a, 'rainbow', [a], 1000, G);
  const r = resolveClaim(p, 'rainbow', [p], 1000, G);
  assert.equal(r.feverStarted, false);
  assert.equal(p.fever, a.fever * 2);
});

test('콤보 장인 레전드: 콤보 보너스 +15, 폭주 레전드는 피버 중 2배', () => {
  const p = pl('a', 0, 'comboArtist'); // 주기 max(3, 10 − 6) = 4
  p.combo = 3;
  assert.equal(resolveClaim(p, 0, [p], 100, G).gained, 3 + 15);
  const f = pl('b', 0, 'frenzy');
  f.combo = 9; f.feverUntil = 10_000;
  assert.equal(resolveClaim(f, 0, [f], 100, G).gained, Math.round((3 + 10) * feverMultOf(f, G)));
});

test('출발 신호 레전드: 라운드 처음 10초 ×1.5', () => {
  const p = pl('a', 0, 'headStart');
  startRound(p, 1000, G);
  assert.equal(extraMult(p, 10_999, [p]), 1.5);
  assert.equal(extraMult(p, 11_000, [p]), 1);
});

test('잭팟 레전드: 배율 ×2~×5', () => {
  const m = modsOf([{ id: 'jackpot', tier: 3 }]);
  assert.equal(jackpotMult(m, seq(0, 0.8), true), 3);
  assert.equal(jackpotMult(m, seq(0, 0.99), true), 5);
  assert.equal(jackpotMult(m, seq(0, 0.99), false), 3);
});

test('찰나의 순간·중앙의 왕 레전드: 그 구역에서 콤보 +2', () => {
  const e = pl('a', 0, 'edge'), c = pl('b', 0, 'centerKing');
  resolveClaim(e, 0, [e], 100, G, { zone: 2 }); resolveClaim(c, 0, [c], 100, G, { zone: 0 });
  assert.deepEqual([e.combo, c.combo], [2, 2]);
  resolveClaim(e, 0, [e], 200, G, { zone: 1 });
  assert.equal(e.combo, 3);
});

test('예열 레전드: 라운드 첫 피버만 배율 +2', () => {
  const p = pl('a', 0, 'preheat');
  startRound(p, 0, G); // 예열 100: 피버로 시작
  assert.equal(feverMultOf(p, G), G.feverMult + 2);
  startFever(p, 50_000, G, modsOf(p.picks));
  assert.equal(feverMultOf(p, G), G.feverMult);
});

test('연장전·과충전 레전드', () => {
  const o = pl('a', 0, 'overtime');
  o.feverUntil = 10_000;
  resolveClaim(o, 0, [o], 100, G);
  assert.equal(o.feverUntil, 10_100);
  const c = pl('b', 0, 'overcharge');
  startFever(c, 0, G, modsOf(c.picks));
  assert.equal(c.feverCarry, 50);
  settleFever(c, c.feverUntil - 1);
  assert.equal(c.fever, 0);
  settleFever(c, c.feverUntil);
  assert.deepEqual([c.fever, c.feverCarry], [50, 0]);
});

test('여운 레전드 ×2, 해머 레전드 15% 확률 3타', () => {
  assert.equal(afterMultOf(pl('a', 0, 'afterglow')), 2);
  assert.equal(afterMultOf(newPlayer('b', 'B', 0)), 1.5);
  assert.equal(bossHitInfo(pl('c', 0, 'hammer'), () => 0).damage, 3);
  assert.equal(bossHitInfo(pl('d', 0, 'hammer'), seq(0.5, 0.2)).damage, 1);
});

test('보험·철면피 레전드: 견제·빈 곳에서 피버 게이지 안 깎임', () => {
  const a = pl('a', 0, 'insurance'), b = newPlayer('b', 'B', 1);
  a.fever = 50;
  resolveClaim(a, 1, [a, b], 100, G);
  resolveMiss(a, 200, G, [a, b]);
  assert.equal(a.fever, 50);
  const t = pl('t', 0, 'thickSkin'), o = newPlayer('o', 'O', 1);
  t.fever = 50;
  resolveClaim(t, 1, [t, o], 100, G);
  assert.equal(t.fever, 50);
});

test('방패·강탈·반격 전문가 레전드', () => {
  const a = newPlayer('a', 'A', 0), b = pl('b', 1, 'shield');
  a.score = 10; b.score = 50;
  const r = resolveClaim(a, 1, [a, b], 100, G);
  assert.deepEqual([a.score, b.score, r.drained], [10 - 3 + 1, 53, 3]);
  const c = pl('c', 0, 'plunder'), d = newPlayer('d', 'D', 1);
  c.score = 0; d.score = 100;
  assert.equal(resolveClaim(c, 1, [c, d], 100, G).plundered, 8);
  const e = pl('e', 0, 'counterPro'), f = newPlayer('f', 'F', 1);
  f.markedUntil = 10_000; f.combo = 5;
  const rc = resolveClaim(e, 1, [e, f], 100, G);
  assert.deepEqual([rc.type, f.combo, rc.brokeComboOf], ['counter', 0, 'f']);
});

test('견제 반사 레전드: 횟수 제한 없음', () => {
  const a = newPlayer('a', 'A', 0), b = pl('b', 1, 'reflect');
  b.reflectLeft = 0;
  for (let i = 0; i < 3; i++) {
    a.markedUntil = 0;
    assert.equal(resolveClaim(a, 1, [a, b], 100 + i, G).reflectedTo, 'b');
  }
});

test('방해 전파 레전드: 피버가 터지면 상대 감도 감소 (철벽 제외)', () => {
  const a = pl('a', 0, 'jammer'), b = newPlayer('b', 'B', 1), c = newPlayer('c', 'C', 2);
  c.picks = [{ id: 'fortress', tier: 0 }];
  a.fever = 99;
  resolveClaim(a, 0, [a, b, c], 100, G);
  assert.ok((b.debuffs.slow ?? 0) > 100);
  assert.equal(c.debuffs.slow, undefined);
});

test('넓은 손·헛손질 보정 레전드: 그 방법으로 잡은 원 ×1.5', () => {
  const w = pl('a', 0, 'wideHand'), s = pl('b', 0, 'missSave');
  assert.equal(resolveClaim(w, 0, [w], 100, G, { via: 'range' }).gained, 5);
  assert.equal(resolveClaim(s, 0, [s], 100, G, { via: 'save' }).gained, 5);
  assert.equal(resolveClaim(w, 0, [w], 200, G).gained, 3);
});

test('리바운드: 끊긴 뒤 3초 점수 +30%, 레전드는 콤보 절반 되찾음, 기세면 안 켜짐', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  b.picks = [{ id: 'rebound', tier: 0 }]; b.combo = 8;
  resolveClaim(a, 1, [a, b], 1000, G);
  assert.equal(b.combo, 0);
  assert.equal(resolveClaim(b, 1, [a, b], 2000, G).gained, 4); // 3 × 1.3
  assert.equal(resolveClaim(b, 1, [a, b], 4001, G).gained, 3);
  const c = newPlayer('c', 'C', 2), d = pl('d', 3, 'rebound');
  d.combo = 8;
  resolveClaim(c, 3, [c, d], 1000, G);
  resolveClaim(d, 3, [c, d], 1500, G);
  assert.equal(d.combo, 1 + 4);
  const e = newPlayer('e', 'E', 0), f = newPlayer('f', 'F', 1);
  f.picks = [{ id: 'rebound', tier: 0 }, { id: 'momentum', tier: 0 }]; f.combo = 8;
  resolveClaim(e, 1, [e, f], 1000, G);
  assert.deepEqual([f.combo, f.reboundUntil], [8, 0]);
});

test('속사: 0.4초 안 연달아 두 번째부터 +v, 레전드는 5연속에 다음 잭팟 확정', () => {
  const p = newPlayer('a', 'A', 0);
  p.picks = [{ id: 'rapid', tier: 0 }];
  assert.equal(resolveClaim(p, 0, [p], 1000, G).gained, 3);
  assert.equal(resolveClaim(p, 0, [p], 1300, G).gained, 4);
  assert.equal(resolveClaim(p, 0, [p], 2000, G).gained, 3);
  const q = pl('b', 0, 'rapid');
  for (let i = 0; i < 5; i++) resolveClaim(q, 0, [q], 1000 + i * 100, G);
  assert.equal(q.rapidJackpot, true);
  assert.ok(resolveClaim(q, 0, [q], 5000, G, { rand: seq(0, 0.5) }).jackpot > 1);
  assert.equal(q.rapidJackpot, false);
});

test('수집가·중앙의 왕·도발', () => {
  const p = newPlayer('a', 'A', 0);
  p.picks = [{ id: 'collector', tier: 0 }];
  applyItem(p, 'wideHand', 0, G, [p]);
  assert.equal(p.buffs.wideHand, 5000 * 1.2);
  assert.ok(Math.abs(zoneMult(0, modsOf([{ id: 'centerKing', tier: 0 }])) - 1.3) < 1e-9);
  const t = newPlayer('t', 'T', 0), o = newPlayer('o', 'O', 1);
  t.picks = [{ id: 'taunt', tier: 0 }]; o.fever = 40;
  resolveClaim(t, 1, [t, o], 100, G);
  assert.equal(o.fever, 35);
  const lt = pl('lt', 0, 'taunt'), lo = newPlayer('lo', 'LO', 1);
  lo.feverUntil = 10_000;
  resolveClaim(lt, 1, [lt, lo], 100, G);
  assert.equal(lo.feverUntil, 9_000);
});


// ---------- 3-2 리뷰 수정 ----------
test('반격 전문가 레전드: 반격하면 피버 +20, 철벽 상대 콤보는 지킴', () => {
  const e = pl('e', 0, 'counterPro'), f = newPlayer('f', 'F', 1);
  f.picks = [{ id: 'fortress', tier: 0 }]; f.markedUntil = 10_000; f.combo = 5;
  const r = resolveClaim(e, 1, [e, f], 100, G);
  assert.equal(r.type, 'counter');
  assert.equal(f.combo, 5);
  assert.equal(e.fever, 20);
});

test('도발은 철벽 상대에게 안 걸림', () => {
  const t = pl('t', 0, 'taunt'), o = newPlayer('o', 'O', 1);
  o.picks = [{ id: 'fortress', tier: 0 }]; o.fever = 40;
  resolveClaim(t, 1, [t, o], 100, G);
  assert.equal(o.fever, 40);
  o.feverUntil = 10_000;
  resolveClaim(t, 1, [t, o], 200, G);
  assert.equal(o.feverUntil, 10_000);
});

test('연장전 레전드가 피버를 늘리면 여운도 같이 밀림', () => {
  const p = newPlayer('a', 'A', 0);
  p.picks = [{ id: 'overtime', tier: 3 }, { id: 'afterglow', tier: 2 }];
  startFever(p, 0, G, modsOf(p.picks));
  const f = p.feverUntil, a = p.afterUntil;
  resolveClaim(p, 0, [p], 100, G);
  assert.deepEqual([p.feverUntil - f, p.afterUntil - a], [100, 100]);
});

test('속사는 한 번에 같이 잡힌 원(넓은 손 등)을 연속으로 세지 않음', () => {
  const p = pl('a', 0, 'rapid');
  const gains = [0, 1, 2, 3, 4].map(() => resolveClaim(p, 0, [p], 1000, G, { via: 'range' }).gained);
  assert.deepEqual(gains, [3, 3, 3, 3, 3]);
  assert.equal(p.rapidJackpot, false);
});

test('리바운드는 내가 스스로 끊은 콤보(빈 곳·내 견제)에는 안 켜짐', () => {
  const p = newPlayer('a', 'A', 0), o = newPlayer('o', 'O', 1);
  p.picks = [{ id: 'rebound', tier: 0 }]; p.combo = 3;
  resolveMiss(p, 100, G, [p, o]);
  assert.equal(p.reboundUntil, 0);
  p.combo = 3;
  resolveClaim(p, 1, [p, o], 200, G);
  assert.equal(p.reboundUntil, 0);
});
