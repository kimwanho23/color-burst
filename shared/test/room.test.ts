import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { RULES, circlePos as circlePosOf, isSpecial, type Circle, type Pick } from '../src/index.ts';

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
  lasers: { lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]; at: number; hit: Set<string> }[];
  nextLaserAt: number;
  endAt: number;
  playPayload(): { lasers: object[] };
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
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1600, y: 300 } }], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
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
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1600, y: 300 } }], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
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
  assert.equal(me.score, 12); // 원 2개 × 3점 × 사이 구역 ×2
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

const lineAB = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } };
test('일시정지가 풀리면 모든 볼리의 발사 시각이 그만큼 밀린다', (t) => {
  const { room } = playingRoom();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const at = Date.now() + 500;
  priv(room).lasers = [{ lines: [lineAB], at, hit: new Set() }, { lines: [lineAB], at: at + 700, hit: new Set() }];
  const host = priv(room).hostId;
  room.pause(host);
  t.mock.timers.tick(2000);
  room.resume(host);
  assert.deepEqual(priv(room).lasers.map((l) => l.at), [at + 2000, at + 2700]);
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
  assert.equal(me.score, 6); // 3점 × 사이 구역 ×2 (1200, 450)
  assert.equal(r.pulls.size, 0);
});

test('시간 정지를 잡으면 예고 중인 레이저도 정지 시간만큼 늦게 발사', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  const at = now + 600;
  // 아직 안 쏜 볼리만 밀리고, 이미 쏘고 있는 볼리는 그대로
  priv(room).lasers = [{ lines: [lineAB], at, hit: new Set() }, { lines: [lineAB], at: now - 50, hit: new Set() }];
  t.mock.method(Math, 'random', () => 0); // 전설 [시간 정지, 필드 클리어] 중 시간 정지
  room.click(me.id, { circleId: 1, x: 1100, y: 450 });
  assert.deepEqual(priv(room).lasers.map((l) => l.at), [at + RULES.items.freezeMs, now - 50]);
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

// ---------- 3단계 2차: 방해·오오라·카오스 ----------
test('1등 저격 아이템: 대상(1등, 내가 1등이면 2등)이 스턴되고 stun 알림', (t) => {
  const { room, me, circles } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  other.score = 30; other.combo = 4;
  const now = Date.now();
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  t.mock.method(Math, 'random', () => 0.99); // 전설 [시간 정지, 필드 클리어, 1등 저격] 중 1등 저격
  sent.length = 0;
  room.click(me.id, { circleId: 1, x: 1100, y: 450 });
  assert.ok(other.stunUntil > now);
  assert.equal(other.combo, 0);
  assert.equal(sent.filter((e) => e === 'stun').length, 1);
  room.destroy();
});

/** 가운데에서 오른쪽으로 400 떨어져 멈춰 있는 이동형 보스 (반지름 60, 오오라 140) */
const runnerAt = (now: number): Circle => ({ id: 77, kind: 'boss', boss: 'runner', angle: 0, speed: 0.004, r: 60, born: now - 100_000_000, hp: 10, maxHp: 10 });

test('오오라: 커서가 고리 안이면 0.5초마다 −1, 몸통 안이면 감점 없음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.score = 5;
  const cursors = (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  const r = room as unknown as { updateAura(now: number): void };
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now });
  r.updateAura(now);
  assert.equal(me.score, 4);
  r.updateAura(now + 200);
  assert.equal(me.score, 4);
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now + 500 });
  r.updateAura(now + 500);
  assert.equal(me.score, 3);
  cursors.set(me.id, { x: pos.x + 10, y: pos.y, at: now + 1000 });
  r.updateAura(now + 1000);
  assert.equal(me.score, 3);
  room.destroy();
});

test('오오라를 클릭하면 −2 (헛클릭 아님)', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.score = 5; me.combo = 3;
  sent.length = 0;
  room.click(me.id, { circleId: null, x: pos.x + 100, y: pos.y });
  assert.deepEqual([me.score, me.combo, me.stats.misses], [3, 3, 0]);
  assert.ok(sent.includes('aura:hit'));
  room.destroy();
});

