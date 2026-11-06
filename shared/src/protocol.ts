/**
 * 클라이언트와 서버가 주고받는 메시지 형식.
 * 통신 라이브러리를 바꿔도 이 형식은 그대로 쓸 수 있다.
 */
import type { Circle, ClaimResult, ColorIndex, PlayerState } from './rules.ts';

export type Phase = 'lobby' | 'play';
export type BotLevel = 0 | 1 | 2;

export interface RoomSnapshot {
  code: string;
  hostId: string;
  phase: Phase;
  players: PlayerState[];
  fillBots: boolean;
  botLevel: BotLevel;
}

export type Ack<T = {}> = (r: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void;
  /** 게임 시작, 또는 게임 중 재접속했을 때(circles에 진행 중인 원이 담김) */
  'game:start': (d: { startAt: number; endAt: number; players: PlayerState[]; circles: Circle[] }) => void;
  'circle:spawn': (c: Circle) => void;
  'circle:claimed': (d: { circleId: number; by: string; result: ClaimResult; x: number; y: number }) => void;
  'click:rejected': (d: { circleId: number }) => void;
  players: (p: PlayerState[]) => void;
  'game:over': (d: { ranking: PlayerState[] }) => void;
}

export interface ClientToServer {
  /**
   * key: 브라우저 탭마다 만드는 비밀 키. 새로고침해도 유지되며, 같은 키로 다시 들어오면 원래 자리로 복귀한다.
   * you: 이 방에서 내 플레이어 id (공개 id. key는 다른 사람에게 보내지 않는다)
   */
  'room:create': (d: { name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  'room:join': (d: { code: string; name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  'room:leave': () => void;
  'lobby:color': (color: ColorIndex) => void;
  'lobby:options': (o: { fillBots?: boolean; botLevel?: BotLevel }) => void;
  'game:start': (ack: Ack) => void;
  /** circleId가 null이면 빈 공간 클릭. x, y는 필드 좌표 */
  'game:click': (d: { circleId: number | null; x: number; y: number }) => void;
  /** 서버 시각 맞추기 */
  'time:ping': (ack: (serverNow: number) => void) => void;
}
