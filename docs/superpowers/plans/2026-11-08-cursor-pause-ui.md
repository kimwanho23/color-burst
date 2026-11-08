# 커서 효과·일시정지·도감 버튼·상대 빌드·조합 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마우스 반대·감도 감소 중에도 커서가 화면 밖으로 빠지지 않게 하고, 일시정지 규칙을 모두에게 열고, 도감·버튼·상대 빌드·활성 조합을 잘 보이게 한다.

**Architecture:** 커서 효과는 "움직인 양"이 아니라 "진짜 마우스 위치"에서 게임 커서 위치를 계산한다(반대 = 거울 위치, 감도 감소 = 늦게 따라옴). 일시정지는 서버가 사람마다 남은 횟수·자동 재개·재개 카운트다운을 관리하고 클라이언트는 보여 주기만 한다. 나머지(도감 버튼, 아이콘 버튼, 상대 빌드, 조합 표시)는 클라이언트 화면 작업이다.

**Tech Stack:** TypeScript, Socket.IO, Vite, Canvas, lucide 아이콘, `node --test`

**Spec:** 따로 된 설계 문서는 없다. 2026-11-08 대화에서 확정한 추천안이 기준이고, 아래 "결정 사항"에 그대로 옮겼다.

## 결정 사항 (사용자 확정)

1. **커서 효과 (위치 기준, 마우스 잠금 없음)**
   - 마우스 반대: 게임 커서 = 진짜 마우스의 화면 가운데 기준 거울 위치 (x → 1600 − x, y → 900 − y). 효과가 걸리는 순간 지금 위치에서 거울 위치로 미끄러져 옮겨 간다.
   - 감도 감소: 게임 커서가 진짜 마우스(반대도 걸렸으면 거울 위치)를 느리게 따라간다.
   - 진짜 마우스가 게임 영역(캔버스) 밖으로 나가도 게임 커서는 사라지지 않고 가장자리에 붙어 있다. 브라우저 창 밖으로 나가면 마지막 위치에 멈춰 있다.
2. **일시정지 (멀티)**
   - Esc(또는 P)·위쪽 버튼으로 누구나 건다. 사람마다 한 게임에 3번. 버튼에 남은 횟수 "2/3".
   - 한 번에 최대 30초, 지나면 저절로 풀림. 푸는 건 누구나.
   - 풀릴 때(누가 풀든, 30초가 지나든) 3초 카운트다운 뒤 다시 시작.
   - 증강 선택 중에는 못 멈춤 (지금과 같음).
   - 횟수를 다 쓴 뒤 Esc: 게임은 계속, "남은 일시정지가 없어요" 안내만.
   - 혼자 하기: 횟수·시간 제한 없음 (지금과 같음).
3. **도감·규칙 위치**: 위쪽 바 '설정' 옆에 '도감' 버튼 (처음 화면·대기실·증강 선택·일시정지 화면에서 열림). 점수표는 도감의 '규칙' 탭으로 옮기고 대기실 방 규칙 상자에서는 뺀다.
4. **글자 링크 → 아이콘 버튼**: 처음 화면 [도감] 보조 버튼, 대기실 [도감] [방 나가기/처음으로] 한 줄 보조 버튼(방 나가기는 옅은 빨강 테두리), 설정 창 '닫기'는 오른쪽 위 ✕ 아이콘 버튼. 기존 `.btn` 둥근 모서리와 lucide 아이콘에 맞춘다.
5. **상대 빌드 보기**
   - 증강 선택 화면: 내 카드 아래 '상대 빌드' 패널, 상대마다 한 줄(이름·점수·순위·증강 타일·특별/저주 구분·완성 조합 금색 띠). 타일에 마우스를 올리면 설명(레전드 효과 포함).
   - 점수판 칩: 누르면(또는 마우스를 올리면) 그 사람 빌드 카드 팝업. 1초마다 다시 그려도 닫히지 않음. 아이콘 13 → 16px, 특별 카드·완성 조합 수 배지.
   - 결과 화면: 순위 옆에 최종 빌드 타일.
