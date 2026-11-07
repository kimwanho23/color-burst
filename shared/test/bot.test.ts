import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../../server/src/bot.ts';
import { makeGold, newPlayer } from '../src/index.ts';

test('봇은 황금 원에 늦게 반응하고, 노려도 놓칠 수 있다', (t) => {
  const me = newPlayer('b', 'B', 1, true);
  let rnd = 0;
  t.mock.method(Math, 'random', () => rnd);
  const bot = new Bot(2); // 어려움, skill 0.8 → 반응 (300 + 600) / 0.8 = 1125ms
  const t0 = 100_000;
  assert.equal(bot.think(me, [], [me], t0), null); // 첫 클릭 시각 예약 (t0 + 800)
  const young = makeGold(1, t0 + 800 - 1000);
  assert.equal(bot.think(me, [young], [me], t0 + 800), null, '나온 지 1초면 아직 반응 안 함');
  const old = makeGold(2, t0 + 2000 - 2000);
  rnd = 0.69; // 명중 확률 0.7 안
  assert.equal(bot.think(me, [old], [me], t0 + 2000)?.id, 2);
  rnd = 0.7; // 명중 확률 밖 → 놓침
  assert.equal(bot.think(me, [old], [me], t0 + 4000), null);
});
