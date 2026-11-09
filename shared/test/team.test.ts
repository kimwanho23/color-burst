import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RULES, newPlayer, ownsKind, resolveClaim, sanitizeRules, teamRanking, toGameRules, type PlayerState } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';

const sent: string[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push(ev); if (ev === 'game:over') lastOver = d; } }), sockets: { sockets: new Map() } }) as never;
let lastOver: unknown = null;

const TG = toGameRules({ ...DEFAULT_RULES, team: true });
/** a·c는 0팀, b·d는 1팀 */
function four() {
  const [a, b, c, d] = (['a', 'b', 'c', 'd'] as const).map((id, i) => newPlayer(id, id.toUpperCase(), i as 0 | 1 | 2 | 3));
  a.team = 0; c.team = 0; b.team = 1; d.team = 1;
  return { a, b, c, d, players: [a, b, c, d] as PlayerState[] };
}

test('ownsKind: 팀전이면 같은 팀 색도 내 것, 아니면 그대로', () => {
  const { a, players } = four();
  assert.equal(ownsKind(2, a, players, true), true);
  assert.equal(ownsKind(1, a, players, true), false);
  assert.equal(ownsKind(2, a, players, false), false);
  assert.equal(ownsKind('y', a, players, true), true);
  assert.equal(ownsKind(0, a, players, false), true);
});

test('팀전 claim: 같은 팀 색은 own(내 색 점수·게이지), 표적·견제 없음', () => {
  const { a, c, players } = four();
  c.combo = 7;
  const r = resolveClaim(a, 2, players, 1e6, TG, { rand: () => 0.99 });
  assert.equal(r.type, 'own');
  assert.equal(r.gained, RULES.points.own);
  assert.equal(r.marked, false);
  assert.equal(c.combo, 7, '팀원 콤보는 그대로');
  assert.ok(a.fever > 0);
});

test('팀전 claim: 상대 팀 색은 견제, 상대 팀 표적은 반격', () => {
  const { a, b, players } = four();
  const r = resolveClaim(a, 1, players, 1e6, TG, { rand: () => 0.99 });
  assert.equal(r.type, 'steal');
  b.markedUntil = 2e6;
  const r2 = resolveClaim(a, 1, players, 1e6, TG, { rand: () => 0.99 });
  assert.equal(r2.type, 'counter');
});

test('teamRanking: 합으로, 같으면 팀 최고 개인 점수', () => {
  const { a, b, c, d, players } = four();
  a.score = 10; c.score = 10; b.score = 15; d.score = 5;
  const r = teamRanking(players);
  assert.deepEqual(r.map((t) => [t.team, t.score, t.best]), [[1, 20, 15], [0, 20, 10]]);
  assert.deepEqual(r[0].ids.sort(), ['b', 'd']);
});

test('sanitizeRules: 팀전과 서바이벌을 같이 켜면 팀전만', () => {
  const r = sanitizeRules(DEFAULT_RULES, { team: true, survival: true });
  assert.deepEqual([r.team, r.survival], [true, false]);
  assert.deepEqual([DEFAULT_RULES.team, DEFAULT_RULES.survival], [false, false]);
});

function teamRoom() {
  const room = new Room(fakeIo(), 'TEAM', () => {});
  const ids = ['A', 'B', 'C'].map((n, i) => (room.join(`s${i}`, `k${i}`, n) as { id: string }).id);
  room.setRules(ids[0], { rules: { team: true } });
  room.fillBots = false;
  for (const id of ids.slice(1)) room.setReady(id, true);
  return { room, ids, P: (id: string) => room.players.find((p) => p.id === id)! };
}

test('팀전 방: 들어온 순서대로 0·1·0, 팀 바꾸기는 한 팀 2명을 넘으면 거절', () => {
  const { room, ids, P } = teamRoom();
  assert.deepEqual(ids.map((id) => P(id).team), [0, 1, 0]);
  room.setTeam(ids[1], 0);
  assert.equal(P(ids[1]).team, 1, '0팀이 이미 2명');
  room.setTeam(ids[2], 1);
  assert.equal(P(ids[2]).team, 1);
  room.destroy();
});

test('팀전 방: 봇 채우기가 꺼져 있어도 4명이 되게 채우고 팀은 2:2', () => {
  const { room, ids } = teamRoom();
  assert.equal(room.start(ids[0]), null);
  assert.equal(room.players.length, 4);
  assert.deepEqual([0, 1].map((t) => room.players.filter((p) => p.team === t).length), [2, 2]);
  room.destroy();
});

test('팀전 방: 게임이 끝나면 이긴 팀 사람에게 1승, game:over에 teams', () => {
  const { room, ids, P } = teamRoom();
  assert.equal(room.start(ids[0]), null);
  // 0팀(A·C) 승리
  P(ids[0]).score = 50; P(ids[2]).score = 10;
  for (const p of room.players) if (p.team === 1) p.score = 20;
  (room as unknown as { end(): void }).end();
  const over = lastOver as { teams: { team: number; score: number }[]; wins: Record<string, number> };
  assert.equal(over.teams[0].team, 0);
  assert.equal(over.teams[0].score, 60);
  assert.equal(over.wins[ids[0]], 1);
  assert.equal(over.wins[ids[2]], 1);
  assert.equal(over.wins[ids[1]] ?? 0, 0);
  room.destroy();
});

// ---------- 최종 리뷰 수정 ----------
import { applyItem } from '../src/items.ts';
import { addFever } from '../src/index.ts';
test('팀전: 방해 아이템·1등 저격·방해 전파는 같은 팀에게 걸리지 않음', () => {
  const { a, b, c, d, players } = four();
  c.score = 100; b.score = 50; d.score = 10;
  applyItem(a, 'blind', 1000, TG, players);
  assert.ok(!(c.debuffs.blind ?? 0), '팀원은 시야 방해 없음');
  assert.ok((b.debuffs.blind ?? 0) > 1000 && (d.debuffs.blind ?? 0) > 1000);
  const r = applyItem(a, 'snipe', 1000, TG, players) as { target: string | null };
  assert.equal(r.target, 'b', '1등(팀원 c)이 아니라 상대 팀 1등');
  a.picks = [{ id: 'jammer', tier: 3 }];
  addFever(a, 200, 2000, TG, players, true);
  assert.equal(c.blurUntil, 0, '팀원은 흐려지지 않음');
  assert.ok(b.blurUntil > 2000);
});
