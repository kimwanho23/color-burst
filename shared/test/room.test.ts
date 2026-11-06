import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import type { Circle } from '../src/index.ts';

/** 소켓 없이 방을 돌리기 위한 가짜 io (보낸 이벤트 이름만 기록) */
const sent: string[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string) { sent.push(ev); } }), sockets: { sockets: new Map() } }) as never;

function playingRoom() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  assert.equal(room.start(a.id), null);
  const r = room as unknown as { startAt: number; circles: Map<number, Circle> };
  r.startAt = 0;
  return { room, me: room.players.find((p) => p.id === a.id)!, circles: r.circles };
}

test('이미 가져간 원을 늦게 누르면 거절만 하고 빈 곳 페널티는 없다', () => {
  const { room, me } = playingRoom();
  me.combo = 12; me.fever = 40;
  room.click(me.id, { circleId: 999, x: 800, y: 450 });
  assert.deepEqual([me.combo, me.fever, me.stats.misses], [12, 40, 0]);
  room.destroy();
});

test('필드 클리어: 원이 많아도 플레이어 상태는 한 번만 보낸다', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  // 가운데 발사 보호 구역 밖: 1초 전에 초당 300으로 출발한 원들
  for (let i = 0; i < 20; i++) circles.set(100 + i, { id: 100 + i, kind: (i % 4) as 0, angle: i, speed: 300, r: 40, born: now - 1000 });
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  t.mock.method(Math, 'random', () => 0.99); // 전설 [시간 정지, 필드 클리어] 중 필드 클리어
  sent.length = 0;
  room.click(me.id, { circleId: 1, x: 1100, y: 450 });
  assert.equal(sent.filter((e) => e === 'circle:claimed').length, 20);
  assert.equal(sent.filter((e) => e === 'players').length, 1);
  room.destroy();
});

test('랜덤 이벤트가 일어나면 능력 선택 상태에 그 결과가 남는다 (선택 화면·재접속에서 보이게)', (t) => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { rules: { mode: 'arcade' } });
  assert.equal(room.start(a.id), null);
  room.players[0].score = 50;
  t.mock.method(Math, 'random', () => 0);
  const r = room as unknown as { endRound(): void; arcadeState(): { event: { id: string; text: string } | null } | null };
  r.endRound();
  const ev = r.arcadeState()?.event;
  assert.ok(ev, 'pick 상태에 event가 있어야 함');
  assert.ok(ev!.text.length > 0);
});

test('발사 보호 구역: 필드 클리어·장판도 가운데 원은 못 잡는다', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(200, { id: 200, kind: 0, angle: 0, speed: 0, r: 40, born: now }); // 가운데
  circles.set(201, { id: 201, kind: 0, angle: 0, speed: 300, r: 40, born: now - 1000 }); // 바깥
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 2, speed: 300, r: 34, born: now - 1000 });
  t.mock.method(Math, 'random', () => 0.99); // 필드 클리어
  const q = { x: 800 + Math.cos(2) * 300, y: 450 + Math.sin(2) * 300 };
  room.click(me.id, { circleId: 1, x: q.x, y: q.y });
  assert.equal(circles.has(200), true);
  assert.equal(circles.has(201), false);
  room.destroy();
});

test('빈 곳 클릭은 지금처럼 페널티', () => {
  const { room, me } = playingRoom();
  me.combo = 12;
  room.click(me.id, { circleId: null, x: 10, y: 10 });
  assert.equal(me.combo, 0);
  assert.equal(me.stats.misses, 1);
  room.destroy();
});
