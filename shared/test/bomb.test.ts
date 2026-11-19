import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { Bot } from '../../server/src/bot.ts';
import {
  DEFAULT_RULES, newPlayer, resolveClaim, FIELD, PRESETS, RULES, SRC_KEYS, TUTORIAL_RULES, inCross, makeCircle, sanitizeRules, toGameRules,
  type Circle, type ClaimResult, type PlayerState, type Zone,
} from '../src/index.ts';

const CX = FIELD.w / 2, CY = FIELD.h / 2;
const G = toGameRules(DEFAULT_RULES);

/** 소켓 없이 방을 돌리기 위한 가짜 io (이벤트 이름과 내용 기록) */
const events: { ev: string; data: any }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, data?: unknown) { events.push({ ev, data }); } }), sockets: { sockets: new Map() } }) as never;
const count = (ev: string) => events.filter((e) => e.ev === ev).length;
const claimedBy = (id: number) => events.find((e) => e.ev === 'circle:claimed' && e.data.circleId === id)?.data as { by: string; result: ClaimResult } | undefined;

type Internals = {
  startAt: number; circles: Map<number, Circle>; zones: Zone[]; pausedAt: number;
  pendingBlasts: { by: string; circleId: number; at: number }[];
  tick(): void; endRound(): void; finishResume(): void; freezeUntil: number;
  autoClaim(p: PlayerState, from: { x: number; y: number }, radius: number, n: number, now: number): void;
  fireItem(p: PlayerState, tier: 0 | 1 | 2, x: number, y: number, now: number, circleId: number | null): void;
  chargeTreasure(...a: unknown[]): void;
};

/** 시각을 now로 고정한 2인 방 (두 사람 모두 사람) */
function playing(t: TestContext) {
  events.length = 0;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const room = new Room(fakeIo(), 'BOMB', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  for (const p of room.players) if (p.id !== a.id) room.setReady(p.id, true);
  assert.equal(room.start(a.id), null);
  const r = room as unknown as Internals;
  // tick의 기록 샘플이 따라잡을 거리가 짧게 (시작 1초 뒤)
  r.startAt = now - 1000;
  r.circles.clear();
  const me = room.players.find((p) => p.id === a.id)!;
  const other = room.players.find((p) => p.id !== a.id)!;
  events.length = 0;
  return { room, r, me, other, now: () => now, advance: (ms: number) => { now += ms; } };
}

/** now에 (x, y)에 있는 원 (중심에서 ageMs 동안 천천히 온 원) */
const at = (id: number, kind: Circle['kind'], x: number, y: number, now: number, extra: Partial<Circle> = {}, ageMs = 100_000): Circle => {
  const d = Math.hypot(x - CX, y - CY);
  return { id, kind, angle: Math.atan2(y - CY, x - CX), speed: d / (ageMs / 1000), r: kind === 'bomb' ? RULES.specialCircles.bomb.r : 40, born: now - ageMs, ...extra };
};

test('inCross: 줄 위·줄 밖·판 끝', () => {
  const c = { x: 550, y: 550 };
  assert.equal(inCross(c, { x: 550, y: 1080 }, 40), true);
  assert.equal(inCross(c, { x: 20, y: 550 }, 40), true);
  assert.equal(inCross(c, { x: 650, y: 650 }, 40), false);
  assert.equal(inCross(c, { x: 550 + 40 + 30, y: 900 }, 40), true);
  assert.equal(inCross(c, { x: 550 + 40 + 31, y: 900 }, 40), false);
});

test('폭탄 원: 직접 누르면 십자 위 원을 가져가고, 보호 구역 안 원은 남는다', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, me.color, CX + 60, CY, now())); // 가로줄 위지만 보호 구역 안
  r.circles.set(3, at(3, me.color, CX + 300, CY + 300, now())); // 세로줄 위
  r.circles.set(4, at(4, me.color, CX - 300, CY + 300, now())); // 줄 밖
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(count('bomb:blast'), 1);
  assert.deepEqual([...r.circles.keys()].sort(), [2, 4]);
  assert.equal(claimedBy(3)?.result.via, 'cross');
});

test('폭탄 원: 보호 구역 안의 폭탄은 눌러도 터지지 않는다', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 50, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 50, y: CY });
  assert.equal(count('bomb:blast'), 0);
  assert.ok(r.circles.has(1));
});

