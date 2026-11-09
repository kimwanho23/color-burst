import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { FIELD, RULES, blockedAt as blockedAtPub, circlePos as circlePosOf, isCurse, isSpecial, type Circle, type MapPattern, type Pick } from '../src/index.ts';

/** 소켓 없이 방을 돌리기 위한 가짜 io (보낸 이벤트 이름만 기록) */
const sent: string[] = [];
/** 판 중앙 (예전 1600×900 판의 (800, 450) 자리) */
const CX = FIELD.w / 2, CY = FIELD.h / 2;
const fakeIo = () => ({ to: () => ({ emit(ev: string) { sent.push(ev); } }), sockets: { sockets: new Map() } }) as never;

/** 방장이 아닌 사람을 모두 준비시킨 뒤 시작 (대기실 준비 규칙) */
function startReady(room: Room, hostId: string) {
  for (const p of room.players) if (!p.bot && p.id !== hostId) room.setReady(p.id, true);
  return room.start(hostId);
}

function playingRoom() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  assert.equal(startReady(room, a.id), null);
  const r = room as unknown as { startAt: number; circles: Map<number, Circle> };
  r.startAt = 0;
  return { room, me: room.players.find((p) => p.id === a.id)!, circles: r.circles };
}

test('이미 가져간 원을 늦게 누르면 거절만 하고 빈 곳 페널티는 없다', () => {
  const { room, me } = playingRoom();
  me.combo = 12; me.fever = 40;
  room.click(me.id, { circleId: 999, x: 550, y: 550 });
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
  room.click(me.id, { circleId: 1, x: 850, y: 550 });
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
  assert.equal(startReady(room, a.id), null);
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
  const q = { x: CX + Math.cos(2) * 300, y: CY + Math.sin(2) * 300 };
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
  room.click(me.id, { circleId: 50, x: 850, y: 550 });
  assert.equal(circles.has(50), false);
  me.combo = 7;
  room.click(me.id, { circleId: null, x: -240, y: 110 });
  assert.deepEqual([me.combo, me.stats.misses], [7, 0]);
  // 1초가 지나면 다시 페널티
  (room as unknown as { bossKilledAt: number }).bossKilledAt = Date.now() - 1001;
  room.click(me.id, { circleId: null, x: -240, y: 110 });
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
  assert.equal(startReady(room, a.id), null);
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
  room.click(me.id, { circleId: 60, x: CX + 300, y: CY });
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
  room.click(me.id, { circleId: 61, x: CX + 300, y: CY });
  assert.equal(me.score, 18);
  room.click(me.id, { circleId: 61, x: CX + 300, y: CY });
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
  room.click(me.id, { circleId: null, x: -240, y: 110 });
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
  const d = Math.hypot(x - CX, y - CY);
  return { id, kind, angle: Math.atan2(y - CY, x - CX), speed: d / 100, r: 40, born: now - 100_000 };
};

test('스턴 중에는 빈 곳·원 클릭 모두 무시', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.stunUntil = now + 1000; me.combo = 5;
  circles.set(70, slowAt(70, 0, 950, 550, now));
  room.click(me.id, { circleId: null, x: -240, y: 110 });
  room.click(me.id, { circleId: 70, x: 950, y: 550 });
  assert.deepEqual([me.combo, me.stats.misses, circles.has(70)], [5, 0, true]);
  room.destroy();
});

test('레이저: 선 위에 커서가 있는 사람만 1.5초 스턴, 한 레이저에 한 번', () => {
  const { room, me } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  room.cursor(me.id, { x: 550, y: 400 });
  room.cursor(other.id, { x: 550, y: 700 });
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1350, y: 400 } }], at: now - 10, hit: new Set() }];
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
  room.cursor(me.id, { x: 550, y: 400 });
  t.mock.timers.tick(600);
  const now = Date.now();
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1350, y: 400 } }], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
  priv(room).updateLaser(now);
  assert.equal(me.stunUntil, 0);
  room.destroy();
});

