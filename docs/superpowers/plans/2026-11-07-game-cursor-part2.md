# 3단계 2차: 방해 아이템·오오라·카오스 모드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1차의 게임 커서 위에 방해 아이템 4종(감도 감소·마우스 반대·시야 방해·1등 저격), 이동형 보스 오오라, 카오스 모드를 넣는다.

**Architecture:** 방해 효과는 플레이어별 `debuffs`(끝나는 시각)로 `PlayerState`에 두고 서버가 아이템을 잡을 때 정한다. 커서 효과(감속·반전·오오라 끌림)는 클라이언트 게임 커서가 `cursorModeOf`·`auraOf` 순수 함수로 계산하고, 시야 방해는 렌더러가 그린다(렌즈는 물체 위치만 휘게). 카오스는 방 규칙 `chaos`가 켜지면 `RULES.chaos` 배율을 기존 계산 함수에 넘긴다.

**Tech Stack:** TypeScript 5.6, Node 20+ (`node:test` + `tsx`), Socket.IO 4, Vite 5, Canvas 2D

**Spec:** `docs/superpowers/specs/2026-11-07-game-cursor-design.md` (2차 묶음)

## Global Constraints

- 커밋 규칙·`npm test`·`typecheck`·`build` 통과, 수치는 `RULES`에, 푸시는 사용자 확인 후
- 방해 아이템: 흔함 감도 감소·마우스 반대, 희귀 시야 방해, 전설 1등 저격. 감도·반대·시야는 **잡은 사람 뺀 모두**에게 5초, 같은 방해를 또 맞으면 남은 시간에 더하되 10초까지
- 감도 감소: 게임 커서가 실제 움직임의 30%. 마우스 반대: 움직임 반대. 효과가 끝나면 게임 커서가 0.15초 동안 진짜 마우스 위치로 미끄러져 돌아옴
- 시야 방해 넷 중 하나(서버가 정함): 잉크 얼룩 3~4개 / 반코트(화면 절반, 무작위 방향) / 무작위 낙서 / 렌즈(볼록·오목, 원·보스·아이템 원의 위치와 크기만 휨, 클릭 판정은 그대로)
- 1등 저격: 1등(잡은 사람이 1등이면 2등) 3초 스턴 + 콤보 끊김, 점수는 안 뺌, `stun` 이벤트 `by: 'snipe'`
- 보호막 아이템은 방해를 막지 않음
- 오오라: 이동형 보스 둘레 반지름 +80. 커서가 오오라 안(몸통 밖)이면 게임 커서가 보스 중심 쪽으로 초당 120 끌리고, 서버가 0.5초마다 −1. 오오라를 클릭하면(몸통이 아닌 곳) −2. 점수는 0 아래로 안 감
- 방 규칙 `sabotage` 기본 켜짐·'느긋하게' 꺼짐 (끄면 방해 아이템이 안 나옴), `chaos` 카오스 프리셋만 켬
- 카오스: 아이템 원 ×3, 웨이브·레이저 간격 절반, 보스 수 [1마리 20, 2마리 40, 3마리 40], 아케이드 랜덤 이벤트 30%, 기본 규칙 속도 ×1.25·원 많이·피버 ×5·무지개 10%·꼴찌 보정

## Review Focus

1. **방해 중 일시정지·재접속** — 남은 시간이 이어지고(shiftTimes), 재접속해도 같은 시야 방해 모양이 보임(종류·시드가 PlayerState에). 테스트(Task 1)
2. **방해가 끝난 직후 커서** — 진짜 마우스 위치로 돌아와 클릭이 예전처럼 맞음. `slideBack` 테스트(Task 2)
3. **혼자 남은 1등이 저격을 잡음 / 동점** — 대상이 없거나 여럿일 때 오류 없이 처리(2등이 없으면 아무 일 없음, 동점이면 점수 순서 첫 사람). 테스트(Task 1)
4. **봇** — 봇은 커서가 없어서 감도·반대·오오라 영향이 없고, 시야 방해도 의미 없음. 저격 스턴은 봇에도 적용(봇 클릭 막힘). 테스트(Task 3)
5. **'방해 아이템' 끈 방** — 방해 아이템이 절대 안 나옴. 테스트(Task 1)

