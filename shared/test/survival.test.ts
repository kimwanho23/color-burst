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
  t.mock.timers.tick(RULES.roundEndMs);
  assert.ok(me.outAt > 0, '3라운드 뒤 (정산이 끝난 뒤) 꼴찌 탈락');
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
  r.round = 2; // 탈락이 없는 차례 (이벤트만 본다)
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

// ---------- 리뷰 후속 ----------
import { resolveClaim, toGameRules, DEFAULT_RULES, makeBoss } from '../src/index.ts';
import { strikeBoss } from '../src/bossScore.ts';
test('탈락자 색의 남은 원: 주인 없는 원처럼 +1 (견제·반사·표적 없음, 탈락자 점수 그대로)', () => {
  const G = toGameRules({ ...DEFAULT_RULES, survival: true });
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  b.outAt = 1; b.score = 30; b.reflectLeft = 3; a.combo = 5;
  const r = resolveClaim(a, 1, [a, b], 1e6, G, { rand: () => 0.99 });
  assert.equal(r.type, 'feverSteal');
  assert.equal(r.marked, false);
  assert.equal(a.combo, 5);
  assert.equal(b.score, 30);
});

test('탈락자는 보스 독식·MVP를 받지 않음', () => {
  const G = toGameRules(DEFAULT_RULES);
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1);
  b.outAt = 1;
  const boss = makeBoss(1, 0, 2, G, () => 0.5);
  boss.hp = 1; boss.maxHp = 10;
  const hits = new Map([['b', 9]]);
  const out = strikeBoss(a, boss, hits, [a, b], 10, G, () => 0.99);
  assert.ok(out.killed);
  assert.deepEqual(out.solos, []);
  assert.equal(out.mvp, 'a');
  assert.equal(b.score, 0);
});

test('서바이벌(아케이드): 라운드 끝 정산(뒤집기 등)을 먼저 하고 그 결과로 꼴찌 탈락', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = survivalRoom('arcade');
  t.after(() => room.destroy());
  const [, b, c, d] = room.players;
  // me는 꼴찌지만 뒤집기로 1등과 차이의 20%를 받아 꼴찌를 벗어남
  me.score = 10; me.picks = [{ id: 'flip', tier: 0 }];
  b.score = 200; c.score = 40; d.score = 60;
  const r = room as unknown as { round: number; endRound(): void; G: { eventChance: number } };
  r.G.eventChance = 0;
  r.round = 3; r.endRound();
  assert.equal(me.outAt, 0, '라운드가 끝난 순간에는 아직');
  t.mock.timers.tick(RULES.roundEndMs);
  assert.equal(me.score, 10 + Math.round((200 - 10) * 0.2));
  assert.equal(me.outAt, 0, '정산 뒤 꼴찌는 c');
  assert.ok(c.outAt > 0);
});

test('서바이벌: 탈락자는 라운드 시작 보너스(시한폭탄)를 받지 않음', () => {
  const { room, me } = survivalRoom('arcade');
  me.outAt = 1; me.score = 5; me.picks = [{ id: 'timeBomb', tier: 0 }];
  (room as unknown as { beginRound(): void }).beginRound();
  assert.equal(me.score, 5);
  room.destroy();
});

test('탈락 경고: 경고한 사람이 그대로 꼴찌면 그 사람이 탈락, 3초 안에 순위가 바뀌면 다시 경고', () => {
  const { room, r, me } = survivalRoom();
  const [p1, p2, p3] = room.players.filter((p) => p.id !== me.id);
  me.score = 100; p1.score = 50; p2.score = 10; p3.score = 10; p2.combo = 0; p3.combo = 0;
  sent.length = 0;
  r.updateSurvival(r.startAt + E - RULES.survival.warnMs);
  const warned = (sent.find((s) => s.ev === 'survival:warn')!.d as { id: string }).id;
  assert.ok([p2.id, p3.id].includes(warned));
  r.updateSurvival(r.startAt + E);
  assert.equal(room.players.find((p) => p.id === warned)!.outAt > 0, true, '동점이어도 경고한 사람이 탈락');
  // 다음 경고 뒤 역전
  const other = [p2, p3].find((p) => p.id !== warned)!;
  sent.length = 0;
  r.updateSurvival(r.startAt + 2 * E - RULES.survival.warnMs);
  assert.equal((sent.find((s) => s.ev === 'survival:warn')!.d as { id: string }).id, other.id);
  other.score = 999;
  sent.length = 0;
  r.updateSurvival(r.startAt + 2 * E - 1000);
  assert.equal((sent.find((s) => s.ev === 'survival:warn')!.d as { id: string }).id, p1.id, '역전되면 다시 경고');
  room.destroy();
});

test('탈락 경고: 일시정지가 풀리면 경고를 다시 보냄', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { room, me } = survivalRoom();
  t.after(() => room.destroy());
  const r = room as unknown as SRoom & { nextCutAt: number };
  r.startAt = Date.now() - E + 2000; r.nextCutAt = r.startAt + E;
  r.updateSurvival(Date.now());
  room.pause(me.id);
  t.mock.timers.tick(5000);
  room.resume(me.id);
  sent.length = 0;
  t.mock.timers.tick(RULES.pause.resumeMs);
  r.updateSurvival(Date.now());
  assert.ok(sent.some((s) => s.ev === 'survival:warn'));
});
