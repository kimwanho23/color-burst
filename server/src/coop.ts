/**
 * 협력전 한 판: 생명·단계·받은 카드·투표·보스 공격 일정.
 * 방(room.ts)은 CoopHost를 넘기고 tick·클릭·원 이탈·피격·일시정지 시각 밀기·판 끝에서만 부른다.
 * 계산은 shared/src/coop.ts, 수치는 RULES.coop.
 */
import {
  RULES, applyRaidDamage, attackGap, circlePos, coopPhase, coopStars, drawCards, immuneMs, makePattern, makeRaid, makeThreat,
  raidDamage, raidMaxHp, rollVolley, tallyVotes, threatSpeed, addSrc,
  type Circle, type CoopCardId, type CoopHitBy, type CoopLevel, type CoopPhase, type CoopResult, type CoopState, type CoopVote,
  type LaserLine, type MapPattern, type PatternId, type PlayerState, type ServerToClient,
} from '@color-burst/shared';

const C = RULES.coop;

export interface CoopHost {
  players(): PlayerState[];
  emit<E extends keyof ServerToClient>(ev: E, ...args: Parameters<ServerToClient[E]>): void;
  nextId(): number;
  /** circles에 넣고 circle:spawn */
  addCircle(c: Circle): void;
  removeCircles(pred: (c: Circle) => boolean): void;
  /** room.lasers에 넣고 laser:warn */
  fireLaser(lines: LaserLine[], at: number): void;
  clearLasers(): void;
  /** 맵 패턴 예약(경고 시각이 되면 나타남), null이면 지우기 */
  setPattern(p: MapPattern | null): void;
  /** 판 시계 멈춤 (투표) */
  pauseForVote(now: number): void;
  /** 투표가 끝나 다시 시작 (카운트다운) */
  resumeAfterVote(): void;
  eliminate(p: PlayerState, now: number): void;
  finish(win: boolean): void;
  emitPlayers(): void;
  feverOn(p: PlayerState, now: number): boolean;
  /** 레이저 맞는 거리 (난이도 두께) */
  laserHalf(): number;
}

type Timer = ReturnType<typeof setTimeout>;

export class CoopRun {
  phase: CoopPhase = 1;
  cards: CoopCardId[] = [];
  boss: Circle | null = null;
  private vote: { options: CoopCardId[]; until: number; votes: Map<string, CoopCardId> } | null = null;
  /** 단계 전환 중 (보스 무적 ~ 투표 ~ 재개 전) */
  private shifting = false;
  private invulnUntil = 0;
  private next: Record<'laser' | 'threat' | 'hazard', number> = { laser: 0, threat: 0, hazard: 0 };
  private targetTurn = 0;
  /** 투표 뒤 재개되면 첫 tick에서 공격 일정을 다시 잡는다 */
  private reschedule = false;
  private timers = new Set<Timer>();

  constructor(private host: CoopHost, readonly level: CoopLevel, private rand: () => number = Math.random) {}

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  private humans() { return this.host.players().filter((p) => !p.bot); }
  private alive() { return this.humans().filter((p) => !p.outAt); }

  /** 판 시작: 생명, 레이드 보스, 첫 공격 시각 */
  start(now: number) {
    for (const p of this.host.players()) { p.lives = p.bot ? 0 : C.lives; p.immuneUntil = 0; }
    const ps = this.host.players();
    const hp = raidMaxHp(ps.filter((p) => !p.bot).length, ps.filter((p) => p.bot).length);
    this.boss = makeRaid(this.host.nextId(), now, hp);
    this.host.addCircle(this.boss);
    this.schedule(now);
    this.host.emit('coop:state', this.state());
  }

  /** 지금 단계에서 쓰는 공격의 다음 시각을 정한다 (안 쓰는 공격은 0) */
  private schedule(now: number) {
    const L = C.levels[this.level];
    this.next.laser = now + RULES.laser.startQuietMs + attackGap('laser', this.level, this.phase, this.rand) * (this.phase === 1 ? 0.5 : 1);
    this.next.threat = this.phase >= 2 ? now + attackGap('threat', this.level, this.phase, this.rand) * 0.5 : 0;
    this.next.hazard = this.phase >= 3 ? now + Math.min(L.hazardEvery * 0.5, 4_000) : 0;
  }