---

### Task 1: 방해 아이템·디버프·카오스 규칙 (shared)

**Files:** Modify `shared/src/items.ts`, `shared/src/rules.ts`, `shared/src/waves.ts`, `shared/src/cursor.ts`, `shared/src/events.ts` · Test `shared/test/sabotage.test.ts`, `shared/test/chaos.test.ts`

**Interfaces — Produces:**
- `type DebuffId = 'slow' | 'invert' | 'blind'`, `type BlindKind = 'ink' | 'half' | 'doodle' | 'lens'`
- `PlayerState.debuffs: Partial<Record<DebuffId, number>>`, `PlayerState.blind: { kind: BlindKind; seed: number } | null` (newPlayer·startRound 초기화, `shiftTimes`가 debuffs도 민다)
- `debuffOn(p, id, now): boolean`, `addDebuff(p, id, ms, now)` (남은 시간에 더하되 `ms × 2`까지 — addBuff와 같은 규칙)
- `RULES.sabotage = { ms: 5_000, slow: 0.3, snipeStunMs: 3_000, slideMs: 150 }`
- `ItemId`에 `'slowCursor' | 'invertCursor' | 'blind' | 'snipe'`, `ITEMS`에 등급 0·0·1·2와 `sabotage: true` 표시 (`ItemDef.sabotage?: boolean`)
- `rollItem(tier, G, rand)`: `!G.sabotage`면 `sabotage` 아이템 제외
- `RoomActionKind`에 `'snipe'` 추가. `applyItem`: slowCursor/invertCursor/blind는 잡은 사람을 뺀 모두에게 `addDebuff`(blind는 `p.blind = { kind: BLIND_KINDS[⌊rand×4⌋], seed: ⌊rand×1e9⌋ }`), 반환 `null`. snipe는 대상을 정해 `stunUntil = max(…, now + 3000)` + 콤보 0, 반환 `{ kind: 'snipe', target: id }` (대상 없으면 `target: null`)
- `export function snipeTarget(p: PlayerState, players: PlayerState[]): PlayerState | null` — 점수 순(동점은 배열 순)으로 1등, 그게 p면 2등, 없으면 null
- `RoomRules.sabotage`(DEFAULT true, chill false), `RoomRules.chaos`(DEFAULT false), sanitize·GameRules·`MODE_KEYS`는 그대로(chaos는 프리셋이 바꾸는 값)
- `RULES.chaos = { itemMult: 3, waveIntervalMult: 0.5, laserIntervalMult: 0.5, bossCountOdds: [20, 40, 40], eventChance: 0.3 }`
- `PRESETS.chaos = { name: '카오스', desc: '모든 게 켜진 진정한 난장판', rules: { ...DEFAULT_RULES, speed: 1.25, density: 1.3, feverMult: 5, rainbowPct: 10, comeback: true, chaos: true } }`
- 배율을 받는 기존 함수: `nextWaveIn(rand, chaos = false)`, `nextLaserIn(rand, chaos = false)`, `rollBossCount(alive, theme, rand, chaos = false)`, `rollEvent(players, used, rand, chance = RANDOM_EVENT.chance)`

