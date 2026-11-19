/**
 * 클라이언트와 서버가 주고받는 메시지 형식.
 * 통신 라이브러리를 바꿔도 이 형식은 그대로 쓸 수 있다.
 */
import type { Circle, ClaimResult, ColorIndex, PlayerState, PresetId, RoomRules, Title } from './rules.ts';
import type { TutorialStep, CoopLevel } from './rules.ts';
import type { CoopPhase } from './coop.ts';
import type { Volley } from './coopBullets.ts';
import type { CoopItemId } from './coopItems.ts';
import type { CoopCounter } from './coopCounter.ts';
import type { CoopSpecialAttack, CoopSpecialId, CoopSupportSpecialId, CoopWard } from './coopSpecial.ts';

/** 협력전 진행 상태 */
export interface CoopState {
  level: CoopLevel; phase: CoopPhase; bossId: number; hp: number; maxHp: number;
  /** 보호막: 제한 시간 끝, 몇 번째 보호막인지, 중앙 프리즘 등장 여부 */
  shield: { until: number; no: 0 | 1; prism?: true } | null;
  /** 큰 피해 구간 끝 (0이면 아님) */
  burstUntil: number;
  wards?: CoopWard[];
  bindUntil?: number;
  bindImmuneUntil?: number;
  linkUntil?: number;
  /** 수정 실패 폭발 예정 시각 (0이면 없음) */
  rageAt: number;
  /** 실패 후 보스가 피해를 받지 않는 종료 시각 */
  rampageUntil?: number;
  /** 큰 원 발사 예정 시각 (0 또는 생략이면 경고 없음) */
  threatAt?: number;
  specials?: CoopSpecialAttack[];
  /** 대기 중인 내려찍기, 안전지대 (다시 접속·재개해도 화면이 이어서 그리도록) */
  slams: Slam[];
  safe: SafeZones | null;
  /** 구역 봉인, 회전 빔 (경고 중이거나 나와 있는 것, 없으면 null) */
  seal: Seal | null;
  beam: Beam | null;
  /** 엑스퍼트 유도탄 (예고 중이거나 날고 있는 것, 없으면 null) */
  homing: Homing | null;
  /** 보스 약점 노출 종료 시각. 비활성 상태는 0. */
  weakUntil: number;
  /** 폭딜 반격 분노 게이지 (판이 없으면 null) */
  counter: CoopCounter | null;
  /**
   * 아직 끝나지 않은 탄막. 시작·재개(shift)·보스 무너짐·재접속 때만 실린다 (있으면 화면이 통째로 바꾸고, 없으면 그대로 둔다).
   * 평소에는 coop:volley로 하나씩 간다
   */
  volleys?: Volley[];
}
/** 협력전 결과: 사람(봇 포함)마다 기여 */
export interface CoopPlayerResult {
  dmg: number; burstDmg: number; crystals: number; threats: number;
  /** 맞은 횟수 (공격 종류별, 방어막이 막은 것은 빼고) */
  hits: Partial<Record<CoopHitBy, number>>;
  /** 판이 끝났을 때 남은 체력 (탈락·봇은 0) */
  hpLeft: number;
  /** 아이템별 획득 수 (봇은 줍지 않아 늘 비어 있다) */
  items: Partial<Record<CoopItemId, number>>;
  /** 폭딜 반격으로 콤보를 잃은 횟수, 우클릭 보호막으로 지킨 횟수 */
  counterLost: number; counterSaved: number;
}
/** 협력전 결과 */
export interface CoopResult {
  win: boolean; stars: 0 | 1 | 2 | 3; timeMs: number; bossHpPct: number; phase: CoopPhase;
  maxHp: number; players: Record<string, CoopPlayerResult>;
  /** 보호막마다: ms 수정 구간에 쓴 시간, rages 실패 여부 (0 또는 1), burstMs 성공 뒤 큰 피해 구간 길이 */
  breaks: { ms: number; rages: number; burstMs: number }[];
  /** 각 단계가 끝난 때 (판 시작부터 ms): 1단계 끝, 2단계 끝 */
  phaseMs: number[];
  /** 진 이유: 수정 구간 실패(엑스퍼트 분노) / 모두 탈락 / 시간 끝 */
  reason?: 'crystal' | 'wipe' | 'time';
}
export type CoopHitBy = 'bullet' | 'wall' | 'threat' | 'beam' | 'laser' | 'slam' | 'seal' | 'safe' | 'rage' | 'crush' | 'homing';
import type { AbilityId, AutoId, Pick, RoundEffect } from './arcade.ts';
import type { ItemId, ItemTier } from './items.ts';
import type { EventResult } from './events.ts';
import type { WavePattern } from './waves.ts';
import type { Point } from './cursor.ts';
import type { MapPattern } from './patterns.ts';
import type { Beam, Homing, SafeZones, Seal, Slam } from './coop.ts';