  voting() { return !!this.vote; }

  tick(now: number) {
    if (this.shifting || !this.boss) return;
    if (this.reschedule) { this.reschedule = false; this.schedule(now); }
    if (this.next.laser && now >= this.next.laser) {
      const L = C.levels[this.level];
      this.host.fireLaser(rollVolley(this.rand, this.host.laserHalf(), L.volleyOdds).lines, now + L.laserWarnMs);
      this.next.laser = now + attackGap('laser', this.level, this.phase, this.rand);
    }
    if (this.next.threat && now >= this.next.threat) {
      this.spawnThreats(now);
      this.next.threat = now + attackGap('threat', this.level, this.phase, this.rand);
    }
    if (this.next.hazard && now >= this.next.hazard) {
      const hz = C.levels[this.level].hazards as readonly PatternId[];
      const id = hz[Math.floor(this.rand() * hz.length)];
      this.host.setPattern(makePattern(id, now + RULES.patterns.warnMs, this.rand));
      this.next.hazard = now + attackGap('hazard', this.level, this.phase, this.rand);
    }
  }

  /** 공격 원: 보스 자리에서 아래쪽 반원으로 고르게 퍼진다. 표적은 살아 있는 사람 중 돌아가며 */
  private spawnThreats(now: number) {
    const alive = this.alive();
    if (!alive.length || !this.boss) return;
    const from = circlePos(this.boss, now);
    const n = C.levels[this.level].threatCount;
    const sp = threatSpeed(this.level, this.cards);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + 0.76 * ((i + 0.5) / n)) + (this.rand() - 0.5) * 0.15;
      const target = alive[this.targetTurn++ % alive.length].id;
      this.host.addCircle(makeThreat(this.host.nextId(), now, from, a, sp, target));
    }
  }

  /** 레이드 보스 타격. 점수 = 넣은 피해(반올림) × RULES.boss.hit */
  /** killed면 호출 쪽이 이벤트를 보낸 뒤 판을 끝낸다(승리) */
  hitRaid(p: PlayerState, c: Circle, now: number): { dealt: number; gained: number; killed: boolean } {
    if (this.shifting || now < this.invulnUntil || p.outAt) return { dealt: 0, gained: 0, killed: false };
    const fever = this.host.feverOn(p, now);
    const { dealt, crossed } = applyRaidDamage(c, raidDamage(p, this.cards, fever), this.phase);
    const gained = Math.round(dealt) * RULES.boss.hit;
    if (gained) { p.score += gained; addSrc(p, 'boss', gained, { fever }); }
    if (dealt > 0) p.stats.bossHits++;
    const killed = crossed && (c.hp ?? 0) <= 0;
    if (killed) p.stats.bossKills++;
    else if (crossed) this.beginShift(now);
    return { dealt, gained, killed };
  }

  /** 단계 전환 중이거나 투표 중 (일시정지 요청 무시) */
  busy() { return this.shifting || !!this.vote; }

  /** 사람이 나가거나 끊겼을 때: 남은 사람이 모두 투표했으면 마감 */
  recheck() {
    if (!this.alive().length) { this.host.finish(false); return; }
    const v = this.vote;
    if (v && !this.humans().some((x) => x.connected && !v.votes.has(x.id)) && v.votes.size > 0) this.closeVote(Date.now());
  }

  /** 단계 전환: 공격을 모두 지우고, 보스 무적 뒤 투표 */
  private beginShift(now: number) {
    this.shifting = true;
    this.invulnUntil = now + C.phaseInvulnMs;
    this.host.clearLasers();
    this.host.removeCircles((x) => x.kind === 'threat');
    this.host.setPattern(null);
    this.host.emit('coop:state', this.state());
    this.later(C.phaseInvulnMs, () => this.openVote(Date.now()));
  }

  private openVote(now: number) {
    this.vote = { options: drawCards(this.rand), until: now + C.voteSec * 1000, votes: new Map() };
    this.host.pauseForVote(now);
    this.host.emit('coop:vote', this.voteState()!);
    this.host.emit('coop:state', this.state());
    this.later(C.voteSec * 1000, () => this.closeVote(Date.now()));
  }

  pick(playerId: string, card: CoopCardId) {
    const v = this.vote;
    const p = this.humans().find((x) => x.id === playerId);
    if (!v || !p || !v.options.includes(card)) return;
    v.votes.set(playerId, card);
    this.host.emit('coop:votes', Object.fromEntries(v.votes));
    // 연결된 사람이 모두 골랐으면 바로 마감
    const waiting = this.humans().filter((x) => x.connected && !v.votes.has(x.id));
    if (!waiting.length) this.closeVote(Date.now());
  }

  /** 투표 마감: 카드 적용, 다음 단계, 결과를 잠깐 보여 준 뒤 재개 */
  closeVote(_now: number) {
    const v = this.vote;
    if (!v) return;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const card = tallyVotes(v.options, v.votes, this.rand);
    this.vote = null;
    this.cards.push(card);
    if (card === 'heal') for (const p of this.alive()) p.lives = Math.min(C.maxLives, p.lives + 1);
    this.phase = Math.min(3, this.phase + 1) as CoopPhase;
    this.host.emit('coop:card', { card, cards: [...this.cards] });
    this.host.emit('coop:state', this.state());
    this.host.emitPlayers();
    this.later(C.voteResultMs, () => {
      this.shifting = false;
      this.reschedule = true;
      this.host.resumeAfterVote();
    });
  }

  /** 공격 원 터뜨림: 점수 threatPoints (점수 출처 threat) */
  popThreat(p: PlayerState, _c: Circle, _now: number): number {
    const g = C.threatPoints;
    p.score += g;
    addSrc(p, 'threat', g);
    return g;
  }

  /** 생명 −1. 봇·탈락·무적이면 false (호출 쪽은 true일 때만 스턴) */
  damage(p: PlayerState, by: CoopHitBy, now: number, circleId?: number): boolean {
    if (p.bot || p.outAt || now < p.immuneUntil || p.lives <= 0) return false;
    p.lives--;
    p.immuneUntil = now + immuneMs(this.cards);
    this.host.emit('coop:hit', { playerId: p.id, by, lives: p.lives, immuneUntil: p.immuneUntil, ...(circleId !== undefined ? { circleId } : {}) });
    if (p.lives <= 0) {
      this.host.eliminate(p, now);
      if (!this.alive().length) { this.host.finish(false); return true; }
    }
    this.host.emitPlayers();
    return true;
  }

  threatEscaped(c: Circle, now: number) {
    const t = this.humans().find((p) => p.id === c.target);
    if (t && !t.outAt) this.damage(t, 'threat', now, c.id);
  }

  /** 일시정지가 끝나 시각을 민다 (delta ms) */
  shift(delta: number) {
    for (const k of ['laser', 'threat', 'hazard'] as const) if (this.next[k]) this.next[k] += delta;
    if (this.invulnUntil) this.invulnUntil += delta;
  }

  /** 빠른 충전 카드: 피버 게이지 충전 배율 */
  feverGainMult() { return 1 + C.chargePct * this.cards.filter((c) => c === 'charge').length; }

  private voteState(): CoopVote | null {
    const v = this.vote;
    return v ? { options: [...v.options], until: v.until, votes: Object.fromEntries(v.votes) } : null;
  }

  state(): CoopState {
    return {
      level: this.level, phase: this.phase, bossId: this.boss?.id ?? -1, hp: this.boss?.hp ?? 0, maxHp: this.boss?.maxHp ?? 0,
      cards: [...this.cards], voting: this.voteState(),
    };
  }

  result(now: number, startAt: number, win: boolean): CoopResult {
    const hs = this.humans();
    const ratio = hs.length ? hs.filter((p) => !p.outAt).length / hs.length : 0;
    const timeMs = Math.max(0, Math.min(C.timeSec * 1000, now - startAt));
    return {
      win, stars: coopStars(win, ratio, C.timeSec * 1000 - timeMs), timeMs,
      bossHpPct: this.boss ? Math.round(((this.boss.hp ?? 0) / (this.boss.maxHp || 1)) * 100) : 0,
      phase: this.phase, cards: [...this.cards],
    };
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.vote = null;
  }
}
