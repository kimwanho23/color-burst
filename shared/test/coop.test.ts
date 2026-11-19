import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, FIELD, PRESETS, RULES, applyRaidDamage, circlePos, coopPhase, coopStars, crystalHits, crystalHp, inSafe, isGuarded, isHit, isOut,
  COOP_BOSSES, beamHits, hitShot, inSeal, pickSkill, rollSeal,
  burstMsFor, makeCrystal, makeOrb, makeRaid, makeThreat, matchPreset, newPlayer, orbDamage, inCrystalDanger, placeCrystals, raidMaxHp, safeZoneAt, sanitizeRules, shotGone, shotPos, toGameRules, zoneOf,
  type Beam, type Circle, type CoopHitBy, type CoopSkill, type Homing, type Seal, type CoopResult, type CoopState, type GameOver, type PlayerState, type SafeZones, type Volley,
} from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { gameRecord } from '../../server/src/gameLog.ts';
import { Bot } from '../../server/src/bot.ts';
import { COOP_ATTACK_SPECIAL_IDS, attackSpecialRule, specialRule } from '../src/coopSpecial.ts';

mock.method(console, 'log', () => {});
test('보스 체력: 난이도 배율과 사람·봇 인원 반영', () => {
  for (const [level, hp] of [['easy', 240], ['normal', 300], ['hard', 360], ['expert', 540]] as const) {
    assert.equal(raidMaxHp(1, 0, level), hp);
    assert.equal(raidMaxHp(1, 3, level), Math.round(hp * 2.5));
    const { room, r } = coopRoom(1, 0, level);
    assert.equal(r.coop.state().maxHp, hp);
    room.destroy();
  }
});
test('추적 원: 보스가 가장자리에 있어도 모든 발사 방향에 최소 대응 시간 보장', () => {
  for (const x of [RULES.coop.bossR + 20, FIELD.w / 2, FIELD.w - RULES.coop.bossR - 20]) {
    for (let i = 0; i < 36; i++) {
      const c = makeThreat(i, 0, { x, y: RULES.coop.bossY }, i * Math.PI / 18, 300, 'a');
      assert.ok(!isOut(c, RULES.coop.threatMinTravelMs - 1));
      assert.ok(c.speed > 0 && c.speed <= 300);
      assert.equal(isOut(c, 20_000), Math.abs(Math.sin(c.angle)) > 1e-6);
    }
  }
});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop;
const N = C.levels.normal.hurt;

/** 고정 난수 (같은 순서로 반복) */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

// ---------- 계산 함수 ----------

test('coopPhase: 0.67 초과 1, 0.33 초과 2, 그 밖 3', () => {
  assert.equal(coopPhase(100, 100), 1);
  assert.equal(coopPhase(68, 100), 1);
  assert.equal(coopPhase(67, 100), 2);
  assert.equal(coopPhase(34, 100), 2);
  assert.equal(coopPhase(33, 100), 3);
  assert.equal(coopPhase(0, 100), 3);
});

test('raidMaxHp: 사람 1 + 봇 3 = hpBase × 2.5', () => {
  assert.equal(raidMaxHp(1, 3), Math.round(C.hpBase * 2.5));
});

test('orbDamage: 내 색 1, 노랑 0.7, 콤보 30에 +60%, 상한 80%, 큰 피해 ×2, 봇 ×0.5', () => {
  const p = newPlayer('a', 'A', 0);
  assert.equal(orbDamage(p, 0, false), 1);
  assert.equal(orbDamage(p, 'y', false), 0.7);
  for (const [combo, want] of [[30, 1.6], [39, 1.6], [40, 1.8], [100, 1.8]] as const) {
    p.combo = combo;
    assert.ok(Math.abs(orbDamage(p, 0, false) - want) < 1e-9, 'combo ' + combo);
  }
  p.combo = 0;
  assert.equal(orbDamage(p, 0, true), 2);
  const bot = newPlayer('b', 'B', 1, true);
  assert.equal(orbDamage(bot, 1, false), 0.5);
});

test('applyRaidDamage: 경계에서 멈춤 (단계 두 개를 한 번에 넘지 않음)', () => {
  const b = makeRaid(1, 0, 100);
  const r1 = applyRaidDamage(b, 50);
  assert.deepEqual([b.hp, r1.crossed], [67, true]);
  assert.ok(Math.abs(r1.dealt - 33) < 1e-9);
  const r2 = applyRaidDamage(b, 10, 2);
  assert.deepEqual([b.hp, r2.crossed], [57, false]);
});

test('applyRaidDamage: 3단계는 0까지, 경계 안이면 crossed 아님', () => {
  const b = makeRaid(1, 0, 100);
  b.hp = 20;
  const r = applyRaidDamage(b, 50, 3);
  assert.deepEqual([b.hp, r.crossed], [0, true]);
});

test('applyRaidDamage: 경계 체력이 실수 오차로 비율보다 커도 단계가 넘어가고 다음 타격이 들어감', () => {
  const b = makeRaid(1, 0, 375);
  applyRaidDamage(b, 1000, 1);
  assert.equal(coopPhase(b.hp!, b.maxHp!), 2);
  const r = applyRaidDamage(b, 1, 2);
  assert.ok(r.dealt > 0);
});

test('coopStars: 진 판 0, 모두 생존·60초 남음 3, 절반 생존 2, 그 밖 1', () => {
  assert.equal(coopStars(false, 1, 100_000), 0);
  assert.equal(coopStars(true, 1, 60_000), 3);
  assert.equal(coopStars(true, 0.5, 0), 2);
  assert.equal(coopStars(true, 0.25, 0), 1);
});

test('crystalHits: 난이도·두 번째 보호막', () => {
  assert.equal(crystalHits('normal', 0), 8);
  assert.equal(crystalHits('normal', 1), 12);
  assert.equal(crystalHits('hard', 1), 15);
  assert.equal(crystalHits('easy', 0), 6);
  assert.equal(crystalHp('normal', 0), 16);
  assert.equal(crystalHp('expert', 1), 48);
});

test('placeCrystals: 가장자리 구역, 서로 떨어짐, 판 안', () => {
  for (const seed of [0.1, 0.5, 0.9]) {
    // mulberry32
    let a = Math.floor(seed * 2 ** 31);
    const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ps = placeCrystals(4, rand);
    assert.equal(ps.length, 4);
    for (const p of ps) {
      assert.equal(zoneOf(p), 2, JSON.stringify(p));
      assert.ok(p.x >= C.crystal.r && p.x <= FIELD.w - C.crystal.r && p.y >= C.crystal.r && p.y <= FIELD.h - C.crystal.r);
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y) >= C.crystal.minGap);
  }
});

test('큰 피해 구간 길이: 남은 12초 → 10초(상한), 남은 2초 → 5초, 남은 0초 → 4초', () => {
  assert.equal(burstMsFor(12_000), 10_000);
  assert.equal(burstMsFor(2_000), 5_000);
  assert.equal(burstMsFor(0), 4_000);
  assert.equal(burstMsFor(-500), 4_000);
});

test('수정 자리: 보스 아래 부채꼴에 놓이지 않음', () => {
  const lim = (C.crystal.dangerDeg * Math.PI) / 180;
  let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let a = seed * 7919;
    const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (const p of placeCrystals(4, rand)) {
      n++;
      const dx = p.x - FIELD.w / 2, dy = p.y - C.bossY;
      const inside = dy > 0 && Math.hypot(dx, dy) <= C.crystal.dangerR && Math.abs(Math.atan2(dx, dy)) <= lim;
      assert.equal(inside, false, JSON.stringify(p));
    }
  }
  assert.ok(n >= 200, String(n));
  // 부채꼴 한가운데로만 나오는 난수는 건너뛰고 다른 곳을 찾는다
  assert.equal(inCrystalDanger({ x: FIELD.w / 2, y: C.bossY + 400 }), true);
  assert.equal(inCrystalDanger({ x: FIELD.w / 2, y: C.bossY + 1100 }), false);
  assert.equal(inCrystalDanger({ x: FIELD.w / 2, y: C.bossY - 100 }), false);
});

test('수정 구간: 잡을 원은 안 나오고 탄막은 나온다', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const before = [...r.circles.values()].filter((c) => c.kind !== 'crystal' && c.kind !== 'boss').length;
  sent.length = 0;
  for (let t = now; t <= now + 5000; t += 50) r.coop.tick(t);
  const orbs = [...r.circles.values()].filter((c) => c.kind !== 'crystal' && c.kind !== 'boss').length;
  assert.equal(orbs, before, '새 원 없음');
  assert.ok(volleysSent().length > 0, '탄막은 나옴');
  room.destroy();
});

test('수정 자리: 부채꼴 안 후보(보스 바로 아래)는 거르고 다른 곳에 놓는다', () => {
  // 앞 후보 세 개는 각도 π/2 (아래 가운데), 이후는 고르게 흩어진 값
  const first = [0.25, 0.5, 0.25, 0.9, 0.25, 0.1];
  let i = 0, a = 12345;
  const rest = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rand = () => (i < first.length ? first[i++]! : rest());
  const bottom = { x: FIELD.w / 2, y: FIELD.h / 2 + 0.85 * FIELD.h / 2 };
  assert.equal(inCrystalDanger(bottom), true, '아래 가운데는 위험');
  const ps = placeCrystals(4, rand);
  assert.equal(ps.length, 4);
  for (const p of ps) assert.equal(inCrystalDanger(p), false, JSON.stringify(p));
});

test('breaks에 burstMs가 남는다', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now + 9_000); // 남은 3초 → 4초 + 1.5초
  const res = r.coop.result(now + 9_000, r.startAt, false, 'time');
  assert.equal(res.breaks.length, 1);
  assert.equal(res.breaks[0]!.burstMs, 5_500);
  assert.equal(r.coop.state().burstUntil, now + 9_000 + 5_500);
  room.destroy();
});

test('makeCrystal: 움직이지 않고 체력, 주인과 색을 유지', () => {
  const c = makeCrystal(5, 1000, { x: 100, y: 900 }, 'a', 2, 8);
  assert.deepEqual(circlePos(c, 6000), { x: 100, y: 900 });
  assert.deepEqual([c.kind, c.hp, c.maxHp, c.target, c.colorOf], ['crystal', 8, 8, 'a', 2]);
  assert.ok(!isOut(c, 60_000));
});

test('makeOrb: 보스 자리에서 날아감', () => {
  const o = makeOrb(7, 0, { x: 550, y: 190 }, Math.PI / 2, 1, 100);
  assert.deepEqual(circlePos(o, 1000), { x: 550, y: 290 });
  assert.equal(o.kind, 1);
});

test('safeZoneAt·inSafe: 경고 동안 줄어들며 옮겨 감', () => {
  const s: SafeZones = { at: 10_000, warnMs: C.safe.warnMs, zones: [{ x0: 300, y0: 300, x1: 400, y1: 350 }] };
  const start = safeZoneAt(s, 0, 10_000 - C.safe.warnMs);
  assert.deepEqual(start, { x: 300, y: 300, r: C.safe.r0 });
  const end = safeZoneAt(s, 0, 10_000);
  assert.deepEqual(end, { x: 400, y: 350, r: C.safe.r1 });
  assert.equal(inSafe({ x: 400, y: 350 }, s, 10_000), true);
  assert.equal(inSafe({ x: 400 + C.safe.r1 + 5, y: 350 }, s, 10_000), false);
});

test('sanitizeRules: 협력전 배타', () => {
  const on = sanitizeRules(DEFAULT_RULES, { coop: true, mode: 'arcade', team: true });
  assert.deepEqual([on.coop, on.mode, on.team, on.survival], [true, 'classic', false, false]);
  const base = sanitizeRules(DEFAULT_RULES, { coop: true });
  const t = sanitizeRules(base, { team: true });
  assert.deepEqual([t.coop, t.team], [false, true]);
  const s = sanitizeRules(base, { survival: true });
  assert.deepEqual([s.coop, s.survival], [false, true]);
  const a = sanitizeRules(base, { mode: 'arcade' });
  assert.deepEqual([a.coop, a.mode], [false, 'arcade']);
  assert.equal(sanitizeRules(base, { coopLevel: 'x' as never }).coopLevel, 'normal');
  assert.equal(sanitizeRules(base, { coopLevel: 'hard' }).coopLevel, 'hard');
});

test('프리셋: 협력전·난이도는 프리셋 비교에서 빠지고, 프리셋을 골라도 유지', () => {
  const r = { ...PRESETS.party.rules, coop: true, coopLevel: 'hard' as const };
  assert.equal(matchPreset(r), 'party');
  const room = new Room(fakeIo(), 'PRE', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  room.setRules(a, { rules: { coop: true, coopLevel: 'hard' } });
  room.setRules(a, { preset: 'party' });
  assert.deepEqual([room.rules.coop, room.rules.coopLevel], [true, 'hard']);
  room.destroy();
});

test('toGameRules: 협력전이면 180초·레이저/보스/견제/맵 끔·피버 충전 0·레이저 두께는 난이도', () => {
  const G = toGameRules({ ...DEFAULT_RULES, coop: true, coopLevel: 'hard' });
  assert.equal(G.roundMs, C.timeSec * 1000);
  assert.deepEqual([G.laser, G.boss, G.stealPenalty, G.sabotage, G.comeback, G.arcade, G.mapChance, G.markMs], [false, false, false, false, false, false, 0, 0]);
  assert.equal(G.feverGain, 0);
  assert.equal(G.laserHalf, (C.levels.hard.laserWidth / 100) * FIELD.h / 2);
  assert.ok(toGameRules({ ...DEFAULT_RULES, coop: true, coopLevel: 'easy' }).laserHalf < G.laserHalf);
});

test('엑스퍼트 난이도: 규칙 정리를 통과하고 하드보다 한 칸 더 세다', () => {
  assert.equal(sanitizeRules(DEFAULT_RULES, { coop: true, coopLevel: 'expert' }).coopLevel, 'expert');
  assert.equal(Object.keys(C.levels).length, 4);
  const { hard: h, expert: x } = C.levels;
  assert.ok(x.laserWarnMs <= h.laserWarnMs && x.laserWidth > h.laserWidth);
  assert.ok(x.threatCount > h.threatCount && x.threatSpeed > h.threatSpeed);
  assert.ok(x.crystalHits[0] > h.crystalHits[0] && x.crystalHits[1] > h.crystalHits[1] && x.crystalSec < h.crystalSec);
  assert.ok(x.safeCount <= h.safeCount && x.orbMult < h.orbMult && x.bulletEveryMs < h.bulletEveryMs);
});

test('난이도 표: 세 난이도 모두 있고 하드일수록 공격이 잦고 수정이 단단하다', () => {
  const L = C.levels;
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) assert.ok(L[k]);
  assert.ok(L.easy.bulletEveryMs > L.normal.bulletEveryMs && L.normal.bulletEveryMs > L.hard.bulletEveryMs);
  assert.ok(L.easy.laserWarnMs > L.hard.laserWarnMs && L.easy.crystalSec > L.hard.crystalSec);
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) {
    for (const gone of ['laserEvery', 'threatEvery', 'slamEvery', 'safeEvery', 'mapEvery', 'phase3Mult']) assert.ok(!(gone in L[k]), `${k}.${gone}`);
  }
});

