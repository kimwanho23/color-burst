import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, newPlayer, pickOut, survivalCuts, survivalRanking, survivalRoundMs, type Circle, type PlayerState } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';

const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const E = RULES.survival.everyMs;

test('survivalRoundMs: 4명 90초, 3명 60초', () => {
  assert.equal(survivalRoundMs(4), 90_000);
  assert.equal(survivalRoundMs(3), 60_000);
});

test('survivalCuts: 아케이드 5라운드 기준 4명 [3,4], 3명 [4], 2명 없음', () => {
  assert.deepEqual(survivalCuts(4, 5), [3, 4]);
  assert.deepEqual(survivalCuts(3, 5), [4]);
  assert.deepEqual(survivalCuts(2, 5), []);
});

test('pickOut: 최저 점수, 같으면 낮은 콤보, 그래도 같으면 무작위', () => {
  const ps = ['a', 'b', 'c'].map((id, i) => newPlayer(id, id, i as 0));
  ps[0].score = 5; ps[1].score = 3; ps[2].score = 3;
  ps[1].combo = 4; ps[2].combo = 2;
  assert.equal(pickOut(ps).id, 'c');
  ps[1].combo = 2;
  assert.equal(pickOut(ps, () => 0).id, 'b');
  assert.equal(pickOut(ps, () => 0.99).id, 'c');
});

test('survivalRanking: 살아 있는 사람(점수순) 먼저, 그다음 늦게 탈락한 순', () => {
  const ps = ['a', 'b', 'c', 'd'].map((id, i) => newPlayer(id, id, i as 0));
  ps[0].outAt = 100; ps[1].outAt = 200; ps[2].score = 1; ps[3].score = 9;
  assert.deepEqual(survivalRanking(ps).map((p) => p.id), ['d', 'c', 'b', 'a']);
});

type SRoom = { startAt: number; endAt: number; circles: Map<number, Circle>; updateSurvival(now: number): void; phase: string; G: { roundMs: number } };
function survivalRoom(mode: 'classic' | 'arcade' = 'classic') {
  const room = new Room(fakeIo(), 'SURV', () => {});
  const a = (room.join('s1', 'k1', 'A') as { id: string }).id;
  room.setRules(a, { rules: { survival: true, mode } });
  room.fillBots = false;
  assert.equal(room.start(a), null);
  const r = room as unknown as SRoom;
  return { room, r, me: room.players.find((p) => p.id === a)! };
}

test('서바이벌: 봇 채우기가 꺼져 있어도 4명으로 시작, 클래식 판 시간은 90초', () => {
  const { room, r } = survivalRoom();
  assert.equal(room.players.length, 4);
  assert.equal(r.G.roundMs, 90_000);
  room.destroy();
});

test('서바이벌(클래식): 30초마다 꼴찌 탈락, 3초 전 경고, 1명 남으면 끝, 순위는 탈락 순서', () => {
  const { room, r, me } = survivalRoom();
  const [p1, p2, p3] = room.players.filter((p) => p.id !== me.id);
  me.score = 100; p1.score = 50; p2.score = 10; p3.score = 30;
  sent.length = 0;
  r.updateSurvival(r.startAt + E - RULES.survival.warnMs);
  assert.deepEqual(sent.filter((s) => s.ev === 'survival:warn').map((s) => (s.d as { id: string }).id), [p2.id]);
  r.updateSurvival(r.startAt + E);
  assert.ok(p2.outAt > 0);
  assert.equal(p2.outRank, 4);
  r.updateSurvival(r.startAt + 2 * E);
  assert.equal(p3.outRank, 3);
  r.updateSurvival(r.startAt + 3 * E);
  assert.equal(p1.outRank, 2);
  assert.equal(r.phase, 'lobby', '1명 남으면 게임 끝');
  const over = sent.find((s) => s.ev === 'game:over')!.d as { ranking: PlayerState[] };
  assert.deepEqual(over.ranking.map((p) => p.id), [me.id, p1.id, p3.id, p2.id]);
  room.destroy();
});