test('자석: 커서 근처 내 원을 1초에 2개까지(레전드) 끌어와 0.4초 뒤 잡는다(점수 70%), 끌리는 원은 남이 못 잡음', () => {
  const { room, me, circles } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  me.picks = [{ id: 'magnet', tier: 3 }]; // 반경 180, 1초 2개
  const now = Date.now();
  room.cursor(me.id, { x: CX + 300, y: CY });
  for (const [id, x] of [[81, CX + 320], [82, CX + 340], [83, CX + 280]] as const) circles.set(id, slowAt(id, me.color, x, CY, now));
  sent.length = 0;
  priv(room).updatePulls(now);
  assert.equal(sent.filter((e) => e === 'circle:pull').length, 2);
  // 가장 가까운 81(20)과 83(20) 중 둘이 끌림 → 82는 남음
  room.click(other.id, { circleId: 81, x: CX + 320, y: CY });
  assert.equal(other.score, 0);
  priv(room).updatePulls(now + 300);
  assert.equal(me.score, 0); // 아직 끌려오는 중 (0.4초)
  priv(room).updatePulls(now + 450);
  assert.equal(me.score, 8); // 원 2개 × round(3점 × 사이 구역 ×2 × 70%) = 2 × 4
  assert.equal(me.combo, 0); // 자석은 콤보를 올리지 않음
  assert.equal(circles.has(82), true);
  // 1.1초 뒤에도 커서를 계속 움직이고 있다고 본다 (커서가 오래되면 끌지 않음)
  (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors.set(me.id, { x: CX + 300, y: CY, at: now + 1100 });
  priv(room).updatePulls(now + 1100);
  assert.equal(sent.filter((e) => e === 'circle:pull').length, 3);
  room.destroy();
});

test('자석: 스턴 중이거나 커서가 오래되면 끌지 않는다', () => {
  const { room, me, circles } = playingRoom();
  me.picks = [{ id: 'magnet', tier: 0 }];
  const now = Date.now();
  circles.set(91, slowAt(91, me.color, 970, 550, now));
  room.cursor(me.id, { x: 950, y: 550 });
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
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const at = Date.now() + 500;
  priv(room).lasers = [{ lines: [lineAB], at, hit: new Set() }, { lines: [lineAB], at: at + 700, hit: new Set() }];
  const host = priv(room).hostId;
  room.pause(host);
  t.mock.timers.tick(2000);
  room.resume(host);
  // 풀면 3초 카운트다운 뒤에 다시 시작: 그동안도 멈춰 있던 시간
  t.mock.timers.tick(RULES.pause.resumeMs);
  const d = 2000 + RULES.pause.resumeMs;
  assert.deepEqual(priv(room).lasers.map((l) => l.at), [at + d, at + 700 + d]);
  room.destroy();
});

test('라운드가 끝날 때 끌려오던 원은 끄는 사람이 잡은 것으로 처리', (t) => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { rules: { mode: 'arcade' } });
  assert.equal(startReady(room, a.id), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const me = room.players.find((p) => p.id === a.id)!;
  const r = room as unknown as { circles: Map<number, Circle>; pulls: Map<number, unknown>; endRound(): void; startAt: number };
  r.startAt = 0;
  const now = Date.now();
  r.circles.set(95, slowAt(95, me.color, CX + 300, CY, now));
  r.pulls.set(95, { circleId: 95, by: me.id, from: { x: CX + 300, y: CY }, at: now, ms: 250 });
  r.endRound();
  assert.equal(me.score, 4); // round(3점 × 사이 구역 ×2 × 자석 70%) (가운데에서 300)
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
  room.click(me.id, { circleId: 1, x: 850, y: 550 });
  assert.deepEqual(priv(room).lasers.map((l) => l.at), [at + RULES.items.freezeMs, now - 50]);
  room.destroy();
});

test('봇은 남의 자석에 끌려가는 원을 후보에서 뺀다', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(96, slowAt(96, 'y', 950, 550, now));
  circles.set(97, slowAt(97, 'y', 150, 550, now));
  (room as unknown as { pulls: Map<number, unknown> }).pulls.set(96, { circleId: 96, by: me.id, from: { x: 950, y: 550 }, at: now, ms: 250 });
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
    circles.set(98, slowAt(98, 'y', 950, 550, now));
    room.cursor(me.id, { x: 960, y: 550 }); room.cursor(other.id, { x: 940, y: 550 });
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
  room.cursor(me.id, { x: -150, y: 200 });
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
  room.click(me.id, { circleId: 1, x: 850, y: 550 });
  assert.ok(other.stunUntil > now);
  assert.equal(other.combo, 0);
  assert.equal(sent.filter((e) => e === 'stun').length, 1);
  room.destroy();
});

/** 가운데에서 오른쪽으로 400 떨어져 멈춰 있는 이동형 보스 (반지름 60, 오오라 140) */
const runnerAt = (now: number): Circle => ({ id: 77, kind: 'boss', boss: 'runner', angle: 0, speed: 0.004, r: 60, born: now - 100_000_000, hp: 10, maxHp: 10 });

test('오오라: 고리 안이면 들어갈 때 바로, 그 뒤 1초마다 피버 게이지 −15·콤보 70%. 점수는 그대로, 몸통 안은 없음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.score = 5; me.fever = 50; me.combo = 10;
  const cursors = (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  const r = room as unknown as { updateAura(now: number): void };
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now });
  r.updateAura(now);
  assert.deepEqual([me.score, me.fever, me.combo], [5, 35, 7]);
  r.updateAura(now + 500);
  assert.deepEqual([me.fever, me.combo], [35, 7]);
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now + 1000 });
  r.updateAura(now + 1000);
  assert.deepEqual([me.fever, me.combo], [20, 4]);
  cursors.set(me.id, { x: pos.x + 10, y: pos.y, at: now + 2000 });
  r.updateAura(now + 2000);
  assert.deepEqual([me.fever, me.combo], [20, 4]);
  room.destroy();
});

test('오오라: 피버 중이면 들어갈 때 한 번만 남은 피버 시간 절반', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.feverUntil = now + 6000;
  const cursors = (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  const r = room as unknown as { updateAura(now: number): void };
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now });
  r.updateAura(now);
  assert.equal(me.feverUntil, now + 3000);
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now + 1000 });
  r.updateAura(now + 1000);
  assert.equal(me.feverUntil, now + 3000);
  room.destroy();
});

test('오오라를 클릭하면 아무 일 없음 (감점·헛클릭 아님)', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.score = 5; me.combo = 3;
  room.click(me.id, { circleId: null, x: pos.x + 100, y: pos.y });
  assert.deepEqual([me.score, me.combo, me.stats.misses], [5, 3, 0]);
  room.destroy();
});

test('카오스 방: 아이템 원 확률 3배', () => {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { preset: 'chaos' });
  assert.equal(startReady(room, a.id), null);
  const opts = (room as unknown as { spawnOpts(now: number): { itemChance?: number } }).spawnOpts(Date.now());
  assert.ok(Math.abs(opts.itemChance! - RULES.items.chance * 3) < 1e-12);
  room.destroy();
});