/** 커서 자석으로 끌려가는 원: at부터 ms 동안 by의 커서로 빨려 들어간 뒤 잡힌다 */
export interface Pull {
  circleId: number; by: string; from: Point; at: number; ms: number;
  /** 자기장이 끌어오는 고정 클릭 위치 */
  target?: Point;
}
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
  /** 묶음 번호 (고를 때 함께 보내 이전 묶음을 보고 누른 클릭을 거른다) */
  deal: number;
}

export type Phase = 'lobby' | 'play';
export type BotLevel = 0 | 1 | 2;

export interface RoomSnapshot {
  code: string;
  hostId: string;
  phase: Phase;
  players: PlayerState[];
  rules: RoomRules;
  /** 혼자 하기 방 (다른 사람 입장 불가, 빈 자리는 항상 봇) */
  solo: boolean;
  /** 튜토리얼 방 (혼자, 단계별 연습) */
  tutorial: boolean;
  /** 자동사냥을 지원하는 개발용 혼자 하기 방에서만 전달 */
  devAutoFarm?: boolean;
  /** 이 방에서의 누적 승수 (사람만) */
  wins: Record<string, number>;
}

export interface TutorialStatus { step: TutorialStep; index: number; total: number; done: boolean }

/** 튜토리얼 장면: focus 짚기(멈춤, 받을 동작 하나), card 설명 카드(멈춤), free 자유 연습, wait 판은 움직이지만 클릭을 받지 않음(단계 끝 대기·봇 견제) */
export type TutorialBeatKind = 'focus' | 'card' | 'free' | 'wait';
export interface TutorialBeatInfo {
  step: TutorialStep;
  /** 화면이 문구를 찾는 장면 id (예: own.mine) */
  beat: string;
  kind: TutorialBeatKind;
  /** 짚기 장면이 받을 동작: 짚은 원 클릭 / 빈 곳 클릭 */
  accept?: 'circle' | 'empty';
  /** 짚은 원 */
  circleId?: number;
  /** 카드가 짚는 곳 */
  point?: 'me' | 'bot' | 'gauge' | 'zones';
  /** 멈춘 서버 시각 (멈춤 장면일 때) */
  at?: number;
  /** 자유 연습 진행 */
  count?: number;
  goal?: number;
  /** 설명 카드: 바로 앞 짚기에서 받은 점수 (원 점수 + 콤보 보너스) */
  gain?: { base: number; bonus: number };
}

export interface GameOver {
  ranking: PlayerState[];
  titles: Title[];
  /** stepMs 간격으로 기록한 플레이어별 점수 */
  history: { stepMs: number; scores: Record<string, number[]> };
  wins: Record<string, number>;
  /** 팀전: 팀 순위 (합 내림차순) */
  teams?: { team: 0 | 1; score: number; best: number; ids: string[] }[];
  /** 팀전 무승부 (합계·최고 점수까지 같음) */
  teamDraw?: boolean;
  /** 협력전 결과 */
  coop?: CoopResult;
}

