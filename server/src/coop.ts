/**
 * 협력전 한 판: 보스가 원을 뿜고, 잡은 원이 피해가 된다. 체력 구간마다 보호막·수정, 깨면 큰 피해 구간, 못 깨면 분노.
 * 고유 패턴(skillEveryMs마다 하나: 레이저·추적 원·내려찍기·안전지대·구역 봉인·내려오는 벽·회전 빔), 탄막 일정, 사람마다 기여 기록.
 * 아케이드 맵 패턴은 쓰지 않는다.
 * 탄막은 무늬 단위(Volley)로 한 번 보내고, 화면이 시각으로 위치를 계산해 제 커서가 맞았는지 알려 온다(reportHurt).
 * 방(room.ts)은 CoopHost를 넘기고 tick·원 잡기·수정 클릭·원 이탈·피격·탄 맞음 보고·일시정지 시각 밀기·판 끝에서만 부른다.
 * 계산은 shared/src/coop.ts, 수치는 RULES.coop.
 */
import {
  COOP_BOSSES, RULES, addSrc, coopDamageMult, coopThreatCount, coopVolleyOdds, newCoopFx, rollCoopItem, applyRaidDamage, beamHits, circlePos, coopStars, crystalHp, inSafe, inSeal, makeCrystal, makeOrb, makePrismCrystal,
  burstMsFor, makeRaid, makeThreat, makeVolley, orbDamage, pickSkill, placeCrystals, raidMaxHp, rollSafe, rollSeal, rollVolley, hitShot, holdCircles, shotGone, shotPos, threatSpeed, volleyDone,
  type Beam, type Circle, type CoopHitBy, type CoopLevel, type CoopPhase, type CoopPlayerResult, type CoopResult, type CoopSkill, type CoopState,
  type LaserLine, type PlayerState, type Point, type SafeZones, type Seal, type ServerToClient, type Slam,
  type BulletShape, type CoopItemId, type Volley,
} from '@color-burst/shared';
import { FIELD, homingHits, homingRule, steerHoming, type Homing } from '@color-burst/shared';
import { barrierCovers, fillCounter, newCounter, type CoopCounter } from '@color-burst/shared';
import { attackSpecialRule, coopAttackRules, isAttackSpecial, specialId, specialRule, type CoopSpecialAttack, type CoopWard } from '@color-burst/shared';

const C = RULES.coop;
const I = C.items;
const SUPPORT = C.special.support;
const NO_SKIP: ReadonlySet<string> = new Set();
/** 빔 지연 보정에서 커서를 다시 보는 간격(ms, 판정 촘촘함일 뿐 규칙 수치는 아님) */
const BEAM_STEP_MS = 10;

export interface CoopHost {
  players(): PlayerState[];
  isDevInvulnerable?(p: PlayerState): boolean;
  emit<E extends keyof ServerToClient>(ev: E, ...args: Parameters<ServerToClient[E]>): void;
  nextId(): number;
  /** circles에 넣고 circle:spawn */
  addCircle(c: Circle): void;
  removeCircles(pred: (c: Circle) => boolean): void;
  /** room.lasers에 넣고 laser:warn */
  fireLaser(lines: LaserLine[], at: number): void;
  clearLasers(): void;
  eliminate(p: PlayerState, now: number): void;
  finish(win: boolean, reason?: CoopResult['reason']): void;
  emitPlayers(): void;
  /** 레이저 맞는 거리 (난이도 두께) */
  laserHalf(): number;
  /** 사람 커서와 서버가 받은 시각 (없으면 판정하지 않음) */
  cursorOf(id: string): (Point & { at: number }) | null;
  /** 피격 기절 (레이저와 같은 처리, ms 동안) */
  stun(p: PlayerState, now: number, ms: number): void;
  /** 원 밖의 피해(미사일)로 보스가 쓰러짐: 방이 boss:killed를 알리고 판을 이겨서 끝낸다 */
  bossKilled(by: PlayerState, now: number): void;
}

export class CoopRun {
  private specials: (CoopSpecialAttack & { hit: number })[] = [];
  private wards: CoopWard[] = [];
  private bindAt = 0;
  private bindUntil = 0;
  private bindImmuneUntil = 0;
  private linkUntil = 0;
  phase: CoopPhase = 1;
  boss: Circle | null = null;
  /** 다음 고유 패턴 시각 (보호막·큰 피해 구간 동안은 0, 끝나면 그 시각 + skillEveryMs), 직전 고유 패턴 */
  private nextSkill = 0;
  private lastSkill: CoopSkill | null = null;
  private threatAt = 0;
  /** 사람·봇마다 다음 원 시각 */
  private nextOrb = new Map<string, number>();
  private targetTurn = 0;
  /** 보호막: 시작·제한 시간 끝·몇 번째 */
  private shield: { from: number; until: number; no: 0 | 1; prism?: true } | null = null;
  /** 봇 수정을 두드릴 다음 시각 (봇은 제한 시간 안에 반드시 깬다) */
  private botNext = new Map<number, number>();
  private burstUntil = 0;
  private rageAt = 0;
  private rampageUntil = 0;
  private slams: Slam[] = [];
  private safe: SafeZones | null = null;
  /** 구역 봉인·회전 빔과 그 패턴에 이미 맞은 사람 (한 패턴에 한 번) */
  private seal: Seal | null = null;
  private sealHit = new Set<string>();
  private beam: Beam | null = null;
  private beamHit = new Set<string>();
  /** 엑스퍼트 유도탄과 마지막으로 위치를 보낸 시각 */
  private homing: Homing | null = null;
  private homingSentAt = 0;
  private stats = new Map<string, CoopPlayerResult>();
  /** 단계가 끝난 절대 시각 (결과에서 판 시작 기준으로 바꿈) */
  private phaseAts: number[] = [];
  private breaks: { ms: number; rages: number; burstMs: number }[] = [];
  /** 큰 피해 구간이 끝나면 고유 패턴·탄막 일정을 다시 잡는다 */
  private afterBurst = false;
  /** 진 이유 (결과에 실림) */
  /** 아직 끝나지 않은 탄막, 탄막마다 이미 받은 맞음 보고 (`${사람}:${탄}`) */
  private volleys: Volley[] = [];
  private hurtSeen = new Map<number, Set<string>>();
  /** 다음 탄막 발사 시각, 조준 무늬 표적 차례, 마지막 tick 시각 (상태의 끝난 탄막 거르기) */
  private nextBullet = 0;
  private aimTurn = 0;
  private clock = 0;
  /** 아이템: 약점 노출 종료 시각, 날아가는 미사일(발마다 닿는 시각·피해·쏜 사람), 아이템 확률 두 배가 끝나는 시각 */
  private weakUntil = 0;
  private missiles: { by: string; at: number; dmg: number }[] = [];
  private boostUntil = 0;
  /** 폭딜 반격 분노 게이지 (판 중에만) */
  private counter: CoopCounter | null = null;

