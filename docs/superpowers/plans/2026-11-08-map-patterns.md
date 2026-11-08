# 맵 패턴 · 방해 조정 · 확률 고르기 · 프리셋 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라운드마다 확률로 한 번 경고·현수막 뒤에 짧게 나오는 맵 패턴 7개, 방해·위험 규칙 조정, 확률 고르기 방 규칙, 프리셋 2개와 커스텀을 넣는다.

**Architecture:**
- **shared:** 패턴의 모양·움직임은 `shared/src/patterns.ts`의 순수 함수가 시각 t로 계산한다. 서버와 클라이언트가 같은 함수를 쓰고, 서버는 생성 때 정한 패턴 데이터(`MapPattern`)를 보낸다.
- **서버:** 위험 패턴 스턴(가시 공·링)과 벽·막대 안 클릭 거절을 판정한다.
- **클라이언트:** 커서를 바꾸는 패턴(벽·막대·소용돌이·빙판)을 `GameCursor`에 적용하고, 그림·현수막을 그린다.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test` (tsx)

**Spec:** `docs/superpowers/specs/2026-11-08-map-patterns-design.md`

## Global Constraints

- 모든 화면 문구는 한국어. 현수막 문구는 설계 문서 2절 표 그대로.
- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`(맵 패턴은 `RULES.patterns`)와 `RULE_CHOICES`·`PRESETS`에만 둔다.
- 커밋은 `CONTRIBUTING.md` Conventional Commits, 한 커밋에 한 목적. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에 쓰고 돌린다 (사용자 지시). 각 Task의 테스트는 Task 6에서 쓰고 실행한다. 커밋도 Task 6에서 단계별 스냅샷으로 목적별로 나눈다.
- `main` 병합·푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. 일시정지가 맵 패턴 경고·등장·유지·끝 시각과 이미 사라진 가시 공 상태를 모두 같이 밀어야 한다. 재개 뒤 패턴이 갑자기 끝나거나 다시 나오면 안 된다.
2. 재접속(game:sync)하면 진행 중인 패턴과 사라진 공이 그대로 보여야 한다.
3. 라운드가 바뀌거나 게임이 끝나면 패턴이 반드시 사라지고, 다음 라운드로 새지 않아야 한다 (아케이드 선택 화면 포함).
4. 벽·막대가 생길 때 커서가 그 안에 있으면 바깥으로 밀려나야 하고, 빠르게 움직여도 벽을 뚫고 지나가면 안 된다.
5. 방해 내성 100%와 철벽은 위험 패턴 스턴·방해 아이템을 모두 막되, 1등 저격은 막지 않아야 한다.

---

### Task 1: 확률 고르기 방 규칙 · 프리셋 · 커스텀 · 레이저 두께 · 원 크기

**Files:**
- Modify: `shared/src/rules.ts` (`RoomRules`, `MODE_KEYS`, `RULE_CHOICES`, `DEFAULT_RULES`, `PRESETS`, `sanitizeRules`, `GameRules`, `toGameRules`, `makeCircle`, `RULES.chaos.eventChance` 삭제, `RULES.themes`에 `maxPerGame: 2`)
- Modify: `shared/src/events.ts` (`rollEvent`가 'theme'을 뽑지 않음)
- Modify: `shared/src/cursor.ts` (`laserHits`·`volleyHits`에 반폭 인자)
- Modify: `server/src/room.ts` (테마 따로 굴리기, 이벤트 확률, 레이저 반폭, 프리셋 적용 시 유지할 키)
- Modify: `client/src/rulesUI.ts` (새 선택지·커스텀 버튼), `client/src/render.ts`·`client/src/main.ts` (레이저 폭), `client/src/icons.ts` (프리셋 아이콘)

