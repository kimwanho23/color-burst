import { FIELD, bossState, circlePos, combosOf, isFever, isGuarded, isMarked, isOut, ownsKind, type BotLevel, type Circle, type PlayerState } from '@color-burst/shared';

/**
 * gap: 클릭 간격(ms), react: 원이 나온 뒤 반응까지 걸리는 시간(ms).
 * 황금 원은 작고 빨라서 사람처럼 늦게 반응하고(goldDelay만큼 더) 노려도 goldHit 확률로만 맞힌다
 */
const LEVELS = [
  { gap: 1400, react: 600, goldDelay: 1500, goldHit: 0.3 },
  { gap: 1000, react: 450, goldDelay: 1000, goldHit: 0.5 },
  { gap: 650, react: 300, goldDelay: 600, goldHit: 0.7 },
] as const;

export class Bot {
  private next = 0;
  private skill = 0.8 + Math.random() * 0.3;
  constructor(private level: BotLevel) {}

  /** 일시정지가 풀리면 멈춰 있던 만큼 미룬다 */
  shift(ms: number) { if (this.next) this.next += ms; }

  /** 이번 틱에 가져갈 원을 고른다. 없으면 null */
  /** team: 팀전이면 같은 팀 색도 내 색처럼 노린다. coop: 협력전이면 공격 원 → 내 색 → 레이드 보스 (피버 중엔 보스 먼저), 남의 색은 안 노린다 */
  think(me: PlayerState, circles: Circle[], players: PlayerState[], now: number, team = false, coop = false): Circle | null {
    const L = LEVELS[this.level];
    if (!this.next) this.next = now + 800 + Math.random() * 600;
    if (now < this.next) return null;
    this.next = now + (L.gap * (0.7 + Math.random() * 0.7)) / this.skill;

    const fever = isFever(me, now);
    const cands = circles.filter((c) => now - c.born > (L.react + (c.kind === 'gold' ? L.goldDelay : 0)) / this.skill && !isOut(c, now) && !isGuarded(c, now));
    if (!cands.length) return null;

    const weights = cands.map((c) => {
      // 협력전 공격 원: 화면 끝에 가까울수록 먼저
      if (c.kind === 'threat') {
        const q = circlePos(c, now);
        const edge = Math.min(q.x, q.y, FIELD.w - q.x, FIELD.h - q.y);
        return 8 + 24 * (1 - Math.min(1, Math.max(0, edge) / 400));
      }
      if (c.boss === 'raid') return fever ? 14 : 2;
      // 보스는 체력이 낮을수록 막타를 노리고 몰려든다
      if (c.kind === 'boss') {
        // 보호막이나 붉은 상태의 보스는 피한다 (보스 헌터 조합은 붉은 보스도 감점이 없어 때린다)
        const st = bossState(c, now);
        if (st.shielded || (st.enraged && !combosOf(me.picks).has('bossHunter'))) return 0;
        return 4 + (1 - (c.hp ?? 1) / (c.maxHp ?? 1)) * 14;
      }
      if (c.kind === 'item') return 5;
      if (c.kind === 'rainbow' || c.kind === 'gold') return 6;
      if (c.kind === me.color || (team && ownsKind(c.kind, me, players, true))) return 5;
      if (c.kind === 'y') return fever ? 5 : 3;
      if (coop) return 0;
      const owner = players.find((p) => p.color === c.kind);
      if (owner && isMarked(owner, now)) return 4;
      return fever ? 2.5 : 0.5;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    let pick = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { pick = cands[i]; break; } }
    // 황금 원은 노려도 놓칠 수 있다
    if (pick.kind === 'gold' && Math.random() >= L.goldHit) return null;
    return pick;
  }
}
