import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { BEATS, enterStep, freeDone, freeKinds } from '../../server/src/tutorial.ts';
import { BEAT_TEXT, TUTORIAL_TEXT, holdAccepts } from '../../client/src/tutorial.ts';
import { FIELD, RULES, circlePos, isFever, isGuarded, newPlayer, zoneOf, type Circle, type PlayerState, type TutorialBeatInfo, type TutorialStatus } from '../src/index.ts';

const CX = FIELD.w / 2, CY = FIELD.h / 2;
const T = RULES.tutorial;
type Sent = { ev: string; d: unknown };
type R = {
  startAt: number; pausedAt: number; circles: Map<number, Circle>; tick(): void; clickLog: Map<string, number[]>;
  tut: { i: number; b: number; target: number | null; held: boolean } | null;
};

/** 튜토리얼 방 (가짜 io, 시계·타이머 가짜). 시작 카운트다운은 건너뛴다 */
function tutorialRoom(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const log: Sent[] = [];
  const io = { to: () => ({ emit(ev: string, d: unknown) { log.push({ ev, d }); } }), sockets: { sockets: new Map() } } as never;
  const room = new Room(io, 'T', () => {}, true, false, true);
  const a = room.join('s1', 'k1', 'A') as { id: string };
  assert.equal(room.start(a.id), null);
  const r = room as unknown as R;
  r.startAt = Date.now();
  const me = room.players.find((p) => p.id === a.id)!;
  const beats = () => log.filter((x) => x.ev === 'tutorial:beat').map((x) => x.d as TutorialBeatInfo);
  const steps = () => log.filter((x) => x.ev === 'tutorial:step').map((x) => x.d as TutorialStatus);
  const beat = () => beats().at(-1)!;
  const bot = () => room.players.find((p) => p.bot) ?? null;
  /** 시계를 ms만큼 (step씩 나눠) 보내며 틱 */
  const wait = (ms: number, step = 50) => { for (let k = 0; k < ms; k += step) { t.mock.timers.tick(step); r.tick(); } };
  const clickAt = (x: number, y: number, circleId: number | null) => { r.clickLog.clear(); room.click(me.id, { circleId, x, y }); };
  /** 멈춘 시각(멈췄으면) 기준으로 원 위치를 누른다 */
  const clickCircle = (id: number) => { const c = r.circles.get(id)!; const q = circlePos(c, r.pausedAt || Date.now()); clickAt(q.x, q.y, id); };
  const target = () => r.tut!.target!;
  /** 지금 짚기 장면이 멈출 때까지 기다린 뒤 짚은 원을 누른다 */
  /** 짚기 장면이 멈출 때까지 (원이 발사 보호 구역을 벗어나고 focusDelayMs가 지나면) */
  const waitHold = () => { for (let k = 0; k < 200 && !r.pausedAt; k++) wait(50); assert.ok(r.pausedAt > 0, '멈춤'); };
  const doFocus = () => { waitHold(); clickCircle(target()); };
  const claimed = () => log.filter((x) => x.ev === 'circle:claimed').map((x) => x.d as { by: string; result: { gained: number; comboBonus: boolean; type: string } });
  /** 지금 단계를 끝내고 다음 단계 첫 장면까지 */
  const runTo = (id: string) => {
    for (let guard = 0; guard < 80 && beats().at(-1)?.beat !== id; guard++) {
      if (!beats().length) { wait(50); continue; }
      const b = beat();
      if (b.kind === 'card') room.tutorialNext(me.id);
      else if (b.kind === 'focus' && b.accept === 'empty') clickAt(CX + 500, CY + 500, null);
      else if (b.kind === 'focus') doFocus();
      else if (b.beat === 'steal.wait') wait(RULES.mark?.ms ?? 5000, 100);
      else wait(T.nextMs + 100);
      if (beat().beat === b.beat) wait(T.nextMs + 100);
    }
    assert.equal(beat().beat, id);
  };
  return { room, me, r, log, beats, beat, steps, bot, wait, waitHold, clickAt, clickCircle, target, doFocus, claimed, runTo };
}