6. **활성 조합 표시**
   - 게임 중: 아이템 효과 칩 옆에 내 완성 조합 금색 칩 상시 표시(철옹성은 남은 횟수). 조합 효과가 실제로 발동하면 그 칩이 잠깐 반짝임.
   - 점수판 칩 배지 "조합 N", 빌드 카드에 조합 이름·효과.
   - 증강 선택 화면: 완성 조합을 목록 맨 위 금색으로, 그 아래 진행 중(1/3 등).
   - 도감 조합 탭: 게임 중에 열면 내 완성 '완성' / 진행 '2/3'.

## Global Constraints

- 모든 화면 문구는 한국어.
- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`에만 둔다 (새 수치: `RULES.pause`, `RULES.sabotage.slowLagMs`).
- 커밋 메시지는 `CONTRIBUTING.md`의 Conventional Commits (`<타입>(<범위>): <한국어 요약>`), 한 커밋에 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에 쓰고 돌린다 (사용자 지시). 각 Task의 테스트 단계는 Task 7에 모아 실행한다.
- `main` 병합·푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. 반대 효과가 걸리는 순간 게임 커서가 거울 위치로 순간이동하지 않고 `RULES.sabotage.slideMs` 동안 미끄러져야 한다 (효과가 끝날 때도 마찬가지).
2. 재개 카운트다운 중에 또 멈추기·또 풀기·30초 자동 재개 타이머가 겹치면 시간 밀기(`shiftTimes` 등)가 두 번 적용되면 안 된다.
3. 일시정지 중에 방장이 나가거나 멈춘 사람이 나가도 30초 자동 재개는 그대로 돌아야 한다.
4. 새 게임(한 판 더)에서 남은 일시정지 횟수가 3으로 돌아와야 한다.
5. 점수판 팝업이 열린 채로 그 사람이 방을 나가거나 게임이 끝나면 팝업이 닫혀야 한다.

---

### Task 1: 커서 효과를 위치 기준으로

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.sabotage`: `slow: 0.3` → `slowLagMs: 350`)
- Modify: `shared/src/cursor.ts` (`CursorMode`, `nextCursor` 대체, `cursorModeOf`)
- Modify: `client/src/cursor.ts` (`GameCursor`)
- Modify: `client/src/main.ts` (`moveCursor`, 포인터 이벤트 등록, 프레임 루프)
- Test: `shared/test/cursor.test.ts`

**Interfaces:**
- Produces:
  - `type CursorMode = { slow?: boolean; invert?: boolean }` (오오라만 걸리면 `{}`)
  - `cursorTarget(real: Point, mode: CursorMode | null): Point` — 진짜 위치를 필드 안으로 자른 뒤, `invert`면 `{ x: FIELD.w − x, y: FIELD.h − y }`
  - `followCursor(prev: Point, target: Point, dtMs: number, slow: boolean): Point` — `slow`가 아니면 `target`, `slow`면 `prev + (target − prev) × (1 − e^(−dtMs / RULES.sabotage.slowLagMs))`
  - `relativeCursor(prev: Point, delta: Point): Point` — 오오라 전용(효과 없이 끌리는 중): 이동량 그대로 더하고 필드 안으로 자름 (지금 `nextCursor`의 k = 1 경우)
  - `GameCursor.move(real: Point, delta: Point)`, `GameCursor.frame(mode: CursorMode | null, dtMs: number)`, `GameCursor.pull(target, dist)` (그대로), `GameCursor.leave()` (창을 떠날 때만)

- [ ] **Step 1: 테스트 (Task 7에서 실행)** — `shared/test/cursor.test.ts`의 `nextCursor` 테스트 두 개를 아래로 바꾼다.

