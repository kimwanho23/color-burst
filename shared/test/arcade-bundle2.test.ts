import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ABILITY, ASSIST_ABILITIES, AUG, COMBO, DEFAULT_RULES, LAST_PLACE_FINAL_ODDS, LEGEND, RULES, SYN, TIER_ODDS, UNIQUE,
  activePicks, addFever, addUniqueStack, applyItem, autoEveryMs, bossHitInfo, buffOn, combosFor, evolvedOf, extraMult,
  feverMultOf, goldGain, groupPicks, hasLegend, hasLegendPick, isFever, isOrdinary, isSpecial, isUnique, makeBoss, magnetOf,
  modsFor, newPlayer, pickMirror, reachOf, releaseSilence, resolveClaim, resolveMiss, rollOptions, settleFever, shiftTimes,
  stackBonus, startRound, strikeBoss, synergiesFor, toGameRules, treasureEvery, type AbilityId, type Pick, type Tier,
} from '../src/index.ts';

const G = toGameRules({ ...DEFAULT_RULES, mode: 'arcade', comeback: false, missPenalty: true, stealPenalty: true });
const pick = (id: AbilityId, tier: Tier = 0): Pick => ({ id, tier });
const player = (...picks: Pick[]) => Object.assign(newPlayer('a', 'A', 0), { picks });
const enemy = () => newPlayer('b', 'B', 1);
const raw = { rand: () => 0.99 };

test('무의 시간: 원본 빌드는 유지하고 점수·피버·조합·시너지·성장·자동 시전·반사 효과를 끈다', () => {
  const a = player(pick('silence'));
  const b = enemy();
  b.picks = [pick('hammer', 3), pick('magnet'), pick('wideHand'), pick('frenzy', 3), pick('afterglow'),
    pick('comboArtist'), pick('insurance'), pick('drill'), pick('reflect'), pick('autoCharge'), pick('ember'),
    pick('oneWay'), pick('fortress')];
  startRound(b, 1000, G);
  b.stacks.drill = 2;
  b.autoBuffs.magnet = 5000;
  b.buffs.wideHand = 5000;
  b.feverBonus = LEGEND.preheatMult;
  b.feverUntil = 5000;
  assert.ok(feverMultOf(b, G) > G.feverMult);
  assert.ok(combosFor(b).has('comboMachine'));
  assert.equal(addFever(a, 100, 1100, G, [a, b], true), true);
  assert.equal(b.silencedUntil, 1100 + UNIQUE.silenceMs);
  assert.deepEqual(activePicks(b).map((p) => p.id), ['oneWay', 'fortress']);
  assert.equal(b.picks.length, 13);
  assert.equal(feverMultOf(b, G), G.feverMult);
  assert.equal(isFever(b, 1300), true);
  assert.equal(hasLegend(b, 'hammer'), false);
  assert.equal(combosFor(b).size, 0);
  assert.equal(synergiesFor(b).size, 0);
  assert.deepEqual(stackBonus(b), { own: 0, feverMult: 0, jackpot: 0 });
  assert.equal(bossHitInfo(b, raw.rand).hit, RULES.boss.hit);
  assert.equal(autoEveryMs(b, 'autoCharge'), Infinity);
  assert.equal(magnetOf(b, 1300), 0);
  assert.equal(reachOf(b, 1300), RULES.items.wideHand);
  assert.equal(buffOn(b, 'magnet', 1300), false);
  resolveClaim(a, b.color, [a, b], 1400, G, raw);
  assert.equal(b.reflectLeft, 1);
  shiftTimes(b, 2000, 5000);
  assert.equal(releaseSilence(b, 8099), false);
  assert.equal(releaseSilence(b, 8100), true);
  assert.equal(modsFor(b).hammer, ABILITY.hammer.values[3]);
});

test('무의 시간: 즉시 피버로 발동, 다시 걸리면 갱신, 걸린 상대의 무의 시간은 발동하지 않음', () => {
  const a = player(pick('silence'));
  const b = Object.assign(enemy(), { picks: [pick('silence')] });
  const c = Object.assign(newPlayer('c', 'C', 2), { picks: [pick('silence')], team: 0 });
  a.team = 0; b.team = 1;
  const rules = { ...G, team: true };
  const players = [a, b, c];
  applyItem(a, 'instantFever', 1000, rules, players);
  assert.equal(b.silencedUntil, 3000);
  addFever(b, 100, 1500, rules, players, true);
  assert.equal(a.silenced, false);
  assert.equal(c.silenced, false);
  addFever(c, 100, 2000, rules, players, true);
  assert.equal(b.silencedUntil, 4000);
});

