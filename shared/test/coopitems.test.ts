import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COOP_ITEM_IDS, RULES, circlePos, coopDamageMult, makeOrb, makeVolley, orbDamage, rollCoopItem,
  type Circle, type CoopFx, type CoopItemId, type CoopState, type PlayerState, type Volley,
} from '../src/index.ts';
import { Room } from '../../server/src/room.ts';

mock.method(console, 'log', () => {});
const sent: { ev: string; d: unknown }[] = [];
const fakeIo = () => ({ to: () => ({ emit(ev: string, d?: unknown) { sent.push({ ev, d }); } }), sockets: { sockets: new Map() } }) as never;
const C = RULES.coop, I = RULES.coop.items;

type Run = {
  phase: number; boss: Circle; tick(now: number): void; shift(delta: number): void;
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number; killed: boolean };
  hitCrystal(p: PlayerState, c: Circle, now: number): boolean;
  damage(p: PlayerState, by: 'bullet' | 'laser', now: number): boolean;
  applyItem(p: PlayerState, item: CoopItemId, now: number, at: { x: number; y: number }): void;
  state(withVolleys?: boolean): CoopState; isShielded(): boolean; inBurst(now: number): boolean;
  result(now: number, startAt: number, win: boolean): { players: Record<string, { dmg: number }> };
  rand: () => number; volleys: Volley[];
};
type CRoom = { coop: Run; startAt: number; circles: Map<number, Circle>; clickLog: Map<string, number[]>; botCandidates(): Circle[] };

function coopRoom(humans = 1, bots = 0, level: 'easy' | 'normal' | 'hard' | 'expert' = 'normal') {
  const room = new Room(fakeIo(), 'ITEM', () => {});
  const ids: string[] = [];
  for (let i = 0; i < humans; i++) ids.push((room.join(`s${i}`, `k${i}`, `P${i}`) as { id: string }).id);
  room.setRules(ids[0]!, { rules: { coop: true, coopLevel: level } });
  for (let i = 0; i < bots; i++) room.addBot(ids[0]!);
  for (const id of ids.slice(1)) room.setReady(id, true);
  sent.length = 0;
  assert.equal(room.start(ids[0]!), null);
  const r = room as unknown as CRoom;
  const me = room.players.find((p) => p.id === ids[0])!;
  return { room, r, me };
}
const orbOf = (kind: Circle['kind'], now: number) => makeOrb(9000 + Math.floor(Math.random() * 1e6), now, { x: 550, y: 600 }, 0, kind, 0);
const AT = { x: 500, y: 700 };
const fx = (p: PlayerState) => p.coopFx as CoopFx;

test('rollCoopItem: 엑스퍼트는 회복이 안 나옴', () => {
  const seen = { normal: new Set<CoopItemId>(), expert: new Set<CoopItemId>() };
  for (let k = 0; k < 1000; k++) {
    const x = k / 1000;
    seen.normal.add(rollCoopItem('normal', () => x));
    seen.expert.add(rollCoopItem('expert', () => x));
  }
  seen.expert.add(rollCoopItem('expert', () => 0.999999));
  assert.deepEqual([...seen.normal].sort(), [...COOP_ITEM_IDS].sort());
  assert.ok(!seen.expert.has('heal') && !seen.expert.has('healAll'));
  assert.equal(seen.expert.size, 8);
});

test('수치: RULES.coop.items', () => {
  assert.deepEqual(I.chance, { easy: 4, normal: 3, hard: 2.5, expert: 1.5 });
  assert.deepEqual([I.guardMs, I.heal, I.healAll, I.fireMs, I.fireMult, I.powerStep, I.powerMax, I.weakMs, I.weakMult, I.chainN, I.chainMult, I.comboAdd, I.missiles, I.missileGapMs, I.missilePct],
    [3000, 20, 10, 5000, 1.5, 0.2, 3, 5000, 1.2, 3, 2, 10, 8, 200, 0.04]);
});

