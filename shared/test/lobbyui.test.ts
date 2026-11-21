import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, DEFAULT_RULES, PRESETS, RULES, newPlayer, type PlayerState } from '../src/index.ts';
import { lobbySlots, roomLink, rulePanel, rulesSummary } from '../../client/src/lobbyUI.ts';

/** 사람 A(나, 방장) · 봇 */
function people() {
  const a = newPlayer('a', 'A', 0);
  const bot = newPlayer('bot-1', '봇 A', 1, true);
  bot.botLevel = 1;
  return { a, bot, list: [a, bot] as PlayerState[] };
}
const kinds = (s: ReturnType<typeof lobbySlots>) => s.map((x) => x.kind);

test('lobbySlots: 늘 4칸, 사람·봇·빈 칸 순서', () => {
  const { a, bot, list } = people();
  const s = lobbySlots(list, 'a', 'a', false);
  assert.deepEqual(kinds(s), ['human', 'bot', 'empty', 'empty']);
  assert.deepEqual(s[0], { kind: 'human', p: a, me: true, isHost: true });
  assert.deepEqual(s[1], { kind: 'bot', p: bot, canEdit: true });
  assert.deepEqual(s[2], { kind: 'empty', canAdd: true, canJoin: false });
});

test('lobbySlots: 방장만 조작 표시', () => {
  const { list } = people();
  const b = newPlayer('b', 'B', 2);
  const s = lobbySlots([...list, b], 'a', 'b', false);
  assert.deepEqual(kinds(s), ['human', 'bot', 'human', 'empty']);
  assert.equal((s[1] as { canEdit: boolean }).canEdit, false);
  assert.equal((s[3] as { canAdd: boolean }).canAdd, false);
  assert.deepEqual(s[2], { kind: 'human', p: b, me: true, isHost: false });
});

test('lobbySlots: 팀전은 팀0 두 칸 뒤 팀1 두 칸, 내 팀이 아닌 빈 칸만 canJoin', () => {
  const me = newPlayer('a', 'A', 0); me.team = 0;
  const b = newPlayer('b', 'B', 1); b.team = 1;
  const s = lobbySlots([me, b], 'a', 'a', true);
  assert.deepEqual(s, [
    { kind: 'human', p: me, me: true, isHost: true },
    { kind: 'empty', team: 0, canAdd: true, canJoin: false },
    { kind: 'human', p: b, me: false, isHost: false },
    { kind: 'empty', team: 1, canAdd: true, canJoin: true },
  ]);
});

test('rulesSummary: 기본·협력전·아케이드·커스텀', () => {
  assert.equal(rulesSummary(DEFAULT_RULES).title, '개인전 · 클래식 · 기본');
  assert.ok(rulesSummary(DEFAULT_RULES).detail.startsWith('60초 · 피버 ×3 7초'), rulesSummary(DEFAULT_RULES).detail);
  assert.ok(rulesSummary(DEFAULT_RULES).detail.includes('보스'));
  assert.equal(rulesSummary({ ...DEFAULT_RULES, coop: true }).title, '협력전 · 노말');
  assert.ok(rulesSummary({ ...DEFAULT_RULES, mode: 'arcade' }).detail.startsWith(`${ARCADE.rounds}라운드`));
  assert.ok(rulesSummary({ ...DEFAULT_RULES, feverSec: 9 }).title.endsWith('커스텀'));
  assert.ok(!rulesSummary({ ...DEFAULT_RULES, boss: false }).detail.includes('보스'));
});

test('roomLink: 주소 뒤에 #방코드', () => {
  assert.equal(roomLink('http://x.com', '/', 'K7QZ'), 'http://x.com/#K7QZ');
  assert.equal(roomLink('https://a.b', '/game/', 'AB12'), 'https://a.b/game/#AB12');
});

test('rulesSummary: 협력전은 꺼지는 보스·레이저·맵 패턴을 적지 않고, 클래식 서바이벌은 탈락 간격을 적음', () => {
  const coop = rulesSummary({ ...DEFAULT_RULES, coop: true }).detail;
  for (const w of ['보스', '레이저', '맵 패턴']) assert.ok(!coop.includes(w), coop);
  assert.equal(coop, `${RULES.coop.timeSec}초 · 체력 ${RULES.coop.hpMax}`);
  const surv = rulesSummary({ ...DEFAULT_RULES, survival: true }).detail;
  assert.ok(surv.startsWith('30초마다 꼴찌 탈락'), surv);
  assert.ok(!surv.startsWith('60초'), surv);
});