test('circlePos: 레이드 보스는 bossY에 머물고 isOut·보호 구역 아님, 공격 원은 출발점에서 날아감', () => {
  const b = makeRaid(1, 0, 100);
  for (const t of [0, 1000, 4000, 60_000]) {
    assert.equal(circlePos(b, t).y, C.bossY);
    assert.ok(!isOut(b, t));
  }
  assert.ok(!isGuarded(b, 0));
  const th = makeThreat(2, 0, { x: FIELD.w / 2, y: FIELD.h / 2 }, Math.PI / 2, 100, 'a');
  assert.ok(!isGuarded(th, 0));
  assert.deepEqual(circlePos(th, 1000), { x: FIELD.w / 2, y: FIELD.h / 2 + 100 });
  assert.ok(isOut(th, 100_000));
  void seq;
});

test('협력전 원은 판 가운데를 지나도 잡힌다', () => {
  const c = makeOrb(1, 0, { x: FIELD.w / 2, y: FIELD.h / 2 }, Math.PI / 2, 0, 280);
  assert.equal(isGuarded(c, 0), false);
  assert.ok(isHit(c, 0, FIELD.w / 2, FIELD.h / 2));
  assert.equal(RULES.coop.orb.gapMs, 450);
});

test('큰 구체: 좌우 벽에서 반사, 여러 번 튕겨도 화면 안이며 반사 위치에서 클릭 가능', () => {
  const from = { x: FIELD.w / 2, y: 500 }, r = C.threatR;
  for (const angle of [0, Math.PI]) {
    const c = makeThreat(1, 0, from, angle, 300, 'a');
    const wallMs = (FIELD.w / 2 - r) / c.speed * 1000;
    const before = circlePos(c, wallMs - 100), after = circlePos(c, wallMs + 100);
    assert.ok(Math.abs(before.x - after.x) < 1e-8);
    assert.ok(isHit(c, wallMs + 100, after.x, after.y));
    for (const t of [wallMs, wallMs + 100, 10_000, 30_000]) {
      const p = circlePos(c, t);
      assert.ok(p.x >= r && p.x <= FIELD.w - r);
      assert.ok(!isOut(c, t));
    }
  }
});

test('큰 구체: 좌우 반사 뒤에도 아래로 이탈, 일반 공격 원은 벽에서 반사하지 않음', () => {
  const from = { x: FIELD.w - 100, y: C.bossY };
  const threat = makeThreat(1, 0, from, Math.PI / 6, 300, 'a');
  assert.equal(threat.speed, 300);
  const p = circlePos(threat, 1000);
  assert.ok(p.x < from.x, '오른쪽 벽에서 튕겨 왼쪽으로 진행');
  assert.ok(!isOut(threat, 1000));
  assert.ok(isOut(threat, 10_000), '아래로 나가면 놓친 구체로 처리');
  const orb = makeOrb(2, 0, from, 0, 0, 300);
  assert.ok(isOut(orb, 1000));
});

// ---------- 방 ----------

type CoopRunT = {
  activateSpecial(p: PlayerState, now: number): boolean;
  applyItem(p: PlayerState, item: 'weak' | 'missile', now: number, at: { x: number; y: number }): void;
  damage(p: PlayerState, by: CoopHitBy, now: number): boolean; threatEscaped(c: Circle, now: number): void;
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number; killed: boolean }; hitCrystal(p: PlayerState, c: Circle, now: number): boolean;
  tick(now: number): void; shift(delta: number): void; recheck(): void; phase: number; boss: Circle;
  state(withVolleys?: boolean): CoopState; result(now: number, startAt: number, win: boolean): CoopResult; isShielded(): boolean; inBurst(now: number): boolean;
  reportHurt(p: PlayerState, volleyId: number, shot: number, now: number): boolean;
};
type CRoom = {
  coop: CoopRunT; startAt: number; endAt: number; circles: Map<number, Circle>; pausedAt: number;
  lasers: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number; hit: Set<string> }[];
  cursors: Map<string, { x: number; y: number; at: number }>; G: { roundMs: number };
  updateLaser(now: number): void; tick(): void; clickLog: Map<string, number[]>;
};

function coopRoom(humans = 1, bots = 4 - humans, level: 'easy' | 'normal' | 'hard' | 'expert' = 'normal') {
  const room = new Room(fakeIo(), 'COOP', () => {});
  const ids: string[] = [];
  for (let i = 0; i < humans; i++) ids.push((room.join(`s${i}`, `k${i}`, `P${i}`) as { id: string }).id);
  room.setRules(ids[0]!, { rules: { coop: true, coopLevel: level } });
  for (let i = 0; i < bots; i++) room.addBot(ids[0]!); // 봇을 넣으면 준비가 풀리므로 먼저
  for (const id of ids.slice(1)) room.setReady(id, true);
  sent.length = 0;
  assert.equal(room.start(ids[0]!), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === ids[0])!;
  return { room, r, me, ids };
}
const overOf = () => sent.find((s) => s.ev === 'game:over')?.d as GameOver | undefined;
const crystals = (r: CRoom) => [...r.circles.values()].filter((c) => c.kind === 'crystal');
const orbOf = (kind: Circle['kind'], now: number) => makeOrb(9000 + Math.floor(Math.random() * 1e6), now, { x: 550, y: 600 }, 0, kind, 0);
/** 보스 체력을 단계 경계 바로 위로 두고 원 하나로 보호막을 연다 */
function toShield(r: CRoom, me: PlayerState, now: number, edge = C.phaseAt[0]) {
  const b = r.coop.boss;
  b.hp = b.maxHp! * edge + 0.5;
  r.coop.catchOrb(me, orbOf(me.color, now), now);
  assert.equal(r.coop.isShielded(), true);
}
/** 내 수정을 다 깬다 */
function breakMine(r: CRoom, p: PlayerState, now: number) {
  const c = crystals(r).find((x) => x.target === p.id)!;
  while (r.circles.has(c.id)) r.coop.hitCrystal(p, c, now);
}

type SkillRun = { useSkill(k: CoopSkill, now: number): void; rand: () => number };
/** 고유 패턴 호출 기록 (useSkill을 감싼다) */
function spySkills(r: CRoom) {
  const run = r.coop as unknown as SkillRun;
  const orig = run.useSkill.bind(run);
  const calls: { k: CoopSkill; t: number }[] = [];
  run.useSkill = (k, now) => { calls.push({ k, t: now }); orig(k, now); };
  return calls;
}
const sealsSent = () => sent.filter((s) => s.ev === 'coop:seal').map((s) => s.d as Seal | null);
const beamsSent = () => sent.filter((s) => s.ev === 'coop:beam').map((s) => s.d as Beam | null);
/** 저절로 나오는 고유 패턴을 막는다 (직접 부른 패턴만 보려고) */
const noSkills = (r: CRoom) => { (r.coop as unknown as { nextSkill: number }).nextSkill = Infinity; };

test('압살: 엑스퍼트 2·3단계 전용, 한 줄 안전과 3초 예고', () => {
  const boss = COOP_BOSSES.core;
  for (const phase of [1, 2, 3] as const) assert.ok(!boss.skills[phase].includes('crush'));
  assert.ok(!boss.expertSkills[1]?.includes('crush'));
  assert.ok(boss.expertSkills[2]!.includes('crush') && boss.expertSkills[3]!.includes('crush'));
  for (const level of ['normal', 'hard', 'expert'] as const) {
    for (const phase of [1, 2] as const) {
      const { room, r } = coopRoom(1, 0, level);
      r.coop.phase = phase;
      const t = r.startAt + 5000;
      (r.coop as unknown as SkillRun).useSkill('crush', t);
      const seal = r.coop.state().seal;
      if (level === 'expert' && phase === 2) {
        assert.equal(seal?.lethal, true);
        assert.equal(new Set(seal!.lanes).size, 2);
        assert.equal(seal!.at, t + C.crush.warnMs + C.crush.snapMs);
      } else assert.equal(seal, null);
      room.destroy();
    }
  }
});

test('압살: 예고 중 안전, 무적·방어막 관통 즉사와 안전 구역의 단발 판정', () => {
  const { room, r, me, ids } = coopRoom(2, 0, 'expert');
  noSkills(r); r.coop.phase = 2;
  const other = room.players.find((p) => p.id === ids[1])!;
  const t = r.startAt + 5000;
  (r.coop as unknown as SkillRun).useSkill('crush', t);
  const s = r.coop.state().seal!;
  const safe = [0, 1, 2].find((lane) => !s.lanes.includes(lane))!;
  const badX = (s.lanes[0]! + 0.5) * FIELD.w / 3;
  r.cursors.set(me.id, { x: badX, y: 700, at: t });
  r.cursors.set(other.id, { x: (safe + 0.5) * FIELD.w / 3, y: 700, at: t });
  me.immuneUntil = s.at + 10_000; me.coopFx!.guardUntil = s.at + 10_000;
  r.coop.tick(s.at - 1);
  assert.equal(me.hp, C.hpMax);
  r.coop.tick(s.at);
  assert.equal(me.hp, 0); assert.ok(me.outAt);
  assert.equal(other.hp, C.hpMax);
  r.cursors.set(other.id, { x: badX, y: 700, at: s.at + 1 });
  r.coop.tick(s.at + 100);
  assert.equal(other.hp, C.hpMax);
  const hit = sent.filter((x) => x.ev === 'coop:hit').find((x) => (x.d as { by: string }).by === 'crush')!;
  assert.equal((hit.d as { dmg: number }).dmg, C.hpMax);
  room.destroy();
});

test('압살: 지연된 틱 판정, 일시정지 보정과 보호막 진입 취소', () => {
  const { room, r, me, ids } = coopRoom(2, 0, 'expert');
  noSkills(r); r.coop.phase = 2;
  const other = room.players.find((p) => p.id === ids[1])!;
  const t = r.startAt + 5000;
  (r.coop as unknown as SkillRun).useSkill('crush', t);
  const before = r.coop.state().seal!;
  r.coop.shift(5000);
  const s = r.coop.state().seal!;
  assert.equal(s.at, before.at + 5000); assert.equal(s.warnAt, before.warnAt + 5000);
  assert.equal(s.lethal, true);
  const safe = [0, 1, 2].find((l) => !s.lanes.includes(l))!;
  r.cursors.set(me.id, { x: (s.lanes[0]! + 0.5) * FIELD.w / 3, y: 700, at: t });
  r.cursors.set(other.id, { x: (safe + 0.5) * FIELD.w / 3, y: 700, at: t });
  r.coop.tick(s.until + 100);
  assert.equal(me.hp, 0); assert.equal(other.hp, C.hpMax);
  assert.equal(r.coop.state().seal, null);
  (r.coop as unknown as SkillRun).useSkill('crush', s.until + 200);
  toShield(r, other, s.until + 300, C.phaseAt[1]);
  assert.equal(r.coop.state().seal, null);
  room.destroy();
});

test('엑스퍼트 단계 상승: 실제 탄막 간격·속도와 큰 구체 수·속도에 단계별 수치 적용', async () => {
  const { coopAttackRules, coopThreatCount, threatSpeed } = await import('../src/index.ts');
  const { room, r } = coopRoom(1, 0, 'expert');
  const run = r.coop as unknown as { bulletGap(): number; fireVolley(shape: 'ring', at: number): void };
  const gaps: number[] = [];
  for (const [phase, speed, count, threat] of [[1, 320, 5, 280], [2, 380, 7, 340], [3, 440, 9, 400]] as const) {
    r.coop.phase = phase;
    const attack = coopAttackRules('expert', phase);
    gaps.push(run.bulletGap());
    assert.equal(run.bulletGap(), attack.bulletEveryMs / C.bullets.phaseMult[phase - 1]!);
    assert.equal(coopThreatCount('expert', phase), count);
    assert.equal(threatSpeed('expert', phase), threat);
    sent.length = 0;
    run.fireVolley('ring', r.startAt + 5000);
    const volley = sent.find((s) => s.ev === 'coop:volley')!.d as Volley;
    for (const shot of volley.shots) assert.ok(shot.v >= speed * 0.8 - 1e-9 && shot.v <= speed * 1.2 + 1e-9);
  }
  assert.ok(gaps[0]! > gaps[1]! && gaps[1]! > gaps[2]!);
  assert.ok(gaps[0]! > C.levels.hard.bulletEveryMs * 0.8, '1단계는 하드에 가까운 발사 간격');
  assert.deepEqual(C.levels.expert.crystalHits, [12, 24]);
  for (const level of ['easy', 'normal', 'hard'] as const) {
    for (const phase of [1, 2, 3] as const) assert.equal(coopAttackRules(level, phase), C.levels[level]);
  }
  room.destroy();
});

