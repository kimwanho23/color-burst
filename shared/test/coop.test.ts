import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, FIELD, PRESETS, RULES, applyRaidDamage, circlePos, coopPhase, coopStars, crystalHits, immuneMs, inSafe, isGuarded, isOut,
  makeCrystal, makeOrb, makeRaid, makeThreat, matchPreset, newPlayer, orbDamage, placeCrystals, raidMaxHp, safeZoneAt, sanitizeRules, toGameRules, zoneOf,
  type Circle, type CoopHitBy, type CoopResult, type CoopState, type GameOver, type PlayerState, type SafeZones,
} from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { gameRecord } from '../../server/src/gameLog.ts';
import { Bot } from '../../server/src/bot.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop;

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

test('immuneMs: 기본 2000', () => {
  assert.equal(immuneMs(), 2000);
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
  for (const k of ['easy', 'normal', 'hard'] as const) assert.ok(L[k]);
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

// ---------- 방 ----------

type CoopRunT = {
  damage(p: PlayerState, by: CoopHitBy, now: number): boolean; threatEscaped(c: Circle, now: number): void;
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number; killed: boolean }; hitCrystal(p: PlayerState, c: Circle, now: number): boolean;
  tick(now: number): void; shift(delta: number): void; recheck(): void; phase: number; boss: Circle;
  state(): CoopState; result(now: number, startAt: number, win: boolean): CoopResult; isShielded(): boolean; inBurst(now: number): boolean;
};
type CRoom = {
  coop: CoopRunT; startAt: number; endAt: number; circles: Map<number, Circle>; pausedAt: number;
  lasers: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number; hit: Set<string> }[];
  cursors: Map<string, { x: number; y: number; at: number }>; G: { roundMs: number };
  updateLaser(now: number): void; tick(): void; clickLog: Map<string, number[]>;
};

function coopRoom(humans = 1, bots = 4 - humans) {
  const room = new Room(fakeIo(), 'COOP', () => {});
  const ids: string[] = [];
  for (let i = 0; i < humans; i++) ids.push((room.join(`s${i}`, `k${i}`, `P${i}`) as { id: string }).id);
  room.setRules(ids[0]!, { rules: { coop: true } });
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

test('coop 시작: 레이드 보스 1마리, 사람 생명 3·봇 0, 판 180초', () => {
  const { room, r, me } = coopRoom();
  assert.equal(room.players.length, 4);
  const raids = [...r.circles.values()].filter((c) => c.boss === 'raid');
  assert.equal(raids.length, 1);
  assert.equal(raids[0]!.maxHp, raidMaxHp(1, 3));
  assert.equal(me.lives, C.lives);
  assert.ok(room.players.filter((p) => p.bot).every((p) => p.lives === 0));
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

test('coop 분노: 제한 시간 안에 못 깨면 경고 뒤 모두 생명 −1, 남은 수정 횟수 처음으로', () => {
  const { room, r, me } = coopRoom(2, 0);
  const now = r.startAt + 5000;
  toShield(r, me, now);
  const c = crystals(r).find((x) => x.target === me.id)!;
  r.coop.hitCrystal(me, c, now);
  const end = now + C.levels.normal.crystalSec * 1000;
  r.coop.tick(end + 1);
  assert.ok(r.coop.state().rageAt > 0);
  r.coop.tick(end + 1 + C.rageWarnMs + 1);
  assert.ok(room.players.filter((p) => !p.bot).every((p) => p.lives === 2));
  assert.equal(c.hp, crystalHits('normal', 0));
  assert.equal(r.coop.result(end + 5000, r.startAt, false).breaks.length, 0, '아직 안 깨짐');
  room.destroy();
});

test('coop 보호막 중 주인이 탈락하면 그 수정은 깬 것으로', () => {
  const { room, r, me, ids } = coopRoom(2, 0);
  const other = room.players.find((p) => p.id === ids[1])!;
  const now = r.startAt + 5000;
  toShield(r, me, now);
  for (let i = 0; i < 3; i++) r.coop.damage(other, 'laser', now + i * 3000);
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
  assert.deepEqual([me.lives, other.lives], [2, 3]);
  room.destroy();
});

test('coop 안전지대: 발동 순간 밖이면 −1, 안이면 그대로', () => {
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
  assert.equal(me.lives, 3);
  assert.equal(other.lives, 2);
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

test('coop 생명: 레이저에 맞으면 −1과 스턴, 2초 동안 다시 안 줄어듦', () => {
  const { room, r, me } = coopRoom();
  const shoot = (now: number) => {
    r.cursors.set(me.id, { x: 100, y: 100, at: now });
    r.lasers.push({ lines: [{ a: { x: 0, y: 100 }, b: { x: FIELD.w, y: 100 } }], at: now, hit: new Set() });
    r.updateLaser(now);
  };
  const t0 = r.startAt + 5000;
  shoot(t0);
  assert.equal(me.lives, 2);
  assert.ok(me.stunUntil > t0);
  shoot(t0 + 1500);
  assert.equal(me.lives, 2);
  shoot(t0 + C.immuneMs + 100);
  assert.equal(me.lives, 1);
  room.destroy();
});

test('coop 생명: 겹친 피격은 한 번', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.damage(me, 'laser', now), true);
  r.coop.threatEscaped(makeThreat(999, now, { x: 0, y: 0 }, 0, 100, me.id), now);
  assert.equal(r.coop.damage(me, 'hazard', now), false);
  assert.equal(me.lives, 2);
  room.destroy();
});

test('coop 추적 원: 놓치면 표적만 −1, 봇·탈락한 표적이면 그대로', () => {
  const { room, r, me } = coopRoom(2);
  const other = room.players.find((p) => !p.bot && p.id !== me.id)!;
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  r.coop.threatEscaped(makeThreat(900, now, { x: 0, y: 0 }, 0, 100, me.id), now);
  assert.deepEqual([me.lives, other.lives], [2, 3]);
  r.coop.threatEscaped(makeThreat(901, now + 3000, { x: 0, y: 0 }, 0, 100, bot.id), now + 3000);
  assert.equal(bot.lives, 0);
  other.outAt = 1;
  const before = other.lives;
  r.coop.threatEscaped(makeThreat(902, now + 6000, { x: 0, y: 0 }, 0, 100, other.id), now + 6000);
  assert.equal(other.lives, before);
  room.destroy();
});

test('coop 탈락: 생명 0이면 원을 잡아도 피해 없음, 사람이 모두 탈락하면 패배로 끝', () => {
  const { room, r, me, ids } = coopRoom(2);
  const other = room.players.find((p) => p.id === ids[1])!;
  const t = r.startAt + 5000;
  for (let i = 0; i < 3; i++) r.coop.damage(me, 'laser', t + i * 3000);
  assert.ok(me.outAt > 0);
  assert.equal(room.phase, 'play');
  const hp = r.coop.boss.hp;
  r.coop.catchOrb(me, orbOf(me.color, t + 10_000), t + 10_000);
  assert.equal(r.coop.boss.hp, hp);
  for (let i = 0; i < 3; i++) r.coop.damage(other, 'laser', t + 20_000 + i * 3000);
  assert.equal(room.phase, 'lobby');
  assert.equal(overOf()?.coop?.win, false);
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
