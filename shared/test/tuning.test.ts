import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCADE, AUG, DEFAULT_RULES, LEGEND, RULES, capMult, extraMult, goldGain, headStartMsOf, jackpotMult, modsOf, newPlayer, resolveClaim, shiftTimes,
  startRound, toGameRules, type Pick, type PlayerState,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const pl = (id: string, color: 0 | 1 | 2 | 3, ...picks: Pick[]): PlayerState => { const p = newPlayer(id, id, color); p.picks = picks; return p; };
const P = (id: Pick['id'], tier: 0 | 1 | 2 | 3 = 0): Pick => ({ id, tier });

// ---------- 꼴찌 보정 ----------
test('꼴찌 보장 등급: 차례별 레어·에픽·에픽·레전드', () => {
  assert.deepEqual(ARCADE.lastGuarantee, [1, 2, 2, 3]);
});

// ---------- 자석 ----------
test('자석 획득: 점수 70%, 콤보 그대로, 콤보 보너스·잭팟·피버 게이지 없음', () => {
  const p = pl('p', 0, P('jackpot', 3)); // 잭팟 30% (rand 0이면 터질 자리)
  p.combo = 9; p.fever = 0;
  const r = resolveClaim(p, 0, [p], 100, G, { via: 'magnet', rand: () => 0 });
  assert.deepEqual([r.gained, p.combo, p.fever, r.jackpot, r.comboBonus, r.feverStarted], [Math.round(3 * 0.7), 9, 0, 1, false, false]);
  // 같은 원을 직접 클릭하면 콤보·보너스·게이지가 붙음 (비교)
  const q = pl('q', 0);
  q.combo = 9;
  const c = resolveClaim(q, 0, [q], 100, G, { rand: () => 0.99 });
  assert.deepEqual([q.combo, c.comboBonus, q.fever > 0], [10, true, true]);
});

test('자석 아이템만 있어도, 피버 중 노란 원도 같은 자석 규칙', () => {
  const p = pl('p', 0);
  p.buffs.magnet = 10_000; p.feverUntil = 10_000; p.combo = 4;
  const r = resolveClaim(p, 'y', [p], 100, G, { via: 'magnet', rand: () => 0 });
  // 피버 중 노랑 = 내 색 3점 × 피버 3 × 70%
  assert.deepEqual([r.gained, p.combo], [Math.round(3 * G.feverMult * AUG.magnetPointPct / 100), 4]);
  // 자석 경로로 잡힌 원은 무지개여도 게이지 없음 (자석은 무지개를 끌지 않지만 경로 규칙 확인)
  const q = pl('q', 0);
  resolveClaim(q, 'rainbow', [q], 100, G, { via: 'magnet' });
  assert.equal(q.fever, 0);
});

// ---------- 잭팟 · 배율 상한 ----------
test('잭팟 확률 상한 35, 행운아 포함 45, 레전드 배율 ×2/×3/×5 그대로', () => {
  assert.equal(modsOf([P('jackpot', 3), P('jackpot', 3)]).jackpot, 35);
  const l = pl('l', 0, P('jackpot', 3), P('jackpot', 3), P('rainbowHunt'));
  assert.ok(resolveClaim(l, 0, [l], 100, G, { rand: seq(0.44, 0.5) }).jackpot > 1);
  const l2 = pl('l2', 0, P('jackpot', 3), P('jackpot', 3), P('rainbowHunt'));
  assert.equal(resolveClaim(l2, 0, [l2], 100, G, { rand: seq(0.46, 0.5) }).jackpot, 1);
  assert.deepEqual(LEGEND.jackpotMults, [2, 3, 5]);
  assert.equal(jackpotMult(modsOf([P('jackpot', 3)]), seq(0, 0.99), true), 5);
});