test('스페셜 어택: 대기실 선택·준비 해제, 게임 중 변경 금지', () => {
  const room = new Room(fakeIo(), 'SPCL', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  const b = (room.join('s2', 'k2', 'B') as { id: string }).id;
  room.setRules(a, { rules: { coop: true } });
  room.setReady(b, true);
  room.setSpecial(b, 'meteor');
  const p = room.players.find((x) => x.id === b)!;
  assert.equal(p.coopSpecial, 'meteor');
  assert.equal(p.ready, false);
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  room.setSpecial(b, 'blades');
  assert.equal(p.coopSpecial, 'meteor');
  assert.equal(p.coopCharge, 0);
  room.destroy();
});

test('스페셜 어택: 종류별 충전량·피해, 연타 중복 방지와 공격 후 게이지', () => {
  for (const kind of COOP_ATTACK_SPECIAL_IDS) {
    const { room, r, me } = coopRoom(1, 0);
    noSkills(r);
    const now = r.startAt + 5000, spec = attackSpecialRule(kind);
    me.coopSpecial = kind;
    r.cursors.set(me.id, { x: 550, y: 700, at: now });
    me.coopCharge = spec.charge - 1;
    assert.equal(r.coop.activateSpecial(me, now), false);
    r.coop.catchOrb(me, orbOf(me.color, now), now);
    assert.equal(me.coopCharge, spec.charge);
    const hp = r.coop.boss.hp!, immune = me.immuneUntil;
    assert.equal(r.coop.activateSpecial(me, now), true);
    assert.equal(r.coop.activateSpecial(me, now), false);
    assert.equal(me.coopCharge, 0);
    assert.equal(me.immuneUntil, immune);
    assert.equal(r.coop.state().specials?.[0]?.kind, kind);
    r.coop.tick(now + spec.durationMs);
    assert.ok(Math.abs(r.coop.boss.hp! - (hp - spec.damage)) < 1e-8, kind);
    assert.equal(r.coop.state().specials?.length, 0);
    room.destroy();
  }
});

test('딜 타임과 약점 노출: 스페셜 어택은 고정 피해, 원 획득 피해는 증폭', (t) => {
  for (const kind of COOP_ATTACK_SPECIAL_IDS) {
    const { room, r, me } = coopRoom(1, 0, 'hard');
    t.after(() => room.destroy());
    const now = r.startAt + 5000, spec = attackSpecialRule(kind);
    const normal = r.coop.catchOrb(me, orbOf(me.color, now - 1), now - 1).dmg;
    r.coop.phase = 2;
    toShield(r, me, now, C.phaseAt[1]);
    breakMine(r, me, now);
    assert.equal(r.coop.phase, 3);
    assert.equal(r.coop.inBurst(now + spec.durationMs), true);
    const at = { x: 550, y: 700 };
    r.coop.applyItem(me, 'weak', now, at);
    const orb = r.coop.catchOrb(me, orbOf(me.color, now), now).dmg;
    assert.ok(Math.abs(orb - normal * C.burst.mult * C.items.weakMult) < 1e-9);

    me.coopSpecial = kind;
    me.coopCharge = spec.charge;
    r.cursors.set(me.id, { x: 550, y: 700, at: now });
    const hp = r.coop.boss.hp!;
    assert.equal(r.coop.activateSpecial(me, now), true);
    r.coop.tick(now + spec.durationMs);
    assert.ok(Math.abs(hp - r.coop.boss.hp! - spec.damage) < 1e-8, kind);
  }
});

test('스페셜 어택: 보호막·기절·탈락·일시정지 중 발동 차단, 재개 시 공격 시각 보정', () => {
  const { room, r, me } = coopRoom(1, 0);
  noSkills(r);
  const now = r.startAt + 5000;
  me.coopCharge = specialRule('laser').charge;
  r.cursors.set(me.id, { x: 550, y: 700, at: now });
  me.stunUntil = now + 1000;
  assert.equal(r.coop.activateSpecial(me, now), false);
  me.stunUntil = 0;
  me.outAt = now;
  assert.equal(r.coop.activateSpecial(me, now), false);
  me.outAt = 0;
  r.startAt = Date.now() - 10_000;
  r.pausedAt = Date.now();
  room.coopSpecial(me.id);
  assert.equal(me.coopCharge, specialRule('laser').charge);
  assert.equal(r.coop.state().specials?.length, 0);
  r.pausedAt = 0;
  assert.equal(r.coop.activateSpecial(me, now), true);
  r.coop.shift(3000);
  assert.equal(r.coop.state().specials?.[0]?.at, now + 3000);
  const hp = r.coop.boss.hp;
  r.coop.tick(now + 3000);
  assert.equal(r.coop.boss.hp, hp);
  toShield(r, me, now + 3050);
  me.coopCharge = specialRule('laser').charge;
  assert.equal(r.coop.activateSpecial(me, now + 3050), false);
  assert.equal(me.coopCharge, specialRule('laser').charge);
  room.destroy();
});

test('스페셜 어택: 큰 원 충전 상한, 동시 발동, 보스 처치 후 공격 종료', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  noSkills(r);
  const other = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000;
  for (const p of [me, other]) {
    for (let i = 0; i < 20; i++) (r.coop as unknown as { popThreat(p: PlayerState, c: Circle, t: number): number }).popThreat(p, makeThreat(i, now, { x: 550, y: 200 }, 1, 100, p.id), now);
    assert.equal(p.coopCharge, specialRule('laser').charge);
    r.cursors.set(p.id, { x: 550, y: 700, at: now });
    assert.equal(r.coop.activateSpecial(p, now), true);
  }
  assert.equal(r.coop.state().specials?.length, 2);
  r.coop.phase = 3;
  r.coop.boss.hp = 1;
  const run = r.coop;
  r.coop.tick(now + 200);
  assert.equal(overOf()?.coop?.win, true);
  assert.equal(run.state().specials?.length, 0);
  assert.equal(me.coopCharge, undefined);
  room.destroy();
});

test('coop 시작: 레이드 보스 1마리, 사람 체력 100·봇 0, 판 180초', () => {
  const { room, r, me } = coopRoom();
  assert.equal(room.players.length, 4);
  const raids = [...r.circles.values()].filter((c) => c.boss === 'raid');
  assert.equal(raids.length, 1);
  assert.equal(raids[0]!.maxHp, raidMaxHp(1, 3));
  assert.equal(me.hp, C.hpMax);
  assert.ok(room.players.filter((p) => p.bot).every((p) => p.hp === 0));
  assert.equal(r.G.roundMs, C.timeSec * 1000);
  room.destroy();
});

test('coop 원: 판 가운데 원 없음, 보스 자리에서 사람·봇 색 원과 노란 원만 나옴', () => {
  const { room, r } = coopRoom(1, 3);
  const t = r.startAt + 1000;
  for (let k = 0; k < 20; k++) r.coop.tick(t + k * 500);
  const orbs = [...r.circles.values()].filter((c) => c.boss !== 'raid' && c.kind !== 'threat');
  assert.ok(orbs.length >= 15, String(orbs.length));
  const colors = new Set(room.players.map((p) => p.color as Circle['kind']));
  for (const o of orbs) {
    assert.ok(o.from, '보스 자리에서 출발');
    // 가끔 ? 원 (보스전 아이템)
    assert.ok(colors.has(o.kind) || o.kind === 'y' || (o.kind === 'item' && o.coopItem), String(o.kind));
  }
  room.destroy();
});

test('coop 원: 내 색 원을 누르면 보스 피해·기록, 남의 색은 못 잡음, 보스를 눌러도 아무 일 없음', () => {
  const { room, r, me } = coopRoom(1, 3);
  const bot = room.players.find((p) => p.bot)!;
  r.startAt = Date.now() - 1000; // 시작 카운트다운 건너뜀
  const now = Date.now();
  const hp0 = r.coop.boss.hp!;
  const mine = makeOrb(70_001, now - 100_000, { x: 550 - 0, y: 700 }, 0, me.color, 0);
  r.circles.set(mine.id, mine);
  r.clickLog.clear();
  room.click(me.id, { circleId: mine.id, x: 550, y: 700 });
  assert.equal(r.coop.boss.hp, hp0 - orbDamage({ ...me, combo: 0 }, me.color, false));
  assert.ok(r.coop.result(now, r.startAt, false).players[me.id]!.dmg > 0);
  assert.equal(me.combo, 1);
  const theirs = makeOrb(70_002, now - 100_000, { x: 300, y: 800 }, 0, bot.color, 0);
  r.circles.set(theirs.id, theirs);
  r.clickLog.clear();
  room.click(me.id, { circleId: theirs.id, x: 300, y: 800 });
  assert.ok(r.circles.has(theirs.id), '남의 색은 그대로');
  assert.ok(sent.some((s) => s.ev === 'click:rejected'));
  const hp1 = r.coop.boss.hp!;
  const bp = circlePos(r.coop.boss, Date.now());
  r.clickLog.clear();
  room.click(me.id, { circleId: r.coop.boss.id, x: bp.x, y: bp.y });
  assert.deepEqual([r.coop.boss.hp, me.combo], [hp1, 1], '보스 클릭은 피해·콤보 변화 없음');
  assert.equal(me.fever, 0, '피버 게이지가 차지 않음');
  room.destroy();
});

test('coop 보호막: 67%에 닿으면 무적, 사람·봇마다 수정, 원 뿜기 멈춤', () => {
  const { room, r, me } = coopRoom(1, 3);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  assert.ok(r.coop.state().shield);
  assert.equal(crystals(r).length, 4);
  assert.ok(crystals(r).every((c) => c.hp === crystalHp('normal', 0)));
  const hp = r.coop.boss.hp;
  assert.equal(r.coop.catchOrb(me, orbOf(me.color, now + 10), now + 10).dmg, 0);
  assert.equal(r.coop.boss.hp, hp);
  const before = r.circles.size;
  for (let k = 0; k < 5; k++) r.coop.tick(now + 100 + k * 1000);
  assert.equal(r.circles.size, before, '보호막 중 원이 안 나옴');
  room.destroy();
});

test('coop 수정: 타격자 색에 따라 체력이 깎이고 모두 깨면 큰 피해 (피해 2배)', () => {
  const { room, r, me } = coopRoom(1, 1);
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const mine = crystals(r).find((c) => c.target === me.id)!;
  r.coop.hitCrystal(bot, mine, now);
  assert.equal(mine.hp, crystalHp('normal', 0) - C.crystal.otherColorDamage);
  r.coop.hitCrystal(me, mine, now);
  assert.equal(mine.hp, crystalHp('normal', 0) - C.crystal.otherColorDamage - C.crystal.sameColorDamage);
  breakMine(r, me, now);
  assert.equal(r.coop.isShielded(), true, '봇 수정이 남음');
  breakMine(r, bot, now);
  assert.equal(r.coop.isShielded(), false);
  assert.ok(r.coop.inBurst(now + 100));
  me.combo = 0;
  const d = r.coop.catchOrb(me, orbOf(me.color, now + 100), now + 100).dmg;
  assert.equal(d, 2);
  room.destroy();
});

test('coop 큰 피해가 끝나면 2단계', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  r.coop.tick(now + C.burst.maxMs + 10);
  assert.equal(r.coop.phase, 2);
  assert.equal(r.coop.state().shield, null);
  room.destroy();
});

test('coop 큰 피해 구간에도 단계 경계에서 멈추고 보호막', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  r.coop.tick(now + C.burst.maxMs + 10); // 2단계
  const t2 = now + C.burst.maxMs + 100;
  toShield(r, me, t2, C.phaseAt[1]);
  breakMine(r, me, t2);
  r.coop.tick(t2 + C.burst.maxMs + 10);
  assert.equal(r.coop.phase, 3);
  // 다시: 2단계에서 큰 피해 중 경계 → 33%에서 멈춤
  const { room: room2, r: r2, me: me2 } = coopRoom(1, 0);
  const n2 = r2.startAt + 5000;
  toShield(r2, me2, n2);
  breakMine(r2, me2, n2);
  r2.coop.tick(n2 + C.burst.maxMs + 10);
  const b = r2.coop.boss;
  // 2단계 시작 직후 큰 피해 구간을 흉내: 경계 바로 위에서 큰 피해 원
  b.hp = b.maxHp! * C.phaseAt[1] + 1;
  const t3 = n2 + C.burst.maxMs + 200;
  r2.coop.catchOrb(me2, orbOf(me2.color, t3), t3);
  assert.ok(Math.abs(b.hp! - b.maxHp! * C.phaseAt[1]) < 1e-9);
  assert.equal(r2.coop.state().shield?.no, 1);
  room.destroy(); room2.destroy();
});

test('수정 실패: 폭발 한 번, 다음 단계로 전환, 폭주 중 보스 피해 차단', (t) => {
  const { room, r, me } = coopRoom(2, 0);
  t.after(() => room.destroy());
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const c = crystals(r).find((x) => x.target === me.id)!;
  const ids = crystals(r).map((x) => x.id);
  const end = r.coop.state().shield!.until;
  const failAt = end + C.rageWarnMs;
  r.coop.tick(end);
  assert.equal(r.coop.state().rageAt, failAt);
  assert.equal(r.coop.hitCrystal(me, c, end + 1), false);
  assert.equal(c.hp, crystalHp('normal', 0));

  sent.length = 0;
  r.coop.tick(failAt);
  assert.deepEqual(sent.filter((s) => s.ev === 'coop:crystalFail').map((s) => s.d), [{ ids }]);
  assert.deepEqual(crystals(r), []);
  assert.equal(r.coop.state().phase, 2);
  assert.equal(r.coop.state().burstUntil, 0);
  assert.equal(r.coop.state().rampageUntil, failAt + C.rampageMs);
  assert.ok(room.players.every((p) => p.hp === C.hpMax - C.levels.normal.hurt.rage));

  const hp = r.coop.state().hp;
  const during = failAt + 10;
  assert.equal(r.coop.catchOrb(me, orbOf(me.color, during), during).dmg, 0);
  r.coop.applyItem(me, 'missile', during, { x: 550, y: 700 });
  r.coop.tick(during + 2400);
  assert.equal(r.coop.state().hp, hp);
  assert.equal(sent.filter((s) => s.ev === 'coop:crystalFail').length, 1);

  const resumeAt = failAt + C.rampageMs;
  me.coopSpecial = 'laser';
  me.coopCharge = specialRule('laser').charge;
  r.cursors.set(me.id, { x: 550, y: 700, at: resumeAt });
  assert.equal(r.coop.activateSpecial(me, resumeAt - 1), false);
  assert.equal(me.coopCharge, specialRule('laser').charge);
  assert.ok(r.coop.catchOrb(me, orbOf(me.color, resumeAt), resumeAt).dmg > 0);
  assert.equal(r.coop.isShielded(), false);
});

test('수정 구간 중 탈락하면 그 사람 수정이 치워진다 (깬 것으로 침)', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  other.hp = 1;
  r.coop.damage(other, 'laser', now + 10);
  assert.ok(other.outAt > 0);
  assert.equal(crystals(r).filter((c) => c.target === other.id).length, 0);
  breakMine(r, me, now + 9000);
  assert.equal(r.coop.isShielded(), false);
  room.destroy();
});

test('coop 사람 1명이면 수정 1개, 깨면 큰 피해', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  assert.equal(crystals(r).length, 1);
  breakMine(r, me, now);
  assert.ok(r.coop.inBurst(now + 1));
  room.destroy();
});

test('coop 내려찍기: 경고 원 안에 그대로 있으면 −1, 피하면 그대로', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  breakMine(r, other, now);
  const t = now + C.burst.maxMs + 10;
  r.coop.tick(t); // 2단계
  r.cursors.set(me.id, { x: 500, y: 600, at: Date.now() + 1e9 });
  r.cursors.set(other.id, { x: 300, y: 800, at: Date.now() + 1e9 });
  noSkills(r);
  sent.length = 0;
  (r.coop as unknown as SkillRun).useSkill('slam', t + 100);
  const slams = sent.find((s) => s.ev === 'coop:slam')!.d as { owner: string; at: number }[];
  assert.equal(slams.length, 2);
  r.cursors.set(other.id, { x: 900, y: 400, at: Date.now() + 1e9 }); // 피함
  r.coop.tick(slams[0]!.at + 1);
  assert.deepEqual([me.hp, other.hp], [100 - N.slam, 100]);
  room.destroy();
});

test('coop 안전지대: 발동 순간 밖이면 −(노말 안전지대), 안이면 그대로', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  r.coop.phase = 3;
  const t = r.startAt + 5000;
  noSkills(r);
  sent.length = 0;
  (r.coop as unknown as SkillRun).useSkill('safe', t);
  const s = sent.find((x) => x.ev === 'coop:safe' && x.d)!.d as SafeZones;
  const z = safeZoneAt(s, 0, s.at);
  r.cursors.set(me.id, { x: z.x, y: z.y, at: Date.now() + 1e9 });
  r.cursors.set(other.id, { x: 5, y: FIELD.h - 5, at: Date.now() + 1e9 });
  r.coop.tick(s.at + 1);
  assert.equal(me.hp, 100);
  assert.equal(other.hp, 100 - N.safe);
  room.destroy();
});