- [ ] **Step 1: 실패하는 테스트**
  - sabotage.test: 감도 감소를 잡으면 다른 셋은 `debuffs.slow === now + 5000`, 잡은 사람은 없음 / 다시 잡으면 10000까지 / blind는 kind가 넷 중 하나, 같은 시드로 재현 / `shiftTimes`가 debuffs 이동 / startRound 후 비어 있음
  - `snipeTarget`: 1등이 잡으면 2등, 아니면 1등, 혼자면 null, 동점이면 배열 순 첫 사람 / snipe 적용 후 대상 `stunUntil = now + 3000`, `combo = 0`, 점수 그대로
  - `rollItem`: `sabotage: false` 방에서 여러 난수로 sabotage 아이템이 안 나옴, 켜진 방에서는 등급마다 나옴
  - chaos.test: `PRESETS.chaos.rules.chaos === true`, 다른 프리셋 false / `nextWaveIn(() => 0, true) === 6000` / `nextLaserIn(() => 0, true) === 5000` / `rollBossCount(0, null, () => 0.21, true) === 2`, `() => 0.61` → 3 / `rollEvent(ps, 0, seq(0.25, …), 0.3)`이 null 아님
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: `npm test`·`npm run typecheck`** → PASS (client `icons.ts`의 `ITEM_ICON`·`UI`에 새 키가 필요하면 이 Task에서 아이콘만 채운다: slowCursor `Snail`, invertCursor `ArrowLeftRight`, blind `EyeOff`, snipe `Crosshair`, chaos `Tornado`)

### Task 2: 커서 효과·오오라·렌즈 계산 (shared/cursor.ts)

**Interfaces — Produces:**
- `cursorModeOf(p: PlayerState, now: number): CursorMode | null` — slow·invert 디버프로 `{ slow: 0.3 }`·`{ invert: true }`(둘 다면 합침), 없으면 null
- `slideBack(from: Point, real: Point, elapsedMs: number): Point` — `RULES.sabotage.slideMs` 동안 선형 보간, 그 뒤엔 `real`
- `RULES.aura = { extra: 80, pullSpeed: 120, tickMs: 500, touchPenalty: 1, clickPenalty: 2 }`
- `auraAt(c: Circle, t: number): { x: number; y: number; r: number; inner: number } | null` — 이동형 보스만, `r = c.r + extra`, `inner = c.r`
- `inAura(p: Point, a): boolean` — `inner < 거리 ≤ r`
- `lensWarp(p: Point, size: number, convex: boolean): { x: number; y: number; size: number }` — 중심 (800, 450), 반경 `R = 380`. 거리 d < R일 때 볼록 `d' = R × (d/R)^0.6`·크기 ×(1 + 0.6 × (1 − d/R)), 오목 `d' = R × (d/R)^1.6`·크기 ×(1 − 0.4 × (1 − d/R)); 그 밖은 그대로

- [ ] **Step 1: 실패하는 테스트** (cursor.test에 추가)
  - `cursorModeOf`: 디버프 없으면 null, slow만 `{slow:0.3}`, 둘 다 `{slow:0.3, invert:true}`, 끝난 디버프는 무시
  - `slideBack({x:0,y:0},{x:100,y:0}, 75)` → x 50, `150` 이상 → real
  - `auraAt`: 일반 보스·원은 null, 이동형은 r+80; `inAura`: 몸통 안 false, 오오라 안 true, 밖 false
  - `lensWarp`: 중심과 R 밖은 그대로, 볼록은 R 안의 점이 바깥으로(거리 증가)·크기 증가, 오목은 안쪽으로·크기 감소
- [ ] **Step 2–4:** FAIL → 구현 → PASS

### Task 3: 서버 — 방해 적용, 저격 스턴, 오오라 감점, 카오스 배율

**Files:** Modify `server/src/room.ts` · Test `shared/test/room.test.ts`

