import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { RULES, type Circle } from '../src/index.ts';

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
  t.mock.method(Math, 'random', () => 0.5); // 전설 [시간 정지, 필드 클리어, 1등 저격] 중 필드 클리어
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
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = room as unknown as { endRound(): void; arcadeState(): { event: { id: string; text: string } | null } | null };
  r.endRound();
  t.mock.timers.tick(RULES.roundEndMs);
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
  t.mock.method(Math, 'random', () => 0.5); // 전설 [시간 정지, 필드 클리어, 1등 저격] 중 필드 클리어
  const q = { x: 800 + Math.cos(2) * 300, y: 450 + Math.sin(2) * 300 };
  room.click(me.id, { circleId: 1, x: q.x, y: q.y });
  assert.equal(circles.has(200), true);
  assert.equal(circles.has(201), false);
  room.destroy();
});

test('보스를 터뜨린 직후 1초 동안은 빈 곳 클릭 페널티 없음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  // 가운데 밖에 멈춰 있는 체력 1짜리 보스
  circles.set(50, { id: 50, kind: 'boss', angle: 0, speed: 300, r: 90, born: now - 1000, hp: 1, maxHp: 1 });
  room.click(me.id, { circleId: 50, x: 1100, y: 450 });
  assert.equal(circles.has(50), false);
  me.combo = 7;
  room.click(me.id, { circleId: null, x: 10, y: 10 });
  assert.deepEqual([me.combo, me.stats.misses], [7, 0]);
  // 1초가 지나면 다시 페널티
  (room as unknown as { bossKilledAt: number }).bossKilledAt = Date.now() - 1001;
  room.click(me.id, { circleId: null, x: 10, y: 10 });
  assert.equal(me.combo, 0);
  room.destroy();
});

test('라운드가 끝나면 "라운드 종료"를 먼저 알리고 1.5초 뒤에 능력 선택을 연다', (t) => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { rules: { mode: 'arcade' } });
  assert.equal(room.start(a.id), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = room as unknown as { endRound(): void; offers: Map<string, unknown> };
  sent.length = 0;
  r.endRound();
  assert.ok(sent.includes('round:end'));
  assert.ok(!sent.includes('arcade:pick'));
  assert.equal(r.offers.size, 0);
  room.choose(a.id, 0); // 그사이 들어온 선택은 무시
  t.mock.timers.tick(RULES.roundEndMs);
  assert.ok(sent.includes('arcade:pick'));
  assert.equal(r.offers.size, 2);
  assert.equal(room.players[0].picks.length, 0);
});

test('방어형 보스: 보호막 중에 때리면 피해·점수 없음, 헛클릭도 아님', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  // 태어난 지 2.5초: 보호막 중 (3초마다 마지막 1초)
  circles.set(60, { id: 60, kind: 'boss', boss: 'guard', angle: 0, speed: 120, r: 90, born: now - 2500, hp: 5, maxHp: 5 });
  me.combo = 4;
  sent.length = 0;
  room.click(me.id, { circleId: 60, x: 800 + 300, y: 450 });
  assert.deepEqual([circles.get(60)!.hp, me.score, me.combo, me.stats.misses], [5, 0, 4, 0]);
  assert.ok(sent.includes('boss:hit'));
  room.destroy();
});

test('공격형 보스: 붉을 때 때리면 −2, 다시 때리면 −4, 피해는 없음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  // 태어난 지 3초: 붉은 상태 (4초마다 마지막 1.5초)
  circles.set(61, { id: 61, kind: 'boss', boss: 'rage', angle: 0, speed: 100, r: 90, born: now - 3000, hp: 5, maxHp: 5 });
  me.score = 20;
  room.click(me.id, { circleId: 61, x: 800 + 300, y: 450 });
  assert.equal(me.score, 18);
  room.click(me.id, { circleId: 61, x: 800 + 300, y: 450 });
  assert.equal(me.score, 14);
  assert.equal(circles.get(61)!.hp, 5);
  room.destroy();
});