/** 천천히 움직여 지금 (x, y)에 있는 원 */
let nextId = 5000;
const slowAt = (kind: Circle['kind'], x: number, y: number, now = Date.now()): Circle => {
  const d = Math.hypot(x - CX, y - CY);
  return { id: nextId++, kind, angle: Math.atan2(y - CY, x - CX), speed: d / 100, r: 40, born: now - 100_000 };
};

test('단계 순서와 장면 목록', () => {
  assert.deepEqual(RULES.tutorial.steps, ['own', 'combo', 'steal', 'fever', 'zones']);
  assert.deepEqual(BEATS.own.map((b) => b.kind), ['focus', 'card', 'focus', 'card']);
  assert.deepEqual(BEATS.combo.map((b) => b.id), ['combo.intro', 'combo.ten', 'combo.tenCard', 'combo.empty', 'combo.emptyCard']);
  assert.equal((BEATS.combo[3] as { accept: string }).accept, 'empty');
  assert.ok(BEATS.steal.some((b) => b.kind === 'botSteal'));
  const go = BEATS.fever.find((b) => b.id === 'fever.go') as { prep?: { fever?: number } };
  assert.equal(go.prep?.fever, 99);
  const ids = Object.values(BEATS).flat().map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, '장면 id는 겹치지 않음');
});

test('단계 시작: 콤보 단계는 콤보 9, 그 밖은 0, 피버는 꺼짐', () => {
  const me = newPlayer('a', 'A', 0);
  me.combo = 3; me.fever = 50; me.feverUntil = Date.now() + 5000;
  enterStep('combo', me);
  assert.deepEqual([me.combo, me.fever, me.feverUntil], [9, 0, 0]);
  enterStep('steal', me);
  assert.equal(me.combo, 0);
});

test('자유 연습 끝 판정', () => {
  const me = newPlayer('a', 'A', 0), now = 10_000;
  me.markedUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), false);
  me.markedUntil = now;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), true);
  me.feverUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'feverEnd' }, me, now, 0), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 2), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 3), true);
});

test('자유 연습 원 종류', () => {
  const me = newPlayer('a', 'A', 0), bot = newPlayer('b', 'B', 2, true);
  assert.deepEqual(freeKinds('steal', me, bot), [0]);
  assert.deepEqual(freeKinds('fever', me, bot), [0, 'y', 2]);
  assert.deepEqual(freeKinds('zones', me, null), [0]);
});

test('시작하면 원 잡기 첫 장면, 대상 원 하나만 나오고 600ms 뒤 멈춤', (t) => {
  const { room, me, r, log, beat, wait, waitHold, target } = tutorialRoom(t);
  try {
    wait(50);
    assert.deepEqual([beat().step, beat().beat, beat().kind, beat().accept], ['own', 'own.mine', 'focus', 'circle']);
    assert.equal(r.circles.size, 1);
    assert.equal([...r.circles.values()][0]!.kind, me.color);
    wait(T.focusDelayMs - 150);
    assert.equal(r.pausedAt, 0, 'focusDelayMs 전에는 멈추지 않음');
    waitHold();
    assert.ok(!isGuarded(r.circles.get(target())!, r.pausedAt), '멈춘 원은 잡을 수 있는 자리');
    const pause = log.filter((x) => x.ev === 'game:pause').at(-1)!.d as { by: string };
    assert.equal(pause.by, '');
    assert.equal(beat().at, r.pausedAt);
    assert.equal(beat().circleId, r.tut!.target);
  } finally { room.destroy(); }
});