- `claimItem`: `RoomAction.kind === 'snipe'`이고 대상이 있으면 `'stun' { playerId, until, by: 'snipe' }` 전송 + `emitPlayers` (방해 디버프는 `players`로 전달)
- 오오라: `private updateAura(now)` — 사람 플레이어마다 신선한 커서가 어떤 이동형 보스의 `inAura`면 `auraAt`(플레이어별 마지막 감점 시각)에서 `tickMs`가 지났을 때 점수 −1(0 아래 금지), `emitPlayers`. `tick`에서 호출
- 클릭: 직접 맞은 원·범위로 아무것도 못 잡았고 클릭 점이 이동형 보스의 `inAura`면 빈 곳 페널티 대신 −2 (`'aura:hit' { by, x, y, lose }` 전송)
- 카오스: `spawnOpts` 아이템 확률 ×`itemMult`, `nextWaveIn(…, G.chaos)`, `nextLaserIn(…, G.chaos)`, `rollBossCount(…, G.chaos)`, `rollEvent(…, G.chaos ? RULES.chaos.eventChance : undefined)`
- protocol: `'aura:hit': (d: { by: string; x: number; y: number; lose: number }) => void`
- [ ] **Step 1: 실패하는 테스트** — 저격 아이템 원을 클릭(난수 고정으로 snipe) → 1등 스턴·콤보 0·`'stun'` 1번 / 오오라 안 커서로 `updateAura(now)`·`(now+500)` → −1씩, 몸통 안이면 감점 없음, 봇은 대상 아님 / 오오라 클릭 → −2, 헛클릭 기록 없음 / 카오스 방에서 `spawnOpts().itemChance === 0.075`
- [ ] **Step 2–4:** FAIL → 구현 → PASS

### Task 4: 화면 — 커서 효과, 시야 방해, 방해 표시, 카오스 프리셋

**Files:** Modify `client/src/cursor.ts`, `client/src/main.ts`, `client/src/render.ts`, `client/src/effectsUI.ts`, `client/src/rulesUI.ts`, `client/src/audio.ts`, `client/src/style.css`

- `GameCursor.move(real, delta, mode)`: 모드가 있으면 `nextCursor`, 모드가 막 끝났으면 `slideBack`으로 0.15초 동안 돌아옴. `GameCursor.pull(target: Point, dist: number)` 추가 (오오라 끌림, 매 프레임 `pullSpeed × dt`) — 끌린 동안은 모드가 있는 것처럼 상대 이동
- main: 매 프레임 `cursorModeOf(me)`·오오라 판정으로 커서 갱신, `aura:hit`·저격 스턴 연출(조준선 → "저격!"), 방해가 걸리면 효과음과 "감도 감소!" 같은 글자
- render: `DrawState.blind: { kind, seed, until } | null` — ink(시드로 위치 정한 검은 얼룩 3~4개, 끝 0.5초 전부터 옅어짐), half(시드로 정한 방향 절반 어두운 막), doodle(시드로 정한 굵은 곡선 5~6개), lens(원·보스·아이템 원을 그릴 때 `lensWarp`, 볼록/오목은 시드 홀짝). 이동형 보스 오오라(보랏빛 반투명 고리, 커서가 안에 있으면 더 진하게)
- 방해 표시: 버프 바 옆에 디버프 아이콘(붉은 테두리, 원형 타이머)
- rulesUI: `'sabotage'` 토글('방해 아이템'), 프리셋 버튼에 카오스(아이콘 `UI.chaos`)
- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm run typecheck`·`npm run build`** → 통과
- [ ] **Step 3: 수동 확인** — 확인용으로 방해 아이템 확률을 잠시 올려: 감도 감소·반대 중 커서 움직임, 끝난 뒤 커서가 마우스로 돌아오고 클릭이 맞음, 시야 방해 4종 모양, 저격 연출, 이동형 보스 오오라 끌림·감점, 카오스 프리셋으로 시작했을 때 아이템·웨이브·레이저가 잦아짐. 올린 확률 되돌림

### Task 5: 문서와 커밋

- [ ] README(방해 아이템·오오라·카오스), ROADMAP 3단계 남은 항목 ✅, 설계서 상태 "구현 완료"
- [ ] 커밋: `feat(shared): 방해 아이템·오오라·카오스 규칙 추가` (Task 1·2) / `feat: 방해 아이템·이동형 보스 오오라·카오스 모드 추가` (Task 3·4·문서·계획)