test('방어막: 3초 안 한 번 막고 사라짐, 3초 뒤엔 못 막음', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.applyItem(me, 'guard', now, AT);
  assert.equal(fx(me).guardUntil, now + I.guardMs);
  sent.length = 0;
  assert.equal(r.coop.damage(me, 'bullet', now + 1000), true, '막은 것도 맞은 것으로 침');
  assert.equal(me.hp, C.hpMax);
  assert.equal(fx(me).guardUntil, 0);
  assert.deepEqual(sent.find((s) => s.ev === 'coop:hit')?.d, { playerId: me.id, by: 'bullet', hp: C.hpMax, dmg: 0, immuneUntil: now + 1000 + C.hurtFx.bullet.immuneMs, blocked: true });
  assert.equal(me.stunUntil, 0, '기절 없음');
  // 막은 뒤 무적(immuneMs) 안의 다음 탄은 피해 없음, 그 뒤엔 맞음
  assert.equal(r.coop.damage(me, 'bullet', now + 1000 + C.hurtFx.bullet.immuneMs - 1), false);
  assert.equal(me.hp, C.hpMax);
  assert.equal(r.coop.damage(me, 'bullet', now + 1000 + C.hurtFx.bullet.immuneMs), true, '무적이 끝나면 맞음');
  assert.equal(me.hp, C.hpMax - C.levels.normal.hurt.bullet);
  me.hp = C.hpMax; me.immuneUntil = 0;
  r.coop.applyItem(me, 'guard', now + 5000, AT);
  assert.equal(r.coop.damage(me, 'bullet', now + 5000 + I.guardMs), true, '3초 뒤엔 못 막음');
  room.destroy();
});

test('공격력 강화: +20%씩 최대 +60%, 단계가 오르면 0', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  for (let k = 0; k < 4; k++) r.coop.applyItem(me, 'power', now, AT);
  assert.equal(fx(me).power, 3);
  assert.ok(Math.abs(coopDamageMult(fx(me), now) - 1.6) < 1e-9);
  // 보호막 → 수정 깸 → 단계 오름
  const b = r.coop.boss;
  b.hp = b.maxHp! * C.phaseAt[0] + 0.5;
  r.coop.catchOrb(me, orbOf(me.color, now), now);
  assert.equal(r.coop.isShielded(), true);
  const c = [...r.circles.values()].find((x) => x.kind === 'crystal' && x.target === me.id)!;
  while (r.circles.has(c.id)) r.coop.hitCrystal(me, c, now + 10);
  assert.equal(r.coop.isShielded(), false);
  assert.equal(fx(me).power, 0);
  room.destroy();
});

test('화력 강화 × 공격력 강화 × 연쇄 폭발이 곱해진다', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.applyItem(me, 'power', now, AT);
  r.coop.applyItem(me, 'power', now, AT);
  r.coop.applyItem(me, 'fire', now, AT);
  r.coop.applyItem(me, 'chain', now, AT);
  me.combo = 0;
  const base = orbDamage(me, me.color, false);
  const want = base * (1 + 2 * I.powerStep) * I.fireMult * I.chainMult;
  for (let k = 0; k < I.chainN; k++) assert.ok(Math.abs(r.coop.catchOrb(me, orbOf(me.color, now + k), now + k).dmg - want) < 1e-9, `연쇄 ${k}`);
  assert.equal(fx(me).chain, 0);
  assert.ok(Math.abs(r.coop.catchOrb(me, orbOf(me.color, now + 10), now + 10).dmg - base * 1.4 * 1.5) < 1e-9, '연쇄 끝');
  const t = now + I.fireMs + 1;
  assert.ok(Math.abs(r.coop.catchOrb(me, orbOf(me.color, t), t).dmg - base * 1.4) < 1e-9, '화력 끝');
  room.destroy();
});