test('협력전 엑스퍼트: 패널은 난이도·제한 시간·체력 세 칸만, 타일 없음', () => {
  const r = { ...DEFAULT_RULES, coop: true, coopLevel: 'expert' as const };
  const p = rulePanel(r);
  assert.deepEqual(p.stats.map((x) => [x.big, x.small]), [['엑스퍼트', '난이도'], [`${RULES.coop.timeSec}초`, '제한 시간'], [`${RULES.coop.hpMax}`, '체력']]);
  assert.deepEqual(p.groups, []);
  assert.equal(p.title, '협력전 · 엑스퍼트');
  assert.equal(p.preset, '');
});

test('rulePanel: 기본 규칙은 큰 숫자 3칸 + 켜진 요소 타일, 모두 기본값이라 변경 표시가 없다', () => {
  const p = rulePanel(DEFAULT_RULES);
  assert.equal(p.title, '개인전 · 클래식 · 기본');
  assert.equal(p.preset, '기본');
  assert.deepEqual(p.stats.map((x) => [x.big, x.small]), [['60초', '한 판'], ['×3', '7초 지속'], ['×1', '원 개수 ×1']]);
  assert.ok(p.stats.every((x) => !x.changed));
  const tiles = p.groups.flatMap((g) => g.tiles);
  assert.deepEqual(p.groups.map((g) => g.label), ['판에 나오는 것', '감점 규칙']);
  assert.deepEqual(tiles.map((x) => x.id), ['boss', 'item', 'special', 'laser', 'map', 'rainbow', 'mark', 'miss', 'comeback']);
  assert.ok(tiles.every((x) => !x.changed));
  const byId = Object.fromEntries(tiles.map((x) => [x.id, x]));
  assert.equal(byId.boss.on, true);
  assert.equal(byId.map.badge, `${DEFAULT_RULES.mapPct}%`);
  assert.equal(byId.mark.badge, `표적 ${DEFAULT_RULES.markSec}초`);
  assert.equal(byId.comeback.on, DEFAULT_RULES.comeback);
});

test('rulePanel: 꺼진 요소는 on=false로 알리고 부가값(배지)이 없다, 값이 바뀐 칸만 changed', () => {
  const r = { ...DEFAULT_RULES, boss: false, items: false, stealPenalty: false, mapPct: 0, feverSec: 10 };
  const p = rulePanel(r);
  const byId = Object.fromEntries(p.groups.flatMap((g) => g.tiles).map((x) => [x.id, x]));
  for (const id of ['boss', 'item', 'map']) assert.equal(byId[id].on, false, id);
  assert.equal(byId.map.badge, undefined);
  assert.equal(byId.mark.on, false);
  assert.equal(byId.mark.badge, undefined);
  assert.equal(p.preset, '커스텀');
  assert.equal(p.stats[1].changed, true, '피버 시간이 기본과 다름');
  assert.equal(p.stats[0].changed, false);
  assert.equal(byId.boss.changed, true);
  assert.equal(byId.laser.changed, false);
});

test('rulePanel: 프리셋을 고르면 그 프리셋 값이 기준이라 변경 표시가 없다', () => {
  const p = rulePanel({ ...DEFAULT_RULES, ...PRESETS.hardcore.rules });
  assert.equal(p.preset, '하드코어');
  assert.ok(p.stats.every((x) => !x.changed));
  assert.ok(p.groups.flatMap((g) => g.tiles).every((x) => !x.changed));
});

test('rulePanel: 시간 칸은 아케이드 라운드·서바이벌 탈락 간격으로 바뀐다', () => {
  assert.deepEqual(rulePanel({ ...DEFAULT_RULES, mode: 'arcade' }).stats[0], { icon: 'timer', big: `${ARCADE.rounds}라운드`, small: '라운드마다 30초', changed: false });
  assert.deepEqual(rulePanel({ ...DEFAULT_RULES, survival: true }).stats[0], { icon: 'timer', big: '30초', small: '마다 꼴찌 탈락', changed: false });
  assert.equal(rulePanel({ ...DEFAULT_RULES, mode: 'arcade', arcadeRoundSec: 60 }).stats[0].changed, true);
});