// ---------- 레이저 볼리 ----------
test('여러 줄·겹친 볼리에도 스턴은 한 번, 스턴 중인 사람은 안 늘어남', () => {
  const { room, me } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  room.cursor(me.id, { x: 550, y: 400 });
  room.cursor(other.id, { x: 150, y: 400 });
  other.stunUntil = now + 2000; // 저격 스턴 중
  const h = { a: { x: 0, y: 300 }, b: { x: 1350, y: 400 } }, v = { a: { x: 550, y: 0 }, b: { x: 550, y: 1000 } };
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
  assert.equal(startReady(room, a.id), null);
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
  circles.set(81, slowAt(81, me.color, CX + 500, CY, now));
  room.click(me.id, { circleId: 81, x: CX + 500, y: CY });
  assert.equal(me.score, 9, '가장자리 클릭 3×3');
  circles.set(82, slowAt(82, me.color, CX + 100, CY, now));
  room.click(me.id, { circleId: 82, x: CX + 100, y: CY });
  assert.equal(me.score, 12, '중앙 3×1');
  const c = slowAt(83, me.color, CX + 500, CY, now);
  circles.set(83, c);
  (room as unknown as { claim(p: unknown, c: Circle, now: number, via: string, quiet: boolean): void }).claim(me, c, now, 'blast', true);
  assert.equal(me.score, 21, '폭죽도 가장자리 3×3');
  room.destroy();
});

test('황금 원은 직접 클릭으로만, 다른 원처럼 배율 (피버·아이템·구역)', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  const gold = (id: number): Circle => ({ id, kind: 'gold', angle: 0, speed: 7000, r: 22, born: now - 100 }); // 지금 오른쪽 벽에서 튕겨 (906, 550): 사이 구역
  me.feverUntil = now + 5000; me.buffs.double = now + 5000; me.combo = 4; me.fever = 30;
  circles.set(91, gold(91));
  sent.length = 0;
  room.click(me.id, { circleId: 91, x: 906, y: 550 });
  // 20 × 피버 3 × 점수 2배 2 × 사이 구역 2 = 240, 콤보·게이지 그대로
  assert.deepEqual([me.score, me.combo, me.fever, circles.has(91)], [240, 4, 30, false]);
  assert.deepEqual([me.stats.src.gold, me.stats.src.fever], [240, 240]); // 점수 출처: 황금 원 (피버 중)
  assert.ok(sent.includes('gold:got'));
  // 넓은 손 범위 안이어도 안 잡힘
  circles.set(92, gold(92));
  me.buffs.wideHand = now + 5000;
  room.click(me.id, { circleId: null, x: 896, y: 550 });
  assert.equal(circles.has(92), true);
  // 필드 클리어로도 안 잡힘
  circles.set(1, { id: 1, kind: 'item', itemTier: 2, angle: 0, speed: 300, r: 34, born: now - 1000 });
  t.mock.method(Math, 'random', () => 0.5); // 전설 중 필드 클리어
  room.click(me.id, { circleId: 1, x: 850, y: 550 });
  assert.equal(circles.has(92), true);
  assert.equal(me.score, 240);
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
  assert.equal(startReady(room, a.id), null);
  const me = room.players.find((p) => p.id === a.id)!, other = room.players.find((p) => p.id === b.id)!;
  return { room, me, other, r: room as unknown as PickPriv };
}
/** k라운드가 끝난 뒤 선택을 연다 */
const openPick = (r: PickPriv, round: number) => { r.round = round; r.roundPhase = 'pick'; r.startPick(); };

test('두 장 선택: 하나 고르면 새 카드 3장과 need 1을 다시 보냄 (같은 규칙, 이벤트 선물은 첫 번째만)', () => {
  const { room, me, r } = arcadeRoom();
  openPick(r, 3);
  const o = r.offers.get(me.id)! as ReturnType<PickPriv['offers']['get']> & { extra: { gift: boolean; curse: boolean } };
  o.extra = { gift: true, curse: false };
  assert.deepEqual([o.need, o.options.length], [2, 3]);
  const first = o.options;
  sent.length = 0;
  room.choose(me.id, 0);
  assert.deepEqual([o.need, o.options.length, o.chosen, me.picks.length], [1, 3, false, 1]);
  assert.notEqual(o.options, first, '새로 뽑은 카드');
  assert.ok(o.options.every((c) => c.tier >= 1 || isCurse(c.id)), '3라운드 뒤는 노말 제외 그대로');
  assert.equal(o.extra.gift, false);
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
  assert.equal(startReady(room, a.id), null);
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
  circles.set(71, slowAt(71, me.color, 950, 550, now));
  circles.set(72, slowAt(72, me.color, 1010, 550, now));
  circles.set(73, slowAt(73, me.color, 150, 550, now));
  t.mock.method(Math, 'random', () => 0);
  room.click(me.id, { circleId: 71, x: 950, y: 550 });
  assert.deepEqual([circles.has(71), circles.has(72), circles.has(73)], [false, false, true]);
  room.destroy();
});

// ---------- 3-1 리뷰 수정 ----------
test('역전 배율: 꼴찌를 벗어났다가 다시 꼴찌가 돼도 그 라운드에는 다시 안 켜짐', () => {
  const { room, me, circles } = playingRoom();
  const other = room.players.find((p) => p.id !== me.id)!;
  const now = Date.now();
  me.score = 100; other.score = 105; me.comeback = true;
  circles.set(61, slowAt(61, me.color, 1250, 550, now));
  room.click(me.id, { circleId: 61, x: 1250, y: 550 }); // 가장자리 9 × 1.1 = 10 → 110, 꼴찌 탈출
  me.score = 110; other.score = 120; // 다른 사람이 다시 앞질러 다시 꼴찌
  circles.set(62, slowAt(62, me.color, 1250, 550, now));
  room.click(me.id, { circleId: 62, x: 1250, y: 550 });
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
  circles.set(51, slowAt(51, (me.color + 1) % 4 as 0, CX + 430, CY, now)); // 남의 색 (더 가까움)
  circles.set(52, slowAt(52, me.color, 1020, 550, now)); // 내 원
  room.click(me.id, { circleId: null, x: 950, y: 550 });
  assert.deepEqual([circles.has(51), circles.has(52), me.stats.misses], [true, false, 0]);
  assert.equal(me.combo, 5);
  // 보호 구역 안의 내 원은 안 잡음 → 빈 곳
  circles.set(53, slowAt(53, me.color, 610, 550, now));
  room.click(me.id, { circleId: null, x: 580, y: 550 });
  assert.deepEqual([circles.has(53), me.stats.misses], [true, 1]);
  room.destroy();
});