test('거울: 상대 팀 1등의 일반 증강만 복사하고 중첩 상한·레전드를 적용한다', () => {
  const a = player(pick('mirror'), pick('jackpot', 3), pick('comboArtist'));
  const b = Object.assign(enemy(), { score: 50, team: 1, picks: [pick('silence'), pick('jackpot', 3), pick('oneWay'), pick('flip')] });
  const c = Object.assign(newPlayer('c', 'C', 2), { score: 100, picks: [pick('insurance')] });
  a.score = 200;
  a.mirror = pickMirror(a, [a, b, c], true, raw.rand);
  assert.deepEqual(a.mirror, pick('jackpot', 3));
  assert.equal(modsFor(a).jackpot, 35);
  assert.equal(pickMirror(a, [a, b, c], false, raw.rand)?.id, 'insurance');
  a.mirror = pick('insurance', 3);
  assert.equal(combosFor(a).has('comboMachine'), false);
  assert.equal(hasLegend(a, 'insurance'), true);
  a.silenced = true;
  assert.equal(hasLegend(a, 'insurance'), false);
  assert.equal(modsFor(a).insurance, 0);
  b.picks = [pick('silence')];
  assert.equal(pickMirror(a, [a, b], true), null);
});

test('공명 연쇄는 피버 중 게이지가 차지 않아 끝나고, 불씨는 피버마다 한 번만 쌓인다', () => {
  const a = player(pick('resonance'));
  const b = Object.assign(enemy(), { picks: [pick('resonance')], fever: 90, bot: true });
  addFever(a, 100, 1000, G, [a, b], true);
  assert.equal(b.fever, 0);
  assert.equal(b.stats.fevers, 1);
  assert.equal(a.fever, 0);
  assert.ok(isFever(b, 1000));
  const ember = player(pick('ember'));
  for (let n = 0; n < UNIQUE.ember.max + 2; n++) {
    const now = 1000 + n * 50_000;
    addFever(ember, 100, now, G, [ember], true);
    assert.equal(ember.feverUntil, now + G.feverMs + Math.min(n, UNIQUE.ember.max) * UNIQUE.ember.ms);
    settleFever(ember, ember.feverUntil);
    settleFever(ember, now + 49_999);
    assert.equal(ember.stacks.ember, Math.min(n + 1, UNIQUE.ember.max));
  }
  ember.silenced = true;
  addFever(ember, 100, 500_000, G, [ember], true);
  assert.equal(ember.feverUntil, 500_000 + G.feverMs);
});

test('사냥 본능: 보스 처치 관여와 독식, 짧은 라운드 두 배, 다음 보스 점수와 상한', () => {
  const a = player(pick('huntInstinct'));
  const b = Object.assign(enemy(), { picks: [pick('huntInstinct')] });
  const rules = { ...G, roundMs: 30_000 };
  const target = makeBoss(1, 1000, 2, rules, raw.rand);
  target.hp = 1; target.maxHp = 10;
  const hits = new Map([[a.id, 3], [b.id, 6]]);
  assert.equal(strikeBoss(a, target, hits, [a, b], 1200, rules, raw.rand).killed, true);
  assert.equal(a.stacks.huntInstinct, 2);
  assert.equal(b.stacks.huntInstinct, 6);
  addUniqueStack(a, 'huntInstinct', 100);
  assert.equal(a.stacks.huntInstinct, UNIQUE.hunt.max);
  const next = makeBoss(2, 1000, 2, rules, raw.rand);
  next.hp = 20;
  assert.equal(strikeBoss(a, next, new Map(), [a, b], 1400, rules, raw.rand).gained, RULES.boss.hit * 2);
  a.silenced = true;
  assert.equal(strikeBoss(a, next, new Map(), [a, b], 1500, rules, raw.rand).gained, RULES.boss.hit);
});