test('coop 일시정지하면 보호막 제한 시간과 큰 피해 끝이 밀림', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const u = r.coop.state().shield!.until;
  r.coop.shift(5000);
  assert.equal(r.coop.state().shield!.until, u + 5000);
  breakMine(r, me, now);
  const b = r.coop.state().burstUntil;
  r.coop.shift(3000);
  assert.equal(r.coop.state().burstUntil, b + 3000);
  room.destroy();
});

test('coop 결과: 사람마다 대미지·큰 피해 대미지·수정·추적 원, 보호막 기록', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  r.coop.catchOrb(me, orbOf(me.color, now), now);
  toShield(r, me, now + 10);
  breakMine(r, me, now + 2010);
  r.coop.catchOrb(me, orbOf(me.color, now + 2100), now + 2100);
  const res = r.coop.result(now + 3000, r.startAt, false);
  const mine = res.players[me.id]!;
  assert.ok(mine.dmg > mine.burstDmg && mine.burstDmg > 0);
  assert.equal(mine.crystals, 1);
  assert.deepEqual(res.breaks, [{ ms: 2000, rages: 0, burstMs: 9000 }]);
  assert.equal(res.maxHp, r.coop.boss.maxHp);
  room.destroy();
});

test('피격: 노말 레이저 −30, 무적 2초, 기절 1초', () => {
  const { room, r, me } = coopRoom();
  const shoot = (now: number) => {
    r.cursors.set(me.id, { x: 100, y: 100, at: now });
    r.lasers.push({ lines: [{ a: { x: 0, y: 100 }, b: { x: FIELD.w, y: 100 } }], at: now, hit: new Set() });
    r.updateLaser(now);
  };
  const t0 = r.startAt + 5000;
  shoot(t0);
  assert.equal(me.hp, C.hpMax - 30);
  assert.equal(N.laser, 30);
  assert.equal(me.immuneUntil, t0 + C.hurtFx.laser.immuneMs);
  assert.equal(C.hurtFx.laser.immuneMs, 2000);
  assert.equal(me.stunUntil, t0 + 1000);
  room.destroy();
});

test('피격: 무적 중이면 깎이지 않음', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.damage(me, 'laser', now), true);
  assert.equal(r.coop.damage(me, 'slam', now + 1500), false);
  assert.equal(me.hp, C.hpMax - N.laser);
  assert.equal(r.coop.damage(me, 'slam', now + 2000), true);
  assert.equal(me.hp, C.hpMax - N.laser - N.slam);
  room.destroy();
});

test('피격: 종류별 무적·기절 (탄 0.6초 기절 없음, 추적 1초, 분노 2초 기절 없음)', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.damage(me, 'bullet', now);
  assert.deepEqual([me.hp, me.immuneUntil, me.stunUntil], [C.hpMax - N.bullet, now + 600, 0]);
  r.coop.damage(me, 'threat', now + 600);
  assert.deepEqual([me.hp, me.immuneUntil, me.stunUntil], [C.hpMax - N.bullet - N.threat, now + 1600, 0]);
  r.coop.damage(me, 'rage', now + 1600);
  assert.equal(me.immuneUntil, now + 3600);
  assert.equal(me.stunUntil, 0);
  r.coop.damage(me, 'seal', now + 3600);
  assert.equal(me.stunUntil, now + 4600);
  room.destroy();
});

test('피격: 체력 0이면 탈락, 모두 탈락이면 패배', () => {
  const { room, r, me, ids } = coopRoom(2);
  const other = room.players.find((p) => p.id === ids[1])!;
  const t = r.startAt + 5000;
  me.hp = 20;
  r.coop.damage(me, 'laser', t);
  assert.equal(me.hp, 0);
  assert.ok(me.outAt > 0);
  assert.equal(room.phase, 'play');
  const hp = r.coop.boss.hp;
  r.coop.catchOrb(me, orbOf(me.color, t + 10_000), t + 10_000);
  assert.equal(r.coop.boss.hp, hp);
  other.hp = 30;
  r.coop.damage(other, 'slam', t + 20_000);
  assert.equal(room.phase, 'lobby');
  assert.equal(overOf()?.coop?.win, false);
  assert.equal(overOf()?.coop?.reason, 'wipe');
  room.destroy();
});

test('회복: 큰 피해 구간 시작에 노말 +20(최대 100), 엑스퍼트는 회복 없음', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  me.hp = 50; other.hp = 90;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  breakMine(r, other, now);
  assert.equal(r.coop.inBurst(now + 1), true);
  assert.deepEqual([me.hp, other.hp], [50 + C.heal.burstStart.normal, C.hpMax]);
  room.destroy();
  const ex = coopRoom(1, 0, 'expert');
  ex.me.hp = 50;
  toShield(ex.r, ex.me, ex.r.startAt + 5000);
  breakMine(ex.r, ex.me, ex.r.startAt + 5000);
  const prism = crystals(ex.r).find((c) => c.prism)!;
  for (let damage = 0; damage < C.crystal.prismHp; damage += C.crystal.otherColorDamage) {
    ex.r.coop.hitCrystal(ex.me, prism, ex.r.startAt + 5000);
  }
  assert.equal(ex.r.coop.inBurst(ex.r.startAt + 5001), true);
  assert.equal(ex.me.hp, 50);
  ex.room.destroy();
});

test('회복은 바로 players로 알리고, coop:hit에 피해량이 실림', () => {
  const { room, r, me } = coopRoom(1, 0);
  me.hp = 50;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  sent.length = 0;
  breakMine(r, me, now);
  const healed = sent.find((x) => x.ev === 'players');
  assert.ok(healed, '회복 뒤 players 전송');
  assert.equal((healed!.d as PlayerState[]).find((p) => p.id === me.id)!.hp, 50 + C.heal.burstStart.normal);
  sent.length = 0;
  r.coop.damage(me, 'laser', now + 5000);
  const hit = sent.find((x) => x.ev === 'coop:hit')!.d as { dmg: number; hp: number };
  assert.deepEqual([hit.dmg, hit.hp], [N.laser, 50 + C.heal.burstStart.normal - N.laser]);
  room.destroy();
});

test('엑스퍼트 수정 폭발: 수호 결계로 피해가 줄고 폭주 후 전투가 이어진다', (t) => {
  const { room, r, me } = coopRoom(1, 0, 'expert');
  t.after(() => room.destroy());
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const end = r.coop.state().shield!.until;
  r.coop.tick(end);
  const failAt = end + C.rageWarnMs;
  me.coopSpecial = 'ward';
  me.coopCharge = C.special.support.ward.charge;
  r.cursors.set(me.id, { x: 550, y: 700, at: failAt });
  assert.equal(r.coop.activateSpecial(me, failAt), true);
  r.coop.tick(failAt);
  assert.equal(room.phase, 'play');
  assert.equal(r.coop.state().phase, 2);
  assert.equal(r.coop.state().rampageUntil, failAt + C.rampageMs);
  assert.equal(me.hp, 46);
});

test('난이도 표: 모든 단계에서 모든 공격의 피해가 유한함', () => {
  const by = Object.keys(C.hurtFx);
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) {
    assert.deepEqual(Object.keys(C.levels[k].hurt).sort(), [...by].sort());
    for (const b of by) {
      const damage = C.levels[k].hurt[b as CoopHitBy];
      assert.ok(Number.isFinite(damage) && damage > 0);
    }
  }
});

test('coop 피격: 겹친 피격은 한 번', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.damage(me, 'laser', now), true);
  r.coop.threatEscaped(makeThreat(999, now, { x: 0, y: 0 }, 0, 100, me.id), now);
  assert.equal(r.coop.damage(me, 'seal', now), false);
  assert.equal(me.hp, C.hpMax - N.laser);
  room.destroy();
});

test('coop 추적 원: 놓치면 표적만 −(추적), 봇·탈락한 표적이면 그대로', () => {
  const { room, r, me } = coopRoom(2);
  const other = room.players.find((p) => !p.bot && p.id !== me.id)!;
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  r.coop.threatEscaped(makeThreat(900, now, { x: 0, y: 0 }, 0, 100, me.id), now);
  assert.deepEqual([me.hp, other.hp], [C.hpMax - N.threat, C.hpMax]);
  r.coop.threatEscaped(makeThreat(901, now + 3000, { x: 0, y: 0 }, 0, 100, bot.id), now + 3000);
  assert.equal(bot.hp, 0);
  other.outAt = 1;
  const before = other.hp;
  r.coop.threatEscaped(makeThreat(902, now + 6000, { x: 0, y: 0 }, 0, 100, other.id), now + 6000);
  assert.equal(other.hp, before);
  room.destroy();
});

test('coop 승리: 보스 체력 0이면 game:over coop.win, 사람 모두 1승, 결과에 대미지', () => {
  const { room, r, me } = coopRoom();
  const boss = r.coop.boss;
  boss.hp = 0.5;
  r.coop.phase = 3;
  r.startAt = Date.now() - 1000;
  const now = Date.now();
  const o = makeOrb(80_001, now - 100_000, { x: 550, y: 700 }, 0, me.color, 0);
  r.circles.set(o.id, o);
  r.clickLog.clear();
  room.click(me.id, { circleId: o.id, x: 550, y: 700 });
  assert.equal(room.phase, 'lobby');
  const over = overOf()!;
  assert.equal(over.coop?.win, true);
  assert.ok((over.coop?.stars ?? 0) >= 1);
  assert.equal(over.wins[me.id], 1);
  assert.ok(over.coop!.players[me.id]!.dmg > 0);
  room.destroy();
});

test('coop 시간 끝: 패배', () => {
  const { room, r } = coopRoom();
  r.startAt = Date.now() - 10_000;
  r.endAt = Date.now() - 1;
  r.tick();
  assert.equal(room.phase, 'lobby');
  assert.equal(overOf()?.coop?.win, false);
  room.destroy();
});

test('coop 리뷰: 살아 있던 마지막 사람이 나가면 봇만 남아 패배로 끝', () => {
  const { room, me } = coopRoom(1, 3);
  room.leave(me.id, 's0');
  assert.equal(overOf()?.coop?.win, false);
  room.destroy();
});

test('coop 봇: 보호막 중엔 자기 수정, 평소엔 자기 색 원, 보스·남의 색은 노리지 않음', () => {
  const bot = new Bot(2);
  const me = newPlayer('b1', '봇', 1, true);
  const now = 1_000_000;
  const old = now - 100_000;
  const raid = makeRaid(1, old, 100);
  const myCrystal = makeCrystal(2, old, { x: 100, y: 900 }, me.id, 1, 8);
  const otherCrystal = makeCrystal(3, old, { x: 900, y: 900 }, 'x', 2, 8);
  const mine = makeOrb(4, now - 5000, { x: 550, y: 700 }, 0, 1, 0);
  const theirs = makeOrb(5, now - 5000, { x: 300, y: 700 }, 0, 2, 0);
  const pick = (cs: Circle[]) => { (bot as unknown as { next: number }).next = 1; return bot.think(me, cs, [me], now, false, true); };
  for (let k = 0; k < 20; k++) assert.notEqual(pick([raid, myCrystal, otherCrystal, mine])?.id, 3);
  // 고르는 난수를 0~1에 고르게 펼쳐 둔다 (think는 다음 시각 → 고르기 순으로 난수를 두 번 쓴다). 우연히 원만 고르는 일이 없게
  const us = Array.from({ length: 20 }, (_, k) => [0.5, (k + 0.5) / 20]).flat();
  let ui = 0;
  const rnd = mock.method(Math, 'random', () => us[ui++ % us.length]!);
  let crystalHitsN = 0;
  for (let k = 0; k < 20; k++) if (pick([raid, myCrystal, mine])?.id === 2) crystalHitsN++;
  rnd.mock.restore();
  assert.ok(crystalHitsN >= 14, String(crystalHitsN));
  for (let k = 0; k < 10; k++) assert.equal(pick([raid, theirs]), null);
  for (let k = 0; k < 10; k++) assert.equal(pick([raid, mine])?.id, 4);
});

test('gameRecord: 협력전이면 사람마다 대미지와 보호막 기록', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  r.coop.catchOrb(me, orbOf(me.color, now), now);
  const res = r.coop.result(now + 1000, r.startAt, false);
  const rec = gameRecord({ rules: room.rules, ranking: room.players, roundMs: C.timeSec * 1000, solo: false, coop: res } as never) as { coopResult?: { damage: Record<string, number>; breaks: unknown[] } };
  assert.ok(rec.coopResult!.damage[me.id]! > 0);
  assert.deepEqual(rec.coopResult!.breaks, []);
  room.destroy();
});

test('판 기록: coopResult에 phaseMs, 사람마다 hits·hpLeft', () => {
  const { room, r, me } = coopRoom(1, 3);
  const bot = room.players.find((p) => p.bot)!;
  const t0 = r.startAt + 20_000;
  assert.equal(r.coop.damage(me, 'bullet', t0), true);
  assert.equal(r.coop.damage(me, 'bullet', t0 + 5000), true);
  assert.equal(r.coop.damage(me, 'beam', t0 + 10_000), true);
  // 막힌 공격은 맞은 것으로 세지 않는다
  me.coopFx!.guardUntil = t0 + 99_999;
  r.coop.damage(me, 'slam', t0 + 20_000);
  const brk = r.coop as unknown as { breakShield(n: number): void; shield: unknown };
  brk.shield = { from: r.startAt + 30_000, until: r.startAt + 60_000, no: 1, rages: 0 };
  brk.breakShield(r.startAt + 40_000);
  const res = r.coop.result(r.startAt + 50_000, r.startAt, false);
  assert.deepEqual(res.phaseMs, [40_000]);
  assert.deepEqual(res.players[me.id]!.hits, { bullet: 2, beam: 1 });
  assert.equal(res.players[me.id]!.hpLeft, me.hp);
  assert.ok(res.players[me.id]!.hpLeft < C.hpMax);
  assert.equal(res.players[bot.id]!.hpLeft, 0);
  const rec = gameRecord({ rules: room.rules, ranking: room.players, roundMs: C.timeSec * 1000, solo: false, coop: res } as never) as { coopResult: { phaseMs: number[]; hits: Record<string, unknown>; hpLeft: Record<string, number> } };
  assert.deepEqual(rec.coopResult.phaseMs, [40_000]);
  assert.deepEqual(rec.coopResult.hits[me.id], { bullet: 2, beam: 1 });
  assert.equal(rec.coopResult.hpLeft[me.id], me.hp);
  room.destroy();
});

