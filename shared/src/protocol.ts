/**
 * 클라이언트와 서버가 주고받는 메시지 형식.
 * 통신 라이브러리를 바꿔도 이 형식은 그대로 쓸 수 있다.
 */
import type { Circle, ClaimResult, ColorIndex, PlayerState, PresetId, RoomRules, Title } from './rules.ts';
import type { AbilityId, Pick, RoundEffect } from './arcade.ts';
import type { ItemId, ItemTier } from './items.ts';
import type { EventResult } from './events.ts';
import type { WavePattern } from './waves.ts';
import type { Point } from './cursor.ts';

/** 커서 자석으로 끌려가는 원: at부터 ms 동안 by의 커서로 빨려 들어간 뒤 잡힌다 */
export interface Pull { circleId: number; by: string; from: Point; at: number; ms: number }
/** 레이저: at(서버 시각)에 a-b 선분으로 발사 (그 전은 경고) */
/** 레이저 볼리: 한 번에 같이 쏘는 줄들, at = 발사 시각 */
export interface LaserVolley { lines: { a: Point; b: Point }[]; at: number }
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
  /** 능력 선택 중: 이번 라운드 사이에 일어난 랜덤 이벤트 (선택 화면에 계속 보여 준다) */
  event: EventResult | null;
}

export interface ArcadeOffer {
  options: Pick[];
  rerollLeft: number;
  pickEndsAt: number;
  /** 꼴찌라서 상위 등급 확률이 올라간 선택지인지 */
  lastPlace: boolean;
  /** 이번 차례에 남은 고를 카드 수 */
  need: number;
  /** 역전 기회인지 (꼴찌 점수에 방 인원 배율) */
  comeback: boolean;
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
  /** 일시정지가 저절로 풀리기 시작하는 시각 (혼자 하기·멈추지 않았으면 0) */
  pauseUntil: number;
  /** 풀려서 카운트다운 중이면 다시 시작하는 시각 (아니면 0) */
  resumeAt: number;
  /** 아케이드 모드가 아니면 null */
  arcade: ArcadeState | null;
  zones: Zone[];
  /** 끌려가는 원, 예고·발사 중인 레이저 (재접속 때 이어서 그린다) */
  pulls: Pull[];
  lasers: LaserVolley[];
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
  /** until: 저절로 풀리기 시작하는 시각 (혼자 하기는 0) */
  'game:pause': (d: { by: string; until: number }) => void;
  /** 일시정지가 풀림: at에 다시 시작 (그때까지 카운트다운) */
  'game:resuming': (d: { at: number }) => void;
  /** 아케이드: 라운드가 끝나 능력 선택 시작, 또는 선택 현황이 바뀜 */
  'arcade:pick': (d: ArcadeState) => void;
  /** 아케이드: 라운드가 끝날 때 적용된 저주 결과 */
  'arcade:effects': (d: RoundEffect[]) => void;
  /** 아케이드: 나에게만 보내는 능력 선택지 */
  'arcade:offer': (d: ArcadeOffer) => void;
  /** 아케이드: 라운드 사이 랜덤 이벤트 (능력 선택 시작 직후) */
  'arcade:event': (d: EventResult) => void;
  /** 아케이드: 라운드가 끝남 (잠시 뒤 능력 선택이 열린다) */
  'round:end': (d: { round: number }) => void;
  'circle:spawn': (c: Circle) => void;
  /** 특별 카드로 점수를 얻음 (하이에나) */
  'special:gain': (d: { playerId: string; id: AbilityId; delta: number }) => void;
  /** 황금 원을 잡음 (고정 점수) */
  'gold:got': (d: { circleId: number; by: string; gained: number; x: number; y: number }) => void;
  'circle:claimed': (d: { circleId: number; by: string; result: ClaimResult; x: number; y: number }) => void;
  'click:rejected': (d: { circleId: number }) => void;
  /** 아이템 원을 잡음. 블라스트(폭죽·필드 클리어)면 이 이벤트가 먼저 오고 circle:claimed가 이어진다 */
  'item:got': (d: { circleId: number; by: string; item: ItemId; tier: ItemTier; x: number; y: number }) => void;
  'zone:add': (z: Zone) => void;
  /** 레이저 예고 (at에 발사) */
  'laser:warn': (d: LaserVolley) => void;
  /** 스턴: until까지 클릭 불가 */
  stun: (d: { playerId: string; until: number; by: 'laser' | 'snipe' | 'spike' | 'ring' }) => void;
  /** 이동형 보스 오오라를 클릭해 점수를 잃음 */
  /** 이동형 보스 오오라에 닿음: 피버 게이지 −, 콤보 감소 (피버 중이면 들어갈 때 피버 절반) */
  'aura:hit': (d: { by: string; x: number; y: number }) => void;
  /** 커서 자석이 원을 끌기 시작함 */
  'circle:pull': (d: Pull) => void;
  /** 발사 패턴 예고: at(서버 시각)에 웨이브가 나온다 */
  'wave:warn': (d: { pattern: WavePattern; at: number }) => void;
  /** 시간 정지: 해당 원들에 정지 구간 [at, at + ms] */
  'circles:hold': (d: { ids: number[]; at: number; ms: number }) => void;
  /** 보스를 때림 (hp: 남은 체력) */
  /** blocked: 방어형 보호막에 막힘 / enraged: 붉은 공격형을 때려 점수를 잃음 (gained가 음수) */
  'boss:hit': (d: { circleId: number; by: string; hp: number; gained: number; jackpot: number; blocked?: boolean; enraged?: boolean }) => void;
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
  /** cardId: 그 자리의 카드 id (다르면 서버가 무시) */
  'arcade:choose': (index: number, cardId?: AbilityId) => void;
  /** 아케이드: 선택지 다시 뽑기 (고를 때마다 1번) */
  'arcade:reroll': () => void;
  /** 게임 커서 위치 (필드 좌표, 초당 약 15번) */
  'cursor:move': (d: { x: number; y: number }) => void;
  /** circleId가 null이면 빈 공간 클릭. x, y는 필드 좌표 */
  'game:click': (d: { circleId: number | null; x: number; y: number }) => void;
  /** 서버 시각 맞추기 */
  'time:ping': (ack: (serverNow: number) => void) => void;
}