test('수확과 황금 수집가: 획득 조건, 배율, 상한, 무의 시간', () => {
  const a = player(pick('harvest'));
  a.harvestCount = UNIQUE.harvest.every - 1;
  resolveClaim(a, 0, [a], 1000, G, { via: 'magnet', ...raw });
  assert.equal(a.stacks.harvest, undefined);
  a.silenced = true;
  resolveClaim(a, 0, [a], 1100, G, raw);
  assert.equal(a.harvestCount, UNIQUE.harvest.every - 1);
  a.silenced = false;
  resolveClaim(a, 0, [a], 1200, G, { via: 'save', ...raw });
  assert.equal(a.stacks.harvest, 1);
  assert.equal(extraMult(a, 1200, [a]), 1.02);
  addUniqueStack(a, 'harvest', 100);
  assert.equal(a.stacks.harvest, UNIQUE.harvest.max);
  const gold = player(pick('goldCollector'));
  const base = RULES.gold.points + UNIQUE.gold.points;
  assert.equal(goldGain(gold, 1000, [gold], G, 0, raw.rand).gained, base);
  assert.equal(goldGain(gold, 2000, [gold], G, 0, raw.rand).gained, Math.round(base * 1.05));
  addUniqueStack(gold, 'goldCollector', 100);
  assert.equal(gold.stacks.goldCollector, UNIQUE.gold.max);
  gold.silenced = true;
  assert.equal(goldGain(gold, 3000, [gold], G, 0, raw.rand).gained, RULES.gold.points);
});

test('유니크 확률은 레어에서 이동하고 묶음·게임 제한과 꼴찌 보장을 지킨다', () => {
  assert.deepEqual(TIER_ODDS[2], [40, 27, 30, 3]);
  assert.deepEqual(TIER_ODDS[3], [25, 22, 48, 5]);
  assert.deepEqual([...LAST_PLACE_FINAL_ODDS], [15, 20, 50, 15]);
  let seed = 12;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const [i, last, expected, legend] of [[1, false, 3, 100 / 45], [2, false, 8, 5], [3, false, 10, 100 / 15], [0, true, 3, 1], [3, true, 10, 1500 / 85]] as const) {
    const n = 15_000;
    let uniques = 0, legends = 0;
    for (let k = 0; k < n; k++) {
      const [o] = rollOptions(i, last, rand, { minTier: i ? 1 : 0, curses: 1, unique: true }, 1);
      if (isUnique(o.id)) uniques++;
      if (o.tier === 3) legends++;
    }
    assert.ok(Math.abs(uniques * 100 / n - expected) < 0.8);
    assert.ok(Math.abs(legends * 100 / n - legend) < 0.8);
  }
  for (let k = 0; k < 300; k++) {
    const opts = { minTier: 1, unique: true, guarantee: 3, special: true, forceCurse: true } as const;
    const cards = rollOptions(3, true, rand, opts);
    assert.ok(cards.filter((o) => isUnique(o.id)).length <= 1);
    assert.ok(cards.some((o) => isOrdinary(o.id) && o.tier === 3));
    assert.ok(cards.some((o) => isSpecial(o.id)));
    assert.ok(rollOptions(3, true, rand, { ...opts, owned: [pick('mirror')] }).every((o) => !isUnique(o.id)));
    assert.ok(rollOptions(3, true, rand, { ...opts, allLegend: true }).every((o) => !isUnique(o.id)));
  }
});

test('유니크와 삭제된 증강은 일반 레전드·시너지·진화로 세지 않는다', () => {
  const removed = pick('jammer' as AbilityId, 3);
  const a = player(removed, removed, removed, pick('mirror', 3), pick('mirror'), pick('mirror'), pick('flip', 3));
  assert.equal(hasLegendPick(a.picks), false);
  assert.equal(evolvedOf(a.picks).size, 0);
  assert.equal(groupPicks(a.picks).length, 2);
  assert.equal(modsFor(a).mirror, 1);
  assert.equal(synergiesFor(a).size, 0);
  for (const id of ['chainCombo', 'collector', 'jammer'] as AbilityId[]) assert.equal(ABILITY[id], undefined);
});

test('정밀 사격은 사람의 일반 원 직접 명중만 적용하며 레전드 콤보와 진화 상한을 적용한다', () => {
  assert.equal(AUG.preciseR, 0.4);
  assert.ok(ASSIST_ABILITIES.includes('precise'));
  const a = player(pick('precise', 3), pick('precise', 3), pick('precise', 3));
  assert.equal(modsFor(a).precise, 3);
  const hit = resolveClaim(a, 0, [a], 100, G, { precise: true, ...raw });
  assert.equal(hit.gained, RULES.points.own * 4);
  assert.equal(a.combo, 2);
  assert.equal(hit.precise, true);
  for (const via of ['range', 'magnet', 'save', 'blast', 'zone'] as const) {
    assert.equal(resolveClaim(a, 0, [a], 200, G, { via, precise: true, ...raw }).precise, undefined);
  }
  for (const kind of ['boss', 'gold', 'item'] as const) {
    assert.equal(resolveClaim(a, kind, [a], 300, G, { precise: true, ...raw }).precise, undefined);
  }
  a.bot = true;
  assert.equal(resolveClaim(a, 0, [a], 400, G, { precise: true, ...raw }).precise, undefined);
});

