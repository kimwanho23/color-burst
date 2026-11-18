/**
 * 협력전 한 판: 보스가 원을 뿜고, 잡은 원이 피해가 된다. 체력 구간마다 보호막·수정, 깨면 큰 피해 구간, 못 깨면 분노.
 * 보스 패턴(레이저·추적 원·내려찍기·안전지대)과 맵 패턴 일정, 탄막 일정, 사람마다 기여 기록.
 * 탄막은 무늬 단위(Volley)로 한 번 보내고, 화면이 시각으로 위치를 계산해 제 커서가 맞았는지 알려 온다(reportHurt).
 * 방(room.ts)은 CoopHost를 넘기고 tick·원 잡기·수정 클릭·원 이탈·피격·탄 맞음 보고·일시정지 시각 밀기·판 끝에서만 부른다.
 * 계산은 shared/src/coop.ts, 수치는 RULES.coop.
 */
import {
  COOP_BOSSES, RULES, addSrc, applyRaidDamage, attackGap, circlePos, coopStars, crystalHits, inSafe, makeCrystal, makeOrb, makePattern,
  makeRaid, makeThreat, makeVolley, orbDamage, placeCrystals, raidMaxHp, rollSafe, rollVolley, shotGone, shotPos, threatSpeed, volleyDone,
  type Circle, type CoopHitBy, type CoopLevel, type CoopPhase, type CoopPlayerResult, type CoopResult, type CoopState,
  type LaserLine, type MapPattern, type PatternId, type PlayerState, type Point, type SafeZones, type ServerToClient, type Slam,
  type BulletShape, type Volley,
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
  eliminate(p: PlayerState, now: number): void;
  finish(win: boolean, reason?: CoopResult['reason']): void;
  emitPlayers(): void;
  /** 레이저 맞는 거리 (난이도 두께) */
  laserHalf(): number;
  /** 사람 커서 (없으면 판정하지 않음) */
  cursorOf(id: string): Point | null;
  /** 피격 기절 (레이저와 같은 처리, ms 동안) */
  stun(p: PlayerState, now: number, ms: number): void;
}

type Pattern = 'laser' | 'threat' | 'slam' | 'safe' | 'map';

export class CoopRun {
  phase: CoopPhase = 1;
  boss: Circle | null = null;
  private next: Record<Pattern, number> = { laser: 0, threat: 0, slam: 0, safe: 0, map: 0 };
  /** 사람·봇마다 다음 원 시각 */
  private nextOrb = new Map<string, number>();
  private targetTurn = 0;
  /** 보호막: 시작·제한 시간 끝·몇 번째 */
  private shield: { from: number; until: number; no: 0 | 1; rages: number } | null = null;
  /** 봇 수정을 두드릴 다음 시각 (봇은 제한 시간 안에 반드시 깬다) */
  private botNext = new Map<number, number>();
  private burstUntil = 0;
  private rageAt = 0;
  private slams: Slam[] = [];
  private safe: SafeZones | null = null;
  private stats = new Map<string, CoopPlayerResult>();
  private breaks: { ms: number; rages: number }[] = [];
  /** 큰 피해 구간이 끝나면 다음 단계 패턴 일정을 잡는다 */
  private afterBurst = false;
  /** 진 이유 (결과에 실림) */
  private reason: CoopResult['reason'];
  /** 아직 끝나지 않은 탄막, 탄막마다 이미 받은 맞음 보고 (`${사람}:${탄}`) */
  private volleys: Volley[] = [];
  private hurtSeen = new Map<number, Set<string>>();
  /** 다음 탄막 발사 시각, 조준 무늬 표적 차례, 마지막 tick 시각 (상태의 끝난 탄막 거르기) */
  private nextBullet = 0;
  private aimTurn = 0;
  private clock = 0;

  constructor(private host: CoopHost, readonly level: CoopLevel, private rand: () => number = Math.random) {}