```ts
test('cursorTarget: 반대는 화면 가운데 기준 거울 위치, 필드 밖 진짜 위치는 잘라서', () => {
  assert.deepEqual(cursorTarget({ x: 1600, y: 0 }, { invert: true }), { x: 0, y: 900 });
  assert.deepEqual(cursorTarget({ x: 1200, y: 300 }, { invert: true }), { x: 400, y: 600 });
  assert.deepEqual(cursorTarget({ x: 1700, y: -50 }, { invert: true }), { x: 0, y: 900 });
  assert.deepEqual(cursorTarget({ x: 1700, y: -50 }, null), { x: 1600, y: 0 });
});
test('followCursor: 감도 감소는 늦게 따라가 결국 도착, 아니면 바로', () => {
  const a = followCursor({ x: 0, y: 0 }, { x: 1000, y: 0 }, 16, true);
  assert.ok(a.x > 0 && a.x < 100);
  let p = { x: 0, y: 0 };
  for (let i = 0; i < 200; i++) p = followCursor(p, { x: 1000, y: 0 }, 16, true);
  assert.ok(Math.abs(p.x - 1000) < 1);
  assert.deepEqual(followCursor({ x: 0, y: 0 }, { x: 1000, y: 0 }, 16, false), { x: 1000, y: 0 });
});
test('cursorModeOf: 감도 감소·반대 디버프를 그대로 표시', () => { /* slow 디버프 → { slow: true }, 둘 다 → { slow: true, invert: true }, 없으면 null */ });
test('반대가 걸리는 순간: slideBack으로 거울 위치까지 slideMs 동안 미끄러짐', () => {
  const from = { x: 1200, y: 300 }, to = cursorTarget(from, { invert: true });
  assert.deepEqual(slideBack(from, to, RULES.sabotage.slideMs / 2), { x: 800, y: 450 });
  assert.deepEqual(slideBack(from, to, RULES.sabotage.slideMs), to);
});
```

- [ ] **Step 2: 구현** — `shared/src/cursor.ts`에 위 세 함수, `cursorModeOf`는 `{ slow: true }` 형태로. `GameCursor`:
  - `move`: 진짜 위치·이동량만 기록 (`real`), 효과가 없고 미끄러지는 중이 아니면 `pos = real`.
  - `frame(mode, dtMs)`: 모드가 `null`이면 지금처럼 `settle()`(진짜 위치로 미끄러져 돌아옴). 모드가 `{}`(오오라만)면 `relativeCursor`로 `move`에서 받은 이동량을 더한다. `slow`/`invert`면 `target = cursorTarget(real, mode)`. 모드 키(`slow`·`invert` 조합)가 바뀐 프레임에는 `slideFrom = pos`로 미끄러짐을 시작하고, 미끄러지는 동안은 `slideBack(slideFrom, target, 경과)`. 끝나면 `followCursor(pos, target, dtMs, !!mode.slow)`.
  - `main.ts`: `pointermove`를 캔버스가 아니라 `window`에 등록하고, 캔버스 밖 좌표는 `renderer.toField` 결과를 `cursorTarget`이 잘라 준다. 캔버스 `pointerleave`에서 `leave()`를 부르지 않는다. 문서를 떠날 때(`document`의 `pointerout`에서 `relatedTarget === null`)는 위치를 그대로 둔다. `blur`·`visibilitychange`의 `leave()`는 그대로. 프레임 루프에서 `gameCursor.frame(cursorMode, dt * 1000)`.
- [ ] **Step 3: 타입 검사** — `npm run typecheck` → 오류 없음.