test('미사일: 8발 합계 최대 체력 4% 고정 피해, 경계를 넘지 않음, 보호막 뒤 발은 0', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  (r.coop as unknown as { nextSkill: number }).nextSkill = Infinity;
  (r.coop as unknown as { nextBullet: number }).nextBullet = Infinity;
  const b = r.coop.boss, max = b.maxHp!;
  me.combo = 40;
  r.coop.applyItem(me, 'power', now, AT);
  r.coop.applyItem(me, 'fire', now, AT);
  r.coop.applyItem(me, 'weak', now, AT);
  r.coop.applyItem(me, 'missile', now, AT);
  const m = sent.find((s) => s.ev === 'coop:missile')?.d as { by: string; n: number; gapMs: number; at: number };
  assert.deepEqual([m.by, m.n, m.gapMs], [me.id, I.missiles, I.missileGapMs]);
  const hp0 = b.hp!;
  for (let t = now; t <= m.at + I.missiles * I.missileGapMs; t += 50) r.coop.tick(t);
  assert.ok(Math.abs(hp0 - b.hp! - max * I.missilePct) < 1e-9, String(hp0 - b.hp!));
  assert.ok(Math.abs(r.coop.result(now, r.startAt, false).players[me.id]!.dmg - max * I.missilePct) < 1e-9, '잡은 사람 기록');
  // 경계 바로 위: 경계에서 멈추고 보호막, 남은 발은 0
  const t1 = m.at + 10_000;
  b.hp = max * C.phaseAt[0] + max * I.missilePct / I.missiles * 1.5;
  r.coop.applyItem(me, 'missile', t1, AT);
  const m2 = (sent.filter((s) => s.ev === 'coop:missile').at(-1)!.d) as { at: number };
  // 두 발째에 경계에 닿아 보호막 → 바로 수정을 깨도 남은 발은 들어가지 않음
  for (let t = t1; t <= m2.at + I.missileGapMs; t += 50) r.coop.tick(t);
  assert.equal(r.coop.isShielded(), true);
  assert.ok(Math.abs(b.hp! - max * C.phaseAt[0]) < 1e-9, '경계에서 멈춤');
  const tb = m2.at + I.missileGapMs + 10;
  const cr = [...r.circles.values()].find((x) => x.kind === 'crystal' && x.target === me.id)!;
  while (r.circles.has(cr.id)) r.coop.hitCrystal(me, cr, tb);
  assert.equal(r.coop.isShielded(), false);
  const hpB = b.hp!;
  for (let t = tb; t <= m2.at + I.missiles * I.missileGapMs + 100; t += 50) r.coop.tick(t);
  assert.equal(b.hp, hpB, '보호막 뒤 발은 0');
  room.destroy();
});

test('약점 노출: 보스가 팀 전체의 원 피해를 더 받고 재획득 시 시간만 갱신된다', (t) => {
  const { room, r, me } = coopRoom(2, 1);
  t.after(() => room.destroy());
  const other = room.players.find((p) => p !== me && !p.bot)!;
  const bot = room.players.find((p) => p.bot)!;
  const now = r.startAt + 5000;
  assert.equal(r.coop.state().weakUntil, 0);
  r.coop.applyItem(me, 'weak', now, AT);
  assert.equal(r.coop.state().weakUntil, now + I.weakMs);

  const damage = (p: PlayerState, at: number) => r.coop.catchOrb(p, orbOf(p.color, at), at).dmg;
  for (const p of [me, other, bot]) {
    assert.ok(Math.abs(damage(p, now) - orbDamage(p, p.color, false) * I.weakMult) < 1e-9);
  }

  r.coop.applyItem(other, 'weak', now + 1000, AT);
  assert.equal(r.coop.state().weakUntil, now + 1000 + I.weakMs);
  r.coop.shift(2000);
  const until = r.coop.state().weakUntil;
  assert.equal(until, now + 3000 + I.weakMs);
  assert.ok(Math.abs(damage(me, until - 1) - orbDamage(me, me.color, false) * I.weakMult) < 1e-9);
  assert.ok(Math.abs(damage(me, until) - orbDamage(me, me.color, false)) < 1e-9);
  r.coop.tick(until);
  assert.equal(r.coop.state().weakUntil, 0);
});