// ---------- 최종 검토 수정 ----------
test('coop 검토: 봇 수정은 제한 시간의 60% 안에 깨짐 (난이도·두 번째 보호막 모두)', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    for (const edge of [C.phaseAt[0], C.phaseAt[1]]) {
      const room = new Room(fakeIo(), 'BOTC', () => {});
      const a = (room.join('s0', 'k0', 'P') as { id: string }).id;
      room.setRules(a, { rules: { coop: true, coopLevel: level } });
      room.addBot(a);
      assert.equal(room.start(a), null);
      const r = room as unknown as CRoom;
      const me = room.players.find((p) => p.id === a)!;
      const bot = room.players.find((p) => p.bot)!;
      const now = r.startAt + 5000;
      if (edge === C.phaseAt[1]) { r.coop.phase = 2; }
      toShield(r, me, now, edge);
      const limit = C.levels[level].crystalSec * 1000;
      for (let t = now; t <= now + limit * 0.6; t += 50) r.coop.tick(t);
      assert.equal(crystals(r).filter((c) => c.target === bot.id).length, 0, `${level} ${edge}`);
      room.destroy();
    }
  }
});

test('coop 검토: 내려찍기·안전지대는 상태에 담겨 다시 접속·재개해도 남음', () => {
  const { room, r, me } = coopRoom(1, 0);
  r.coop.phase = 3;
  const t = r.startAt + 5000;
  noSkills(r);
  r.cursors.set(me.id, { x: 500, y: 600, at: Date.now() + 1e9 });
  const run = r.coop as unknown as SkillRun;
  run.useSkill('safe', t);
  run.useSkill('slam', t);
  run.useSkill('seal', t);
  run.useSkill('beam', t);
  const st = (room as unknown as { playPayload(): { coop: CoopState } }).playPayload().coop;
  assert.ok(st.safe && st.slams.length === 1 && st.seal && st.beam, '재접속 상태에 실림');
  room.destroy();
});

test('coop 검토: 보호막 중 연결이 끊겨도 수정은 남고 보호막도 유지', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  me.connected = false;
  r.coop.recheck();
  assert.equal(crystals(r).length, 1);
  assert.equal(r.coop.isShielded(), true);
  room.destroy();
});

test('수정 파훼는 두 보호막에서 한 번씩 기록되고 실패 시 딜 타임을 주지 않는다', (t) => {
  const { room, r, me } = coopRoom(1, 0);
  t.after(() => room.destroy());
  let now = r.startAt + 5000;
  for (const [index, edge] of C.phaseAt.entries()) {
    me.hp = C.hpMax;
    toShield(r, me, now, edge);
    const end = r.coop.state().shield!.until;
    r.coop.tick(end);
    const failAt = end + C.rageWarnMs;
    r.coop.tick(failAt);
    assert.equal(r.coop.state().phase, index + 2);
    assert.equal(r.coop.isShielded(), false);
    assert.equal(r.coop.result(failAt, r.startAt, false).breaks.length, index + 1);
    assert.equal(r.coop.state().rampageUntil, failAt + C.rampageMs);
    r.coop.shift(1000);
    now = failAt + C.rampageMs + 1000;
    assert.equal(r.coop.state().rampageUntil, now);
    r.coop.tick(now);
  }
  const br = r.coop.result(now, r.startAt, false).breaks;
  assert.deepEqual(br, Array.from(C.phaseAt, () => ({ ms: C.levels.normal.crystalSec * 1000, rages: 1, burstMs: 0 })));
});

test('coop 원은 보스 아래쪽으로만 날아감 (위로 가서 바로 사라지는 원 없음)', () => {
  const { room, r } = coopRoom(1, 3);
  const t = r.startAt + 1000;
  for (let k = 0; k < 40; k++) r.coop.tick(t + k * 500);
  const orbs = [...r.circles.values()].filter((c) => c.from && c.boss !== 'raid' && c.kind !== 'threat' && c.kind !== 'crystal');
  room.destroy();
  assert.ok(orbs.length > 20);
  for (const o of orbs) assert.ok(Math.sin(o.angle) > 0.2, String(o.angle));
});

// ---------- 탄막 ----------

/** 탄막만 (고유 패턴 내려오는 벽은 빼고) */
const volleysSent = () => sent.filter((s) => s.ev === 'coop:volley').map((s) => s.d as Volley).filter((v) => !v.wall);
/** 발사 시각 (같은 시각에 겹쳐 쏜 것은 하나로) */
const fireTimes = (vs: Volley[]) => [...new Set(vs.map((v) => v.at))].sort((a, b) => a - b);
const gapsOf = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);
const near = (a: number, b: number) => Math.abs(a - b) < 0.01; // 시각이 커서 실수 오차가 1e-4쯤
/** 처음 발사될 때까지 50ms씩 tick: 그 탄막과 쏜 tick 시각 */
function firstVolley(r: CRoom, from: number) {
  sent.length = 0;
  let t = from;
  while (!volleysSent().length && t < from + 20_000) { r.coop.tick(t); t += 50; }
  const v = volleysSent()[0];
  assert.ok(v, '탄막이 나와야 한다');
  return { v: v!, t: t - 50 };
}
/** 탄 i가 판 안에 있는 시각 */
const liveAt = (v: Volley, i: number) => v.at + v.shots[i]!.d + 100;

test('탄막: 노말 1단계 1.2초마다 발사, 2단계는 1.2/1.3초', () => {
  const { room, r } = coopRoom(1, 0);
  const L = C.levels.normal;
  assert.equal(L.bulletEveryMs, 1200);
  sent.length = 0;
  const t0 = r.startAt;
  for (let t = t0; t <= t0 + 9000; t += 50) r.coop.tick(t);
  const v1 = volleysSent();
  const ts1 = fireTimes(v1);
  assert.ok(ts1.length >= 4, String(ts1.length));
  assert.ok(ts1[0]! >= t0 + RULES.laser.startQuietMs, '시작 조용한 시간에는 쏘지 않음');
  for (const g of gapsOf(ts1)) assert.ok(near(g, 1200), String(g));
  assert.equal(v1.length, ts1.length, '1단계는 겹쳐 쏘지 않음 (overlap 0)');
  for (const v of v1) {
    assert.ok([C.bullets.ringCount, C.bullets.scatterCount].includes(v.shots.length), '1단계 무늬는 ring·scatter');
    assert.equal(v.r, C.bullets.r);
    for (const s of v.shots) assert.ok(s.v >= L.bulletSpeed * 0.8 - 1e-9 && s.v <= L.bulletSpeed * 1.2 + 1e-9, '속도는 난이도 bulletSpeed');
  }
  r.coop.phase = 2;
  sent.length = 0;
  for (let t = t0 + 9050; t <= t0 + 20_000; t += 10) r.coop.tick(t);
  const ts2 = fireTimes(volleysSent());
  assert.ok(ts2.length >= 8, String(ts2.length));
  for (const g of gapsOf(ts2)) assert.ok(near(g, 1200 / C.bullets.phaseMult[1]!), String(g));
  room.destroy();
});

test('탄막: 2·3단계는 overlap 확률로 같은 시각에 하나 더', () => {
  const { room, r } = coopRoom(1, 0);
  r.coop.phase = 3;
  sent.length = 0;
  for (let t = r.startAt; t <= r.startAt + 60_000; t += 25) r.coop.tick(t);
  const vs = volleysSent();
  const ts = fireTimes(vs);
  const doubled = ts.filter((t) => vs.filter((v) => v.at === t).length === 2).length;
  // 3단계 0.5 확률: 넉넉한 범위
  assert.equal(C.bullets.overlap[2], 0.5);
  assert.ok(doubled > ts.length * 0.25 && doubled < ts.length * 0.75, `${doubled}/${ts.length}`);
  assert.ok(ts.every((t) => vs.filter((v) => v.at === t).length <= 2));
  room.destroy();
});

test('탄막: 보호막 중에도 shieldBullets로 발사, 큰 피해 구간에는 멈추고 coop:clear', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  sent.length = 0;
  for (let t = now; t <= now + 6000; t += 50) r.coop.tick(t);
  const vs = volleysSent();
  const ts = fireTimes(vs);
  assert.ok(ts.length >= 8, String(ts.length));
  for (const g of gapsOf(ts)) assert.ok(near(g, 1200 / C.bullets.shieldMult), String(g));
  assert.equal(vs.length, ts.length, '보호막 중에는 하나씩');
  for (const v of vs) assert.ok([C.bullets.spiralCount, C.bullets.ringCount].includes(v.shots.length), '첫 보호막은 spiral·ring');
  assert.ok(r.coop.state(true).volleys!.length > 0);
  sent.length = 0;
  const tb = now + 6010;
  breakMine(r, me, tb);
  assert.equal(r.coop.inBurst(tb), true);
  assert.deepEqual(sent.find((s) => s.ev === 'coop:clear')?.d, { before: tb });
  assert.deepEqual(r.coop.state(true).volleys, []);
  sent.length = 0;
  const bms = burstMsFor(C.levels.normal.crystalSec * 1000 - 6010);
  for (let t = tb; t < tb + bms; t += 50) r.coop.tick(t);
  assert.equal(volleysSent().length, 0, '큰 피해 구간에는 쏘지 않음');
  for (let t = tb + bms; t <= tb + bms + 3000; t += 50) r.coop.tick(t);
  assert.ok(volleysSent().length > 0, '끝나면 다시 쏨');
  room.destroy();
});

test('탄막: 조준 무늬는 살아 있는 사람 커서를 노림', () => {
  const { room, r, me } = coopRoom(1, 0);
  // 고유 패턴(내려찍기·봉인·빔)이 하나뿐인 사람을 쓰러뜨려 판이 끝나지 않게
  noSkills(r);
  r.coop.phase = 2;
  r.cursors.set(me.id, { x: 100, y: 1000, at: Date.now() + 1e9 });
  sent.length = 0;
  for (let t = r.startAt; t <= r.startAt + 60_000; t += 50) r.coop.tick(t);
  const aimed = volleysSent().filter((v) => v.shots.length === C.bullets.aimedCount);
  assert.ok(aimed.length > 0);
  for (const v of aimed) {
    const mid = v.shots[(C.bullets.aimedCount - 1) / 2]!;
    assert.ok(Math.abs(mid.a - Math.atan2(1000 - mid.y, 100 - mid.x)) <= 0.01, String(mid.a));
  }
  room.destroy();
});

test('reportHurt: 같은 탄 두 번 보고 → 한 번만 깎임', () => {
  const { room, r, me } = coopRoom(1, 0);
  const { v } = firstVolley(r, r.startAt);
  const t = liveAt(v, 0);
  assert.equal(r.coop.reportHurt(me, v.id, 0, t), true);
  assert.equal(me.hp, C.hpMax - N.bullet);
  const later = t + C.hurtFx.bullet.immuneMs + 1;
  assert.equal(r.coop.reportHurt(me, v.id, 0, later), false, '같은 탄은 다시 깎지 않음');
  assert.equal(me.hp, C.hpMax - N.bullet);
  assert.equal(r.coop.reportHurt(me, v.id, 1, later), true, '다른 탄은 깎임');
  assert.equal(me.hp, C.hpMax - 2 * N.bullet);
  const hit = sent.filter((s) => s.ev === 'coop:hit').at(-1)!.d as { by: CoopHitBy; dmg: number };
  assert.deepEqual([hit.by, hit.dmg], ['bullet', N.bullet]);
  room.destroy();
});

test('reportHurt: 무적 중·탈락·봇·끊김이면 무시', () => {
  const { room, r, me, ids } = coopRoom(3, 1);
  const b = room.players.find((p) => p.id === ids[1])!, c = room.players.find((p) => p.id === ids[2])!;
  const bot = room.players.find((p) => p.bot)!;
  const { v } = firstVolley(r, r.startAt);
  const t = liveAt(v, 0);
  me.immuneUntil = t + 1000;
  assert.equal(r.coop.reportHurt(me, v.id, 0, t), false, '무적');
  assert.equal(me.hp, C.hpMax);
  b.outAt = t - 1;
  assert.equal(r.coop.reportHurt(b, v.id, 1, t), false, '탈락');
  assert.equal(b.hp, C.hpMax);
  assert.equal(r.coop.reportHurt(bot, v.id, 2, t), false, '봇');
  assert.equal(bot.hp, 0);
  c.connected = false;
  assert.equal(r.coop.reportHurt(c, v.id, 3, t), false, '끊김');
  assert.equal(c.hp, C.hpMax);
  c.connected = true;
  assert.equal(r.coop.reportHurt(c, v.id, 3, t), true, '다시 연결되면 깎임');
  room.destroy();
});

test('여럿: 한 사람이 탈락해도 다른 사람이 살아 있으면 판이 계속되고, 탈락한 사람의 coop:hurt는 무시', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const b = room.players.find((p) => p.id === ids[1])!;
  const { v } = firstVolley(r, r.startAt);
  const t = liveAt(v, 0);
  me.hp = N.bullet; // 한 방이면 탈락
  assert.equal(r.coop.reportHurt(me, v.id, 0, t), true);
  assert.equal(me.hp, 0);
  assert.ok(me.outAt, '탈락');
  assert.equal(overOf(), undefined, '다른 사람이 살아 있으니 판은 계속');
  assert.equal(b.hp, C.hpMax);
  assert.equal(r.coop.reportHurt(me, v.id, 1, t + C.hurtFx.bullet.immuneMs + 1), false, '탈락한 사람의 보고는 무시');
  assert.equal(me.hp, 0);
  assert.equal(overOf(), undefined);
  room.destroy();
});

test('reportHurt: 없는 탄막·지워진 탄·발사 전 탄이면 무시', () => {
  const { room, r, me } = coopRoom(1, 0);
  const { v } = firstVolley(r, r.startAt);
  assert.equal(r.coop.reportHurt(me, 987_654, 0, liveAt(v, 0)), false, '없는 탄막');
  assert.equal(r.coop.reportHurt(me, v.id, v.shots.length, liveAt(v, 0)), false, '없는 탄 번호');
  assert.equal(r.coop.reportHurt(me, v.id, -1, liveAt(v, 0)), false);
  assert.equal(r.coop.reportHurt(me, v.id, 0, v.at + v.shots[0]!.d - 10), false, '발사 전');
  // 판 밖으로 나간 뒤: lagWindowMs 안이면 받아 주고, 넘으면 무시
  let tg = v.at + v.shots[1]!.d;
  while (!shotGone(v, 1, tg)) tg += 5;
  assert.equal(r.coop.reportHurt(me, v.id, 1, tg + RULES.lagWindowMs + 50), false, '나간 지 오래');
  assert.equal(r.coop.reportHurt(me, v.id, 1, tg + RULES.lagWindowMs - 50), true, '지연 보정 안');
  assert.equal(me.hp, C.hpMax - N.bullet);
  room.destroy();
  // 지워진 탄: 보호막 중 쏜 탄막이 큰 피해 구간 시작에 지워짐
  const s = coopRoom(1, 0);
  const now = s.r.startAt + 5000;
  toShield(s.r, s.me, now);
  const { v: sv, t } = firstVolley(s.r, now);
  breakMine(s.r, s.me, t + 10);
  assert.ok(shotPos(sv, 0, liveAt(sv, 0)));
  assert.equal(s.r.coop.reportHurt(s.me, sv.id, 0, liveAt(sv, 0)), false, '지워진 탄');
  assert.equal(s.me.hp, C.hpMax);
  s.room.destroy();
});

