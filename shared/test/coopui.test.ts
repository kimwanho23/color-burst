import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlayer, type CoopResult } from '../src/index.ts';
import { coopBreaksText, coopResultRows } from '../../client/src/coopUI.ts';

const res = (players: CoopResult['players'], breaks: CoopResult['breaks'] = []): CoopResult =>
  ({ win: true, stars: 2, timeMs: 100_000, bossHpPct: 0, phase: 3, maxHp: 400, players, breaks });

test('coopResultRows: 대미지 큰 순, 반올림, 최대 체력 대비 %, 1등만 최다 대미지', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1), c = newPlayer('c', '봇 A', 2, true);
  const rows = coopResultRows(res({
    a: { dmg: 80, burstDmg: 20, crystals: 2, threats: 1 },
    b: { dmg: 120.4, burstDmg: 40.6, crystals: 1, threats: 3 },
    c: { dmg: 0, burstDmg: 0, crystals: 0, threats: 0 },
  }), [a, b, c]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  assert.deepEqual([rows[0]!.dmg, rows[0]!.pct, rows[0]!.burstDmg, rows[0]!.top], [120, 30, 41, true]);
  assert.deepEqual([rows[1]!.top, rows[2]!.top], [false, false]);
  assert.equal(rows[0]!.name, 'B');
});

test('coopResultRows: 아무도 대미지가 없으면 최다 대미지 표시 없음', () => {
  const a = newPlayer('a', 'A', 0);
  const rows = coopResultRows(res({ a: { dmg: 0, burstDmg: 0, crystals: 0, threats: 0 } }), [a]);
  assert.equal(rows[0]!.top, false);
});

test('coopBreaksText: 보호막마다 걸린 초, 실패는 분노', () => {
  assert.deepEqual(coopBreaksText([6200, 'rage', 9800]), ['1번째 보호막 6.2초', '2번째 보호막 분노', '3번째 보호막 9.8초']);
});
