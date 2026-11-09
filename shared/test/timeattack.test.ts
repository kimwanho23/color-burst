import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIME_ATTACK_RULES, type Circle } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } }) as never;

function taRoom() {
  const room = new Room(fakeIo(), 'TA', () => {}, true, true);
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  return { room, a };
}

test('타임어택 규칙: 기본 60초 클래식에서 보스·레이저·방해·맵 패턴·이벤트·테마 끔', () => {
  const r = TIME_ATTACK_RULES;
  assert.deepEqual([r.mode, r.roundSec, r.boss, r.laser, r.sabotage, r.mapPct, r.eventPct, r.themePct, r.team, r.survival],
    ['classic', 60, false, false, false, 0, 0, 0, false, false]);
});

test('타임어택 방: 봇 없이 혼자 시작, 규칙 고정(바꾸기 무시), 방 정보에 timeAttack', () => {
  const { room, a } = taRoom();
  room.setRules(a, { rules: { boss: true, roundSec: 30 } });
  assert.equal(room.snapshot().rules.boss, false);
  assert.equal(room.snapshot().rules.roundSec, 60);
  assert.equal(room.snapshot().timeAttack, true);
  assert.equal(room.start(a), null);
  assert.equal(room.players.length, 1);
  assert.ok(!room.players.some((p) => p.bot));
  room.destroy();
});

test('타임어택 방: 나오는 원은 내 색·노랑·무지개·아이템뿐', () => {
  const { room, a } = taRoom();
  assert.equal(room.start(a), null);
  const r = room as unknown as { startAt: number; lastSpawn: number; tick(): void; circles: Map<number, Circle>; nextSample: number };
  const now = Date.now();
  r.startAt = now - 20_000; r.lastSpawn = now - 20_000; r.nextSample = 1e12;
  r.tick();
  const me = room.players[0];
  const kinds = [...r.circles.values()].map((c) => c.kind);
  assert.ok(kinds.length > 5);
  assert.ok(kinds.every((k) => k === me.color || k === 'y' || k === 'rainbow' || k === 'item' || k === 'gold'), JSON.stringify(kinds));
  room.destroy();
});

import { taVerdict } from '../../client/src/timeAttack.ts';
test('타임어택 기록 판정: 0점은 신기록이 아님, 첫 기록·갱신·못 넘음', () => {
  assert.deepEqual(taVerdict(0, null), { record: false, title: '0점', hint: '원을 잡아 첫 기록을 세워 보세요' });
  assert.deepEqual(taVerdict(120, null), { record: true, title: '신기록!', hint: '첫 기록이에요' });
  assert.deepEqual(taVerdict(150, 120), { record: true, title: '신기록!', hint: '이전 최고 120점' });
  assert.deepEqual(taVerdict(100, 120), { record: false, title: '100점', hint: '최고 기록 120점' });
  assert.deepEqual(taVerdict(120, 120), { record: false, title: '120점', hint: '최고 기록 120점' });
});
