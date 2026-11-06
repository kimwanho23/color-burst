import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import {
  ARCADE, ASSIST_ABILITIES, COLORS, DEFAULT_RULES, MAX_PLAYERS, PRESETS, RULES, rollOptions,
  applyPick, awardTitles, bossHitInfo, endRoundCurses, isCurse, bossMult, bossTimes, startRound, circlePos, isFever, makeBoss, sanitizeRules, toGameRules, isHit, isOut, makeCircle, newPlayer, ranking, resetForRound, resolveClaim, resolveMiss, shiftTimes, spawnInterval,
  applyItem, holdCircles, isGuarded, isMine, itemMult, jackpotMult, magnetOf, modsOf, reachOf, rollItem,
  RANDOM_EVENT, applyEvent, payTax, rollEvent, hitWithin, type EventResult, type ThemeId,
  WAVE_PATTERNS, makeWave, nextWaveIn,
  type BotLevel, type Circle, type ClaimVia, type ClientToServer, type ColorIndex, type GameRules, type PlayerState, type PresetId, type RoomRules,
  type ArcadeState, type Pick, type RoomSnapshot, type ServerToClient, type SpawnOpts, type Zone,
} from '@color-burst/shared';
import { Bot } from './bot.ts';

type IO = Server<ClientToServer, ServerToClient>;

const TICK_MS = 50;
/** 네트워크 지연을 감안해 과거 몇 ms까지 클릭 위치를 인정할지 */
const LAG_WINDOW_MS = RULES.lagWindowMs;
/** 대기실에서 연결이 끊긴 사람의 자리를 비워 두는 시간(새로고침 대비) */
const LOBBY_GRACE_MS = 15_000;
/** 접속한 사람이 아무도 없을 때 방을 지우기까지 기다리는 시간 */
const EMPTY_ROOM_MS = 30_000;
/** 점수 그래프 기록 간격 */
const HISTORY_STEP_MS = 1_000;

export class Room {
  hostId = '';
  phase: 'lobby' | 'play' = 'lobby';
  players: PlayerState[] = [];
  fillBots = true;
  botLevel: BotLevel = 0;
  rules: RoomRules = { ...DEFAULT_RULES };
  /** 이번 판에 쓰는 계산용 규칙 (시작할 때 고정) */
  private G: GameRules = toGameRules(DEFAULT_RULES);

  private circles = new Map<number, Circle>();
  private nextCircleId = 1;
  private startAt = 0;
  private endAt = 0;
  private lastSpawn = 0;
  private loop: NodeJS.Timeout | null = null;
  private bots = new Map<string, Bot>();
  /** 보스 원 id → (플레이어 id → 때린 횟수) */
  private bossHits = new Map<number, Map<string, number>>();
  /** 아직 안 나온 보스 등장 시점(판 시작 후 ms) */
  private bossQueue: number[] = [];
  /** 클릭 속도 제한용: 플레이어 id → 최근 1초 클릭 시각 */
  private clickLog = new Map<string, number[]>();
  /** 비밀 키 → 플레이어 id */
  private keyToId = new Map<string, string>();
  /** 플레이어 id → 현재 소켓 id */
  private socketOf = new Map<string, string>();
  private dropTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimer: NodeJS.Timeout | null = null;
  private wins = new Map<string, number>();
  /** 점수 그래프용 기록 */
  private history: Record<string, number[]> = {};
  private nextSample = 0;
  private pausedAt = 0;
  private pausedBy: string | null = null;
  // ---------- 아케이드 ----------
  private round = 0;
  private roundPhase: 'play' | 'pick' = 'play';
  private pickEndsAt = 0;
  private offers = new Map<string, { options: Pick[]; rerolls: number; chosen: boolean; last: boolean; allLegend: boolean; extra: RollExtra }>();
  // ---------- 랜덤 이벤트 ----------
  /** 이번 게임에 랜덤 이벤트가 일어난 횟수 */
  private eventsUsed = 0;
  /** 이번 라운드 테마 / 다음 라운드 테마 (능력 선택 중에 공개) */
  private theme: ThemeId | null = null;
  private nextTheme: ThemeId | null = null;
  /** 이번 라운드 사이에 일어난 랜덤 이벤트 (능력 선택이 끝나면 지운다) */
  private lastEvent: EventResult | null = null;
  /** 세금: 다음 라운드에 가장 많이 번 사람이 받는다 */
  private taxPot = 0;
  private pickTimer: NodeJS.Timeout | null = null;
  private botPickTimers: NodeJS.Timeout[] = [];
  // ---------- 아이템 ----------
  private zones: Zone[] = [];
  private nextZoneId = 1;
  /** 내 색 비: 이 시각까지 그 색 원만 나온다 */
  private rain: { color: ColorIndex; until: number } | null = null;
  /** 시간 정지: 이 시각까지 새 원이 나오지 않는다 */
  private freezeUntil = 0;
  /** 마지막으로 보스가 터진 시각: 직후 잠깐은 빈 곳 클릭 페널티를 주지 않는다 (보스 연타가 헛클릭이 되지 않게) */
  private bossKilledAt = 0;
  // ---------- 발사 패턴 ----------
  /** 다음 웨이브 시점(판 시작 후 ms) */
  private nextWaveAt = 0;
  /** 아직 안 내보낸 웨이브 원 (born이 되면 내보낸다) */
  private spawnQueue: Circle[] = [];

