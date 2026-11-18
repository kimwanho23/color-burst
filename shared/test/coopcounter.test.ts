import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, barrierCovers, counterValue, fillCounter, makeOrb, newCoopFx, newCounter, type Circle, type CoopCounter, type CoopFx, type CoopItemId, type CoopState, type PlayerState } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const K = RULES.coop.counter, B = RULES.coop.barrier;

type Run = {
  counter: CoopCounter | null;
  burstUntil: number;
  shield: unknown;
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number };
  hurtBoss(p: PlayerState, dmg: number, now: number, at: null): { dmg: number };
  tickCounter(now: number): void;
  beginShield(now: number): void;
  activateBarrier(p: PlayerState, now: number): boolean;
  applyItem(p: PlayerState, item: CoopItemId, now: number, at: { x: number; y: number }): void;
  shift(delta: number): void;
  dispose(): void;
  state(): CoopState;
  result(now: number, startAt: number, win: boolean): { players: Record<string, { counterLost: number; counterSaved: number }> };
};
type CRoom = { coop: Run; startAt: number };
type Level = 'easy' | 'normal' | 'hard' | 'expert';

function coopRoom(level: Level = 'normal', bots = 0) {
  const room = new Room(fakeIo(), 'CNTR', () => {});
  const id = (room.join('s0', 'k0', 'P0') as { id: string }).id;
  room.setRules(id, { rules: { coop: true, coopLevel: level } });
  for (let i = 0; i < bots; i++) room.addBot(id);
  sent.length = 0;
  assert.equal(room.start(id), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === id)!;
  return { room, r, me, run: r.coop };
}
let oid = 90_000;
/** 원 n개를 now에 잡는다 (콤보 배율을 받는 피해) */
function catchN(run: Run, p: PlayerState, n: number, now: number) {
  for (let i = 0; i < n; i++) run.catchOrb(p, makeOrb(oid++, now, { x: 500, y: 600 }, 0, p.color, 0), now);
}
/** 게이지를 가득 채워 예고를 시작한다: 발동 시각 */
function fire(run: Run, p: PlayerState, now: number) {
  p.combo = 40;
  catchN(run, p, 20, now);
  assert.equal(run.counter!.fireAt, now + K.warnMs);
  return now + K.warnMs;
}
const counterEv = () => sent.filter((s) => s.ev === 'coop:counter').map((s) => s.d as { lost: string[]; saved: string[] });

test('수치: RULES.coop.counter와 콤보 상한', () => {
  assert.equal(K.warnMs, 2000);
  assert.deepEqual(K.drain, { easy: 2.3, normal: 1.3, hard: 0.8, expert: 0.5 });
  assert.deepEqual(K.cap, { easy: 5, normal: 2.5, hard: 1.5, expert: 1 });
  assert.deepEqual(K.cooldownMs, { easy: 30_000, normal: 25_000, hard: 20_000, expert: 15_000 });
  assert.equal(RULES.coop.comboPer, 0.2);
  assert.equal(RULES.coop.comboCap, 0.8);
});

test('counterValue: 초당 drain만큼 줄고 0 아래로 내려가지 않음', () => {
  const g: CoopCounter = { value: 2.5, at: 1000, fireAt: 0, coolUntil: 0 };
  assert.ok(Math.abs(counterValue(g, 2000, 'normal') - 1.2) < 1e-9);
  assert.equal(counterValue(g, 11_000, 'normal'), 0);
  assert.equal(counterValue(g, 1000, 'normal'), 2.5);
});

test('fillCounter: 용량에서 멈추고 처음 닿을 때만 예고', () => {
  const g = newCounter(0);
  assert.equal(fillCounter(g, 1, 0, 'normal'), false);
  assert.equal(g.value, 1);
  assert.equal(fillCounter(g, 3, 1000, 'normal'), true);
  assert.equal(g.value, 2.5);
  assert.equal(g.fireAt, 1000 + 2000);
  assert.equal(fillCounter(g, 3, 1500, 'normal'), false);
  assert.equal(g.fireAt, 3000);
});