test('카오스 방: 아이템 원 확률 3배', () => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { preset: 'chaos' });
  assert.equal(room.start(a.id), null);
  const opts = (room as unknown as { spawnOpts(now: number): { itemChance?: number } }).spawnOpts(Date.now());
  assert.ok(Math.abs(opts.itemChance! - RULES.items.chance * 3) < 1e-12);
  room.destroy();
});

// ---------- 레이저 볼리 ----------
test('여러 줄·겹친 볼리에도 스턴은 한 번, 스턴 중인 사람은 안 늘어남', () => {
  const { room, me } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  room.cursor(me.id, { x: 800, y: 300 });
  room.cursor(other.id, { x: 400, y: 300 });
  other.stunUntil = now + 2000; // 저격 스턴 중
  const h = { a: { x: 0, y: 300 }, b: { x: 1600, y: 300 } }, v = { a: { x: 800, y: 0 }, b: { x: 800, y: 900 } };
  priv(room).lasers = [{ lines: [h, v], at: now - 10, hit: new Set() }, { lines: [h], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
  sent.length = 0;
  priv(room).updateLaser(now);
  assert.equal(sent.filter((e) => e === 'stun').length, 1);
  assert.equal(me.stunUntil, now + RULES.laser.stunMs);
  assert.equal(other.stunUntil, now + 2000);
  room.destroy();
});

test('상태 스냅샷에 진행 중 볼리 (hit는 빼고)', () => {
  const { room } = playingRoom();
  priv(room).lasers = [{ lines: [lineAB], at: Date.now() + 500, hit: new Set(['x']) }];
  const ls = priv(room).playPayload().lasers;
  assert.equal(ls.length, 1);
  assert.equal('hit' in ls[0], false);
  room.destroy();
});

test('카오스도 시작·끝 조용한 시간을 지키고, 다음은 0.6초나 2초 뒤', () => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { preset: 'chaos' });
  assert.equal(room.start(a.id), null);
  const r = room as unknown as Priv & { startAt: number };
  const now = Date.now();
  r.nextLaserAt = 0;
  r.startAt = now - 1000; r.endAt = now + 30_000;
  r.updateLaser(now);
  assert.equal(r.lasers.length, 0, '시작 1초');
  r.startAt = now - 30_000; r.endAt = now + 1000;
  r.updateLaser(now);
  assert.equal(r.lasers.length, 0, '끝 1초 전');
  r.startAt = now - 5000; r.endAt = now + 30_000;
  r.updateLaser(now);
  assert.equal(r.lasers.length, 1);
  assert.ok([600, 2000].includes(r.nextLaserAt - 5000), String(r.nextLaserAt));
  room.destroy();
});

// ---------- 점수 구역·황금 원 ----------
test('잡는 방법과 상관없이 원 위치로 구역', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(81, slowAt(81, me.color, 1500, 450, now));
  room.click(me.id, { circleId: 81, x: 1500, y: 450 });
  assert.equal(me.score, 9, '가장자리 클릭 3×3');
  circles.set(82, slowAt(82, me.color, 1000, 450, now));
  room.click(me.id, { circleId: 82, x: 1000, y: 450 });
  assert.equal(me.score, 12, '중앙 3×1');
  const c = slowAt(83, me.color, 1500, 450, now);
  circles.set(83, c);
  (room as unknown as { claim(p: unknown, c: Circle, now: number, via: string, quiet: boolean): void }).claim(me, c, now, 'blast', true);
  assert.equal(me.score, 21, '폭죽도 가장자리 3×3');
  room.destroy();
});