### Task 2: 일시정지 규칙

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.pause`, `PlayerState.pausesLeft`, `newPlayer`, `resetForRound`)
- Modify: `shared/src/protocol.ts` (`'game:pause'` 내용, `'game:resuming'`, 스냅샷·`PlayPayload` 필드)
- Modify: `server/src/room.ts` (`canPause`, `pause`, `resume`, `doPause`, 자동 재개·카운트다운 타이머, `destroy`·`beginRound`·`end`에서 타이머 정리)
- Modify: `client/src/main.ts`, `client/index.html` (일시정지 화면·버튼·카운트다운)
- Test: `shared/test/room.test.ts`

**Interfaces:**
- Produces:
  - `RULES.pause = { perGame: 3, maxMs: 30_000, resumeMs: 3_000 }`
  - `PlayerState.pausesLeft: number` (`newPlayer`·`resetForRound`에서 `RULES.pause.perGame`)
  - 서버→클라이언트 `'game:pause': (d: { by: string; until: number }) => void` (`until` = 자동 재개 시작 시각, 혼자 하기는 0)
  - 서버→클라이언트 `'game:resuming': (d: { at: number }) => void` (`at` = 실제로 다시 시작하는 서버 시각)
  - `PlayPayload`·스냅샷에 `pauseUntil: number`, `resumeAt: number` 추가 (재접속한 사람도 같은 화면)
  - `Room.canPause(id)`: 혼자 하기는 방 안 사람, 멀티는 봇이 아니고 `pausesLeft > 0`
  - `Room.canResume(id)`: 방 안의 사람(봇 제외) 누구나
- 동작:
  - `pause(id)`: 지금 조건 + 카운트다운 중(`resumeAt > 0`)이면 무시. 멀티면 `pausesLeft--`, `until = now + maxMs`에 `beginResume()` 예약.
  - `resume(id)`: `canResume`이고 멈춰 있고 카운트다운 중이 아니면 `beginResume()`.
  - `beginResume()`: 자동 재개 타이머 해제, `resumeAt = now + resumeMs`, `'game:resuming'` 보냄, `resumeMs` 뒤 `finishResume()`.
  - `finishResume()`: 지금 `resume` 본문(멈춘 시간만큼 시각 밀기, `game:sync`). 밀어 주는 시간은 카운트다운까지 포함(`Date.now() − pausedAt`).

- [ ] **Step 1: 테스트 (Task 7에서 실행)** — `room.test.ts`에 추가.

```ts
test('일시정지: 사람마다 3번, 누구나 풀고, 풀면 3초 뒤 시작', (t) => { /* 두 사람 방: A가 멈춤 → A.pausesLeft 2, B가 resume → 아직 pausedAt>0, tick(3000) 뒤 pausedAt 0. A가 세 번 더 멈추면 세 번째까지만 되고 네 번째(4회째)는 무시 */ });
test('일시정지: 30초가 지나면 저절로 풀리고 카운트다운 뒤 시작', (t) => { /* tick(30_000) → resumeAt>0, tick(3_000) → pausedAt 0 */ });
test('일시정지: 카운트다운 중에는 다시 멈추거나 또 풀어도 시간이 두 번 밀리지 않음', (t) => { /* resume 두 번, pause 시도 → endAt이 (멈춘 시간 + 3초)만큼만 늘어남 */ });
test('혼자 하기 일시정지: 횟수가 줄지 않고 30초가 지나도 안 풀림', (t) => { /* solo 방 */ });
test('새 게임이면 남은 일시정지가 3으로', () => { /* resetForRound */ });
test('멈춘 사람이 방을 나가도 30초 자동 재개는 그대로', (t) => { /* A가 멈추고 leave → tick(30_000 + 3_000) → pausedAt 0 */ });
test('봇은 일시정지를 걸거나 풀 수 없음', () => { /* canPause·canResume(봇 id) false */ });
```

기존 테스트 `일시정지가 풀리면 모든 볼리의 발사 시각이 그만큼 밀린다`는 `resume` 뒤 `t.mock.timers.tick(RULES.pause.resumeMs)`를 더하고(`setTimeout`도 모의), 기대값을 `at + 2000 + resumeMs`로 바꾼다.

- [ ] **Step 2: 구현** — 위 Interfaces대로. 클라이언트:
  - 위쪽 '일시정지' 버튼: 멀티에서는 모두에게 보이고 글자 `일시정지 2/3`, 0이면 흐리게(`disabled`). 혼자 하기는 지금처럼.
  - 일시정지 화면: "OO님이 멈췄어요", 멀티면 "N초 뒤 자동으로 다시 시작해요"(1초마다 갱신), '계속하기' 버튼은 모두에게.
  - `'game:resuming'`: 일시정지 화면을 닫고 기존 `#countdown`으로 3·2·1을 `at`까지 보여 준다. 카운트다운 동안은 클릭 무시.
  - Esc/P: 멈춰 있으면 풀기 요청, 아니면 `canPause()`일 때 멈춤, 멀티에서 횟수가 0이면 `pushFeed`로 "남은 일시정지가 없어요".
- [ ] **Step 3: 타입 검사** — `npm run typecheck` → 오류 없음.

### Task 3: 도감 버튼을 위쪽 바로, 점수표는 도감 '규칙' 탭

**Files:**
- Modify: `client/index.html` (위쪽 바 `#codexTop`)
- Modify: `client/src/codex.ts` (`openCodex` 인자, `rules` 탭)
- Modify: `client/src/rulesUI.ts` (대기실의 `details.rules` 제거, `scoreTable` 그대로 내보냄)
- Modify: `client/src/main.ts` (버튼 연결, 보이기 조건)
- Modify: `client/src/icons.ts` (`UI.codex: BookOpen`, `UI.leave: LogOut`, `UI.close: X`)

