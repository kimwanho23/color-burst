import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE, DEFAULT_RULES, RULES, newPlayer, type PlayerState } from '../src/index.ts';
import { lobbySlots, roomLink, rulesChips, rulesSummary } from '../../client/src/lobbyUI.ts';

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
  assert.ok(rulesSummary({ ...DEFAULT_RULES, coop: true }).title.startsWith('협력전 · 노말'));
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
  assert.equal(coop, `${RULES.coop.timeSec}초`);
  const surv = rulesSummary({ ...DEFAULT_RULES, survival: true }).detail;
  assert.ok(surv.startsWith('30초마다 꼴찌 탈락'), surv);
  assert.ok(!surv.startsWith('60초'), surv);
});

test('협력전 엑스퍼트: 칩·요약은 난이도와 시간만', () => {
  const r = { ...DEFAULT_RULES, coop: true, coopLevel: 'expert' as const };
  const texts = rulesChips(r).map((c) => c.text);
  assert.ok(texts.includes('협력전 · 엑스퍼트'), texts.join('/'));
  assert.ok(texts.includes(`${RULES.coop.timeSec}초`));
  for (const w of ['레이저', '맵 패턴', '보스']) assert.ok(!texts.some((x) => x.includes(w)), w);
  assert.ok(rulesSummary(r).title.startsWith('협력전 · 엑스퍼트'), rulesSummary(r).title);
});

test('rulesChips: 시간·피버·속도·견제·요소 켜짐/꺼짐을 빠짐없이', () => {
  const t = (r: Parameters<typeof rulesChips>[0]) => rulesChips(r).map((c) => `${c.off ? '-' : ''}${c.text}`);
  const d = t(DEFAULT_RULES);
  for (const s of ['60초', '피버 ×3 · 7초', '속도 ×1 · 원 개수 ×1', '견제 페널티 · 표적 4초', '빈 곳 감점', '보스', '아이템', '레이저 · 보통', '맵 패턴 35%', '무지개 3%', '-꼴찌 보정']) assert.ok(d.includes(s), `${s} in ${d.join('/')}`);
  const off = t({ ...DEFAULT_RULES, boss: false, items: false, stealPenalty: false, mapPct: 0 });
  for (const s of ['-보스', '-아이템', '견제 페널티 없음', '-맵 패턴']) assert.ok(off.includes(s), `${s} in ${off.join('/')}`);
  const coop = t({ ...DEFAULT_RULES, coop: true });
  assert.ok(coop.includes(`${RULES.coop.timeSec}초`));
  for (const s of ['보스', '레이저', '피버 ×3 · 7초']) assert.ok(!coop.some((x) => x.replace('-', '') === s), s);
  assert.ok(t({ ...DEFAULT_RULES, survival: true }).includes('30초마다 꼴찌 탈락'));
  assert.ok(t({ ...DEFAULT_RULES, mode: 'arcade' }).includes(`${ARCADE.rounds}라운드 × 30초`));
});