  constructor(private host: CoopHost, readonly level: CoopLevel, private rand: () => number = Math.random) {}

  private humans() { return this.host.players().filter((p) => !p.bot); }
  private alive() { return this.humans().filter((p) => !p.outAt); }
  private stat(id: string) {
    let s = this.stats.get(id);
    if (!s) { s = { dmg: 0, burstDmg: 0, crystals: 0, threats: 0, hits: {}, hpLeft: 0, items: {}, counterLost: 0, counterSaved: 0 }; this.stats.set(id, s); }
    return s;
  }

  /** 판 시작: 체력, 레이드 보스, 첫 원·공격 시각 */
  start(now: number) {
    this.specials = [];
    this.wards = [];
    this.bindAt = this.bindUntil = this.bindImmuneUntil = this.linkUntil = 0;
    for (const p of this.host.players()) {
      p.coopCharge = 0;
      p.hp = p.bot ? 0 : C.hpMax; p.immuneUntil = 0; this.stat(p.id);
      if (p.bot) delete p.coopFx; else p.coopFx = { ...newCoopFx(), barrierLeft: C.barrier.uses[this.level] };
    }
    this.weakUntil = 0; this.missiles = []; this.boostUntil = 0;
    this.counter = newCounter(now);
    const ps = this.host.players();
    const hp = raidMaxHp(ps.filter((p) => !p.bot).length, ps.filter((p) => p.bot).length, this.level);
    this.boss = makeRaid(this.host.nextId(), now, hp);
    this.host.addCircle(this.boss);
    for (const p of ps) this.nextOrb.set(p.id, now + this.rand() * this.orbGap());
    this.volleys = []; this.hurtSeen.clear();
    // 다른 공격처럼 시작 조용한 시간 뒤부터
    this.nextBullet = now + RULES.laser.startQuietMs;
    this.clock = now;
    this.nextSkill = now + RULES.laser.startQuietMs;
    this.lastSkill = null;
    this.threatAt = 0;
    this.host.emit('coop:state', this.state(true));
  }

  isShielded() { return !!this.shield; }
  inBurst(now: number) { return now < this.burstUntil; }
  private inRampage(now: number) { return now < this.rampageUntil; }
  private inBind(now: number) { return this.bindAt <= now && now < this.bindUntil; }
  orbComboAdd(now: number) { return now < this.linkUntil ? SUPPORT.link.comboAdd : 0; }
  /** 투표가 없어져 늘 false (일시정지 요청을 막을 일이 없다) */
  busy() { return false; }

  private orbGap() { return C.orb.gapMs * C.levels[this.level].orbMult; }

  private chargeSpecial(p: PlayerState, amount: number) {
    if (p.bot || p.outAt) return;
    p.coopCharge = Math.min(specialRule(p.coopSpecial).charge, (p.coopCharge ?? 0) + amount);
  }

  /** 모든 발동 조건과 게이지 소모는 서버에서 확인한다. */
  activateSpecial(p: PlayerState, now: number): boolean {
    const boss = this.boss, kind = specialId(p.coopSpecial);
    if (!boss || (this.shield && kind !== 'ward') || p.bot || p.outAt || !p.connected || p.hp <= 0 || now < p.stunUntil) return false;
    if ((p.coopCharge ?? 0) < specialRule(kind).charge || this.specials.some((a) => a.by === p.id)) return false;
    if (isAttackSpecial(kind) && this.inRampage(now)) return false;
    if (kind === 'bind' && now < this.bindImmuneUntil) return false;

    if (kind === 'ward' || isAttackSpecial(kind)) {
      const from = this.host.cursorOf(p.id);
      if (!from) return false;
      if (kind === 'ward') this.wards.push({ x: from.x, y: from.y, until: now + SUPPORT.ward.durationMs });
      else this.specials.push({ by: p.id, kind, from: { x: from.x, y: from.y }, at: now, hit: 0 });
    } else if (kind === 'bind') {
      const { durationMs, immunityMs } = SUPPORT.bind;
      this.bindAt = now;
      this.bindUntil = now + durationMs;
      this.bindImmuneUntil = this.bindUntil + immunityMs;
      const ids = holdCircles([boss], now, durationMs);
      this.host.emit('circles:hold', { ids, at: now, ms: durationMs, bossOnly: true });
      // 예약된 공격은 남은 대기 시간을 보존한다. 날아오는 탄은 계속 움직인다.
      this.nextBullet = Math.max(now, this.nextBullet) + durationMs;
      if (this.nextSkill && Number.isFinite(this.nextSkill)) this.nextSkill = Math.max(now, this.nextSkill) + durationMs;
      if (this.threatAt) this.threatAt = Math.max(now, this.threatAt) + durationMs;
      if (this.homing && this.homing.t < this.homing.at) this.homing.at = Math.max(now, this.homing.at) + durationMs;
    } else {
      this.linkUntil = now + SUPPORT.link.durationMs;
    }
    p.coopCharge = 0;
    if (!isAttackSpecial(kind)) this.host.emit('coop:support', { by: p.id, kind });
    this.host.emitPlayers();
    this.host.emit('coop:state', this.state());
    return true;
  }

  /** 우클릭 보호막 켜기: 조건과 횟수는 서버에서 확인한다. 켜져 있는 동안과 끝난 뒤 쿨타임 동안은 다시 눌러도 횟수를 깎지 않는다 */
  activateBarrier(p: PlayerState, now: number): boolean {
    const fx = p.coopFx;
    if (p.bot || p.outAt || !p.connected || p.hp <= 0 || now < p.stunUntil || !fx) return false;
    if (fx.barrierLeft <= 0 || (fx.barrierUntil && now < fx.barrierUntil + C.barrier.cooldownMs)) return false;
    fx.barrierLeft--;
    fx.barrierUntil = now + C.barrier.durationMs;
    this.host.emitPlayers();
    return true;
  }