test('fillCounter: 재사용 대기 중에는 차지 않음', () => {
  const g: CoopCounter = { value: 0, at: 0, fireAt: 0, coolUntil: 5000 };
  assert.equal(fillCounter(g, 10, 4999, 'normal'), false);
  assert.equal(g.value, 0);
  assert.equal(fillCounter(g, 1, 5000, 'normal'), false);
  assert.equal(g.value, 1);
});

test('barrierCovers: 경계', () => {
  const at = 100_000;
  const fx = (start: number): CoopFx => ({ ...newCoopFx(), barrierUntil: start + B.durationMs });
  assert.equal(barrierCovers(fx(at - 1500), at), true, '끝 = 발동 시각 (lagMs 안)');
  assert.equal(barrierCovers(fx(at - 1650 - 1), at), false, '끝 + lagMs 전에 발동');
  assert.equal(barrierCovers(fx(at - 1650), at), false, '끝 + lagMs = 발동 시각');
  assert.equal(barrierCovers(fx(at + 150), at), true, '늦게 도착한 켜기 요청');
  assert.equal(barrierCovers(fx(at + 151), at), false);
  assert.equal(barrierCovers(undefined, at), false, 'fx 없음 (봇)');
  assert.equal(barrierCovers(newCoopFx(), at), false, '한 번도 안 켬');
});

test('서버: 원 피해만 게이지에 들어가고 콤보 배율 없는 피해(스페셜·미사일 경로)는 안 들어감', () => {
  const { room, r, me, run } = coopRoom();
  const now = r.startAt + 5000;
  run.hurtBoss(me, 20, now, null);
  assert.equal(run.counter!.value, 0, '콤보 배율 없는 피해');
  catchN(run, me, 1, now);
  const maxHp = run.state().maxHp;
  assert.ok(Math.abs(run.counter!.value - 100 / maxHp) < 1e-9, '원 피해 1 = 1/maxHp × 100%');
  room.destroy();
});

test('서버: 큰 피해 구간·보호막 단계에서는 차지 않음', () => {
  const { room, r, me, run } = coopRoom();
  const now = r.startAt + 5000;
  run.burstUntil = now + 5000;
  catchN(run, me, 3, now);
  assert.equal(run.counter!.value, 0, '큰 피해 구간');
  room.destroy();
  const b = coopRoom();
  b.run.beginShield(b.r.startAt + 5000);
  assert.ok(b.run.shield);
  catchN(b.run, b.me, 3, b.r.startAt + 5100);
  assert.equal(b.run.counter!.value, 0, '보호막 단계');
  b.room.destroy();
});

test('서버: 예고 2초 + lagMs 뒤 콤보 0, 보호막 켠 사람은 유지, 체력은 그대로, 봇도 초기화', () => {
  const { room, r, me, run } = coopRoom('normal', 1);
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  const at = fire(run, me, now);
  me.combo = 25; bot.combo = 12;
  sent.length = 0;
  run.tickCounter(at + B.lagMs - 1);
  assert.equal(counterEv().length, 0, 'lagMs 전에는 판정 안 함');
  run.tickCounter(at + B.lagMs);
  assert.deepEqual(counterEv(), [{ lost: [me.id, bot.id], saved: [] }]);
  assert.equal(me.combo, 0);
  assert.equal(bot.combo, 0);
  assert.equal(me.hp, RULES.coop.hpMax);
  assert.equal(run.result(at + 200, r.startAt, false).players[me.id]!.counterLost, 1);
  room.destroy();

  const b = coopRoom();
  const at2 = fire(b.run, b.me, b.r.startAt + 5000);
  b.me.combo = 25;
  assert.equal(b.run.activateBarrier(b.me, at2 - 500), true);
  sent.length = 0;
  b.run.tickCounter(at2 + B.lagMs);
  assert.deepEqual(counterEv(), [{ lost: [], saved: [b.me.id] }]);
  assert.equal(b.me.combo, 25);
  assert.equal(b.run.result(at2 + 200, b.r.startAt, false).players[b.me.id]!.counterSaved, 1);
  b.room.destroy();
});

test('서버: 아이템 방어막은 반격을 막지 않음', () => {
  const { room, r, me, run } = coopRoom();
  const at = fire(run, me, r.startAt + 5000);
  run.applyItem(me, 'guard', at - 500, { x: 500, y: 600 });
  me.combo = 20;
  run.tickCounter(at + B.lagMs);
  assert.equal(me.combo, 0);
  room.destroy();
});

