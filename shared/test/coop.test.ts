import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COOP_CARD_IDS, DEFAULT_RULES, FIELD, PRESETS, RULES, applyRaidDamage, circlePos, coopPhase, coopStars, drawCards, immuneMs, isGuarded, isOut,
  makeRaid, makeThreat, matchPreset, newPlayer, raidDamage, raidMaxHp, sanitizeRules, tallyVotes, toGameRules,
  type Circle, type CoopCardId, type CoopResult, type GameOver, type PlayerState,
} from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { gameRecord } from '../../server/src/gameLog.ts';
import { Bot } from '../../server/src/bot.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop;

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
  assert.equal(raidMaxHp(4, 0), C.hpBase * 4);
});

test('raidDamage: 피버 ×2, 콤보 30에 +30%, 콤보 상한 50%, 연속 공격 1장이면 상한 75%, 강타 1장 +25%, 봇 ×0.5', () => {
  const p = newPlayer('a', 'a', 0);
  assert.equal(raidDamage(p, [], false), 1);
  assert.equal(raidDamage(p, [], true), C.feverDmg);
  p.combo = 30;
  assert.ok(Math.abs(raidDamage(p, [], false) - 1.3) < 1e-9);
  p.combo = 90;
  assert.ok(Math.abs(raidDamage(p, [], false) - 1.5) < 1e-9);
  assert.ok(Math.abs(raidDamage(p, ['chain'], false) - 1.75) < 1e-9);
  p.combo = 0;
  assert.ok(Math.abs(raidDamage(p, ['power'], false) - 1.25) < 1e-9);
  assert.equal(raidDamage(p, ['heat'], true), C.feverDmg + C.heatStep);
  const bot = newPlayer('b', 'b', 1, true);
  assert.equal(raidDamage(bot, [], false), C.botWeight);
});

test('applyRaidDamage: 경계에서 멈춤 (단계 두 개를 한 번에 넘지 않음)', () => {
  const c = makeRaid(1, 0, 100);
  c.hp = 70;
  assert.deepEqual(applyRaidDamage(c, 50), { dealt: 3, crossed: true });
  assert.equal(c.hp, 67);
  assert.equal(coopPhase(c.hp, 100), 2);
  // 다음 타격은 33에서 멈춘다
  applyRaidDamage(c, 1000);
  assert.equal(c.hp, 33);
});

test('applyRaidDamage: 3단계는 0까지, 경계 안이면 crossed 아님', () => {
  const c = makeRaid(1, 0, 100);
  c.hp = 20;
  assert.deepEqual(applyRaidDamage(c, 5), { dealt: 5, crossed: false });
  assert.deepEqual(applyRaidDamage(c, 99), { dealt: 15, crossed: true });
  assert.equal(c.hp, 0);
  assert.deepEqual(applyRaidDamage(c, 1), { dealt: 0, crossed: false });
});

test('drawCards: 서로 다른 3장', () => {
  for (let i = 0; i < 100; i++) {
    let seed = i;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const cs = drawCards(rand);
    assert.equal(cs.length, 3);
    assert.equal(new Set(cs).size, 3);
    for (const c of cs) assert.ok(COOP_CARD_IDS.includes(c));
  }
});

test('tallyVotes: 최다 득표 / 동점은 그중 / 무투표는 options 중 / options 밖 표 무시', () => {
  const opts: CoopCardId[] = ['power', 'heal', 'slow'];
  assert.equal(tallyVotes(opts, new Map([['a', 'heal'], ['b', 'heal'], ['c', 'power']])), 'heal');
  const tie = new Map<string, CoopCardId>([['a', 'heal'], ['b', 'slow']]);
  assert.equal(tallyVotes(opts, tie, () => 0), 'heal');
  assert.equal(tallyVotes(opts, tie, () => 0.99), 'slow');
  assert.equal(tallyVotes(opts, new Map(), () => 0.5), 'heal');
  assert.equal(tallyVotes(opts, new Map([['a', 'tough'], ['b', 'slow']])), 'slow');
});

test('coopStars: 진 판 0, 모두 생존·60초 남음 3, 절반 생존 2, 그 밖 1', () => {
  assert.equal(coopStars(false, 1, 100_000), 0);
  assert.equal(coopStars(true, 1, 60_000), 3);
  assert.equal(coopStars(true, 1, 59_000), 2);
  assert.equal(coopStars(true, 0.5, 0), 2);
  assert.equal(coopStars(true, 0.25, 90_000), 1);
});

