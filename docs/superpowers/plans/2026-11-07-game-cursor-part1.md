# 3단계 1차: 게임 커서·스턴·레이저·끌어당기는 자석 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임이 직접 그리는 커서와 서버로 보내는 커서 위치를 바탕으로, 레이저 스턴과 커서를 끌어당기는 자석을 넣는다.

**Architecture:** 커서 위치 변환·레이저 기하·자석 대상 고르기는 `shared/src/cursor.ts`의 순수 함수로 두고 `node:test`로 검증한다. 서버 `Room`은 플레이어별 마지막 커서 위치를 받아 틱마다 레이저 적중과 자석 끌기를 판정하고 이벤트를 보낸다. 클라이언트는 진짜 마우스 커서를 숨기고 게임 커서를 그리며, 클릭은 게임 커서 위치로 보낸다.

**Tech Stack:** TypeScript 5.6, Node 20+ (`node:test` + `tsx`), Socket.IO 4, Vite 5, Canvas 2D

**Spec:** `docs/superpowers/specs/2026-11-07-game-cursor-design.md` (1차 묶음)

## Global Constraints

- 커밋: `<타입>(<범위>): <한국어 요약>`, 한 커밋 한 목적, 커밋 전 `npm test`·`npm run typecheck`·`npm run build` 통과
- 수치는 `RULES`(rules.ts)에, 아케이드 능력 수치는 `ABILITIES`(arcade.ts)에
- 푸시하지 않는다 (사용자 확인 후)
- 커서 전송 초당 약 15번, 0.5초 넘게 소식 없는 커서는 판정에서 뺀다
- 레이저: 10~15초마다, 경고 1초, 발사 0.3초, 레이저에서 18 안이면 1.5초 스턴(콤보 유지), 판 시작 3초 안·라운드 마지막 1초·시간 정지 중에는 안 쏨
- 자석: 능력 범위 60/90/120/160(상한 200), 아이템 +90, 원 중심이 범위 안인 내 원, 발사 보호 구역 밖, 0.25초 끌려온 뒤 잡힘, 플레이어마다 1초에 최대 2개, 끌려가는 원은 다른 사람이 못 잡음
- 스턴 중: 클릭 무시, 빈 곳 페널티 없음, 자석 끌기도 멈춤
- 방 규칙 `laser` 기본 켜짐, '느긋하게'만 꺼짐

## Review Focus

1. **평소 클릭 위치가 예전과 같아야 한다** — 효과가 없을 때 게임 커서 = 진짜 마우스 위치. `nextCursor` 테스트(Task 1)
2. **탭을 바꾸거나 커서가 캔버스를 벗어남** — 오래된 커서는 레이저에 맞지 않고 자석도 안 됨. 방 테스트(Task 3)
3. **레이저 경고·끌기 도중 일시정지** — 풀면 발사 시각·끌기 끝 시각이 그만큼 밀려야 함. 방 테스트(Task 3)
4. **같은 원을 자석 두 명이 동시에** — 먼저 묶은 사람만, 다른 사람 클릭은 거절. 방 테스트(Task 3)
5. **재접속** — 끌려가는 원·레이저 예고가 `game:sync`에 들어 있어 이어서 보임. 수동 확인(Task 4)

---

### Task 1: 커서 공용 규칙 (`shared/src/cursor.ts`)

**Files:** Create `shared/src/cursor.ts`, `shared/test/cursor.test.ts` · Modify `shared/src/rules.ts` (RULES), `shared/src/arcade.ts` (자석 수치·설명), `shared/src/items.ts` (자석 설명), `shared/src/index.ts`