**Interfaces:**
- Produces:
  - `RoomRules`에서 `randomEvents: boolean`을 없애고 다음 키를 추가해요.
    - `eventPct: number` (0/10/30)
    - `themePct: number` (0/15/30)
    - `mapPct: number` (0/20/35/50/80/100)
    - `laserWidth: number` (15/22/30, 화면 높이 %)
    - `circleScale: number` (1/0.75)
  - `RULE_CHOICES`에 위 다섯 개를 추가해요.
  - `MODE_KEYS = ['mode', 'arcadeRoundSec']`
  - `DEFAULT_RULES` 값: `eventPct 10, themePct 15, mapPct 35, laserWidth 22, circleScale 1`
  - `PRESETS` 값 (설계 문서 6절 그대로)
    - 파티·하드코어: `mapPct 50`
    - 하드코어: `laserWidth 30`
    - 느긋하게: `mapPct 0`
    - 카오스: `mapPct 80, themePct 30, eventPct 30, laserWidth 30`
    - 장애물 코스 `obstacle`: `{ ...DEFAULT_RULES, mapPct: 100, sabotage: false }`
    - 정밀 사격 `precision`: `{ ...DEFAULT_RULES, circleScale: 0.75, missPenalty: true, mapPct: 0, sabotage: false, laser: false }`
  - `sanitizeRules`: 옛 입력 `randomEvents: false`가 오면 `eventPct 0`, `true`면 그대로 둬요.
  - `GameRules`에 다음 필드를 추가해요.
    - `eventChance`, `themeChance`, `mapChance` (0~1)
    - `laserHalf: number` (= `laserWidth / 100 × FIELD.h / 2`)
    - `circleScale`
  - `GameRules.randomEvents`는 없애요.
  - `laserHits(cursor, a, b, half = RULES.laser.width)`, `volleyHits(cursor, lines, half?)`: 서버는 `this.G.laserHalf`를 넘긴다.
  - `makeCircle`: 색 원·노랑·무지개만 `r *= G.circleScale` (아이템·보스·황금은 그대로).
  - 테마: `Room.startPick`에서 이벤트와 따로, `this.round >= 1`(다음 라운드가 2라운드 이상)이고 `themesUsed < RULES.themes.maxPerGame`이고 `rand < G.themeChance`면 `nextTheme`을 무작위로 정해요. 이벤트 확률은 `G.eventChance`예요.
  - 커스텀(클라이언트만)
    - `rulesUI`의 프리셋 줄 끝에 `[커스텀]` 버튼을 둬요. `matchPreset(rules) === null`이면 켜진 상태로 보여요.
    - 방장이 규칙을 바꿔 커스텀이 되면 `localStorage['cb-custom-rules']`에 모드 키를 뺀 규칙을 저장해요.
    - 누르면 저장본을 `on.change(저장본)`으로 보내요. 저장본이 없으면 고급 설정만 펼쳐요.
  - 고급 설정 선택지 라벨
    - 맵 패턴: 끄기/가끔/보통/자주/많이/항상
    - 레이저 두께: 얇게/보통/굵게
    - 원 크기: 보통/작게
    - 아케이드 전용: 라운드 테마 끄기/가끔/자주, 랜덤 이벤트 끄기/가끔/자주

- [ ] **Step 1: 구현** — 위 Interfaces대로. 프리셋 아이콘은 lucide `Construction`(장애물 코스)·`Crosshair`(정밀 사격)·`SlidersHorizontal`(커스텀).
- [ ] **Step 2: 타입 검사** — `npm run typecheck` → 오류 없음.
- [ ] **Step 3: 테스트 (Task 6에서 실행)** — `shared/test/rules.test.ts`(새 파일)

```ts
test('프리셋: 새 키 값과 새 프리셋 2개', () => { /* basic mapPct 35, laserWidth 22; hardcore laserWidth 30; chaos mapPct 80·themePct 30·eventPct 30; chill mapPct 0; obstacle mapPct 100·sabotage false; precision circleScale 0.75·laser false·mapPct 0 */ });
test('sanitizeRules: 선택지 밖 값은 무시, 옛 randomEvents false → eventPct 0', () => {});
test('toGameRules: laserHalf = 22% → 99, 30% → 135', () => {});
test('makeCircle: circleScale 0.75면 색 원 반지름 0.75배, 아이템 원은 그대로', () => {});
test('rollEvent는 theme을 뽑지 않음', () => {});
```
`room.test.ts`: `'테마는 이벤트와 따로: themePct 100이면 매 선택마다 다음 테마, 한 게임 최대 2번'`, `'레이저 두께 보통이면 반폭 99 안에서만 스턴'`.