test('immuneMs: 기본 2000, 단단한 몸 1장 3000', () => {
  assert.equal(immuneMs([]), 2000);
  assert.equal(immuneMs(['tough']), 3000);
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

test('toGameRules: 협력전이면 180초·레이저/보스/견제/맵 끔·레이저 두께는 난이도', () => {
  const G = toGameRules({ ...DEFAULT_RULES, coop: true, coopLevel: 'hard' });
  assert.equal(G.roundMs, C.timeSec * 1000);
  assert.deepEqual([G.laser, G.boss, G.stealPenalty, G.sabotage, G.comeback, G.arcade, G.mapChance, G.markMs], [false, false, false, false, false, false, 0, 0]);
  assert.equal(G.laserHalf, (C.levels.hard.laserWidth / 100) * FIELD.h / 2);
  assert.ok(toGameRules({ ...DEFAULT_RULES, coop: true, coopLevel: 'easy' }).laserHalf < G.laserHalf);
});

test('난이도 표: 세 난이도 모두 있고 하드일수록 공격이 잦다', () => {
  const L = C.levels;
  for (const k of ['easy', 'normal', 'hard'] as const) assert.ok(L[k]);
  assert.ok(L.easy.laserEvery[0] > L.normal.laserEvery[0] && L.normal.laserEvery[0] > L.hard.laserEvery[0]);
  assert.ok(L.easy.threatCount < L.hard.threatCount);
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
});

// ---------- 방 ----------

type CoopRunT = {
  damage(p: PlayerState, by: 'laser' | 'hazard' | 'threat', now: number): boolean; threatEscaped(c: Circle, now: number): void;
  pick(id: string, c: CoopCardId): void; busy(): boolean; voting(): boolean; cards: CoopCardId[]; phase: number; boss: Circle;
  openVote(now: number): void; state(): { voting: { options: CoopCardId[] } | null };
};
type CRoom = {
  coop: CoopRunT; startAt: number; endAt: number; circles: Map<number, Circle>; pausedAt: number; pausedBy: string | null;
  lasers: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number; hit: Set<string> }[];
  cursors: Map<string, { x: number; y: number; at: number }>; G: { roundMs: number };
  updateLaser(now: number): void; hitRaid(p: PlayerState, c: Circle, now: number): void; tick(): void;
};

function coopRoom(humans = 1) {
  const room = new Room(fakeIo(), 'COOP', () => {});
  const ids: string[] = [];
  for (let i = 0; i < humans; i++) ids.push((room.join(`s${i}`, `k${i}`, `P${i}`) as { id: string }).id);
  room.setRules(ids[0], { rules: { coop: true } });
  room.fillBots = false;
  for (const id of ids.slice(1)) room.setReady(id, true);
  sent.length = 0;
  assert.equal(room.start(ids[0]), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === ids[0])!;
  return { room, r, me, ids };
}
const overOf = () => sent.find((s) => s.ev === 'game:over')?.d as GameOver | undefined;

test('coop 시작: 레이드 보스 1마리, 사람 생명 3·봇 0, 봇 채우기 자동, 판 180초', () => {
  const { room, r, me } = coopRoom();
  assert.equal(room.players.length, 4);
  const raids = [...r.circles.values()].filter((c) => c.boss === 'raid');
  assert.equal(raids.length, 1);
  assert.equal(raids[0].maxHp, raidMaxHp(1, 3));
  assert.equal(me.lives, C.lives);
  assert.ok(room.players.filter((p) => p.bot).every((p) => p.lives === 0));
  assert.equal(r.G.roundMs, C.timeSec * 1000);
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

test('coop 공격 원: 놓치면 표적만 −1, 봇·탈락한 표적이면 그대로', () => {
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

test('coop 탈락: 생명 0이면 outAt·클릭 무시, 사람이 모두 탈락하면 패배로 끝', () => {
  const { room, r, me, ids } = coopRoom(2);
  const other = room.players.find((p) => p.id === ids[1])!;
  const t = r.startAt + 5000;
  for (let i = 0; i < 3; i++) r.coop.damage(me, 'laser', t + i * 3000);
  assert.ok(me.outAt > 0);
  assert.equal(room.phase, 'play');
  const boss = r.coop.boss;
  const hp = boss.hp;
  r.hitRaid(me, boss, t + 10_000);
  assert.equal(boss.hp, hp);
  for (let i = 0; i < 3; i++) r.coop.damage(other, 'laser', t + 20_000 + i * 3000);
  assert.equal(room.phase, 'lobby');
  assert.equal(overOf()?.coop?.win, false);
  room.destroy();
});

test('coop 승리: 보스 체력 0이면 game:over coop.win, 사람 모두 1승', () => {
  const { room, r, me } = coopRoom();
  const boss = r.coop.boss;
  boss.hp = 1;
  r.hitRaid(me, boss, r.startAt + 5000);
  assert.equal(room.phase, 'lobby');
  const over = overOf()!;
  assert.equal(over.coop?.win, true);
  assert.ok((over.coop?.stars ?? 0) >= 1);
  assert.equal(over.wins[me.id], 1);
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

/** 1단계 경계 바로 위에서 한 대 → 단계 전환, 바로 투표를 연다 */
function toVote(r: CRoom, me: PlayerState) {
  const boss = r.coop.boss;
  boss.hp = Math.floor(boss.maxHp! * C.phaseAt[0]) + 1;
  const now = r.startAt + 5000;
  r.hitRaid(me, boss, now);
  assert.equal(r.coop.busy(), true);
  r.coop.openVote(now + C.phaseInvulnMs);
  return r.coop.state().voting!.options;
}

test('coop 투표: 경계를 넘으면 전환, 투표 중 시계 멈춤, 모두 투표하면 바로 마감·카드 적용', () => {
  const { room, r, me } = coopRoom();
  const opts = toVote(r, me);
  assert.equal(opts.length, 3);
  assert.ok(r.pausedAt > 0);
  assert.ok(sent.some((s) => s.ev === 'game:pause' && (s.d as { by: string }).by === ''));
  r.coop.pick(me.id, opts[1]);
  assert.equal(r.coop.voting(), false);
  assert.deepEqual(r.coop.cards, [opts[1]]);
  assert.equal(r.coop.phase, 2);
  room.destroy();
});

test('coop 투표: 일시정지 요청 무시', () => {
  const { room, r, me } = coopRoom();
  toVote(r, me);
  const left = me.pausesLeft;
  room.pause(me.id);
  room.resume(me.id);
  assert.equal(r.pausedBy, null);
  assert.equal(me.pausesLeft, left);
  assert.equal(r.coop.voting(), true);
  room.destroy();
});

test('coop 투표: 나간 사람은 기다리지 않음', () => {
  const { room, r, me, ids } = coopRoom(2);
  const opts = toVote(r, me);
  r.coop.pick(me.id, opts[0]);
  assert.equal(r.coop.voting(), true);
  room.disconnect(ids[1], 's1');
  assert.equal(r.coop.voting(), false);
  assert.deepEqual(r.coop.cards, [opts[0]]);
  room.destroy();
});

test('coop 봇: 생명이 줄지 않고 투표에 안 들어감', () => {
  const { room, r, me } = coopRoom();
  const bot = room.players.find((p) => p.bot)!;
  assert.equal(r.coop.damage(bot, 'laser', r.startAt + 5000), false);
  const opts = toVote(r, me);
  r.coop.pick(bot.id, opts[0]);
  assert.equal(r.coop.voting(), true);
  room.destroy();
});

test('coop 봇: 남의 색은 노리지 않고 공격 원을 노림', () => {
  const now = 100_000;
  const me = newPlayer('b', 'b', 0, true);
  const other: Circle = { id: 1, kind: 1, angle: 0, speed: 100, r: 30, born: now - 2000 };
  const th = makeThreat(2, now - 2000, { x: 100, y: 100 }, Math.PI, 10, 'x');
  for (let i = 0; i < 50; i++) {
    const got = new Bot(2).think(me, [other, th], [me], now + 5000, false, true);
    if (got) assert.equal(got.id, 2);
  }
});

test('gameRecord: 협력전이면 coopResult와 사람마다 lives·outAt', () => {
  const a = newPlayer('a', 'a', 0); a.lives = 2;
  const b = newPlayer('b', 'b', 1); b.lives = 0; b.outAt = 65_000;
  const coop: CoopResult = { win: true, stars: 2, timeMs: 120_000, bossHpPct: 0, phase: 3, cards: ['power', 'heal'] };
  const rec = gameRecord({ rules: { ...DEFAULT_RULES, coop: true, coopLevel: 'hard' }, solo: false, timeAttack: false, roundMs: 180_000, ranking: [a, b], coop, startAt: 5_000 });
  assert.equal(rec.coop, true);
  assert.deepEqual((rec as { coopResult?: unknown }).coopResult, { level: 'hard', result: 'win', phase: 3, bossHpPct: 0, timeMs: 120_000, cards: ['power', 'heal'] });
  assert.deepEqual(rec.players.map((p) => [(p as { lives?: number }).lives, (p as { outAt?: number }).outAt]), [[2, 0], [0, 60_000]]);
});