export interface PlayPayload {
  startAt: number;
  endAt: number;
  players: PlayerState[];
  circles: Circle[];
  rules: RoomRules;
  /** 일시정지 중이면 멈춘 사람 id */
  pausedBy: string | null;
  /** 서바이벌(클래식): 다음 탈락 시각 (아니면 0) */
  nextCutAt: number;
  /** 일시정지 중이면 멈춘 순간의 서버 시각 (화면을 그 순간에 멈춰 둔다, 아니면 0) */
  pausedAt: number;
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
  /** 경고 중이거나 나와 있는 맵 패턴, 이미 사라진 가시 공 번호 (재접속 때 이어서 그린다) */
  pattern: MapPattern | null;
  popped: number[];
  /** 이번 라운드 테마 (아케이드 랜덤 이벤트) */
  theme: ThemeId | null;
  /** 협력전 진행 상태 (협력전이 아니면 없음) */
  coop?: CoopState | null;
}

export type Ack<T = {}> = (r: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void;
  /** 새 판 시작 */
  'game:start': (d: PlayPayload) => void;
  /** 진행 중인 판 상태 전체 (재접속, 일시정지 해제 때) */
  'game:sync': (d: PlayPayload) => void;
  /** until: 저절로 풀리기 시작하는 시각 (혼자 하기는 0) */
  'game:pause': (d: { by: string; until: number; at: number }) => void;
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
  /** 황금 원을 잡음 (배율 적용 점수, 잭팟 배율) */
  'gold:got': (d: { circleId: number; by: string; gained: number; x: number; y: number; jackpot: number }) => void;
  'circle:claimed': (d: { circleId: number; by: string; result: ClaimResult; x: number; y: number }) => void;
  'click:rejected': (d: { circleId: number }) => void;
  /** 아이템 원을 잡음. 블라스트(폭죽·필드 클리어)면 이 이벤트가 먼저 오고 circle:claimed가 이어진다 */
  'item:got': (d: { circleId: number | null; by: string; item: ItemId; tier: ItemTier; x: number; y: number; extra?: boolean }) => void;
  'zone:add': (z: Zone) => void;
  /** 레이저 예고 (at에 발사) */
  'laser:warn': (d: LaserVolley) => void;
  /** 맵 패턴 경고 시작 (현수막). p.at에 나타나고 p.until에 사라진다 */
  'map:warn': (p: MapPattern) => void;
  /** 가시 공이 커서에 닿아 사라짐 */
  'map:pop': (d: { index: number; by: string }) => void;
  /** 스턴: until까지 클릭 불가 */
  stun: (d: { playerId: string; until: number; by: 'laser' | 'snipe' | 'spike' | 'ring' }) => void;
  /** 이동형 보스 오오라를 클릭해 점수를 잃음 */
  /** 이동형 보스 오오라에 닿음: 피버 게이지 −, 콤보 감소 (피버 중이면 들어갈 때 피버 절반) */
  'aura:hit': (d: { by: string; x: number; y: number }) => void;
  /** 커서 자석이 원을 끌기 시작함 */
  'circle:pull': (d: Pull) => void;
  'circle:unpull': (d: { circleId: number }) => void;
  /** 발사 패턴 예고: at(서버 시각)에 웨이브가 나온다 */
  'wave:warn': (d: { pattern: WavePattern; at: number }) => void;
  /** 시간 정지: 해당 원들에 정지 구간 [at, at + ms] */
  'circles:hold': (d: { ids: number[]; at: number; ms: number; bossOnly?: boolean }) => void;
  /** 보스를 때림 (hp: 남은 체력) */
  /** blocked: 방어형 보호막에 막힘 / enraged: 붉은 공격형을 때려 점수를 잃음 (gained가 음수) */
  'boss:hit': (d: { circleId: number; by: string; hp: number; gained: number; jackpot: number; blocked?: boolean; enraged?: boolean; feverStarted?: boolean; comboBonus?: boolean }) => void;
  /** 보스 처치: by가 막타, mvp가 최다 타격 */
  /** 게임 중 나간 사람 (name: 원래 이름). 그 자리는 봇이 이어받는다 */
  'player:left': (d: { id: string; name: string }) => void;
  /**
   * solo: 독식한 사람 id들 (막타와 따로, 없으면 빈 배열). soloFever: 그중 독식 게이지(보스 헌터)로 피버가 터진 사람.
   * gained: 막타 친 사람의 타격 + 막타 + 독식. feverStarted·comboBonus: 막타 친 사람
   */
  'boss:killed': (d: { circleId: number; by: string; gained: number; mvp: string | null; mvpGained: number; x: number; y: number; jackpot: number; solo: string[]; soloFever: string[]; feverStarted: boolean; comboBonus: boolean }) => void;
  'boss:escaped': (d: { circleId: number }) => void;
  players: (p: PlayerState[]) => void;
  /** 서바이벌: 탈락 (rank = 최종 순위) */
  'player:out': (d: { id: string; rank: number }) => void;
  /** 서바이벌: at에 탈락할 지금 꼴찌 (경고) */
  'survival:warn': (d: { id: string; at: number }) => void;
  /** 자동 시전 증강이 발동함 */
  'auto:fire': (d: { playerId: string; id: AutoId }) => void;
  /** 방장이 나를 내보냄 */
  'room:kicked': () => void;
  'game:over': (d: GameOver) => void;
  /** 튜토리얼: 단계가 바뀔 때·마지막(done) */
  'tutorial:step': (d: TutorialStatus) => void;
  /** 튜토리얼: 장면이 바뀌거나 멈출 때 */
  'tutorial:beat': (d: TutorialBeatInfo) => void;
  /** 협력전: 단계·체력·카드가 바뀜 */
  'coop:support': (d: { by: string; kind: CoopSupportSpecialId }) => void;
  'coop:state': (d: CoopState) => void;
  /** 협력전: 누가 무엇에 맞아 체력이 줄었는지 (circleId: 놓친 공격 원) */
  'coop:hit': (d: { playerId: string; by: CoopHitBy; hp: number; dmg: number; immuneUntil: number; circleId?: number; blocked?: true; barrier?: true }) => void;
  /** 협력전: 내려찍기 경고 (사람마다) */
  'coop:slam': (d: Slam[]) => void;
  /** 협력전: 안전지대 경고 (끝나면 null) */
  'coop:safe': (d: SafeZones | null) => void;
  /** 협력전: 구역 봉인 경고·발동 (끝나면 null) */
  'coop:seal': (d: Seal | null) => void;
  /** 협력전: 회전 빔 경고·발동 (끝나면 null) */
  'coop:beam': (d: Beam | null) => void;
  'coop:homing': (d: Homing | null) => void;
  /** 협력전: 폭딜 반격 판정 (lost 콤보를 잃은 사람, saved 보호막으로 지킨 사람) */
  'coop:counter': (d: { lost: string[]; saved: string[] }) => void;
  /** 협력전: 수정 남은 체력 (0이면 사라짐) */
  'coop:crystalFail': (d: { ids: number[] }) => void;
  'coop:crystal': (d: { id: number; hp: number; maxHp: number }) => void;
  /** 협력전: 잡은 원이 보스에게 피해 (연출) */
  'coop:orb': (d: { by: string; x: number; y: number; dmg: number }) => void;
  /** 협력전: 탄막 한 번 (탄 하나씩이 아니라 무늬 단위, 위치는 화면이 시각으로 계산) */
  'coop:volley': (v: Volley) => void;
  /** 협력전: before 시각 이전에 쏜 탄막 모두 지움 (큰 피해 구간 시작, 보스가 무너짐) */
  'coop:clear': (d: { before: number }) => void;
  /** 협력전: 아이템 원을 잡음 (item: 굴린 종류, x·y 잡은 자리) */
  'coop:item': (d: { circleId: number; by: string; item: CoopItemId; x: number; y: number }) => void;
  /** 협력전: 미사일 n발이 from에서 보스로 (첫 발이 at에 닿고 gapMs 간격, 연출만) */
  'coop:missile': (d: { by: string; from: { x: number; y: number }; n: number; gapMs: number; at: number }) => void;
  /** 협력전: 공격 원을 터뜨림 */
  'threat:popped': (d: { circleId: number; by: string; gained: number }) => void;
}