**Interfaces — Produces:**
- `RULES.cursor = { sendHz: 15, staleMs: 500 }`
- `RULES.laser = { everyMin: 10_000, everyMax: 15_000, warnMs: 1_000, fireMs: 300, width: 18, stunMs: 1_500, startQuietMs: 3_000, endQuietMs: 1_000 }`
- `RULES.magnet = { pullMs: 250, perSec: 2 }`, `RULES.items.magnet` 70 → **90**
- `ABILITY.magnet.values` → `[60, 90, 120, 160]`, `cap` → `200`, 설명 "커서 둘레 ${v} 안의 내 원을 끌어당겨 잡음 (1초에 2개)"
- `type Point = { x: number; y: number }`
- `type CursorMode = { slow?: number; invert?: boolean }` (2차에서 씀)
- `nextCursor(prev: Point, real: Point, delta: Point, mode: CursorMode | null): Point` — `mode`가 null이면 `real` 그대로. 아니면 `prev + delta × (slow ?? 1) × (invert ? −1 : 1)`을 필드 안으로 자른다
- `distToSegment(p: Point, a: Point, b: Point): number`
- `rollLaser(rand?): { a: Point; b: Point }` — 필드 안쪽 점(x 200~1400, y 150~750)을 지나는 무작위 각도 직선, 두 끝은 그 점에서 ±2000
- `laserHits(cursor: Point, a: Point, b: Point): boolean` — `distToSegment ≤ RULES.laser.width`
- `nextLaserIn(rand?): number` — everyMin~everyMax
- `pickMagnetTargets(circles: Iterable<Circle>, color: ColorIndex, cursor: Point, t: number, radius: number, max: number, skip?: ReadonlySet<number>): Circle[]` — `isMine`이고 `!isGuarded`이고 `skip`에 없고 원 중심이 커서에서 `radius` 안인 원, 가까운 순, 최대 `max`개

- [ ] **Step 1: 실패하는 테스트** (`shared/test/cursor.test.ts`)
  - `nextCursor({x:0,y:0}, {x:500,y:300}, {x:5,y:5}, null)` → `{x:500,y:300}`
  - `nextCursor({x:500,y:300}, {x:900,y:900}, {x:10,y:-20}, {slow:0.3})` → `{x:503,y:294}`; `{invert:true}` → `{x:490,y:320}`; 필드 밖으로 안 나감(`prev {x:1598}`, delta `{x:50}` → x 1600)
  - `distToSegment({x:5,y:5},{x:0,y:0},{x:10,y:0})` → 5; 선분 끝 너머 점은 끝점까지 거리
  - `laserHits`: 거리 18 → true, 19 → false
  - `rollLaser(() => 0.5)`: 두 끝 사이 길이 4000, 선분이 (800, 450)에서 18 안을 지남
  - `nextLaserIn(() => 0)` → 10000, `() => 0.999999` → 15000에 가까움
  - `pickMagnetTargets`: 내 색·노란색은 고르고 남의 색은 안 고름, 가까운 순, `max 2`면 2개, 가운데 보호 구역 원·`skip` 원 제외, 중심이 `radius+1` 떨어진 원 제외
  - `modsOf([{id:'magnet',tier:3},{id:'magnet',tier:3}]).magnet` → 200
- [ ] **Step 2: `npm test`** → FAIL (`nextCursor` 없음)
- [ ] **Step 3: 구현** (`index.ts`에 `export * from './cursor.ts'`). 기존 `magnet` 관련 테스트 중 "빗나간 클릭 보정"을 확인하던 것(`assistTargets`의 magnet, `reachOf·magnetOf` 테스트의 70)은 새 요구에 맞게 고친다: `assistTargets`는 범위 클릭만 남기고 magnet 인자를 뺀다. 첫 커밋에서 typecheck가 통과하도록 `client/src/main.ts`의 `assistTargets` 호출도 이 Task에서 함께 고친다 (서버의 ③ 자석 블록 삭제는 Task 3)
- [ ] **Step 4: `npm test`** → PASS

### Task 2: 스턴과 방 규칙 `laser`

**Files:** Modify `shared/src/rules.ts` · Test `shared/test/stun.test.ts`

**Interfaces — Produces:**
- `PlayerState.stunUntil: number` (newPlayer 0, startRound 0), `isStunned(p, now): boolean`
- `shiftTimes`가 `stunUntil`도 민다
- `RoomRules.laser: boolean` (DEFAULT true, `PRESETS.chill` false), `sanitizeRules` 불리언 목록, `GameRules.laser`

- [ ] **Step 1: 실패하는 테스트** — `isStunned` 경계(until 직전 true, until false), `shiftTimes`로 stunUntil 이동, startRound 후 0, `DEFAULT_RULES.laser === true`, `PRESETS.chill.rules.laser === false`, `sanitizeRules(..., {laser:false}).laser === false`
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: `npm test`·`npm run typecheck`** → PASS

