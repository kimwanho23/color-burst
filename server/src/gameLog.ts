/**
 * 판 기록: 판이 끝날 때 서버 로그에 `[game] {...}` 한 줄 (Render 로그에서 모아 밸런스 판단에 쓴다).
 * 이름·접속 키는 남기지 않는다.
 */
import { readFileSync } from 'node:fs';
import { ARCADE, type PlayerState, type RoomRules } from '@color-burst/shared';

const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version;

export interface GameInfo {
  rules: RoomRules;
  solo: boolean;
  timeAttack: boolean;
  /** 실제 판 길이(ms). 서바이벌은 인원에 따라 다름 */
  roundMs: number;
  /** 순위 순서대로 */
  ranking: readonly PlayerState[];
  now?: Date;
}

export function gameRecord(g: GameInfo) {
  const { rules } = g;
  return {
    v: VERSION,
    at: (g.now ?? new Date()).toISOString(),
    mode: g.timeAttack ? 'timeAttack' : rules.mode,
    team: rules.team,
    survival: rules.survival,
    solo: g.solo,
    /** 아케이드는 라운드 하나 길이 × rounds */
    roundSec: Math.round(g.roundMs / 1000),
    rounds: rules.mode === 'arcade' && !g.timeAttack ? ARCADE.rounds : 1,
    humans: g.ranking.filter((p) => !p.bot).length,
    bots: g.ranking.filter((p) => p.bot).length,
    players: g.ranking.map((p, i) => ({
      rank: i + 1,
      bot: p.bot,
      color: p.color,
      ...(rules.team ? { team: p.team } : {}),
      score: p.score,
      picks: (p.picks ?? []).map((x) => `${x.id}:${x.tier}`),
      stats: p.stats,
    })),
  };
}

export function logGame(g: GameInfo) {
  console.log(`[game] ${JSON.stringify(gameRecord(g))}`);
}
