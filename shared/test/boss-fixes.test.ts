import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/src/room.ts';
import { Bot } from '../../server/src/bot.ts';
import {
  DEFAULT_RULES, FIELD, bossState, circlePos, makeBoss, newPlayer, resolveClaim, toGameRules, type Circle,
} from '../src/index.ts';

const G = toGameRules(DEFAULT_RULES);
const CX = FIELD.w / 2, CY = FIELD.h / 2;
const sent: string[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string) { sent.push(ev); } }), sockets: { sockets: new Map() } }) as never;

function playingRoom() {
  const room = new Room(fakeIo(), 'TEST', () => {});
  const a = room.join('s1', 'k1', 'A') as { id: string };
  room.join('s2', 'k2', 'B');
  room.fillBots = false;
  for (const p of room.players) if (!p.bot && p.id !== a.id) room.setReady(p.id, true);
  assert.equal(room.start(a.id), null);
  const r = room as unknown as { startAt: number; circles: Map<number, Circle> };
  r.startAt = 0;
  return { room, me: room.players.find((p) => p.id === a.id)!, circles: r.circles };
}

/** 천천히 움직여 지금 (x, y)에 있는 원 */
const slowAt = (id: number, kind: Circle['kind'], x: number, y: number, now: number): Circle => {
  const d = Math.hypot(x - CX, y - CY);
  return { id, kind, angle: Math.atan2(y - CY, x - CX), speed: d / 100, r: 40, born: now - 100_000 };
};

test('연쇄 콤보: 보스 타격으로 10콤보 문턱을 넘어도 근처 내 원 자동 획득', (t) => {
  const { room, me, circles } = playingRoom();
  const now = Date.now();
  t.mock.method(Math, 'random', () => 0.99);
  me.picks = [{ id: 'chainCombo', tier: 0 }];
  me.combo = 9;
  const boss = { ...slowAt(90, 'boss', 1200, 450, now), boss: 'normal', r: 90, hp: 10, maxHp: 10 } as Circle;
  circles.set(90, boss);
  circles.set(91, slowAt(91, me.color, 1250, 480, now));
  const p0 = circlePos(boss, now);
  try {
    room.click(me.id, { circleId: 90, x: p0.x, y: p0.y });
    assert.equal(me.combo, 11, '보스 타격 10콤보 + 연쇄로 잡은 원 1개');
    assert.equal(circles.has(91), false, '문턱을 넘은 보스 타격으로 근처 내 원을 잡음');
  } finally { room.destroy(); }
});

test('보스 헌터 조합 봇은 붉은 공격형 보스도 노린다', (t) => {
  t.mock.method(Math, 'random', () => 0.99);
  const t0 = 100_000;
  const rage = makeBoss(1, 0, 4, G, () => 0.3, 'rage');
  rage.angle = 0; rage.speed = 300 / 44.5; rage.born = t0 + 2000 - 42_500; // 생각하는 시각에 4초 주기의 2.5초째 → 붉음
  rage.hp = 5; rage.maxHp = 10; // 가운데 발사 보호 구역 밖 (가운데에서 300)
  assert.equal(bossState(rage, t0 + 2000).enraged, true);
  const y = slowAt(2, 'y', 900, 300, t0);
  const pickOf = (hunter: boolean) => {
    const me = newPlayer('b', 'B', 1, true);
    if (hunter) me.picks = [{ id: 'hammer', tier: 0 }, { id: 'hunter', tier: 0 }, { id: 'crusher', tier: 0 }];
    const bot = new Bot(2);
    bot.think(me, [], [me], t0); // 첫 클릭 시각 예약
    return bot.think(me, [y, rage], [me], t0 + 2000)?.id;
  };
  assert.equal(pickOf(false), 2, '조합이 없으면 붉은 보스를 피함');
  assert.equal(pickOf(true), 1, '보스 헌터는 감점이 없어 붉은 보스를 때림');
});

test('자석으로 잡은 원은 황금 손을 쓰지 않고 2배도 없다', () => {
  const c = newPlayer('a', 'A', 0), d = newPlayer('b', 'B', 1);
  c.goldLeft = 2;
  const pulled = resolveClaim(c, 0, [c, d], 100, G, { via: 'magnet' });
  assert.equal(c.goldLeft, 2);
  assert.equal(pulled.gained, 2, '3점의 70% (반올림)');
  assert.equal(resolveClaim(c, 0, [c, d], 100, G).gained, 6, '직접 잡으면 황금 손 2배');
  assert.equal(c.goldLeft, 1);
});