test('shift: 일시정지 뒤 탄막 at과 다음 발사가 delta만큼 밀리고 state().volleys에 반영', () => {
  const { room, r } = coopRoom(1, 0);
  const { v, t } = firstVolley(r, r.startAt);
  const at0 = v.at;
  sent.length = 0;
  r.coop.shift(5000);
  const st = sent.find((s) => s.ev === 'coop:state')?.d as CoopState;
  assert.equal(st.volleys.find((x) => x.id === v.id)?.at, at0 + 5000);
  assert.equal(r.coop.state(true).volleys!.find((x) => x.id === v.id)?.at, at0 + 5000);
  sent.length = 0;
  for (let k = t + 5000 + 50; k <= t + 5000 + 1300; k += 10) r.coop.tick(k);
  const next = fireTimes(volleysSent());
  assert.ok(next.length >= 1);
  assert.ok(near(next[0]!, at0 + 5000 + 1200), String(next[0]! - at0));
  room.destroy();
});

test('탄막: 끝난 탄막은 상태에서 빠짐', () => {
  const { room, r } = coopRoom(1, 0);
  const { v } = firstVolley(r, r.startAt);
  let td = v.at;
  while (r.coop.state(true).volleys!.some((x) => x.id === v.id) && td < v.at + 30_000) { td += 100; r.coop.tick(td); }
  assert.ok(td < v.at + 30_000, '끝난 탄막이 빠짐');
  room.destroy();
});

test('방 coopHurt: 진행 중이면 깎고, 일시정지·시작 전이면 무시', () => {
  const { room, r, me } = coopRoom(1, 0);
  const { v } = firstVolley(r, r.startAt);
  r.startAt = Date.now() - 10_000; // 시작 카운트다운 건너뜀
  v.at = Date.now() - 100 - v.shots[0]!.d; // 서버 탄막 객체: 지금 판 안에 있게
  r.pausedAt = Date.now();
  room.coopHurt(me.id, { volleyId: v.id, shot: 0 });
  assert.equal(me.hp, C.hpMax, '일시정지 중');
  r.pausedAt = 0;
  room.coopHurt(me.id, { volleyId: v.id, shot: 0 });
  assert.equal(me.hp, C.hpMax - N.bullet);
  room.destroy();
});

test('전송량: 원을 잡을 때의 coop:state에는 탄막 목록이 없고, 시작·shift·보스 무너짐·재접속에는 있다', () => {
  const { room, r, me } = coopRoom(1, 0);
  const startState = sent.find((s) => s.ev === 'coop:state')?.d as CoopState | undefined;
  firstVolley(r, r.startAt);
  sent.length = 0;
  r.coop.catchOrb(me, orbOf(me.color, r.startAt + 3100), r.startAt + 3100);
  const caught = sent.filter((s) => s.ev === 'coop:state').map((s) => s.d as CoopState);
  assert.ok(caught.length > 0);
  for (const st of caught) assert.equal('volleys' in st, false, '원 잡기 상태에는 없음');
  assert.equal(r.coop.state().volleys, undefined);
  sent.length = 0;
  r.coop.shift(1000);
  assert.ok((sent.find((s) => s.ev === 'coop:state')?.d as CoopState).volleys!.length > 0, 'shift에는 있음');
  const pay = (room as unknown as { playPayload(): { coop: CoopState } }).playPayload();
  assert.ok(pay.coop.volleys!.length > 0, '재접속·game:sync 상태에는 있음');
  assert.deepEqual(startState?.volleys, [], '시작 상태에는 빈 목록');
  room.destroy();
});

test('탄을 눌러도 헛클릭이 아니다 (빈 곳은 그대로 헛클릭)', () => {
  const { room, r, me } = coopRoom(1, 0);
  const { v } = firstVolley(r, r.startAt);
  r.startAt = Date.now() - 10_000; // 시작 카운트다운 건너뜀
  v.at = Date.now() - 200 - v.shots[0]!.d; // 서버 탄막 객체: 지금 판 안에 있게
  const q = shotPos(v, 0, Date.now())!;
  me.combo = 5;
  r.clickLog.clear();
  room.click(me.id, { circleId: null, x: q.x, y: q.y });
  assert.deepEqual([me.combo, me.stats.misses], [5, 0], '탄 위 클릭은 헛클릭 아님');
  r.clickLog.clear();
  room.click(me.id, { circleId: null, x: 5, y: FIELD.h - 5 });
  assert.equal(me.stats.misses, 1, '빈 곳은 헛클릭');
  assert.equal(me.combo, 0);
  room.destroy();
});

// ---------- 고유 패턴·판 패턴 ----------

test('고유 패턴: 10초마다 하나, 직전과 다름, 1단계는 레이저·추적 원만', () => {
  assert.equal(C.skillEveryMs, 10_000);
  const { room, r } = coopRoom(1, 0);
  const calls = spySkills(r);
  const t0 = r.startAt;
  for (let t = t0; t <= t0 + 60_000; t += 50) r.coop.tick(t);
  assert.ok(calls.length >= 5, String(calls.length));
  assert.equal(calls[0]!.t, t0 + RULES.laser.startQuietMs, '첫 패턴은 시작 조용한 시간 뒤');
  for (const g of gapsOf(calls.map((c) => c.t))) assert.equal(g, C.skillEveryMs);
  for (const c of calls) assert.ok(COOP_BOSSES.core.skills[1].includes(c.k), c.k);
  for (let i = 1; i < calls.length; i++) assert.notEqual(calls[i]!.k, calls[i - 1]!.k, '직전과 다름');
  // 2단계: 그 단계 목록에서, 여전히 직전과 다름
  r.coop.phase = 2;
  calls.length = 0;
  for (let t = t0 + 60_050; t <= t0 + 200_000; t += 50) r.coop.tick(t);
  assert.ok(calls.length >= 12);
  for (const c of calls) assert.ok(COOP_BOSSES.core.skills[2].includes(c.k), c.k);
  for (let i = 1; i < calls.length; i++) assert.notEqual(calls[i]!.k, calls[i - 1]!.k);
  room.destroy();
});

test('pickSkill: 직전과 다른 것, 목록이 하나면 그것', () => {
  const list = ['laser', 'threat', 'slam'] as const;
  for (const x of [0, 0.4, 0.999]) {
    assert.notEqual(pickSkill(list, 'laser', () => x), 'laser');
    assert.ok(list.includes(pickSkill(list, null, () => x) as never));
  }
  assert.equal(pickSkill(['laser'], 'laser', () => 0.5), 'laser');
  assert.equal(pickSkill(['laser', 'threat'], 'laser', () => 0), 'threat');
});

test('고유 패턴: 보호막·큰 피해 구간에는 안 나오고, 끝난 뒤 10초 뒤 다시', () => {
  const { room, r, me } = coopRoom(1, 0);
  const calls = spySkills(r);
  const now = r.startAt + 4000;
  for (let t = r.startAt; t <= now; t += 50) r.coop.tick(t);
  assert.equal(calls.length, 1);
  toShield(r, me, now);
  calls.length = 0;
  for (let t = now; t <= now + 8000; t += 50) r.coop.tick(t);
  assert.equal(calls.length, 0, '보호막 중 없음');
  breakMine(r, me, now + 8000);
  const end = now + 8000 + burstMsFor((C.levels.normal.crystalSec - 8) * 1000);
  for (let t = now + 8000; t < end; t += 50) r.coop.tick(t);
  assert.equal(calls.length, 0, '큰 피해 구간 중 없음');
  for (let t = end; t <= end + 12_000; t += 50) r.coop.tick(t);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.t >= end + C.skillEveryMs && calls[0]!.t <= end + C.skillEveryMs + 100, String(calls[0]!.t - end));
  room.destroy();
});

test('구역 봉인: rand가 무엇이든 막힌 줄은 2단계 1개, 3단계 2개, 남은 줄 ≥ 1', () => {
  assert.deepEqual(C.seal, { warnMs: 2_000, ms: 5_000 });
  for (const x of [0, 0.33, 0.66, 0.999]) {
    for (const [phase, n] of [[2, 1], [3, 2]] as const) {
      const s = rollSeal(phase, 1000, () => x);
      assert.equal(s.lanes.length, n, `${phase} ${x}`);
      assert.equal(new Set(s.lanes).size, n, '서로 다른 줄');
      assert.ok(s.lanes.every((l) => l === 0 || l === 1 || l === 2));
      assert.ok(3 - s.lanes.length >= 1);
      assert.deepEqual([s.warnAt, s.at, s.until], [1000, 1000 + C.seal.warnMs, 1000 + C.seal.warnMs + C.seal.ms]);
    }
  }
  const s: Seal = { lanes: [1], warnAt: 0, at: 2000, until: 7000 };
  const mid = { x: FIELD.w / 2, y: 600 };
  assert.equal(inSeal(mid, s, 1999), false, '경고 중');
  assert.equal(inSeal(mid, s, 2000), true);
  assert.equal(inSeal(mid, s, 7000), false, 'until에 끝');
  assert.equal(inSeal({ x: FIELD.w / 3 - 1, y: 600 }, s, 3000), false, '왼쪽 줄');
  assert.equal(inSeal({ x: FIELD.w / 3, y: 600 }, s, 3000), true, '가운데 줄 시작');
  assert.equal(inSeal({ x: (FIELD.w * 2) / 3, y: 600 }, s, 3000), false, '오른쪽 줄 시작');
});

test('구역 봉인: 경고 중에는 안 맞고 at~until 사이 막힌 줄 안이면 맞음 (노말 −20, 기절 1초)', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  r.coop.phase = 3;
  noSkills(r);
  const t = r.startAt + 5000;
  sent.length = 0;
  (r.coop as unknown as SkillRun).useSkill('seal', t);
  const s = sealsSent()[0]!;
  assert.ok(s && s.lanes.length === 2);
  assert.deepEqual(r.coop.state().seal, s, '상태에도 실림');
  const lane = s.lanes[0]!, open = [0, 1, 2].find((l) => !s.lanes.includes(l))!;
  const xOf = (l: number) => (l + 0.5) * FIELD.w / 3;
  r.cursors.set(me.id, { x: xOf(lane), y: 700, at: Date.now() + 1e9 });
  r.cursors.set(other.id, { x: xOf(open), y: 700, at: Date.now() + 1e9 });
  for (let k = t; k < s.at; k += 100) r.coop.tick(k);
  assert.deepEqual([me.hp, other.hp], [100, 100], '경고 중에는 안 맞음');
  r.coop.tick(s.at + 1);
  assert.equal(N.seal, 20);
  assert.deepEqual([me.hp, other.hp], [100 - 20, 100]);
  assert.equal(me.stunUntil, s.at + 1 + 1000);
  // 무적이 끝나도 같은 봉인에서는 다시 안 맞음
  r.coop.tick(s.at + 3000);
  assert.equal(me.hp, 80, '한 봉인에 한 번');
  r.coop.tick(s.until + 1);
  assert.equal(r.coop.state().seal, null);
  assert.equal(sealsSent().at(-1), null, '끝나면 null');
  room.destroy();
});

test('회전 빔: 빔 위의 점은 맞고 빔 사이의 점은 안 맞음, 시간이 지나면 돈다', () => {
  assert.deepEqual(C.beam, { warnMs: 2_000, ms: 4_000, count: [2, 3], w: 0.6, halfWidth: 22, stillMs: 150 });
  const from = { x: 550, y: 190 }, h = C.beam.halfWidth;
  const b: Beam = { at: 1000, until: 5000, count: 2, a0: 0, w: 0.6 };
  assert.equal(beamHits({ x: 850, y: 190 }, b, from, 999, h), false, '경고 중');
  assert.equal(beamHits({ x: 850, y: 190 }, b, from, 1000, h), true, '빔 위');
  assert.equal(beamHits({ x: 250, y: 190 }, b, from, 1000, h), true, '반대쪽 빔 (2줄)');
  assert.equal(beamHits({ x: 850, y: 190 + h - 1 }, b, from, 1000, h), true, '두께 안');
  assert.equal(beamHits({ x: 850, y: 190 + h + 1 }, b, from, 1000, h), false, '두께 밖');
  assert.equal(beamHits({ x: 550, y: 490 }, b, from, 1000, h), false, '빔 사이');
  const quarter = 1000 + (Math.PI / 2 / 0.6) * 1000; // 90° 돈 시각
  assert.equal(beamHits({ x: 550, y: 490 }, b, from, quarter, h), true, '돈 뒤에는 맞음');
  assert.equal(beamHits({ x: 850, y: 190 }, b, from, quarter, h), false);
  assert.equal(beamHits({ x: 850, y: 190 }, b, from, 5000, h), false, 'until에 끝');
  // 3줄은 120° 간격
  const b3: Beam = { ...b, count: 3 };
  const a = (2 * Math.PI) / 3;
  assert.equal(beamHits({ x: 550 + Math.cos(a) * 300, y: 190 + Math.sin(a) * 300 }, b3, from, 1000, h), true);
  assert.equal(beamHits({ x: 250, y: 190 }, b3, from, 1000, h), false);
});

test('회전 빔: 서버가 커서로 판정, 한 빔에 한 번, 경고 중엔 안 맞음 (2단계 2줄, 3단계 3줄)', () => {
  const { room, r, me } = coopRoom(1, 0);
  noSkills(r);
  let last: Beam | null = null;
  for (const phase of [2, 3] as const) {
    r.coop.phase = phase;
    sent.length = 0;
    const t = r.startAt + 5000 + phase * 20_000;
    (r.coop as unknown as SkillRun).useSkill('beam', t);
    const b = beamsSent()[0]!;
    assert.equal(b.count, C.beam.count[phase - 2]);
    assert.equal(Math.abs(b.w), C.beam.w);
    assert.deepEqual([b.at, b.until], [t + C.beam.warnMs, t + C.beam.warnMs + C.beam.ms]);
    assert.deepEqual(r.coop.state().beam, b);
    last = b;
  }
  const b = last!;
  const from = circlePos(r.coop.boss, b.at + 1);
  r.cursors.set(me.id, { x: from.x + Math.cos(b.a0) * 250, y: from.y + Math.sin(b.a0) * 250, at: Date.now() + 1e9 });
  r.coop.tick(b.at - 1);
  assert.equal(me.hp, 100, '경고 중');
  r.coop.tick(b.at + 1);
  assert.equal(me.hp, 100 - N.beam);
  me.immuneUntil = 0;
  r.coop.tick(b.at + 2);
  assert.equal(me.hp, 100 - N.beam, '한 빔에 한 번');
  r.coop.tick(b.until + 1);
  assert.equal(r.coop.state().beam, null);
  assert.equal(beamsSent().at(-1), null);
  room.destroy();
});