### Task 2: 방해·위험 규칙 조정 (방해 시간, 방해 내성, 위험 스턴 공통, 오오라)

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.sabotage`, `RULES.aura`, 새 `hazardStun`·`halveFever`)
- Modify: `shared/src/arcade.ts` (`laserProof` 이름·설명, `LEGEND_TEXT.laserProof`)
- Modify: `shared/src/items.ts` (방해 시간, 방해 내성 적용)
- Modify: `server/src/room.ts` (`updateLaser`가 `hazardStun` 사용, `updateAura`·오오라 클릭 변경, `offPool`)
- Modify: `client/src/main.ts` (오오라 표시 문구, `stun.by`에 새 값)
- Modify: `shared/src/protocol.ts` (`stun.by`: `'laser' | 'snipe' | 'spike' | 'ring'`, `'aura:hit'` 내용)

**Interfaces:**
- Produces:
  - `RULES.sabotage = { slowMs: 3_000, invertMs: 3_000, blindMs: 5_000, slowLagMs: 350, snipeStunMs: 3_000, slideMs: 150 }` (`ms` 삭제)
  - `RULES.aura = { extra: 80, pullSpeed: 120, tickMs: 1_000, feverLoss: 15, comboKeepPct: 70 }` (`touchPenalty`·`clickPenalty` 삭제)
  - `halveFever(p: PlayerState, now: number): boolean`: 피버 중이면 남은 피버 시간을 절반으로 줄여요(여운도 같이, 기존 `shiftFeverEnd` 사용). 줄였으면 `true`.
  - `hazardStun(p, now, baseMs, G, players): number`
    - 철벽이면 0이에요. 무적 중(`now < p.stunUntil + RULES.laser.immuneMs`)이어도 0이에요.
    - 그 밖에는 다음을 한 뒤 실제 스턴 ms를 돌려줘요(0이면 스턴 없음).
      - 방해 내성 레전드면 `addFever(+LEGEND.laserFever, raw)`
      - `halveFever`
      - `ms = baseMs × (1 − laserProof/100)`, `ms > 0`이면 `p.stunUntil = now + ms`
    - 레이저·가시 공·링이 모두 이 함수를 써요.
  - `ABILITY.laserProof`
    - 이름: '방해 내성'
    - 설명: `레이저·위험 패턴 스턴과 방해 아이템 시간 −${v}%` (100이면 '레이저·위험 패턴·방해 아이템에 걸리지 않음')
  - `LEGEND_TEXT.laserProof`: `레이저·위험 패턴에 닿으면 피버 게이지 +${LEGEND.laserFever}`
  - 방해 아이템
    - 시간은 `slowMs`·`invertMs`·`blindMs` × `(1 − laserProof/100)`이에요. 0 이하면 안 걸려요.
    - 1등 저격은 그대로예요.
    - `ITEMS` 설명 문구의 초도 새 상수로 바꿔요.
  - 오오라 (`updateAura`)
    - 커서가 처음 오오라에 들어오면 `halveFever` 1번 하고 바로 1틱을 적용해요.
    - 그 뒤 `tickMs`마다 `addFever(−feverLoss)`, `combo = floor(combo × 70%)`예요.
    - 오오라 클릭은 감점 없이 헛클릭도 아니에요(아무 일 없음).
    - `'aura:hit'`는 `{ by, x, y }`를 보내고, 클라이언트는 "피버 −15 · 콤보 −30%"를 보여 줘요.
  - `offPool`: 레이저·방해 아이템·맵 패턴(`mapPct 0`)이 모두 꺼졌을 때만 `laserProof`를 빼요.

- [ ] **Step 1: 구현** — 위대로. `canLaserStun`은 `hazardStun` 안의 검사로 대체하고, 다른 곳에서 안 쓰이면 지운다.
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 6에서 실행)** — `shared/test/hazard.test.ts`(새 파일)

```ts
test('hazardStun: 기본 baseMs, 방해 내성 40%면 60%, 100%면 0, 철벽 0, 무적 중 0', () => {});
test('hazardStun: 피버 중이면 남은 피버 시간 절반(여운도), 방해 내성 레전드면 게이지 +20', () => {});
test('방해 아이템: 감도 감소·반대 3초, 시야 방해 5초, 방해 내성 50%면 절반, 1등 저격은 내성과 무관', () => {});
```
`room.test.ts`: `'오오라: 들어가면 피버 절반 1번, 1초마다 게이지 −15·콤보 70%, 클릭은 아무 일 없음'`, `'방해 내성은 레이저·방해·맵 패턴이 모두 꺼진 방에서만 빠짐'`.

### Task 3: 맵 패턴 공통 모듈 (shared)

**Files:**
- Create: `shared/src/patterns.ts` (`shared/src/index.ts`에서 내보냄)
- Modify: `shared/src/rules.ts` (`RULES.patterns`)

**Interfaces:**
- Produces:
  - `RULES.patterns` (설계 문서 1·2절 수치)

```ts
patterns: {
  warnMs: 1_500, startMs: 5_000, endQuietMs: 12_000,
  walls: { ms: 10_000, count: [2, 3], thick: 40, len: [300, 450], centerClear: 220 },
  spikes: { ms: 10_000, count: 3, r: 28, speed: 260, stunMs: 1_000 },
  bar: { ms: 9_000, len: 1100, thick: 36, degPerSec: 45 },
  vortex: { ms: 8_000, r: 450, pull: 90, centerClear: 250 },
  ice: { ms: 8_000, stiff: 40, damp: 6 },
  ring: { ms: 10_000, shrinkMs: 6_000, holdMs: 3_000, minE: 0.7, stunMs: 1_000 },
  fog: { ms: 8_000, count: 3, r: 220, speed: 60 },
}
```
  - `type PatternId = 'walls' | 'spikes' | 'bar' | 'vortex' | 'ice' | 'ring' | 'fog'`
  - `PATTERNS: Record<PatternId, { name: string; text: string; danger: boolean }>`
    - 이름·문구는 설계 문서 2절 그대로예요.
    - `danger`는 spikes·ring만 `true`예요.
  - `interface Rect { x: number; y: number; w: number; h: number }`
  - `interface Mover { x: number; y: number; vx: number; vy: number }`
  - `interface MapPattern { id: PatternId; warnAt: number; at: number; until: number; walls?: Rect[]; balls?: Mover[]; bar?: { cx: number; cy: number; a0: number }; vortex?: Point; fog?: Mover[] }`
  - `rollPatternAt(roundStart: number, roundEnd: number, rand): number`: 등장 시각을 `[roundStart + startMs, roundEnd − endQuietMs]` 안에서 고르게 뽑아요(설계 문서 1절: 시작 5초 뒤 ~ 끝나기 12초 전). 구간이 비면 `−1`이에요.
  - `makePattern(id: PatternId, at: number, rand): MapPattern`
    - `warnAt = at − warnMs`, `until = at + ms`
    - 벽은 중앙 `centerClear` 원을 피하고 서로 겹치지 않아요(최대 20번 다시 뽑기).
    - 공은 무작위 위치와 방향이에요.
    - 막대 중심은 필드 중앙이고 `a0`는 무작위예요.
    - 소용돌이는 중앙 `centerClear` 밖이에요.
    - 안개는 무작위 위치와 방향이에요.
  - `rollPattern(at: number, rand): MapPattern`: 7개 중 고르게 하나예요.
  - `moverAt(m: Mover, t0: number, t: number, r: number): Point`: 필드 벽에서 접어 튕기는 위치예요(`circlePos`의 fold와 같은 방식).
  - `barSegment(p, t): { a: Point; b: Point }`
  - `ringE(p, t): number`: 안전 구역 타원 반경이에요(`zoneOf`와 같은 타원 거리 기준). shrinkMs 동안 `1.5 → minE`로 선형으로 줄고 그 뒤 유지돼요.
  - `inRingDanger(p, pt, t): boolean`: `t ∈ [at, until)`이고 타원 거리 > `ringE`예요.
  - `blockedAt(p, pt, t): boolean`: 벽 사각형 안이거나, 막대 선분까지 거리 ≤ thick/2(t ∈ [at, until))예요.
  - `pushOut(p, pt, t): Point`: 막힌 점이면 가장 가까운 바깥 점(벽은 가까운 변 밖, 막대는 선분 수직 방향 밖)이고, 아니면 그대로예요.
  - `spikeHit(p, pt, t, popped: ReadonlySet<number>): number`: 닿은 공 번호, 없으면 `−1`이에요. 닿음 = 거리 ≤ r이에요.
  - `vortexStep(p, pt, t, dtMs): Point`: 반경 안이면 중심 쪽으로 `pull × dt` 끌어요(넘어가지 않음).
  - `iceStep(pos: Point, vel: Point, target: Point, dtMs): { pos: Point; vel: Point }`
    - 스프링 `a = (target − pos)·stiff − vel·damp`이고, 16ms 이하로 쪼개서 적분해요.
  - `shiftPattern(p: MapPattern, delta: number): MapPattern`: 시각을 모두 `+delta`해요.

- [ ] **Step 1: 구현** — 위대로. 모양은 생성 때 정하고, 움직임은 시각으로만 계산한다(서버·클라이언트 같은 결과).
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 6에서 실행)** — `shared/test/patterns.test.ts`(새 파일)

```ts
test('rollPatternAt: 라운드 시작 5초 뒤 ~ 끝나기 12초 전 안, 너무 짧은 라운드면 −1', () => {});
test('makePattern: 경고 1.5초 전, 패턴별 유지 시간, 벽은 중앙을 피하고 서로 안 겹침', () => {});
test('moverAt: 벽에서 튕겨 필드 안에 머묾', () => {});
test('spikeHit: 반지름 안이면 번호, 사라진 공은 무시, 시간 밖이면 −1', () => {});
test('blockedAt·pushOut: 벽 안 점은 가장 가까운 변 밖으로, 막대는 돌아간 각도 기준', () => {});
test('ringE: 1.5에서 6초 동안 0.7까지 줄고 유지, 가장자리 점은 위험', () => {});
test('vortexStep: 반경 안만 끌고 중심을 넘지 않음', () => {});
test('iceStep: 목표를 한 번 지나쳤다가 결국 목표에 닿음', () => {});
test('shiftPattern: 모든 시각이 같이 밀림', () => {});
```

### Task 4: 맵 패턴 서버

**Files:**
- Modify: `server/src/room.ts`, `shared/src/protocol.ts`

**Interfaces:**
- Consumes: Task 1의 `G.mapChance`, Task 2의 `hazardStun`, Task 3의 함수들
- Produces:
  - 서버→클라이언트 이벤트
    - `'map:warn': (p: MapPattern) => void`: 경고 시작 때
    - `'map:pop': (d: { index: number; by: string }) => void`: 가시 공이 사라질 때
  - `PlayPayload`에 `pattern: MapPattern | null`, `popped: number[]`를 추가해요.
  - `Room`
    - `beginRound`
      - `pattern = null`, `popped` 비우기
      - `rand < G.mapChance`면 `rollPatternAt(startAt, endAt)`을 구하고, `≥ 0`이면 `pendingPattern = rollPattern(at)`
    - `tick`
      - `now >= pendingPattern.warnAt`이면 `pattern`으로 옮기고 `'map:warn'`을 보내요.
      - `now >= pattern.until`이면 `null`로 지워요.
      - 활성 중(`at ≤ now < until`)이면 사람마다 최신 커서로 판정해요.
        - 가시 공(`spikeHit`)에 닿으면 `popped`에 추가하고 `'map:pop'`을 보낸 뒤 `hazardStun(spikes.stunMs)`예요.
        - 링 위험 구역이면 `hazardStun(ring.stunMs)`예요.
        - 스턴이 걸리면 `'stun'`(`by: 'spike' | 'ring'`)과 상태를 보내요.
    - `click`: 활성 패턴이 `blockedAt(d)`면 아무것도 안 해요. 감점도 거절 알림도 없어요.
    - `finishResume`: `pattern`·`pendingPattern`을 `shiftPattern(delta)`해요.
    - `endRound`·`end`·`beginRound`에서 패턴을 지워요.
    - 시간 정지 아이템은 맵 패턴을 멈추지 않아요(판정: 패턴은 짧고 시각만으로 움직임).

- [ ] **Step 1: 구현** — 위대로. 봇은 판정에서 뺀다(레이저와 같음).
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 6에서 실행)** — `room.test.ts`

```ts
test('맵 패턴: mapPct 0이면 안 나옴, 100이면 라운드마다 1번 경고 후 등장·끝나면 사라짐', () => {});
test('맵 패턴: 가시 공에 닿으면 공이 사라지고 1초 스턴, 같은 공에 다시 안 맞음', () => {});
test('맵 패턴: 링 위험 구역이면 스턴, 풀린 뒤 1초 무적', () => {});
test('맵 패턴: 벽 안을 누르면 아무 일 없음 (빈 곳 감점 없음)', () => {});
test('맵 패턴: 일시정지하면 경고·등장·끝 시각이 같이 밀림', () => {});
test('맵 패턴: 재접속하면 game:sync에 패턴과 사라진 공', () => {});
test('맵 패턴: 라운드가 끝나면 지워지고 다음 라운드로 안 넘어감', () => {});
```

### Task 5: 맵 패턴 클라이언트 (커서·그림·현수막)

**Files:**
- Modify: `client/src/cursor.ts` (`GameCursor`), `client/src/main.ts`, `client/src/render.ts`, `client/src/effectsUI.ts`, `client/src/audio.ts`, `client/src/icons.ts`, `client/src/style.css`, `client/index.html`

**Interfaces:**
- Consumes: Task 3 함수들, Task 4 이벤트·페이로드
- Produces:
  - `interface FieldFx { pattern: MapPattern; t: number }`
  - `GameCursor.frame(mode, dtMs, inAura = false, fx: FieldFx | null = null)`
    - 벽·막대·소용돌이·빙판이 활성이면 커서가 상대 이동이에요(오오라와 같은 `'a'` 방식).
    - 이동량은 반대면 −1배, 감도 감소면 0.5배예요(판정: 패턴 중에는 상대 이동이 우선).
    - 벽·막대: 이동량을 10px 이하로 쪼개 매 단계 `pushOut`해서 뚫고 지나가지 않아요. 막대가 쓸고 오면 매 프레임 `pushOut`이에요.
    - 소용돌이: 이동 뒤 `vortexStep`이에요.
    - 빙판: 상대 이동으로 정한 목표를 `iceStep`으로 따라가요(속도 상태를 `GameCursor`가 들고 있어요).
    - 패턴이 끝나면 지금 위치에서 진짜(또는 효과) 위치로 `slideMs` 동안 미끄러져요.
    - 가시 공·링·안개는 커서에 영향이 없어요.
  - 그림 (`renderer.draw` 상태에 `pattern`, `popped`)
    - 경고 중에는 자리를 반투명으로 그려요.
    - 벽은 회색 블록, 가시 공은 가시 달린 빨간 공, 막대는 금속 막대예요.
    - 소용돌이는 돌아가는 나선, 링은 위험 구역을 빨갛게 덮은 타원 밖이에요.
    - 안개는 원 위에 덮는 흐린 원이에요.
    - 화면 효과 줄이기면 회전·나선 애니메이션 없이 그려요.
  - `showPatternBanner(host: HTMLElement, id: PatternId, reduce: boolean)`: 화면 위쪽에 `⚠ 이름`과 문구를 띄워요. 위험이면 `.danger` 빨간 테두리, 아니면 노란 테두리예요. 1.5초 뒤 접혀요.
  - `#patternTag`: 활성 동안 위쪽 작은 띠에 "가시 공 6"을 보여 줘요.
  - `sfx.patternWarn()`: 레이저 경고와 다른 소리예요.
  - 레이저 그림 폭은 `toGameRules(rules).laserHalf`예요(Task 1).
  - 패턴 아이콘: lucide `BrickWall`·`Bomb`(가시 공은 이미 쓰면 `CircleAlert`)·`RotateCw`·`Tornado`·`Snowflake`·`CircleDashed`·`Cloud`

