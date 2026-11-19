import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, newPlayer, type CoopResult } from '../src/index.ts';
import { coopBreaksText, coopResultRows } from '../../client/src/coopUI.ts';
import { coopRulesHtml, specialPickerHtml } from '../../client/src/coopUI.ts';

test('스페셜 어택 선택: 기본 레이저, 공격별 충전량·위력과 선택 표시', () => {
  const p = newPlayer('a', 'A', 0);
  assert.match(specialPickerHtml(p), /data-special="laser" aria-pressed="true"/);
  p.coopSpecial = 'meteor';
  const html = specialPickerHtml(p);
  assert.match(html, /data-special="meteor" aria-pressed="true"/);
  assert.match(html, /충전 30 · 기본 총피해 18/);
  assert.match(html, /충전 50 · 기본 총피해 34/);
  assert.match(html, /충전 75 · 기본 총피해 55/);
  assert.match(html, /수호 결계[\s\S]*?모든 피해 40% 감소[\s\S]*?충전 50 · 5초/);
  assert.match(html, /중력 족쇄[\s\S]*?충전 55 · 3초/);
  assert.match(html, /연계 신호[\s\S]*?충전 40 · 6초/);
});

test('협력전 규칙 설명은 별도 카드에 있고 스페셜 선택은 기술 카드만 표시한다', () => {
  const html = coopRulesHtml();
  const { special, burst } = RULES.coop;
  assert.ok(html.includes('수정 타격 +' + special.gain.crystal));
  assert.ok(html.includes('원 획득 피해 ' + burst.mult + '배'));
  assert.ok(html.includes('<dt>보스 반격</dt>'));
  assert.doesNotMatch(specialPickerHtml(undefined), /우클릭|딜 타임에는|피해를 너무 몰아/);
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
  assert.deepEqual(coopBreaksText([{ ms: 6200, rages: 0 }, { ms: 21800, rages: 1 }]), ['1번째 보호막 6.2초', '2번째 보호막 21.8초 (파훼 실패)']);
});

test('counterFlashAt: 예고 시작은 경고, 취소되면 번쩍임 지움, 발동 뒤 판정으로 0이 와도 번쩍임 유지, 재개·재접속은 새 시각으로', async () => {
  const { counterFlashAt } = await import('../../client/src/coopUI.ts');
  const g = (fireAt: number) => ({ value: 0, at: fireAt > 0 ? fireAt - 2000 : 0, fireAt, coolUntil: 0 });
  assert.deepEqual(counterFlashAt(0, g(5000), 3000), { fireAt: 5000, warn: true }, '새 예고');
  assert.deepEqual(counterFlashAt(5000, g(5000), 3500), { fireAt: 5000, warn: false }, '같은 예고');
  assert.deepEqual(counterFlashAt(5000, g(0), 4000), { fireAt: 0, warn: false }, '발동 전 취소 → 번쩍임 없음');
  assert.deepEqual(counterFlashAt(5000, g(0), 5150), { fireAt: 5000, warn: false }, '판정 뒤 0 → 번쩍임 유지');
  assert.deepEqual(counterFlashAt(5000, null, 4000), { fireAt: 0, warn: false }, '판 끝');
  assert.deepEqual(counterFlashAt(5000, g(8000), 6000, true), { fireAt: 8000, warn: false }, '재개·재접속: 시각만 맞추고 경고음 없음');
});

test('counterFlashAt: 재개 직후 밀린 예고가 coop:state로 먼저 와도 경고음을 다시 내지 않음', async () => {
  const { counterFlashAt } = await import('../../client/src/coopUI.ts');
  // 예고는 1000에 시작, 1500에 일시정지 10초 → 서버가 at·fireAt을 10초 밀어 보냄. 재개 직후라 synced
  assert.deepEqual(counterFlashAt(3000, { value: 2.5, at: 11_000, fireAt: 13_000, coolUntil: 0 }, 11_500, true), { fireAt: 13_000, warn: false });
  // 재개와 상관없는 새 예고는 경고
  assert.deepEqual(counterFlashAt(3000, { value: 2.5, at: 30_000, fireAt: 32_000, coolUntil: 0 }, 30_050), { fireAt: 32_000, warn: true });
});

test('counterHudLive: 게이지가 다 빠지면 갱신 멈춤, 예고·대기 중이면 갱신', async () => {
  const { counterHudLive } = await import('../../client/src/coopUI.ts');
  const g = { value: 1.3, at: 0, fireAt: 0, coolUntil: 0 };
  assert.equal(counterHudLive(g, 'normal', 500), true);
  assert.equal(counterHudLive(g, 'normal', 1000), false, '1.3%/초로 1초 뒤 0');
  assert.equal(counterHudLive({ ...g, value: 0, fireAt: 5000 }, 'normal', 1000), true);
  assert.equal(counterHudLive({ ...g, value: 0, coolUntil: 5000 }, 'normal', 1000), true);
  assert.equal(counterHudLive(null, 'normal', 1000), false);
});