### Task 3: 서버 — 커서 수신, 스턴, 레이저, 자석 끌기

**Files:** Modify `server/src/room.ts`, `server/src/index.ts`, `shared/src/protocol.ts` · Test `shared/test/room.test.ts`

**Interfaces:**
- Consumes: Task 1 `pickMagnetTargets`, `laserHits`, `rollLaser`, `nextLaserIn`, `magnetOf`; Task 2 `isStunned`
- Produces (protocol):
  - ClientToServer `'cursor:move': (d: { x: number; y: number }) => void`
  - ServerToClient `'laser:warn': (d: { a: Point; b: Point; at: number }) => void`, `'stun': (d: { playerId: string; until: number; by: 'laser' | 'snipe' }) => void`, `'circle:pull': (d: Pull) => void`
  - `export interface Pull { circleId: number; by: string; from: Point; at: number; ms: number }`
  - `PlayPayload.pulls: Pull[]`, `PlayPayload.laser: { a: Point; b: Point; at: number } | null`
- Room:
  - `cursor(id: string, p: Point): void` — 숫자 검사, 필드 안으로 자름, `{ x, y, at: now }` 저장
  - `click`: 스턴 중이면 아무것도 안 함(원 id가 있으면 `rejectTo`만). 판정 ③ "빗나간 클릭 자석"은 지운다
  - `private updateLaser(now)`: 규칙이 켜져 있고 조용한 구간이 아니고 시간 정지 중이 아니면 `nextLaserAt`(판 시작 기준 ms)에 `rollLaser` → `laser = { a, b, at: now + warnMs, hit: Set }`, `'laser:warn'` 전송. `at ≤ now < at + fireMs` 동안 사람 플레이어 중 커서가 신선하고(`now − cursor.at ≤ staleMs`) 아직 안 맞은 사람이 `laserHits`면 `stunUntil = max(stunUntil, now + stunMs)`, `'stun'` 전송, `emitPlayers`. 발사가 끝나면 `laser = null`, 다음 시점 예약
  - `private updatePulls(now)`: ① 끝난 끌기(`at + ms ≤ now`)는 원이 아직 있으면 `claim(p, c, now, 'magnet')`하고 지움 ② 플레이어마다 (스턴 아님, 커서 신선, `magnetOf > 0`) 최근 1초 끌기 수가 `perSec` 미만이면 `pickMagnetTargets(…, skip = 이미 끌리는 원)`로 남은 수만큼 묶고 `'circle:pull'` 전송
  - 끌리는 원: `claim()` 맨 앞에서 끄는 사람이 아니면 무시, 직접 클릭은 `rejectTo`, 화면 밖 정리에서 지우지 않음
  - `tick`에서 `updateLaser`, `updatePulls` 호출. `beginRound`에서 레이저·끌기·커서 초기화. `resume`에서 `laser.at`, 끌기 `at`, 다음 레이저 기준 밀기
  - `index.ts`: `socket.on('cursor:move', …)` → `room.cursor`
- [ ] **Step 1: 실패하는 테스트** (`room.test.ts`, 기존 `playingRoom()` 사용)
  - 스턴 중 빈 곳 클릭 → 콤보·헛클릭 그대로; 스턴 중 원 클릭 → 원 그대로
  - 레이저: 플레이어 A 커서를 선 위, B 커서를 멀리 두고 `laser = {…, at: now − 10}`로 `updateLaser(now)` → A만 스턴(`stunUntil ≈ now + 1500`), `'stun'` 1번. 같은 레이저로 다시 호출해도 A 스턴 시각 그대로
  - 오래된 커서(`at = now − 600`)는 레이저에 안 맞음
  - 자석: 능력 자석을 가진 A의 커서 근처(범위 안)에 A 색 원 3개 → `updatePulls(now)` 후 `'circle:pull'` 2번(1초 2개 제한), B가 그중 하나를 클릭하면 거절, `updatePulls(now + 300)` 후 그 2개는 A가 잡음(점수 증가), 남은 하나는 `updatePulls(now + 1100)`에 끌림
  - 오래된 커서·스턴 중에는 자석 끌기 없음
  - 일시정지 중 레이저 예고: `pause` → 2초 → `resume` 후 `laser.at`이 2초 밀림
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: `npm test`·`npm run typecheck`** → PASS