- [ ] **Step 1: 구현** — 위대로. 이벤트 `'map:warn'`에서 현수막·소리, `'map:pop'`에서 그 공 터지는 효과, `applyPlay`에서 `pattern`·`popped` 복원.
- [ ] **Step 2: 타입 검사·빌드** — `npm run typecheck && npm run build`.
- [ ] **Step 3: 테스트 (Task 6에서 실행)** — `shared/test/gamecursor.test.ts`

```ts
test('GameCursor 벽: 빠르게 움직여도 벽을 뚫지 않고, 생길 때 안에 있으면 밖으로', () => {});
test('GameCursor 소용돌이: 가만히 있어도 중심 쪽으로 끌림', () => {});
test('GameCursor 빙판: 멈춘 뒤에도 조금 더 가다 돌아옴', () => {});
test('GameCursor 패턴 + 반대: 이동이 반대로, 패턴이 끝나면 미끄러져 거울 위치로', () => {});
```

### Task 6: 테스트·확인·문서·커밋·리뷰

- [ ] **Step 1: 테스트 작성** — Task 1~5의 테스트를 모두 쓴다. 기존 테스트 중 `randomEvents`·`RULES.sabotage.ms`·`aura.touchPenalty`·`laserHits` 반폭을 쓰는 것은 새 이름으로 고친다.
- [ ] **Step 2: 전체 테스트** — `npm test` → 모두 통과 (처음 실패는 원인을 고친다).
- [ ] **Step 3: 타입 검사·빌드** — `npm run typecheck && npm run build`.
- [ ] **Step 4: 브라우저 확인**
  - 장애물 코스 프리셋 혼자 하기에서 패턴 7개를 차례로 확인해요. 강제로 뽑으려면 개발 서버에서 임시로 하나만 고르게 하고, 확인 뒤 되돌려요.
    - 현수막, 경고, 남은 시간 띠
    - 벽 돌아가기, 가시 공 스턴, 링 스턴
  - 고급 설정 선택지와 커스텀 버튼(저장·불러오기)도 확인해요.
- [ ] **Step 5: 문서** — `README.md`(맵 패턴·방 규칙·프리셋·방해 조정), `docs/ROADMAP.md`, 설계 문서 상태를 '구현 완료'로.
- [ ] **Step 6: 커밋 (목적별)**
  - `feat: 확률 고르기 방 규칙·장애물 코스·정밀 사격·커스텀 프리셋·레이저 두께·원 크기`
  - `balance: 감도 감소·반대 3초, 오오라는 피버 게이지·콤보 감소, 피버 중 피격은 피버 절반`
  - `feat: 레이저 내성을 방해 내성으로`
  - `feat: 맵 패턴 7개 (가로막기·가시 공·회전 막대·소용돌이·빙판·좁아지는 링·안개)`
  - `feat(client): 맵 패턴 커서 효과·그림·현수막`
  - `test: …`
  - `docs: …` (설계 문서·계획 포함)
- [ ] **Step 7: 최종 리뷰** — 브랜치 전체를 새 리뷰어(가장 좋은 모델)가 보고, 중요한 지적만 재현 테스트 → 수정.