test('내려오는 벽: 2단계 틈 2개, 3단계 틈 1개', () => {
  assert.deepEqual(C.wall, { warnMs: 2_000, gaps: [2, 1], speed: [900, 1100] });
  for (const x of [0, 0.5, 0.999]) {
    for (const [phase, gaps] of [[2, 2], [3, 1]] as const) {
      const { room, r } = coopRoom(1, 0);
      r.coop.phase = phase;
      (r.coop as unknown as SkillRun).rand = () => x;
      sent.length = 0;
      const t = r.startAt + 5000;
      (r.coop as unknown as SkillRun).useSkill('wall', t);
      const walls = sent.filter((s) => s.ev === 'coop:volley').map((s) => s.d as Volley).filter((v) => v.wall);
      assert.equal(walls.length, 1);
      const v = walls[0]!;
      assert.equal(v.at, t + C.wall.warnMs, '경고 warnMs 뒤에 움직임');
      assert.ok(v.shots.every((s) => s.v === C.wall.speed[phase - 2]));
      const xs = v.shots.map((s) => s.x).sort((a, b) => a - b);
      const holes = xs.slice(1).filter((q, i) => q - xs[i]! > C.bullets.wallGap + 0.01);
      assert.equal(holes.length, gaps, `${phase} ${x}`);
      assert.ok(v.shots[0]!.y > C.bossY + C.bossR, '보스 아래');
      room.destroy();
    }
  }
});

test('내려오는 벽: 고유 패턴 시각 + warnMs(2초) 경고, 그 전에는 탄 자리에 있어도 안 맞음', () => {
  assert.equal(C.wall.warnMs, 2000);
  const { room, r } = coopRoom(1, 0);
  r.coop.phase = 2;
  noSkills(r);
  sent.length = 0;
  const t = r.startAt + 5000;
  (r.coop as unknown as SkillRun).useSkill('wall', t);
  const v = sent.filter((s) => s.ev === 'coop:volley').map((s) => s.d as Volley).find((x) => x.wall)!;
  assert.ok(v, '고유 패턴 시각에 바로 보냄');
  assert.equal(v.at, t + C.wall.warnMs);
  const s0 = v.shots[0]!;
  for (const dt of [0, 1000, C.wall.warnMs - 1]) {
    assert.equal(shotPos(v, 0, t + dt), null, `경고 중 ${dt}`);
    assert.equal(hitShot({ x: s0.x, y: s0.y }, [v], t + dt, new Set()), null, `경고 중 맞지 않음 ${dt}`);
  }
  assert.ok(hitShot({ x: s0.x, y: s0.y }, [v], v.at, new Set()), 'at부터는 맞음');
  room.destroy();
});

test('내려오는 벽: 일반 탄보다 큰 난이도별 피해와 중복 피격 방지', () => {
  for (const [level, damage] of [['easy', 15], ['normal', 25], ['hard', 35], ['expert', 45]] as const) {
    const { room, r, me } = coopRoom(1, 0, level);
    r.coop.phase = 2;
    sent.length = 0;
    (r.coop as unknown as SkillRun).useSkill('wall', r.startAt + 5000);
    const v = sent.filter((s) => s.ev === 'coop:volley').map((s) => s.d as Volley).find((x) => x.wall)!;
    assert.ok(damage > C.levels[level].hurt.bullet);
    assert.equal(r.coop.reportHurt(me, v.id, 0, v.at - 1), false);
    assert.equal(r.coop.reportHurt(me, v.id, 0, v.at), true);
    assert.equal(me.hp, C.hpMax - damage);
    assert.equal(r.coop.reportHurt(me, v.id, 0, v.at + 1), false);
    assert.equal(me.hp, C.hpMax - damage);
    room.destroy();
  }
});

test('협력전에서는 아케이드 맵 패턴이 나오지 않는다', () => {
  assert.equal('phasePatterns' in C, false);
  for (const phase of [1, 2, 3] as const) {
    const { room, r } = coopRoom(1, 0);
    r.coop.phase = phase;
    for (let t = r.startAt; t <= r.startAt + 60_000; t += 100) r.coop.tick(t);
    const rr = r as unknown as { pendingPattern: unknown; pattern: unknown };
    assert.equal(rr.pendingPattern, null);
    assert.equal(rr.pattern, null);
    assert.ok(!sent.some((s) => s.ev === 'map:warn'));
    room.destroy();
  }
  assert.ok(!('hazard' in C.hurtFx));
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) assert.ok(!('hazard' in C.levels[k].hurt));
});

test('shift: 봉인·빔·다음 고유 패턴 시각이 함께 밀림', () => {
  const { room, r } = coopRoom(1, 0);
  r.coop.phase = 3;
  const t = r.startAt + 5000;
  const run = r.coop as unknown as SkillRun;
  run.useSkill('seal', t);
  run.useSkill('beam', t);
  const s0 = { ...r.coop.state().seal! }, b0 = { ...r.coop.state().beam! };
  const calls = spySkills(r);
  r.coop.shift(4000);
  const s1 = r.coop.state().seal!, b1 = r.coop.state().beam!;
  assert.deepEqual([s1.warnAt, s1.at, s1.until], [s0.warnAt + 4000, s0.at + 4000, s0.until + 4000]);
  assert.deepEqual([b1.at, b1.until], [b0.at + 4000, b0.until + 4000]);
  // 첫 패턴은 startQuietMs 뒤였는데 4초 밀림
  for (let k = r.startAt; k < r.startAt + RULES.laser.startQuietMs + 4000; k += 50) r.coop.tick(k);
  assert.equal(calls.length, 0);
  r.coop.tick(r.startAt + RULES.laser.startQuietMs + 4000);
  assert.equal(calls.length, 1);
  room.destroy();
});

// ---------- 최종 리뷰 수정 ----------
/** 판이 끝날 때까지 tick (끝난 그 tick의 나머지도 돈다). game:over 뒤에 나간 이벤트 이름 */
function tickToOver(r: CRoom, room: Room, from: number, to: number) {
  const run = r.coop;
  for (let t = from; t <= to && room.phase === 'play'; t += 50) run.tick(t);
  assert.equal(room.phase, 'lobby', '판이 끝남');
  const i = sent.findIndex((s) => s.ev === 'game:over');
  return sent.slice(i + 1).map((s) => s.ev).filter((ev) => ev.startsWith('coop:') || ev.startsWith('laser:') || ev === 'circle:spawn');
}

test('판이 끝난 뒤: 엑스퍼트 수정 실패로 진 tick의 나머지가 보호막·분노·공격을 보내지 않음', () => {
  const { room, r, me } = coopRoom(1, 0, 'expert');
  const now = r.startAt + 5000;
  toShield(r, me, now);
  me.hp = 1;
  sent.length = 0;
  assert.deepEqual(tickToOver(r, room, now, now + 60_000), []);
  assert.equal(overOf()?.coop?.reason, 'crystal');
  room.destroy();
});

test('판이 끝난 뒤: 분노로 모두 탈락한 tick의 나머지가 수정·보호막을 보내지 않음', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  me.hp = 1;
  sent.length = 0;
  assert.deepEqual(tickToOver(r, room, now, now + 60_000), []);
  assert.equal(overOf()?.coop?.reason, 'crystal');
  room.destroy();
});

/** 회전 빔 하나를 띄우고, 빔이 th에 지나가는 점(보스에서 600)을 돌려준다 */
function beamAt() {
  const { room, r, me } = coopRoom(1, 0);
  noSkills(r);
  r.coop.phase = 2;
  const run = r.coop as unknown as SkillRun;
  const rand = run.rand;
  run.rand = () => 0.25; // a0 = π/2(아래), w = −0.6
  sent.length = 0;
  run.useSkill('beam', r.startAt + 5000);
  run.rand = rand; // 고정 난수로 tick을 돌리면 원 뿜기 등이 끝나지 않는다
  const b = beamsSent()[0]!;
  const th = b.at + 500;
  const from = circlePos(r.coop.boss, th);
  const a = b.a0 + b.w * (th - b.at) / 1000;
  const P = { x: from.x + Math.cos(a) * 600, y: from.y + Math.sin(a) * 600 };
  const H = C.beam.halfWidth;
  assert.equal(beamHits(P, b, from, th, H), true, '빔이 th에 P를 지남');
  for (const t of [th - 300, th - C.beam.stillMs, th + 120]) assert.equal(beamHits(P, b, circlePos(r.coop.boss, t), t, H), false, `${t - th}`);
  const at = (recv: number) => r.cursors.set(me.id, { x: P.x, y: P.y, at: recv });
  return { room, r, me, th, at };
}

test('회전 빔 지연 보정: 빔이 닿기 전에 받은 커서는 빔이 그 자리를 지날 때 판정해도 맞지 않음', () => {
  const { room, r, me, th, at } = beamAt();
  at(th - 300);
  r.coop.tick(th);
  assert.equal(me.hp, C.hpMax);
  room.destroy();
});

test('회전 빔 지연 보정: 받은 시각에 빔 안이던 커서는 빔이 지나간 뒤 판정해도 맞음', () => {
  const { room, r, me, th, at } = beamAt();
  at(th);
  r.coop.tick(th + 120);
  assert.equal(me.hp, C.hpMax - N.beam);
  room.destroy();
});

test('회전 빔 지연 보정: stillMs보다 오래 새 커서가 없으면 그동안 그 자리에 있던 것으로 판정', () => {
  const { room, r, me, th, at } = beamAt();
  at(th - 300);
  r.coop.tick(th + 200);
  assert.equal(me.hp, C.hpMax - N.beam);
  room.destroy();
});

test('단계가 오르면 세짐: 추적 원 수 + phaseUp.threatAdd, 레이저는 한 줄 비율이 phaseUp.singleShift만큼 여러 줄로', async () => {
  const { coopAttackRules, coopThreatCount, coopVolleyOdds } = await import('../src/index.ts');
  const U = C.phaseUp;
  assert.deepEqual(U.threatAdd.length, 3);
  assert.equal(U.threatAdd[0], 0);
  assert.equal(U.singleShift[0], 0);
  for (const level of ['easy', 'normal', 'hard', 'expert'] as const) {
    const L = C.levels[level];
    assert.equal(coopThreatCount(level, 1), L.threatCount);
    assert.equal(coopThreatCount(level, 3), coopAttackRules(level, 3).threatCount + U.threatAdd[2]!);
    assert.ok(coopThreatCount(level, 3) > coopThreatCount(level, 1));
    assert.deepEqual(coopVolleyOdds(level, 1), L.volleyOdds);
    const o3 = coopVolleyOdds(level, 3);
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum(o3) - sum(L.volleyOdds)) < 1e-9, '합은 그대로');
    assert.equal(o3.single, Math.max(0, L.volleyOdds.single - U.singleShift[2]!));
    assert.ok(o3.single < L.volleyOdds.single, level);
    // 원래 없던 무늬(쉬움의 십자·방사)는 생기지 않는다
    for (const k of ['parallel', 'cross', 'radial'] as const) assert.equal(o3[k] > 0, L.volleyOdds[k] > 0, `${level} ${k}`);
  }
});

test('단계가 오르면 세짐: 3단계 추적 원은 1단계보다 많고, 레이저는 단계 비율로 굴림', () => {
  const counts: number[] = [];
  for (const phase of [1, 3] as const) {
    const { room, r } = coopRoom(1, 0);
    noSkills(r);
    r.coop.phase = phase;
    sent.length = 0;
    (r.coop as unknown as SkillRun).useSkill('threat', r.startAt + 5000);
    assert.equal(sent.filter((s) => s.ev === 'circle:spawn' && (s.d as Circle).kind === 'threat').length, 0, '경고 중에는 발사하지 않는다');
    assert.equal(r.coop.state().threatAt, r.startAt + 5000 + C.threatWarnMs);
    r.coop.tick(r.startAt + 5000 + C.threatWarnMs - 1);
    assert.equal([...r.circles.values()].filter((c) => c.kind === 'threat').length, 0);
    r.coop.tick(r.startAt + 5000 + C.threatWarnMs);
    assert.equal(r.coop.state().threatAt, 0);
    counts.push(sent.filter((s) => s.ev === 'circle:spawn' && (s.d as Circle).kind === 'threat').length);
    room.destroy();
  }
  assert.deepEqual(counts, [C.levels.normal.threatCount, C.levels.normal.threatCount + C.phaseUp.threatAdd[2]!]);
  // 레이저: 한 줄이 나올 난수(0.3 → 1단계 single 40% 안)가 3단계에서는 여러 줄
  const lines: number[] = [];
  for (const phase of [1, 3] as const) {
    const { room, r } = coopRoom(1, 0);
    noSkills(r);
    r.coop.phase = phase;
    const run = r.coop as unknown as SkillRun;
    const rand = run.rand;
    run.rand = () => 0.3;
    sent.length = 0;
    run.useSkill('laser', r.startAt + 5000);
    run.rand = rand;
    lines.push((sent.find((s) => s.ev === 'laser:warn')!.d as { lines: unknown[] }).lines.length);
    room.destroy();
  }
  assert.equal(lines[0], 1);
  assert.ok(lines[1]! > 1, String(lines[1]));
});

test('일시정지 뒤: 봇 수정 두드리는 시각도 밀려 재개하자마자 깨지지 않음', () => {
  const { room, r, me } = coopRoom(1, 1);
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  for (let t = now; t <= now + 200; t += 50) r.coop.tick(t);
  const c = crystals(r).find((x) => x.target === bot.id)!;
  const before = c.hp!;
  const delta = 20_000;
  r.startAt += delta;
  r.coop.shift(delta);
  for (let t = now + 200 + delta; t <= now + 400 + delta; t += 50) r.coop.tick(t);
  assert.ok(c.hp! >= before - C.crystal.sameColorDamage, `${before} → ${c.hp}`);
  room.destroy();
});

test('일시정지 뒤: 끝난 단계 시각도 밀려 phaseMs가 멈춘 시간을 빼고 셈', () => {
  const { room, r } = coopRoom(1, 0);
  const brk = r.coop as unknown as { breakShield(n: number): void; shield: unknown };
  brk.shield = { from: r.startAt + 30_000, until: r.startAt + 60_000, no: 0, rages: 0 };
  brk.breakShield(r.startAt + 40_000);
  // 방은 판 시작 시각과 CoopRun 시각을 함께 민다
  r.startAt += 5000;
  r.coop.shift(5000);
  assert.deepEqual(r.coop.result(r.startAt + 50_000, r.startAt, false).phaseMs, [40_000]);
  room.destroy();
});

type HomingRun = SkillRun & { clearShots(before: number): void; dispose(): void };
const homingSent = () => sent.filter((s) => s.ev === 'coop:homing').map((s) => s.d as Homing | null);
const homingHitsOf = (id: string) => sent.filter((x) => x.ev === 'coop:hit' && (x.d as { by: string }).by === 'homing' && (x.d as { playerId: string }).playerId === id);
/** 엑스퍼트 2단계 판에서 유도탄을 예고한다. 커서는 발사 자리 바로 아래 300 */
function homingRoom(humans = 1) {
  const c = coopRoom(humans, 0, 'expert');
  noSkills(c.r); c.r.coop.phase = 2;
  const t = c.r.startAt + 5000;
  (c.r.coop as unknown as SkillRun).useSkill('homing', t);
  const h = c.r.coop.state().homing!;
  const below = circlePos(c.r.coop.boss, h.at);
  for (const id of c.ids) c.r.cursors.set(id, { x: below.x, y: below.y + 300, at: t });
  return { ...c, t, h };
}