test('자동 획득은 다시 연쇄하지 않음 (점화·연쇄 콤보·연쇄 폭발 함께)', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'ignite', tier: 3 }, { id: 'chainCombo', tier: 3 }, { id: 'chainBlast', tier: 0 }];
  me.fever = 99; me.combo = 4;
  for (let i = 0; i < 12; i++) circles.set(100 + i, slowAt(100 + i, me.color, 750 + i * 25, 300 + (i % 3) * 40, now));
  t.mock.method(Math, 'random', () => 0);
  sent.length = 0;
  room.click(me.id, { circleId: 100, x: 750, y: 300 });
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
  circles.set(91, slowAt(91, me.color, 950, 400, now));
  circles.set(92, slowAt(92, me.color, 150, 700, now));
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
  room.cursor(me.id, { x: 550, y: 400 });
  priv(room).lasers = [{ lines: [{ a: { x: 0, y: 300 }, b: { x: 1350, y: 400 } }], at: now - 10, hit: new Set() }];
  priv(room).nextLaserAt = Infinity;
  sent.length = 0;
  priv(room).updateLaser(now);
  assert.deepEqual([me.stunUntil, me.fever, sent.includes('stun')], [0, 20, false]);
  room.destroy();
});

// ---------- 3-2 리뷰 수정 (서버) ----------
test('헛손질 보정은 지연 보정 위치로 판정 (0.1초 전 자리를 눌러도 잡음)', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'missSave', tier: 0 }]; // 반경 40
  // 오른쪽으로 초당 1000: 지금 (1300, 450), 0.1초 전 (1200, 450)
  circles.set(41, { id: 41, kind: me.color, angle: 0, speed: 1000, r: 40, born: now - 500 });
  room.click(me.id, { circleId: null, x: 950, y: 550 });
  assert.equal(circles.has(41), false);
  room.destroy();
});

test('잭팟 레전드는 보스 타격에도 ×2~×5 (보스도 점수 구역 배율)', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  me.picks = [{ id: 'jackpot', tier: 3 }, { id: 'hammer', tier: 2 }]; // 타격 1 + 3 = 4
  const boss: Circle = { id: 95, kind: 'boss', angle: 0, speed: 160, r: 90, born: now - 2500, hp: 10, maxHp: 10 };
  circles.set(95, boss);
  t.mock.method(Math, 'random', () => 0.2); // 잭팟 터짐(0.2 < 0.3), 첫 배율 (일반 1.5, 레전드 2)
  const p0 = circlePosOf(boss, now);
  room.click(me.id, { circleId: 95, x: p0.x, y: p0.y });
  assert.equal(me.score, 24); // 타격 4 × 피해 1 × 가장자리 ×3 × 잭팟 ×2
  room.destroy();
});

// ---------- 일시정지 규칙 ----------
type PauseState = { pausedAt: number; resumeAt: number; endAt: number; canPause(id: string): boolean; canResume(id: string): boolean };
const ps = (room: Room) => room as unknown as PauseState;

test('일시정지: 사람마다 3번, 누구나 풀고, 풀면 3초 카운트다운 뒤 시작', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  const other = room.players.find((p) => p.id !== me.id)!;
  room.pause(me.id);
  assert.equal(me.pausesLeft, RULES.pause.perGame - 1);
  room.resume(other.id); // 방장이 아니어도 풂
  assert.ok(ps(room).pausedAt > 0 && ps(room).resumeAt > 0, '카운트다운 중에는 아직 멈춰 있음');
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.deepEqual([ps(room).pausedAt, ps(room).resumeAt], [0, 0]);
  for (let i = 0; i < RULES.pause.perGame - 1; i++) { room.pause(me.id); room.resume(me.id); t.mock.timers.tick(RULES.pause.resumeMs); }
  assert.equal(me.pausesLeft, 0);
  room.pause(me.id);
  assert.equal(ps(room).pausedAt, 0, '다 쓰면 못 멈춤');
  room.pause(other.id);
  assert.ok(ps(room).pausedAt > 0, '다른 사람은 자기 횟수로 멈춤');
  room.destroy();
});

test('일시정지: 30초가 지나면 저절로 풀리고 카운트다운 뒤 시작', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  room.pause(me.id);
  t.mock.timers.tick(RULES.pause.maxMs - 1);
  assert.equal(ps(room).resumeAt, 0);
  t.mock.timers.tick(1);
  assert.ok(ps(room).resumeAt > 0);
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.equal(ps(room).pausedAt, 0);
  room.destroy();
});

test('일시정지: 카운트다운 중에 또 풀거나 멈춰도 시간이 한 번만 밀림', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  const other = room.players.find((p) => p.id !== me.id)!;
  const endBefore = ps(room).endAt;
  room.pause(me.id);
  t.mock.timers.tick(1000);
  room.resume(me.id); room.resume(other.id); room.pause(other.id);
  assert.equal(other.pausesLeft, RULES.pause.perGame, '카운트다운 중 멈춤은 무시, 횟수도 안 씀');
  // 모의 타이머는 한 번에 넘기면 콜백 안의 Date.now()가 끝 시각이라 나눠서 넘긴다
  t.mock.timers.tick(RULES.pause.resumeMs);
  t.mock.timers.tick(RULES.pause.maxMs);
  assert.equal(ps(room).endAt, endBefore + 1000 + RULES.pause.resumeMs);
  room.destroy();
});