test('멈춘 짚기 장면: 빈 곳·다른 원 클릭은 아무 일 없음', (t) => {
  const { room, me, r, log, waitHold, clickAt, clickCircle } = tutorialRoom(t);
  try {
    waitHold();
    const other = slowAt(me.color, CX - 300, CY + 200);
    r.circles.set(other.id, other);
    me.combo = 4;
    const before = [me.score, me.combo, me.fever, r.circles.size];
    clickCircle(other.id);
    clickAt(CX + 480, CY - 480, null);
    assert.deepEqual([me.score, me.combo, me.fever, r.circles.size], before);
    assert.ok(!log.some((x) => x.ev === 'click:rejected' || x.ev === 'game:resuming'));
    assert.ok(r.pausedAt > 0, '여전히 멈춤');
  } finally { room.destroy(); }
});

test('짚은 원을 누르면 잡히고 다음 장면(카드)으로, 카드라 멈춘 채', (t) => {
  const { room, me, r, beat, doFocus } = tutorialRoom(t);
  try {
    doFocus();
    assert.ok(me.score > 0);
    assert.deepEqual([beat().beat, beat().kind], ['own.mineCard', 'card']);
    assert.ok(r.pausedAt > 0);
  } finally { room.destroy(); }
});

test('짚기 대기 중에도 다른 클릭은 무시, 대상 원 클릭은 받음', (t) => {
  const { room, me, r, beat, wait, clickAt, clickCircle, target } = tutorialRoom(t);
  try {
    wait(100);
    me.combo = 3;
    clickAt(CX + 480, CY - 480, null);
    assert.equal(me.combo, 3, '빈 곳은 무시');
    assert.equal(r.pausedAt, 0);
    r.circles.get(target())!.born -= 1000; // 아직 멈추기 전이지만 발사 보호 구역은 벗어난 자리로
    clickCircle(target());
    assert.ok(me.score > 0);
    assert.equal(beat().beat, 'own.mineCard');
  } finally { room.destroy(); }
});

test('tutorial:next는 카드 장면에서만, 한 번에 한 장면', (t) => {
  const { room, me, r, beat, doFocus, wait } = tutorialRoom(t);
  try {
    wait(100);
    room.tutorialNext(me.id);
    assert.equal(beat().beat, 'own.mine', '짚기 장면에서는 넘어가지 않음');
    doFocus();
    assert.equal(beat().beat, 'own.mineCard');
    room.tutorialNext(me.id);
    room.tutorialNext(me.id);
    assert.equal(beat().beat, 'own.yellow');
    assert.equal(r.tut!.b, 2);
  } finally { room.destroy(); }
});

test('콤보 단계: 콤보 9에서 시작, 짚은 원으로 10이 되며 콤보 보너스', (t) => {
  const { room, me, runTo, doFocus, beat, claimed } = tutorialRoom(t);
  try {
    runTo('combo.intro');
    assert.equal(me.combo, 9);
    room.tutorialNext(me.id);
    assert.equal(beat().beat, 'combo.ten');
    doFocus();
    assert.equal(me.combo, 10);
    assert.ok(claimed().at(-1)!.result.comboBonus);
    assert.equal(beat().beat, 'combo.tenCard');
    // 카드가 보여 줄 점수: 원 점수 + 콤보 보너스 = 방금 받은 점수
    const g = beat().gain!;
    assert.ok(g.base > 0 && g.bonus > 0);
    assert.equal(g.base + g.bonus, claimed().at(-1)!.result.gained);
  } finally { room.destroy(); }
});

test('빈 곳 짚기: 원 클릭은 무시, 빈 곳 클릭은 콤보 0', (t) => {
  const { room, me, r, runTo, beat, clickAt, clickCircle } = tutorialRoom(t);
  try {
    runTo('combo.empty');
    assert.ok(r.pausedAt > 0);
    const c = slowAt(me.color, CX + 200, CY);
    r.circles.set(c.id, c);
    const combo = me.combo;
    assert.ok(combo > 0);
    clickCircle(c.id);
    assert.equal(me.combo, combo);
    clickAt(CX - 480, CY + 480, null);
    assert.equal(me.combo, 0);
    assert.equal(beat().beat, 'combo.emptyCard');
  } finally { room.destroy(); }
});

