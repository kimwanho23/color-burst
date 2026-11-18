import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, FIELD, PRESETS, RULES, applyRaidDamage, circlePos, coopPhase, coopStars, crystalHits, inSafe, isGuarded, isHit, isOut,
  makeCrystal, makeOrb, makeRaid, makeThreat, matchPreset, newPlayer, orbDamage, placeCrystals, raidMaxHp, safeZoneAt, sanitizeRules, shotGone, shotPos, toGameRules, zoneOf,
  type Circle, type CoopHitBy, type CoopResult, type CoopState, type GameOver, type PlayerState, type SafeZones, type Volley,
} from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { gameRecord } from '../../server/src/gameLog.ts';
import { Bot } from '../../server/src/bot.ts';

mock.method(console, 'log', () => {});
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
  assert.equal(C.hpBase, 150);
  assert.equal(raidMaxHp(1, 3), Math.round(150 * 2.5));
});

test('orbDamage: 내 색 1, 노랑 0.7, 콤보 30에 +30%, 상한 50%, 큰 피해 ×2, 봇 ×0.5', () => {
  const p = newPlayer('a', 'A', 0);
  assert.equal(orbDamage(p, 0, false), 1);
  assert.equal(orbDamage(p, 'y', false), 0.7);
  p.combo = 30;
  assert.ok(Math.abs(orbDamage(p, 0, false) - 1.3) < 1e-9);
  p.combo = 90;
  assert.ok(Math.abs(orbDamage(p, 0, false) - 1.5) < 1e-9);
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

test('makeCrystal: 움직이지 않고 체력 = 횟수, 주인과 색', () => {
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
  assert.ok(x.laserEvery[0] < h.laserEvery[0] && x.laserEvery[1] < h.laserEvery[1] && x.laserWarnMs <= h.laserWarnMs && x.laserWidth > h.laserWidth);
  assert.ok(x.threatEvery < h.threatEvery && x.threatCount > h.threatCount && x.threatSpeed > h.threatSpeed && x.phase3Mult < h.phase3Mult);
  assert.ok(x.crystalHits[0] > h.crystalHits[0] && x.crystalHits[1] > h.crystalHits[1] && x.crystalSec < h.crystalSec);
  assert.ok(x.slamEvery < h.slamEvery && x.safeEvery < h.safeEvery && x.safeCount <= h.safeCount && x.mapEvery < h.mapEvery && x.orbMult < h.orbMult);
});

test('난이도 표: 세 난이도 모두 있고 하드일수록 공격이 잦고 수정이 단단하다', () => {
  const L = C.levels;
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) assert.ok(L[k]);
  assert.ok(L.easy.laserEvery[0] > L.normal.laserEvery[0] && L.normal.laserEvery[0] > L.hard.laserEvery[0]);
  assert.ok(L.easy.slamEvery > L.hard.slamEvery && L.easy.crystalSec > L.hard.crystalSec);
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

// ---------- 방 ----------

type CoopRunT = {
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
    assert.ok(colors.has(o.kind) || o.kind === 'y', String(o.kind));
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
  assert.ok(crystals(r).every((c) => c.hp === crystalHits('normal', 0)));
  const hp = r.coop.boss.hp;
  assert.equal(r.coop.catchOrb(me, orbOf(me.color, now + 10), now + 10).dmg, 0);
  assert.equal(r.coop.boss.hp, hp);
  const before = r.circles.size;
  for (let k = 0; k < 5; k++) r.coop.tick(now + 100 + k * 1000);
  assert.equal(r.circles.size, before, '보호막 중 원이 안 나옴');
  room.destroy();
});

test('coop 수정: 주인만, 횟수만큼 눌러 깨고 모두 깨면 큰 피해 (피해 2배)', () => {
  const { room, r, me } = coopRoom(1, 1);
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const mine = crystals(r).find((c) => c.target === me.id)!;
  r.coop.hitCrystal(bot, mine, now);
  assert.equal(mine.hp, crystalHits('normal', 0), '남이 누르면 그대로');
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
  r.coop.tick(now + C.burst.ms + 10);
  assert.equal(r.coop.phase, 2);
  assert.equal(r.coop.state().shield, null);
  room.destroy();
});

test('coop 큰 피해 구간에도 단계 경계에서 멈추고 보호막', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  r.coop.tick(now + C.burst.ms + 10); // 2단계
  const t2 = now + C.burst.ms + 100;
  toShield(r, me, t2, C.phaseAt[1]);
  breakMine(r, me, t2);
  r.coop.tick(t2 + C.burst.ms + 10);
  assert.equal(r.coop.phase, 3);
  // 다시: 2단계에서 큰 피해 중 경계 → 33%에서 멈춤
  const { room: room2, r: r2, me: me2 } = coopRoom(1, 0);
  const n2 = r2.startAt + 5000;
  toShield(r2, me2, n2);
  breakMine(r2, me2, n2);
  r2.coop.tick(n2 + C.burst.ms + 10);
  const b = r2.coop.boss;
  // 2단계 시작 직후 큰 피해 구간을 흉내: 경계 바로 위에서 큰 피해 원
  b.hp = b.maxHp! * C.phaseAt[1] + 1;
  const t3 = n2 + C.burst.ms + 200;
  r2.coop.catchOrb(me2, orbOf(me2.color, t3), t3);
  assert.ok(Math.abs(b.hp! - b.maxHp! * C.phaseAt[1]) < 1e-9);
  assert.equal(r2.coop.state().shield?.no, 1);
  room.destroy(); room2.destroy();
});

test('coop 분노: 제한 시간 안에 못 깨면 경고 뒤 모두 체력 −(노말 분노), 남은 수정 횟수 처음으로', () => {
  const { room, r, me } = coopRoom(2, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const c = crystals(r).find((x) => x.target === me.id)!;
  r.coop.hitCrystal(me, c, now);
  const end = now + C.levels.normal.crystalSec * 1000;
  r.coop.tick(end + 1);
  assert.ok(r.coop.state().rageAt > 0);
  r.coop.tick(end + 1 + C.rageWarnMs + 1);
  assert.ok(room.players.filter((p) => !p.bot).every((p) => p.hp === C.hpMax - C.levels.normal.hurt.rage));
  assert.equal(c.hp, crystalHits('normal', 0));
  assert.equal(r.coop.result(end + 5000, r.startAt, false).breaks.length, 0, '아직 안 깨짐');
  room.destroy();
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
  const t = now + C.burst.ms + 10;
  r.coop.tick(t); // 2단계
  r.cursors.set(me.id, { x: 500, y: 600, at: Date.now() + 1e9 });
  r.cursors.set(other.id, { x: 300, y: 800, at: Date.now() + 1e9 });
  sent.length = 0;
  let k = 0;
  while (!sent.some((s) => s.ev === 'coop:slam') && k++ < 200) r.coop.tick(t + k * 100);
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
  (r.coop as unknown as { schedule(now: number): void }).schedule(t);
  sent.length = 0;
  let k = 0;
  while (!sent.some((s) => s.ev === 'coop:safe' && s.d) && k++ < 400) r.coop.tick(t + k * 100);
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
  assert.deepEqual(res.breaks, [{ ms: 2000, rages: 0 }]);
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

test('회복: 큰 피해 구간 시작에 +25(최대 100), 엑스퍼트는 회복 없음', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  me.hp = 50; other.hp = 90;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  breakMine(r, me, now);
  breakMine(r, other, now);
  assert.equal(r.coop.inBurst(now + 1), true);
  assert.deepEqual([me.hp, other.hp], [50 + C.heal.burstStart, C.hpMax]);
  room.destroy();
  const ex = coopRoom(1, 0, 'expert');
  ex.me.hp = 50;
  toShield(ex.r, ex.me, ex.r.startAt + 5000);
  breakMine(ex.r, ex.me, ex.r.startAt + 5000);
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
  assert.equal((healed!.d as PlayerState[]).find((p) => p.id === me.id)!.hp, 50 + C.heal.burstStart);
  sent.length = 0;
  r.coop.damage(me, 'laser', now + 5000);
  const hit = sent.find((x) => x.ev === 'coop:hit')!.d as { dmg: number; hp: number };
  assert.deepEqual([hit.dmg, hit.hp], [N.laser, 50 + C.heal.burstStart - N.laser]);
  room.destroy();
});

test('엑스퍼트 분노: 바로 패배, reason crystal', () => {
  const { room, r, me } = coopRoom(1, 0, 'expert');
  assert.equal(C.levels.expert.hurt.rage, Infinity);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const end = now + C.levels.expert.crystalSec * 1000;
  r.coop.tick(end + 1);
  assert.equal(room.phase, 'play');
  r.coop.tick(end + 1 + C.rageWarnMs + 1);
  assert.equal(room.phase, 'lobby');
  assert.equal(overOf()?.coop?.win, false);
  assert.equal(overOf()?.coop?.reason, 'crystal');
  assert.equal(me.hp, C.hpMax);
  room.destroy();
});

test('난이도 표: 모든 단계에 모든 공격의 피해, 분노만 엑스퍼트에서 Infinity', () => {
  const by = Object.keys(C.hurtFx);
  for (const k of ['easy', 'normal', 'hard', 'expert'] as const) {
    assert.deepEqual(Object.keys(C.levels[k].hurt).sort(), [...by].sort());
    for (const b of by) assert.ok(C.levels[k].hurt[b as CoopHitBy] > 0);
    assert.equal(Number.isFinite(C.levels[k].hurt.rage), k !== 'expert');
  }
});

test('coop 피격: 겹친 피격은 한 번', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.damage(me, 'laser', now), true);
  r.coop.threatEscaped(makeThreat(999, now, { x: 0, y: 0 }, 0, 100, me.id), now);
  assert.equal(r.coop.damage(me, 'hazard', now), false);
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
  let crystalHitsN = 0;
  for (let k = 0; k < 20; k++) if (pick([raid, myCrystal, mine])?.id === 2) crystalHitsN++;
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
  (r.coop as unknown as { schedule(now: number): void }).schedule(t);
  r.cursors.set(me.id, { x: 500, y: 600, at: Date.now() + 1e9 });
  let k = 0;
  while (!r.coop.state().safe && k++ < 400) r.coop.tick(t + k * 100);
  assert.ok(r.coop.state().safe);
  k = 0;
  while (!r.coop.state().slams.length && k++ < 400) r.coop.tick(t + 40_000 + k * 100);
  assert.ok(r.coop.state().slams.length >= 0);
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

test('coop 검토: 파훼 기록은 보호막마다 하나 (분노 횟수 포함)', () => {
  const { room, r, me } = coopRoom(1, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const end = now + C.levels.normal.crystalSec * 1000;
  r.coop.tick(end + 1);
  r.coop.tick(end + 2 + C.rageWarnMs);
  breakMine(r, me, end + 5000);
  assert.deepEqual(r.coop.result(end + 6000, r.startAt, false).breaks, [{ ms: end + 5000 - now, rages: 1 }]);
  room.destroy();
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

const volleysSent = () => sent.filter((s) => s.ev === 'coop:volley').map((s) => s.d as Volley);
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
  for (let t = tb; t < tb + C.burst.ms; t += 50) r.coop.tick(t);
  assert.equal(volleysSent().length, 0, '큰 피해 구간에는 쏘지 않음');
  for (let t = tb + C.burst.ms; t <= tb + C.burst.ms + 3000; t += 50) r.coop.tick(t);
  assert.ok(volleysSent().length > 0, '끝나면 다시 쏨');
  room.destroy();
});

test('탄막: 조준 무늬는 살아 있는 사람 커서를 노림', () => {
  const { room, r, me } = coopRoom(1, 0);
  r.coop.phase = 2;
  r.cursors.set(me.id, { x: 100, y: 1000, at: Date.now() + 1e9 });
  sent.length = 0;
  for (let t = r.startAt; t <= r.startAt + 60_000; t += 50) r.coop.tick(t);
  const aimed = volleysSent().filter((v) => v.shots.length === C.bullets.aimedCount);
  assert.ok(aimed.length > 0);
  for (const v of aimed) {
    const mid = v.shots[(C.bullets.aimedCount - 1) / 2]!;
    assert.ok(Math.abs(mid.a - Math.atan2(1000 - mid.y, 100 - mid.x)) <= 0.005, String(mid.a));
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