test('일시정지: 멈춘 사람이 방을 나가도 30초 자동 재개는 그대로', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.join('s3', 'k3', 'C');
  room.fillBots = false;
  t.after(() => room.destroy());
  assert.equal(startReady(room, a.id), null);
  room.pause(a.id);
  room.leave(a.id, 's1');
  t.mock.timers.tick(RULES.pause.maxMs);
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.equal(ps(room).pausedAt, 0);
  room.destroy();
});

test('혼자 하기 일시정지: 횟수가 줄지 않고 30초가 지나도 안 풀림, 봇은 못 멈춤', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const room = new Room(fakeIo(), 'SOLO', () => {}, true);
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  assert.equal(startReady(room, a.id), null);
  const me = room.players.find((p) => p.id === a.id)!;
  const bot = room.players.find((p) => p.bot)!;
  assert.equal(ps(room).canPause(bot.id), false);
  assert.equal(ps(room).canResume(bot.id), false);
  room.pause(me.id);
  assert.equal(me.pausesLeft, RULES.pause.perGame);
  t.mock.timers.tick(RULES.pause.maxMs * 3);
  assert.ok(ps(room).pausedAt > 0);
  room.resume(me.id);
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.equal(ps(room).pausedAt, 0);
  room.destroy();
});

test('혼자 하기: 재개 카운트다운 중에 연결이 끊기거나 다시 멈추면 카운트다운을 취소하고 멈춰 있음', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const room = new Room(fakeIo(), 'SOLO', () => {}, true);
  t.after(() => room.destroy());
  const a = room.join('s1', 'k1', 'A') as { id: string };
  assert.equal(startReady(room, a.id), null);
  room.pause(a.id);
  room.resume(a.id);
  room.disconnect(a.id, 's1');
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.ok(ps(room).pausedAt > 0, '연결이 끊긴 채로는 다시 시작하지 않음');
  assert.equal(ps(room).resumeAt, 0);
  room.join('s2', 'k1', 'A');
  room.resume(a.id);
  room.pause(a.id); // 탭을 다시 숨김
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.ok(ps(room).pausedAt > 0, '다시 멈추면 카운트다운 취소');
});

test('멀티: 카운트다운 중 다시 멈추기는 그대로 무시', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  room.pause(me.id);
  room.resume(me.id);
  room.pause(me.id);
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.equal(ps(room).pausedAt, 0);
});

// ---------- 맵 패턴 ----------
type MapPriv = {
  pattern: MapPattern | null; pendingPattern: MapPattern | null; popped: Set<number>; updatePattern(now: number): void;
  cursors: Map<string, { x: number; y: number; at: number }>; playPayload(): { pattern: MapPattern | null; popped: number[] };
  endRound(): void; startAt: number; endAt: number;
};
const mp = (room: Room) => room as unknown as MapPriv;
/** 맵 패턴 확률을 정해 시작한 방 (사람 2명) */
function mapRoom(mapPct: number, mode: 'classic' | 'arcade' = 'classic') {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  room.setRules(a.id, { rules: { mapPct, mode } });
  assert.equal(startReady(room, a.id), null);
  return { room, me: room.players.find((p) => p.id === a.id)! };
}

test('맵 패턴: 0%면 안 나옴, 100%면 라운드마다 1번 경고 후 등장·끝나면 사라짐', () => {
  const off = mapRoom(0);
  assert.equal(mp(off.room).pendingPattern, null);
  off.room.destroy();
  const { room } = mapRoom(100);
  const r = mp(room);
  const p = r.pendingPattern!;
  assert.ok(p, '100%면 반드시');
  assert.ok(p.at >= r.startAt + RULES.patterns.startMs && p.at <= r.endAt - RULES.patterns.endQuietMs);
  sent.length = 0;
  r.updatePattern(p.warnAt - 1);
  assert.equal(r.pattern, null);
  r.updatePattern(p.warnAt);
  assert.equal(r.pattern, p);
  assert.ok(sent.includes('map:warn'));
  r.updatePattern(p.until);
  assert.equal(r.pattern, null);
  room.destroy();
});

test('맵 패턴: 가시 공에 닿으면 그 공이 사라지고 1초 스턴, 사라진 공에는 다시 안 맞음', () => {
  const { room, me } = mapRoom(0);
  const r = mp(room);
  const now = Date.now();
  r.pattern = { id: 'spikes', warnAt: now - 2000, at: now - 500, until: now + 9000, balls: [{ x: 400, y: 400, vx: 0, vy: 0 }] };
  r.cursors.set(me.id, { x: 410, y: 400, at: now });
  sent.length = 0;
  r.updatePattern(now);
  assert.deepEqual([...r.popped], [0]);
  assert.equal(me.stunUntil, now + RULES.patterns.spikes.stunMs);
  assert.ok(sent.includes('map:pop') && sent.includes('stun'));
  me.stunUntil = 0;
  r.cursors.set(me.id, { x: 410, y: 400, at: now + 100 });
  r.updatePattern(now + 100);
  assert.equal(me.stunUntil, 0);
  room.destroy();
});

test('맵 패턴: 링 위험 구역이면 스턴, 풀린 뒤 1초 무적', () => {
  const { room, me } = mapRoom(0);
  const r = mp(room);
  const now = Date.now();
  r.pattern = { id: 'ring', warnAt: now - 8500, at: now - 7000, until: now + 3000 };
  const at = (t: number) => { r.cursors.set(me.id, { x: 20, y: 450, at: t }); r.updatePattern(t); };
  at(now);
  assert.equal(me.stunUntil, now + RULES.patterns.ring.stunMs);
  at(now + 1500);
  assert.equal(me.stunUntil, now + 1000, '무적 중');
  at(now + 2000);
  assert.equal(me.stunUntil, now + 3000);
  room.destroy();
});

