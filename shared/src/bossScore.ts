/**
 * 보스 한 번 타격: 피해·점수·콤보·피버 게이지·막타·독식·MVP를 계산해 바로 반영한다 (서버가 부른다).
 * 원 삭제·알림·자동 획득(사냥꾼 레전드·점화)은 부르는 쪽이 한다.
 */
import { AUG, COMBO, GROWTH, LEGEND, SOLO_SYNERGY, UNIQUE, combosFor, hasLegend, modsFor } from './arcade.ts';
import {
  RULES, addFever, addLost, addSrc, afterMultOf, scoreBoostOf, bossHitInfo, bossState, capMult, circlePos, comboBonusOf, extraMult, feverMultOf, isFever, itemMult,
  addStack, addUniqueStack, defuseBomb, growthScoreMult, uniqueStacks, drillCheck, ragePenalty, rollJackpot, jackpotHit, settleFever, type Circle, type GameRules, type PlayerState,
} from './rules.ts';

export interface BossStrike {
  /** 방어형 보호막에 막힘 (변화 없음) */
  blocked: boolean;
  /** 붉은 공격형을 때려 감점 (gained가 음수) */
  enraged: boolean;
  /** 실제로 깎은 체력 */
  damage: number;
  /** 타격 점수 (콤보 보너스 포함) */
  gained: number;
  jackpot: number;
  killed: boolean;
  /** 막타 점수 (독식 보너스는 solos) */
  killGained: number;
  killJackpot: number;
  /** 막타 친 사람이 독식했는지 (막타 점수 ×killMult) */
  solo: boolean;
  /** 독식한 사람들 (처치될 때 최대 체력의 RULES.boss.solo.pct% 이상을 깎음, 막타와 따로). 그 사람 배율로 받은 점수 */
  solos: { id: string; gained: number; feverStarted: boolean }[];
  mvp: string | null;
  mvpGained: number;
  feverStarted: boolean;
  comboBonus: boolean;
}

/**
 * hits: 이 보스에 플레이어별로 깎은 체력 (부르는 쪽이 보스마다 들고 있음).
 * - 보호막: 파쇄 레전드가 아니면 막힘. 붉은 공격형: 보스 헌터 조합이 아니면 감점
 * - 피해(남은 체력까지)만큼 타격 점수, 콤보 +1·피버 게이지 +RULES.boss.feverGain, 콤보 보너스
 * - 배율은 일반 원과 같고(상한 RULES.multCap), 잭팟은 그 위. 선봉은 보스마다 내 첫 타 ×N
 * - 막타: 막타 친 사람이 독식했으면 막타 점수 ×killMult. 독식 보너스는 막타와 따로 절반 이상 깎은 사람 모두(보스 헌터면 피버 게이지). MVP는 고정 점수
 */
/** 보스 점수의 피버 배율: 방 규칙 피버 배율까지만 (증강으로 올린 몫은 일반 원에만) */
export const bossFeverMult = (p: PlayerState, G: GameRules) => Math.min(feverMultOf(p, G), G.feverMult);

const finisherUses = new WeakMap<Circle, Set<string>>();

const huntMult = (p: PlayerState) => 1 + uniqueStacks(p, 'huntInstinct') * UNIQUE.hunt.pct / 100;