### Task 4: 화면 — 게임 커서, 스턴·레이저·끌림 연출, 방 규칙

**Files:** Create `client/src/cursor.ts` · Modify `client/src/main.ts`, `client/src/render.ts`, `client/src/rulesUI.ts`, `client/src/audio.ts`, `client/src/style.css`

**Interfaces:**
- Consumes: Task 1 `nextCursor`; Task 3 이벤트·`Pull`·`PlayPayload.pulls/laser`
- Produces (`client/src/cursor.ts`):
  - `class GameCursor { pos: Point | null; move(real: Point, delta: Point, mode: CursorMode | null): void; leave(): void }` — 1차는 항상 `mode = null`
  - `startCursorSync(get: () => Point | null, send: (p: Point) => void): () => void` — `1000 / RULES.cursor.sendHz` 간격, 바뀌었을 때만 전송, 해제 함수 반환
- main.ts:
  - 캔버스 `pointermove` → `gameCursor.move(toField(e), {e.movementX, e.movementY} / scale, null)`, `pointerleave` → `leave()`
  - 클릭 판정 좌표는 `gameCursor.pos` (없으면 `toField(e)`)
  - 게임 중에는 `#stage`에 `gamecursor` 클래스 → CSS `#stage.gamecursor canvas { cursor: none }`
  - 이벤트: `laser:warn` 저장, `stun`(내가 맞으면 "스턴!" 글자·효과음), `circle:pull` 저장(끌리는 원은 클릭 예측에서 제외), `applyPlay`에서 `d.pulls`·`d.laser` 복원
  - `assistTargets` 호출에서 magnet 인자 제거, 자석 끌림 선(`pullLine`) 대신 끌림 애니메이션
- render.ts (`DrawState`에 추가):
  - `cursor: { x, y, stunned: boolean, reach: number, magnet: number } | null` — 흰 십자 고리, 스턴이면 회색 + 도는 별 3개, 넓은 손 범위(하늘색 실선)·자석 범위(하늘색 점선)
  - `laser: { a, b, at } | null` — `now < at`: 빨간 점선(깜빡임), `at ≤ now < at + fireMs`: 굵은 빨간 빛줄기 + 흰 심지
  - `pulls: Pull[]`, `myCursor` — 끌리는 원은 `from`에서 끄는 사람 커서(내가 끌면 내 커서, 남이면 `from` 자리에서 작아지며)로 보간해 그림
- rulesUI: `BOOL_FIELDS`에 `{ key: 'laser', label: '레이저' }`
- audio: `laserWarn`, `laserFire`, `stun`, `pull`
- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm run typecheck`·`npm run build`** → 통과
- [ ] **Step 3: 수동 확인** (`server`·`client` 미리보기, 혼자 하기)
  - 평소 커서가 마우스와 같은 자리, 원을 누르면 예전처럼 잡힘 (Review Focus 1)
  - 레이저 경고선 → 발사, 커서를 선 위에 두면 회색 커서·"스턴!", 1.5초 동안 클릭 안 됨
  - 자석 아이템(확인용으로 아이템 확률을 잠시 올림)을 잡으면 커서 근처 내 원이 빨려 들어와 잡힘, 1초에 2개
  - 탭 전환 후 돌아와도 레이저에 맞지 않음 (Review Focus 2)
  - 끌림·레이저 경고 중 새로고침 → 이어서 보임 (Review Focus 5)
  - 확인 후 올렸던 확률 되돌림, `git diff`로 확인

### Task 5: 문서와 커밋

- [ ] **Step 1:** README(기능·방 규칙·자석 설명), ROADMAP 3단계 1차 항목 ✅(커서 자석, 레이저, 스턴 바탕), 설계서 상태 "1차 구현"
- [ ] **Step 2: 커밋 (기능별로 나눔)**
  - `feat(shared): 게임 커서 규칙·스턴·레이저·자석 판정 추가` (Task 1·2 + 테스트)
  - `feat: 게임 커서와 레이저·끌어당기는 자석 추가` (Task 3·4 + 문서 + 설계서 + 이 계획)