**Interfaces:**
- Produces: `openCodex(host: HTMLElement, ctx: { rules: RoomRules; picks?: readonly Pick[] })`. 탭 순서: 증강·조합·저주·특별·아이템·보스·규칙. 규칙 탭 = `scoreTable(ctx.rules)`.
- `#codexTop`은 `.iconbtn`(책 아이콘 + "도감"). 게임이 진행 중일 때(`playing && !picking() && !pausedView && !roundOver`)만 숨긴다.

- [ ] **Step 1: 구현** — 위대로. `ctx.rules`는 방에 있으면 `rules`, 처음 화면이면 `DEFAULT_RULES`.
- [ ] **Step 2: 타입 검사** — `npm run typecheck` → 오류 없음.

### Task 4: 글자 링크를 아이콘 버튼으로

**Files:**
- Modify: `client/index.html` (`#codexBtn`, `#codexBtn2`, `#leaveBtn`, `#settingsClose`)
- Modify: `client/src/main.ts` (아이콘 채우기, `leaveBtn` 글자 바꾸는 곳은 `<span>`만)
- Modify: `client/src/style.css` (`.btnrow`, `.btn.ghost.small` 아이콘 정렬, `.btn.ghost.danger`, `.set-head .iconbtn.x`)

- [ ] **Step 1: 구현** — 처음 화면 `#codexBtn`: `btn ghost small` + 책 아이콘 + "도감". 대기실: `<div class="btnrow">` 안에 `#codexBtn2`(책 + "도감")·`#leaveBtn`(나가기 아이콘 + "방 나가기"/"처음으로", `danger`). `danger`는 테두리 `color-mix(in srgb, var(--red) 55%, var(--line))`, 글자 `var(--red)`. 설정 `#settingsClose`: ✕ 아이콘만, `aria-label="닫기"`.
- [ ] **Step 2: 빌드** — `npm run build` → 성공.

### Task 5: 상대 빌드 보기

**Files:**
- Modify: `client/src/arcadeUI.ts` (`buildCard`, `rivalsPanel`, `pickChips` 크기·배지)
- Modify: `client/src/main.ts` (점수판 칩 팝업)
- Modify: `client/src/results.ts` (순위 옆 빌드 타일)
- Modify: `client/src/style.css`

**Interfaces:**
- Produces:
  - `buildTiles(picks: readonly Pick[], size?: number): string` — 같은 증강 묶음(`groupPicks`), 타일 = 아이콘 + 이름 + `×N`, 등급 클래스(`t0`~`t3`), 레전드는 `★`, 특별 카드 `.sp`, 저주 `.cu`. `title` = 설명(합친 수치) + 레전드 효과(`LEGEND_TEXT`).
  - `buildCard(p: PlayerState, rank: number, meId: string): string` — 머리줄(모양·이름·`N등`·점수) + 완성 조합 금색 띠(`combosOf`) + `buildTiles`.
  - `rivalsPanel(players: readonly PlayerState[], meId: string): string` — 나를 뺀 사람을 점수 순으로 `buildCard`.
  - `pickChips(picks, size = 16)`에 특별 카드가 있으면 보석 배지, 완성 조합이 있으면 "조합 N" 배지.
- 점수판 팝업: `#chipPop`(본문 밖 고정 위치 요소). 칩을 누르면 그 사람 `buildCard`로 열고 같은 칩을 다시 누르거나 바깥을 누르면 닫힘. 마우스를 올리면 열고 벗어나면 닫힘(누른 상태가 아니면). `players`가 바뀔 때 열려 있으면 내용만 다시 그린다. 그 사람이 없어지거나 게임이 끝나면 닫는다.

- [ ] **Step 1: 구현** — 위대로. 증강 선택 화면은 `renderPick` 안 내 빌드 아래에 `rivalsPanel`.
- [ ] **Step 2: 빌드** — `npm run build` → 성공.

### Task 6: 활성 조합 표시