test('유도탄: 엑스퍼트 2·3단계에서만 쓴다', () => {
  for (const level of ['hard', 'expert'] as const) {
    for (const phase of [1, 2] as const) {
      const { room, r } = coopRoom(1, 0, level);
      noSkills(r); r.coop.phase = phase;
      sent.length = 0;
      (r.coop as unknown as SkillRun).useSkill('homing', r.startAt + 5000);
      assert.equal(homingSent().length, level === 'expert' && phase === 2 ? 1 : 0);
      room.destroy();
    }
  }
});

test('유도탄: 예고 뒤 살아 있는 사람마다 1발', () => {
  const { room, r, ids, t, h } = homingRoom(2);
  assert.deepEqual([...h.targets].sort(), [...ids].sort());
  assert.equal(h.shots.length, 0); assert.equal(h.at, t + C.homing.warnMs);
  r.coop.tick(h.at - 1);
  assert.equal(r.coop.state().homing!.shots.length, 0);
  r.coop.tick(h.at);
  const shots = r.coop.state().homing!.shots;
  assert.deepEqual(shots.map((s) => s.target).sort(), [...ids].sort());
  assert.ok(shots.every((s) => s.born === h.at));
  room.destroy();
});

test('유도탄: 봇은 대상이 아니다', () => {
  const { room, r } = coopRoom(1, 2, 'expert');
  noSkills(r); r.coop.phase = 2;
  (r.coop as unknown as SkillRun).useSkill('homing', r.startAt + 5000);
  assert.equal(r.coop.state().homing!.targets.length, 1);
  room.destroy();
});

test('유도탄: 가만히 있는 사람은 맞고, 한 발은 한 번만', () => {
  const { room, r, me, h } = homingRoom(1);
  for (let now = h.at; now <= h.at + C.homing.lifeMs + C.homing.fadeMs; now += 50) { me.immuneUntil = 0; r.coop.tick(now); }
  assert.equal(homingHitsOf(me.id).length, 1);
  assert.equal(me.hp, C.hpMax - C.levels.expert.hurt.homing);
  assert.equal(r.coop.state().homing, null);
  room.destroy();
});

test('유도탄: 무적이면 계속 쫓고, 수명 뒤에는 맞지 않으며 수명 + fadeMs에 사라진다', () => {
  const { room, r, me, h } = homingRoom(1);
  r.cursors.set(me.id, { x: FIELD.w / 2, y: FIELD.h / 2, at: h.at }); // 빗나가 맴돌아도 판 안에 남게 가운데
  me.immuneUntil = Infinity;
  let now = h.at;
  for (; now < h.at + C.homing.lifeMs; now += 50) r.coop.tick(now);
  assert.equal(r.coop.state().homing!.shots.length, 1);
  me.immuneUntil = 0;
  const s = r.coop.state().homing!.shots[0]!;
  r.cursors.set(me.id, { x: s.x, y: s.y, at: now });
  r.coop.tick(now);
  assert.equal(homingHitsOf(me.id).length, 0);
  r.coop.tick(h.at + C.homing.lifeMs + C.homing.fadeMs);
  assert.equal(r.coop.state().homing, null);
  assert.equal(homingSent().at(-1), null);
  room.destroy();
});

test('유도탄: 대상이 탈락하면 그 탄만 사라진다', () => {
  const { room, r, ids, h } = homingRoom(2);
  r.coop.tick(h.at);
  const other = room.players.find((p) => p.id === ids[1])!;
  other.outAt = h.at;
  r.coop.tick(h.at + 50);
  assert.deepEqual(r.coop.state().homing!.shots.map((s) => s.target), [ids[0]]);
  room.destroy();
});

test('유도탄: 일시정지는 시각을 밀고 위치는 그대로', () => {
  const { room, r, h } = homingRoom(1);
  r.coop.tick(h.at); r.coop.tick(h.at + 100);
  const before = r.coop.state().homing!;
  r.coop.shift(5000);
  const after = r.coop.state().homing!;
  assert.equal(after.at, before.at + 5000); assert.equal(after.t, before.t + 5000); assert.equal(after.warnAt, before.warnAt + 5000);
  assert.equal(after.shots[0]!.born, before.shots[0]!.born + 5000);
  r.coop.tick(after.t);
  const s = r.coop.state().homing!.shots[0]!;
  assert.equal(s.x, before.shots[0]!.x); assert.equal(s.y, before.shots[0]!.y);
  room.destroy();
});

test('유도탄: 보호막 단계·탄막 지우기·판 종료는 지운다', () => {
  {
    const { room, r, me, h } = homingRoom(1);
    r.coop.tick(h.at);
    toShield(r, me, h.at + 10, C.phaseAt[1]);
    assert.equal(r.coop.state().homing, null); assert.equal(homingSent().at(-1), null);
    room.destroy();
  }
  {
    const { room, r, h } = homingRoom(1);
    r.coop.tick(h.at);
    (r.coop as unknown as HomingRun).clearShots(h.at + 10);
    assert.equal(r.coop.state().homing, null); assert.equal(homingSent().at(-1), null);
    room.destroy();
  }
  {
    const { room, r, h } = homingRoom(1);
    r.coop.tick(h.at);
    (r.coop as unknown as HomingRun).dispose();
    assert.equal((r.coop as unknown as { homing: unknown }).homing, null);
    room.destroy();
  }
});

test('유도탄: 방어막에 막히면 피해 없이 탄이 사라진다', () => {
  const { room, r, me, h } = homingRoom(1);
  me.coopFx!.guardUntil = Infinity;
  for (let now = h.at; now <= h.at + C.homing.lifeMs && r.coop.state().homing; now += 50) r.coop.tick(now);
  const hit = homingHitsOf(me.id);
  assert.equal(hit.length, 1); assert.equal((hit[0]!.d as { blocked?: boolean }).blocked, true);
  assert.equal(me.hp, C.hpMax);
  assert.equal(r.coop.state().homing, null);
  room.destroy();
});

test('수호 결계: 수정 구간에서도 발동하며 반경 안 팀원이 받는 모든 체력 피해 감소', (t) => {
  const { room, r, me, ids } = coopRoom(2, 0, 'hard');
  t.after(() => room.destroy());
  const ally = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000, ward = C.special.support.ward;
  const center = { x: 500, y: 700 };
  me.coopSpecial = 'ward';
  me.coopCharge = ward.charge;
  toShield(r, me, now);
  assert.equal(r.coop.activateSpecial(me, now), false, '커서 위치 필요');
  assert.equal(me.coopCharge, ward.charge);
  r.cursors.set(me.id, { ...center, at: now });
  assert.equal(r.coop.activateSpecial(me, now), true);
  assert.deepEqual(r.coop.state().wards, [{ ...center, until: now + ward.durationMs }]);
  assert.equal(me.coopCharge, 0);

  const at = now + 1;
  r.cursors.set(ally.id, { x: center.x + ward.radius, y: center.y, at });
  for (const by of Object.keys(C.levels.hard.hurt) as CoopHitBy[]) {
    ally.hp = C.hpMax;
    ally.immuneUntil = 0;
    assert.equal(r.coop.damage(ally, by, at), true, by);
    const reduced = C.levels.hard.hurt[by] * (1 - ward.damageReduction);
    assert.equal(ally.hp, C.hpMax - reduced, by);
  }

  ally.hp = C.hpMax;
  ally.immuneUntil = 0;
  r.cursors.set(ally.id, { x: center.x + ward.radius + 1, y: center.y, at });
  r.coop.damage(ally, 'bullet', at);
  assert.equal(ally.hp, C.hpMax - C.levels.hard.hurt.bullet);

  r.coop.shift(2000);
  const until = now + ward.durationMs + 2000;
  assert.equal(r.coop.state().wards?.[0]?.until, until);
  const ownHp = me.hp;
  r.coop.damage(me, 'bullet', until);
  assert.equal(me.hp, ownHp - C.levels.hard.hurt.bullet);
});

test('중력 족쇄: 보스 정지, 팀 색 원만 발사, 해제 후 10초 팀 공통 내성', (t) => {
  const { room, r, me, ids } = coopRoom(2, 0, 'expert');
  t.after(() => room.destroy());
  const ally = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000, bind = C.special.support.bind;
  const run = r.coop as unknown as { nextBullet: number; nextOrb: Map<string, number>; threatAt: number; rand: () => number };
  // 난수 0은 평소라면 노란 원과 ? 원을 우선 뽑는다.
  run.rand = () => 0;
  run.nextBullet = now;
  run.threatAt = now + 500;
  for (const p of [me, ally]) {
    run.nextOrb.set(p.id, now);
    p.coopSpecial = 'bind';
    p.coopCharge = bind.charge;
  }
  const before = circlePos(r.coop.boss, now);
  sent.length = 0;
  assert.equal(r.coop.activateSpecial(me, now), true);
  assert.equal(me.coopCharge, 0);
  const until = now + bind.durationMs, immuneUntil = until + bind.immunityMs;
  assert.equal(r.coop.state().bindUntil, until);
  assert.equal(r.coop.state().bindImmuneUntil, immuneUntil);
  assert.deepEqual(sent.find((e) => e.ev === 'circles:hold')?.d, { ids: [r.coop.boss.id], at: now, ms: bind.durationMs, bossOnly: true });
  assert.deepEqual(circlePos(r.coop.boss, until), before);
  assert.notDeepEqual(circlePos(r.coop.boss, until + 100), before);
  r.coop.tick(now + 2000);
  const created = sent.filter((e) => e.ev === 'circle:spawn').map((e) => e.d as Circle);
  assert.deepEqual(new Set(created.map((c) => c.kind)), new Set([me.color, ally.color]));
  assert.ok(created.every((c) => !c.coopItem && c.from?.x === before.x));
  assert.equal(sent.some((e) => e.ev === 'coop:volley'), false);
  for (const t of [now + 1, until, immuneUntil - 1]) {
    assert.equal(r.coop.activateSpecial(ally, t), false);
    assert.equal(ally.coopCharge, bind.charge);
  }
  r.coop.tick(until);
  assert.equal(sent.some((e) => e.ev === 'coop:volley'), true);
  assert.equal(r.coop.activateSpecial(ally, immuneUntil), true);
});

test('연계 신호: 발동자와 팀원의 콤보가 하나씩 더 쌓이고 종료와 함께 보너스가 끝난다', (t) => {
  const { room, r, me, ids } = coopRoom(2, 0, 'hard');
  t.after(() => room.destroy());
  const ally = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000, link = C.special.support.link;
  const host = room as unknown as { catchCoopOrb(p: PlayerState, c: Circle, now: number): void };
  const catchOrb = (p: PlayerState, at: number, kind: Circle['kind']) => {
    const c = orbOf(kind, at);
    r.circles.set(c.id, c);
    host.catchCoopOrb(p, c, at);
  };
  me.coopSpecial = 'link';
  me.coopCharge = link.charge;
  assert.equal(r.coop.activateSpecial(me, now), true);
  assert.equal(me.coopCharge, 0);
  catchOrb(me, now + 1, me.color);
  catchOrb(ally, now + 1, 'y');
  assert.equal(me.combo, 1 + link.comboAdd);
  assert.equal(ally.combo, 1 + link.comboAdd);
  assert.equal(me.coopCharge, C.special.gain.orb);
  catchOrb(ally, now + link.durationMs, ally.color);
  assert.equal(ally.combo, 2 + link.comboAdd);
});

test('색 수정: 실제 클릭에서 다른 팀원도 피해 1을 주고 같은 색은 피해 2를 준다', (t) => {
  const { room, r, me, ids } = coopRoom(2, 0, 'hard');
  t.after(() => room.destroy());
  const ally = room.players.find((p) => p.id === ids[1])!;
  r.startAt = Date.now() - 1000;
  const now = Date.now();
  toShield(r, me, now);
  const crystal = crystals(r).find((c) => c.target === me.id)!;
  const pt = circlePos(crystal, now);
  room.click(ally.id, { circleId: crystal.id, ...pt });
  assert.equal(crystal.hp, crystalHp('hard', 0) - C.crystal.otherColorDamage);
  room.click(me.id, { circleId: crystal.id, ...pt });
  assert.equal(crystal.hp, crystalHp('hard', 0) - C.crystal.otherColorDamage - C.crystal.sameColorDamage);
});

test('엑스퍼트: 두 보호막 모두 색 수정 뒤 중앙 프리즘을 다섯 번 클릭해 파훼', (t) => {
  for (const [no, edge] of C.phaseAt.entries()) {
    const { room, r, me } = coopRoom(1, 1, 'expert');
    t.after(() => room.destroy());
    const bot = room.players.find((p) => p.bot)!;
    r.startAt = Date.now() - 1000;
    const now = Date.now();
    r.coop.phase = no + 1;
    toShield(r, me, now, edge);
    const deadline = r.coop.state().shield!.until;
    breakMine(r, me, now);
    assert.equal(crystals(r).some((c) => c.prism), false);
    breakMine(r, bot, now);
    assert.equal(r.coop.isShielded(), true);
    assert.equal(r.coop.state().shield?.prism, true);
    assert.equal(r.coop.state().shield?.until, deadline);
    const [prism] = crystals(r);
    assert.equal(crystals(r).length, 1);
    assert.equal(prism?.prism, true);
    assert.equal(prism?.hp, C.crystal.prismHp);
    assert.deepEqual(circlePos(prism!, now), { x: FIELD.w / 2, y: FIELD.h / 2 });
    assert.equal(r.coop.hitCrystal(bot, prism!, now), false);
    const click = { circleId: prism!.id, ...circlePos(prism!, now) };
    for (const remaining of [4, 3, 2, 1]) {
      room.click(me.id, click);
      assert.equal(prism!.hp, remaining);
      assert.equal(r.coop.isShielded(), true);
    }
    room.click(me.id, click);
    assert.equal(crystals(r).length, 0);
    assert.equal(r.coop.isShielded(), false);
    assert.equal(r.coop.phase, no + 2);
  }
});

test('엑스퍼트: 색 수정을 다 깨도 프리즘이 남으면 같은 제한 시간에 폭주', (t) => {
  const { room, r, me } = coopRoom(1, 0, 'expert');
  t.after(() => room.destroy());
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  assert.equal(r.coop.state().shield?.prism, true);
  const deadline = r.coop.state().shield!.until;
  r.coop.tick(deadline);
  r.coop.tick(deadline + C.rageWarnMs + 1);
  assert.equal(room.phase, 'play');
  assert.equal(me.hp, C.hpMax - C.levels.expert.hurt.rage);
  assert.equal(r.coop.isShielded(), false);
  assert.deepEqual(crystals(r), []);
  assert.equal(r.coop.state().rampageUntil, deadline + C.rageWarnMs + 1 + C.rampageMs);
});
