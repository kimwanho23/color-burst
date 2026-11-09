import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { spawnKinds } from '../../server/src/tutorial.ts';
import { FIELD, RULES, circlePos, newPlayer, type Circle, type PlayerState, type TutorialStatus } from '../src/index.ts';

const CX = FIELD.w / 2, CY = FIELD.h / 2;
type Sent = { ev: string; d: unknown };

/** 가짜 io: 보낸 이벤트와 내용을 기록 */
function tutorialRoom(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: Sent[] = [];
  const io = { to: () => ({ emit(ev: string, d: unknown) { log.push({ ev, d }); } }), sockets: { sockets: new Map() } } as never;
  const room = new Room(io, 'T', () => {}, true, false, true);
  const a = room.join('s1', 'k1', 'A') as { id: string };
  assert.equal(room.start(a.id), null);
  const r = room as unknown as { startAt: number; tutLastSpawn: number; circles: Map<number, Circle>; tick(): void; tut: { i: number; count: number } };
  r.startAt = 0;
  const me = room.players.find((p) => p.id === a.id)!;
  const steps = () => log.filter((x) => x.ev === 'tutorial:step').map((x) => x.d as TutorialStatus);
  return { room, me, r, log, steps };
}

/** 천천히 움직여 지금 (x, y)에 있는 원 */
let nextId = 1000;
const slowAt = (kind: Circle['kind'], x: number, y: number, now = Date.now()): Circle => {
  const d = Math.hypot(x - CX, y - CY);
  return { id: nextId++, kind, angle: Math.atan2(y - CY, x - CX), speed: d / 100, r: 40, born: now - 100_000 };
};

/** 원을 하나 놓고 바로 클릭 */
function grab(room: Room, r: { circles: Map<number, Circle> }, me: PlayerState, kind: Circle['kind']) {
  const c = slowAt(kind, CX + 300, CY - 200);
  r.circles.set(c.id, c);
  const p = circlePos(c, Date.now());
  (room as unknown as { clickLog: Map<string, number[]> }).clickLog.clear(); // 같은 순간에 여러 번 눌러도 클릭 제한에 걸리지 않게
  room.click(me.id, { circleId: c.id, x: p.x, y: p.y });
  return c;
}

test('단계마다 나오는 원 종류', () => {
  const me = newPlayer('a', 'A', 0), bot = newPlayer('b', 'B', 2, true);
  assert.deepEqual(spawnKinds('own', me, null), [0]);
  assert.deepEqual(spawnKinds('combo', me, null), [0]);
  assert.deepEqual(spawnKinds('fever', me, null), [0, 'y']);
  assert.deepEqual(spawnKinds('steal', me, bot), [0, 2]);
});

test('튜토리얼 판: 1단계는 내 색 원만, 보스·아이템·무지개·황금 원 없음, 동시 최대 수', (t) => {
  const { room, me, r } = tutorialRoom(t);
  try {
    for (let k = 0; k < 20; k++) { r.tutLastSpawn = Date.now() - 5000; r.tick(); }
    assert.ok(r.circles.size > 0);
    assert.ok(r.circles.size <= RULES.tutorial.spawn.own.max);
    for (const c of r.circles.values()) assert.equal(c.kind, me.color);
  } finally { room.destroy(); }
});

test('목표를 이루면 다음 단계로, 진행 수 이벤트 전송', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  try {
    assert.deepEqual(steps()[0], { step: 'own', index: 0, total: 4, count: 0, goal: 3, done: false });
    for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
    assert.deepEqual(steps().map((s) => s.count), [0, 1, 2, 3]);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    const last = steps().at(-1)!;
    assert.deepEqual([last.step, last.index, last.count, last.goal], ['combo', 1, 0, 5]);
    assert.equal(r.circles.size, 0, '단계가 바뀌면 판을 비움');
  } finally { room.destroy(); }
});

test('목표 달성은 한 번만 처리 (대기 중 잡은 원은 다음 단계에 섞이지 않음)', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  try {
    for (let k = 0; k < 5; k++) grab(room, r, me, me.color);
    assert.equal(steps().at(-1)!.count, 3);
    t.mock.timers.tick(RULES.tutorial.nextMs * 3);
    assert.equal(r.tut.i, 1, '한 단계만 오름');
    assert.equal(r.tut.count, 0);
    assert.equal(me.combo, 0, '단계 시작 때 콤보 0');
  } finally { room.destroy(); }
});

test('헛클릭은 감점·피버 감소 없이 콤보만 끊김', (t) => {
  const { room, me } = tutorialRoom(t);
  try {
    me.combo = 4; me.score = 20; me.fever = 30;
    const misses = me.stats.misses;
    room.click(me.id, { circleId: null, x: 30, y: 30 });
    assert.deepEqual([me.combo, me.score, me.fever, me.stats.misses], [0, 20, 30, misses]);
  } finally { room.destroy(); }
});

test('콤보 단계: 5콤보면 다음, 피버 단계 시작 게이지 50·피버 꺼짐', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  try {
    for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    me.feverUntil = Date.now() + 99_999; // 콤보 단계에서 피버가 켜져 있어도
    for (let k = 0; k < 5; k++) grab(room, r, me, me.color);
    assert.equal(steps().at(-1)!.count, 5);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(steps().at(-1)!.step, 'fever');
    assert.equal(me.fever, RULES.tutorial.feverStart);
    assert.ok(me.feverUntil <= Date.now(), '피버 꺼짐');
  } finally { room.destroy(); }
});

