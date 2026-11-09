import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';

/** 소켓 없이 방을 돌리기 위한 가짜 io (보낸 이벤트 이름만 기록) */
const sent: string[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string) { sent.push(ev); } }), sockets: { sockets: new Map() } }) as never;

function lobby() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  const b = (room.join('s2', 'k2', 'B') as { id: string }).id;
  room.fillBots = false;
  const P = (id: string) => room.players.find((p) => p.id === id)!;
  return { room, a, b, P };
}

test('준비: 방장 뺀 사람이 모두 준비해야 시작', () => {
  const { room, a, b } = lobby();
  assert.equal(room.start(a), '아직 준비 안 한 사람이 있어요.');
  assert.equal(room.notReady(), 1);
  room.setReady(b, true);
  assert.equal(room.notReady(), 0);
  assert.equal(room.start(a), null);
  room.destroy();
});

test('준비: 규칙·옵션 변경이나 게임이 끝나 대기실로 오면 모두 준비 해제', () => {
  const { room, a, b, P } = lobby();
  room.setReady(b, true);
  room.setRules(a, { rules: { feverSec: 10 } });
  assert.equal(P(b).ready, false);
  room.setReady(b, true);
  room.setOptions(a, { botLevel: 2 });
  assert.equal(P(b).ready, false);
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  (room as unknown as { end(): void }).end();
  assert.equal(P(b).ready, false);
  room.destroy();
});

test('방장 넘기기: 방장만, 봇·없는 사람에게는 안 됨, 새 방장의 준비 표시는 지움', () => {
  const { room, a, b, P } = lobby();
  room.setReady(b, true);
  room.giveHost(b, a); // 방장이 아니면 무시
  assert.equal(room.hostId, a);
  room.giveHost(a, 'nobody');
  assert.equal(room.hostId, a);
  room.giveHost(a, b);
  assert.equal(room.hostId, b);
  assert.equal(P(b).ready, false);
  room.destroy();
});

test('강퇴: 방장만·대기실에서만, 내보낸 키는 다시 못 들어옴', () => {
  const { room, a, b } = lobby();
  room.kick(b, a); // 방장이 아니면 무시
  assert.equal(room.players.length, 2);
  sent.length = 0;
  room.kick(a, b);
  assert.ok(!room.players.some((p) => p.id === b));
  assert.ok(sent.includes('room:kicked'));
  assert.deepEqual(room.join('s3', 'k2', 'B'), { error: '이 방에서 내보내졌어요.' });
  // 게임 중에는 내보낼 수 없음
  const c = (room.join('s4', 'k4', 'C') as { id: string }).id;
  room.setReady(c, true);
  assert.equal(room.start(a), null);
  room.kick(a, c);
  assert.ok(room.players.some((p) => p.id === c));
  room.destroy();
});

test('방장이 나가면 넘겨받은 사람의 준비 표시가 지워짐', () => {
  const { room, a, b, P } = lobby();
  room.setReady(b, true);
  room.leave(a, 's1');
  assert.equal(room.hostId, b);
  assert.equal(P(b).ready, false);
  room.destroy();
});

test('혼자 하기는 준비 없이 시작', () => {
  const room = new Room(fakeIo(), 'SOLO', () => {}, true);
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  assert.equal(room.start(a), null);
  room.destroy();
});