test('견제 단계: 견제하면 내가 표적, 표적이 풀리면 봇이 내 원을 가져가 봇이 표적, 봇 원을 잡으면 반격', (t) => {
  const { room, me, bot, runTo, doFocus, beat, wait, claimed } = tutorialRoom(t);
  try {
    runTo('steal.do');
    assert.ok(bot(), '견제 단계에 봇');
    assert.equal(bot()!.combo, T.botCombo);
    doFocus();
    assert.ok(me.markedUntil > Date.now(), '내가 표적');
    assert.equal(bot()!.combo, 0);
    assert.equal(beat().beat, 'steal.doCard');
    room.tutorialNext(me.id);
    assert.equal(beat().beat, 'steal.wait');
    me.combo = 3;
    wait(4500, 100);
    assert.equal(beat().beat, 'steal.bot');
    wait(T.focusDelayMs + 100);
    assert.equal(me.combo, 0, '봇이 내 콤보를 끊음');
    assert.ok(bot()!.markedUntil > Date.now(), '봇이 표적');
    assert.equal(beat().beat, 'steal.botCard');
    room.tutorialNext(me.id);
    assert.equal(beat().beat, 'steal.counter');
    doFocus();
    assert.equal(claimed().at(-1)!.result.type, 'counter');
    assert.equal(beat().beat, 'steal.sumCard');
  } finally { room.destroy(); }
});

test('피버 단계: 게이지 99에서 짚은 원 하나로 피버, 카드 동안 피버 시간이 멈추고, 피버가 끝나면 다음 단계', (t) => {
  const { room, me, runTo, doFocus, beat, wait, steps } = tutorialRoom(t);
  try {
    runTo('fever.go');
    assert.equal(me.fever, 99);
    doFocus();
    assert.ok(isFever(me, Date.now()));
    assert.equal(beat().beat, 'fever.onCard');
    const until = me.feverUntil;
    t.mock.timers.tick(5000);
    room.tutorialNext(me.id);
    assert.equal(me.feverUntil, until + 5000, '카드 동안 멈춘 만큼 밀림');
    assert.equal(beat().beat, 'fever.play');
    wait(me.feverUntil - Date.now() + 200, 100);
    wait(T.nextMs + 200, 100);
    assert.equal(steps().at(-1)!.step, 'zones');
  } finally { room.destroy(); }
});

test('점수 구역: 가장자리에서 멈추고, 사이·가장자리에서 3개 잡으면 완료 (결과 화면 없음)', (t) => {
  const { room, me, r, log, runTo, beat, wait, clickCircle, target, steps } = tutorialRoom(t);
  try {
    runTo('zones.edge');
    for (let k = 0; k < 200 && !r.pausedAt; k++) wait(50);
    const c = r.circles.get(target())!;
    assert.equal(zoneOf(circlePos(c, r.pausedAt)), 2);
    clickCircle(c.id);
    assert.equal(beat().beat, 'zones.play');
    const put = (x: number, y: number) => { const o = slowAt(me.color, x, y); r.circles.set(o.id, o); clickCircle(o.id); };
    put(CX + 20, CY);
    assert.equal(beat().count, 0, '가운데는 세지 않음');
    put(CX + 300, CY - 200); put(CX - 300, CY + 200); put(CX + 450, CY);
    wait(T.nextMs + 200, 100);
    assert.equal(steps().at(-1)!.done, true);
    assert.ok(!log.some((x) => x.ev === 'game:over'));
  } finally { room.destroy(); }
});

test('멈춤 장면 중 일시정지·다시 시작 요청은 무시', (t) => {
  const { room, me, r, log, doFocus, beat } = tutorialRoom(t);
  try {
    doFocus();
    const n = log.filter((x) => x.ev === 'game:pause').length;
    const at = r.pausedAt;
    room.pause(me.id);
    room.resume(me.id);
    assert.equal(log.filter((x) => x.ev === 'game:pause').length, n);
    assert.ok(!log.some((x) => x.ev === 'game:resuming'));
    assert.equal(r.pausedAt, at);
    assert.equal(beat().beat, 'own.mineCard');
  } finally { room.destroy(); }
});