test('방패는 보험보다 먼저 횟수를 쓰고 저격의 콤보 초기화도 막는다', () => {
  const a = player(pick('shield'), pick('insurance'), pick('insurance'));
  const b = enemy();
  startRound(a, 1000, G);
  a.combo = 10; a.score = 100;
  resolveMiss(a, 1100, G, [a, b]);
  assert.deepEqual([a.combo, a.shieldLeft], [10, 0]);
  resolveMiss(a, 1200, G, [a, b]);
  assert.ok(a.combo > 0 && a.combo < 10);
  startRound(a, 2000, G);
  a.combo = 10;
  applyItem(b, 'snipe', 2100, G, [a, b]);
  assert.deepEqual([a.combo, a.shieldLeft], [10, 0]);
  applyItem(b, 'snipe', 2200, G, [a, b]);
  assert.deepEqual([a.combo, a.comboPaidTo], [0, 0]);
});

test('도발은 상대의 남은 게이지만 가져오며 충전 보정을 적용하지 않는다', () => {
  const a = player(pick('taunt', 3), pick('overcharge', 3));
  const b = enemy();
  a.fever = 20; b.fever = 4;
  resolveClaim(a, b.color, [a, b], 1000, { ...G, stealPenalty: false }, raw);
  assert.equal(a.fever, 24);
  assert.equal(b.fever, 0);
});

test('부분 콤보 손실 후 이미 받은 보너스와 단련 칸은 콤보 0 이후에만 다시 받는다', () => {
  const a = player(pick('shield'), pick('insurance', 1), pick('rebound'), pick('drill', 3));
  startRound(a, 1000, G);
  a.combo = 9;
  assert.equal(resolveClaim(a, 0, [a], 1100, G, raw).comboBonus, true);
  assert.equal(a.stacks.drill, 1);
  resolveMiss(a, 1200, G, [a]);
  resolveMiss(a, 1300, G, [a]);
  assert.equal(a.combo, 8);
  resolveClaim(a, 0, [a], 1400, G, raw);
  assert.equal(resolveClaim(a, 0, [a], 1500, G, raw).comboBonus, false);
  assert.equal(a.stacks.drill, 1);
  while (a.combo) resolveMiss(a, 1600, G, [a]);
  assert.equal(a.comboPaidTo, 0);
  a.combo = 9;
  assert.equal(resolveClaim(a, 0, [a], 2000, G, raw).comboBonus, true);
  assert.equal(a.stacks.drill, 2);
});

test('물들이기와 미식가가 함께 적용돼도 노란 원에 편식가 레전드 피버 게이지 2배', () => {
  const a = player(pick('picky', 3), pick('yellowTaste'));
  a.buffs.paint = 2000;
  resolveClaim(a, 'y', [a], 1000, G, raw);
  assert.equal(a.fever, RULES.fever.own * LEGEND.pickyFeverMult * G.feverGain);
});

test('보물 상자 간격과 잡화점 아이템 지속 시간', () => {
  assert.deepEqual(ABILITY.treasure.values.map(treasureEvery), [20, 15, 12, 8]);
  assert.equal(treasureEvery(2 * ABILITY.treasure.values[0]), 10);
  assert.equal(treasureEvery(1000), 6);
  const a = player(pick('treasure'), pick('itemLover'));
  applyItem(a, 'wideHand', 1000, G, [a]);
  assert.equal(a.buffs.wideHand, 1000 + RULES.items.ms.wideHand * COMBO.bazaarDur + SYN.buffAddMs);
  a.silenced = true;
  a.buffs = {};
  applyItem(a, 'wideHand', 1000, G, [a]);
  assert.equal(a.buffs.wideHand, 1000 + RULES.items.ms.wideHand);
});

test('게임 효과는 원본 증강 목록에서 직접 수치를 계산하지 않는다', () => {
  for (const root of ['../../shared/src/', '../../server/src/', '../../client/src/']) {
    const dir = new URL(root, import.meta.url);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'arcade.ts') continue;
      const lines = readFileSync(new URL(name, dir), 'utf8').split('\n');
      for (const line of lines) {
        if (line.includes('// raw-picks')) continue;
        assert.doesNotMatch(line, /\b(?:modsOf|legendOf|combosOf|synergiesOf|synergyProgress)\(\s*\w+\??\.picks\s*\)/, name);
      }
    }
  }
});