  private humans() { return this.host.players().filter((p) => !p.bot); }
  private alive() { return this.humans().filter((p) => !p.outAt); }
  private stat(id: string) {
    let s = this.stats.get(id);
    if (!s) { s = { dmg: 0, burstDmg: 0, crystals: 0, threats: 0 }; this.stats.set(id, s); }
    return s;
  }

  /** 판 시작: 생명, 레이드 보스, 첫 원·공격 시각 */
  start(now: number) {
    for (const p of this.host.players()) { p.hp = p.bot ? 0 : C.hpMax; p.immuneUntil = 0; this.stat(p.id); }
    const ps = this.host.players();
    const hp = raidMaxHp(ps.filter((p) => !p.bot).length, ps.filter((p) => p.bot).length);
    this.boss = makeRaid(this.host.nextId(), now, hp);
    this.host.addCircle(this.boss);
    for (const p of ps) this.nextOrb.set(p.id, now + this.rand() * this.orbGap());
    this.volleys = []; this.hurtSeen.clear();
    // 다른 공격처럼 시작 조용한 시간 뒤부터
    this.nextBullet = now + RULES.laser.startQuietMs;
    this.clock = now;
    this.schedule(now);
    this.host.emit('coop:state', this.state());
  }

  isShielded() { return !!this.shield; }
  inBurst(now: number) { return now < this.burstUntil; }
  /** 투표가 없어져 늘 false (일시정지 요청을 막을 일이 없다) */
  busy() { return false; }

  private orbGap() { return C.orb.gapMs * C.levels[this.level].orbMult; }

  /** 지금 단계에서 쓰는 패턴의 다음 시각 (안 쓰는 것은 0) */
  private schedule(now: number) {
    const g = (k: Pattern) => attackGap(k, this.level, this.phase, this.rand);
    this.next.laser = now + RULES.laser.startQuietMs + g('laser') * (this.phase === 1 ? 0.5 : 1);
    this.next.threat = now + g('threat') * 0.5;
    this.next.slam = this.phase >= 2 ? now + g('slam') * 0.5 : 0;
    this.next.safe = this.phase >= 3 ? now + g('safe') * 0.5 : 0;
    this.next.map = this.phase >= 2 ? now + Math.min(g('map') * 0.5, 4_000) : 0;
  }

  tick(now: number) {
    if (!this.boss) return;
    // 큰 피해 구간이 끝남: 다음 단계
    if (this.afterBurst && now >= this.burstUntil) {
      this.afterBurst = false;
      this.burstUntil = 0;
      this.schedule(now);
      this.nextBullet = now + this.bulletGap();
      this.host.emit('coop:state', this.state());
    }
    this.tickRage(now);
    this.tickSlams(now);
    this.tickSafe(now);
    this.tickBullets(now);
    if (this.shield) { this.tickBotCrystals(now); if (this.shield && now >= this.shield.until && !this.rageAt) this.startRage(now); return; }
    this.spawnOrbs(now);
    if (this.inBurst(now)) return;
    if (this.next.laser && now >= this.next.laser) {
      const L = C.levels[this.level];
      this.host.fireLaser(rollVolley(this.rand, this.host.laserHalf(), L.volleyOdds).lines, now + L.laserWarnMs);
      this.next.laser = now + attackGap('laser', this.level, this.phase, this.rand);
    }
    if (this.next.threat && now >= this.next.threat) {
      this.spawnThreats(now);
      this.next.threat = now + attackGap('threat', this.level, this.phase, this.rand);
    }
    if (this.next.slam && now >= this.next.slam) {
      this.startSlam(now);
      this.next.slam = now + attackGap('slam', this.level, this.phase, this.rand);
    }
    if (this.next.safe && now >= this.next.safe && !this.safe) {
      this.safe = rollSafe(C.levels[this.level].safeCount, now + C.safe.warnMs, this.rand);
      this.host.emit('coop:safe', this.safe);
      this.next.safe = now + attackGap('safe', this.level, this.phase, this.rand);
    }
    if (this.next.map && now >= this.next.map) {
      const ids = (C.phasePatterns as Record<number, readonly string[]>)[this.phase] as readonly PatternId[] | undefined;
      if (ids?.length) this.host.setPattern(makePattern(ids[Math.floor(this.rand() * ids.length)]!, now + RULES.patterns.warnMs, this.rand));
      this.next.map = now + attackGap('map', this.level, this.phase, this.rand);
    }
  }

