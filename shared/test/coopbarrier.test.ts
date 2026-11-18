import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, type CoopFx, type CoopHitBy, type CoopItemId, type PlayerState } from '../src/index.ts';
import { Room } from '../../server/src/room.ts';
import { pointerAction } from '../../client/src/pointer.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop, B = RULES.coop.barrier;

type Run = {
  shift(delta: number): void;
  damage(p: PlayerState, by: CoopHitBy, now: number): boolean;
  applyItem(p: PlayerState, item: CoopItemId, now: number, at: { x: number; y: number }): void;
  activateBarrier(p: PlayerState, now: number): boolean;
};
type CRoom = { coop: Run; startAt: number; coopBarrier(id: string): void };
type Level = 'easy' | 'normal' | 'hard' | 'expert';

function coopRoom(level: Level = 'normal', bots = 0) {
  const room = new Room(fakeIo(), 'BARR', () => {});
  const id = (room.join('s0', 'k0', 'P0') as { id: string }).id;
  room.setRules(id, { rules: { coop: true, coopLevel: level } });
  for (let i = 0; i < bots; i++) room.addBot(id);
  sent.length = 0;
  assert.equal(room.start(id), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === id)!;
  return { room, r, me };
}
const fx = (p: PlayerState) => p.coopFx as CoopFx;
const AT = { x: 500, y: 700 };

test('수치: RULES.coop.barrier', () => {
  assert.equal(B.durationMs, 1500);
  assert.deepEqual(B.uses, { easy: 3, normal: 2, hard: 1, expert: 0 });
});

test('판 시작 횟수: 난이도별로 채우고 봇은 없음', () => {
  for (const level of ['easy', 'normal', 'hard', 'expert'] as const) {
    const { room, me } = coopRoom(level);
    assert.equal(fx(me).barrierLeft, B.uses[level], level);
    assert.equal(fx(me).barrierUntil, 0);
    room.destroy();
  }
  const { room } = coopRoom('normal', 1);
  const bot = room.players.find((p) => p.bot)!;
  assert.equal(bot.coopFx, undefined);
  room.destroy();
});

test('발동: 횟수 1 줄고 1.5초 켜짐, 켜진 중 다시 누르면 무시', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  assert.equal(r.coop.activateBarrier(me, now), true);
  assert.equal(fx(me).barrierLeft, 1);
  assert.equal(fx(me).barrierUntil, now + 1500);
  assert.equal(r.coop.activateBarrier(me, now + 100), false);
  assert.equal(fx(me).barrierLeft, 1);
  assert.equal(fx(me).barrierUntil, now + 1500);
  // 끝난 뒤 쿨타임(2초) 동안은 거부, 그 뒤 다시 쓸 수 있고, 0회면 거부
  assert.equal(B.cooldownMs, 2000);
  assert.equal(r.coop.activateBarrier(me, now + 1500), false, '끝난 직후 연타');
  assert.equal(r.coop.activateBarrier(me, now + 1500 + 1999), false, '쿨타임 중');
  assert.equal(fx(me).barrierLeft, 1);
  assert.equal(r.coop.activateBarrier(me, now + 1500 + 2000), true);
  assert.equal(fx(me).barrierLeft, 0);
  assert.equal(r.coop.activateBarrier(me, now + 9000), false);
  assert.equal(fx(me).barrierLeft, 0);
  room.destroy();
});

test('거부: 기절·탈락·엑스퍼트', () => {
  const a = coopRoom();
  const now = a.r.startAt + 5000;
  a.me.stunUntil = now + 1000;
  assert.equal(a.r.coop.activateBarrier(a.me, now), false, '기절');
  a.me.stunUntil = 0; a.me.outAt = now; a.me.hp = 0;
  assert.equal(a.r.coop.activateBarrier(a.me, now), false, '탈락');
  assert.equal(fx(a.me).barrierLeft, 2);
  a.room.destroy();
  const b = coopRoom('expert');
  assert.equal(b.r.coop.activateBarrier(b.me, b.r.startAt + 5000), false, '엑스퍼트 0회');
  b.room.destroy();
});

test('막기: 피하는 공격은 피해·무적 없이 막고 보호막으로 막았다고 알림', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  for (const by of ['bullet', 'wall', 'laser', 'beam', 'slam', 'seal', 'safe', 'homing'] as const) {
    sent.length = 0;
    assert.equal(r.coop.damage(me, by, now + 500), true, by);
    assert.equal(me.hp, C.hpMax, by);
    assert.equal(me.immuneUntil, 0, by);
    assert.equal(me.stunUntil, 0, by);
    assert.deepEqual(sent.find((s) => s.ev === 'coop:hit')?.d, { playerId: me.id, by, hp: C.hpMax, dmg: 0, immuneUntil: 0, blocked: true, barrier: true });
  }
  room.destroy();
});