test('서버: 발동 뒤 재사용 대기 동안 게이지 0 유지, 끝나면 다시 참', () => {
  const { room, r, me, run } = coopRoom();
  const at = fire(run, me, r.startAt + 5000);
  run.tickCounter(at + B.lagMs);
  assert.deepEqual(run.counter, { value: 0, at: at + B.lagMs, fireAt: 0, coolUntil: at + K.cooldownMs.normal });
  catchN(run, me, 3, at + 1000);
  assert.equal(run.counter!.value, 0);
  catchN(run, me, 1, at + K.cooldownMs.normal);
  assert.ok(run.counter!.value > 0);
  room.destroy();
});

test('서버: 예고 중 보호막 단계가 시작되면 취소하고 대기 없음, 판정 대기 중이면 그대로 판정', () => {
  const { room, r, me, run } = coopRoom();
  const now = r.startAt + 5000;
  fire(run, me, now);
  run.beginShield(now + 1000);
  assert.deepEqual(run.counter, { value: 0, at: now + 1000, fireAt: 0, coolUntil: 0 });
  room.destroy();

  const b = coopRoom();
  const at = fire(b.run, b.me, b.r.startAt + 5000);
  b.me.combo = 9;
  b.run.beginShield(at + 50);
  b.run.tickCounter(at + B.lagMs);
  assert.equal(b.me.combo, 0, '발동 뒤 판정 대기 중에는 취소하지 않음');
  b.room.destroy();
});

test('서버: 일시정지 shift가 at·fireAt·coolUntil을 민다', () => {
  const { room, r, me, run } = coopRoom();
  const at = fire(run, me, r.startAt + 5000);
  const before = { ...run.counter! };
  run.shift(10_000);
  assert.deepEqual(run.counter, { ...before, at: before.at + 10_000, fireAt: at + 10_000 });
  me.combo = 5;
  run.tickCounter(at + B.lagMs + 5000);
  assert.equal(me.combo, 5, '재개 직후 발동하지 않음');
  run.tickCounter(at + 10_000 + B.lagMs);
  assert.equal(me.combo, 0);
  const cool = run.counter!.coolUntil;
  run.shift(3000);
  assert.equal(run.counter!.coolUntil, cool + 3000);
  room.destroy();
});

test('서버: 예고 중 판이 끝나면(dispose) 판정하지 않음', () => {
  const { room, r, me, run } = coopRoom();
  const at = fire(run, me, r.startAt + 5000);
  me.combo = 7;
  run.dispose();
  sent.length = 0;
  run.tickCounter(at + B.lagMs);
  assert.equal(counterEv().length, 0);
  assert.equal(me.combo, 7);
  assert.equal(run.counter, null);
  room.destroy();
});

test('서버: 탈락한 사람은 대상 아님, 콤보 0인 사람은 lost에 없음', () => {
  const { room, r, me, run } = coopRoom('normal', 1);
  const bot = room.players.find((p) => p.bot)!;
  const at = fire(run, me, r.startAt + 5000);
  me.combo = 0; me.outAt = at; bot.combo = 3;
  sent.length = 0;
  run.tickCounter(at + B.lagMs);
  assert.deepEqual(counterEv(), [{ lost: [bot.id], saved: [] }]);
  room.destroy();
});

test('서버: 한 번에 크게 넘쳐도 용량에서 멈추고 예고는 한 번', () => {
  const { room, r, me, run } = coopRoom('expert');
  const now = r.startAt + 5000;
  me.combo = 40;
  catchN(run, me, 30, now);
  assert.equal(run.counter!.value, K.cap.expert);
  assert.equal(run.counter!.fireAt, now + K.warnMs);
  room.destroy();
});

test('서버: 재접속 상태(state)에 counter가 실림', () => {
  const { room, r, me, run } = coopRoom();
  catchN(run, me, 2, r.startAt + 5000);
  const st = run.state();
  assert.deepEqual(st.counter, run.counter);
  assert.notEqual(st.counter, run.counter, '복사본');
  room.destroy();
});