  private tickSpecials(now: number): boolean {
    let finished = false;
    for (const attack of [...this.specials]) {
      const p = this.host.players().find((x) => x.id === attack.by);
      const spec = attackSpecialRule(attack.kind);
      if (!p || p.outAt || !p.connected) { attack.hit = spec.hits; finished = true; continue; }
      const due = Math.min(spec.hits, Math.floor((now - attack.at) / (spec.durationMs / spec.hits)));
      while (attack.hit < due && this.boss && !this.shield) {
        attack.hit++;
        const dmg = spec.damage / spec.hits;
        const result = this.hurtBoss(p, dmg, now, circlePos(this.boss, now));
        if (result.killed) { this.host.bossKilled(p, now); return true; }
      }
      if (attack.hit >= spec.hits || this.shield) finished = true;
    }
    if (finished) {
      this.specials = this.specials.filter((a) => !this.shield && a.hit < attackSpecialRule(a.kind).hits);
      this.host.emitPlayers();
      this.host.emit('coop:state', this.state());
    }
    return false;
  }

  tick(now: number) {
    if (!this.boss) return;
    this.wards = this.wards.filter((w) => w.until > now);
    if (this.bindImmuneUntil && now >= this.bindImmuneUntil) {
      this.bindAt = this.bindUntil = this.bindImmuneUntil = 0;
      this.host.emit('coop:state', this.state());
    }
    if (this.rampageUntil && now >= this.rampageUntil) {
      this.rampageUntil = 0;
      this.host.emit('coop:state', this.state());
    }
    if (this.linkUntil && now >= this.linkUntil) {
      this.linkUntil = 0;
      this.host.emit('coop:state', this.state());
    }
    // 큰 피해 구간이 끝남: 다음 단계. 고유 패턴은 지금부터 다시 skillEveryMs를 센다
    if (this.afterBurst && now >= this.burstUntil) {
      this.afterBurst = false;
      this.burstUntil = 0;
      this.boostUntil = now + I.boostMs;
      this.nextSkill = now + C.skillEveryMs;
      this.nextBullet = now + this.bulletGap();
      this.host.emit('coop:state', this.state());
    }
    this.tickRage(now);
    if (!this.boss) return;
    this.tickCounter(now);
    if (this.tickMissiles(now)) return; // 미사일로 보스가 쓰러져 판이 끝남
    if (this.tickSpecials(now)) return;
    if (!this.boss) return;
    if (this.weakUntil && now >= this.weakUntil) { this.weakUntil = 0; this.host.emit('coop:state', this.state()); }
    // 아래 패턴은 모두 탈락시켜 판을 끝낼 수 있다 (끝나면 dispose가 boss를 지우니 이 tick의 나머지는 아무것도 보내지 않는다)
    this.tickSlams(now);
    if (!this.boss) return;
    this.tickSafe(now);
    if (!this.boss) return;
    this.tickSeal(now);
    if (!this.boss) return;
    this.tickBeam(now);
    if (!this.boss) return;
    this.tickHoming(now);
    if (!this.boss) return;
    this.tickBullets(now);
    if (this.shield) {
      if (now < this.shield.until) this.tickBotCrystals(now);
      else if (!this.rageAt) this.startRage(now);
      return;
    }
    this.spawnOrbs(now);
    if (this.inBind(now)) return;
    if (this.threatAt && now >= this.threatAt) {
      this.threatAt = 0;
      this.spawnThreats(now);
      this.host.emit('coop:state', this.state());
    }
    if (this.inBurst(now) || !this.nextSkill || now < this.nextSkill) return;
    const boss = COOP_BOSSES.core;
    const skills = this.level === 'expert' ? boss.expertSkills[this.phase] ?? boss.skills[this.phase] : boss.skills[this.phase];
    const k = pickSkill(skills, this.lastSkill, this.rand);
    this.lastSkill = k;
    this.useSkill(k, now);
    this.nextSkill += C.skillEveryMs;
    // 오래 밀려 있었으면 지금부터 다시 센다
    if (this.nextSkill <= now) this.nextSkill = now + C.skillEveryMs;
  }

  /** 고유 패턴 하나를 지금 쓴다 */
  private useSkill(k: CoopSkill, now: number) {
    const L = C.levels[this.level];
    // 판 패턴(봉인·벽·빔) 수치는 [2단계, 3단계] 배열이라 phase − 2로 찾는다. 1단계 목록에는 판 패턴이 없어 쓰이지 않지만 0으로 막아 둔다
    const p2 = Math.max(0, this.phase - 2);
    if (k === 'laser') this.host.fireLaser(rollVolley(this.rand, this.host.laserHalf(), coopVolleyOdds(this.level, this.phase)).lines, now + L.laserWarnMs);
    else if (k === 'threat') {
      this.threatAt = now + C.threatWarnMs;
      this.host.emit('coop:state', this.state());
    }
    else if (k === 'slam') this.startSlam(now);
    else if (k === 'safe') {
      if (this.safe) return;
      this.safe = rollSafe(L.safeCount, now + C.safe.warnMs, this.rand);
      this.host.emit('coop:safe', this.safe);
    } else if (k === 'seal' || k === 'crush') {
      if (k === 'crush' && (this.level !== 'expert' || this.phase === 1)) return;
      this.seal = rollSeal(k === 'crush' ? 3 : this.phase, now, this.rand);
      if (k === 'crush') {
        this.seal.lethal = true;
        this.seal.at = now + C.crush.warnMs + C.crush.snapMs;
        this.seal.until = this.seal.at + C.crush.holdMs;
      }
      this.sealHit.clear();
      this.host.emit('coop:seal', this.seal);
    } else if (k === 'beam') {
      const at = now + C.beam.warnMs;
      const w = (this.rand() < 0.5 ? -1 : 1) * C.beam.w;
      this.beam = { at, until: at + C.beam.ms, count: C.beam.count[p2]!, a0: this.rand() * Math.PI * 2, w };
      this.beamHit.clear();
      this.host.emit('coop:beam', this.beam);
    } else if (k === 'homing') {
      if (this.level !== 'expert' || this.phase === 1 || this.homing) return;
      this.homing = { warnAt: now, at: now + C.homing.warnMs, t: now, phase: this.phase as 2 | 3, targets: this.alive().map((p) => p.id), shots: [] };
      this.emitHoming(now);
    } else if (k === 'wall' && this.boss) {
      // 보스 바로 아래(보스 중심 + wallDy)에서 내려온다. 지금 보내되 warnMs 뒤에 움직인다 (그 전에는 shotPos가 null이라 맞지 않고 화면은 미리보기).
      // 판정은 탄과 같다 (화면이 알리고 reportHurt가 'wall'로 깎음)
      this.pushVolley(makeVolley('wall', this.host.nextId(), now + C.wall.warnMs, circlePos(this.boss, now),
        { speed: C.wall.speed[p2]!, phase: this.phase, gaps: C.wall.gaps[p2]! }, this.rand));
    }
  }