test('피버를 터뜨리면 견제 단계, 견제 단계에서만 봇이 들어오고 봇은 원을 잡지 않음, 마지막 뒤 done', (t) => {
  const { room, me, r, steps, log } = tutorialRoom(t);
  try {
    for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    for (let k = 0; k < 5; k++) grab(room, r, me, me.color);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(room.players.length, 1, '피버 단계까지 봇 없음');
    for (let k = 0; k < 20 && steps().at(-1)!.count < 1; k++) grab(room, r, me, k % 2 ? 'y' : me.color);
    assert.equal(steps().at(-1)!.count, 1, '피버 시작');
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(steps().at(-1)!.step, 'steal');
    assert.equal(room.players.length, 2);
    const bot = room.players.find((p) => p.bot)!;
    const left = slowAt(bot.color, CX - 300, CY + 200);
    r.circles.set(left.id, left);
    for (let k = 0; k < 5; k++) r.tick();
    assert.ok(r.circles.has(left.id), '봇은 원을 잡지 않음');
    grab(room, r, me, bot.color);
    assert.ok(bot.score >= 0);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(steps().at(-1)!.done, true);
    assert.ok(!log.some((x) => x.ev === 'game:over'), '결과 화면 없음');
  } finally { room.destroy(); }
});

test('콤보 단계: 헛클릭으로 끊기면 진행 수도 0부터', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  try {
    for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    for (let k = 0; k < 4; k++) grab(room, r, me, me.color);
    assert.equal(steps().at(-1)!.count, 4);
    room.click(me.id, { circleId: null, x: 30, y: 30 });
    assert.equal(steps().at(-1)!.count, 0);
    grab(room, r, me, me.color);
    assert.equal(steps().at(-1)!.count, 1);
  } finally { room.destroy(); }
});

/** 3단계까지 넘겨 견제 단계로 */
function toSteal(t: TestContext, room: Room, r: { circles: Map<number, Circle> }, me: PlayerState, steps: () => TutorialStatus[]) {
  for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
  t.mock.timers.tick(RULES.tutorial.nextMs);
  for (let k = 0; k < 5; k++) grab(room, r, me, me.color);
  t.mock.timers.tick(RULES.tutorial.nextMs);
  for (let k = 0; k < 20 && steps().at(-1)!.count < 1; k++) grab(room, r, me, k % 2 ? 'y' : me.color);
  t.mock.timers.tick(RULES.tutorial.nextMs);
}

test('다시 접속하면 지금 단계 안내를 다시 보냄 (완료 뒤면 done)', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  try {
    grab(room, r, me, me.color);
    const n = steps().length;
    room.join('s1b', 'k1', 'A');
    assert.equal(steps().length, n + 1);
    assert.deepEqual([steps().at(-1)!.index, steps().at(-1)!.count], [0, 1]);
    toSteal(t, room, r, me, steps);
    grab(room, r, me, room.players.find((p) => p.bot)!.color);
    t.mock.timers.tick(RULES.tutorial.nextMs);
    room.join('s1c', 'k1', 'A');
    assert.equal(steps().at(-1)!.done, true);
  } finally { room.destroy(); }
});

test('일시정지: 다시 시작하면 생성 시각을 밀고, 멈춘 동안에는 단계를 넘기지 않음', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  const rr = r as unknown as { pausedAt: number; tutLastSpawn: number; finishResume(): void };
  try {
    for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
    room.pause(me.id);
    assert.ok(rr.pausedAt > 0);
    t.mock.timers.tick(RULES.tutorial.nextMs * 2);
    assert.equal(r.tut.i, 0, '멈춘 동안 단계 그대로');
    rr.pausedAt = Date.now() - 10_000;
    const before = rr.tutLastSpawn;
    rr.finishResume();
    assert.ok(rr.tutLastSpawn >= before + 10_000, '멈춘 시간만큼 생성 시각을 민다');
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(steps().at(-1)!.index, 1, '다시 시작한 뒤 단계를 넘김');
  } finally { room.destroy(); }
});

test('견제 단계: 봇은 시작 콤보가 있어 견제로 끊김, 완료 뒤에는 일시정지·클릭 무시', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  const rr = r as unknown as { pausedAt: number };
  try {
    toSteal(t, room, r, me, steps);
    const bot = room.players.find((p) => p.bot)!;
    assert.equal(bot.combo, RULES.tutorial.botCombo);
    grab(room, r, me, bot.color);
    assert.equal(bot.combo, 0, '봇 콤보가 끊김');
    t.mock.timers.tick(RULES.tutorial.nextMs);
    assert.equal(steps().at(-1)!.done, true);
    room.pause(me.id);
    assert.equal(rr.pausedAt, 0, '완료 뒤 일시정지 무시');
    const score = me.score;
    grab(room, r, me, me.color);
    assert.equal(me.score, score, '완료 뒤 클릭 무시');
  } finally { room.destroy(); }
});

test('나가면 단계 타이머가 정리됨', (t) => {
  const { room, me, r, steps } = tutorialRoom(t);
  for (let k = 0; k < 3; k++) grab(room, r, me, me.color);
  const n = steps().length;
  room.destroy();
  t.mock.timers.tick(RULES.tutorial.nextMs * 2);
  assert.equal(steps().length, n, '나간 뒤에는 이벤트 없음');
});
