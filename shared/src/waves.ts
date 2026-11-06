/**
 * 발사 패턴: 평소처럼 하나씩 나오는 원 사이에 가끔 한 묶음(웨이브)이 섞여 나온다 (클래식·아케이드 공통).
 * 수치는 rules.ts의 RULES.waves에 있다.
 */
import { RULES, makeCircle, type Circle, type ColorIndex, type GameRules, type SpawnOpts } from './rules.ts';

export type WavePattern = 'fan' | 'burst' | 'spiral' | 'ring2' | 'twin' | 'stream' | 'sweep';
export const WAVE_PATTERNS: readonly WavePattern[] = ['fan', 'burst', 'spiral', 'ring2', 'twin', 'stream', 'sweep'];
export const WAVE_NAMES: Record<WavePattern, string> = {
  fan: '부채꼴', burst: '동시 다발', spiral: '나선', ring2: '이중 링', twin: '쌍나선', stream: '연속 사출', sweep: '쓸기',
};

/** 다음 웨이브까지 걸리는 시간(ms) */
export const nextWaveIn = (rand = Math.random) => RULES.waves.everyMin + rand() * (RULES.waves.everyMax - RULES.waves.everyMin);

const deg = (d: number) => (d * Math.PI) / 180;

/** 패턴별 원 배치: 각 원의 방향(가운데 방향 base 기준)과 발사 지연(ms) */
function layout(pattern: WavePattern, base: number): { angle: number; delay: number }[] {
  const W = RULES.waves;
  const even = (n: number, i: number, off = 0) => base + off + (Math.PI * 2 * i) / n;
  const out: { angle: number; delay: number }[] = [];
  switch (pattern) {
    case 'fan': {
      const s = deg(W.fanSpreadDeg);
      for (let i = 0; i < W.fanCount; i++) out.push({ angle: base - s + (2 * s * i) / (W.fanCount - 1), delay: 0 });
      break;
    }
    case 'burst':
      for (let i = 0; i < W.burstCount; i++) out.push({ angle: even(W.burstCount, i), delay: 0 });
      break;
    case 'spiral':
      for (let i = 0; i < W.spiralCount; i++) out.push({ angle: even(W.spiralCount, i), delay: i * W.spiralGapMs });
      break;
    case 'ring2':
      // 사방 링 두 겹: 두 번째 링은 조금 늦게, 첫 링 사이사이로
      for (let i = 0; i < W.burstCount; i++) out.push({ angle: even(W.burstCount, i), delay: 0 });
      for (let i = 0; i < W.burstCount; i++) out.push({ angle: even(W.burstCount, i, Math.PI / W.burstCount), delay: W.ring2GapMs });
      break;
    case 'twin':
      // 두 갈래 나선: 정반대 방향에서 같이 돈다
      for (let i = 0; i < W.twinCount; i++) {
        const a = base + (Math.PI / 4) * i;
        out.push({ angle: a, delay: i * W.spiralGapMs }, { angle: a + Math.PI, delay: i * W.spiralGapMs });
      }
      break;
    case 'stream':
      for (let i = 0; i < W.streamCount; i++) out.push({ angle: base, delay: i * W.streamGapMs });
      break;
    case 'sweep': {
      const s = deg(W.sweepDeg);
      for (let i = 0; i < W.sweepCount; i++) out.push({ angle: base - s + (2 * s * i) / (W.sweepCount - 1), delay: i * W.sweepGapMs });
      break;
    }
  }
  return out;
}

/**
 * 웨이브 원 목록. id는 firstId부터 차례로, 늦게 나가는 원은 born이 그만큼 늦다(서버가 그 시각에 내보낸다).
 * 색은 원마다 평소처럼 굴리고(opts의 색 고정은 따름), 아이템 원은 섞지 않는다.
 */
export function makeWave(
  pattern: WavePattern, firstId: number, now: number, elapsedMs: number, kinds: ColorIndex[], G: GameRules,
  rand = Math.random, opts: SpawnOpts = {},
): Circle[] {
  const base = rand() * Math.PI * 2;
  const out: Circle[] = [];
  layout(pattern, base).forEach(({ angle, delay }, i) => {
    const c = makeCircle(firstId + i, now, elapsedMs, kinds, G, rand, { ...opts, itemChance: 0 });
    c.angle = angle;
    c.born = now + delay;
    // 한 묶음은 같은 속도로 날아가야 모양이 유지된다
    if (out.length) c.speed = out[0].speed;
    out.push(c);
  });
  return out;
}