test('서바이벌: 탈락자는 클릭·자석·장판으로 점수를 얻지 못하고, 그 색 원은 더 안 나옴', () => {
  const { room, r, me } = survivalRoom();
  me.score = 0;
  for (const p of room.players) if (p.id !== me.id) p.score = 50;
  r.updateSurvival(r.startAt + E);
  assert.ok(me.outAt > 0);
  r.startAt = 0;
  const now = Date.now();
  r.circles.set(77, { id: 77, kind: me.color, angle: 0, speed: 0, r: 40, born: now - 2000 } as Circle);
  room.click(me.id, { circleId: 77, x: 550, y: 550 });
  assert.equal(me.score, 0);
  room.cursor(me.id, { x: 550, y: 550 });
  me.picks = [{ id: 'magnet', tier: 3 }];
  (room as unknown as { updatePulls(n: number): void }).updatePulls(now);
  (room as unknown as { pulls: Map<number, unknown> }).pulls.forEach((pl) => assert.notEqual((pl as { by: string }).by, me.id));
  // 스폰 색: 탈락자 색은 없음
  const kinds = (room as unknown as { spawnKinds(): number[] }).spawnKinds();
  assert.ok(!kinds.includes(me.color));
  room.destroy();
});

test('서바이벌: 일시정지하면 다음 탈락 시각도 밀림', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = survivalRoom();
  t.after(() => room.destroy());
  const r = room as unknown as SRoom & { nextCutAt: number };
  r.startAt = Date.now() - 1000;
  const before = r.nextCutAt;
  room.pause(me.id);
  t.mock.timers.tick(4000);
  room.resume(me.id);
  t.mock.timers.tick(RULES.pause.resumeMs);
  assert.equal(r.nextCutAt, before + 4000 + RULES.pause.resumeMs);
});

test('서바이벌(아케이드): 3·4라운드 뒤 꼴찌 탈락, 탈락자는 증강 선택 건너뜀', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = survivalRoom('arcade');
  t.after(() => room.destroy());
  const r = room as unknown as { round: number; endRound(): void; offers: Map<string, unknown> };
  me.score = 0;
  for (const p of room.players) if (p.id !== me.id) p.score = 50;
  r.round = 2; r.endRound();
  assert.equal(me.outAt, 0, '2라운드 뒤는 탈락 없음');
  t.mock.timers.tick(RULES.roundEndMs);
  (room as unknown as { finishPick(): void }).finishPick();
  r.round = 3; r.endRound();
  assert.ok(me.outAt > 0, '3라운드 뒤 꼴찌 탈락');
  t.mock.timers.tick(RULES.roundEndMs);
  assert.ok(!r.offers.has(me.id), '탈락자는 선택지 없음');
});

// ---------- 최종 리뷰 수정 ----------
test('서바이벌(아케이드): 랜덤 이벤트·라운드 끝 특별 카드는 탈락자를 대상으로 하지 않음', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room } = survivalRoom('arcade');
  t.after(() => room.destroy());
  const [a, b, c, d] = room.players;
  a.score = 400; b.score = 300; c.score = 50; d.score = 80;
  c.outAt = 1; d.outAt = 2;
  const r = room as unknown as { round: number; startPick(): void; G: { eventChance: number }; lastEvent: { id: string } | null };
  r.G.eventChance = 1;
  r.round = 4;
  for (let i = 0; i < 20; i++) {
    a.score = 400; b.score = 300; c.score = 50; d.score = 80;
    r.startPick();
    assert.deepEqual([c.score, d.score], [50, 80], `탈락자 점수 그대로 (${r.lastEvent?.id})`);
    assert.ok(a.score + b.score >= 0);
  }
});

test('서바이벌: 탈락하면 그 사람 색의 원 소나기가 멈춤', () => {
  const { room, me } = survivalRoom();
  const r = room as unknown as { rain: { color: number; until: number } | null; eliminate(p: PlayerState, now: number): void };
  r.rain = { color: me.color, until: Date.now() + 5000 };
  r.eliminate(me, Date.now());
  assert.equal(r.rain, null);
  room.destroy();
});
