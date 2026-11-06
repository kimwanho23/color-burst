/**
 * 발사 패턴: 평소처럼 하나씩 나오는 원 사이에 가끔 한 묶음(웨이브)이 섞여 나온다 (클래식·아케이드 공통).
 * 수치는 rules.ts의 RULES.waves에 있다.
 */
import { RULES, makeCircle, type Circle, type ColorIndex, type GameRules, type SpawnOpts } from './rules.ts';

export type WavePattern = 'fan' | 'burst' | 'spiral';
export const WAVE_PATTERNS: readonly WavePattern[] = ['fan', 'burst', 'spiral'];
export const WAVE_NAMES: Record<WavePattern, string> = { fan: '부채꼴', burst: '동시 다발', spiral: '나선' };

/** 다음 웨이브까지 걸리는 시간(ms) */
export const nextWaveIn = (rand = Math.random) => RULES.waves.everyMin + rand() * (RULES.waves.everyMax - RULES.waves.everyMin);

/**
 * 웨이브 원 목록. id는 firstId부터 차례로, 나선은 born이 간격만큼 늦다(서버가 그 시각에 내보낸다).
 * 색은 원마다 평소처럼 굴리고(opts의 색 고정은 따름), 아이템 원은 섞지 않는다.
 */
export function makeWave(
  pattern: WavePattern, firstId: number, now: number, elapsedMs: number, kinds: ColorIndex[], G: GameRules,
  rand = Math.random, opts: SpawnOpts = {},
): Circle[] {
  const W = RULES.waves;
  const base = rand() * Math.PI * 2;
  const n = pattern === 'fan' ? W.fanCount : pattern === 'burst' ? W.burstCount : W.spiralCount;
  const spread = (W.fanSpreadDeg * Math.PI) / 180;
  const out: Circle[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCircle(firstId + i, now, elapsedMs, kinds, G, rand, { ...opts, itemChance: 0 });
    if (pattern === 'fan') c.angle = base - spread + (2 * spread * i) / (n - 1);
    else c.angle = base + (Math.PI * 2 * i) / n;
    if (pattern === 'spiral') c.born = now + i * W.spiralGapMs;
    // 한 묶음은 같은 속도로 날아가야 모양이 유지된다
    if (out.length) c.speed = out[0].speed;
    out.push(c);
  }
  return out;
}