  /** 탄막 간격: 평소 bulletEveryMs ÷ 단계 배율(양), 보호막 중 ÷ shieldMult */
  private bulletGap() {
    const B = C.bullets, every = C.levels[this.level].bulletEveryMs;
    return this.shield ? every / B.shieldMult : every / B.phaseMult[this.phase - 1]!;
  }

  /** 탄막 일정: 끝난 탄막을 치우고, 큰 피해 구간이 아니면 간격마다 무늬를 고른다 (평소엔 overlap 확률로 하나 더) */
  private tickBullets(now: number) {
    this.clock = now;
    // 지연 보정 동안은 남겨 둔다 (막 나간 탄의 보고도 받을 수 있게)
    const lag = now - RULES.lagWindowMs;
    if (this.volleys.some((v) => volleyDone(v, lag))) {
      this.volleys = this.volleys.filter((v) => {
        if (!volleyDone(v, lag)) return true;
        this.hurtSeen.delete(v.id);
        return false;
      });
    }
    if (!this.boss || this.inBurst(now) || now < this.nextBullet) return;
    const gap = this.bulletGap();
    // 오래 밀려 있었으면(보호막 직후 등) 지금부터 다시 센다
    const at = this.nextBullet < now - gap ? now : this.nextBullet;
    const boss = COOP_BOSSES.core;
    const pool = this.shield ? boss.shieldBullets[this.shield.no] : boss.bullets[this.phase];
    const pick = () => pool[Math.floor(this.rand() * pool.length)]!;
    this.fireVolley(pick(), at);
    if (!this.shield && this.rand() < C.bullets.overlap[this.phase - 1]!) this.fireVolley(pick(), at);
    this.nextBullet = at + gap;
    if (this.nextBullet <= now) this.nextBullet = now + gap;
  }

  private fireVolley(shape: BulletShape, at: number) {
    if (!this.boss) return;
    let aim: Point | undefined;
    if (shape === 'aimed') {
      // 커서가 있는 살아 있는 사람을 돌아가며 노린다 (아무도 없으면 바로 아래)
      const targets = this.alive().map((p) => this.host.cursorOf(p.id)).filter((q): q is Point => !!q);
      if (targets.length) aim = targets[this.aimTurn++ % targets.length];
    }
    const v = makeVolley(shape, this.host.nextId(), at, circlePos(this.boss, at),
      { speed: C.levels[this.level].bulletSpeed, phase: this.phase, ...(aim ? { aim } : {}) }, this.rand);
    this.volleys.push(v);
    this.host.emit('coop:volley', v);
  }

  /** 지금까지 쏜 탄막을 모두 지운다 (보스가 무너짐) */
  private clearVolleys(now: number) {
    this.volleys = [];
    this.hurtSeen.clear();
    this.host.emit('coop:clear', { before: now });
  }