test('맵 패턴: 벽 안을 누르면 아무 일 없음 (빈 곳 감점 없음)', () => {
  const { room, me } = mapRoom(0);
  const r = mp(room);
  (room as unknown as { startAt: number }).startAt = 0;
  const now = Date.now();
  r.pattern = { id: 'walls', warnAt: now - 2000, at: now - 500, until: now + 9000, walls: [{ x: 100, y: 100, w: 300, h: 40 }] };
  me.combo = 5;
  room.click(me.id, { circleId: null, x: 200, y: 120 });
  assert.deepEqual([me.combo, me.stats.misses], [5, 0]);
  room.click(me.id, { circleId: null, x: 200, y: 300 });
  assert.equal(me.stats.misses, 1, '벽 밖은 그대로 빈 곳');
  room.destroy();
});

test('맵 패턴: 일시정지하면 경고·등장·끝 시각이 같이 밀림', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = mapRoom(100);
  t.after(() => room.destroy());
  const r = mp(room);
  (room as unknown as { startAt: number }).startAt = Date.now() - 1000; // 게임 중 (시작 카운트다운 중이면 바로 이어 가서 밀리는 양이 다름)
  const before = r.pendingPattern!;
  room.pause(me.id);
  t.mock.timers.tick(2000);
  room.resume(me.id);
  t.mock.timers.tick(RULES.pause.resumeMs);
  const d = 2000 + RULES.pause.resumeMs;
  assert.deepEqual([r.pendingPattern!.warnAt, r.pendingPattern!.at, r.pendingPattern!.until], [before.warnAt + d, before.at + d, before.until + d]);
});

test('맵 패턴: 재접속하면 game:sync에 패턴과 사라진 공', () => {
  const { room } = mapRoom(0);
  const r = mp(room);
  const now = Date.now();
  r.pattern = { id: 'spikes', warnAt: now - 2000, at: now - 500, until: now + 9000, balls: [{ x: 400, y: 400, vx: 0, vy: 0 }, { x: 900, y: 400, vx: 0, vy: 0 }] };
  r.popped.add(1);
  const pl = r.playPayload();
  assert.equal(pl.pattern, r.pattern);
  assert.deepEqual(pl.popped, [1]);
  room.destroy();
});

test('맵 패턴: 아케이드 라운드가 끝나면 지워지고 다음 라운드로 안 넘어감', () => {
  const { room } = mapRoom(100, 'arcade');
  const r = mp(room);
  const now = Date.now();
  r.pattern = { id: 'ring', warnAt: now - 2000, at: now - 500, until: now + 9000 };
  r.popped.add(0);
  r.endRound();
  assert.deepEqual([r.pattern, r.pendingPattern, r.popped.size], [null, null, 0]);
  room.destroy();
});

test('리뷰: 오오라를 벗어났다 1초 안에 다시 들어와도 콤보 감소·피버 반감은 한 번', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.combo = 100; me.feverUntil = now + 8000;
  const cursors = (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  const r = room as unknown as { updateAura(now: number): void };
  for (let t = 0; t < 1000; t += 100) {
    const inside = (t / 100) % 2 === 0;
    cursors.set(me.id, { x: pos.x + (inside ? 100 : 400), y: pos.y, at: now + t });
    r.updateAura(now + t);
  }
  assert.equal(me.combo, 70);
  assert.equal(me.feverUntil, now + 4000);
  room.destroy();
});

test('리뷰: 회전 막대가 지연 시간 안에 막 덮친 곳의 클릭은 받아 줌', () => {
  const { room, me } = mapRoom(0);
  const r = mp(room);
  (room as unknown as { startAt: number }).startAt = 0;
  const now = Date.now();
  // 막대가 0°(가로)에서 출발: 30ms 전에는 막대 밖이던 점이 지금은 막대 안
  r.pattern = { id: 'bar', warnAt: now - 3000, at: now - 1000, until: now + 8000, bar: { cx: 800, cy: 450, a0: 0 } };
  const ang = (45 * Math.PI / 180) * (1000 / 1000), rho = 400;
  const inNow = { x: 800 + Math.cos(ang) * rho, y: 450 + Math.sin(ang) * rho - 15 };
  assert.ok(blockedAtPub(r.pattern, inNow, now));
  me.combo = 5;
  room.click(me.id, { circleId: null, x: inNow.x, y: inNow.y });
  assert.equal(me.stats.misses, 1, '막대에 계속 덮여 있던 게 아니면 평소처럼 처리 (여기선 빈 곳)');
  room.destroy();
});

test('리뷰: 철옹성이면 오오라에서도 콤보가 80%만 남음', () => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  circles.set(77, runnerAt(now));
  const pos = circlePosOf(circles.get(77)!, now);
  me.picks = (['shield', 'insurance', 'rebound'] as const).map((id) => ({ id, tier: 0 as const }));
  me.combo = 10;
  const cursors = (room as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  cursors.set(me.id, { x: pos.x + 100, y: pos.y, at: now });
  (room as unknown as { updateAura(now: number): void }).updateAura(now);
  assert.equal(me.combo, 8);
  room.destroy();
});

