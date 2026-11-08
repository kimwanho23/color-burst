/**
 * 보스 한 번 타격: 피해·점수·콤보·피버 게이지·막타·독식·MVP를 계산해 바로 반영한다 (서버가 부른다).
 * 원 삭제·알림·자동 획득(사냥꾼 레전드·점화)은 부르는 쪽이 한다.
 */
import { AUG, COMBO, LEGEND, combosOf, hasLegend, jackpotMult, modsOf } from './arcade.ts';
import {
  RULES, addFever, afterMultOf, bossHitInfo, bossState, capMult, circlePos, comboBonusOf, extraMult, feverMultOf, isFever, itemMult,
  luckyMods, ragePenalty, settleFever, zoneMult, zoneOf, type Circle, type GameRules, type PlayerState,
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
  /** 막타 + 독식 점수 */
  killGained: number;
  killJackpot: number;
  /** 최대 체력의 RULES.boss.solo.pct% 이상을 혼자 깎고 처치 */
  solo: boolean;
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
 * - 막타: 독식이면 막타 점수 ×killMult와 독식 보너스, 보스 헌터면 독식 때 피버 게이지. MVP는 고정 점수
 */
export function strikeBoss(
  p: PlayerState, c: Circle, hits: Map<string, number>, players: PlayerState[], now: number, G: GameRules, rand: () => number = Math.random,
): BossStrike {
  const out: BossStrike = {
    blocked: false, enraged: false, damage: 0, gained: 0, jackpot: 1, killed: false, killGained: 0, killJackpot: 1,
    solo: false, mvp: null, mvpGained: 0, feverStarted: false, comboBonus: false,
  };
  const B = RULES.boss;
  const st = bossState(c, now);
  const K = combosOf(p.picks);
  if (st.shielded && !hasLegend(p, 'crusher')) { out.blocked = true; return out; }
  if (st.enraged && !K.has('bossHunter')) {
    const lose = Math.min(p.score, ragePenalty(p));
    p.score -= lose;
    out.enraged = true; out.gained = -lose;
    return out;
  }
  settleFever(p, now);
  const m = modsOf(p.picks);
  const info = bossHitInfo(p, rand);
  // 선봉 레전드: 등장 3초 안 피해 2배
  const early = hasLegend(p, 'vanguard') && now - c.born <= AUG.vanguardMs ? LEGEND.vanguardMult : 1;
  const hp = c.hp ?? 1;
  const dmg = Math.min(info.damage * early, hp);
  const first = !hits.has(p.id);
  hits.set(p.id, (hits.get(p.id) ?? 0) + dmg);
  c.hp = hp - dmg;
  out.damage = dmg;
  p.stats.bossHits++;

  // 콤보·피버 게이지 (피버가 이번에 시작돼도 이번 타격 배율은 시작 전 기준)
  const fever = isFever(p, now), after = !fever && now < p.afterUntil;
  const before = p.combo;
  p.combo++;
  p.stats.maxCombo = Math.max(p.stats.maxCombo, p.combo);
  p.roundMaxCombo = Math.max(p.roundMaxCombo, p.combo);
  const bonus = comboBonusOf(p, before, fever);
  out.comboBonus = bonus > 0;
  if (addFever(p, B.feverGain, now, G, players)) out.feverStarted = true;

  const mult = capMult((fever ? feverMultOf(p, G) : after ? afterMultOf(p) : 1) * info.boost * itemMult(p, now, true)
    * zoneMult(zoneOf(circlePos(c, now)), m) * extraMult(p, now, players));
  const lucky = luckyMods(p, m), jl = hasLegend(p, 'jackpot');
  out.jackpot = jackpotMult(lucky, rand, jl);
  const vanguard = first && m.vanguard > 0 ? m.vanguard : 1;
  out.gained = Math.round((info.hit * dmg * vanguard + bonus) * mult * out.jackpot);
  p.score += out.gained;

  if (c.hp <= 0) {
    out.killed = true;
    p.stats.bossKills++;
    const S = B.solo;
    out.solo = (hits.get(p.id) ?? 0) * 100 >= (c.maxHp ?? hp) * S.pct;
    out.killJackpot = jackpotMult(lucky, rand, jl);
    out.killGained = Math.round(info.kill * (out.solo ? S.killMult : 1) * mult * out.killJackpot) + (out.solo ? Math.round(S.points * mult) : 0);
    p.score += out.killGained;
    // 보스 헌터 조합: 독식하면 피버 게이지
    if (out.solo && K.has('bossHunter') && addFever(p, COMBO.bossSoloFever, now, G, players, true)) out.feverStarted = true;
    // 최다 타격: 동점이면 막타 친 사람 우선, 그다음 먼저 때린 사람
    let best = 0;
    for (const [pid, n] of hits) if (n > best || (n === best && pid === p.id)) { best = n; out.mvp = pid; }
    const mvpP = players.find((x) => x.id === out.mvp);
    if (mvpP) { mvpP.score += B.mvp; out.mvpGained = B.mvp; }
  }
  if (out.feverStarted) p.stats.fevers++;
  return out;
}