**Files:**
- Modify: `shared/src/arcade.ts` (`comboProgress` 정렬: 완성 먼저)
- Modify: `client/src/effectsUI.ts` (`renderComboBar`, `flashCombo`)
- Modify: `client/index.html` (`#comboBar`)
- Modify: `client/src/main.ts` (매 프레임 그리기, 발동 감지)
- Modify: `client/src/codex.ts` (조합 탭 진행도)
- Modify: `client/src/style.css`
- Test: `shared/test/combos.test.ts`

**Interfaces:**
- Produces:
  - `comboProgress(picks)` 결과를 완성(`have >= need`) 먼저, 그다음 `have/need`가 큰 순으로.
  - `renderComboBar(el: HTMLElement, p: PlayerState | undefined)` — 완성 조합마다 금색 칩 "이름 · 효과"(`COMBOS[].text`), 철옹성이면 이름 뒤에 남은 횟수 `ironLeft`. 게임이 진행 중이 아니면 비움. `pointer-events: none` (게임 영역을 가리지 않게, 설명은 칩 안 글자로).
  - `flashCombo(el: HTMLElement, id: ComboId)` — 그 칩에 `.flash` 클래스를 0.6초.
- 발동 감지(클라이언트, 내 것만): 철옹성 = `ironLeft` 감소, 견제왕 = 내가 견제(`steal`/`feverSteal`/`counter`, 폭죽 제외), 콤보 머신 = `comboBonus`, 피버 마스터 = 내 `feverStarted`, 행운아 = `jackpot > 1`, 미식가 = 노란 원 획득(`yellow`), 보스 헌터 = 내 보스 타격, 변두리 = 반짝임 없음.
- 위치: `#comboBar`는 `#buffs` 바로 위 가운데.
- 도감 조합 탭: `ctx.picks`가 있으면 줄마다 '완성' 또는 `have/need`.

- [ ] **Step 1: 테스트 (Task 7에서 실행)** — `combos.test.ts`의 `comboProgress` 기대값을 정렬 순서에 맞게 고치고, 완성 조합이 맨 앞에 오는 경우를 추가한다.

```ts
assert.deepEqual(comboProgress(picks('jackpot', 'preheat', 'overtime', 'frenzy', 'picky')).map((c) => c.id)[0], 'feverMaster');
```

- [ ] **Step 2: 구현** — 위대로.
- [ ] **Step 3: 빌드** — `npm run build` → 성공.

### Task 7: 테스트·확인·문서

- [ ] **Step 1: 전체 테스트** — `npm test` → 모두 통과 (Task 1·2·6의 테스트 포함, 처음엔 실패를 보고 원인을 고친다).
- [ ] **Step 2: 타입 검사·빌드** — `npm run typecheck && npm run build` → 성공.
- [ ] **Step 3: 화면 확인 (브라우저)** — 혼자 하기 아케이드와 두 탭 멀티 방에서:
  - 반대·감도 감소 아이템을 맞은 뒤 화면 네 구석까지 커서가 가는지, 캔버스 밖으로 마우스를 빼도 커서가 가장자리에 남는지.
  - 멀티에서 둘 다 멈추고 풀 수 있는지, "2/3" 표시, 30초 자동 재개, 3초 카운트다운.
  - 위쪽 도감 버튼과 규칙 탭, 아이콘 버튼, 상대 빌드 패널·칩 팝업·결과 타일, 조합 칩과 반짝임.
- [ ] **Step 4: 문서** — `README.md`(일시정지·커서 효과 설명이 있으면), `docs/ROADMAP.md`에 반영.
- [ ] **Step 5: 커밋 (목적별)**
  - `feat: 커서 효과를 위치 기준으로 (반대는 거울 위치, 감도 감소는 늦게 따라옴)`
  - `feat: 일시정지 사람마다 3번·30초 자동 재개·누구나 해제·3초 카운트다운`
  - `feat(client): 위쪽 바 도감 버튼과 규칙 탭`
  - `style(client): 글자 링크를 아이콘 버튼으로`
  - `feat(client): 상대 빌드 보기 (선택 화면 패널·점수판 팝업·결과)`
  - `feat(client): 활성 조합 표시와 발동 반짝임`
  - `test: …`, `docs: …`
- [ ] **Step 6: 최종 리뷰** — 브랜치 전체를 새 리뷰어(가장 좋은 모델)가 본 뒤 중요한 지적만 고친다.