// ---------- 밸런스 정리 · 보스 빌드 ----------
test('2장 차례: 꼴찌의 첫 묶음엔 등급 보장, 첫 장을 고른 뒤 새 3장엔 보장 없음', (t) => {
  const { room, me, other, r } = arcadeRoom();
  t.after(() => room.destroy());
  me.score = 900; other.score = 1000; // 꼴찌지만 역전 기회(60% 미만)는 아님
  t.mock.method(Math, 'random', () => 0); // 등급은 늘 가장 낮게 (노말 제외라 레어)
  openPick(r, 4); // 4라운드 뒤: 보장 레전드, 2장
  const o = r.offers.get(me.id)!;
  const plain = (cs: Pick[]) => cs.filter((c) => !isCurse(c.id) && !isSpecial(c.id));
  assert.equal(me.comeback, false);
  assert.equal(plain(o.options).filter((c) => c.tier === 3).length, 1);
  const k = o.options.findIndex((c) => !isCurse(c.id));
  room.choose(me.id, k);
  assert.equal(o.need, 1);
  assert.ok(plain(o.options).every((c) => c.tier < 3), '두 번째 묶음은 보장 없음');
});

test('화면 밖으로 나간 보스는 독식·막타 없음, 피해 기록도 지워짐', (t) => {
  const { room, me, circles } = playingRoom();
  t.after(() => room.destroy());
  const now = Date.now();
  // 가운데 보호 구역 밖(오른쪽 300)에 거의 멈춰 있는 보스
  const b: Circle = { ...slowAt(96, 'boss', CX + 300, CY, now), boss: 'normal', r: 90, hp: 24, maxHp: 24 };
  circles.set(96, b);
  const p0 = circlePosOf(b, now);
  for (let i = 0; i < 13; i++) room.click(me.id, { circleId: 96, x: p0.x, y: p0.y });
  const hits = (room as unknown as { bossHits: Map<number, Map<string, number>> }).bossHits;
  assert.ok((hits.get(96)?.get(me.id) ?? 0) >= 12, '절반 넘게 깎음');
  const before = me.score;
  sent.length = 0;
  b.born = now - 100_000_000; b.speed = 1000; // 이미 화면 밖
  // startAt을 0으로 당겨 둔 방이라, 점수 기록·원 생성·보스 예약이 한꺼번에 몰리지 않게 막고 한 틱만 돌린다
  const tp = room as unknown as { tick(): void; nextSample: number; lastSpawn: number; bossQueue: number[]; goldQueue: number[] };
  tp.nextSample = Infinity; tp.lastSpawn = Date.now(); tp.bossQueue = []; tp.goldQueue = [];
  tp.tick();
  assert.equal(circles.has(96), false);
  assert.equal(hits.has(96), false);
  assert.ok(sent.includes('boss:escaped'));
  assert.ok(!sent.includes('boss:killed'));
  assert.equal(me.score, before);
});

