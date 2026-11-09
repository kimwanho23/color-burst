import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { gameRecord } from '../../server/src/gameLog.ts';
import { ARCADE, DEFAULT_RULES, newPlayer } from '../src/index.ts';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } }) as never;

test('판 기록: 순위·점수·잡은 원 수·고른 능력·출처, 이름·키는 없음', () => {
  const a = newPlayer('id-a', '철수', 0), b = newPlayer('id-b', '봇 A', 1, true);
  a.score = 120; a.stats.hits = 40; a.stats.misses = 3; a.picks = [{ id: 'magnet', tier: 2 }];
  b.score = 80; b.stats.hits = 30;
  const rec = gameRecord({ rules: { ...DEFAULT_RULES, mode: 'arcade' }, solo: false, timeAttack: false, roundMs: 30_000, ranking: [a, b], now: new Date(0) });
  assert.equal(rec.mode, 'arcade');
  assert.equal(rec.rounds, ARCADE.rounds);
  assert.deepEqual([rec.humans, rec.bots, rec.roundSec], [1, 1, 30]);
  assert.deepEqual(rec.players.map((p) => [p.rank, p.bot, p.score, p.stats.hits]), [[1, false, 120, 40], [2, true, 80, 30]]);
  assert.deepEqual(rec.players[0].picks, ['magnet:2']);
  assert.equal(rec.players[0].stats.misses, 3);
  assert.ok('src' in rec.players[0].stats);
  const line = JSON.stringify(rec);
  assert.ok(!line.includes('철수') && !line.includes('id-a'), '이름·아이디 없음');
  assert.equal(rec.at, '1970-01-01T00:00:00.000Z');
});

test('판이 끝나면 서버 로그에 [game] 한 줄, 접속 키 없음', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const room = new Room(fakeIo(), 'LOG', () => {});
  const a = room.join('s1', 'secret-key-1', '영희') as { id: string };
  room.join('s2', 'secret-key-2', '민수');
  room.fillBots = false;
  for (const p of room.players) if (p.id !== a.id) room.setReady(p.id, true);
  try {
    assert.equal(room.start(a.id), null);
    room.players[0].score = 10;
    (room as unknown as { end(): void }).end();
    const lines = log.mock.calls.map((c) => String(c.arguments[0])).filter((s) => s.startsWith('[game] '));
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0].slice(7));
    assert.deepEqual([rec.mode, rec.humans, rec.players.length], ['classic', 2, 2]);
    assert.ok(!lines[0].includes('secret-key') && !lines[0].includes('영희'));
  } finally { room.destroy(); }
});