test('연쇄: 십자에 걸린 폭탄은 150ms 뒤 그 자리에서 터지고 점수는 처음 터뜨린 사람이 받는다', (t) => {
  const { room, r, me, other, now, advance } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, 'bomb', CX + 300, CY + 300, now()));
  r.circles.set(3, at(3, other.color, CX - 200, CY + 300, now())); // B의 가로줄에만 걸림
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.deepEqual(r.pendingBlasts.map((b) => [b.circleId, b.by, b.at - now()]), [[2, me.id, RULES.specialCircles.bomb.chainDelayMs]]);
  assert.ok(r.circles.has(3));
  advance(RULES.specialCircles.bomb.chainDelayMs - 1);
  r.tick();
  assert.ok(r.circles.has(2));
  advance(1);
  r.tick();
  assert.equal(count('bomb:blast'), 2);
  assert.equal(events.filter((e) => e.ev === 'bomb:blast')[1].data.chain, true);
  assert.equal(claimedBy(3)?.by, me.id);
  // 남의 색이어도 견제 페널티 없음
  assert.equal(other.score, 0);
  assert.equal(me.stats.steals, 0);
});

test('연쇄: 서로 걸린 두 폭탄과 겹친 클릭에도 폭탄마다 한 번만 터진다', (t) => {
  const { room, r, me, now, advance } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, 'bomb', CX + 300, CY + 300, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  advance(RULES.specialCircles.bomb.chainDelayMs);
  r.tick();
  advance(RULES.specialCircles.bomb.chainDelayMs);
  r.tick();
  assert.equal(count('bomb:blast'), 2);
  assert.equal(r.pendingBlasts.length, 0);
});

test('연쇄 예약: 일시정지·시간 정지만큼 밀리고, 라운드가 끝나면 비운다', (t) => {
  const { room, r, me, now, advance } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, 'bomb', CX + 300, CY + 300, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  const at0 = r.pendingBlasts[0].at;
  r.pausedAt = now();
  advance(500);
  r.finishResume();
  assert.equal(r.pendingBlasts[0].at, at0 + 500);
  // 전설 아이템 [시간 정지, 필드 클리어, 1등 저격] 중 시간 정지
  t.mock.method(Math, 'random', () => 0);
  r.fireItem(me, 2, CX - 300, CY - 300, now(), null);
  assert.equal(r.pendingBlasts[0].at, at0 + 500 + RULES.items.freezeMs);
  r.endRound();
  assert.equal(r.pendingBlasts.length, 0);
});

test('보스: 십자 타격으로 막타를 치면 터뜨린 사람의 처치', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(9, at(9, 'boss', CX + 300, CY + 300, now(), { r: 80, hp: 1, maxHp: 10 }));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  const kill = events.find((e) => e.ev === 'boss:killed');
  assert.equal(kill?.data.by, me.id);
  assert.ok(!r.circles.has(9));
  assert.ok(me.stats.src.boss > 0);
});

test('보스: 붉은 공격형·보호막 상태면 십자가 지나간다 (피해·감점 없음)', (t) => {
  const { room, r, me, now } = playing(t);
  const B = RULES.boss;
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(8, at(8, 'boss', CX + 300, CY + 300, now(), { r: 80, hp: 5, maxHp: 10, boss: 'rage' }, B.rageCycleMs - 1));
  r.circles.set(9, at(9, 'boss', CX - 300, CY, now(), { r: 80, hp: 5, maxHp: 10, boss: 'guard' }, B.guardCycleMs - 1));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(r.circles.get(8)?.hp, 5);
  assert.equal(r.circles.get(9)?.hp, 5);
  assert.equal(me.score, 0);
  assert.equal(count('boss:hit'), 0);
});

test('십자에 걸린 원: 원마다 잭팟, 내 색은 콤보, 보물 상자 충전', (t) => {
  const { room, r, me, other, now } = playing(t);
  me.picks = [{ id: 'jackpot', tier: 3 }];
  const charge = t.mock.method(r, 'chargeTreasure');
  t.mock.method(Math, 'random', () => 0);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, other.color, CX + 300, CY + 300, now()));
  r.circles.set(3, at(3, me.color, CX - 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  // 남의 색은 폭죽처럼 +1점(콤보 없음), 내 색은 콤보
  assert.equal(claimedBy(2)!.result.type, 'feverSteal');
  assert.equal(me.combo, 1);
  assert.ok(claimedBy(2)!.result.jackpot > 1);
  assert.ok(claimedBy(3)!.result.jackpot > 1);
  assert.ok(charge.mock.callCount() >= 2);
  assert.equal(other.score, 0);
});