/** 보낸 이벤트 이름과 내용을 함께 기록하는 가짜 io */
function payloadRoom() {
  const log: { ev: string; d: Record<string, unknown> }[] = [];
  const io = { to: () => ({ emit(ev: string, d: Record<string, unknown>) { log.push({ ev, d }); } }), sockets: { sockets: new Map() } } as never;
  const room = new Room(io, 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  const b = room.join('s2', 'k2', 'B') as { id: string };
  room.fillBots = false;
  assert.equal(startReady(room, a.id), null);
  const r = room as unknown as { startAt: number; circles: Map<number, Circle> };
  r.startAt = 0;
  const me = room.players.find((p) => p.id === a.id)!, other = room.players.find((p) => p.id === b.id)!;
  return { room, me, other, circles: r.circles, log };
}

test('보스 타격으로 피버가 터지면 알림에 feverStarted·comboBonus가 실림', (t) => {
  const { room, me, circles, log } = payloadRoom();
  t.after(() => room.destroy());
  const now = Date.now();
  const b: Circle = { ...slowAt(97, 'boss', CX + 300, CY, now), boss: 'normal', r: 90, hp: 24, maxHp: 24 };
  circles.set(97, b);
  me.fever = 99; me.combo = 9;
  const p0 = circlePosOf(b, now);
  room.click(me.id, { circleId: 97, x: p0.x, y: p0.y });
  const hit = log.find((e) => e.ev === 'boss:hit')!;
  assert.deepEqual([hit.d.feverStarted, hit.d.comboBonus], [true, true]);
});

test('막타를 못 친 사람도 독식하면 boss:killed의 solo 목록에 들어감', (t) => {
  const { room, me, other, circles, log } = payloadRoom();
  t.after(() => room.destroy());
  const now = Date.now();
  const b: Circle = { ...slowAt(98, 'boss', CX + 300, CY, now), boss: 'normal', r: 90, hp: 1, maxHp: 24 };
  circles.set(98, b);
  (room as unknown as { bossHits: Map<number, Map<string, number>> }).bossHits.set(98, new Map([[other.id, 14], [me.id, 9]]));
  const p0 = circlePosOf(b, now);
  room.click(me.id, { circleId: 98, x: p0.x, y: p0.y });
  const killed = log.find((e) => e.ev === 'boss:killed')!;
  assert.deepEqual(killed.d.solo, [other.id]);
  assert.equal(other.score, RULES.boss.solo.points * 2 + RULES.boss.mvp); // 사이 구역 ×2, 최다 타격 +5
});

// ---------- 게임 중 나가기 ----------
type LeavePriv = { bots: Map<string, unknown>; emptyTimer: unknown; resumeAt: number; round: number; roundPhase: string; offers: Map<string, { chosen: boolean }>; endRound(): void; startPick(): void; startAt: number };
const lp = (room: Room) => room as unknown as LeavePriv;

test('게임 중 나가면 그 자리를 봇이 이어받음: 점수·증강 유지, 이름 (봇), 알림', (t) => {
  const { room, me, log } = payloadRoom();
  t.after(() => room.destroy());
  me.score = 50; me.picks = [{ id: 'hammer', tier: 1 }]; me.combo = 7;
  room.leave(me.id, 's1');
  assert.deepEqual([me.bot, me.name, me.score, me.picks.length, me.combo, me.connected], [true, 'A (봇)', 50, 1, 7, true]);
  assert.ok(lp(room).bots.has(me.id));
  assert.deepEqual(log.filter((e) => e.ev === 'player:left').map((e) => e.d), [{ id: me.id, name: 'A' }]);
});

test('증강 고르는 중에 나가면 바로 무작위로 고르고, 모두 골랐으면 다음 라운드', (t) => {
  const { room, me, other, r } = arcadeRoom();
  t.after(() => room.destroy());
  openPick(r, 1);
  room.leave(other.id, 's2');
  assert.equal(other.picks.length, 1);
  assert.equal(lp(room).roundPhase, 'pick');
  room.choose(me.id, 0);
  assert.deepEqual([lp(room).roundPhase, lp(room).round], ['play', 2]);
  // 반대로 내가 먼저 고른 뒤 상대가 나가면 바로 다음 라운드
  openPick(r, 2);
  room.choose(me.id, 0);
  const b2 = room.join('s3', 'k3', 'C'); // 진행 중이라 못 들어옴
  assert.ok('error' in b2);
  room.leave(me.id, 's1');
  assert.equal(lp(room).roundPhase, 'pick'); // 상대(other)는 이미 봇이라 봇 선택 타이머를 기다림
});

test('일시정지를 건 사람이 나가면 다시 시작 카운트다운', (t) => {
  const { room, me } = payloadRoom();
  t.after(() => room.destroy());
  room.pause(me.id);
  assert.equal(lp(room).resumeAt, 0);
  room.leave(me.id, 's1');
  assert.ok(lp(room).resumeAt > Date.now());
});

test('혼자 하기에서 나가면 방이 끝남, 사람이 모두 나가면 방이 끝남(봇끼리 안 함)', (t) => {
  let ended = 0;
  const solo = new Room(fakeIo(), 'SOLO', () => { ended++; }, true);
  t.after(() => solo.destroy());
  const a = solo.join('s1', 'k1', 'A') as { id: string };
  assert.equal(solo.start(a.id), null);
  solo.leave(a.id, 's1');
  assert.equal(ended, 1);
  const { room, me, other } = payloadRoom();
  t.after(() => room.destroy());
  room.leave(me.id, 's1');
  assert.equal(lp(room).emptyTimer, null);
  room.leave(other.id, 's2');
  assert.ok(lp(room).emptyTimer, '사람이 없으면 방 종료 타이머');
});

test('연결 끊김은 봇이 되지 않고 다시 들어올 수 있음', (t) => {
  const { room, me } = payloadRoom();
  t.after(() => room.destroy());
  room.disconnect(me.id, 's1');
  assert.deepEqual([me.bot, me.connected], [false, false]);
  const back = room.join('s9', 'k1', 'A') as { id: string };
  assert.equal(back.id, me.id);
});

test('나간 사람은 같은 키로 자리를 되찾지 못함', (t) => {
  const { room, me } = payloadRoom();
  t.after(() => room.destroy());
  room.leave(me.id, 's1');
  const back = room.join('s9', 'k1', 'A');
  assert.ok('error' in back);
  assert.equal(me.bot, true);
});

test('나가기를 두 번·나간 뒤 끊김이 와도 한 번만 바뀜', (t) => {
  const { room, me, log } = payloadRoom();
  t.after(() => room.destroy());
  room.leave(me.id, 's1');
  room.leave(me.id, 's1');
  room.disconnect(me.id, 's1');
  assert.deepEqual([me.name, me.bot, me.connected], ['A (봇)', true, true]);
  assert.equal(log.filter((e) => e.ev === 'player:left').length, 1);
});

test('시작 카운트다운 중·라운드 종료 연출 중에 나가도 이어받음', (t) => {
  const { room, me } = payloadRoom();
  t.after(() => room.destroy());
  lp(room).startAt = Date.now() + 3000; // 카운트다운 중
  room.leave(me.id, 's1');
  assert.equal(me.bot, true);
  const { room: room2, me: a, other: b, r } = arcadeRoom();
  t.after(() => room2.destroy());
  lp(room2).endRound(); // 라운드 종료 연출 (선택지는 아직 없음)
  room2.leave(b.id, 's2');
  assert.equal(b.bot, true);
  lp(room2).startPick();
  assert.ok(r.offers.has(b.id) && r.offers.has(a.id));
});

test('일시정지: 시작 카운트다운 중에 멈췄다 풀면 다시 시작 카운트다운 없이 남은 시작 카운트다운을 이어 감', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  const r = room as unknown as { startAt: number; endAt: number };
  r.startAt = Date.now() + RULES.pause.resumeMs + 2000; // 시작까지 resumeMs보다 넉넉히 남음
  const end = r.endAt;
  room.pause(me.id);
  t.mock.timers.tick(4000);
  room.resume(me.id);
  assert.deepEqual([ps(room).pausedAt, ps(room).resumeAt], [0, 0], '바로 이어 감');
  assert.equal(r.startAt - Date.now(), RULES.pause.resumeMs + 2000, '남은 시작 카운트다운 그대로');
  assert.equal(r.endAt, end + 4000);
});

test('일시정지: 시작 직전에 멈췄으면 풀 때 시작까지 최소 resumeMs는 남긴다', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  const r = room as unknown as { startAt: number };
  r.startAt = Date.now() + 500;
  room.pause(me.id);
  t.mock.timers.tick(1000);
  room.resume(me.id);
  assert.equal(r.startAt - Date.now(), RULES.pause.resumeMs);
});

test('일시정지: 게임 정보에 멈춘 시각이 들어 있어 다시 접속해도 그 순간에 멈춘 화면', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  const at = Date.now();
  room.pause(me.id);
  t.mock.timers.tick(5000);
  const payload = (room as unknown as { playPayload(): { pausedAt: number } }).playPayload();
  assert.equal(payload.pausedAt, at);
});
