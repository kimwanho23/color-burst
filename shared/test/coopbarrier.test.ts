import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, type CoopFx, type CoopHitBy, type CoopItemId, type PlayerState } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { pointerAction } from '../../client/src/pointer.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop, B = RULES.coop.barrier;

type Run = {
  shift(delta: number): void;
  damage(p: PlayerState, by: CoopHitBy, now: number): boolean;
  applyItem(p: PlayerState, item: CoopItemId, now: number, at: { x: number; y: number }): void;
  activateBarrier(p: PlayerState, now: number): boolean;
};
type CRoom = { coop: Run; startAt: number; coopBarrier(id: string): void };
type Level = 'easy' | 'normal' | 'hard' | 'expert';

function coopRoom(level: Level = 'normal', bots = 0) {
  const room = new Room(fakeIo(), 'BARR', () => {});
  const id = (room.join('s0', 'k0', 'P0') as { id: string }).id;
  room.setRules(id, { rules: { coop: true, coopLevel: level } });
  for (let i = 0; i < bots; i++) room.addBot(id);
  sent.length = 0;
  assert.equal(room.start(id), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === id)!;
  return { room, r, me };
}
const fx = (p: PlayerState) => p.coopFx as CoopFx;
const AT = { x: 500, y: 700 };

test('수치: RULES.coop.barrier', () => {
  assert.equal(B.durationMs, 1500);
  assert.deepEqual(B.uses, { easy: 3, normal: 2, hard: 1, expert: 0 });
});

test('판 시작 횟수: 난이도별로 채우고 봇은 없음', () => {
  for (const level of ['easy', 'normal', 'hard', 'expert'] as const) {
    const { room, me } = coopRoom(level);
    assert.equal(fx(me).barrierLeft, B.uses[level], level);
    assert.equal(fx(me).barrierUntil, 0);
    room.destroy();
  }
  const { room } = coopRoom('normal', 1);
  const bot = room.players.find((p) => p.bot)!;
  assert.equal(bot.coopFx, undefined);
  room.destroy();
});

test('발동: 횟수 1 줄고 1.5초 켜짐, 켜진 중 다시 누르면 무시', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.activateBarrier(me, now), true);
  assert.equal(fx(me).barrierLeft, 1);
  assert.equal(fx(me).barrierUntil, now + 1500);
  assert.equal(r.coop.activateBarrier(me, now + 100), false);
  assert.equal(fx(me).barrierLeft, 1);
  assert.equal(fx(me).barrierUntil, now + 1500);
  // 끝난 뒤에는 다시 쓸 수 있고, 0회면 거부
  assert.equal(r.coop.activateBarrier(me, now + 1500), true);
  assert.equal(fx(me).barrierLeft, 0);
  assert.equal(r.coop.activateBarrier(me, now + 4000), false);
  assert.equal(fx(me).barrierLeft, 0);
  room.destroy();
});

test('거부: 기절·탈락·엑스퍼트', () => {
  const a = coopRoom();
  const now = a.r.startAt + 5000;
  a.me.stunUntil = now + 1000;
  assert.equal(a.r.coop.activateBarrier(a.me, now), false, '기절');
  a.me.stunUntil = 0; a.me.outAt = now; a.me.hp = 0;
  assert.equal(a.r.coop.activateBarrier(a.me, now), false, '탈락');
  assert.equal(fx(a.me).barrierLeft, 2);
  a.room.destroy();
  const b = coopRoom('expert');
  assert.equal(b.r.coop.activateBarrier(b.me, b.r.startAt + 5000), false, '엑스퍼트 0회');
  b.room.destroy();
});

test('막기: 피하는 공격은 피해·무적 없이 막고 보호막으로 막았다고 알림', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  for (const by of ['bullet', 'wall', 'laser', 'beam', 'slam', 'seal', 'safe', 'homing'] as const) {
    sent.length = 0;
    assert.equal(r.coop.damage(me, by, now + 500), true, by);
    assert.equal(me.hp, C.hpMax, by);
    assert.equal(me.immuneUntil, 0, by);
    assert.equal(me.stunUntil, 0, by);
    assert.deepEqual(sent.find((s) => s.ev === 'coop:hit')?.d, { playerId: me.id, by, hp: C.hpMax, dmg: 0, immuneUntil: 0, blocked: true, barrier: true });
  }
  room.destroy();
});

test('관통: 압살·분노·큰 구체 놓침은 보호막을 뚫는다', () => {
  for (const by of ['crush', 'rage', 'threat'] as const) {
    const { room, r, me } = coopRoom();
    const now = r.startAt + 5000;
    r.coop.activateBarrier(me, now);
    assert.equal(r.coop.damage(me, by, now + 500), true, by);
    assert.equal(me.hp, Math.max(0, C.hpMax - C.levels.normal.hurt[by]), by);
    room.destroy();
  }
});

test('아이템 방어막은 보호막이 켜진 동안 소모되지 않는다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.applyItem(me, 'guard', now, AT);
  r.coop.activateBarrier(me, now);
  assert.equal(r.coop.damage(me, 'bullet', now + 500), true);
  assert.equal(fx(me).guardUntil, now + C.items.guardMs);
  // 보호막이 끝난 뒤에는 방어막이 막고 사라진다
  assert.equal(r.coop.damage(me, 'bullet', now + 1500), true);
  assert.equal(me.hp, C.hpMax);
  assert.equal(fx(me).guardUntil, 0);
  room.destroy();
});

test('종료: 1.5초 뒤에는 피해를 받는다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  assert.equal(r.coop.damage(me, 'bullet', now + 1500), true);
  assert.equal(me.hp, C.hpMax - C.levels.normal.hurt.bullet);
  room.destroy();
});

test('일시정지: 종료 시각을 밀고 플레이어 상태를 다시 보낸다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  sent.length = 0;
  r.coop.shift(5000);
  assert.equal(fx(me).barrierUntil, now + 1500 + 5000);
  assert.ok(sent.some((s) => s.ev === 'players'), 'players 전송');
  room.destroy();
});

test('방 조건: 시작 카운트다운 중 요청은 무시', () => {
  const { room, r, me } = coopRoom();
  assert.ok(Date.now() < r.startAt, '카운트다운 중');
  r.coopBarrier(me.id);
  assert.equal(fx(me).barrierLeft, 2);
  room.destroy();
});

test('우클릭은 클릭 판정이 아니다', () => {
  assert.equal(pointerAction('mouse', 0), 'click');
  assert.equal(pointerAction('mouse', 2), 'barrier');
  assert.equal(pointerAction('mouse', 1), 'ignore');
  assert.equal(pointerAction('touch', 0), 'click');
  assert.equal(pointerAction('pen', 0), 'click');
});