test('약점이 노출된 레이드 보스 클릭은 피해나 헛클릭으로 처리하지 않는다', (t) => {
  const { room, r, me } = coopRoom();
  t.after(() => room.destroy());
  r.startAt = Date.now() - 1000;
  const now = Date.now();
  r.coop.applyItem(me, 'weak', now, AT);
  const boss = r.coop.boss;
  const hp = boss.hp;
  const misses = me.stats.misses;
  room.click(me.id, { circleId: boss.id, ...circlePos(boss, now) });
  assert.equal(boss.hp, hp);
  assert.equal(me.stats.misses, misses);
});

test('회복: heal +20, healAll 살아 있는 사람 +10, 100 넘지 않음', () => {
  const { room, r, me } = coopRoom(2, 0);
  const other = room.players.find((p) => p !== me)!;
  const now = r.startAt + 5000;
  me.hp = 50; other.hp = 95;
  r.coop.applyItem(me, 'heal', now, AT);
  assert.equal(me.hp, 70);
  r.coop.applyItem(other, 'heal', now, AT);
  assert.equal(other.hp, C.hpMax);
  other.hp = 40;
  r.coop.applyItem(me, 'healAll', now, AT);
  assert.deepEqual([me.hp, other.hp], [80, 50]);
  other.outAt = now; other.hp = 0;
  r.coop.applyItem(me, 'healAll', now, AT);
  assert.deepEqual([me.hp, other.hp], [90, 0], '탈락한 사람은 그대로');
  room.destroy();
});

test('탄막 지우기: 그 시각 이전 탄과 경고 중인 벽을 모두 지움', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  const from = { x: 550, y: 190 };
  r.coop.volleys.push(makeVolley('ring', 901, now - 100, from, { speed: 260, phase: 1 }, () => 0.5));
  r.coop.volleys.push(makeVolley('wall', 902, now + 1500, from, { speed: 140, phase: 2, gaps: 2 }, () => 0.5));
  sent.length = 0;
  r.coop.applyItem(me, 'clear', now, AT);
  assert.deepEqual(sent.find((s) => s.ev === 'coop:clear')?.d, { before: now });
  assert.equal(r.coop.volleys.length, 0);
  assert.equal(r.coop.inBurst(now), false, '큰 피해 구간이 아님');
  room.destroy();
});

test('콤보 +10', () => {
  const { room, r, me } = coopRoom();
  me.combo = 3;
  r.coop.applyItem(me, 'combo', r.startAt + 5000, AT);
  assert.equal(me.combo, 3 + I.comboAdd);
  room.destroy();
});

test('아이템 원: 보스가 뿜는 원 중 ? 원 (noGuard·coopItem), 봇은 고르지 않음, 잡으면 coop:item', () => {
  const { room, r, me } = coopRoom(1, 1);
  r.coop.rand = () => 0.001; // 아이템 확률 안
  r.coop.tick(r.startAt + 2000);
  const items = [...r.circles.values()].filter((c) => c.coopItem);
  assert.ok(items.length > 0);
  for (const c of items) { assert.equal(c.kind, 'item'); assert.equal(c.noGuard, true); }
  assert.ok(!r.botCandidates().some((c) => c.coopItem), '봇 후보에서 빠짐');
  r.startAt = Date.now() - 1000;
  const now = Date.now();
  const c = { ...items[0]!, id: 80_001, born: now - 100_000, from: { x: 600, y: 700 }, speed: 0 };
  r.circles.set(c.id, c);
  sent.length = 0;
  r.clickLog.clear();
  room.click(me.id, { circleId: c.id, x: 600, y: 700 });
  assert.ok(!r.circles.has(c.id));
  const got = sent.find((s) => s.ev === 'coop:item')?.d as { by: string; item: CoopItemId; circleId: number };
  assert.equal(got.by, me.id);
  assert.equal(got.circleId, c.id);
  assert.ok(COOP_ITEM_IDS.includes(got.item));
  room.destroy();
});

