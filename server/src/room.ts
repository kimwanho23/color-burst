import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import {
  ARCADE, ASSIST_ABILITIES, AUTO_IDS, GROWTH, addBuff, autoEveryMs, buffOn, AUG, COMBO, LEGEND, SPECIAL, addFever, combosOf, goldGain, crossedCombo, hazardStun, halveFever, type EventId, applyRankReach, hasLegend, settleFever, sweepComeback, endRoundSpecials, hyenaGains, isSpecial, judgeComeback, COLORS, DEFAULT_RULES, MAX_PLAYERS, PRESETS, RULES, rollOptions,
  applyPick, addSrc, awardTitles, strikeBoss, endRoundCurses, isCurse, bossTimes, startRound, circlePos, isFever, makeBoss, sanitizeRules, toGameRules, isHit, isOut, makeCircle, newPlayer, ranking, resetForRound, resolveClaim, resolveMiss, shiftTimes, spawnInterval,
  applyItem, holdCircles, isGuarded, itemMult, ownsKind, teamRanking, TIME_ATTACK_RULES, pickOut, survivalCuts, survivalRanking, survivalRoundMs, MODE_KEYS, type CircleKind, rollBossCount, rollBossType, magnetOf, modsOf, reachOf, rollItem,
  RANDOM_EVENT, applyEvent, payTax, rollEvent, rollTheme, hitWithin, type EventResult, type ThemeId,
  FIELD, zoneOf, goldTimes, makeGold, blockedAt, inRingDanger, patternActive, rollPattern, rollPatternAt, shiftPattern, spikeHit, type MapPattern, holdLasers, isStunned, nextLaserIn, pickMagnetTargets, rollVolley, volleyHits, type LaserVolley, type Point, type Pull,
  auraAt, inAura,
  WAVE_PATTERNS, makeWave, nextWaveIn,
  type BotLevel, type Circle, type ClaimVia, type ClientToServer, type ColorIndex, type GameRules, type PlayerState, type PresetId, type RoomRules,
  type AbilityId, type ArcadeState, type Pick, type RoomSnapshot, type ServerToClient, type SpawnOpts, type Zone,
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
  /** 황금 원이 나올 시점(판 시작 후 ms) */
  private goldQueue: number[] = [];
  /** 클릭 속도 제한용: 플레이어 id → 최근 1초 클릭 시각 */
  private clickLog = new Map<string, number[]>();
  /** 비밀 키 → 플레이어 id */
  private keyToId = new Map<string, string>();
  /** 내보낸 사람의 키: 이 방에 다시 못 들어온다 */
  private kicked = new Set<string>();
  /** 플레이어 id → 현재 소켓 id */
  private socketOf = new Map<string, string>();
  private dropTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimer: NodeJS.Timeout | null = null;
  private wins = new Map<string, number>();
  /** 점수 그래프용 기록 */
  private history: Record<string, number[]> = {};
  private nextSample = 0;
  /** 서바이벌: 시작 인원, 클래식 다음 탈락 시각(0 = 없음), 이번 탈락 경고를 보냈는지 */
  private survivalN = 0;
  private nextCutAt = 0;
  private cutWarned = false;
  private pausedAt = 0;
  private pausedBy: string | null = null;
  /** 30초 자동 재개 시각·타이머, 재개 카운트다운이 끝나는 시각·타이머 */
  private pauseUntil = 0;
  private resumeAt = 0;
  private pauseTimer: NodeJS.Timeout | null = null;
  private resumeTimer: NodeJS.Timeout | null = null;
  // ---------- 아케이드 ----------
  private round = 0;
  private roundPhase: 'play' | 'pick' = 'play';
  private pickEndsAt = 0;
  private offers = new Map<string, Offer>();
  // ---------- 랜덤 이벤트 ----------
  /** 이번 게임에 랜덤 이벤트가 일어난 횟수 */
  private eventsUsed = 0;
  /** 이번 게임에 나온 라운드 테마 수 */
  private themesUsed = 0;
  /** 이번 게임에 나온 랜덤 이벤트 (대평등은 한 번만) */
  private eventsUsedIds = new Set<EventId>();
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
  // ---------- 게임 커서 ----------
  /** 플레이어 id → 마지막 커서 위치와 받은 시각 */
  private cursors = new Map<string, { x: number; y: number; at: number }>();
  /** 예고·발사 중인 레이저 볼리들 (hit: 그 볼리에 맞은 플레이어) */
  private lasers: (LaserVolley & { hit: Set<string> })[] = [];
  /** 맵 패턴: 경고 중이거나 나와 있는 것, 이번 라운드에 나올 예정인 것, 사라진 가시 공 */
  private pattern: MapPattern | null = null;
  private pendingPattern: MapPattern | null = null;
  private popped = new Set<number>();
  /** 다음 레이저 시점(판 시작 후 ms) */
  private nextLaserAt = 0;
  /** 원 id → 커서 자석 끌기 */
  private pulls = new Map<number, Pull>();
  /** 플레이어 id → 최근 1초 안에 끌기 시작한 시각들 */
  private pullLog = new Map<string, number[]>();
  /** 플레이어 id → 마지막으로 오오라 감점을 받은 시각 */
  private auraLast = new Map<string, number>();
  /** 오오라 안에 있는 사람, 오오라로 피버가 반감된 시각 (들락날락해도 한 번만) */
  private auraIn = new Set<string>();
  private auraHalvedAt = new Map<string, number>();
  // ---------- 발사 패턴 ----------
  /** 다음 웨이브 시점(판 시작 후 ms) */
  private nextWaveAt = 0;
  /** 아직 안 내보낸 웨이브 원 (born이 되면 내보낸다) */
  private spawnQueue: Circle[] = [];

  /** timeAttack: 혼자·봇 없이 기록 도전 (규칙 고정) */
  constructor(private io: IO, readonly code: string, private onEmpty: () => void, readonly solo = false, readonly timeAttack = false) {
    if (solo) this.fillBots = true;
    if (timeAttack) { this.fillBots = false; this.rules = { ...TIME_ATTACK_RULES }; }
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

    if (this.kicked.has(key)) return { error: '이 방에서 내보내졌어요.' };
    if (this.solo && this.humans.length) return { error: '혼자 하기 방에는 들어갈 수 없어요.' };
    if (this.phase !== 'lobby') return { error: '이미 게임이 진행 중이에요. 끝나면 다시 들어와 주세요.' };
    this.players = this.players.filter((x) => !x.bot);
    if (this.humans.length >= MAX_PLAYERS) return { error: '방이 가득 찼어요.' };
    const color = this.freeColor();
    if (color === null) return { error: '방이 가득 찼어요.' };

    const np = newPlayer(randomUUID().slice(0, 8), name.slice(0, 12) || '플레이어', color);
    // 팀: 들어온 순서대로 인원이 적은 팀 (같으면 0팀)
    np.team = this.smallerTeam();
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
    if (this.solo && this.phase === 'play' && this.roundPhase === 'play') {
      if (!this.pausedAt) this.doPause(playerId);
      else if (this.resumeAt) this.cancelResume(playerId);
    }
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
    const p = this.players.find((x) => x.id === playerId);
    // 게임 중 여럿이 하는 방: 그 자리를 봇이 이어받는다. 혼자 하기·대기실: 자리를 비운다 (사람이 없으면 방 종료)
    if (this.phase === 'play' && !this.solo && p) this.takeOver(p);
    else this.remove(playerId);
  }

  /** 게임 중 나간 사람의 자리를 봇으로: 점수·증강·콤보·피버를 그대로 이어받는다 (다시 들어올 수 없음) */
  private takeOver(p: PlayerState) {
    if (p.bot) return;
    const name = p.name;
    p.bot = true;
    p.connected = true;
    p.name = `${name} (봇)`;
    this.bots.set(p.id, new Bot(this.botLevel));
    for (const [k, id] of this.keyToId) if (id === p.id) this.keyToId.delete(k);
    this.socketOf.delete(p.id);
    this.cursors.delete(p.id);
    for (const [cid, pl] of this.pulls) if (pl.by === p.id) this.pulls.delete(cid);
    // 일시정지를 건 사람이 나가면 바로 다시 시작 카운트다운
    if (this.pausedAt && !this.resumeAt && this.pausedBy === p.id) this.beginResume();
    // 증강 고르는 중이면 남은 선택을 바로 무작위로, 모두 골랐으면 다음 라운드
    if (this.roundPhase === 'pick' && this.offers.has(p.id)) {
      this.autoPick(p.id);
      if ([...this.offers.values()].every((x) => x.chosen)) this.finishPick();
      else this.emitArcade();
    }
    this.passHostIfNeeded();
    this.checkEmpty();
    this.io.to(this.code).emit('player:left', { id: p.id, name });
    this.broadcastState();
    this.emitPlayers();
  }

  /** 아직 안 고른 사람의 남은 선택을 남은 카드에서 무작위로 */
  private autoPick(id: string) {
    const o = this.offers.get(id);
    if (!o || o.chosen) return;
    const p = this.players.find((x) => x.id === id);
    while (p && o.need > 0 && o.options.length) {
      const k = Math.floor(Math.random() * o.options.length);
      applyPick(p, o.options[k]);
      o.options.splice(k, 1);
      o.need--;
    }
    o.chosen = true;
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
    if (typeof o.fillBots === 'boolean' && !this.solo && !this.timeAttack) this.fillBots = o.fillBots;
    if (o.botLevel === 0 || o.botLevel === 1 || o.botLevel === 2) this.botLevel = o.botLevel;
    this.unready();
    this.broadcastState();
  }

  setRules(id: string, d: { preset?: PresetId; rules?: Partial<RoomRules> }) {
    if (id !== this.hostId || this.phase !== 'lobby' || this.timeAttack) return;
    let base = this.rules;
    // 프리셋은 점수·속도 규칙만 바꾸고 모드 설정은 유지
    if (d.preset && d.preset in PRESETS) {
      base = { ...PRESETS[d.preset].rules };
      for (const k of MODE_KEYS) (base as unknown as Record<string, unknown>)[k] = this.rules[k];
    }
    this.rules = sanitizeRules(base, d.rules ?? {});
    this.unready();
    this.broadcastState();
  }

  /** 준비 / 준비 취소: 대기실에서 방장이 아닌 사람 */
  setReady(id: string, on: boolean) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.bot || id === this.hostId || this.phase !== 'lobby') return;
    p.ready = !!on;
    this.broadcastState();
  }

  /** 방장을 뺀 사람 중 아직 준비하지 않은 수 (봇 제외) */
  notReady() {
    return this.humans.filter((p) => p.id !== this.hostId && !p.ready).length;
  }

  /** 방장 넘기기: 방장이 봇이 아닌 다른 사람에게 */
  giveHost(id: string, to: string) {
    const t = this.players.find((x) => x.id === to);
    if (id !== this.hostId || !t || t.bot || to === id) return;
    this.hostId = to;
    t.ready = false;
    this.broadcastState();
  }

  /** 내보내기: 방장이 대기실에서. 그 사람의 키는 이 방에 다시 못 들어온다 */
  kick(id: string, target: string) {
    const t = this.players.find((x) => x.id === target);
    if (id !== this.hostId || this.phase !== 'lobby' || !t || t.bot || target === id) return;
    for (const [k, pid] of this.keyToId) if (pid === target) this.kicked.add(k);
    const sock = this.socketOf.get(target);
    if (sock) {
      this.io.to(sock).emit('room:kicked');
      this.io.sockets.sockets.get(sock)?.leave(this.code);
    }
    this.remove(target);
  }

  private unready() { for (const p of this.players) p.ready = false; }

  /** 내 원인지 (팀전이면 같은 팀 색도) */
  private owns(kind: CircleKind, p: PlayerState) { return ownsKind(kind, p, this.players, this.rules.team); }

  /** 인원이 적은 팀 (같으면 0팀) */
  private smallerTeam(): 0 | 1 {
    const n = (t: 0 | 1) => this.players.filter((p) => p.team === t).length;
    return n(1) < n(0) ? 1 : 0;
  }

  /** 팀 바꾸기: 대기실에서 본인, 한 팀 RULES.team.size명까지 */
  setTeam(id: string, team: 0 | 1) {
    const p = this.players.find((x) => x.id === id);
    if (!p || this.phase !== 'lobby' || (team !== 0 && team !== 1) || p.team === team) return;
    if (this.players.filter((x) => x.team === team).length >= RULES.team.size) return;
    p.team = team;
    this.broadcastState();
  }

  start(id: string): string | null {
    if (id !== this.hostId) return '방장만 시작할 수 있어요.';
    if (this.phase !== 'lobby') return '이미 진행 중이에요.';
    if (!this.solo && this.notReady() > 0) return '아직 준비 안 한 사람이 있어요.';

    // 대기실에서 끊긴 채로 남아 있던 사람은 이번 판에서 제외
    for (const p of this.humans.filter((h) => !h.connected)) this.remove(p.id, false);
    this.players = this.players.filter((p) => !p.bot);
    this.bots.clear();
    // 팀전·서바이벌은 늘 4명이 되게 봇으로 채운다
    if (this.fillBots || this.rules.team || this.rules.survival) {
      let n = 1;
      for (let c = this.freeColor(); c !== null && this.players.length < MAX_PLAYERS; c = this.freeColor()) {
        const bot = newPlayer(`bot-${n}`, `봇 ${String.fromCharCode(64 + n)}`, c, true);
        bot.team = this.smallerTeam();
        this.players.push(bot);
        this.bots.set(bot.id, new Bot(this.botLevel));
        n++;
      }
    }
    if (this.players.length < 2 && !this.timeAttack) {
      this.players = this.players.filter((p) => !p.bot);
      this.bots.clear();
      return '혼자서는 시작할 수 없어요. 친구를 부르거나 봇 채우기를 켜 주세요.';
    }

    this.players.forEach(resetForRound);
    this.G = toGameRules(this.rules);
    // 서바이벌: 클래식 판 시간은 마지막 1명이 남을 때까지
    this.survivalN = this.players.length;
    if (this.G.survival && !this.G.arcade) this.G = { ...this.G, roundMs: survivalRoundMs(this.survivalN) };
    this.history = Object.fromEntries(this.players.map((p) => [p.id, [0]]));
    this.round = 1;
    this.eventsUsed = 0;
    this.themesUsed = 0;
    this.eventsUsedIds.clear();
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

  /** 일시정지 권한: 혼자 하기는 본인, 멀티는 봇이 아닌 사람 누구나 (남은 횟수가 있을 때) */
  canPause(id: string) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.bot) return false;
    return this.solo || p.pausesLeft > 0;
  }
  /** 일시정지 해제: 방 안의 사람(봇 제외) 누구나 */
  canResume(id: string) { return this.players.some((p) => p.id === id && !p.bot); }

  pause(id: string) {
    // 혼자 하기: 다시 시작 카운트다운 중에 다시 멈추면(탭 숨김 등) 카운트다운을 취소
    if (this.solo && this.phase === 'play' && this.pausedAt && this.resumeAt && this.canPause(id)) { this.cancelResume(id); return; }
    // 능력 선택 중에는 제한 시간이 있어서 멈출 수 없다. 멀티는 다시 시작 카운트다운 중에도 안 됨
    if (this.phase !== 'play' || this.roundPhase !== 'play' || this.pausedAt || !this.canPause(id)) return;
    if (!this.solo) this.players.find((p) => p.id === id)!.pausesLeft--;
    this.doPause(id);
    this.emitPlayers();
  }

  /** 누가 풀면 카운트다운 뒤에 다시 시작 (이미 카운트다운 중이면 무시) */
  resume(id: string) {
    if (this.phase !== 'play' || !this.pausedAt || this.resumeAt || !this.canResume(id)) return;
    this.beginResume();
  }

  private beginResume() {
    this.clearPauseTimers();
    // 시작 카운트다운 중에 멈췄으면 다시 시작 카운트다운을 따로 보이지 않고 바로 이어 간다
    // (남은 시작 카운트다운이 그 역할을 한다. 너무 짧게 남았으면 resumeMs만큼은 남게 늘림)
    if (this.pausedAt < this.startAt) {
      this.finishResume(Math.max(0, RULES.pause.resumeMs - (this.startAt - this.pausedAt)));
      return;
    }
    this.resumeAt = Date.now() + RULES.pause.resumeMs;
    this.io.to(this.code).emit('game:resuming', { at: this.resumeAt });
    this.resumeTimer = setTimeout(() => this.finishResume(), RULES.pause.resumeMs);
  }

  /** 혼자 하기: 카운트다운을 취소하고 다시 멈춘 상태로 */
  private cancelResume(id: string) {
    this.clearPauseTimers();
    this.resumeAt = 0;
    this.pausedBy = id;
    this.io.to(this.code).emit('game:pause', { by: id, until: 0, at: this.pausedAt });
  }

  private clearPauseTimers() {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.pauseTimer = this.resumeTimer = null;
  }

  /** 카운트다운이 끝남: 멈춰 있던 시간(카운트다운 포함, extra만큼 더)만큼 모든 시각을 밀고 다시 시작 */
  private finishResume(extra = 0) {
    this.resumeTimer = null;
    if (this.phase !== 'play' || !this.pausedAt) { this.resumeAt = 0; return; }
    const delta = Date.now() - this.pausedAt + extra;
    // 멈춰 있던 시간만큼 모든 시각을 뒤로 민다
    this.startAt += delta; this.endAt += delta; this.lastSpawn += delta;
    // 원의 정지 구간도 출발 시각과 같이 민다 (상대 위치가 그대로여야 한다)
    for (const c of [...this.circles.values(), ...this.spawnQueue]) { c.born += delta; for (const h of c.holds ?? []) h[0] += delta; }
    for (const p of this.players) shiftTimes(p, this.pausedAt, delta);
    for (const z of this.zones) z.until += delta;
    for (const l of this.lasers) l.at += delta;
    for (const pl of this.pulls.values()) pl.at += delta;
    if (this.pattern) this.pattern = shiftPattern(this.pattern, delta);
    if (this.pendingPattern) this.pendingPattern = shiftPattern(this.pendingPattern, delta);
    if (this.nextCutAt) this.nextCutAt += delta;
    if (this.rain && this.rain.until > this.pausedAt) this.rain.until += delta;
    if (this.freezeUntil > this.pausedAt) this.freezeUntil += delta;
    for (const b of this.bots.values()) b.shift(delta);
    this.pausedAt = 0;
    this.pausedBy = null;
    this.pauseUntil = 0;
    this.resumeAt = 0;
    this.io.to(this.code).emit('game:sync', this.playPayload());
  }

  private doPause(id: string) {
    this.pausedAt = Date.now();
    this.pausedBy = id;
    // 멀티: maxMs가 지나면 저절로 풀린다 (멈춘 사람이 나가도 그대로)
    this.pauseUntil = this.solo ? 0 : this.pausedAt + RULES.pause.maxMs;
    if (this.pauseUntil) this.pauseTimer = setTimeout(() => { this.pauseTimer = null; if (this.pausedAt && !this.resumeAt) this.beginResume(); }, RULES.pause.maxMs);
    this.io.to(this.code).emit('game:pause', { by: id, until: this.pauseUntil, at: this.pausedAt });
  }

  /** 아케이드: 능력 고르기 */
  choose(id: string, index: number, cardId?: AbilityId) {
    if (this.phase !== 'play' || this.roundPhase !== 'pick') return;
    const o = this.offers.get(id);
    const p = this.players.find((x) => x.id === id);
    const pick = o?.options[index];
    // 카드 id가 다르면(두 장 차례에 빠르게 두 번 누름 등) 무시
    if (!o || !p || o.chosen || !pick || (cardId !== undefined && pick.id !== cardId)) return;
    applyPick(p, pick);
    // 두 장 고르는 차례: 새 카드를 다시 깔아 한 장 더 (이벤트 선물·저주 배달·꼴찌 등급 보장은 첫 번째에만)
    o.need--;
    o.firstDone = true;
    if (o.need > 0) {
      o.extra = { gift: false, curse: false };
      o.options = this.roll(p, o);
    }
    if (o.need <= 0 || !o.options.length) o.chosen = true;
    else this.sendOffer(id);
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
    o.options = this.roll(p0(this.players, id), o);
    this.sendOffer(id);
  }

  click(id: string, d: { circleId: number | null; x: number; y: number }) {
    const now = Date.now();
    if (this.phase !== 'play' || this.roundPhase !== 'play' || this.pausedAt || now < this.startAt) return;
    const p = this.players.find((x) => x.id === id);
    if (!p || p.outAt) return;
    // 스턴 중이면 클릭 무시 (빈 곳 페널티도 없음)
    if (isStunned(p, now) || !this.allowClick(id, now)) {
      if (d.circleId !== null) this.rejectTo(id, d.circleId);
      return;
    }
    // 벽·회전 막대 안을 누르면 아무 일 없음 (커서가 들어갈 수 없는 곳, 빈 곳 감점도 없음).
    // 지연 보정: 최근 LAG_WINDOW_MS 동안 계속 막혀 있던 곳만 (막 덮친 막대에 밀리는 사람의 클릭은 받아 줌)
    if (this.blockedAll(d, now)) {
      if (d.circleId !== null) this.rejectTo(id, d.circleId);
      return;
    }

    // 판정 순서: ① 직접 맞은 원 ② 넓은 손 범위 안의 내 원 전부 ③ 빈 곳 (원을 노린 클릭이 아닐 때만). 자석은 커서 기준으로 틱마다 (updatePulls)
    let got = false;
    if (d.circleId !== null) {
      const c = this.circles.get(d.circleId);
      // 이미 누가 가져갔거나, 위치가 맞지 않거나, 남의 자석에 끌려가는 중이면 거절
      const pulled = c && this.pulls.get(c.id);
      if (!c || !this.hitWithLag(c, now, d.x, d.y) || (pulled && pulled.by !== id)) this.rejectTo(id, d.circleId);
      else {
        got = true;
        if (c.kind === 'boss') this.hitBoss(p, c, now);
        else if (c.kind === 'item') this.claimItem(p, c, now);
        else if (c.kind === 'gold') this.claimGold(p, c, now);
        else this.claim(p, c, now, 'click');
      }
    }
    const reach = reachOf(p, now);
    if (reach > 0) {
      let ranged = false;
      for (const c of [...this.circles.values()]) {
        if (!this.owns(c.kind, p) || !this.hitWithLag(c, now, d.x, d.y, RULES.hitPad + reach)) continue;
        this.claim(p, c, now, 'range', true);
        ranged = got = true;
      }
      if (ranged) this.emitPlayers();
    }
    // 원을 노리고 눌렀는데 거절된 경우(남이 먼저 가져감 등)는 빈 곳이 아니므로 페널티 없음
    // 보스가 터진 직후의 빈 곳 클릭도 페널티 없음
    // 헛손질 보정: 빈 곳이면 반경 안 가장 가까운 내 원을 대신 잡는다 (페널티 없음)
    if (!got && d.circleId === null) {
      const save = this.nearestMine(p, d, modsOf(p.picks).missSave, now);
      if (save) { this.claim(p, save, now, 'save'); got = true; }
    }
    if (!got && d.circleId === null) {
      // 이동형 보스 오오라를 눌렀으면 아무 일 없음 (헛클릭도 아님, 닿아 있는 동안의 벌은 updateAura)
      if (!this.auraUnder(d, now) && now - this.bossKilledAt >= RULES.boss.killGraceMs) {
        resolveMiss(p, now, this.G, this.players);
        this.emitPlayers();
      }
    }
  }

  /** 지연 시간 동안 줄곧 벽·막대 안이었는지 */
  private blockedAll(pt: Point, now: number) {
    for (let dt = 0; dt <= LAG_WINDOW_MS; dt += 25) if (!blockedAt(this.pattern, pt, now - dt)) return false;
    return true;
  }

  /** 맵 패턴 지우기 (라운드 시작·끝, 게임 끝) */
  private clearPattern() {
    this.pattern = null;
    this.pendingPattern = null;
    this.popped.clear();
  }

  /**
   * 맵 패턴: 경고 시각이 되면 알리고(현수막), 끝나면 지운다. 나와 있는 동안
   * 가시 공에 닿으면 그 공이 사라지고 스턴, 좁아지는 링 위험 구역이면 스턴 (봇은 커서가 없어 제외)
   */
  private updatePattern(now: number) {
    if (this.pendingPattern && now >= this.pendingPattern.warnAt) {
      this.pattern = this.pendingPattern;
      this.pendingPattern = null;
      this.popped.clear();
      this.io.to(this.code).emit('map:warn', this.pattern);
    }
    const pt = this.pattern;
    if (pt && now >= pt.until) { this.pattern = null; this.popped.clear(); return; }
    if (!patternActive(pt, now) || (pt.id !== 'spikes' && pt.id !== 'ring')) return;
    const R = RULES.patterns;
    let changed = false;
    for (const p of this.players) {
      const cur = this.freshCursor(p.id, now);
      if (p.bot || !cur) continue;
      let by: 'spike' | 'ring' | null = null, ms = -1;
      if (pt.id === 'spikes') {
        const i = spikeHit(pt, cur, now, this.popped);
        if (i < 0) continue;
        // 닿은 공은 그 자리에서 사라진다 (스턴이 막혀도)
        this.popped.add(i);
        this.io.to(this.code).emit('map:pop', { index: i, by: p.id });
        by = 'spike'; ms = hazardStun(p, now, R.spikes.stunMs, this.G, this.players);
      } else if (inRingDanger(pt, cur, now)) {
        by = 'ring'; ms = hazardStun(p, now, R.ring.stunMs, this.G, this.players);
      }
      if (by && ms >= 0) changed = true;
      if (by && ms > 0) this.io.to(this.code).emit('stun', { playerId: p.id, until: p.stunUntil, by });
    }
    if (changed) this.emitPlayers();
  }

  /** 이 점이 어떤 이동형 보스의 오오라 안인지 */
  private auraUnder(pt: Point, now: number) {
    for (const c of this.circles.values()) {
      const a = auraAt(c, now);
      if (a && inAura(pt, a)) return true;
    }
    return false;
  }

  /**
   * 오오라: 커서가 이동형 보스 오오라 안이면 tickMs마다 피버 게이지 −feverLoss, 콤보 comboKeepPct%로.
   * 처음 들어갈 때 바로 한 번 적용하고, 피버 중이면 그때 한 번만 피버 절반 (봇은 커서가 없어 제외)
   */
  private updateAura(now: number) {
    const A = RULES.aura;
    let changed = false;
    for (const p of this.players) {
      const cur = this.freshCursor(p.id, now);
      // 벗어나도 마지막 적용 시각은 남겨 둬서, 경계를 들락날락해도 tickMs마다 한 번만
      if (p.bot || !cur || !this.auraUnder(cur, now)) { this.auraIn.delete(p.id); continue; }
      // 들어갈 때 피버 반감 (halveCooldownMs 안에는 다시 안 함)
      if (!this.auraIn.has(p.id)) {
        this.auraIn.add(p.id);
        const h = this.auraHalvedAt.get(p.id);
        if ((h === undefined || now - h >= A.halveCooldownMs) && halveFever(p, now)) { this.auraHalvedAt.set(p.id, now); changed = true; }
      }
      const last = this.auraLast.get(p.id);
      if (last !== undefined && now - last < A.tickMs) continue;
      this.auraLast.set(p.id, now);
      addFever(p, -A.feverLoss, now, this.G, this.players);
      // 철옹성 조합이면 끊김처럼 80%는 남긴다 (더 많이 남는 쪽)
      const iron = combosOf(p.picks).has('ironWall') ? Math.floor((p.combo * COMBO.ironKeepPct) / 100) : 0;
      p.combo = Math.max(Math.floor((p.combo * A.comboKeepPct) / 100), iron);
      this.io.to(this.code).emit('aura:hit', { by: p.id, x: cur.x, y: cur.y });
      changed = true;
    }
    if (changed) this.emitPlayers();
  }

  snapshot(): RoomSnapshot {
    return { code: this.code, hostId: this.hostId, phase: this.phase, players: this.players, fillBots: this.fillBots, botLevel: this.botLevel, rules: this.rules, solo: this.solo, timeAttack: this.timeAttack, wins: Object.fromEntries(this.wins) };
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
    this.cursors.delete(playerId);
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
    if (next) { this.hostId = next.id; next.ready = false; }
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

  /** 보스 타격: 계산은 strikeBoss, 여기서는 원 삭제·알림·자동 획득(사냥꾼 레전드·점화) */
  private hitBoss(p: PlayerState, c: Circle, now: number) {
    const hits = this.bossHits.get(c.id) ?? new Map<string, number>();
    this.bossHits.set(c.id, hits);
    const r = strikeBoss(p, c, hits, this.players, now, this.G);
    // 방어형 보호막: 피해·점수 없음 (헛클릭도 아님) / 붉은 공격형: 감점
    if (r.blocked || r.enraged) {
      this.io.to(this.code).emit('boss:hit', { circleId: c.id, by: p.id, hp: c.hp ?? 0, gained: r.gained, jackpot: 1, ...(r.blocked ? { blocked: true } : { enraged: true }) });
      if (r.enraged) this.emitPlayers();
      return;
    }
    const { x, y } = circlePos(c, now);
    if (!r.killed) {
      this.io.to(this.code).emit('boss:hit', { circleId: c.id, by: p.id, hp: c.hp ?? 0, gained: r.gained, jackpot: r.jackpot, feverStarted: r.feverStarted, comboBonus: r.comboBonus });
    } else {
      this.circles.delete(c.id);
      this.bossHits.delete(c.id);
      this.bossKilledAt = now;
      const mySolo = r.solos.find((s) => s.id === p.id)?.gained ?? 0;
      this.io.to(this.code).emit('boss:killed', {
        circleId: c.id, by: p.id, gained: r.gained + r.killGained + mySolo, mvp: r.mvp, mvpGained: r.mvpGained, x, y, jackpot: r.killJackpot,
        solo: r.solos.map((s) => s.id), soloFever: r.solos.filter((s) => s.feverStarted).map((s) => s.id), feverStarted: r.feverStarted, comboBonus: r.comboBonus,
      });
      // 사냥꾼 레전드: 막타 때 화면의 내 원 전부
      if (hasLegend(p, 'hunter')) this.autoClaim(p, { x, y }, Infinity, Infinity, now);
      // 막타를 안 친 독식자도 보스 헌터 게이지로 피버가 터지면 점화
      for (const s of r.solos) {
        const q = this.players.find((o) => o.id === s.id);
        const qm = q && modsOf(q.picks);
        if (q && q !== p && s.feverStarted && qm!.ignite > 0) this.autoClaim(q, { x, y }, Infinity, hasLegend(q, 'ignite') ? Infinity : qm!.ignite, now);
      }
    }
    // 점화: 보스 타격으로 피버가 터져도 화면의 내 원 자동 획득 (레전드는 전부)
    const m = modsOf(p.picks);
    if (r.feverStarted && m.ignite > 0) this.autoClaim(p, { x, y }, Infinity, hasLegend(p, 'ignite') ? Infinity : m.ignite, now);
    this.emitPlayers();
  }

  private playPayload() {
    return {
      startAt: this.startAt, endAt: this.endAt, players: this.players, circles: [...this.circles.values()],
      rules: this.rules, pausedBy: this.pausedBy, pausedAt: this.pausedAt, nextCutAt: this.nextCutAt, pauseUntil: this.pauseUntil, resumeAt: this.resumeAt, arcade: this.arcadeState(), zones: this.zones, theme: this.theme,
      pulls: [...this.pulls.values()], lasers: this.lasers.map(({ lines, at }) => ({ lines, at })),
      pattern: this.pattern, popped: [...this.popped],
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
    this.goldQueue = goldTimes(this.G.roundMs);
    this.zones = [];
    this.rain = null;
    this.freezeUntil = 0;
    this.nextWaveAt = nextWaveIn(Math.random, this.G.chaos);
    this.lasers = [];
    this.nextLaserAt = nextLaserIn(Math.random, this.G.chaos);
    this.clearPattern();
    this.pulls.clear();
    this.pullLog.clear();
    this.cursors.clear();
    this.auraLast.clear();
    this.auraIn.clear();
    this.auraHalvedAt.clear();
    this.spawnQueue = [];
    this.pausedAt = 0;
    this.pausedBy = null;
    this.clearPauseTimers();
    this.pauseUntil = 0;
    this.resumeAt = 0;
    this.nextSample = HISTORY_STEP_MS;
    const now = Date.now();
    this.startAt = now + RULES.countdownMs;
    this.endAt = this.startAt + this.G.roundMs;
    this.lastSpawn = this.startAt;
    this.nextCutAt = this.G.survival && !this.G.arcade ? this.startAt + RULES.survival.everyMs : 0;
    this.cutWarned = false;
    // 맵 패턴: 라운드마다 확률로 최대 1번
    if (Math.random() < this.G.mapChance) {
      const at = rollPatternAt(this.startAt, this.endAt);
      if (at >= 0) this.pendingPattern = rollPattern(at);
    }
    for (const p of this.players) startRound(p, this.startAt, this.G, this.endAt);
    this.io.to(this.code).emit('game:start', this.playPayload());
  }

  /**
   * 아케이드: 라운드 종료. 먼저 "라운드 종료!"를 알리고 잠시 뒤에 능력 선택을 연다.
   * 라운드 끝에 원을 누르던 클릭이 막 깔린 카드를 골라 버리지 않게 하려는 틈이다
   */
  private endRound() {
    // 끌려오던 원은 끄는 사람이 잡은 것으로 마무리한 뒤 판을 비운다
    this.resolvePulls(Date.now(), true);
    // 서바이벌(아케이드): 뒤쪽 라운드가 끝날 때마다 누적 꼴찌 탈락
    if (this.G.survival && survivalCuts(this.survivalN, ARCADE.rounds).includes(this.round)) {
      this.eliminate(pickOut(this.players.filter((p) => !p.outAt)), Date.now());
    }
    this.clearPattern();
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
    const eventId = rollEvent(this.players, this.eventsUsed, Math.random, this.G.eventChance, { round: this.round, usedIds: this.eventsUsedIds });
    const ev = eventId ? applyEvent(eventId, this.players, this.G) : null;
    this.lastEvent = ev;
    let delay = 0;
    if (ev) {
      this.eventsUsed++;
      this.eventsUsedIds.add(ev.id);
      this.taxPot += ev.pot ?? 0;
      delay = RANDOM_EVENT.pickBonusMs;
      this.pickEndsAt += delay;
    }
    // 라운드 테마: 이벤트와 따로 (다음 라운드가 2라운드 이상, 한 게임 최대 2번)
    this.nextTheme = rollTheme(this.G, this.round, this.themesUsed);
    if (this.nextTheme) this.themesUsed++;
    // 점수 그래프: 저주·랜덤 이벤트까지 반영한 라운드 끝 점수
    for (const p of this.players) (this.history[p.id] ??= []).push(p.score);

    const alive = this.players.filter((p) => !p.outAt);
    const scores = alive.map((p) => p.score);
    const min = Math.min(...scores);
    const tied = scores.every((v) => v === min);
    // 역전 기회: 2라운드 끝부터 판정 (그 전에는 모두 꺼짐)
    const k = this.round - 1;
    const cb = k >= ARCADE.comeback.from ? judgeComeback(alive) : new Set<string>();
    for (const p of this.players) p.comeback = cb.has(p.id);
    this.offers.clear();
    // 서바이벌에서 탈락한 사람은 고르지 않는다
    for (const p of alive) {
      const last = !tied && p.score === min;
      const allLegend = p.legendNext;
      p.legendNext = false;
      const extra: RollExtra = { gift: ev?.giftTo === p.id, curse: ev?.curseTo === p.id };
      const o: Offer = { options: [], rerolls: ARCADE.rerollsPerPick, need: ARCADE.picksPerRound[Math.min(k, ARCADE.picksPerRound.length - 1)], chosen: false, firstDone: false, last, comeback: p.comeback, allLegend, extra };
      o.options = this.roll(p, o);
      this.offers.set(p.id, o);
    }
    this.emitArcade();
    if (ev) { this.io.to(this.code).emit('arcade:event', ev); this.emitPlayers(); }
    for (const p of alive) {
      if (!p.bot) { this.sendOffer(p.id); continue; }
      // 봇은 1~3초 고민하다가 고른다 (두 장 고르는 차례면 한 장씩 차례로)
      const botPick = (wait: number) => this.botPickTimers.push(setTimeout(() => {
        const o = this.offers.get(p.id);
        if (!o || o.chosen) return;
        this.choose(p.id, botChoice(o.options, o.last));
        if (!o.chosen) botPick(800 + Math.random() * 1200);
      }, wait));
      botPick(delay + 1000 + Math.random() * 2000);
    }
    this.pickTimer = setTimeout(() => this.finishPick(), ARCADE.pickSec * 1000 + delay);
  }

  /** 선택 마감: 안 고른 사람은 무작위로 정하고 다음 라운드 */
  private finishPick() {
    if (this.roundPhase !== 'pick') return;
    this.clearPickTimers();
    // 안 고른 사람은 남은 고를 수만큼 무작위로
    for (const id of this.offers.keys()) this.autoPick(id);
    this.offers.clear();
    this.round++;
    this.roundPhase = 'play';
    this.emitPlayers();
    this.beginRound();
  }

  /**
   * 선택지 뽑기: 차례(k = 라운드 − 1)에 따라 노말 제외·꼴찌 등급 보장, 역전 꼴찌는 3번째에 특별 카드·4번째에 전부 레전드.
   * extra: 랜덤 이벤트 선물(선택지 +1)·저주 배달
   */
  private roll(p: PlayerState | undefined, o: Offer) {
    const k = this.round - 1, C = ARCADE.comeback;
    const curses = p ? p.picks.filter((x) => isCurse(x.id)).length : 0;
    const opts = {
      curses, allLegend: o.allLegend || (o.comeback && k === C.legendAt), forceCurse: o.extra.curse,
      exclude: this.offPool(),
      minTier: (k >= ARCADE.noNormalFrom ? 1 : 0) as 0 | 1,
      guarantee: o.last && !o.firstDone ? ARCADE.lastGuarantee[Math.min(k, ARCADE.lastGuarantee.length - 1)] as 0 | 1 | 2 | 3 : undefined,
      special: o.comeback && k === C.specialAt && !p?.picks.some((x) => isSpecial(x.id)),
      owned: p?.picks,
    };
    return rollOptions(k, o.last, Math.random, opts, ARCADE.optionCount + (o.extra.gift ? 1 : 0));
  }

  /** 이 방에서 효과가 없는 증강 (레이저·아이템이 꺼진 방) */
  private offPool(): AbilityId[] {
    // 방해 내성: 레이저·방해 아이템·맵 패턴이 모두 꺼진 방에서만 뺀다
    const noHazard = !this.G.laser && !this.G.sabotage && this.G.mapChance <= 0;
    return [...(noHazard ? ['laserProof' as const] : []), ...(this.G.items ? [] : ['collector' as const])];
  }

  /** 라운드 종료 저주 효과를 적용하고 모두에게 알린다 */
  private applyRoundCurses() {
    if (!this.G.arcade) return;
    const effects = [...this.players.flatMap((p) => endRoundCurses(p)), ...endRoundSpecials(this.players)];
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
    this.io.to(sid).emit('arcade:offer', { options: o.options, rerollLeft: o.rerolls, pickEndsAt: this.pickEndsAt, lastPlace: o.last, need: o.need, comeback: o.comeback });
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
    // 서바이벌(클래식): 탈락 판정이 판 끝 판정보다 먼저 (마지막 탈락이 곧 판 끝)
    if (this.nextCutAt) { this.updateSurvival(now); if (this.phase !== 'play') return; }
    if (now >= this.endAt) return this.G.arcade && this.round < ARCADE.rounds ? this.endRound() : this.end();
    while (now - this.startAt >= this.nextSample) {
      for (const p of this.players) (this.history[p.id] ??= []).push(p.score);
      this.nextSample += HISTORY_STEP_MS;
    }

    const kinds = this.spawnKinds();
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
    this.updateLaser(now);
    this.updatePulls(now);
    this.updateAura(now);
    this.updatePattern(now);
    this.updateAuto(now);
    // 과충전 레전드: 피버가 끝나면 남겨 둔 게이지를 채움
    let settled = false;
    for (const p of this.players) if (settleFever(p, now)) settled = true;
    if (settled) this.emitPlayers();
    while (now >= this.freezeUntil && this.bossQueue.length && now - this.startAt >= this.bossQueue[0]) {
      this.bossQueue.shift();
      this.spawnBosses(now);
    }
    while (now >= this.freezeUntil && this.goldQueue.length && now - this.startAt >= this.goldQueue[0]) {
      this.goldQueue.shift();
      const g = makeGold(this.nextCircleId++, now);
      this.circles.set(g.id, g);
      this.io.to(this.code).emit('circle:spawn', g);
    }
    for (const [id, c] of this.circles) {
      // 끌려가는 원은 잡힐 때까지 남겨 둔다
      if (!isOut(c, now - LAG_WINDOW_MS) || this.pulls.has(id)) continue;
      this.circles.delete(id);
      if (c.kind === 'boss') { this.bossHits.delete(id); this.io.to(this.code).emit('boss:escaped', { circleId: id }); }
    }

    // 장판: 위를 지나는 주인의 내 원을 자동으로 잡는다
    this.zones = this.zones.filter((z) => z.until > now);
    let zoned = false;
    for (const z of this.zones) {
      const owner = this.players.find((p) => p.id === z.by);
      if (!owner || owner.outAt) continue;
      for (const c of [...this.circles.values()]) {
        if (!this.owns(c.kind, owner) || isGuarded(c, now)) continue;
        const q = circlePos(c, now);
        if (Math.hypot(q.x - z.x, q.y - z.y) <= c.r + z.r) { this.claim(owner, c, now, 'zone', true); zoned = true; }
      }
    }
    if (zoned) this.emitPlayers();

    for (const p of this.players) {
      const bot = this.bots.get(p.id);
      if (!bot || p.outAt) continue;
      const target = bot.think(p, this.botCandidates(), this.players, now, this.rules.team);
      if (!target) continue;
      if (target.kind === 'boss') this.hitBoss(p, target, now);
      else if (target.kind === 'item') this.claimItem(p, target, now);
      else if (target.kind === 'gold') this.claimGold(p, target, now);
      else this.claim(p, target, now, 'click');
    }
  }

  /** 새 원 생성 옵션: 아이템 원 확률, 내 색 비 */
  /** 발사 패턴: 때가 되면 예고를 보내고 웨이브를 예약, 예약된 원은 born이 되면 내보낸다 */
  private spawnWaves(now: number, kinds: ColorIndex[]) {
    const W = RULES.waves;
    if (this.G.waves && now >= this.freezeUntil && now - this.startAt >= this.nextWaveAt) {
      const at = now + W.warnMs;
      this.nextWaveAt = at - this.startAt + nextWaveIn(Math.random, this.G.chaos);
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

  /** 보스 등장: 1~3마리(화면에 최대 3마리), 종류는 마리마다 따로, 서로 다른 방향으로 */
  private spawnBosses(now: number) {
    const alive = [...this.circles.values()].filter((c) => c.kind === 'boss').length;
    const n = rollBossCount(alive, this.theme, Math.random, this.G.chaos);
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const b = makeBoss(this.nextCircleId++, now, this.players.length, this.G, Math.random, rollBossType(), base + (Math.PI * 2 * i) / n);
      this.circles.set(b.id, b);
      this.io.to(this.code).emit('circle:spawn', b);
    }
  }

  /** 게임 커서 위치 (필드 안으로 자름) */
  cursor(id: string, p: Point) {
    if (this.players.find((x) => x.id === id)?.outAt) return;
    this.cursors.set(id, { x: Math.max(0, Math.min(FIELD.w, p.x)), y: Math.max(0, Math.min(FIELD.h, p.y)), at: Date.now() });
  }

  /** 오래되지 않은 커서 (탭을 바꾸거나 캔버스를 벗어나면 판정에서 뺀다) */
  private freshCursor(id: string, now: number) {
    const c = this.cursors.get(id);
    return c && now - c.at <= RULES.cursor.staleMs ? c : null;
  }

  /**
   * 레이저 발사기: 예약 시각이 되면 볼리를 예고하고 다음을 예약한다 (카오스는 2초마다라 여러 볼리가 겹칠 수 있다).
   * 발사 중인 볼리의 줄에 커서가 닿으면 스턴. 스턴 중·스턴이 끝난 직후(무적)에는 다시 걸리지 않는다
   */
  private updateLaser(now: number) {
    if (!this.G.laser) return;
    const L = RULES.laser;
    const el = now - this.startAt;
    // 판 시작 직후·시간 정지 중·라운드 끝 직전에는 쏘지 않는다
    if (el >= this.nextLaserAt && el >= L.startQuietMs && now >= this.freezeUntil && this.endAt - (now + L.warnMs + L.fireMs) >= L.endQuietMs) {
      const v = { lines: rollVolley(Math.random, this.G.laserHalf).lines, at: now + L.warnMs };
      this.lasers.push({ ...v, hit: new Set() });
      this.io.to(this.code).emit('laser:warn', v);
      this.nextLaserAt = el + nextLaserIn(Math.random, this.G.chaos);
    }
    this.lasers = this.lasers.filter((l) => now < l.at + L.fireMs);
    let stunned = false;
    for (const l of this.lasers) {
      if (now < l.at) continue;
      for (const p of this.players) {
        const cur = this.freshCursor(p.id, now);
        if (p.bot || l.hit.has(p.id) || !cur || !volleyHits(cur, l.lines, this.G.laserHalf)) continue;
        l.hit.add(p.id);
        // 위험 스턴 공통: 철벽·무적 시간, 방해 내성, 피버 중이면 피버 절반
        const r = hazardStun(p, now, L.stunMs, this.G, this.players);
        if (r < 0) continue;
        // 스턴이 없어도(완전 면역) 피버 게이지가 바뀌었을 수 있어 상태를 보낸다
        stunned = true;
        if (r > 0) this.io.to(this.code).emit('stun', { playerId: p.id, until: p.stunUntil, by: 'laser' });
      }
    }
    if (stunned) this.emitPlayers();
  }

  /** 자동 시전 증강: 때가 된 것을 발동하고 다음 시각을 정한다 (자기장은 봇에게 없음) */
  /** 원 색: 탈락하지 않은 사람의 색 */
  private spawnKinds() { return this.players.filter((p) => !p.outAt).map((p) => p.color); }

  /** 서바이벌(클래식): warnMs 전에 지금 꼴찌를 경고하고, 때가 되면 꼴찌 탈락. 1명 남으면 게임 끝 */
  private updateSurvival(now: number) {
    if (!this.nextCutAt) return;
    const alive = this.players.filter((p) => !p.outAt);
    if (!this.cutWarned && now >= this.nextCutAt - RULES.survival.warnMs) {
      this.cutWarned = true;
      this.io.to(this.code).emit('survival:warn', { id: pickOut(alive, () => 0).id, at: this.nextCutAt });
    }
    if (now < this.nextCutAt) return;
    this.eliminate(pickOut(alive), now);
    this.nextCutAt += RULES.survival.everyMs;
    this.cutWarned = false;
    if (alive.length - 1 <= 1) this.end();
  }

  /** 탈락: 순위 = 탈락 직전 살아 있던 수. 끌던 원·커서를 지운다 */
  private eliminate(p: PlayerState, now: number) {
    const alive = this.players.filter((x) => !x.outAt).length;
    p.outAt = now;
    p.outRank = alive;
    for (const [cid, pl] of this.pulls) if (pl.by === p.id) this.pulls.delete(cid);
    this.cursors.delete(p.id);
    this.io.to(this.code).emit('player:out', { id: p.id, rank: alive });
    this.emitPlayers();
  }

  private updateAuto(now: number) {
    let changed = false;
    for (const p of this.players) {
      if (p.outAt) continue;
      for (const id of AUTO_IDS) {
        const at = p.autoAt[id];
        if (at === undefined || now < at) continue;
        const every = autoEveryMs(p, id);
        p.autoAt[id] = Number.isFinite(every) ? Math.max(at + every, now + 1) : undefined;
        if (id === 'autoMagnet' && p.bot) continue;
        const L = hasLegend(p, id);
        if (id === 'autoMagnet') addBuff(p, 'magnet', GROWTH.autoMs.autoMagnet, now);
        else if (id === 'autoGuard') addBuff(p, 'guard', L ? LEGEND.autoGuardMs : GROWTH.autoMs.autoGuard, now);
        else addFever(p, L ? LEGEND.autoCharge : GROWTH.autoCharge, now, this.G, this.players, true);
        this.io.to(this.code).emit('auto:fire', { playerId: p.id, id });
        changed = true;
      }
    }
    if (changed) this.emitPlayers();
  }

  /** 커서 자석: 끝난 끌기는 잡고, 커서 근처 내 원을 새로 끈다 (플레이어마다 1초에 perSec개) */
  private updatePulls(now: number) {
    const M = RULES.magnet;
    this.resolvePulls(now);
    // 같은 틱에 여러 사람 자석이 같은 원을 노릴 때 순번이 늘 같은 사람에게 유리하지 않게 섞는다
    const order = [...this.players];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const p of order) {
      const cur = this.freshCursor(p.id, now);
      const radius = magnetOf(p, now, cur);
      if (p.bot || p.outAt || !cur || radius <= 0 || isStunned(p, now)) continue;
      const log = (this.pullLog.get(p.id) ?? []).filter((t) => now - t < 1000);
      this.pullLog.set(p.id, log);
      // 자석 레전드: 1초에 LEGEND.magnetPerSec개
      // 자기장 레전드: 발동 중 1초에 하나 더
      const per = (hasLegend(p, 'magnet') ? LEGEND.magnetPerSec : M.perSec) + (hasLegend(p, 'autoMagnet') && buffOn(p, 'magnet', now) ? LEGEND.autoMagnetAdd : 0);
      if (log.length >= per) continue;
      for (const c of pickMagnetTargets(this.circles.values(), (k) => this.owns(k, p), cur, now, radius, per - log.length, new Set(this.pulls.keys()))) {
        const pl: Pull = { circleId: c.id, by: p.id, from: circlePos(c, now), at: now, ms: M.pullMs };
        this.pulls.set(c.id, pl);
        log.push(now);
        this.io.to(this.code).emit('circle:pull', pl);
      }
    }
  }

  /** 다 끌려온 원을 끄는 사람이 잡은 것으로 처리. all이면 시간과 상관없이 모두 (라운드가 끝날 때) */
  private resolvePulls(now: number, all = false) {
    let claimed = false;
    for (const [id, pl] of [...this.pulls]) {
      if (!all && pl.at + pl.ms > now) continue;
      this.pulls.delete(id);
      const c = this.circles.get(id), p = this.players.find((x) => x.id === pl.by);
      if (c && p) { this.claim(p, c, now, 'magnet', true); claimed = true; }
    }
    if (claimed) this.emitPlayers();
  }

  /** 봇이 고를 수 있는 원: 남의 자석에 끌려가는 원은 뺀다 */
  private botCandidates() {
    return [...this.circles.values()].filter((c) => !this.pulls.has(c.id));
  }

  /** 새 원 생성 옵션: 아이템 원 확률, 라운드 테마, 내 색 비 */
  private spawnOpts(now: number): SpawnOpts {
    const T = RULES.themes;
    const chaos = this.G.chaos ? RULES.chaos.itemMult : 1;
    const o: SpawnOpts = { itemChance: this.G.items ? RULES.items.chance * chaos * (this.theme === 'itemRush' ? T.itemRushMult : 1) : 0 };
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
    // 남의 자석에 끌려가는 원은 그 사람만 잡는다
    const pulled = this.pulls.get(c.id);
    if (pulled && pulled.by !== p.id) return;
    this.circles.delete(c.id);
    // 잡는 순간 원이 있던 자리로 점수 구역을 정한다 (잡는 방법과 상관없이)
    const { x, y } = circlePos(c, now);
    const comboBefore = p.combo;
    const result = resolveClaim(p, c.kind, this.players, now, this.G, { via, zone: zoneOf({ x, y }) });
    this.io.to(this.code).emit('circle:claimed', { circleId: c.id, by: p.id, result, x, y });
    // 하이에나: 1등이 잡으면 하이에나를 가진 사람이 확률로 점수를 얻는다
    for (const g of hyenaGains(p, this.players, result.gained)) this.io.to(this.code).emit('special:gain', { playerId: g.playerId, id: 'hyena', delta: g.delta });
    // 연쇄 폭발: 확률로 근처 내 원도 함께 (연쇄로 잡힌 원은 다시 연쇄하지 않음)
    // 점수가 바뀌었으니 꼴찌를 벗어난 역전 기회는 바로 끈다 (조용한 연속 획득 사이에도)
    sweepComeback(this.players);
    if (via !== 'blast') {
      const m = modsOf(p.picks);
      // 연쇄 콤보: 10콤보(레전드 5)를 넘을 때마다 근처 내 원 자동 획득 (콤보가 오른 획득만)
      const every = hasLegend(p, 'chainCombo') ? LEGEND.chainEvery : AUG.chainEvery;
      if (m.chainCombo > 0 && crossedCombo(comboBefore, p.combo, every)) this.autoClaim(p, { x, y }, AUG.chainR, m.chainCombo, now);
      // 점화: 피버가 터지면 화면의 내 원 자동 획득 (레전드는 전부)
      if (m.ignite > 0 && result.feverStarted) this.autoClaim(p, { x, y }, Infinity, hasLegend(p, 'ignite') ? Infinity : m.ignite, now);
    }
    if (via !== 'blast' && modsOf(p.picks).chainBlast && Math.random() < SPECIAL.chainChance) {
      for (const o of [...this.circles.values()]) {
        if (!this.owns(o.kind, p) || isGuarded(o, now)) continue;
        const q = circlePos(o, now);
        if (Math.hypot(q.x - x, q.y - y) <= SPECIAL.chainR + o.r) this.claim(p, o, now, 'blast', true);
      }
    }
    if (!quiet) this.emitPlayers();
  }

  /** 이 점에서 반경 안 가장 가까운 내 일반 원 (보호 구역·끌리는 원 제외) */
  private nearestMine(p: PlayerState, pt: Point, radius: number, now: number): Circle | null {
    if (radius <= 0) return null;
    let best: Circle | null = null, bd = Infinity;
    for (const c of this.circles.values()) {
      if (!this.owns(c.kind, p) || isGuarded(c, now) || this.pulls.has(c.id)) continue;
      let d = Infinity;
      for (let t = now; t >= now - LAG_WINDOW_MS; t -= 25) {
        const q = circlePos(c, t);
        d = Math.min(d, Math.hypot(q.x - pt.x, q.y - pt.y) - c.r);
      }
      if (d <= radius && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** 자동 획득(연쇄 콤보·점화·사냥꾼 레전드): 가까운 내 원부터 n개를 'blast'로 잡는다 (다시 연쇄하지 않음) */
  private autoClaim(p: PlayerState, from: Point, radius: number, n: number, now: number) {
    const list = [...this.circles.values()]
      .filter((c) => this.owns(c.kind, p) && !isGuarded(c, now) && !this.pulls.has(c.id))
      .map((c) => { const q = circlePos(c, now); return { c, d: Math.hypot(q.x - from.x, q.y - from.y) }; })
      .filter((o) => o.d <= radius + o.c.r)
      .sort((a, b) => a.d - b.d);
    for (const { c } of list.slice(0, n)) this.claim(p, c, now, 'blast', true);
    if (list.length) this.emitPlayers();
  }

  /** 황금 원: 일반 원과 같은 배율 (goldGain), 콤보·피버 게이지는 그대로 */
  private claimGold(p: PlayerState, c: Circle, now: number) {
    if (!this.circles.has(c.id)) return;
    this.circles.delete(c.id);
    const { x, y } = circlePos(c, now);
    // 일반 원과 같은 배율 (잡은 자리의 점수 구역 포함)
    const { gained, jackpot } = goldGain(p, now, this.players, this.G, zoneOf({ x, y }));
    p.score += gained;
    addSrc(p, 'gold', gained, { fever: isFever(p, now), jackpot });
    this.io.to(this.code).emit('gold:got', { circleId: c.id, by: p.id, gained, x, y, jackpot });
    this.emitPlayers();
  }

  /** 아이템 원: 무작위 아이템을 바로 발동한다 */
  private claimItem(p: PlayerState, c: Circle, now: number) {
    if (!this.circles.has(c.id)) return;
    this.circles.delete(c.id);
    // 아이템 사냥꾼: 한 등급 위 아이템
    const up = (modsOf(p.picks).itemHunter ? 1 : 0) + (hasLegend(p, 'collector') && Math.random() < LEGEND.collectorUp ? 1 : 0);
    const tier = Math.min(2, (c.itemTier ?? 0) + up) as 0 | 1 | 2;
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
          if (o.kind === 'boss' || o.kind === 'item' || o.kind === 'gold' || isGuarded(o, now)) continue;
          const q = circlePos(o, now);
          if (action.kind === 'fieldClear' || Math.hypot(q.x - x, q.y - y) <= o.r + I.bombR) this.claim(p, o, now, 'blast', true);
        }
        break;
      case 'timeStop': {
        const ids = holdCircles(this.circles.values(), now, I.freezeMs);
        this.freezeUntil = now + I.freezeMs;
        // 예고 중인 레이저도 멈춘 시간만큼 늦게 쏜다 (시간 정지 중에는 쏘지 않음)
        holdLasers(this.lasers, now, I.freezeMs);
        // 예약된 웨이브 원도 정지가 끝난 뒤로 미룬다 (나선 간격은 유지)
        for (const q of this.spawnQueue) q.born += I.freezeMs;
        this.io.to(this.code).emit('circles:hold', { ids, at: now, ms: I.freezeMs });
        break;
      }
      case 'rain':
        this.rain = { color: p.color, until: now + I.ms.rain };
        break;
      case 'snipe': {
        // 1등 저격: 대상은 applyItem이 스턴했다. 모두에게 알린다
        const target = 'target' in action ? this.players.find((x) => x.id === action.target) : undefined;
        if (target) this.io.to(this.code).emit('stun', { playerId: target.id, until: target.stunUntil, by: 'snipe' });
        break;
      }
    }
    this.emitPlayers();
  }

  private hitWithLag(c: Circle, now: number, x: number, y: number, pad: number = RULES.hitPad) {
    return hitWithin(c, now, x, y, pad, LAG_WINDOW_MS);
  }

  private end() {
    this.resolvePulls(Date.now(), true);
    this.clearPattern();
    this.stop();
    this.clearPickTimers();
    this.applyRoundCurses();
    this.offers.clear();
    this.roundPhase = 'play';
    for (const p of this.players) (this.history[p.id] ??= []).push(p.score);
    const rank = this.G.survival ? survivalRanking(this.players) : ranking(this.players);
    const top = rank[0]?.score ?? 0;
    // 팀전: 이긴 팀 사람마다 1승. 아니면 공동 1등은 모두 1승 (사람만 기록)
    const teams = this.rules.team ? teamRanking(this.players) : undefined;
    const winners = teams ? new Set(teams[0].ids) : this.G.survival ? new Set([rank[0]?.id]) : new Set(rank.filter((p) => p.score === top).map((p) => p.id));
    for (const p of rank) if (winners.has(p.id) && !p.bot) this.wins.set(p.id, (this.wins.get(p.id) ?? 0) + 1);
    this.io.to(this.code).emit('game:over', {
      ranking: rank,
      teams,
      titles: awardTitles(this.players),
      history: { stepMs: HISTORY_STEP_MS, scores: this.history },
      wins: Object.fromEntries(this.wins),
    });
    this.players = this.players.filter((p) => !p.bot);
    this.bots.clear();
    this.phase = 'lobby';
    this.unready();
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
    this.clearPauseTimers();
    this.pauseUntil = 0;
    this.resumeAt = 0;
  }

  private freeColor(): ColorIndex | null {
    for (let i = 0; i < COLORS.length; i++) if (!this.players.some((p) => p.color === i)) return i as ColorIndex;
    return null;
  }

  /** 플레이어 상태를 보낸다 (넓은 손 순위 보정을 먼저 다시 계산) */
  private emitPlayers() {
    sweepComeback(this.players);
    applyRankReach(this.players, this.G);
    this.io.to(this.code).emit('players', this.players);
  }
  private broadcastState() { this.io.to(this.code).emit('room:state', this.snapshot()); }
}

const p0 = (players: PlayerState[], id: string) => players.find((p) => p.id === id);

/**
 * 봇의 카드 고르기: 특별 카드가 먼저, 그다음 가장 높은 등급. 저주는 꼴찌일 때만 반반 확률로.
 * 보조 능력(넓은 손·자석)은 봇에게 효과가 없어서, 다른 선택지가 있으면 고르지 않는다
 */
function botChoice(opts: Pick[], last: boolean) {
  const sp = opts.findIndex((o) => isSpecial(o.id));
  if (sp >= 0) return sp;
  const curseAt = opts.findIndex((o) => isCurse(o.id));
  const useful = opts.some((o) => !isCurse(o.id) && !ASSIST_ABILITIES.includes(o.id));
  let best = -1;
  opts.forEach((o, i) => {
    if (isCurse(o.id) || (useful && ASSIST_ABILITIES.includes(o.id))) return;
    if (best < 0 || o.tier > opts[best].tier || (o.tier === opts[best].tier && Math.random() < 0.5)) best = i;
  });
  if (curseAt >= 0 && (best < 0 || (last && Math.random() < 0.5))) best = curseAt;
  return Math.max(0, best);
}
/** 랜덤 이벤트로 이번 선택지에 붙는 것 */
interface RollExtra { gift: boolean; curse: boolean }
/** 한 사람의 이번 선택: 남은 카드, 남은 고를 수(need), 꼴찌·역전·뽑기 옵션 */
interface Offer {
  options: Pick[]; rerolls: number; need: number; chosen: boolean;
  /** 이 차례의 첫 카드를 골랐는지 (꼴찌 등급 보장은 첫 묶음에만) */
  firstDone: boolean;
  last: boolean; comeback: boolean; allLegend: boolean; extra: RollExtra;
}