test('황금 원은 직접 클릭으로만, +20 고정', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  const gold = (id: number): Circle => ({ id, kind: 'gold', angle: 0, speed: 7000, r: 22, born: now - 100 }); // 지금 (1500, 450)
  me.feverUntil = now + 5000; me.buffs.double = now + 5000; me.combo = 4; me.fever = 30;
  circles.set(91, gold(91));
  sent.length = 0;
  room.click(me.id, { circleId: 91, x: 1500, y: 450 });
  assert.deepEqual([me.score, me.combo, me.fever, circles.has(91)], [20, 4, 30, false]);
  assert.ok(sent.includes('gold:got'));
  // 넓은 손 범위 안이어도 안 잡힘
  circles.set(92, gold(92));
  me.buffs.wideHand = now + 5000;
  room.click(me.id, { circleId: null, x: 1490, y: 450 });
  assert.equal(circles.has(92), true);
  // 필드 클리어로도 안 잡힘
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  t.mock.method(Math, 'random', () => 0.5); // 전설 중 필드 클리어
  room.click(me.id, { circleId: 1, x: 1100, y: 450 });
  assert.equal(circles.has(92), true);
  assert.equal(me.score, 20);
  room.destroy();
});

// ---------- 3-1: 두 장 선택·역전 기회·특별 카드 ----------
type PickPriv = {
  round: number; roundPhase: string; startPick(): void; finishPick(): void;
  offers: Map<string, { options: Pick[]; need: number; chosen: boolean; comeback: boolean }>;
};
/** 아케이드 방 (사람 2명, 봇 없음) */
function arcadeRoom() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  const b = room.join('s2', 'k2', 'B') as { id: string };
  room.fillBots = false;
  room.setRules(a.id, { rules: { mode: 'arcade', randomEvents: false } });
  assert.equal(room.start(a.id), null);
  const me = room.players.find((p) => p.id === a.id)!, other = room.players.find((p) => p.id === b.id)!;
  return { room, me, other, r: room as unknown as PickPriv };
}
/** k라운드가 끝난 뒤 선택을 연다 */
const openPick = (r: PickPriv, round: number) => { r.round = round; r.roundPhase = 'pick'; r.startPick(); };

test('두 장 선택: 하나 고르면 남은 카드·need 1을 다시 보냄', () => {
  const { room, me, r } = arcadeRoom();
  openPick(r, 3);
  const o = r.offers.get(me.id)!;
  assert.deepEqual([o.need, o.options.length], [2, 3]);
  sent.length = 0;
  room.choose(me.id, 0);
  assert.deepEqual([o.need, o.options.length, o.chosen, me.picks.length], [1, 2, false, 1]);
  assert.ok(sent.includes('arcade:offer'));
  room.choose(me.id, 0);
  assert.deepEqual([o.chosen, me.picks.length], [true, 2]);
  room.destroy();
});

test('두 장 선택: 마감 때 남은 수만큼 무작위', () => {
  const { room, me, other, r } = arcadeRoom();
  openPick(r, 3);
  room.choose(me.id, 0);
  r.finishPick();
  assert.deepEqual([me.picks.length, other.picks.length], [2, 2]);
  room.destroy();
});

test('재접속하면 남은 선택지를 다시 받음', () => {
  const { room, me, r } = arcadeRoom();
  openPick(r, 3);
  room.choose(me.id, 0);
  sent.length = 0;
  room.join('s9', 'k1', 'A');
  assert.ok(sent.includes('arcade:offer'));
  assert.equal(r.offers.get(me.id)!.need, 1);
  room.destroy();
});

test('3라운드 끝 역전 꼴찌는 특별 카드를 받음, 1등은 못 받음', () => {
  const { room, me, other, r } = arcadeRoom();
  me.score = 100; other.score = 1000;
  openPick(r, 3);
  assert.equal(me.comeback, true);
  assert.equal(r.offers.get(me.id)!.options.filter((o) => isSpecial(o.id)).length, 1);
  assert.equal(r.offers.get(other.id)!.options.some((o) => isSpecial(o.id)), false);
  room.destroy();
});

test('4라운드 끝 역전 꼴찌는 전부 레전드', () => {
  const { room, me, other, r } = arcadeRoom();
  me.score = 100; other.score = 1000;
  openPick(r, 4);
  assert.ok(r.offers.get(me.id)!.options.every((o) => o.tier === 3));
  room.destroy();
});