test('아이템 확률: 큰 피해 구간이 끝난 뒤 10초 동안 ×2, 일시정지하면 밀림', () => {
  const { room, r, me } = coopRoom();
  const run = r.coop as unknown as { itemChance(now: number): number };
  const now = r.startAt + 5000;
  assert.equal(run.itemChance(now), I.chance.normal);
  const b = r.coop.boss;
  b.hp = b.maxHp! * C.phaseAt[0] + 0.5;
  r.coop.catchOrb(me, orbOf(me.color, now), now);
  const c = [...r.circles.values()].find((x) => x.kind === 'crystal' && x.target === me.id)!;
  while (r.circles.has(c.id)) r.coop.hitCrystal(me, c, now);
  const end = r.coop.state().burstUntil;
  r.coop.tick(end);
  assert.equal(run.itemChance(end + 1), I.chance.normal * I.boostMult);
  r.coop.shift(1000);
  assert.equal(run.itemChance(end + I.boostMs + 500), I.chance.normal * I.boostMult);
  assert.equal(run.itemChance(end + I.boostMs + 1000), I.chance.normal);
  room.destroy();
});

test('판이 끝나면 효과가 사라짐 (다음 판 시작에 초기화)', () => {
  const { room, r, me } = coopRoom();
  r.coop.applyItem(me, 'power', r.startAt + 5000, AT);
  assert.equal(fx(me).power, 1);
  (room as unknown as { end(): void }).end();
  assert.equal(me.coopFx, undefined);
  room.destroy();
});

test('미사일로 보스를 쓰러뜨리면 이긴 판으로 끝나고 더 돌지 않음', () => {
  const { room, r, me } = coopRoom();
  const now = r.startAt + 5000;
  r.coop.phase = 3;
  r.coop.boss.hp = 0.5;
  r.coop.applyItem(me, 'missile', now, AT);
  sent.length = 0;
  r.coop.tick(now + I.missileFlyMs);
  const over = sent.find((s) => s.ev === 'game:over')?.d as { coop?: { win: boolean } } | undefined;
  assert.equal(over?.coop?.win, true);
  assert.ok(sent.some((s) => s.ev === 'boss:killed'));
  assert.ok(!sent.some((s) => s.ev === 'circle:spawn'), '끝난 뒤 원이 나오지 않음');
  room.destroy();
});

test('방어막: 구역 봉인을 막으면 같은 봉인에 다시 맞지 않음', () => {
  const { room, r, me } = coopRoom();
  const run = r.coop as unknown as { seal: { lanes: number[]; warnAt: number; at: number; until: number } | null; tickSeal(now: number): void };
  const cursors = (r as unknown as { cursors: Map<string, { x: number; y: number; at: number }> }).cursors;
  const now = r.startAt + 5000;
  r.coop.applyItem(me, 'guard', now, AT);
  run.seal = { lanes: [0, 1, 2], warnAt: now - 2000, at: now, until: now + C.seal.ms };
  const tickAt = (t: number) => { cursors.set(me.id, { x: 500, y: 700, at: Date.now() }); run.tickSeal(t); };
  tickAt(now + 10);
  assert.equal(me.hp, C.hpMax, '막음');
  assert.equal(fx(me).guardUntil, 0);
  // 무적(2초)이 끝난 뒤에도 같은 봉인 안이면 다시 맞지 않음
  for (let t = now + 100; t < now + C.seal.ms; t += 250) tickAt(t);
  assert.equal(me.hp, C.hpMax, '같은 봉인에 다시 맞지 않음');
  room.destroy();
});