export function strikeBoss(
  p: PlayerState, c: Circle, hits: Map<string, number>, players: PlayerState[], now: number, G: GameRules, rand: () => number = Math.random,
): BossStrike {
  const out: BossStrike = {
    blocked: false, enraged: false, damage: 0, gained: 0, jackpot: 1, killed: false, killGained: 0, killJackpot: 1,
    solo: false, solos: [], mvp: null, mvpGained: 0, feverStarted: false, comboBonus: false,
  };
  const B = RULES.boss;
  const st = bossState(c, now);
  const K = combosFor(p);
  if (st.shielded && !hasLegend(p, 'crusher')) { out.blocked = true; return out; }
  if (st.enraged && !K.has('bossHunter')) {
    const lose = Math.min(p.score, ragePenalty(p));
    p.score -= lose;
    addLost(p, lose);
    out.enraged = true; out.gained = -lose;
    return out;
  }
  p.previousOwnZone = null;
  settleFever(p, now);
  const m = modsFor(p);
  const info = bossHitInfo(p, rand);
  // 선봉 레전드: 등장 3초 안 피해 2배
  const early = hasLegend(p, 'vanguard') && now - c.born <= AUG.vanguardMs ? LEGEND.vanguardMult : 1;
  const hp = c.hp ?? 1;
  // 최대 체력이 없는 원은 첫 타격 때 체력을 최대로 본다 (makeBoss는 항상 넣어 주므로 일반 보스는 해당 없음)
  const maxHp = (c.maxHp ??= hp);
  const dmg = Math.min(info.damage * early, hp);
  const first = !hits.has(p.id);
  hits.set(p.id, (hits.get(p.id) ?? 0) + dmg);
  c.hp = hp - dmg;
  out.damage = dmg;
  p.stats.bossHits++;
  defuseBomb(p, now);

  // 콤보·피버 게이지 (피버가 이번에 시작돼도 이번 타격 배율은 시작 전 기준)
  const fever = isFever(p, now), after = !fever && now < p.afterUntil;
  const before = p.combo;
  p.combo++;
  p.stats.maxCombo = Math.max(p.stats.maxCombo, p.combo);
  p.roundMaxCombo = Math.max(p.roundMaxCombo, p.combo);
  let bonus = comboBonusOf(p, before, fever);
  bonus += drillCheck(p, before, bonus);
  p.comboPaidTo = Math.max(p.comboPaidTo ?? 0, p.combo);
  out.comboBonus = bonus > 0;
  if (addFever(p, B.feverGain, now, G, players)) out.feverStarted = true;

  const mult = capMult((fever ? bossFeverMult(p, G) : after ? afterMultOf(p) : 1) * info.boost * itemMult(p, now, true)
    * extraMult(p, now, players) * huntMult(p)); // 점수 구역 배율은 보스에 곱하지 않는다 (큰 보스가 가장자리 ×3을 너무 쉽게 받음)
  out.jackpot = rollJackpot(p, m, rand);
  if (out.jackpot > 1 && jackpotHit(p, now, G, players)) out.feverStarted = true;
  const vanguard = first && m.vanguard > 0 ? m.vanguard : 1;
  // 타격 점수는 클릭 한 번당 (피해와 곱하지 않음: 파쇄·막타 독식의 피해는 처치·막타·독식 경쟁에만)
  const hitScore = Math.round((info.hit * vanguard + bonus) * mult * out.jackpot);
  out.gained = hitScore;
  addSrc(p, 'boss', hitScore, { fever, jackpot: out.jackpot });
  if (m.finisher && c.boss !== 'raid' && hp * 100 <= maxHp * SOLO_SYNERGY.finisherHpPct) {
    const paid = finisherUses.get(c) ?? new Set<string>();
    if (!paid.has(p.id)) {
      paid.add(p.id);
      finisherUses.set(c, paid);
      out.gained += m.finisher;
      addSrc(p, 'boss', m.finisher);
    }
  }
  p.score += out.gained;

  if (c.hp <= 0) {
    out.killed = true;
    p.stats.bossKills++;
    const S = B.solo;
    const isSolo = (id: string) => (hits.get(id) ?? 0) * 100 >= maxHp * S.pct;
    out.solo = isSolo(p.id);
    out.killJackpot = rollJackpot(p, m, rand);
    if (out.killJackpot > 1 && jackpotHit(p, now, G, players)) out.feverStarted = true;
    out.killGained = Math.round(info.kill * (out.solo ? S.killMult : 1) * mult * out.killJackpot);
    p.score += out.killGained;
    addSrc(p, 'boss', out.killGained, { fever, jackpot: out.killJackpot });
    // 독식: 막타와 따로, 절반 이상 깎은 사람마다 그 사람 배율로 (막타 친 사람은 이번 타격 배율). 보스 헌터 조합이면 피버 게이지
    for (const [id] of hits) {
      const q = players.find((x) => x.id === id);
      // 서바이벌에서 탈락한 사람은 독식을 받지 않는다
      if (!q || q.outAt || !isSolo(id)) continue;
      const qFever = isFever(q, now);
      const qMult = q === p ? mult : capMult((qFever ? bossFeverMult(q, G) : now < q.afterUntil ? afterMultOf(q) : 1)
        * scoreBoostOf(modsFor(q)) * itemMult(q, now, false) * extraMult(q, now, players) * huntMult(q));
      const gained = Math.round(S.points * qMult);
      q.score += gained;
      addSrc(q, 'boss', gained, { fever: q === p ? fever : qFever });
      const started = combosFor(q).has('bossHunter') && addFever(q, COMBO.bossSoloFever, now, G, players, true);
      if (started && q === p) out.feverStarted = true;
      else if (started) q.stats.fevers++;
      out.solos.push({ id, gained, feverStarted: started });
    }
    // 최다 타격: 동점이면 막타 친 사람 우선, 그다음 먼저 때린 사람
    let best = 0;
    for (const [pid, n] of hits) {
      if (players.find((x) => x.id === pid)?.outAt) continue; // 탈락한 사람은 MVP 제외
      if (n > best || (n === best && pid === p.id)) { best = n; out.mvp = pid; }
    }
    const mvpP = players.find((x) => x.id === out.mvp);
    if (mvpP) {
      out.mvpGained = Math.round(B.mvp * capMult(huntMult(mvpP) * growthScoreMult(mvpP)));
      mvpP.score += out.mvpGained;
      addSrc(mvpP, 'boss', out.mvpGained);
    }
    for (const q of players) {
      const contributed = hits.get(q.id) ?? 0;
      if (q.outAt || contributed < 1) continue;
      const solo = isSolo(q.id);
      // 토벌대 조합: 왕의 증표 기여도 계산에서 내 피해 ×1.5
      const crownShare = contributed * (combosFor(q).has('raidParty') ? RULES.combos.raidCrownMult : 1);
      if (q.id === p.id || crownShare * 100 >= maxHp * GROWTH.crown.assistPct) {
        const stacks = solo && hasLegend(q, 'crownMark') ? LEGEND.crownSoloStacks : 1;
        addStack(q, 'crownMark', stacks);
      }
      const amount = solo ? UNIQUE.hunt.solo : UNIQUE.hunt.assist;
      addUniqueStack(q, 'huntInstinct', amount * (G.roundMs < UNIQUE.hunt.shortRoundMs ? 2 : 1));
    }
  }
  if (out.feverStarted) p.stats.fevers++;
  return out;
}
