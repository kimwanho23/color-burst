import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { DEFAULT_RULES } from '../src/index.ts';

/** 소켓 없이 방을 돌리기 위한 가짜 io (보낸 이벤트 이름만 기록) */
const sent: string[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string) { sent.push(ev); } }), sockets: { sockets: new Map() } }) as never;

function lobby() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  const b = (room.join('s2', 'k2', 'B') as { id: string }).id;
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
  room.addBot(a);
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

// ---------- 최종 리뷰 수정 ----------
test('바로 한 판 더: 게임이 끝난 직후 방장은 준비 확인 없이 다시 시작 (대기실 시작은 준비 필요)', () => {
  const { room, a, b } = lobby();
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  (room as unknown as { end(): void }).end();
  assert.equal(room.start(a), '아직 준비 안 한 사람이 있어요.', '대기실 시작 버튼은 준비 확인');
  assert.equal(room.start(a, true), null, '한 판 더는 준비 확인 없이');
  (room as unknown as { end(): void }).end();
  room.setRules(a, { rules: { feverSec: 10 } });
  assert.equal(room.start(a, true), '아직 준비 안 한 사람이 있어요.', '규칙을 바꾸면 한 판 더도 준비 필요');
  void b;
  room.destroy();
});

test('방장 넘기기: 대기실에서 접속 중인 사람에게만', () => {
  const { room, a, b, P } = lobby();
  P(b).connected = false;
  room.giveHost(a, b);
  assert.equal(room.hostId, a, '끊긴 사람에게는 안 넘김');
  room.destroy();
});

test('준비 확인은 접속 중인 사람만 센다 (끊긴 사람은 시작할 때 어차피 빠짐)', () => {
  const { room, a, b, P } = lobby();
  P(b).connected = false;
  assert.equal(room.notReady(), 0);
  room.destroy();
});

// ---------- 대기실 봇 ----------
const bots = (room: Room) => room.players.filter((p) => p.bot);
const endGame = (room: Room) => (room as unknown as { end(): void }).end();

test('봇 추가: 방장만, 보통으로, 봇까지 4칸이면 더 못 넣음', () => {
  const { room, a, b } = lobby();
  room.addBot(b);
  assert.equal(room.players.length, 2, '방장이 아니면 무시');
  room.addBot(a); room.addBot(a);
  assert.equal(room.players.length, 4);
  assert.deepEqual(bots(room).map((p) => [p.name, p.botLevel]), [['봇 A', 1], ['봇 B', 1]]);
  room.addBot(a);
  assert.equal(room.players.length, 4, '4칸이면 무시');
  room.destroy();
});

test('봇까지 4칸이면 사람은 가득 참, 봇을 빼면 들어옴', () => {
  const { room, a } = lobby();
  room.addBot(a); room.addBot(a);
  assert.deepEqual(room.join('s3', 'k3', 'C'), { error: '방이 가득 찼어요.' });
  room.removeBot(a, bots(room)[0]!.id);
  assert.ok('id' in room.join('s3', 'k3', 'C'));
  assert.equal(room.players.length, 4);
  room.destroy();
});

test('봇 빼기·난이도: 방장만, 대기실에서만', () => {
  const { room, a, b } = lobby();
  room.addBot(a);
  const bot = bots(room)[0]!;
  room.setBotLevel(b, bot.id, 2);
  assert.equal(bot.botLevel, 1);
  room.setBotLevel(a, bot.id, 2);
  assert.equal(bot.botLevel, 2);
  room.removeBot(b, bot.id);
  assert.equal(bots(room).length, 1);
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  room.removeBot(a, bot.id);
  room.setBotLevel(a, bot.id, 0);
  assert.equal(bots(room).length, 1, '게임 중에는 못 뺌');
  assert.equal(bot.botLevel, 2, '게임 중에는 난이도도 그대로');
  room.destroy();
});

test('봇 색을 고르면 봇과 맞바꿈', () => {
  const { room, a, P } = lobby();
  room.addBot(a);
  const bot = bots(room)[0]!;
  const mine = P(a).color, its = bot.color;
  room.setColor(a, its);
  assert.deepEqual([P(a).color, bot.color], [its, mine]);
  room.destroy();
});

test('팀전 봇 추가는 그 팀 자리가 있을 때만', () => {
  const { room, a, P } = lobby();
  room.setRules(a, { rules: { team: true } });
  assert.equal(P(a).team, 0);
  room.addBot(a, 0);
  assert.equal(bots(room)[0]!.team, 0);
  room.addBot(a, 0);
  assert.equal(bots(room).length, 1, '팀 0이 2명이면 무시');
  room.addBot(a, 1);
  assert.equal(bots(room)[1]!.team, 1);
  room.destroy();
});

test('시작: 봇마다 난이도로 Bot을 만들고, 개인전은 빈 칸을 채우지 않음', () => {
  const { room, a, b } = lobby();
  room.addBot(a);
  const bot = bots(room)[0]!;
  room.setBotLevel(a, bot.id, 2);
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  assert.equal(room.players.length, 3);
  const made = (room as unknown as { bots: Map<string, { level: number }> }).bots.get(bot.id);
  assert.equal(made?.level, 2);
  room.destroy();
});

test('팀전 시작은 빈 칸을 채우고 판이 끝나면 채운 봇은 빠짐', () => {
  const { room, a, b } = lobby();
  room.setRules(a, { rules: { team: true } });
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  assert.equal(room.players.length, 4);
  assert.equal(bots(room).filter((p) => p.filler).length, 2);
  endGame(room);
  assert.equal(room.players.length, 2);
  room.destroy();
});

test('판이 끝나면 대기실 봇만 남음', () => {
  const { room, a, b } = lobby();
  room.addBot(a);
  room.setBotLevel(a, bots(room)[0]!.id, 0);
  room.setReady(b, true);
  assert.equal(room.start(a), null);
  room.leave(b, 's2');
  assert.equal(bots(room).length, 2, '나간 사람 자리를 봇이 이어받음');
  endGame(room);
  assert.deepEqual(bots(room).map((p) => [p.name, p.botLevel]), [['봇 A', 0]]);
  room.destroy();
});

test('혼자 하기 방은 보통 봇 3명으로 시작', () => {
  const room = new Room(fakeIo(), 'S', () => {}, true);
  room.join('s1', 'k1', 'A');
  assert.equal(bots(room).length, 3);
  assert.ok(bots(room).every((p) => p.botLevel === 1));
  room.destroy();
});

test('협력전은 1명도 시작, 개인전은 봇 추가 안내', () => {
  const room = new Room(fakeIo(), 'C1', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  assert.equal(room.start(a), '혼자서는 시작할 수 없어요. 친구를 부르거나 봇을 추가해 주세요.');
  room.setRules(a, { rules: { ...DEFAULT_RULES, coop: true } });
  assert.equal(room.start(a), null);
  room.destroy();
});