  constructor(private io: IO, readonly code: string, private onEmpty: () => void, readonly solo = false) {
    if (solo) this.fillBots = true;
  }

  get humans() { return this.players.filter((p) => !p.bot); }

  /**
   * 입장. 같은 키로 이미 자리가 있으면 그 자리로 복귀한다(게임 중에도 가능).
   * 성공하면 플레이어 id, 실패하면 { error } 반환.
   */
  join(socketId: string, key: string, name: string): { id: string } | { error: string } {
    const existing = this.keyToId.get(key);
    const p = existing ? this.players.find((x) => x.id === existing) : undefined;
    if (p) {
      this.attach(p, socketId);
      if (this.phase === 'play') {
        this.io.to(socketId).emit('game:sync', this.playPayload());
        if (this.roundPhase === 'pick') this.sendOffer(p.id);
      }
      this.broadcastState();
      return { id: p.id };
    }

    if (this.solo && this.humans.length) return { error: '혼자 하기 방에는 들어갈 수 없어요.' };
    if (this.phase !== 'lobby') return { error: '이미 게임이 진행 중이에요. 끝나면 다시 들어와 주세요.' };
    this.players = this.players.filter((x) => !x.bot);
    if (this.humans.length >= MAX_PLAYERS) return { error: '방이 가득 찼어요.' };
    const color = this.freeColor();
    if (color === null) return { error: '방이 가득 찼어요.' };

    const np = newPlayer(randomUUID().slice(0, 8), name.slice(0, 12) || '플레이어', color);
    this.players.push(np);
    this.keyToId.set(key, np.id);
    this.attach(np, socketId);
    if (!this.hostId) this.hostId = np.id;
    this.broadcastState();
    return { id: np.id };
  }

  /** 소켓 연결이 끊김. 다른 탭/소켓으로 이미 갈아탔으면 무시 */
  disconnect(playerId: string, socketId: string) {
    if (this.socketOf.get(playerId) !== socketId) return;
    this.socketOf.delete(playerId);
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = false;
    // 혼자 하기에서 연결이 끊기면(새로고침 등) 자동으로 멈춰 둔다
    if (this.solo && this.phase === 'play' && this.roundPhase === 'play' && !this.pausedAt) this.doPause(playerId);
    if (this.phase === 'lobby') {
      this.dropTimers.set(playerId, setTimeout(() => this.remove(playerId), LOBBY_GRACE_MS));
    }
    this.passHostIfNeeded();
    this.checkEmpty();
    this.broadcastState();
    this.emitPlayers();
  }

  /** '방 나가기'를 눌렀을 때. 바로 자리를 비운다 */
  leave(playerId: string, socketId: string) {
    if (this.socketOf.get(playerId) === socketId) this.socketOf.delete(playerId);
    if (this.phase === 'play') {
      const p = this.players.find((x) => x.id === playerId);
      if (p) p.connected = false;
      for (const [k, id] of this.keyToId) if (id === playerId) this.keyToId.delete(k);
      this.passHostIfNeeded();
      this.checkEmpty();
      this.broadcastState();
      this.emitPlayers();
    } else {
      this.remove(playerId);
    }
  }

  setColor(id: string, color: ColorIndex) {
    if (this.phase !== 'lobby') return;
    const p = this.players.find((x) => x.id === id);
    if (!p || this.players.some((x) => x.color === color && x.id !== id && !x.bot)) return;
    p.color = color;
    this.broadcastState();
  }

