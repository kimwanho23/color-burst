import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { Bot } from '../../server/src/bot.ts';
import {
  DEFAULT_RULES, FIELD, RULES, SRC_KEYS, hazardStun, makeCircle, makeWave, newPlayer, toGameRules,
  type Circle, type ClaimResult, type PlayerState,
} from '../src/index.ts';

const CX = FIELD.w / 2, CY = FIELD.h / 2;
const G = toGameRules(DEFAULT_RULES);
const I = RULES.specialCircles.ice, S = RULES.specialCircles.split;

/** 소켓 없이 방을 돌리기 위한 가짜 io (이벤트 이름과 내용 기록) */
const events: { ev: string; data: any }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, data?: unknown) { events.push({ ev, data }); } }), sockets: { sockets: new Map() } }) as never;
const count = (ev: string) => events.filter((e) => e.ev === ev).length;
const of = (ev: string) => events.filter((e) => e.ev === ev).map((e) => e.data);
const claimedBy = (id: number) => events.find((e) => e.ev === 'circle:claimed' && e.data.circleId === id)?.data as { by: string; result: ClaimResult } | undefined;

type Internals = {
  startAt: number; circles: Map<number, Circle>; pausedAt: number; freezeUntil: number;
  rules: { team: boolean };
  tick(): void; endRound(): void; finishResume(): void;
  fireItem(p: PlayerState, tier: 0 | 1 | 2, x: number, y: number, now: number, circleId: number | null): void;
};