test('1라운드 끝은 역전 판정 안 함', () => {
  const { room, me, other, r } = arcadeRoom();
  me.score = 100; other.score = 1000;
  openPick(r, 1);
  assert.equal(me.comeback, false);
  assert.equal(r.offers.get(me.id)!.comeback, false);
  room.destroy();
});

test('봇은 두 장을 고르고 특별 카드를 먼저', (t) => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.setRules(a.id, { rules: { mode: 'arcade', randomEvents: false } });
  assert.equal(room.start(a.id), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = room as unknown as PickPriv;
  const bots = room.players.filter((p) => p.bot);
  room.players.forEach((p) => { p.score = p.bot ? 500 : 1000; });
  bots[0].score = 100;
  openPick(r, 3);
  for (let k = 0; k < 10; k++) t.mock.timers.tick(1000); // 두 번째 카드 타이머는 첫 카드를 고른 뒤에 걸린다
  assert.equal(bots[0].picks.length, 2);
  assert.equal(isSpecial(bots[0].picks[0].id), true);
});

test('연쇄 폭발: 근처 내 원을 함께 잡음', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks.push({ id: 'chainBlast', tier: 0 });
  circles.set(71, slowAt(71, me.color, 1200, 450, now));
  circles.set(72, slowAt(72, me.color, 1260, 450, now));
  circles.set(73, slowAt(73, me.color, 400, 450, now));
  t.mock.method(Math, 'random', () => 0);
  room.click(me.id, { circleId: 71, x: 1200, y: 450 });
  assert.deepEqual([circles.has(71), circles.has(72), circles.has(73)], [false, false, true]);
  room.destroy();
});

// ---------- 3-1 리뷰 수정 ----------
test('역전 배율: 꼴찌를 벗어났다가 다시 꼴찌가 돼도 그 라운드에는 다시 안 켜짐', () => {
  const { room, me, circles } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  me.score = 100; other.score = 105; me.comeback = true;
  circles.set(61, slowAt(61, me.color, 1500, 450, now));
  room.click(me.id, { circleId: 61, x: 1500, y: 450 }); // 가장자리 9 × 1.1 = 10 → 110, 꼴찌 탈출
  me.score = 110; other.score = 120; // 다른 사람이 다시 앞질러 다시 꼴찌
  circles.set(62, slowAt(62, me.color, 1500, 450, now));
  room.click(me.id, { circleId: 62, x: 1500, y: 450 });
  assert.equal(me.comeback, false);
  assert.equal(me.score, 119, '배율 없이 +9 (켜져 있었다면 +10)');
  room.destroy();
});

test('특별 카드를 고른 뒤 다시 뽑아도 특별 카드는 다시 안 나옴', () => {
  const { room, me, other, r } = arcadeRoom();
  me.score = 100; other.score = 1000;
  openPick(r, 3);
  const o = r.offers.get(me.id)!;
  room.choose(me.id, o.options.findIndex((x) => isSpecial(x.id)));
  for (let n = 0; n < 20; n++) {
    (o as unknown as { rerolls: number }).rerolls = 1;
    room.reroll(me.id);
    assert.equal(o.options.some((x) => isSpecial(x.id)), false);
  }
  room.destroy();
});

test('카드 id가 다르면 고르지 않음 (겹친 클릭)', () => {
  const { room, me, r } = arcadeRoom();
  openPick(r, 3);
  const o = r.offers.get(me.id)!;
  const first = o.options[0].id;
  room.choose(me.id, 0, first);
  room.choose(me.id, 0, first); // 같은 클릭이 한 번 더 — 그 자리는 이제 다른 카드
  assert.equal(me.picks.length, 1);
  room.destroy();
});