test('다시 접속하면 지금 장면을 다시 받음', (t) => {
  const { room, beats, waitHold } = tutorialRoom(t);
  try {
    waitHold();
    const was = beats().at(-1)!;
    const n = beats().length;
    room.join('s2', 'k1', 'A');
    assert.equal(beats().length, n + 1);
    const now = beats().at(-1)!;
    assert.deepEqual([now.beat, now.circleId, now.at], [was.beat, was.circleId, was.at]);
  } finally { room.destroy(); }
});

test('나가면 단계 타이머가 정리됨', (t) => {
  const { room, me, r, runTo } = tutorialRoom(t);
  runTo('own.yellowCard');
  room.tutorialNext(me.id);
  room.destroy();
  assert.equal(r.tut, null);
});

test('튜토리얼 문구: 모든 장면에 문구가 있고 점수·배율 숫자를 쓰지 않음 (콤보 카드는 받은 값 자리 표시)', () => {
  for (const b of Object.values(BEATS).flat()) {
    if (b.kind === 'botSteal') continue; // 봇 견제는 문구 없이 바로 다음 카드
    const t = BEAT_TEXT[b.id];
    assert.ok(t, b.id);
    // 콤보 수(9, 10)는 규칙과 상관없는 사실이라 쓸 수 있다. 점수(+3)·배율(×3, 3배)은 안 됨
    assert.ok(!/[×x]\s*\d|\d\s*배|\+\s*\d|\d\s*점/.test(t), `${b.id}: ${t}`);
  }
  assert.ok(BEAT_TEXT['combo.tenCard']!.includes('{base}') && BEAT_TEXT['combo.tenCard']!.includes('{bonus}'));
  for (const s of RULES.tutorial.steps) assert.ok(TUTORIAL_TEXT[s].name, s);
});

test('멈춤 중 클릭 판단', () => {
  const focus = { step: 'own', beat: 'own.mine', kind: 'focus', accept: 'circle', circleId: 7 } as const;
  assert.equal(holdAccepts(focus, 7), 'send');
  assert.equal(holdAccepts(focus, 8), 'hint');
  assert.equal(holdAccepts(focus, null), 'hint');
  const empty = { step: 'combo', beat: 'combo.empty', kind: 'focus', accept: 'empty' } as const;
  assert.equal(holdAccepts(empty, null), 'send');
  assert.equal(holdAccepts(empty, 3), 'hint');
  assert.equal(holdAccepts({ step: 'own', beat: 'own.mineCard', kind: 'card' }, 7), 'hint');
  assert.equal(holdAccepts({ step: 'zones', beat: 'zones.play', kind: 'free' }, 7), 'pass');
  assert.equal(holdAccepts(null, 7), 'pass');
});

test('단계 끝 대기·봇 견제 장면은 wait 장면으로 알려 화면이 클릭을 보내지 않게', (t) => {
  const { room, me, beats, beat, runTo, wait } = tutorialRoom(t);
  try {
    runTo('own.yellowCard');
    room.tutorialNext(me.id);
    assert.equal(beat().kind, 'wait', '단계 마지막 카드 뒤 대기');
    runTo('steal.wait');
    wait(4500, 100);
    assert.deepEqual([beat().beat, beat().kind], ['steal.bot', 'wait']);
    assert.ok(beats().every((b) => b.kind !== 'free' || b.beat !== 'steal.bot'));
  } finally { room.destroy(); }
});

test('wait 장면의 판 클릭은 효과 없이 무시', () => {
  assert.equal(holdAccepts({ step: 'own', beat: 'wait', kind: 'wait' }, 7), 'hint');
  assert.equal(holdAccepts({ step: 'own', beat: 'wait', kind: 'wait' }, null), 'hint');
});