  /**
   * 화면이 알린 탄 맞음. 탄막이 남아 있고, 그 탄이 쏘아졌고 (지연 보정 lagWindowMs 안에) 판 안에 있었고,
   * 같은 사람이 같은 탄을 처음 알렸고, 살아 있고 연결된 사람일 때만 깎는다 (무적은 damage가 거른다)
   */
  reportHurt(p: PlayerState, volleyId: number, shot: number, now: number): boolean {
    if (p.bot || p.outAt || !p.connected) return false;
    const v = this.volleys.find((x) => x.id === volleyId);
    if (!v || !Number.isInteger(shot) || shot < 0 || shot >= v.shots.length) return false;
    if (!shotPos(v, shot, now) || shotGone(v, shot, now - RULES.lagWindowMs)) return false;
    let seen = this.hurtSeen.get(v.id);
    if (!seen) { seen = new Set(); this.hurtSeen.set(v.id, seen); }
    const key = `${p.id}:${shot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return this.damage(p, v.wall ? 'wall' : 'bullet', now);
  }

  /** 보스가 원을 뿜는다: 사람·봇 한 명당 간격마다 그 색 원(가끔 노란 원). 탈락한 사람 색은 없음 */
  private spawnOrbs(now: number) {
    if (!this.boss) return;
    const base = this.inBurst(now) ? C.burst.orbGapMs : this.orbGap();
    const from = circlePos(this.boss, now);
    for (const p of this.host.players()) {
      if (p.outAt) continue;
      // 봇 색 원은 덜 자주 (판이 봇 원으로 덮이지 않게)
      const gap = p.bot ? base * C.orb.botGapMult : base;
      let at = this.nextOrb.get(p.id) ?? now;
      if (at > now + gap) at = now + gap * this.rand(); // 큰 피해 구간이 시작되면 바로 촘촘하게
      while (at <= now) {
        const kind = this.rand() * 100 < C.orb.yellowPct ? 'y' as const : p.color;
        // 보스는 위쪽에 있으니 아래쪽 반원(양옆 조금 남김)으로만 뿜는다 (위로 가면 보스 몸 위를 지나 곧 판 밖으로 나가 잡을 수 없다)
        const angle = Math.PI * (0.08 + 0.84 * this.rand());
        this.host.addCircle(makeOrb(this.host.nextId(), at, from, angle, kind, C.orb.speed, this.rand));
        at += gap;
      }
      this.nextOrb.set(p.id, at);
    }
  }

  /** 추적 원: 보스 자리에서 아래쪽 반원으로 고르게 퍼진다. 표적은 살아 있는 사람 중 돌아가며 */
  private spawnThreats(now: number) {
    const alive = this.alive();
    if (!alive.length || !this.boss) return;
    const from = circlePos(this.boss, now);
    const n = C.levels[this.level].threatCount;
    const sp = threatSpeed(this.level);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + 0.76 * ((i + 0.5) / n)) + (this.rand() - 0.5) * 0.15;
      const target = alive[this.targetTurn++ % alive.length]!.id;
      this.host.addCircle(makeThreat(this.host.nextId(), now, from, a, sp, target));
    }
  }

  /** 잡은 원(내 색·노랑) → 보스 피해. 보호막이면 0. killed면 호출 쪽이 판을 끝낸다 */
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number; gained: number; killed: boolean } {
    const boss = this.boss;
    if (!boss || this.shield || p.outAt) return { dmg: 0, gained: 0, killed: false };
    const burst = this.inBurst(now);
    const { dealt, crossed } = applyRaidDamage(boss, orbDamage(p, c.kind, burst), this.phase);
    const s = this.stat(p.id);
    s.dmg += dealt;
    if (burst) s.burstDmg += dealt;
    const gained = Math.round(dealt * RULES.boss.hit);
    if (gained) { p.score += gained; addSrc(p, 'boss', gained); }
    if (dealt > 0) {
      const q = circlePos(c, now);
      this.host.emit('coop:orb', { by: p.id, x: q.x, y: q.y, dmg: dealt });
    }
    const killed = crossed && (boss.hp ?? 0) <= 0;
    if (killed) p.stats.bossKills++;
    else if (crossed) this.beginShield(now);
    else this.host.emit('coop:state', this.state());
    return { dmg: dealt, gained, killed };
  }

  /** 보호막: 보스 무적, 원·패턴 멈춤, 살아 있고 연결된 사람·봇마다 자기 색 수정 */
  private beginShield(now: number) {
    const no = (this.phase === 1 ? 0 : 1) as 0 | 1;
    this.shield = { from: now, until: now + C.levels[this.level].crystalSec * 1000, no, rages: 0 };
    this.botNext.clear();
    this.burstUntil = 0;
    this.host.clearLasers();
    this.host.removeCircles((x) => x.kind === 'threat');
    this.clearSlamsSafe();
    const owners = this.host.players().filter((p) => !p.outAt && (p.bot || p.connected));
    const spots = placeCrystals(owners.length, this.rand);
    const hits = crystalHits(this.level, no);
    owners.forEach((p, i) => {
      const at = spots[i] ?? { x: 120 + i * 150, y: 980 };
      this.host.addCircle(makeCrystal(this.host.nextId(), now, at, p.id, p.color, hits));
    });
    this.host.emit('coop:state', this.state());
    if (!owners.length) this.breakShield(now);
  }

  /** 수정 누르기: 주인만, 보호막 중에만. 깨면 true */
  hitCrystal(p: PlayerState, c: Circle, now: number): boolean {
    if (!this.shield || c.kind !== 'crystal' || c.target !== p.id || p.outAt) return false;
    c.hp = Math.max(0, (c.hp ?? 1) - 1);
    this.host.emit('coop:crystal', { id: c.id, hp: c.hp, maxHp: c.maxHp ?? c.hp });
    if (c.hp > 0) return false;
    this.host.removeCircles((x) => x.id === c.id);
    this.stat(p.id).crystals++;
    this.afterCrystalGone(now);
    return true;
  }

  /** 수정이 사라졌을 때: 남은 수정이 없으면 보호막 풀림 */
  private crystals: () => Circle[] = () => [];
  /** 방이 지금 판의 수정 목록을 알려 준다 */
  setCrystalSource(fn: () => Circle[]) { this.crystals = fn; }
  private afterCrystalGone(now: number) {
    if (this.shield && !this.crystals().length) this.breakShield(now);
    else this.host.emit('coop:state', this.state());
  }

  /** 보호막이 풀림: 큰 피해 구간 (패턴 멈춤, 원이 촘촘), 끝나면 다음 단계 */
  private breakShield(now: number) {
    if (!this.shield) return;
    this.breaks.push({ ms: now - this.shield.from, rages: this.shield.rages });
    this.shield = null;
    this.rageAt = 0;
    // 큰 피해는 다음 단계 몫이다 (그 단계의 아래 경계까지만 깎인다). 패턴은 큰 피해 구간이 끝난 뒤 다음 단계 것으로
    this.phase = Math.min(3, this.phase + 1) as CoopPhase;
    this.burstUntil = now + C.burst.ms;
    this.afterBurst = true;
    // 큰 피해 구간 시작: 살아 있는 사람 회복 (엑스퍼트는 없음)
    if (this.level !== 'expert') {
      for (const p of this.alive()) p.hp = Math.min(C.hpMax, p.hp + C.heal.burstStart);
      this.host.emitPlayers();
    }
    this.host.setPattern(null);
    this.host.clearLasers();
    this.clearVolleys(now);
    this.host.emit('coop:state', this.state());
  }

  /** 봇 수정: 제한 시간의 55% 안에 깨지도록 고르게 두드린다 (봇 반응 속도와 상관없이 판이 막히지 않게) */
  private tickBotCrystals(now: number) {
    const sh = this.shield;
    if (!sh) return;
    const limit = C.levels[this.level].crystalSec * 1000;
    for (const c of this.crystals()) {
      const bot = this.host.players().find((p) => p.id === c.target && p.bot);
      if (!bot) continue;
      const gap = (limit * 0.55) / Math.max(1, c.maxHp ?? 1);
      const next = this.botNext.get(c.id) ?? now + gap;
      if (now < next) { this.botNext.set(c.id, next); continue; }
      this.botNext.set(c.id, next + gap);
      this.hitCrystal(bot, c, now);
      if (!this.shield) return;
    }
  }

  /** 제한 시간 초과: 경고 뒤 분노 공격 */
  private startRage(now: number) {
    this.rageAt = now + C.rageWarnMs;
    this.host.emit('coop:state', this.state());
  }

  private tickRage(now: number) {
    if (!this.rageAt || now < this.rageAt || !this.shield) return;
    this.rageAt = 0;
    // 엑스퍼트: 수정 구간을 못 깨면 바로 패배
    if (!Number.isFinite(C.levels[this.level].hurt.rage)) { this.reason = 'crystal'; this.host.finish(false, 'crystal'); return; }
    this.shield.rages++;
    this.botNext.clear();
    for (const p of this.alive()) this.damage(p, 'rage', now);
    if (!this.boss || !this.shield) return; // 판이 끝났거나 탈락으로 보호막이 풀림
    // 남은 수정은 처음 횟수로, 제한 시간 다시
    const hits = crystalHits(this.level, this.shield.no);
    for (const c of this.crystals()) { c.hp = c.maxHp = hits; this.host.emit('coop:crystal', { id: c.id, hp: hits, maxHp: hits }); }
    this.shield.until = now + C.levels[this.level].crystalSec * 1000;
    this.host.emit('coop:state', this.state());
  }

  /** 내려찍기: 살아 있는 사람마다 지금 커서 자리 */
  private startSlam(now: number) {
    const at = now + C.slam.warnMs;
    const made: Slam[] = [];
    for (const p of this.alive()) {
      const q = this.host.cursorOf(p.id);
      if (!q) continue;
      made.push({ id: this.host.nextId(), owner: p.id, x: q.x, y: q.y, r: C.slam.r, at });
    }
    if (!made.length) return;
    this.slams.push(...made);
    this.host.emit('coop:slam', made);
  }

  private tickSlams(now: number) {
    const due = this.slams.filter((s) => now >= s.at);
    if (!due.length) return;
    this.slams = this.slams.filter((s) => now < s.at);
    for (const s of due) {
      for (const p of this.alive()) {
        const q = this.host.cursorOf(p.id);
        if (q && Math.hypot(q.x - s.x, q.y - s.y) <= s.r) this.damage(p, 'slam', now);
      }
    }
  }

  private tickSafe(now: number) {
    const s = this.safe;
    if (!s || now < s.at) return;
    this.safe = null;
    for (const p of this.alive()) {
      const q = this.host.cursorOf(p.id);
      if (q && !inSafe(q, s, now)) this.damage(p, 'safe', now);
    }
    this.host.emit('coop:safe', null);
  }

  private clearSlamsSafe() {
    if (this.slams.length) { this.slams = []; this.host.emit('coop:slam', []); }
    if (this.safe) { this.safe = null; this.host.emit('coop:safe', null); }
  }

  /** 사람이 나가거나 끊겼을 때: 모두 탈락이면 패배, 보호막 중이면 그 사람 수정을 치운다 */
  recheck() {
    if (!this.alive().length) { this.host.finish(false, 'wipe'); return; }
    if (!this.shield) return;
    // 탈락했거나 방에서 빠진 사람만 (잠깐 끊긴 사람은 돌아와서 깰 수 있게 수정을 남긴다)
    const gone = new Set(this.host.players().filter((p) => p.outAt).map((p) => p.id));
    const mine = this.crystals().filter((c) => c.target && (gone.has(c.target) || !this.host.players().some((p) => p.id === c.target)));
    if (mine.length) {
      const ids = new Set(mine.map((c) => c.id));
      for (const id of ids) this.host.emit('coop:crystal', { id, hp: 0, maxHp: 0 });
      this.host.removeCircles((x) => ids.has(x.id));
      this.afterCrystalGone(Date.now());
    }
  }

  /** 추적 원 터뜨림: 점수 threatPoints (점수 출처 threat) */
  popThreat(p: PlayerState, _c: Circle, _now: number): number {
    const g = C.threatPoints;
    p.score += g;
    addSrc(p, 'threat', g);
    this.stat(p.id).threats++;
    return g;
  }

  /** 체력을 hurt[by]만큼 깎고 무적·기절을 건다. 봇·탈락·무적이면 false. hazard의 기절은 방이 따로 건다 */
  damage(p: PlayerState, by: CoopHitBy, now: number, circleId?: number): boolean {
    if (p.bot || p.outAt || now < p.immuneUntil || p.hp <= 0) return false;
    const fx = C.hurtFx[by];
    const before = p.hp;
    p.hp = Math.max(0, p.hp - C.levels[this.level].hurt[by]);
    p.immuneUntil = now + fx.immuneMs;
    this.host.emit('coop:hit', { playerId: p.id, by, hp: p.hp, dmg: before - p.hp, immuneUntil: p.immuneUntil, ...(circleId !== undefined ? { circleId } : {}) });
    if (fx.stunMs > 0 && by !== 'hazard') this.host.stun(p, now, fx.stunMs);
    if (p.hp <= 0) {
      this.host.eliminate(p, now);
      if (!this.alive().length) { this.host.finish(false, 'wipe'); return true; }
      // 보호막 중이면 그 사람 수정은 깬 것으로 친다
      if (this.shield) {
        const ids = new Set(this.crystals().filter((c) => c.target === p.id).map((c) => c.id));
        if (ids.size) {
          for (const id of ids) this.host.emit('coop:crystal', { id, hp: 0, maxHp: 0 });
          this.host.removeCircles((x) => ids.has(x.id));
          this.afterCrystalGone(now);
        }
      }
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
    for (const k of Object.keys(this.next) as Pattern[]) if (this.next[k]) this.next[k] += delta;
    for (const [id, t] of this.nextOrb) this.nextOrb.set(id, t + delta);
    if (this.shield) { this.shield.until += delta; this.shield.from += delta; }
    if (this.burstUntil) this.burstUntil += delta;
    if (this.rageAt) this.rageAt += delta;
    for (const s of this.slams) s.at += delta;
    if (this.safe) this.safe.at += delta;
    for (const v of this.volleys) v.at += delta;
    if (this.nextBullet) this.nextBullet += delta;
    if (this.slams.length) this.host.emit('coop:slam', this.slams);
    if (this.safe) this.host.emit('coop:safe', this.safe);
    this.host.emit('coop:state', this.state());
  }

  state(): CoopState {
    return {
      level: this.level, phase: this.phase, bossId: this.boss?.id ?? -1, hp: this.boss?.hp ?? 0, maxHp: this.boss?.maxHp ?? 0,
      shield: this.shield ? { until: this.shield.until, no: this.shield.no } : null, burstUntil: this.burstUntil, rageAt: this.rageAt,
      slams: this.slams.map((s) => ({ ...s })), safe: this.safe,
      volleys: this.volleys.filter((v) => !volleyDone(v, this.clock)),
    };
  }

  result(now: number, startAt: number, win: boolean, reason?: CoopResult['reason']): CoopResult {
    const hs = this.humans();
    const ratio = hs.length ? hs.filter((p) => !p.outAt).length / hs.length : 0;
    const timeMs = Math.max(0, Math.min(C.timeSec * 1000, now - startAt));
    const players: Record<string, CoopPlayerResult> = {};
    for (const p of this.host.players()) players[p.id] = { ...this.stat(p.id) };
    return {
      win, stars: coopStars(win, ratio, C.timeSec * 1000 - timeMs), timeMs,
      bossHpPct: this.boss ? Math.round(((this.boss.hp ?? 0) / (this.boss.maxHp || 1)) * 100) : 0,
      phase: this.phase, maxHp: this.boss?.maxHp ?? 0, players, breaks: [...this.breaks],
      ...(!win && (reason ?? this.reason) ? { reason: reason ?? this.reason } : {}),
    };
  }

  dispose() {
    this.volleys = [];
    this.hurtSeen.clear();
    this.slams = [];
    this.safe = null;
  }
}