  setOptions(id: string, o: { fillBots?: boolean; botLevel?: BotLevel }) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    if (typeof o.fillBots === 'boolean' && !this.solo) this.fillBots = o.fillBots;
    if (o.botLevel === 0 || o.botLevel === 1 || o.botLevel === 2) this.botLevel = o.botLevel;
    this.broadcastState();
  }

  setRules(id: string, d: { preset?: PresetId; rules?: Partial<RoomRules> }) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    let base = this.rules;
    // 프리셋은 점수·속도 규칙만 바꾸고 모드 설정은 유지
    if (d.preset && d.preset in PRESETS) {
      base = { ...PRESETS[d.preset].rules, mode: this.rules.mode, arcadeRoundSec: this.rules.arcadeRoundSec, randomEvents: this.rules.randomEvents };
    }
    this.rules = sanitizeRules(base, d.rules ?? {});
    this.broadcastState();
  }

  start(id: string): string | null {
    if (id !== this.hostId) return '방장만 시작할 수 있어요.';
    if (this.phase !== 'lobby') return '이미 진행 중이에요.';

    // 대기실에서 끊긴 채로 남아 있던 사람은 이번 판에서 제외
    for (const p of this.humans.filter((h) => !h.connected)) this.remove(p.id, false);
    this.players = this.players.filter((p) => !p.bot);
    this.bots.clear();
    if (this.fillBots) {
      let n = 1;
      for (let c = this.freeColor(); c !== null && this.players.length < MAX_PLAYERS; c = this.freeColor()) {
        const bot = newPlayer(`bot-${n}`, `봇 ${String.fromCharCode(64 + n)}`, c, true);
        this.players.push(bot);
        this.bots.set(bot.id, new Bot(this.botLevel));
        n++;
      }
    }
    if (this.players.length < 2) {
      this.players = this.players.filter((p) => !p.bot);
      this.bots.clear();
      return '혼자서는 시작할 수 없어요. 친구를 부르거나 봇 채우기를 켜 주세요.';
    }

    this.players.forEach(resetForRound);
    this.G = toGameRules(this.rules);
    this.history = Object.fromEntries(this.players.map((p) => [p.id, [0]]));
    this.round = 1;
    this.eventsUsed = 0;
    this.theme = null;
    this.nextTheme = null;
    this.taxPot = 0;
    this.roundPhase = 'play';
    this.phase = 'play';
    this.beginRound();
    this.broadcastState();
    this.loop = setInterval(() => this.tick(), TICK_MS);
    return null;
  }

  /** 일시정지 권한: 혼자 하기는 본인, 멀티는 방장 */
  canPause(id: string) { return this.solo ? this.players.some((p) => p.id === id) : id === this.hostId; }

  pause(id: string) {
    // 능력 선택 중에는 제한 시간이 있어서 멈출 수 없다
    if (this.phase !== 'play' || this.roundPhase !== 'play' || this.pausedAt || !this.canPause(id)) return;
    this.doPause(id);
  }

  resume(id: string) {
    if (this.phase !== 'play' || !this.pausedAt || !this.canPause(id)) return;
    const delta = Date.now() - this.pausedAt;
    // 멈춰 있던 시간만큼 모든 시각을 뒤로 민다
    this.startAt += delta; this.endAt += delta; this.lastSpawn += delta;
    // 원의 정지 구간도 출발 시각과 같이 민다 (상대 위치가 그대로여야 한다)
    for (const c of [...this.circles.values(), ...this.spawnQueue]) { c.born += delta; for (const h of c.holds ?? []) h[0] += delta; }
    for (const p of this.players) shiftTimes(p, this.pausedAt, delta);
    for (const z of this.zones) z.until += delta;
    if (this.rain && this.rain.until > this.pausedAt) this.rain.until += delta;
    if (this.freezeUntil > this.pausedAt) this.freezeUntil += delta;
    for (const b of this.bots.values()) b.shift(delta);
    this.pausedAt = 0;
    this.pausedBy = null;
    this.io.to(this.code).emit('game:sync', this.playPayload());
  }

  private doPause(id: string) {
    this.pausedAt = Date.now();
    this.pausedBy = id;
    this.io.to(this.code).emit('game:pause', { by: id });
  }

  /** 아케이드: 능력 고르기 */
  choose(id: string, index: number) {
    if (this.phase !== 'play' || this.roundPhase !== 'pick') return;
    const o = this.offers.get(id);
    const p = this.players.find((x) => x.id === id);
    const pick = o?.options[index];
    if (!o || !p || o.chosen || !pick) return;
    applyPick(p, pick);
    o.chosen = true;
    this.emitPlayers();
    this.emitArcade();
    if ([...this.offers.values()].every((x) => x.chosen)) this.finishPick();
  }

  /** 아케이드: 선택지 다시 뽑기 */
  reroll(id: string) {
    if (this.phase !== 'play' || this.roundPhase !== 'pick') return;
    const o = this.offers.get(id);
    if (!o || o.chosen || o.rerolls <= 0) return;
    o.rerolls--;
    o.options = this.roll(p0(this.players, id), o.last, o.allLegend, o.extra);
    this.sendOffer(id);
  }

  click(id: string, d: { circleId: number | null; x: number; y: number }) {
    const now = Date.now();
    if (this.phase !== 'play' || this.roundPhase !== 'play' || this.pausedAt || now < this.startAt) return;
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    if (!this.allowClick(id, now)) {
      if (d.circleId !== null) this.rejectTo(id, d.circleId);
      return;
    }

    // 판정 순서: ① 직접 맞은 원 ② 넓은 손 범위 안의 내 원 전부 ③ (아무것도 없으면) 자석 ④ 빈 곳 (원을 노린 클릭이 아닐 때만)
    let got = false;
    if (d.circleId !== null) {
      const c = this.circles.get(d.circleId);
      // 이미 누가 가져갔거나, 위치가 맞지 않으면 거절
      if (!c || !this.hitWithLag(c, now, d.x, d.y)) this.rejectTo(id, d.circleId);
      else {
        got = true;
        if (c.kind === 'boss') this.hitBoss(p, c, now);
        else if (c.kind === 'item') this.claimItem(p, c, now);
        else this.claim(p, c, now, 'click');
      }
    }
    const reach = reachOf(p, now);
    if (reach > 0) {
      let ranged = false;
      for (const c of [...this.circles.values()]) {
        if (!isMine(c.kind, p.color) || !this.hitWithLag(c, now, d.x, d.y, RULES.hitPad + reach)) continue;
        this.claim(p, c, now, 'range', true);
        ranged = got = true;
      }
      if (ranged) this.emitPlayers();
    }
    const magnet = magnetOf(p, now);
    if (!got && magnet > 0) {
      // 클릭 시점 위치 기준으로 가장 가까운 내 원 (지연 보정 안에서 닿았던 원 중)
      let best: Circle | null = null, bd = Infinity;
      for (const c of this.circles.values()) {
        if (!isMine(c.kind, p.color) || !this.hitWithLag(c, now, d.x, d.y, RULES.hitPad + magnet)) continue;
        const q = circlePos(c, now);
        const dist = Math.hypot(q.x - d.x, q.y - d.y) - c.r;
        if (dist < bd) { bd = dist; best = c; }
      }
      if (best) { this.claim(p, best, now, 'magnet'); got = true; }
    }
    // 원을 노리고 눌렀는데 거절된 경우(남이 먼저 가져감 등)는 빈 곳이 아니므로 페널티 없음
    // 보스가 터진 직후의 빈 곳 클릭도 페널티 없음
    if (!got && d.circleId === null && now - this.bossKilledAt >= RULES.boss.killGraceMs) {
      resolveMiss(p, now, this.G, this.players);
      this.emitPlayers();
    }
  }

  snapshot(): RoomSnapshot {
    return { code: this.code, hostId: this.hostId, phase: this.phase, players: this.players, fillBots: this.fillBots, botLevel: this.botLevel, rules: this.rules, solo: this.solo, wins: Object.fromEntries(this.wins) };
  }

  destroy() {
    this.stop();
    this.clearPickTimers();
    for (const t of this.dropTimers.values()) clearTimeout(t);
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
  }

  // ---------- 내부 ----------

  private attach(p: PlayerState, socketId: string) {
    const old = this.socketOf.get(p.id);
    if (old && old !== socketId) this.io.sockets.sockets.get(old)?.leave(this.code);
    this.socketOf.set(p.id, socketId);
    this.io.sockets.sockets.get(socketId)?.join(this.code);
    p.connected = true;
    const t = this.dropTimers.get(p.id);
    if (t) { clearTimeout(t); this.dropTimers.delete(p.id); }
    if (this.emptyTimer) { clearTimeout(this.emptyTimer); this.emptyTimer = null; }
    if (!this.hostId || !this.players.find((x) => x.id === this.hostId)?.connected) this.passHostIfNeeded();
  }

  private remove(playerId: string, broadcast = true) {
    const t = this.dropTimers.get(playerId);
    if (t) { clearTimeout(t); this.dropTimers.delete(playerId); }
    this.players = this.players.filter((x) => x.id !== playerId);
    for (const [k, id] of this.keyToId) if (id === playerId) this.keyToId.delete(k);
    this.socketOf.delete(playerId);
    this.passHostIfNeeded();
    if (!this.humans.length) { this.destroy(); this.onEmpty(); return; }
    this.checkEmpty();
    if (broadcast) this.broadcastState();
  }

  /** 방장이 없거나 끊겼으면 접속 중인 다른 사람에게 넘긴다 */
  private passHostIfNeeded() {
    const host = this.players.find((p) => p.id === this.hostId);
    if (host && host.connected) return;
    const next = this.humans.find((h) => h.connected);
    if (next) this.hostId = next.id;
    else if (!host) this.hostId = this.humans[0]?.id ?? '';
  }

  private checkEmpty() {
    if (this.humans.some((h) => h.connected) || this.emptyTimer) return;
    this.emptyTimer = setTimeout(() => { this.destroy(); this.onEmpty(); }, EMPTY_ROOM_MS);
  }

  private rejectTo(id: string, circleId: number) {
    const sid = this.socketOf.get(id);
    if (sid) this.io.to(sid).emit('click:rejected', { circleId });
  }

  /** 매크로 방지: 최근 1초 클릭 수 제한 */
  private allowClick(id: string, now: number) {
    const log = (this.clickLog.get(id) ?? []).filter((t) => now - t < 1000);
    if (log.length >= RULES.maxClicksPerSec) { this.clickLog.set(id, log); return false; }
    log.push(now);
    this.clickLog.set(id, log);
    return true;
  }

  private hitBoss(p: PlayerState, c: Circle, now: number) {
    const B = RULES.boss;
    const hits = this.bossHits.get(c.id) ?? new Map<string, number>();
    this.bossHits.set(c.id, hits);
    const info = bossHitInfo(p);
    const dmg = Math.min(info.damage, c.hp ?? 1);
    hits.set(p.id, (hits.get(p.id) ?? 0) + dmg);
    p.stats.bossHits++;
    c.hp = Math.max(0, (c.hp ?? 1) - dmg);

    // 배율 순서: 피버(보스 상한) → 점수 2배·황금 손 → 잭팟 (타격과 막타는 잭팟을 따로 굴린다)
    const mult = bossMult(p, now, this.G) * info.boost * itemMult(p, now, true);
    const m = modsOf(p.picks);
    const hitJp = jackpotMult(m);
    let gained = Math.round(info.hit * mult * hitJp);

    if (c.hp > 0) {
      p.score += gained;
      this.io.to(this.code).emit('boss:hit', { circleId: c.id, by: p.id, hp: c.hp, gained, jackpot: hitJp });
      this.emitPlayers();
      return;
    }

    // 막타
    this.circles.delete(c.id);
    this.bossHits.delete(c.id);
    this.bossKilledAt = now;
    const killJp = jackpotMult(m);
    gained += Math.round(info.kill * mult * killJp);
    p.score += gained;
    p.stats.bossKills++;
    // 최다 타격: 동점이면 막타 친 사람 우선, 그다음 먼저 때린 사람
    let mvp: string | null = null, best = 0;
    for (const [pid, n] of hits) if (n > best || (n === best && pid === p.id)) { best = n; mvp = pid; }
    const mvpP = this.players.find((x) => x.id === mvp);
    if (mvpP) mvpP.score += B.mvp;
    const { x, y } = circlePos(c, now);
    this.io.to(this.code).emit('boss:killed', { circleId: c.id, by: p.id, gained, mvp, mvpGained: mvpP ? B.mvp : 0, x, y, jackpot: killJp });
    this.emitPlayers();
  }

  private playPayload() {
    return {
      startAt: this.startAt, endAt: this.endAt, players: this.players, circles: [...this.circles.values()],
      rules: this.rules, pausedBy: this.pausedBy, arcade: this.arcadeState(), zones: this.zones, theme: this.theme,
    };
  }

  private arcadeState(): ArcadeState | null {
    if (!this.G.arcade) return null;
    return {
      round: this.round, rounds: ARCADE.rounds, phase: this.roundPhase, pickEndsAt: this.pickEndsAt,
      theme: this.roundPhase === 'pick' ? this.nextTheme : this.theme,
      event: this.roundPhase === 'pick' ? this.lastEvent : null,
      waiting: this.roundPhase === 'pick' ? [...this.offers].filter(([, o]) => !o.chosen).map(([id]) => id) : [],
    };
  }

  /** 라운드(클래식은 한 판) 시작: 판 위를 비우고 카운트다운 후 시작 */
  private beginRound() {
    this.circles.clear();
    this.bossHits.clear();
    this.clickLog.clear();
    this.theme = this.nextTheme;
    this.nextTheme = null;
    this.bossQueue = bossTimes(this.G, this.theme);
    this.zones = [];
    this.rain = null;
    this.freezeUntil = 0;
    this.nextWaveAt = nextWaveIn();
    this.spawnQueue = [];
    this.pausedAt = 0;
    this.pausedBy = null;
    this.nextSample = HISTORY_STEP_MS;
    const now = Date.now();
    this.startAt = now + RULES.countdownMs;
    this.endAt = this.startAt + this.G.roundMs;
    this.lastSpawn = this.startAt;
    for (const p of this.players) startRound(p, this.startAt, this.G, this.endAt);
    this.io.to(this.code).emit('game:start', this.playPayload());
  }

  /**
   * 아케이드: 라운드 종료. 먼저 "라운드 종료!"를 알리고 잠시 뒤에 능력 선택을 연다.
   * 라운드 끝에 원을 누르던 클릭이 막 깔린 카드를 골라 버리지 않게 하려는 틈이다
   */
  private endRound() {
    this.roundPhase = 'pick';
    this.circles.clear();
    this.bossHits.clear();
    this.spawnQueue = [];
    this.io.to(this.code).emit('round:end', { round: this.round });
    this.pickTimer = setTimeout(() => this.startPick(), RULES.roundEndMs);
  }

  /** 능력 선택 시작: 저주 정산 → 랜덤 이벤트 → 선택지 */
  private startPick() {
    this.applyRoundCurses();
    this.pickEndsAt = Date.now() + ARCADE.pickSec * 1000;

    // 랜덤 이벤트: 꼴찌·선택지 계산 전에 점수·능력을 바꾼다
    const eventId = this.G.randomEvents ? rollEvent(this.players, this.eventsUsed) : null;
    const ev = eventId ? applyEvent(eventId, this.players, this.G) : null;
    this.lastEvent = ev;
    let delay = 0;
    if (ev) {
      this.eventsUsed++;
      this.nextTheme = ev.theme ?? null;
      this.taxPot += ev.pot ?? 0;
      delay = RANDOM_EVENT.pickBonusMs;
      this.pickEndsAt += delay;
    }
    // 점수 그래프: 저주·랜덤 이벤트까지 반영한 라운드 끝 점수
    for (const p of this.players) (this.history[p.id] ??= []).push(p.score);

    const scores = this.players.map((p) => p.score);
    const min = Math.min(...scores);
    const tied = scores.every((v) => v === min);
    this.offers.clear();
    for (const p of this.players) {
      const last = !tied && p.score === min;
      const allLegend = p.legendNext;
      p.legendNext = false;
      const extra: RollExtra = { gift: ev?.giftTo === p.id, curse: ev?.curseTo === p.id };
      this.offers.set(p.id, { options: this.roll(p, last, allLegend, extra), rerolls: ARCADE.rerollsPerPick, chosen: false, last, allLegend, extra });
    }
    this.emitArcade();
    if (ev) { this.io.to(this.code).emit('arcade:event', ev); this.emitPlayers(); }
    for (const p of this.players) {
      if (!p.bot) { this.sendOffer(p.id); continue; }
      // 봇은 1~3초 고민하다가 가장 높은 등급을 고른다. 저주는 꼴찌일 때만 반반 확률로 고른다
      // 보조 능력(넓은 손·자석)은 봇에게 효과가 없어서, 다른 선택지가 있으면 고르지 않는다
      const { options: opts, last } = this.offers.get(p.id)!;
      const curseAt = opts.findIndex((o) => isCurse(o.id));
      const useful = opts.some((o) => !isCurse(o.id) && !ASSIST_ABILITIES.includes(o.id));
      let best = -1;
      opts.forEach((o, i) => {
        if (isCurse(o.id) || (useful && ASSIST_ABILITIES.includes(o.id))) return;
        if (best < 0 || o.tier > opts[best].tier || (o.tier === opts[best].tier && Math.random() < 0.5)) best = i;
      });
      if (curseAt >= 0 && (best < 0 || (last && Math.random() < 0.5))) best = curseAt;
      this.botPickTimers.push(setTimeout(() => this.choose(p.id, best), delay + 1000 + Math.random() * 2000));
    }
    this.pickTimer = setTimeout(() => this.finishPick(), ARCADE.pickSec * 1000 + delay);
  }

  /** 선택 마감: 안 고른 사람은 무작위로 정하고 다음 라운드 */
  private finishPick() {
    if (this.roundPhase !== 'pick') return;
    this.clearPickTimers();
    for (const [id, o] of this.offers) {
      if (o.chosen) continue;
      const p = this.players.find((x) => x.id === id);
      if (p) applyPick(p, o.options[Math.floor(Math.random() * o.options.length)]);
      o.chosen = true;
    }
    this.offers.clear();
    this.round++;
    this.roundPhase = 'play';
    this.emitPlayers();
    this.beginRound();
  }

  /** extra: 랜덤 이벤트 선물(선택지 +1)·저주 배달 */
  private roll(p: PlayerState | undefined, last: boolean, allLegend: boolean, extra: RollExtra) {
    const curses = p ? p.picks.filter((x) => isCurse(x.id)).length : 0;
    const opts = { curses, allLegend, forceCurse: extra.curse, exclude: this.G.missPenalty ? [] : ['calm' as const] };
    return rollOptions(this.round - 1, last, Math.random, opts, ARCADE.optionCount + (extra.gift ? 1 : 0));
  }

  /** 라운드 종료 저주 효과를 적용하고 모두에게 알린다 */
  private applyRoundCurses() {
    if (!this.G.arcade) return;
    const effects = this.players.flatMap((p) => endRoundCurses(p));
    // 세금: 이번 라운드에 가장 많이 번 사람이 받는다 (동점이면 나눔)
    if (this.taxPot > 0) {
      effects.push(...payTax(this.players, this.taxPot));
      this.taxPot = 0;
    }
    if (effects.length) this.io.to(this.code).emit('arcade:effects', effects);
  }

  private sendOffer(id: string) {
    const o = this.offers.get(id);
    const sid = this.socketOf.get(id);
    if (!o || o.chosen || !sid) return;
    this.io.to(sid).emit('arcade:offer', { options: o.options, rerollLeft: o.rerolls, pickEndsAt: this.pickEndsAt, lastPlace: o.last });
  }

  private emitArcade() {
    const st = this.arcadeState();
    if (st) this.io.to(this.code).emit('arcade:pick', st);
  }

  private clearPickTimers() {
    if (this.pickTimer) clearTimeout(this.pickTimer);
    this.pickTimer = null;
    this.botPickTimers.forEach(clearTimeout);
    this.botPickTimers = [];
  }

  private tick() {
    if (this.pausedAt || this.roundPhase === 'pick') return;
    const now = Date.now();
    if (now < this.startAt) return;
    if (now >= this.endAt) return this.G.arcade && this.round < ARCADE.rounds ? this.endRound() : this.end();
    while (now - this.startAt >= this.nextSample) {
      for (const p of this.players) (this.history[p.id] ??= []).push(p.score);
      this.nextSample += HISTORY_STEP_MS;
    }

    const kinds = this.players.map((p) => p.color);
    // 시간 정지 중에는 새 원이 나오지 않는다
    if (now < this.freezeUntil) this.lastSpawn = Math.max(this.lastSpawn, now);
    while (now - this.lastSpawn >= spawnInterval(this.lastSpawn - this.startAt, this.G)) {
      this.lastSpawn += spawnInterval(this.lastSpawn - this.startAt, this.G);
      const c = makeCircle(this.nextCircleId++, this.lastSpawn, this.lastSpawn - this.startAt, kinds, this.G, Math.random, this.spawnOpts(now));
      if (this.theme === 'reverse') c.rev = true;
      this.circles.set(c.id, c);
      this.io.to(this.code).emit('circle:spawn', c);
    }
    this.spawnWaves(now, kinds);
    while (now >= this.freezeUntil && this.bossQueue.length && now - this.startAt >= this.bossQueue[0]) {
      this.bossQueue.shift();
      const b = makeBoss(this.nextCircleId++, now, this.players.length, this.G);
      this.circles.set(b.id, b);
      this.io.to(this.code).emit('circle:spawn', b);
    }
    for (const [id, c] of this.circles) {
      if (!isOut(c, now - LAG_WINDOW_MS)) continue;
      this.circles.delete(id);
      if (c.kind === 'boss') { this.bossHits.delete(id); this.io.to(this.code).emit('boss:escaped', { circleId: id }); }
    }

    // 장판: 위를 지나는 주인의 내 원을 자동으로 잡는다
    this.zones = this.zones.filter((z) => z.until > now);
    let zoned = false;
    for (const z of this.zones) {
      const owner = this.players.find((p) => p.id === z.by);
      if (!owner) continue;
      for (const c of [...this.circles.values()]) {
        if (!isMine(c.kind, owner.color) || isGuarded(c, now)) continue;
        const q = circlePos(c, now);
        if (Math.hypot(q.x - z.x, q.y - z.y) <= c.r + z.r) { this.claim(owner, c, now, 'zone', true); zoned = true; }
      }
    }
    if (zoned) this.emitPlayers();

    for (const p of this.players) {
      const bot = this.bots.get(p.id);
      if (!bot) continue;
      const target = bot.think(p, [...this.circles.values()], this.players, now);
      if (!target) continue;
      if (target.kind === 'boss') this.hitBoss(p, target, now);
      else if (target.kind === 'item') this.claimItem(p, target, now);
      else this.claim(p, target, now, 'click');
    }
  }

  /** 새 원 생성 옵션: 아이템 원 확률, 내 색 비 */
  /** 발사 패턴: 때가 되면 예고를 보내고 웨이브를 예약, 예약된 원은 born이 되면 내보낸다 */
  private spawnWaves(now: number, kinds: ColorIndex[]) {
    const W = RULES.waves;
    if (this.G.waves && now >= this.freezeUntil && now - this.startAt >= this.nextWaveAt) {
      const at = now + W.warnMs;
      this.nextWaveAt = at - this.startAt + nextWaveIn();
      const pattern = WAVE_PATTERNS[Math.floor(Math.random() * WAVE_PATTERNS.length)];
      const wave = makeWave(pattern, this.nextCircleId, at, at - this.startAt, kinds, this.G, Math.random, this.spawnOpts(now));
      this.nextCircleId += wave.length;
      if (this.theme === 'reverse') for (const c of wave) c.rev = true;
      this.spawnQueue.push(...wave);
      this.io.to(this.code).emit('wave:warn', { pattern, at });
    }
    if (now < this.freezeUntil) return;
    const due = this.spawnQueue.filter((c) => c.born <= now);
    if (!due.length) return;
    this.spawnQueue = this.spawnQueue.filter((c) => c.born > now);
    for (const c of due) {
      this.circles.set(c.id, c);
      this.io.to(this.code).emit('circle:spawn', c);
    }
  }

  /** 새 원 생성 옵션: 아이템 원 확률, 라운드 테마, 내 색 비 */
  private spawnOpts(now: number): SpawnOpts {
    const T = RULES.themes;
    const o: SpawnOpts = { itemChance: this.G.items ? RULES.items.chance * (this.theme === 'itemRush' ? T.itemRushMult : 1) : 0 };
    if (this.theme === 'goldRush') o.yellowChance = T.goldRushYellow;
    if (this.theme === 'rainbowRain') o.rainbowChance = T.rainbowRain;
    if (this.theme === 'allYellow') o.forceKind = 'y';
    if (this.rain && now < this.rain.until) o.forceKind = this.rain.color;
    return o;
  }

  /** quiet: 여러 원을 한꺼번에 잡을 때는 플레이어 상태를 부르는 쪽에서 한 번만 보낸다 */
  private claim(p: PlayerState, c: Circle, now: number, via: ClaimVia, quiet = false) {
    // 같은 틱에 다른 경로(장판·범위·다른 사람)로 이미 가져간 원이면 무시
    if (!this.circles.has(c.id)) return;
    this.circles.delete(c.id);
    const result = resolveClaim(p, c.kind, this.players, now, this.G, { via });
    const { x, y } = circlePos(c, now);
    this.io.to(this.code).emit('circle:claimed', { circleId: c.id, by: p.id, result, x, y });
    if (!quiet) this.emitPlayers();
  }

  /** 아이템 원: 무작위 아이템을 바로 발동한다 */
  private claimItem(p: PlayerState, c: Circle, now: number) {
    if (!this.circles.has(c.id)) return;
    this.circles.delete(c.id);
    const tier = c.itemTier ?? 0;
    const item = rollItem(tier, this.G);
    const { x, y } = circlePos(c, now);
    const action = applyItem(p, item, now, this.G, this.players);
    // 블라스트의 circle:claimed보다 먼저 보내서 화면이 폭발 중심을 알게 한다
    this.io.to(this.code).emit('item:got', { circleId: c.id, by: p.id, item, tier, x, y });
    const I = RULES.items;
    switch (action?.kind) {
      case 'zone': {
        const z: Zone = { id: this.nextZoneId++, by: p.id, x, y, r: I.zoneR, until: now + I.zoneMs };
        this.zones.push(z);
        this.io.to(this.code).emit('zone:add', z);
        break;
      }
      case 'bomb':
      case 'fieldClear':
        for (const o of [...this.circles.values()]) {
          if (o.kind === 'boss' || o.kind === 'item' || isGuarded(o, now)) continue;
          const q = circlePos(o, now);
          if (action.kind === 'fieldClear' || Math.hypot(q.x - x, q.y - y) <= o.r + I.bombR) this.claim(p, o, now, 'blast', true);
        }
        break;
      case 'timeStop': {
        const ids = holdCircles(this.circles.values(), now, I.freezeMs);
        this.freezeUntil = now + I.freezeMs;
        // 예약된 웨이브 원도 정지가 끝난 뒤로 미룬다 (나선 간격은 유지)
        for (const q of this.spawnQueue) q.born += I.freezeMs;
        this.io.to(this.code).emit('circles:hold', { ids, at: now, ms: I.freezeMs });
        break;
      }
      case 'rain':
        this.rain = { color: p.color, until: now + I.ms.rain };
        break;
    }
    this.emitPlayers();
  }

  private hitWithLag(c: Circle, now: number, x: number, y: number, pad: number = RULES.hitPad) {
    return hitWithin(c, now, x, y, pad, LAG_WINDOW_MS);
  }

  private end() {
    this.stop();
    this.clearPickTimers();
    this.applyRoundCurses();
    this.offers.clear();
    this.roundPhase = 'play';
    for (const p of this.players) (this.history[p.id] ??= []).push(p.score);
    const rank = ranking(this.players);
    const top = rank[0]?.score ?? 0;
    // 공동 1등은 모두 1승 (사람만 기록)
    for (const p of rank) if (p.score === top && !p.bot) this.wins.set(p.id, (this.wins.get(p.id) ?? 0) + 1);
    this.io.to(this.code).emit('game:over', {
      ranking: rank,
      titles: awardTitles(this.players),
      history: { stepMs: HISTORY_STEP_MS, scores: this.history },
      wins: Object.fromEntries(this.wins),
    });
    this.players = this.players.filter((p) => !p.bot);
    this.bots.clear();
    this.phase = 'lobby';
    // 게임 중에 끊겼던 사람은 대기실 기준 유예 시간을 다시 준다
    for (const p of this.humans) {
      if (!p.connected && !this.dropTimers.has(p.id)) {
        this.dropTimers.set(p.id, setTimeout(() => this.remove(p.id), LOBBY_GRACE_MS));
      }
    }
    // 나가기를 누른 사람(키가 없는 사람)은 바로 정리
    const known = new Set(this.keyToId.values());
    for (const p of this.humans) if (!known.has(p.id)) this.remove(p.id, false);
    if (!this.humans.length) return;
    this.broadcastState();
  }

  private stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private freeColor(): ColorIndex | null {
    for (let i = 0; i < COLORS.length; i++) if (!this.players.some((p) => p.color === i)) return i as ColorIndex;
    return null;
  }

  private emitPlayers() { this.io.to(this.code).emit('players', this.players); }
  private broadcastState() { this.io.to(this.code).emit('room:state', this.snapshot()); }
}

const p0 = (players: PlayerState[], id: string) => players.find((p) => p.id === id);
/** 랜덤 이벤트로 이번 선택지에 붙는 것 */
interface RollExtra { gift: boolean; curse: boolean }