test('관통: 압살·분노·큰 구체 놓침은 보호막을 뚫는다', () => {
  for (const by of ['crush', 'rage', 'threat'] as const) {
    const { room, r, me } = coopRoom();
    const now = r.startAt + 5000;
    r.coop.activateBarrier(me, now);
    assert.equal(r.coop.damage(me, by, now + 500), true, by);
    assert.equal(me.hp, Math.max(0, C.hpMax - C.levels.normal.hurt[by]), by);
    room.destroy();
  }
});

test('아이템 방어막은 보호막이 켜진 동안 소모되지 않는다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.applyItem(me, 'guard', now, AT);
  r.coop.activateBarrier(me, now);
  assert.equal(r.coop.damage(me, 'bullet', now + 500), true);
  assert.equal(fx(me).guardUntil, now + C.items.guardMs);
  // 보호막이 끝난 뒤에는 방어막이 막고 사라진다
  assert.equal(r.coop.damage(me, 'bullet', now + 1500 + B.lagMs), true);
  assert.equal(me.hp, C.hpMax);
  assert.equal(fx(me).guardUntil, 0);
  room.destroy();
});

test('종료: 화면에서 끝나기 직전에 맞은 탄은 신고 지연(lagMs) 안이면 막고, 그 뒤에는 피해를 받는다', () => {
  assert.equal(B.lagMs, 150);
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  assert.equal(r.coop.damage(me, 'bullet', now + 1500 + 100), true);
  assert.equal(me.hp, C.hpMax, '지연 안의 신고는 막음');
  assert.equal(r.coop.damage(me, 'bullet', now + 1500 + B.lagMs), true);
  assert.equal(me.hp, C.hpMax - C.levels.normal.hurt.bullet);
  room.destroy();
});

test('일시정지: 종료 시각을 밀고 플레이어 상태를 다시 보낸다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.activateBarrier(me, now);
  sent.length = 0;
  r.coop.shift(5000);
  assert.equal(fx(me).barrierUntil, now + 1500 + 5000);
  assert.ok(sent.some((s) => s.ev === 'players'), 'players 전송');
  room.destroy();
});

test('일시정지: 쿨타임까지 끝난 보호막은 밀지도 다시 보내지도 않는다', () => {
  const { room, r, me } = coopRoom();
  const now = Date.now() - 10_000;
  r.coop.activateBarrier(me, now);
  sent.length = 0;
  r.coop.shift(5000);
  assert.equal(fx(me).barrierUntil, now + 1500, '그대로');
  assert.ok(!sent.some((s) => s.ev === 'players'), 'players 전송 없음');
  room.destroy();
});

test('일시정지: 쿨타임 중이면 쿨타임도 함께 밀린다', () => {
  const { room, r, me } = coopRoom();
  const now = Date.now() - 2000; // 끝난 지 0.5초, 쿨타임 남음
  r.coop.activateBarrier(me, now);
  r.coop.shift(5000);
  assert.equal(fx(me).barrierUntil, now + 1500 + 5000);
  room.destroy();
});

test('방 조건: 시작 카운트다운 중 요청은 무시', () => {
  const { room, r, me } = coopRoom();
  assert.ok(Date.now() < r.startAt, '카운트다운 중');
  r.coopBarrier(me.id);
  assert.equal(fx(me).barrierLeft, 2);
  room.destroy();
});

test('안내: 대기실 협력전 설명에 우클릭 보호막 한 줄', async () => {
  const { specialPickerHtml } = await import('../../client/src/coopUI.ts');
  const html = specialPickerHtml(undefined);
  assert.ok(html.includes('우클릭') && html.includes('보호막'), html);
  assert.ok(html.includes(`${B.durationMs / 1000}초`), html);
});

test('화면 예측: 켜진 동안과 요청 직후 응답 대기 중에는 맞은 연출을 미리 내지 않는다', async () => {
  const { barrierGuarding, BARRIER_PENDING_MS } = await import('../../client/src/pointer.ts');
  const t = 10_000;
  const fx = { barrierUntil: 0, barrierLeft: 2 };
  assert.equal(barrierGuarding(fx, 0, t), false, '요청 없음');
  assert.equal(barrierGuarding(fx, t - 100, t), true, '요청 직후');
  assert.equal(barrierGuarding(fx, t - BARRIER_PENDING_MS, t), false, '응답 대기 시간 지남');
  assert.equal(barrierGuarding({ barrierUntil: 0, barrierLeft: 0 }, t - 100, t), false, '남은 횟수 0이면 서버가 거절');
  assert.equal(barrierGuarding({ barrierUntil: t + 1, barrierLeft: 1 }, 0, t), true, '켜짐');
  assert.equal(barrierGuarding(undefined, t - 100, t), false);
  // 쿨타임 중 요청은 서버가 거절하므로 예측을 건너뛰지 않는다
  assert.equal(barrierGuarding({ barrierUntil: t - 500, barrierLeft: 1 }, t - 100, t), false, '쿨타임 중');
});

