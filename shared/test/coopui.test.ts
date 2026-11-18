import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlayer, type CoopResult } from '../src/index.ts';
import { coopBreaksText, coopResultRows } from '../../client/src/coopUI.ts';
import { specialPickerHtml } from '../../client/src/coopUI.ts';

test('스페셜 어택 선택: 기본 레이저, 공격별 충전량·위력과 선택 표시', () => {
  const p = newPlayer('a', 'A', 0);
  assert.match(specialPickerHtml(p), /data-special="laser" aria-pressed="true"/);
  p.coopSpecial = 'meteor';
  const html = specialPickerHtml(p);
  assert.match(html, /data-special="meteor" aria-pressed="true"/);
  assert.match(html, /충전 30 · 기본 총피해 18/);
  assert.match(html, /충전 50 · 기본 총피해 34/);
  assert.match(html, /충전 75 · 기본 총피해 55/);
});

const res = (players: CoopResult['players'], breaks: CoopResult['breaks'] = []): CoopResult =>
  ({ win: true, stars: 2, timeMs: 100_000, bossHpPct: 0, phase: 3, maxHp: 400, players, breaks });

test('coopResultRows: 대미지 큰 순, 반올림, 최대 체력 대비 %, 1등만 최다 대미지', () => {
  const a = newPlayer('a', 'A', 0), b = newPlayer('b', 'B', 1), c = newPlayer('c', '봇 A', 2, true);
  const rows = coopResultRows(res({
    a: { dmg: 80, burstDmg: 20, crystals: 2, threats: 1 },
    b: { dmg: 120.4, burstDmg: 40.6, crystals: 1, threats: 3 },
    c: { dmg: 0, burstDmg: 0, crystals: 0, threats: 0, hits: {}, hpLeft: 0, items: {} },
  }), [a, b, c]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  assert.deepEqual([rows[0]!.dmg, rows[0]!.pct, rows[0]!.burstDmg, rows[0]!.top], [120, 30, 41, true]);
  assert.deepEqual([rows[1]!.top, rows[2]!.top], [false, false]);
  assert.equal(rows[0]!.name, 'B');
});

test('coopResultRows: 아무도 대미지가 없으면 최다 대미지 표시 없음', () => {
  const a = newPlayer('a', 'A', 0);
  const rows = coopResultRows(res({ a: { dmg: 0, burstDmg: 0, crystals: 0, threats: 0, hits: {}, hpLeft: 0, items: {} } }), [a]);
  assert.equal(rows[0]!.top, false);
});

test('coopBreaksText: 보호막마다 걸린 초, 분노 횟수', () => {
  assert.deepEqual(coopBreaksText([{ ms: 6200, rages: 0 }, { ms: 21800, rages: 1 }]), ['1번째 보호막 6.2초', '2번째 보호막 21.8초 (분노 1번)']);
});

test('counterFlashAt: 예고 시작은 경고, 취소되면 번쩍임 지움, 발동 뒤 판정으로 0이 와도 번쩍임 유지, 재개·재접속은 새 시각으로', async () => {
  const { counterFlashAt } = await import('../../client/src/coopUI.ts');
  const g = (fireAt: number) => ({ value: 0, at: 0, fireAt, coolUntil: 0 });
  assert.deepEqual(counterFlashAt(0, g(5000), 3000), { fireAt: 5000, warn: true }, '새 예고');
  assert.deepEqual(counterFlashAt(5000, g(5000), 3500), { fireAt: 5000, warn: false }, '같은 예고');
  assert.deepEqual(counterFlashAt(5000, g(0), 4000), { fireAt: 0, warn: false }, '발동 전 취소 → 번쩍임 없음');
  assert.deepEqual(counterFlashAt(5000, g(0), 5150), { fireAt: 5000, warn: false }, '판정 뒤 0 → 번쩍임 유지');
  assert.deepEqual(counterFlashAt(5000, null, 4000), { fireAt: 0, warn: false }, '판 끝');
  assert.deepEqual(counterFlashAt(5000, g(8000), 6000, true), { fireAt: 8000, warn: false }, '재개·재접속: 시각만 맞추고 경고음 없음');
});