test('배율 쌓임 상한: 피버 ×12·가장자리 ×3·점수 2배면 ×20으로, 잭팟은 그 위에', () => {
  assert.equal(RULES.multCap, 20);
  assert.equal(capMult(72), 20);
  const mk = (...picks: Pick[]) => { const p = pl('p', 0, ...picks); p.feverUntil = 10_000; p.feverBonus = 9; p.buffs.double = 10_000; return p; };
  const a = mk();
  assert.equal(resolveClaim(a, 0, [a], 100, G, { zone: 2, rand: () => 0.99 }).gained, 3 * 20);
  const b = mk(P('jackpot', 3));
  const r = resolveClaim(b, 0, [b], 100, G, { zone: 2, rand: seq(0, 0) });
  assert.deepEqual([r.jackpot, r.gained], [2, 3 * 20 * 2]);
  const g = mk();
  assert.equal(goldGain(g, 100, [g], G, 2, () => 0.99).gained, RULES.gold.points * 20);
});

// ---------- 강탈 ----------
/** c가 o의 원을 견제했을 때 빼앗은 점수 */
const plunderOf = (tier: 0 | 1 | 2 | 3, roundPts: number, opts: { top?: boolean; guard?: boolean } = {}) => {
  const c = pl('c', 0, P('plunder', tier)), o = pl('o', 1);
  o.roundStart = 5; o.score = 5 + roundPts;
  c.score = opts.top === false ? o.score + 1 : 0;
  if (opts.guard) o.buffs.guard = 10_000;
  return resolveClaim(c, 1, [c, o], 100, G).plundered;
};

test('강탈: 상대 라운드 점수의 %, 최소 1, 상한 30, 라운드 점수 0이면 0', () => {
  assert.equal(plunderOf(1, 100), 2); // 2%
  assert.equal(plunderOf(2, 100), 3); // 3%
  assert.equal(plunderOf(0, 10), 1); // 0.1 → 최소 1
  assert.equal(plunderOf(2, 5000), AUG.plunderMax);
  assert.equal(plunderOf(2, 0), 0);
});

test('강탈 레전드: 1등이면 2배, 상한 60. 1등이 아니면 그대로. 보호막이면 0', () => {
  assert.equal(plunderOf(3, 100), 10); // 5% × 2
  assert.equal(plunderOf(3, 5000), AUG.plunderMax * LEGEND.plunderTopMult);
  assert.equal(plunderOf(3, 100, { top: false }), 5);
  assert.equal(plunderOf(3, 100, { guard: true }), 0);
});

// ---------- 출발 신호 ----------
test('출발 신호: 처음 N초 ×1.3, 시작 보너스 점수 없음, 중첩 합 상한 20초', () => {
  const p = pl('p', 0, P('headStart', 0)); // 5초
  startRound(p, 1000, G);
  assert.equal(p.score, 0);
  assert.equal(extraMult(p, 5_999, [p]), AUG.headStartMult);
  assert.equal(extraMult(p, 6_000, [p]), 1);
  const q = pl('q', 0, P('headStart', 2), P('headStart', 2)); // 20초 (상한)
  assert.equal(headStartMsOf(q), 20_000);
  // 3번 고르면 진화: 상한 ×1.5 = 30초
  const q3 = pl('q3', 0, P('headStart', 2), P('headStart', 2), P('headStart', 2));
  assert.equal(headStartMsOf(q3), 30_000);
});

test('출발 신호가 없으면 라운드 시작 전(카운트다운)에도 배율 없음', () => {
  const p = pl('p', 0);
  startRound(p, 5_000, G);
  assert.equal(extraMult(p, 1_000, [p]), 1);
});

test('출발 신호 레전드: ×1.5, 창은 레전드 수치 15초 (최소 10초)', () => {
  const p = pl('p', 0, P('headStart', 3));
  assert.equal(headStartMsOf(p), Math.max(15_000, LEGEND.headStartMs));
  startRound(p, 0, G);
  assert.equal(extraMult(p, 14_999, [p]), LEGEND.headStartMult);
});

test('출발 신호 창 안에서 일시정지하면 창이 그만큼 밀림, 창이 끝난 뒤면 그대로', () => {
  const p = pl('p', 0, P('headStart', 1)); // 8초
  startRound(p, 0, G);
  shiftTimes(p, 3_000, 4_000);
  assert.equal(extraMult(p, 11_999, [p]), AUG.headStartMult);
  assert.equal(extraMult(p, 12_000, [p]), 1);
  const q = pl('q', 0, P('headStart', 1));
  startRound(q, 0, G);
  shiftTimes(q, 9_000, 4_000);
  assert.equal(q.roundBegin, 0);
});