test('화면 요청 가능 여부: 켜짐·쿨타임·0회면 보내지 않는다', async () => {
  const { barrierReady } = await import('../../client/src/pointer.ts');
  const t = 10_000;
  assert.equal(barrierReady({ barrierUntil: 0, barrierLeft: 2 }, t), true);
  assert.equal(barrierReady({ barrierUntil: t + 100, barrierLeft: 1 }, t), false, '켜짐');
  assert.equal(barrierReady({ barrierUntil: t - 100, barrierLeft: 1 }, t), false, '쿨타임');
  assert.equal(barrierReady({ barrierUntil: t - B.cooldownMs, barrierLeft: 1 }, t), true, '쿨타임 끝');
  assert.equal(barrierReady({ barrierUntil: 0, barrierLeft: 0 }, t), false, '0회');
  assert.equal(barrierReady(undefined, t), false);
});

test('두 버튼 동시 누름: 다른 버튼을 누른 채 새로 누른 버튼을 알아낸다', async () => {
  const { chordPress } = await import('../../client/src/pointer.ts');
  assert.equal(chordPress('mouse', 2, 3), true, '왼쪽 누른 채 오른쪽');
  assert.equal(chordPress('mouse', 0, 3), true, '오른쪽 누른 채 왼쪽');
  assert.equal(chordPress('mouse', 2, 1), false, '오른쪽을 뗌');
  assert.equal(chordPress('mouse', -1, 3), false, '버튼 변화 없는 이동');
  assert.equal(chordPress('mouse', 1, 5), false, '가운데 버튼');
  assert.equal(chordPress('touch', 0, 1), false);
});

test('모바일 버튼: 누르면 보호막을 쓰고, 버튼 위 터치 이동은 게임 커서로 새지 않는다', async () => {
  const { renderBarrierHud } = await import('../../client/src/coopUI.ts');
  const on: Record<string, (e: unknown) => void> = {};
  let writes = 0, html = '';
  const el = {
    id: '', type: '', className: '', hidden: false, disabled: false, dataset: {} as Record<string, string>,
    get innerHTML() { return html; }, set innerHTML(v: string) { html = v; writes++; },
    classList: { toggle() {} }, setAttribute() {},
    addEventListener(ev: string, f: (e: unknown) => void) { on[ev] = f; },
  };
  const stage = { appendChild() {} } as unknown as HTMLElement;
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  let created = false;
  g.document = { getElementById: () => (created ? el : null), createElement: () => { created = true; return el; } };
  try {
    let used = 0;
    const me = { bot: false, coopFx: { barrierUntil: 0, barrierLeft: 2 } } as unknown as PlayerState;
    renderBarrierHud(stage, me, 'normal', true, () => { used++; });
    renderBarrierHud(stage, me, 'normal', true, () => { used++; });
    assert.equal(writes, 1, '같은 내용이면 다시 쓰지 않음');
    (me.coopFx as CoopFx).barrierLeft = 1;
    renderBarrierHud(stage, me, 'normal', true, () => { used++; });
    assert.equal(writes, 2, '횟수가 바뀌면 다시 씀');
    const ev = () => { const e = { stopped: 0, prevented: 0, stopPropagation() { e.stopped++; }, preventDefault() { e.prevented++; } }; return e; };
    const down = ev(); on.pointerdown!(down);
    assert.equal(used, 1);
    assert.equal(down.stopped, 1);
    for (const name of ['pointermove', 'pointerup']) {
      const e = ev(); on[name]!(e);
      assert.equal(e.stopped, 1, name);
    }
  } finally { g.document = prev; }
});

test('우클릭은 클릭 판정이 아니다', () => {
  assert.equal(pointerAction('mouse', 0), 'click');
  assert.equal(pointerAction('mouse', 2), 'barrier');
  assert.equal(pointerAction('mouse', 1), 'ignore');
  assert.equal(pointerAction('touch', 0), 'click');
  assert.equal(pointerAction('pen', 0), 'click');
});