// ---------- 3-2: 레전드·새 증강 (서버) ----------
test('헛손질 보정은 내 원만 (남의 색·끌리는 원·보호 구역 제외), 페널티 없음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'missSave', tier: 0 }]; // 반경 40
  me.combo = 4;
  circles.set(51, slowAt(51, (me.color + 1) % 4 as 0, 1230, 450, now)); // 남의 색 (더 가까움)
  circles.set(52, slowAt(52, me.color, 1270, 450, now)); // 내 원
  room.click(me.id, { circleId: null, x: 1200, y: 450 });
  assert.deepEqual([circles.has(51), circles.has(52), me.stats.misses], [true, false, 0]);
  assert.equal(me.combo, 5);
  // 보호 구역 안의 내 원은 안 잡음 → 빈 곳
  circles.set(53, slowAt(53, me.color, 860, 450, now));
  room.click(me.id, { circleId: null, x: 830, y: 450 });
  assert.deepEqual([circles.has(53), me.stats.misses], [true, 1]);
  room.destroy();
});

test('자동 획득은 다시 연쇄하지 않음 (점화·연쇄 콤보·연쇄 폭발 함께)', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'ignite', tier: 3 }, { id: 'chainCombo', tier: 3 }, { id: 'chainBlast', tier: 0 }];
  me.fever = 99; me.combo = 4;
  for (let i = 0; i < 12; i++) circles.set(100 + i, slowAt(100 + i, me.color, 1000 + i * 40, 200 + (i % 3) * 40, now));
  t.mock.method(Math, 'random', () => 0);
  sent.length = 0;
  room.click(me.id, { circleId: 100, x: 1000, y: 200 });
  assert.equal(circles.size, 0, '점화 레전드: 화면의 내 원 전부');
  assert.equal(sent.filter((e) => e === 'circle:claimed').length, 12);
  room.destroy();
});

test('과충전 레전드: 피버가 끝나면 서버 틱에서 게이지 50%', () => {
  const { room, me } = playingRoom();
  me.picks = [{ id: 'overcharge', tier: 3 }];
  (room as unknown as { startAt: number }).startAt = Date.now() - 5000; // 판 시작 직후로 (시작 0이면 생성 계산이 폭주)
  me.feverUntil = Date.now() - 10; me.feverCarry = 50; me.fever = 0;
  (room as unknown as { tick(): void }).tick();
  assert.equal(me.fever, 50);
  room.destroy();
});

test('사냥꾼 레전드 막타: 화면의 내 원 전부, 파쇄 레전드: 보호막 무시, 선봉 첫 타 +v', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'hunter', tier: 3 }, { id: 'crusher', tier: 3 }, { id: 'vanguard', tier: 0 }];
  // 방어형 보스, 지금 보호막 중 (주기 3초 중 마지막 1초)
  const boss: Circle = { id: 90, kind: 'boss', boss: 'guard', angle: 0, speed: 160, r: 90, born: now - 2500, hp: 10, maxHp: 10 }; // 지금 (1200, 450), 보호막 중
  circles.set(90, boss);
  circles.set(91, slowAt(91, me.color, 1200, 300, now));
  circles.set(92, slowAt(92, me.color, 400, 600, now));
  const p0 = circlePosOf(boss, now);
  room.click(me.id, { circleId: 90, x: p0.x, y: p0.y });
  assert.equal(boss.hp, 5, '보호막 무시하고 피해 1 + 파쇄 4');
  assert.ok(me.score >= 1 + 5, '첫 타 +5');
  room.click(me.id, { circleId: 90, x: p0.x, y: p0.y });
  assert.deepEqual([circles.has(90), circles.has(91), circles.has(92)], [false, false, false]);
  room.destroy();
});

test('레이저 내성 100: 스턴 없음, 레전드는 피버 +20', () => {
  const { room, me } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'laserProof', tier: 3 }];
  room.cursor(me.id, { x: 800, y: 300 });
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1600, y: 300 } }], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
  sent.length = 0;
  priv(room).updateLaser(now);
  assert.deepEqual([me.stunUntil, me.fever, sent.includes('stun')], [0, 20, false]);
  room.destroy();
});