test('아이템 이름은 설계 표와 같고, 설명의 숫자는 RULES.coop.items에서 온다', async () => {
  const { COOP_ITEMS } = await import('../src/index.ts');
  assert.deepEqual(COOP_ITEM_IDS.map((id) => COOP_ITEMS[id].name),
    ['탄 지우개', '방어막', '응급 치료', '함께 치료', '화력 강화', '공격력 강화', '약점 노출', '연쇄 폭발', '콤보 점화', '미사일 세례']);
  const d = (id: CoopItemId) => COOP_ITEMS[id].desc;
  assert.ok(d('guard').includes(`${I.guardMs / 1000}초`), d('guard'));
  assert.ok(d('heal').includes(`+${I.heal}`), d('heal'));
  assert.ok(d('healAll').includes(`+${I.healAll}`), d('healAll'));
  assert.ok(d('fire').includes(`${I.fireMs / 1000}초`) && d('fire').includes(`×${I.fireMult}`), d('fire'));
  assert.ok(d('power').includes(`+${Math.round(I.powerStep * 100)}%`) && d('power').includes(`+${Math.round(I.powerStep * I.powerMax * 100)}%`), d('power'));
  assert.ok(d('weak').includes(`${I.weakMs / 1000}초`) && d('weak').includes(`+${Math.round((I.weakMult - 1) * 100)}%`), d('weak'));
  assert.ok(d('chain').includes(`${I.chainN}개`) && d('chain').includes(`×${I.chainMult}`), d('chain'));
  assert.ok(d('combo').includes(`${I.comboAdd}`), d('combo'));
  assert.ok(d('missile').includes(`${I.missiles}발`), d('missile'));
  // 소스에 숫자를 직접 적지 않는다 (RULES를 바꾸면 설명도 바뀌게)
  const src = (await import('node:fs')).readFileSync(new URL('../src/coopItems.ts', import.meta.url), 'utf8');
  const table = src.slice(src.indexOf('export const COOP_ITEMS'), src.indexOf('/** 사람마다'));
  assert.ok(!/'[^']*\d[^']*'/.test(table), table);
});

test('도감 탄막 설명: 고유 패턴 간격은 RULES.coop.skillEveryMs', async () => {
  const { bossTabHTML } = await import('../../client/src/codex.ts');
  assert.ok(bossTabHTML().includes(`${C.skillEveryMs / 1000}초마다 고유 패턴`));
});

test('판 기록: 사람마다 아이템별 획득 수 (결과와 gameRecord coopResult.items)', async () => {
  const { gameRecord } = await import('../../server/src/gameLog.ts');
  const { room, r, me } = coopRoom(1, 1);
  const bot = room.players.find((p) => p.bot)!;
  const run = r.coop as unknown as Run & { catchItem(p: PlayerState, c: Circle, now: number): CoopItemId | null };
  const now = r.startAt + 5000;
  const rand = run.rand;
  const got: (CoopItemId | null)[] = [];
  // 가중치가 모두 1이라 0.05 → 첫째(탄 지우개), 0.15 → 둘째(방어막)
  for (const x of [0.05, 0.15, 0.05]) { run.rand = () => x; got.push(run.catchItem(me, orbOf('item', now), now)); }
  run.rand = rand;
  assert.deepEqual(got, ['clear', 'guard', 'clear']);
  assert.equal(run.catchItem(bot, orbOf('item', now), now), null, '봇은 줍지 않음');
  const res = run.result(now + 1000, r.startAt, false) as unknown as { players: Record<string, { items: Partial<Record<CoopItemId, number>> }> };
  assert.deepEqual(res.players[me.id]!.items, { clear: 2, guard: 1 });
  assert.deepEqual(res.players[bot.id]!.items, {});
  const rec = gameRecord({ rules: room.rules, ranking: room.players, roundMs: C.timeSec * 1000, solo: false, coop: res } as never) as { coopResult: { items: Record<string, unknown> } };
  assert.deepEqual(rec.coopResult.items[me.id], { clear: 2, guard: 1 });
  room.destroy();
});