test('십자에 걸린 원으로 피버가 터지면 점화가 발동한다', (t) => {
  const { room, r, me, now } = playing(t);
  me.picks = [{ id: 'ignite', tier: 0 }];
  me.fever = 99.9;
  const auto = t.mock.method(r, 'autoClaim');
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, me.color, CX - 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(claimedBy(2)?.result.feverStarted, true);
  assert.equal(auto.mock.callCount(), 1);
});

test('터지는 경로: 넓은 손·장판·필드 클리어로는 터지고 헛손질 보정으로는 안 터진다', (t) => {
  const { room, r, me, now } = playing(t);
  // 헛손질 보정: 빈 곳 근처의 폭탄을 대신 잡지 않는다
  me.picks = [{ id: 'missSave', tier: 3 }];
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  room.click(me.id, { circleId: null, x: CX + 300 + 50, y: CY });
  assert.equal(count('bomb:blast'), 0);
  // 넓은 손
  me.picks = [{ id: 'wideHand', tier: 3 }];
  const misses = me.stats.misses;
  room.click(me.id, { circleId: null, x: CX + 300 + 50, y: CY });
  assert.equal(count('bomb:blast'), 1);
  assert.equal(me.stats.misses, misses);
  // 장판
  r.circles.set(2, at(2, 'bomb', CX - 300, CY - 300, now()));
  r.zones.push({ id: 1, by: me.id, x: CX - 300, y: CY - 300, r: RULES.items.zoneR, until: now() + 1000 });
  r.tick();
  assert.equal(count('bomb:blast'), 2);
  // 필드 클리어: 휘말린 폭탄은 연쇄로 예약
  r.zones.length = 0;
  r.circles.set(3, at(3, 'bomb', CX - 300, CY + 300, now()));
  t.mock.method(Math, 'random', () => 0.5);
  r.fireItem(me, 2, CX, CY, now(), null);
  assert.deepEqual(r.pendingBlasts.map((b) => b.circleId), [3]);
});

test('생성: 방 규칙 꺼짐·협력전·튜토리얼·하드코어에서는 폭탄 원이 없다', () => {
  const kinds = (specialChance: number, extra = {}) => Array.from({ length: 2000 }, (_, i) => makeCircle(i, 0, 0, [0, 1], G, Math.random, { specialChance, ...extra }).kind);
  assert.ok(!kinds(0).includes('bomb'));
  // 특수 원 확률 1, 종류 굴림 0 → 첫 종류(폭탄)
  const all = Array.from({ length: 50 }, (_, i) => makeCircle(i, 0, 0, [0, 1], G, () => 0, { specialChance: 1 }));
  assert.ok(all.every((c) => c.kind === 'bomb' && c.r === RULES.specialCircles.bomb.r));
  assert.equal(makeCircle(1, 0, 0, [0, 1], G, Math.random, { specialChance: 1, forceKind: 'y' }).kind, 'y');
  assert.equal(makeCircle(1, 0, 0, [0, 1], G, () => 0, { specialChance: 1, itemChance: 1 }).kind, 'item');
  assert.equal(DEFAULT_RULES.specialCircles, true);
  assert.equal(toGameRules(DEFAULT_RULES).specialCircles, true);
  assert.equal(toGameRules({ ...DEFAULT_RULES, coop: true }).specialCircles, false);
  assert.equal(PRESETS.hardcore.rules.specialCircles, false);
  assert.equal(TUTORIAL_RULES.specialCircles, false);
  assert.equal(sanitizeRules(DEFAULT_RULES, { specialCircles: false }).specialCircles, false);
});