test('보스 등장: 한 번에 여러 마리여도 화면에는 최대 3마리', (t) => {
  const { room, circles } = playingRoom();
  const r = room as unknown as { spawnBosses(now: number): void };
  t.mock.method(Math, 'random', () => 0.97); // 3마리
  r.spawnBosses(Date.now());
  r.spawnBosses(Date.now());
  assert.equal([...circles.values()].filter((c) => c.kind === 'boss').length, 3);
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

// ---------- 3단계 1차: 커서·스턴·레이저·자석 ----------
type Priv = {
  updateLaser(now: number): void;
  updatePulls(now: number): void;
  laser: { a: { x: number; y: number }; b: { x: number; y: number }; at: number; hit: Set<string> } | null;
  hostId: string;
};
const priv = (room: Room) => room as unknown as Priv;
/** now에 (x, y)에 있고 거의 안 움직이는 원 */
const slowAt = (id: number, kind: Circle['kind'], x: number, y: number, now: number): Circle => {
  const d = Math.hypot(x - 800, y - 450);
  return { id, kind, angle: Math.atan2(y - 450, x - 800), speed: d / 100, r: 40, born: now - 100_000 };
};

test('스턴 중에는 빈 곳·원 클릭 모두 무시', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.stunUntil = now + 1000; me.combo = 5;
  circles.set(70, slowAt(70, 0, 1200, 450, now));
  room.click(me.id, { circleId: null, x: 10, y: 10 });
  room.click(me.id, { circleId: 70, x: 1200, y: 450 });
  assert.deepEqual([me.combo, me.stats.misses, circles.has(70)], [5, 0, true]);
  room.destroy();
});

test('레이저: 선 위에 커서가 있는 사람만 1.5초 스턴, 한 레이저에 한 번', () => {
  const { room, me } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  room.cursor(me.id, { x: 800, y: 300 });
  room.cursor(other.id, { x: 800, y: 600 });
  priv(room).laser = { a: { x: 0, y: 300 }, b: { x: 1600, y: 300 }, at: now - 10, hit: new Set() };
  sent.length = 0;
  priv(room).updateLaser(now);
  assert.ok(me.stunUntil >= now + 1400 && me.stunUntil <= now + 1600, String(me.stunUntil - now));
  assert.equal(other.stunUntil, 0);
  const first = me.stunUntil;
  priv(room).updateLaser(now + 50);
  assert.equal(me.stunUntil, first);
  assert.equal(sent.filter((e) => e === 'stun').length, 1);
  room.destroy();
});

test('레이저: 0.5초 넘게 소식 없는 커서는 안 맞는다', (t) => {
  const { room, me } = playingRoom();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  room.cursor(me.id, { x: 800, y: 300 });
  t.mock.timers.tick(600);
  const now = Date.now();
  priv(room).laser = { a: { x: 0, y: 300 }, b: { x: 1600, y: 300 }, at: now - 10, hit: new Set() };
  priv(room).updateLaser(now);
  assert.equal(me.stunUntil, 0);
  room.destroy();
});

test('자석: 커서 근처 내 원을 1초에 2개까지 끌어와 0.25초 뒤 잡는다, 끌리는 원은 남이 못 잡음', () => {
  const { room, me, circles } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  me.picks = [{ id: 'magnet', tier: 0 }]; // 반경 60
  const now = Date.now();
  room.cursor(me.id, { x: 1200, y: 450 });
  for (const [id, x] of [[81, 1220], [82, 1240], [83, 1180]] as const) circles.set(id, slowAt(id, me.color, x, 450, now));
  sent.length = 0;
  priv(room).updatePulls(now);
  assert.equal(sent.filter((e) => e === 'circle:pull').length, 2);
  // 가장 가까운 81(20)과 83(20) 중 둘이 끌림 → 82는 남음
  room.click(other.id, { circleId: 81, x: 1220, y: 450 });
  assert.equal(other.score, 0);
  priv(room).updatePulls(now + 300);
  assert.equal(me.score, 6);
  assert.equal(circles.has(82), true);
  // 1.1초 뒤에도 커서를 계속 움직이고 있다고 본다 (커서가 오래되면 끌지 않음)
  (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors.set(me.id, { x: 1200, y: 450, at: now + 1100 });
  priv(room).updatePulls(now + 1100);
  assert.equal(sent.filter((e) => e === 'circle:pull').length, 3);
  room.destroy();
});

test('자석: 스턴 중이거나 커서가 오래되면 끌지 않는다', () => {
  const { room, me, circles } = playingRoom();
  me.picks = [{ id: 'magnet', tier: 0 }];
  const now = Date.now();
  circles.set(91, slowAt(91, me.color, 1220, 450, now));
  room.cursor(me.id, { x: 1200, y: 450 });
  me.stunUntil = now + 1000;
  sent.length = 0;
  priv(room).updatePulls(now);
  me.stunUntil = 0;
  priv(room).updatePulls(now + 700); // 커서가 0.7초 전 것
  assert.equal(sent.filter((e) => e === 'circle:pull').length, 0);
  room.destroy();
});

test('일시정지가 풀리면 레이저 발사 시각도 그만큼 밀린다', (t) => {
  const { room } = playingRoom();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const at = Date.now() + 500;
  priv(room).laser = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, at, hit: new Set() };
  const host = priv(room).hostId;
  room.pause(host);
  t.mock.timers.tick(2000);
  room.resume(host);
  assert.equal(priv(room).laser!.at, at + 2000);
  room.destroy();
});

test('라운드가 끝날 때 끌려오던 원은 끄는 사람이 잡은 것으로 처리', (t) => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { rules: { mode: 'arcade' } });
  assert.equal(room.start(a.id), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const me = room.players.find((p) => p.id === a.id)!;
  const r = room as unknown as { circles: Map<number, Circle>; pulls: Map<number, unknown>; endRound(): void; startAt: number };
  r.startAt = 0;
  const now = Date.now();
  r.circles.set(95, slowAt(95, me.color, 1200, 450, now));
  r.pulls.set(95, { circleId: 95, by: me.id, from: { x: 1200, y: 450 }, at: now, ms: 250 });
  r.endRound();
  assert.equal(me.score, 3);
  assert.equal(r.pulls.size, 0);
});

