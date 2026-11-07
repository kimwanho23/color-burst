import { bossState, isFever, isGuarded, isMarked, isOut, type BotLevel, type Circle, type PlayerState } from '@color-burst/shared';

/** gap: 클릭 간격(ms), react: 원이 나온 뒤 반응까지 걸리는 시간(ms) */
const LEVELS = [
  { gap: 1400, react: 600 },
  { gap: 1000, react: 450 },
  { gap: 650, react: 300 },
] as const;

export class Bot {
  private next = 0;
  private skill = 0.8 + Math.random() * 0.3;
  constructor(private level: BotLevel) {}

  /** 일시정지가 풀리면 멈춰 있던 만큼 미룬다 */
  shift(ms: number) { if (this.next) this.next += ms; }

  /** 이번 틱에 가져갈 원을 고른다. 없으면 null */
  think(me: PlayerState, circles: Circle[], players: PlayerState[], now: number): Circle | null {
    const L = LEVELS[this.level];
    if (!this.next) this.next = now + 800 + Math.random() * 600;
    if (now < this.next) return null;
    this.next = now + (L.gap * (0.7 + Math.random() * 0.7)) / this.skill;

    const fever = isFever(me, now);
    const cands = circles.filter((c) => now - c.born > L.react / this.skill && !isOut(c, now) && !isGuarded(c, now));
    if (!cands.length) return null;

    const weights = cands.map((c) => {
      // 보스는 체력이 낮을수록 막타를 노리고 몰려든다
      if (c.kind === 'boss') {
        // 보호막이나 붉은 상태의 보스는 피한다
        const st = bossState(c, now);
        if (st.shielded || st.enraged) return 0;
        return 4 + (1 - (c.hp ?? 1) / (c.maxHp ?? 1)) * 14;
      }
      if (c.kind === 'item') return 5;
      if (c.kind === 'rainbow' || c.kind === 'gold') return 6;
      if (c.kind === me.color) return 5;
      if (c.kind === 'y') return fever ? 5 : 3;
      const owner = players.find((p) => p.color === c.kind);
      if (owner && isMarked(owner, now)) return 4;
      return fever ? 2.5 : 0.5;
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }
}
