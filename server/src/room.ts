import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import {
  COLORS, MAX_PLAYERS, RULES,
  circlePos, isHit, isOut, makeCircle, newPlayer, ranking, resetForRound, resolveClaim, resolveMiss, spawnInterval,
  type BotLevel, type Circle, type ClientToServer, type ColorIndex, type PlayerState, type RoomSnapshot, type ServerToClient,
} from '@color-burst/shared';
import { Bot } from './bot.ts';

type IO = Server<ClientToServer, ServerToClient>;

const TICK_MS = 50;
/** 네트워크 지연을 감안해 과거 몇 ms까지 클릭 위치를 인정할지 */
const LAG_WINDOW_MS = 250;
/** 대기실에서 연결이 끊긴 사람의 자리를 비워 두는 시간(새로고침 대비) */
const LOBBY_GRACE_MS = 15_000;
/** 접속한 사람이 아무도 없을 때 방을 지우기까지 기다리는 시간 */
const EMPTY_ROOM_MS = 30_000;

export class Room {
  hostId = '';
  phase: 'lobby' | 'play' = 'lobby';
  players: PlayerState[] = [];
  fillBots = true;
  botLevel: BotLevel = 0;

  private circles = new Map<number, Circle>();
  private nextCircleId = 1;
  private startAt = 0;
  private endAt = 0;
  private lastSpawn = 0;
  private loop: NodeJS.Timeout | null = null;
  private bots = new Map<string, Bot>();
  /** 비밀 키 → 플레이어 id */
  private keyToId = new Map<string, string>();
  /** 플레이어 id → 현재 소켓 id */
  private socketOf = new Map<string, string>();
  private dropTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimer: NodeJS.Timeout | null = null;

  constructor(private io: IO, readonly code: string, private onEmpty: () => void) {}

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
      if (this.phase === 'play') this.io.to(socketId).emit('game:start', this.playPayload());
      this.broadcastState();
      return { id: p.id };
    }

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
    if (typeof o.fillBots === 'boolean') this.fillBots = o.fillBots;
    if (o.botLevel === 0 || o.botLevel === 1 || o.botLevel === 2) this.botLevel = o.botLevel;
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
    this.circles.clear();
    const now = Date.now();
    this.startAt = now + RULES.countdownMs;
    this.endAt = this.startAt + RULES.roundMs;
    this.lastSpawn = this.startAt;
    this.phase = 'play';
    this.io.to(this.code).emit('game:start', this.playPayload());
    this.broadcastState();
    this.loop = setInterval(() => this.tick(), TICK_MS);
    return null;
  }

  click(id: string, d: { circleId: number | null; x: number; y: number }) {
    const now = Date.now();
    if (this.phase !== 'play' || now < this.startAt) return;
    const p = this.players.find((x) => x.id === id);
    if (!p) return;

    if (d.circleId === null) {
      resolveMiss(p, now);
      this.emitPlayers();
      return;
    }
    const c = this.circles.get(d.circleId);
    // 이미 누가 가져갔거나, 위치가 맞지 않으면 거절
    if (!c || !this.hitWithLag(c, now, d.x, d.y)) {
      const sid = this.socketOf.get(id);
      if (sid) this.io.to(sid).emit('click:rejected', { circleId: d.circleId });
      return;
    }
    this.claim(p, c, now);
  }

  snapshot(): RoomSnapshot {
    return { code: this.code, hostId: this.hostId, phase: this.phase, players: this.players, fillBots: this.fillBots, botLevel: this.botLevel };
  }

  destroy() {
    this.stop();
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

  private playPayload() {
    return { startAt: this.startAt, endAt: this.endAt, players: this.players, circles: [...this.circles.values()] };
  }

  private tick() {
    const now = Date.now();
    if (now < this.startAt) return;
    if (now >= this.endAt) return this.end();

    const kinds = this.players.map((p) => p.color);
    while (now - this.lastSpawn >= spawnInterval(this.lastSpawn - this.startAt)) {
      this.lastSpawn += spawnInterval(this.lastSpawn - this.startAt);
      const c = makeCircle(this.nextCircleId++, this.lastSpawn, this.lastSpawn - this.startAt, kinds);
      this.circles.set(c.id, c);
      this.io.to(this.code).emit('circle:spawn', c);
    }
    for (const [id, c] of this.circles) if (isOut(c, now - LAG_WINDOW_MS)) this.circles.delete(id);

    for (const p of this.players) {
      const bot = this.bots.get(p.id);
      if (!bot) continue;
      const target = bot.think(p, [...this.circles.values()], this.players, now);
      if (target) this.claim(p, target, now);
    }
  }

  private claim(p: PlayerState, c: Circle, now: number) {
    this.circles.delete(c.id);
    const result = resolveClaim(p, c.kind, this.players, now);
    const { x, y } = circlePos(c, now);
    this.io.to(this.code).emit('circle:claimed', { circleId: c.id, by: p.id, result, x, y });
    this.emitPlayers();
  }

  private hitWithLag(c: Circle, now: number, x: number, y: number) {
    for (let t = now; t >= now - LAG_WINDOW_MS; t -= 25) if (isHit(c, t, x, y)) return true;
    return false;
  }

  private end() {
    this.stop();
    this.io.to(this.code).emit('game:over', { ranking: ranking(this.players) });
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