test('시간 정지를 잡으면 예고 중인 레이저도 정지 시간만큼 늦게 발사', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  const at = now + 600;
  priv(room).laser = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, at, hit: new Set() };
  t.mock.method(Math, 'random', () => 0); // 전설 [시간 정지, 필드 클리어] 중 시간 정지
  room.click(me.id, { circleId: 1, x: 1100, y: 450 });
  assert.equal(priv(room).laser!.at, at + RULES.items.freezeMs);
  room.destroy();
});

test('봇은 남의 자석에 끌려가는 원을 후보에서 뺀다', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(96, slowAt(96, 'y', 1200, 450, now));
  circles.set(97, slowAt(97, 'y', 400, 450, now));
  (room as unknown as { pulls: Map<number, unknown> }).pulls.set(96, { circleId: 96, by: me.id, from: { x: 1200, y: 450 }, at: now, ms: 250 });
  const ids = (room as unknown as { botCandidates(): Circle[] }).botCandidates().map((c) => c.id);
  assert.ok(ids.includes(97) && !ids.includes(96));
  room.destroy();
});

test('같은 틱에 두 사람 자석이 같은 원을 노리면 순번이 고정되지 않는다', (t) => {
  const winner = (rand: number) => {
    const { room, me, circles } = playingRoom();
    const other = room.players.find((p) => p.id !== me.id)!;
    me.picks = [{ id: 'magnet', tier: 0 }]; other.picks = [{ id: 'magnet', tier: 0 }];
    const now = Date.now();
    circles.set(98, slowAt(98, 'y', 1200, 450, now));
    room.cursor(me.id, { x: 1210, y: 450 }); room.cursor(other.id, { x: 1190, y: 450 });
    const m = t.mock.method(Math, 'random', () => rand);
    priv(room).updatePulls(now);
    m.mock.restore();
    const by = ((room as unknown as { pulls: Map<number, { by: string }> }).pulls.get(98))!.by;
    room.destroy();
    return by === me.id ? 'me' : 'other';
  };
  assert.notEqual(winner(0), winner(0.99));
});

test('라운드가 시작되면 커서 기록을 지운다', () => {
  const { room, me } = playingRoom();
  room.cursor(me.id, { x: 100, y: 100 });
  (room as unknown as { beginRound(): void }).beginRound();
  assert.equal((room as unknown as { cursors: Map<string, unknown> }).cursors.size, 0);
  room.destroy();
});
