/**
 * 클라이언트와 서버가 주고받는 메시지 형식.
 * 통신 라이브러리를 바꿔도 이 형식은 그대로 쓸 수 있다.
 */
import type { Circle, ClaimResult, ColorIndex, PlayerState, PresetId, RoomRules, Title } from './rules.ts';

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
}

export type Ack<T = {}> = (r: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void;
  /** 새 판 시작 */
  'game:start': (d: PlayPayload) => void;
  /** 진행 중인 판 상태 전체 (재접속, 일시정지 해제 때) */
  'game:sync': (d: PlayPayload) => void;
  'game:pause': (d: { by: string }) => void;
  'circle:spawn': (c: Circle) => void;
  'circle:claimed': (d: { circleId: number; by: string; result: ClaimResult; x: number; y: number }) => void;
  'click:rejected': (d: { circleId: number }) => void;
  /** 보스를 때림 (hp: 남은 체력) */
  'boss:hit': (d: { circleId: number; by: string; hp: number; gained: number }) => void;
  /** 보스 처치: by가 막타, mvp가 최다 타격 */
  'boss:killed': (d: { circleId: number; by: string; gained: number; mvp: string | null; mvpGained: number; x: number; y: number }) => void;
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
  /** circleId가 null이면 빈 공간 클릭. x, y는 필드 좌표 */
  'game:click': (d: { circleId: number | null; x: number; y: number }) => void;
  /** 서버 시각 맞추기 */
  'time:ping': (ack: (serverNow: number) => void) => void;
}