/** 시각을 now로 고정한 2인 방 (두 사람 모두 사람) */
function playing(t: TestContext) {
  events.length = 0;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const room = new Room(fakeIo(), 'ICE', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  for (const p of room.players) if (p.id !== a.id) room.setReady(p.id, true);
  assert.equal(room.start(a.id), null);
  const r = room as unknown as Internals;
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
  const r = kind === 'ice' ? I.r : kind === 'split' ? S.r : kind === 'bomb' ? RULES.specialCircles.bomb.r : 40;
  return { id, kind, angle: Math.atan2(y - CY, x - CX), speed: d / (ageMs / 1000), r, born: now - ageMs, ...extra };
};
/** 내 파편: (x, y)에 멈춰 있는 듯 아주 느린 주인 색 원 */
const piece = (id: number, owner: PlayerState, x: number, y: number, now: number) => at(id, owner.color, x, y, now, { r: S.pieceR, splitBy: owner.id });

test('생성: 특수 원 확률과 종류 비율', () => {
  const n = 30_000;
  const got = { bomb: 0, ice: 0, split: 0 } as Record<string, number>;
  for (let i = 0; i < n; i++) {
    const c = makeCircle(i, 0, 0, [0, 1], G, Math.random, { specialChance: 1 });
    got[c.kind as string]++;
    assert.equal(c.r, 36);
  }
  for (const k of ['bomb', 'ice', 'split']) assert.ok(Math.abs(got[k] / n - 1 / 3) < 0.03, `${k} ${got[k]}`);
});

test('생성: 방 규칙 꺼짐·협력전·웨이브에서는 특수 원이 없다', () => {
  const special = (c: Circle) => c.kind === 'bomb' || c.kind === 'ice' || c.kind === 'split';
  assert.equal(Array.from({ length: 10_000 }, (_, i) => makeCircle(i, 0, 0, [0, 1], G, Math.random, { specialChance: 0 })).filter(special).length, 0);
  for (let i = 0; i < 200; i++) assert.equal(makeWave('burst', i * 20, 0, 0, [0, 1], G, Math.random, { specialChance: 1 }).filter(special).length, 0);
  assert.equal(toGameRules({ ...DEFAULT_RULES, coop: true }).specialCircles, false);
});

test('얼음: 터뜨린 사람 빼고 1초 느려진 뒤 1초 기절', (t) => {
  const { room, r, me, other, now, advance } = playing(t);
  r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(count('ice:burst'), 1);
  assert.deepEqual(of('ice:burst')[0].targets, [other.id]);
  assert.ok((other.debuffs.frost ?? 0) > now());
  assert.equal(other.frostAt, now() + I.slowMs);
  assert.equal(me.frostAt, 0);
  assert.equal(me.debuffs.frost, undefined);
  advance(I.slowMs - 1);
  r.tick();
  assert.equal(other.stunUntil, 0);
  advance(1);
  r.tick();
  assert.equal(other.stunUntil, now() + I.stunMs);
  assert.equal(other.frostAt, 0);
  assert.deepEqual(of('stun').map((s) => [s.playerId, s.by]), [[other.id, 'ice']]);
  assert.equal(me.stunUntil, 0);
});

test('얼음: 팀원·철벽·위험 스턴 무적 시간이면 걸리지 않는다', (t) => {
  {
    const { room, r, me, other, now } = playing(t);
    r.rules.team = true; me.team = 0; other.team = 0;
    r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
    room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
    assert.equal(other.frostAt, 0);
  }
  {
    const { room, r, me, other, now } = playing(t);
    other.picks = [{ id: 'fortress', tier: 3 }];
    r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
    room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
    assert.equal(other.frostAt, 0);
  }
  {
    const { room, r, me, other, now } = playing(t);
    other.hazardUntil = now() + 500;
    r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
    room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
    assert.equal(other.frostAt, 0);
  }
});

test('얼음: 얼어 가는 중 라운드가 끝나면 얼지 않는다', (t) => {
  const { room, r, me, other, now, advance } = playing(t);
  r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  r.endRound();
  assert.equal(other.frostAt, 0);
  assert.equal(other.debuffs.frost, undefined);
  advance(I.slowMs);
  r.tick();
  assert.equal(count('stun'), 0);
});

test('얼음: 일시정지·시간 정지만큼 얼어붙는 시각이 밀린다', (t) => {
  const { room, r, me, other, now, advance } = playing(t);
  r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  const at0 = other.frostAt;
  r.pausedAt = now();
  advance(500);
  r.finishResume();
  assert.equal(other.frostAt, at0 + 500);
  t.mock.method(Math, 'random', () => 0); // 전설 중 시간 정지
  r.fireItem(me, 2, CX - 300, CY - 300, now(), null);
  assert.equal(other.frostAt, at0 + 500 + RULES.items.freezeMs);
  // 정지 중에는 얼어붙지 않는다
  advance(I.slowMs);
  r.tick();
  assert.equal(other.stunUntil, 0);
});

test('기절 공통: 레이저 기절은 콤보를 끊고, 얼음·분열(soft)은 콤보·피버를 둔다', () => {
  const A = toGameRules({ ...DEFAULT_RULES, mode: 'arcade' });
  const mk = () => { const p = newPlayer('a', 'A', 0); p.combo = 7; p.fever = 50; p.feverUntil = 5_000; return p; };
  const hard = mk();
  hazardStun(hard, 1_000, 1_000, A, [hard]);
  assert.equal(hard.combo, 0);
  const soft = mk();
  assert.ok(hazardStun(soft, 1_000, 1_000, A, [soft], { soft: true }) > 0);
  assert.equal(soft.combo, 7);
  assert.equal(soft.feverUntil, 5_000);
  assert.equal(soft.stunUntil, 2_000);
});

test('기절한 봇은 클릭하지 않는다', (t) => {
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
  bot.stunUntil = now + 5_000;
  r.circles.set(2, at(2, bot.color, CX + 300, CY + 300, now));
  t.mock.method(Bot.prototype, 'think', () => r.circles.get(2) ?? null);
  r.tick();
  assert.equal(claimedBy(2), undefined);
  assert.ok(r.circles.has(2));
});

test('분열: 터뜨린 사람 색 파편이 생기고, 주인은 닿아도 무사하다', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(1, at(1, 'split', CX + 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(count('split:burst'), 1);
  const pieces = of('circle:spawn') as Circle[];
  assert.equal(pieces.length, S.count);
  for (const c of pieces) {
    assert.equal(c.kind, me.color);
    assert.equal(c.splitBy, me.id);
    assert.equal(c.r, S.pieceR);
  }
  room.cursor(me.id, { x: CX + 300, y: CY });
  r.tick();
  assert.equal(count('split:hit'), 0);
  assert.equal(me.stunUntil, 0);
});

test('분열: 팀원은 파편을 평소처럼 잡고 점수 출처는 분열', (t) => {
  const { room, r, me, other, now } = playing(t);
  r.rules.team = true; me.team = 0; other.team = 0;
  r.circles.set(5, piece(5, me, CX + 300, CY + 200, now()));
  room.click(other.id, { circleId: 5, x: CX + 300, y: CY + 200 });
  assert.equal(claimedBy(5)?.by, other.id);
  assert.ok(other.stats.src.split > 0);
  assert.equal(other.stunUntil, 0);
});

test('분열: 남은 닿거나 누르면 기절하고 파편은 사라지며, 무적 시간에는 연달아 기절하지 않는다', (t) => {
  const { room, r, me, other, now } = playing(t);
  r.circles.set(5, piece(5, me, CX + 300, CY + 200, now()));
  r.circles.set(6, piece(6, me, CX - 300, CY + 200, now()));
  r.circles.set(7, piece(7, me, CX - 300, CY - 200, now()));
  room.cursor(other.id, { x: CX + 300, y: CY + 200 });
  r.tick();
  assert.deepEqual(of('split:hit'), [{ circleId: 5, playerId: other.id }]);
  assert.ok(!r.circles.has(5));
  const until = other.stunUntil;
  assert.equal(until, now() + S.stunMs);
  assert.deepEqual(of('stun').map((s) => s.by), ['split']);
  // 바로 다음 파편: 사라지지만 기절은 그대로
  room.cursor(other.id, { x: CX - 300, y: CY + 200 });
  r.tick();
  assert.ok(!r.circles.has(6));
  assert.equal(other.stunUntil, until);
  // 누르기: 견제가 아니라 피격 (주인 점수·견제 통계 변화 없음)
  const score = me.score;
  other.stunUntil = 0; other.hazardUntil = 0;
  room.click(other.id, { circleId: 7, x: CX - 300, y: CY - 200 });
  assert.ok(!r.circles.has(7));
  assert.equal(me.score, score);
  assert.equal(other.stats.steals, 0);
  assert.equal(of('split:hit').at(-1).circleId, 7);
});

test('분열: 보호 구역 안 파편과 시간 정지 중에는 피격이 없다', (t) => {
  const { room, r, me, other, now } = playing(t);
  r.circles.set(5, piece(5, me, CX + 50, CY, now()));
  room.cursor(other.id, { x: CX + 50, y: CY });
  r.tick();
  assert.equal(count('split:hit'), 0);
  r.circles.set(6, piece(6, me, CX + 300, CY + 200, now()));
  r.freezeUntil = now() + 1_000;
  room.cursor(other.id, { x: CX + 300, y: CY + 200 });
  r.tick();
  assert.equal(count('split:hit'), 0);
  assert.equal(other.stunUntil, 0);
});

test('터지는 경우: 넓은 손·폭탄 십자로 터지고, 십자는 폭탄 터뜨린 사람 기준. 자석으로는 안 터진다', (t) => {
  {
    const { room, r, me, now } = playing(t);
    me.picks = [{ id: 'wideHand', tier: 3 }];
    r.circles.set(1, at(1, 'split', CX + 300, CY, now()));
    room.click(me.id, { circleId: null, x: CX + 300, y: CY + 50 });
    assert.equal(count('split:burst'), 1);
  }
  {
    const { room, r, me, other, now } = playing(t);
    r.circles.set(1, at(1, 'bomb', CX + 300, CY, now()));
    r.circles.set(2, at(2, 'ice', CX + 300, CY + 300, now()));
    r.circles.set(3, at(3, 'split', CX - 300, CY, now()));
    room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
    assert.equal(of('ice:burst')[0].by, me.id);
    assert.deepEqual(of('ice:burst')[0].targets, [other.id]);
    assert.ok((of('circle:spawn') as Circle[]).every((c) => c.kind === me.color));
  }
  {
    const { room, r, me, now } = playing(t);
    me.picks = [{ id: 'magnet', tier: 3 }];
    r.circles.set(1, at(1, 'ice', CX + 300, CY, now()));
    room.cursor(me.id, { x: CX + 310, y: CY });
    r.tick();
    assert.equal(count('ice:burst'), 0);
    assert.ok(r.circles.has(1));
  }
});

test('같은 틱 직접 클릭과 넓은 손에도 한 번만 터진다', (t) => {
  const { room, r, me, now } = playing(t);
  me.picks = [{ id: 'wideHand', tier: 3 }];
  r.circles.set(1, at(1, 'split', CX + 300, CY, now()));
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  room.click(me.id, { circleId: 1, x: CX + 300, y: CY });
  assert.equal(count('split:burst'), 1);
  assert.equal(count('circle:spawn'), S.count);
});

test('점수 출처: 내 파편으로 얻은 점수는 분열, 출처 합 = 총점', (t) => {
  const { room, r, me, now } = playing(t);
  r.circles.set(5, piece(5, me, CX + 300, CY + 200, now()));
  r.circles.set(6, piece(6, me, CX - 300, CY + 200, now()));
  room.click(me.id, { circleId: 5, x: CX + 300, y: CY + 200 });
  room.click(me.id, { circleId: 6, x: CX - 300, y: CY + 200 });
  const src = me.stats.src;
  assert.ok(src.split > 0);
  assert.equal(src.circle, 0);
  assert.ok(SRC_KEYS.includes('split'));
  assert.equal(SRC_KEYS.reduce((a, k) => a + src[k], 0) - src.lost, me.score);
});