export interface ClientToServer {
  /**
   * key: 브라우저 탭마다 만드는 비밀 키. 새로고침해도 유지되며, 같은 키로 다시 들어오면 원래 자리로 복귀한다.
   * you: 이 방에서 내 플레이어 id (공개 id. key는 다른 사람에게 보내지 않는다)
   */
  'room:create': (d: { name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  'room:join': (d: { code: string; name: string; key: string }, ack: Ack<{ code: string; you: string }>) => void;
  /** 혼자 하기: 봇과 하는 비공개 방 */
  'room:solo': (d: { name: string; key: string; tutorial?: boolean }, ack: Ack<{ code: string; you: string }>) => void;
  'room:leave': () => void;
  /** 튜토리얼: 설명 카드 넘기기 */
  'tutorial:next': () => void;
  'dev:autoFarm': (enabled: boolean) => void;
  'lobby:color': (color: ColorIndex) => void;
  'lobby:special': (id: CoopSpecialId) => void;
  /** 방장: 빈 칸에 봇 추가 (팀전이면 그 팀) */
  'lobby:addBot': (d: { team?: 0 | 1 }) => void;
  /** 방장: 봇 빼기 */
  'lobby:removeBot': (botId: string) => void;
  /** 방장: 봇 난이도 */
  'lobby:botLevel': (d: { id: string; level: BotLevel }) => void;
  /** 준비 / 준비 취소 (방장 아닌 사람) */
  'lobby:ready': (on: boolean) => void;
  /** 방장 넘기기 (방장) */
  'lobby:host': (playerId: string) => void;
  /** 팀 바꾸기 (팀전, 대기실) */
  'lobby:team': (team: 0 | 1) => void;
  /** 내보내기 (방장, 대기실) */
  'lobby:kick': (playerId: string) => void;
  /** 방 규칙 변경(방장). preset을 주면 그 프리셋으로 덮어쓴 뒤 rules를 반영 */
  'lobby:rules': (d: { preset?: PresetId; rules?: Partial<RoomRules> }) => void;
  /** 결과 화면의 [바로 한 판 더]는 { rematch: true }를 먼저 보낸다 (준비 확인 없이) */
  'game:start': ((ack: Ack) => void) | ((d: { rematch: true }, ack: Ack) => void);
  /** 혼자 하기는 본인, 멀티는 방장만 */
  'game:pause': () => void;
  'game:resume': () => void;
  /** 아케이드: 선택지 중 index번째 능력 고르기 */
  /** cardId: 그 자리의 카드 id (다르면 서버가 무시) */
  'arcade:choose': (index: number, cardId?: AbilityId, deal?: number) => void;
  /** 아케이드: 선택지 다시 뽑기 (고를 때마다 1번) */
  'arcade:reroll': () => void;
  /** 게임 커서 위치 (필드 좌표, 초당 약 15번) */
  'cursor:move': (d: { x: number; y: number }) => void;
  /** circleId가 null이면 빈 공간 클릭. x, y는 필드 좌표 */
  'game:click': (d: { circleId: number | null; x: number; y: number }) => void;
  /** 협력전: 내 커서가 탄에 닿음 (화면 판정, 서버가 확인하고 깎는다) */
  'coop:hurt': (d: { volleyId: number; shot: number }) => void;
  'coop:special': () => void;
  /** 협력전: 우클릭 보호막 켜기 (서버가 횟수·조건을 확인한다) */
  'coop:barrier': () => void;
  /** 협력전: 투표할 카드 (다시 고르면 표가 옮겨 간다) */
  /** 서버 시각 맞추기 */
  'time:ping': (ack: (serverNow: number) => void) => void;
}