  /** 구역 봉인: at~until 동안 막힌 줄 안의 살아 있는 사람이 맞는다 (한 봉인에 한 번), 끝나면 null */
  private tickSeal(now: number) {
    const s = this.seal;
    if (!s) return;
    if (now >= s.until && !s.lethal) { this.seal = null; this.sealHit.clear(); this.host.emit('coop:seal', null); return; }
    if (now < s.at) return;
    for (const p of this.alive()) {
      if (this.sealHit.has(p.id)) continue;
      const q = this.host.cursorOf(p.id);
      // 압살은 닫히는 순간 한 번만 판정한다. 늦은 tick도 판정을 건너뛰지 않는다.
      if (s.lethal) this.sealHit.add(p.id);
      if (q && inSeal(q, s, s.lethal ? s.at : now) && this.damage(p, s.lethal ? 'crush' : 'seal', now)) this.sealHit.add(p.id);
      if (!this.boss || this.seal !== s) return; // 판이 끝났거나 탈락으로 패턴이 지워짐
    }
    if (now >= s.until) { this.seal = null; this.sealHit.clear(); this.host.emit('coop:seal', null); }
  }

  /** 회전 빔: at~until 동안 보스 중심에서 뻗는 빔 위의 살아 있는 사람이 맞는다 (한 빔에 한 번), 끝나면 null */
  private tickBeam(now: number) {
    const b = this.beam;
    if (!b || !this.boss) return;
    if (now >= b.until) { this.beam = null; this.beamHit.clear(); this.host.emit('coop:beam', null); return; }
    if (now < b.at) return;
    for (const p of this.alive()) {
      if (this.beamHit.has(p.id)) continue;
      const q = this.host.cursorOf(p.id);
      if (q && this.beamOver(q, b, now) && this.damage(p, 'beam', now)) this.beamHit.add(p.id);
      if (!this.boss || this.beam !== b) return;
    }
  }

  private emitHoming(now: number) {
    this.homingSentAt = now;
    this.host.emit('coop:homing', this.homing);
  }

  private stopHoming() {
    if (!this.homing) return;
    this.homing = null;
    this.host.emit('coop:homing', null);
  }

  /**
   * 유도탄: at에 보스 자리에서 대상마다 1발. 그 뒤 틱마다 대상 커서 쪽으로 선회 제한 안에서 돌며 나아가고,
   * 수명 전에 지나간 선분이 커서에 닿으면 맞는다 (맞히거나 방어막에 막히면 사라짐, 무적이면 계속 쫓음)
   */
  private tickHoming(now: number) {
    const h = this.homing;
    if (!h || !this.boss || now < h.at) return;
    const H = C.homing;
    if (h.t < h.at) {
      const from = circlePos(this.boss, h.at);
      const alive = new Set(this.alive().map((p) => p.id));
      h.shots = h.targets.filter((id) => alive.has(id)).map((id) => {
        const q = this.host.cursorOf(id);
        return { id: this.host.nextId(), target: id, x: from.x, y: from.y, angle: q ? Math.atan2(q.y - from.y, q.x - from.x) : Math.PI / 2, born: h.at };
      });
      h.t = h.at;
      if (!h.shots.length) { this.stopHoming(); return; }
      this.emitHoming(now);
    }
    const { speed, turnRad } = homingRule(h.phase);
    const dt = now - h.t;
    const before = h.shots.length;
    const keep: typeof h.shots = [];
    for (const s of h.shots) {
      const p = this.alive().find((x) => x.id === s.target);
      if (!p || now >= s.born + H.lifeMs + H.fadeMs) continue;
      const q = this.host.cursorOf(p.id);
      const next = steerHoming(s, q, speed, turnRad, dt);
      if (q && now < s.born + H.lifeMs && homingHits(s, next, q, H.r) && this.damage(p, 'homing', now)) {
        if (!this.boss || this.homing !== h) return; // 판이 끝났거나 패턴이 지워짐
        continue;
      }
      if (next.x < -H.r || next.x > FIELD.w + H.r || next.y < -H.r || next.y > FIELD.h + H.r) continue;
      keep.push({ ...s, ...next });
    }
    h.shots = keep;
    h.t = now;
    if (!keep.length) { this.stopHoming(); return; }
    if (keep.length !== before || now - this.homingSentAt >= H.sendMs) this.emitHoming(now);
  }

  /**
   * 커서 지연 보정: 커서를 받은 시각(빔이 도는 동안으로 자름)에 빔 위였는가. 그 뒤 stillMs보다 오래 새 커서가 없으면
   * 지금 − stillMs까지 그 자리에 있었던 것으로 보고 그 사이도 본다 (빔 끝은 판 가장자리에서 빠르게 지나가서, 지금 각도로 오래된 커서를 보면 억울하게 맞는다)
   */
  private beamOver(q: Point & { at: number }, b: Beam, now: number): boolean {
    const boss = this.boss;
    if (!boss) return false;
    const end = Math.min(now, b.until - 1);
    const lo = Math.max(b.at, Math.min(q.at, end));
    const hi = Math.max(lo, Math.min(end, now - C.beam.stillMs));
    for (let t = lo; ; t = Math.min(hi, t + BEAM_STEP_MS)) {
      if (beamHits(q, b, circlePos(boss, t), t, C.beam.halfWidth)) return true;
      if (t >= hi) return false;
    }
  }

