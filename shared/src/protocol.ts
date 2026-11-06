/**
 * 클라이언트와 서버가 주고받는 메시지 형식.
 * 통신 라이브러리를 바꿔도 이 형식은 그대로 쓸 수 있다.
 */
import type { Circle, ClaimResult, ColorIndex, PlayerState, PresetId, RoomRules, Title } from './rules.ts';
import type { Pick, RoundEffect } from './arcade.ts';
import type { ItemId, ItemTier } from './items.ts';
import type { EventResult } from './events.ts';
import type { WavePattern } from './waves.ts';
import type { ThemeId } from './rules.ts';

/** 장판: 위를 지나는 주인의 내 원을 자동으로 잡는다 */
export interface Zone { id: number; by: string; x: number; y: number; r: number; until: number }

/** 아케이드 진행 상태 */
export interface ArcadeState {
  /** 현재 라운드 (1부터) */
  round: number;
  rounds: number;
  /** play: 라운드 진행 중 / pick: 라운드가 끝나고 능력 고르는 중 */
  phase: 'play' | 'pick';
  pickEndsAt: number;
  /** 아직 능력을 안 고른 플레이어 id */
  waiting: string[];
  /** 진행 중인 라운드(play) 또는 다음 라운드(pick)의 테마 */
  theme: ThemeId | null;
}

export interface ArcadeOffer {
  options: Pick[];
  rerollLeft: number;
  pickEndsAt: number;
  /** 꼴찌라서 상위 등급 확률이 올라간 선택지인지 */
  lastPlace: boolean;
}

export type Phase = 'lobby' | 'play';
export type BotLevel = 0 | 1 | 2;

export interface RoomSnapshot {
  code: string;
  hostId: string;
  phase: Phase;
  players: PlayerState[];
  fillBots: boolean;
  botLevel: BotLevel;
  rules: RoomRules;
  /** 혼자 하기 방 (다른 사람 입장 불가, 빈 자리는 항상 봇) */
  solo: boolean;
  /** 이 방에서의 누적 승수 (사람만) */
  wins: Record<string, number>;
}

export interface GameOver {
  ranking: PlayerState[];
  titles: Title[];
  /** stepMs 간격으로 기록한 플레이어별 점수 */
  history: { stepMs: number; scores: Record<string, number[]> };
  wins: Record<string, number>;
}

export interface PlayPayload {
  startAt: number;
  endAt: number;
  players: PlayerState[];
  circles: Circle[];
  rules: RoomRules;
  /** 일시정지 중이면 멈춘 사람 id */
  pausedBy: string | null;
  /** 아케이드 모드가 아니면 null */
  arcade: ArcadeState | null;
  zones: Zone[];
  /** 이번 라운드 테마 (아케이드 랜덤 이벤트) */
  theme: ThemeId | null;
}

export type Ack<T = {}> = (r: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void;
  /** 새 판 시작 */
  'game:start': (d: PlayPayload) => void;
  /** 진행 중인 판 상태 전체 (재접속, 일시정지 해제 때) */
  'game:sync': (d: PlayPayload) => void;
  'game:pause': (d: { by: string }) => void;
  /** 아케이드: 라운드가 끝나 능력 선택 시작, 또는 선택 현황이 바뀜 */
  'arcade:pick': (d: ArcadeState) => void;
  /** 아케이드: 라운드가 끝날 때 적용된 저주 결과 */
  'arcade:effects': (d: RoundEffect[]) => void;
  /** 아케이드: 나에게만 보내는 능력 선택지 */
  'arcade:offer': (d: ArcadeOffer) => void;
  /** 아케이드: 라운드 사이 랜덤 이벤트 (능력 선택 시작 직후) */
  'arcade:event': (d: EventResult) => void;
  'circle:spawn': (c: Circle) => void;
  'circle:claimed': (d: { circleId: number; by: string; result: ClaimResult; x: number; y: number }) => void;
  'click:rejected': (d: { circleId: number }) => void;
  /** 아이템 원을 잡음. 블라스트(폭죽·필드 클리어)면 이 이벤트가 먼저 오고 circle:claimed가 이어진다 */
  'item:got': (d: { circleId: number; by: string; item: ItemId; tier: ItemTier; x: number; y: number }) => void;
  'zone:add': (z: Zone) => void;
  /** 발사 패턴 예고: at(서버 시각)에 웨이브가 나온다 */
  'wave:warn': (d: { pattern: WavePattern; at: number }) => void;
  /** 시간 정지: 해당 원들에 정지 구간 [at, at + ms] */
  'circles:hold': (d: { ids: number[]; at: number; ms: number }) => void;
  /** 보스를 때림 (hp: 남은 체력) */
  'boss:hit': (d: { circleId: number; by: string; hp: number; gained: number; jackpot: number }) => void;
  /** 보스 처치: by가 막타, mvp가 최다 타격 */
  'boss:killed': (d: { circleId: number; by: string; gained: number; mvp: string | null; mvpGained: number; x: number; y: number; jackpot: number }) => void;
  'boss:escaped': (d: { circleId: number }) => void;
  players: (p: PlayerState[]) => void;
  'game:over': (d: GameOver) => void;
}

export interface ClientToServer {
  /**
   * key: 브라우저 탭마다 만드는 비밀 키. 새로고침해도 유지되며, 같은 키로 다시 들어오면 원래 자리로 복귀한다.
   * you: 이 방에서 내 플레이어 id (공개 id. key는 다른 사람에게 보내지 않는다)
   */
  'room:create': (d: { name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  'room:join': (d: { code: string; name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  /** 혼자 하기: 봇과 하는 비공개 방 */
  'room:solo': (d: { name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  'room:leave': () => void;
  'lobby:color': (color: ColorIndex) => void;
  'lobby:options': (o: { fillBots?: boolean; botLevel?: BotLevel }) => void;
  /** 방 규칙 변경(방장). preset을 주면 그 프리셋으로 덮어쓴 뒤 rules를 반영 */
  'lobby:rules': (d: { preset?: PresetId; rules?: Partial<RoomRules> }) => void;
  'game:start': (ack: Ack) => void;
  /** 혼자 하기는 본인, 멀티는 방장만 */
  'game:pause': () => void;
  'game:resume': () => void;
  /** 아케이드: 선택지 중 index번째 능력 고르기 */
  'arcade:choose': (index: number) => void;
  /** 아케이드: 선택지 다시 뽑기 (고를 때마다 1번) */
  'arcade:reroll': () => void;
  /** circleId가 null이면 빈 공간 클릭. x, y는 필드 좌표 */
  'game:click': (d: { circleId: number | null; x: number; y: number }) => void;
  /** 서버 시각 맞추기 */
  'time:ping': (ack: (serverNow: number) => void) => void;
}