test('점수 출처: 십자로 얻은 점수는 폭탄 출처, 출처 합 = 총점', (t) => {
  const { room, r, me, other, now } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  for (let i = 0; i < 4; i++) r.circles.set(10 + i, at(10 + i, i % 2 ? me.color : other.color, CX + 300, CY + 150 + i * 60, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  const src = me.stats.src;
  assert.ok(src.bomb > 0);
  assert.equal(src.circle + src.combo, 0);
  assert.equal(SRC_KEYS.reduce((a, k) => a + src[k], 0) - src.lost, me.score);
});

test('폭죽·필드 클리어로 잡은 원도 잭팟을 굴린다', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  a.picks = [{ id: 'jackpot', tier: 3 }];
  const res = resolveClaim(a, 0, [a, b], 0, G, { via: 'blast', fromItem: true, rand: () => 0 });
  assert.ok(res.jackpot > 1);
});

test('봇이 폭탄 원을 고르면 견제가 아니라 십자로 터진다', (t) => {
  events.length = 0;
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const room = new Room(fakeIo(), 'BOT', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.addBot(a.id);
  assert.equal(room.start(a.id), null);
  const r = room as unknown as Internals;
  r.startAt = now - 1000;
  r.circles.clear();
  events.length = 0;
  const bot = room.players.find((p) => p.bot)!;
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now));
  r.circles.set(2, at(2, bot.color, CX + 300, CY + 300, now));
  t.mock.method(Bot.prototype, 'think', () => r.circles.get(1) ?? null);
  r.tick();
  assert.equal(count('bomb:blast'), 1);
  assert.equal(bot.stats.steals, 0);
  assert.equal(claimedBy(2)?.by, bot.id);
});

test('시간 정지 중에 새로 걸린 연쇄는 정지가 끝난 뒤 터진다', (t) => {
  const { room, r, me, now, advance } = playing(t);
  t.mock.method(Math, 'random', () => 0); // 전설 중 시간 정지
  r.fireItem(me, 2, CX - 300, CY - 300, now(), null);
  assert.equal(r.freezeUntil, now() + RULES.items.freezeMs);
  r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
  r.circles.set(2, at(2, 'bomb', CX + 300, CY + 300, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(r.pendingBlasts[0].at, now() + RULES.items.freezeMs + RULES.specialCircles.bomb.chainDelayMs);
  advance(RULES.specialCircles.bomb.chainDelayMs);
  r.tick();
  assert.ok(r.circles.has(2));
});

test('잭팟은 아이템 폭죽·필드 클리어와 십자만: 점화·사냥꾼 자동 획득은 굴리지 않는다', (t) => {
  const { r, me, now } = playing(t);
  me.picks = [{ id: 'jackpot', tier: 3 }];
  t.mock.method(Math, 'random', () => 0);
  r.circles.set(2, at(2, me.color, CX - 300, CY, now()));
  r.autoClaim(me, { x: CX, y: CY }, Infinity, Infinity, now());
  assert.equal(claimedBy(2)?.result.jackpot, 1);
});

test('보호 구역 안 폭탄을 누르면 거절을 받는다 (다시 누를 수 있게)', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, at(1, 'bomb', CX + 50, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 50, y: CY });
  assert.equal(count('bomb:blast'), 0);
  assert.ok(events.some((e) => e.ev === 'circle:rejected' || e.ev === 'click:rejected'));
});

/** 가운데로 들어오는 폭탄: 지금은 보호 구역 안(CX+80), 100ms 전에는 밖(CX+130) */
const incoming = (now: number): Circle => ({ id: 1, kind: 'bomb', from: { x: CX + 150, y: CY }, angle: Math.PI, speed: 500, r: RULES.specialCircles.bomb.r, born: now - 140 });

test('막 보호 구역에 들어간 폭탄을 지연 보정으로 누르면 터지지 않고 거절을 보낸다', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, incoming(now()));
  room.click(me.id, { circleId: 1, x: CX + 130, y: CY });
  assert.equal(count('bomb:blast'), 0);
  assert.ok(r.circles.has(1));
  assert.ok(events.some((e) => e.ev === 'click:rejected' && e.data.circleId === 1));
});

test('넓은 손 범위에 터지지 않은 폭탄만 있으면 빈 곳 클릭이다', (t) => {
  const { room, r, me, now } = playing(t);
  me.picks = [{ id: 'wideHand', tier: 3 }];
  r.circles.set(1, incoming(now()));
  const misses = me.stats.misses;
  room.click(me.id, { circleId: null, x: CX + 130, y: CY + 60 });
  assert.equal(count('bomb:blast'), 0);
  assert.equal(me.stats.misses, misses + 1);
});