  /** 탄막 간격: 평소 bulletEveryMs ÷ 단계 배율(양), 보호막 중 ÷ shieldMult */
  private bulletGap() {
    const B = C.bullets, every = coopAttackRules(this.level, this.phase).bulletEveryMs;
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
    if (!this.boss || this.inBurst(now) || this.inBind(now) || now < this.nextBullet) return;
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
      const targets = this.alive().flatMap((p) => { const q = this.host.cursorOf(p.id); return q ? [{ x: q.x, y: q.y }] : []; });
      if (targets.length) aim = targets[this.aimTurn++ % targets.length];
    }
    this.pushVolley(makeVolley(shape, this.host.nextId(), at, circlePos(this.boss, at),
      { speed: coopAttackRules(this.level, this.phase).bulletSpeed, phase: this.phase, ...(aim ? { aim } : {}) }, this.rand));
  }

  /** 탄막(벽 포함)을 들고 알린다 */
  private pushVolley(v: Volley) {
    this.volleys.push(v);
    this.host.emit('coop:volley', v);
  }

  /** 지금까지 쏜 탄막을 모두 지운다 (보스가 무너짐) */
  private clearVolleys(now: number) {
    this.volleys = [];
    this.hurtSeen.clear();
    this.host.emit('coop:clear', { before: now });
  }

  /** 탄 지우개 아이템: before 이전에 쏜 탄과 경고 중인 벽까지 지운다 (큰 피해 구간은 아님, 화면도 coop:clear로 같게) */
  private clearShots(before: number) {
    this.volleys = this.volleys.filter((v) => {
      if (v.at > before && !v.wall) return true;
      this.hurtSeen.delete(v.id);
      return false;
    });
    this.host.emit('coop:clear', { before });
    this.stopHoming();
  }

  /** 이 자리에 탄이 있는가 (지연 보정 lagWindowMs 동안 한 번이라도). 탄을 누른 클릭은 헛클릭이 아니다 */
  onShot(pt: Point, now: number): boolean {
    if (!this.volleys.length) return false;
    for (let dt = 0; dt <= RULES.lagWindowMs; dt += 25) if (hitShot(pt, this.volleys, now - dt, NO_SKIP)) return true;
    return false;
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
        const bound = this.inBind(at);
        const kind = !bound && this.rand() * 100 < C.orb.yellowPct ? 'y' as const : p.color;
        // 보스는 위쪽에 있으니 아래쪽 반원(양옆 조금 남김)으로만 뿜는다 (위로 가면 보스 몸 위를 지나 곧 판 밖으로 나가 잡을 수 없다)
        const angle = Math.PI * (0.08 + 0.84 * this.rand());
        const orb = makeOrb(this.host.nextId(), at, from, angle, kind, C.orb.speed, this.rand);
        // 가끔 ? 원 (무슨 아이템인지는 잡을 때 굴린다)
        if (!bound && this.rand() * 100 < this.itemChance(at)) { orb.kind = 'item'; orb.itemTier = 0; orb.coopItem = true; }
        this.host.addCircle(orb);
        at += gap;
      }
      this.nextOrb.set(p.id, at);
    }
  }

  /** 아이템 원 확률(%): 난이도별, 큰 피해 구간이 끝나고 boostMs 동안 × boostMult */
  private itemChance(now: number) {
    return I.chance[this.level] * (now < this.boostUntil ? I.boostMult : 1);
  }

  /** 추적 원: 보스 자리에서 아래쪽 반원으로 고르게 퍼진다 (단계가 오르면 더 많이). 표적은 살아 있는 사람 중 돌아가며 */
  private spawnThreats(now: number) {
    const alive = this.alive();
    if (!alive.length || !this.boss) return;
    const from = circlePos(this.boss, now);
    const n = coopThreatCount(this.level, this.phase);
    const sp = threatSpeed(this.level, this.phase);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + 0.76 * ((i + 0.5) / n)) + (this.rand() - 0.5) * 0.15;
      const target = alive[this.targetTurn++ % alive.length]!.id;
      this.host.addCircle(makeThreat(this.host.nextId(), now, from, a, sp, target));
    }
  }

  /** 잡은 원(내 색·노랑) → 보스 피해. 보호막이면 0. killed면 호출 쪽이 판을 끝낸다 */
  catchOrb(p: PlayerState, c: Circle, now: number): { dmg: number; gained: number; killed: boolean } {
    if (this.boss && !this.shield && !p.outAt) this.chargeSpecial(p, C.special.gain.orb);
    const boss = this.boss;
    if (!boss || this.shield || this.inRampage(now) || p.outAt) return { dmg: 0, gained: 0, killed: false };
    // 아이템 배율: 공격력·화력 강화, 연쇄 폭발 (남은 수를 하나 쓴다)
    const fx = p.coopFx;
    let mult = coopDamageMult(fx, now) * (now < this.weakUntil ? I.weakMult : 1);
    if (fx && fx.chain > 0) { fx.chain--; mult *= I.chainMult; }
    return this.hurtBoss(p, orbDamage(p, c.kind, this.inBurst(now), mult), now, circlePos(c, now), true);
  }

  /**
   * 보스에게 dmg: 경계에서 멈춤, 기록·점수, at이 있으면 coop:orb 연출. 경계에 닿으면 보호막, 0에 닿으면 killed.
   * fromOrb: 원 획득 피해는 분노 게이지에 넣는다 (큰 피해 구간·보호막 단계 제외)
   */
  private hurtBoss(p: PlayerState, dmg: number, now: number, at: Point | null, fromOrb = false): { dmg: number; gained: number; killed: boolean } {
    const boss = this.boss;
    if (!boss || this.shield || this.inRampage(now)) return { dmg: 0, gained: 0, killed: false };
    const { dealt, crossed } = applyRaidDamage(boss, dmg, this.phase);
    const s = this.stat(p.id);
    s.dmg += dealt;
    if (this.inBurst(now)) s.burstDmg += dealt;
    const gained = Math.round(dealt * RULES.boss.hit);
    if (gained) { p.score += gained; addSrc(p, 'boss', gained); }
    if (dealt > 0 && at) this.host.emit('coop:orb', { by: p.id, x: at.x, y: at.y, dmg: dealt });
    const killed = crossed && (boss.hp ?? 0) <= 0;
    if (killed) p.stats.bossKills++;
    else if (crossed) this.beginShield(now);
    else if (fromOrb && dealt > 0 && this.counter && !this.inBurst(now) && !this.shield) {
      fillCounter(this.counter, (dealt / (boss.maxHp || 1)) * 100, now, this.level);
      this.host.emit('coop:state', this.state());
    }
    else this.host.emit('coop:state', this.state());
    return { dmg: dealt, gained, killed };
  }

  /** 아이템 원을 잡음: 종류를 굴려 효과를 건다, 아이템별 획득 수를 센다 (봇은 줍지 않는다) */
  catchItem(p: PlayerState, c: Circle, now: number): CoopItemId | null {
    if (!this.boss || p.outAt || p.bot) return null;
    const item = rollCoopItem(this.level, this.rand);
    const got = this.stat(p.id).items;
    got[item] = (got[item] ?? 0) + 1;
    this.applyItem(p, item, now, circlePos(c, now));
    return item;
  }

  /** 아이템 효과 (at: 잡은 자리, 미사일이 여기서 날아간다) */
  applyItem(p: PlayerState, item: CoopItemId, now: number, at: Point) {
    const fx = (p.coopFx ??= newCoopFx());
    switch (item) {
      case 'clear': this.clearShots(now); break;
      case 'guard': fx.guardUntil = now + I.guardMs; break;
      case 'heal': p.hp = Math.min(C.hpMax, p.hp + I.heal); break;
      case 'healAll': for (const q of this.alive()) q.hp = Math.min(C.hpMax, q.hp + I.healAll); break;
      case 'fire': fx.fireUntil = now + I.fireMs; break;
      case 'power': fx.power = Math.min(I.powerMax, fx.power + 1); break;
      case 'chain': fx.chain += I.chainN; break;
      case 'combo':
        p.combo += I.comboAdd;
        p.stats.maxCombo = Math.max(p.stats.maxCombo, p.combo);
        p.roundMaxCombo = Math.max(p.roundMaxCombo, p.combo);
        break;
      case 'weak': {
        this.weakUntil = now + I.weakMs;
        this.host.emit('coop:state', this.state());
        break;
      }
      case 'missile': {
        const max = this.boss?.maxHp ?? 0, first = now + I.missileFlyMs;
        for (let i = 0; i < I.missiles; i++) this.missiles.push({ by: p.id, at: first + i * I.missileGapMs, dmg: (max * I.missilePct) / I.missiles });
        this.host.emit('coop:missile', { by: p.id, from: { x: at.x, y: at.y }, n: I.missiles, gapMs: I.missileGapMs, at: first });
        break;
      }
    }
    this.host.emitPlayers();
  }

  /** 미사일: 닿을 때마다 고정 피해 (배율 없음, 경계 못 넘음). 보호막이 올라와 있으면 막힘 (피해 0) */
  private tickMissiles(now: number): boolean {
    if (!this.missiles.length) return false;
    const due = this.missiles.filter((m) => now >= m.at);
    if (!due.length) return false;
    this.missiles = this.missiles.filter((m) => now < m.at);
    for (const m of due) {
      if (!this.boss || this.shield) continue;
      const p = this.host.players().find((x) => x.id === m.by);
      if (!p) continue;
      if (this.hurtBoss(p, m.dmg, now, null).killed) { this.missiles = []; this.host.bossKilled(p, now); return true; }
    }
    this.host.emitPlayers();
    return false;
  }

  /** 보호막: 보스 무적, 원·패턴 멈춤, 살아 있고 연결된 사람·봇마다 자기 색 수정 */
  private beginShield(now: number) {
    const no = (this.phase === 1 ? 0 : 1) as 0 | 1;
    this.shield = { from: now, until: now + C.levels[this.level].crystalSec * 1000, no };
    this.botNext.clear();
    this.burstUntil = 0;
    // 날아가던 미사일은 보호막에 막힌다 (수정을 빨리 깨도 남은 발은 들어가지 않음)
    this.missiles = [];
    // 반격 예고 중이면 취소 (재사용 대기 없이 게이지만 0으로)
    if (this.counter && now < this.counter.fireAt) this.counter = newCounter(now);
    // 고유 패턴은 보호막·큰 피해 구간 동안 쉬고, 큰 피해 구간이 끝나면 다시 센다
    this.nextSkill = 0;
    this.host.clearLasers();
    this.host.removeCircles((x) => x.kind === 'threat');
    this.clearSlamsSafe();
    const owners = this.host.players().filter((p) => !p.outAt && (p.bot || p.connected));
    const spots = placeCrystals(owners.length, this.rand);
    const hp = crystalHp(this.level, no);
    owners.forEach((p, i) => {
      const at = spots[i] ?? { x: 120 + i * 150, y: 980 };
      this.host.addCircle(makeCrystal(this.host.nextId(), now, at, p.id, p.color, hp));
    });
    this.host.emit('coop:state', this.state());
    if (!owners.length) this.breakShield(now);
  }

  /** 수정 누르기: 같은 색은 더 큰 피해를 준다. 수정이 깨지면 true. */
  hitCrystal(p: PlayerState, c: Circle, now: number): boolean {
    if (!this.shield || now >= this.shield.until || c.kind !== 'crystal' || !c.hp || p.outAt || (c.prism && p.bot)) return false;
    const damage = !c.prism && c.colorOf === p.color ? C.crystal.sameColorDamage : C.crystal.otherColorDamage;
    this.chargeSpecial(p, C.special.gain.crystal);
    if (!p.bot) this.host.emitPlayers();
    c.hp = Math.max(0, c.hp - damage);
    this.host.emit('coop:crystal', { id: c.id, hp: c.hp, maxHp: c.maxHp ?? c.hp });
    if (c.hp > 0) return false;
    this.host.removeCircles((x) => x.id === c.id);
    this.stat(p.id).crystals++;
    this.afterCrystalGone(now);
    return true;
  }

  /** 수정이 사라졌을 때 다음 보호막 단계를 처리한다. */
  private crystals: () => Circle[] = () => [];
  /** 방이 지금 판의 수정 목록을 알려 준다 */
  setCrystalSource(fn: () => Circle[]) { this.crystals = fn; }
  private afterCrystalGone(now: number) {
    const shield = this.shield;
    if (!shield || now >= shield.until) return;
    if (!this.crystals().length) {
      if (this.level !== 'expert' || shield.prism) {
        this.breakShield(now);
        return;
      }
      shield.prism = true;
      this.host.addCircle(makePrismCrystal(this.host.nextId(), now));
    }
    this.host.emit('coop:state', this.state());
  }

  /** 보호막은 구간마다 한 번 종료된다. 성공이면 딜 타임, 실패면 폭주로 넘어간다. */
  private breakShield(now: number, failed = false) {
    const shield = this.shield;
    if (!shield) return;
    const burstMs = failed ? 0 : burstMsFor(shield.until - now);
    this.breaks.push({ ms: (failed ? shield.until : now) - shield.from, rages: failed ? 1 : 0, burstMs });
    this.phaseAts.push(now);
    this.shield = null;
    this.rageAt = 0;
    this.botNext.clear();
    this.phase = Math.min(3, this.phase + 1) as CoopPhase;
    for (const p of this.host.players()) if (p.coopFx) p.coopFx.power = 0;

    if (failed) {
      this.rampageUntil = now + C.rampageMs;
      this.nextSkill = now + C.skillEveryMs;
      this.nextBullet = now + this.bulletGap();
      const ids = this.crystals().map((c) => c.id);
      this.host.removeCircles((c) => c.kind === 'crystal');
      this.host.emit('coop:crystalFail', { ids });
      for (const p of this.alive()) {
        this.damage(p, 'rage', now);
        if (!this.boss) return;
      }
    } else {
      this.burstUntil = now + burstMs;
      this.afterBurst = true;
      if (this.level !== 'expert') for (const p of this.alive()) p.hp = Math.min(C.hpMax, p.hp + C.heal.burstStart[this.level]);
      this.host.clearLasers();
      this.clearVolleys(now);
    }
    this.host.emitPlayers();
    this.host.emit('coop:state', this.state(true));
  }

  /** 봇 수정: 제한 시간의 55% 안에 깨지도록 고르게 두드린다 (봇 반응 속도와 상관없이 판이 막히지 않게) */
  private tickBotCrystals(now: number) {
    const sh = this.shield;
    if (!sh) return;
    const limit = C.levels[this.level].crystalSec * 1000;
    for (const c of this.crystals()) {
      const bot = this.host.players().find((p) => p.id === c.target && p.bot);
      if (!bot) continue;
      const clicks = Math.ceil((c.maxHp ?? 1) / C.crystal.sameColorDamage);
      const gap = (limit * 0.55) / Math.max(1, clicks);
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

  /** 폭딜 반격 판정: 발동 시각 + lagMs (늦게 도착한 보호막 요청도 인정). 탈락하지 않은 모두(봇 포함)의 콤보를 0으로, 보호막이면 지킴 */
  private tickCounter(now: number) {
    const g = this.counter;
    if (!g || !g.fireAt || now < g.fireAt + C.barrier.lagMs) return;
    const lost: string[] = [], saved: string[] = [];
    for (const p of this.host.players()) {
      if (p.outAt || p.combo <= 0) continue;
      if (barrierCovers(p.coopFx, g.fireAt)) { saved.push(p.id); this.stat(p.id).counterSaved++; }
      else { p.combo = 0; lost.push(p.id); this.stat(p.id).counterLost++; }
    }
    this.counter = { value: 0, at: now, fireAt: 0, coolUntil: g.fireAt + C.counter.cooldownMs[this.level] };
    this.host.emit('coop:counter', { lost, saved });
    this.host.emit('coop:state', this.state());
    if (lost.length) this.host.emitPlayers();
  }

  private tickRage(now: number) {
    if (this.rageAt && now >= this.rageAt) this.breakShield(now, true);
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
        if (!this.boss) return;
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
      if (!this.boss) return;
    }
    this.host.emit('coop:safe', null);
  }

  /** 보호막이 올라옴: 대기 중인 내려찍기·안전지대·봉인·빔을 지운다 */
  private clearSlamsSafe() {
    this.threatAt = 0;
    if (this.slams.length) { this.slams = []; this.host.emit('coop:slam', []); }
    if (this.safe) { this.safe = null; this.host.emit('coop:safe', null); }
    if (this.seal) { this.seal = null; this.sealHit.clear(); this.host.emit('coop:seal', null); }
    if (this.beam) { this.beam = null; this.beamHit.clear(); this.host.emit('coop:beam', null); }
    this.stopHoming();
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
    this.chargeSpecial(p, C.special.gain.threat);
    const g = C.threatPoints;
    p.score += g;
    addSrc(p, 'threat', g);
    this.stat(p.id).threats++;
    return g;
  }

  /** 체력을 hurt[by]만큼 깎고 무적·기절을 건다. 봇·탈락·무적이면 false. 방어막이 막으면 피해 없이 무적만 걸고 true */
  damage(p: PlayerState, by: CoopHitBy, now: number, circleId?: number): boolean {
    if (p.bot || p.outAt || (by !== 'crush' && now < p.immuneUntil) || p.hp <= 0 || this.host.isDevInvulnerable?.(p)) return false;
    const fx = C.hurtFx[by];
    // 우클릭 보호막: 켜진 동안 피해·기절·무적 없이 막는다. 아이템 방어막은 소모하지 않는다. 압살·분노·큰 구체 놓침은 관통
    if (by !== 'crush' && by !== 'rage' && by !== 'threat' && p.coopFx && now < p.coopFx.barrierUntil + C.barrier.lagMs) {
      this.host.emit('coop:hit', { playerId: p.id, by, hp: p.hp, dmg: 0, immuneUntil: p.immuneUntil, blocked: true, barrier: true, ...(circleId !== undefined ? { circleId } : {}) });
      return true;
    }
    // 방어막 아이템: 한 번 막고 사라진다. 피해 없이 맞은 것처럼 무적을 건다 (기절 없음). 봉인·빔도 그 패턴에 맞은 것으로 친다
    if (by !== 'crush' && p.coopFx && now < p.coopFx.guardUntil) {
      p.coopFx.guardUntil = 0;
      p.immuneUntil = now + fx.immuneMs;
      this.host.emit('coop:hit', { playerId: p.id, by, hp: p.hp, dmg: 0, immuneUntil: p.immuneUntil, blocked: true, ...(circleId !== undefined ? { circleId } : {}) });
      this.host.emitPlayers();
      return true;
    }
    const before = p.hp;
    const st = this.stat(p.id);
    st.hits[by] = (st.hits[by] ?? 0) + 1;
    const cursor = this.wards.length ? this.host.cursorOf(p.id) : null;
    const warded = cursor && this.wards.some((w) => now < w.until && Math.hypot(cursor.x - w.x, cursor.y - w.y) <= SUPPORT.ward.radius);
    const damage = C.levels[this.level].hurt[by] * (warded ? 1 - SUPPORT.ward.damageReduction : 1);
    p.hp = Math.max(0, p.hp - damage);
    p.immuneUntil = now + fx.immuneMs;
    this.host.emit('coop:hit', { playerId: p.id, by, hp: p.hp, dmg: before - p.hp, immuneUntil: p.immuneUntil, ...(circleId !== undefined ? { circleId } : {}) });
    if (fx.stunMs > 0) this.host.stun(p, now, fx.stunMs);
    if (p.hp <= 0) {
      this.host.eliminate(p, now);
      if (!this.alive().length) { this.host.finish(false, by === 'rage' ? 'crystal' : 'wipe'); return true; }
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
    for (const a of this.specials) a.at += delta;
    for (const w of this.wards) w.until += delta;
    if (this.bindAt) this.bindAt += delta;
    if (this.bindUntil) this.bindUntil += delta;
    if (this.bindImmuneUntil) this.bindImmuneUntil += delta;
    if (this.linkUntil) this.linkUntil += delta;
    if (this.counter) {
      this.counter.at += delta;
      if (this.counter.fireAt) this.counter.fireAt += delta;
      if (this.counter.coolUntil) this.counter.coolUntil += delta;
    }
    if (this.threatAt) this.threatAt += delta;
    if (this.nextSkill) this.nextSkill += delta;
    for (const [id, t] of this.nextOrb) this.nextOrb.set(id, t + delta);
    if (this.shield) { this.shield.until += delta; this.shield.from += delta; }
    // 봇 수정 두드리는 시각 (안 밀면 재개하자마자 한 tick에 한 번씩 두드려 곧 깨진다), 끝난 단계 시각 (판 시작 시각도 함께 밀린다)
    for (const [id, t] of this.botNext) this.botNext.set(id, t + delta);
    this.phaseAts = this.phaseAts.map((t) => t + delta);
    if (this.burstUntil) this.burstUntil += delta;
    if (this.rageAt) this.rageAt += delta;
    if (this.rampageUntil) this.rampageUntil += delta;
    for (const s of this.slams) s.at += delta;
    if (this.safe) this.safe.at += delta;
    if (this.seal) { this.seal.warnAt += delta; this.seal.at += delta; this.seal.until += delta; }
    if (this.beam) { this.beam.at += delta; this.beam.until += delta; }
    if (this.homing) {
      const h = this.homing;
      h.warnAt += delta; h.at += delta; h.t += delta;
      for (const s of h.shots) s.born += delta;
    }
    for (const v of this.volleys) v.at += delta;
    if (this.nextBullet) this.nextBullet += delta;
    if (this.weakUntil) this.weakUntil += delta;
    for (const m of this.missiles) m.at += delta;
    if (this.boostUntil) this.boostUntil += delta;
    let barrierShifted = false;
    const pausedAt = Date.now() - delta; // 멈춘 순간: 그때 켜져 있거나 쿨타임 중이던 보호막만 민다
    for (const p of this.host.players()) {
      const fx = p.coopFx;
      if (!fx) continue;
      if (fx.guardUntil) fx.guardUntil += delta;
      if (fx.fireUntil) fx.fireUntil += delta;
      // 켜져 있거나 쿨타임 중인 보호막만 민다 (쿨타임이 일시정지 동안 흐르지 않게)
      if (fx.barrierUntil && fx.barrierUntil + C.barrier.cooldownMs > pausedAt) { fx.barrierUntil += delta; barrierShifted = true; }
    }
    // 화면의 보호막 구체·쿨타임이 일시정지 동안 줄지 않게 밀린 종료 시각을 다시 보낸다
    if (barrierShifted) this.host.emitPlayers();
    if (this.slams.length) this.host.emit('coop:slam', this.slams);
    if (this.safe) this.host.emit('coop:safe', this.safe);
    if (this.seal) this.host.emit('coop:seal', this.seal);
    if (this.beam) this.host.emit('coop:beam', this.beam);
    if (this.homing) this.emitHoming(this.homingSentAt);
    this.host.emit('coop:state', this.state(true));
  }

  /**
   * withVolleys: 탄막 목록을 함께 (시작·재개·보스 무너짐·재접속만. 평소 상태는 원을 잡을 때마다 가므로 빼서 전송량을 줄인다,
   * 탄막은 coop:volley로 하나씩 간다)
   */
  state(withVolleys = false): CoopState {
    return {
      level: this.level, phase: this.phase, bossId: this.boss?.id ?? -1, hp: this.boss?.hp ?? 0, maxHp: this.boss?.maxHp ?? 0,
      threatAt: this.threatAt,
      wards: this.wards.map((w) => ({ ...w })),
      bindUntil: this.bindUntil, bindImmuneUntil: this.bindImmuneUntil, linkUntil: this.linkUntil,
      specials: this.specials.map(({ hit: _hit, ...a }) => ({ ...a, from: { ...a.from } })),
      shield: this.shield ? { until: this.shield.until, no: this.shield.no, ...(this.shield.prism ? { prism: true } : {}) } : null, burstUntil: this.burstUntil, rageAt: this.rageAt, rampageUntil: this.rampageUntil,
      slams: this.slams.map((s) => ({ ...s })), safe: this.safe,
      seal: this.seal ? { ...this.seal, lanes: [...this.seal.lanes] } : null, beam: this.beam ? { ...this.beam } : null,
      homing: this.homing ? { ...this.homing, targets: [...this.homing.targets], shots: this.homing.shots.map((s) => ({ ...s })) } : null,
      weakUntil: this.weakUntil,
      counter: this.counter ? { ...this.counter } : null,
      ...(withVolleys ? { volleys: this.volleys.filter((v) => !volleyDone(v, this.clock)) } : {}),
    };
  }

  result(now: number, startAt: number, win: boolean, reason?: CoopResult['reason']): CoopResult {
    const hs = this.humans();
    const ratio = hs.length ? hs.filter((p) => !p.outAt).length / hs.length : 0;
    const timeMs = Math.max(0, Math.min(C.timeSec * 1000, now - startAt));
    const players: Record<string, CoopPlayerResult> = {};
    for (const p of this.host.players()) players[p.id] = { ...this.stat(p.id), hits: { ...this.stat(p.id).hits }, items: { ...this.stat(p.id).items }, hpLeft: p.bot || p.outAt ? 0 : Math.max(0, p.hp) };
    return {
      win, stars: coopStars(win, ratio, C.timeSec * 1000 - timeMs), timeMs,
      bossHpPct: this.boss ? Math.round(((this.boss.hp ?? 0) / (this.boss.maxHp || 1)) * 100) : 0,
      phase: this.phase, maxHp: this.boss?.maxHp ?? 0, players, breaks: [...this.breaks], phaseMs: this.phaseAts.map((t) => Math.max(0, t - startAt)),
      ...(!win && reason ? { reason } : {}),
    };
  }

  /** 판이 끝남: 아이템 효과도 끝. 보스·보호막·패턴을 모두 지워 끝난 tick의 나머지가 아무것도 보내지 않게 한다 */
  dispose() {
    this.specials = [];
    this.wards = [];
    this.bindAt = this.bindUntil = this.bindImmuneUntil = this.linkUntil = 0;
    for (const p of this.host.players()) delete p.coopCharge;
    this.threatAt = 0;
    for (const p of this.host.players()) delete p.coopFx;
    this.boss = null;
    this.shield = null;
    this.rageAt = 0;
    this.rampageUntil = 0;
    this.burstUntil = 0;
    this.afterBurst = false;
    this.nextSkill = 0;
    this.botNext.clear();
    this.weakUntil = 0;
    this.missiles = [];
    this.volleys = [];
    this.hurtSeen.clear();
    this.slams = [];
    this.safe = null;
    this.seal = null;
    this.beam = null;
    this.homing = null;
    this.counter = null;
  }
}
