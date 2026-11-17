# 튜토리얼 멈춤 설명 · 도감 기본 점수 · 대기실 점수표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 튜토리얼을 "판이 멈춤 → 짚은 동작 하나만 받음 → 설명 → (필요하면) 자유 연습" 장면 흐름으로 바꾸고, 도감 점수표를 기본 규칙 기준으로, 대기실에 이 방 점수표를 둔다.

**Architecture:** 단계마다 장면(beat) 목록을 데이터로 두고(`server/src/tutorial.ts`), 튜토리얼 방(`room.ts`)이 장면을 하나씩 진행한다. 멈춤은 협력전 투표가 쓰는 조용한 멈춤(`pausedAt` + `game:pause { by: '' }`)을 그대로 쓰고, 풀 때는 카운트다운 없이 `finishResume()`. 화면(`client/src/tutorial.ts`)은 장면 id로 문구를 찾아 짚기 표시·설명 카드를 그리고, 멈춘 동안 맞는 클릭만 서버로 보낸다.

**Tech Stack:** TypeScript, Socket.IO, Vite, `node:test` (`npm test` = `node --import tsx --test "shared/test/**/*.test.ts"`)

**Spec:** `docs/superpowers/specs/2026-11-17-tutorial-guided-design.md`

## Global Constraints

- 규칙·수치는 `shared/src/rules.ts`의 `RULES`에서만 (`RULES.tutorial`).
- 튜토리얼 문구에 점수·배율 숫자를 쓰지 않는다. 숫자를 보여 줄 때는 그 판에서 실제로 받은 값만(콤보 카드).
- 멈춘 장면에서 받을 동작이 아닌 클릭은 서버에서 아무 처리도 하지 않는다(헛클릭·헛손질 보정·넓은 손·자석 모두 건너뜀). 화면도 클릭 효과·소리 없음.
- 멈춤이 풀릴 때 일시정지 창·카운트다운이 없다.
- 커밋: `CONTRIBUTING.md` Conventional Commits, 한국어 요약, 한 커밋 한 목적. 작성자 `Kim Wan ho`. 커밋 전에 `npm run typecheck`, `npm run build` 통과. `main`에 푸시하지 않는다(푸시 = 배포, 사용자가 따로 정함).

## Review Focus

1. **멈춘 채 탭을 떠남** — 혼자 하기 자동 일시정지(`visibilitychange`)가 멈춤 장면과 겹쳐도, 돌아오면 같은 장면이 그대로이고 일시정지 창이 뜨지 않아야 한다. 서버 `pause()`는 `pausedAt`이 이미 있으면 무시하므로 장면이 유지된다 → Task 2 테스트 `멈춤 장면 중 일시정지 요청은 무시`.
2. **짚은 원을 멈추기 전에 누름** — 원이 나오고 600ms 안에 짚은 원을 누르면 그대로 받아 다음 장면, 다른 클릭은 무시 → Task 2 테스트 `짚기 대기 중에도 다른 클릭은 무시, 대상 원 클릭은 받음`.
3. **카드를 빠르게 두 번 넘김** — `tutorial:next`가 연달아 와도 카드 장면 하나만 넘어간다(지금 장면이 카드일 때만 받음) → Task 2 테스트 `tutorial:next는 카드 장면에서만, 한 번에 한 장면`.
4. **멈춘 동안 시각이 흐름** — 피버 카드 동안 피버 끝 시각, 견제 카드 동안 표적 끝 시각이 줄지 않아야 반격·피버 실습이 된다 → Task 2 테스트 `카드 동안 피버·표적 시간이 멈춤`.
5. **다시 접속** — 멈춤 장면 중 새로고침하면 같은 장면과 짚은 원을 다시 받고, 판은 멈춘 채 → Task 2 테스트 `다시 접속하면 지금 장면을 다시 받음`.

---

## File Structure

| 파일 | 맡는 일 |
|---|---|
| `shared/src/rules.ts` | `RULES.tutorial` 새 값, `TutorialStep` 타입 |
| `shared/src/protocol.ts` | `TutorialBeatInfo`, `tutorial:beat`(서버→화면), `tutorial:next`(화면→서버) |
| `server/src/tutorial.ts` | 장면 목록(데이터)과 순수 판단: 장면 찾기, 자유 연습 끝 판정, 원 종류 |
| `server/src/room.ts` | 장면 진행, 조용한 멈춤/풀기, 짚은 원 만들기, 봇 견제, 멈춤 중 클릭 거르기 |
| `server/src/index.ts` | `tutorial:next` 소켓 연결 |
| `client/src/tutorial.ts` | 장면 문구 표, 짚기 표시·설명 카드·띠 |
| `client/src/render.ts` | 짚기 표시(어둡게 덮고 대상만 뚫기) |
| `client/src/main.ts` | 멈춤 중 클릭 처리, Esc 나가기, 대기실 점수표 버튼 |
| `client/src/codex.ts` | 규칙 탭을 기본 규칙으로 |
| `client/index.html`, `client/src/style.css` | 대기실 버튼, 카드·짚기 말풍선 모양 |
| `shared/test/tutorial.test.ts` | 다시 씀 |
| `shared/test/codex.test.ts` | 새로 |

---

### Task 1: 장면 데이터와 순수 판단

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.tutorial`, 248행 근처)
- Modify: `shared/src/protocol.ts`
- Modify: `server/src/tutorial.ts` (다시 씀)
- Test: `shared/test/tutorial.test.ts` (이 Task에서는 맨 위 순수 함수 테스트만 새로 씀. 방 테스트는 Task 2에서 다시 씀. 기존 방 테스트는 이 Task에서 지운다)

**Interfaces:**
- Produces (`shared/src/rules.ts`):
  ```ts
  tutorial: {
    steps: ['own', 'combo', 'steal', 'fever', 'zones'],
    comboStart: 9, feverStart: 99, focusDelayMs: 600, botCombo: 5, nextMs: 1000,
    zoneGoal: 3,
    /** 자유 연습 장면의 원 생성 (단계별) */
    spawn: { steal: { gapMs: 700, max: 5, speed: 0.7 }, fever: { gapMs: 450, max: 7, speed: 0.7 }, zones: { gapMs: 500, max: 6, speed: 0.7 } },
  }
  ```
  `goal`·`own`/`combo` 생성 설정은 지운다. `TutorialStep`은 `steps`에서 그대로 만든다.
- Produces (`shared/src/protocol.ts`):
  ```ts
  export type TutorialBeatKind = 'focus' | 'card' | 'free';
  export interface TutorialBeatInfo {
    step: TutorialStep; beat: string; kind: TutorialBeatKind;
    accept?: 'circle' | 'empty'; circleId?: number;
    /** 카드가 짚는 곳 */ point?: 'me' | 'bot' | 'gauge' | 'zones';
    /** 멈춘 서버 시각 (멈춤 장면일 때) */ at?: number;
    /** 자유 연습 진행 */ count?: number; goal?: number;
  }
  ```
  `ServerToClient`에 `'tutorial:beat': (d: TutorialBeatInfo) => void`, `ClientToServer`에 `'tutorial:next': () => void`. `TutorialStatus`(`tutorial:step`)는 단계·완료 알림으로 남기되 `count`/`goal`은 지운다.
- Produces (`server/src/tutorial.ts`):
  ```ts
  export type Beat =
    | { id: string; kind: 'focus'; accept: 'circle'; spawn: 'me' | 'yellow' | 'bot'; edge?: boolean; prep?: { combo?: number; fever?: number } }
    | { id: string; kind: 'focus'; accept: 'empty' }
    | { id: string; kind: 'card'; point?: 'me' | 'bot' | 'gauge' | 'zones' }
    | { id: string; kind: 'free'; until: 'markEnd' | 'feverEnd' | 'zoneCatch' }
    | { id: string; kind: 'botSteal' };
  export const BEATS: Record<TutorialStep, readonly Beat[]>;
  export function freeKinds(step: TutorialStep, me: PlayerState, bot: PlayerState | null): CircleKind[];
  export function freeDone(b: Extract<Beat, { kind: 'free' }>, me: PlayerState, now: number, zoneCatches: number): boolean;
  export function enterStep(step: TutorialStep, me: PlayerState): void;
  ```
  - `BEATS` 내용(id 그대로 화면 문구 키가 됨), 스펙 2절 순서:
    - own: `own.mine`(focus me) → `own.mineCard`(card) → `own.yellow`(focus yellow) → `own.yellowCard`(card)
    - combo: `combo.intro`(card, point me) → `combo.ten`(focus me) → `combo.tenCard`(card) → `combo.empty`(focus empty) → `combo.emptyCard`(card)
    - steal: `steal.intro`(card) → `steal.do`(focus bot) → `steal.doCard`(card, point me) → `steal.wait`(free markEnd) → `steal.bot`(botSteal) → `steal.botCard`(card, point bot) → `steal.counter`(focus bot) → `steal.sumCard`(card)
    - fever: `fever.intro`(card, point gauge) → `fever.go`(focus me, prep `{ fever: RULES.tutorial.feverStart }`) → `fever.onCard`(card) → `fever.play`(free feverEnd)
    - zones: `zones.intro`(card, point zones) → `zones.edge`(focus me, edge) → `zones.play`(free zoneCatch)
  - `enterStep`: `combo`면 `me.combo = RULES.tutorial.comboStart`, 그 밖에는 `me.combo = 0`. 피버는 끈다(`feverUntil = 0`, `fever = 0`).
  - `freeDone`: `markEnd` → `me.markedUntil <= now`, `feverEnd` → `!isFever(me, now)`, `zoneCatch` → `zoneCatches >= RULES.tutorial.zoneGoal`.
  - `freeKinds`: steal `[me.color]`, fever `[me.color, 'y', bot.color]`(봇 없으면 앞 둘), zones `[me.color]`.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/tutorial.test.ts` 맨 위, 기존 방 테스트는 지움)

```ts
test('단계 순서와 장면 목록', () => {
  assert.deepEqual(RULES.tutorial.steps, ['own', 'combo', 'steal', 'fever', 'zones']);
  assert.deepEqual(BEATS.own.map((b) => b.kind), ['focus', 'card', 'focus', 'card']);
  assert.deepEqual(BEATS.combo.map((b) => b.id), ['combo.intro', 'combo.ten', 'combo.tenCard', 'combo.empty', 'combo.emptyCard']);
  assert.equal((BEATS.combo[3] as { accept: string }).accept, 'empty');
  assert.ok(BEATS.steal.some((b) => b.kind === 'botSteal'));
  const go = BEATS.fever.find((b) => b.id === 'fever.go') as { prep?: { fever?: number } };
  assert.equal(go.prep?.fever, 99);
  const ids = Object.values(BEATS).flat().map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, '장면 id는 겹치지 않음');
});

test('단계 시작: 콤보 단계는 콤보 9, 그 밖은 0, 피버는 꺼짐', () => {
  const me = newPlayer('a', 'A', 0);
  me.combo = 3; me.fever = 50; me.feverUntil = Date.now() + 5000;
  enterStep('combo', me);
  assert.deepEqual([me.combo, me.fever, me.feverUntil], [9, 0, 0]);
  enterStep('steal', me);
  assert.equal(me.combo, 0);
});

test('자유 연습 끝 판정', () => {
  const me = newPlayer('a', 'A', 0), now = 10_000;
  me.markedUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), false);
  me.markedUntil = now;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'markEnd' }, me, now, 0), true);
  me.feverUntil = now + 1;
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'feverEnd' }, me, now, 0), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 2), false);
  assert.equal(freeDone({ id: 'x', kind: 'free', until: 'zoneCatch' }, me, now, 3), true);
});

test('자유 연습 원 종류', () => {
  const me = newPlayer('a', 'A', 0), bot = newPlayer('b', 'B', 2, true);
  assert.deepEqual(freeKinds('steal', me, bot), [0]);
  assert.deepEqual(freeKinds('fever', me, bot), [0, 'y', 2]);
  assert.deepEqual(freeKinds('zones', me, null), [0]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: `tutorial.test.ts`가 `BEATS`·`freeDone` 없음으로 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 그대로. `room.ts`가 옛 함수(`progress`, `spawnKinds`, `goal`)를 쓰므로 타입 오류가 난다: 이 Task에서는 `room.ts`의 튜토리얼 부분을 컴파일되는 최소한으로만 맞춘다(옛 진행 판정 호출 제거, 원 생성은 `freeKinds`). 실제 진행은 Task 2.
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 새 4개 PASS, 다른 테스트 파일 전부 PASS. `npm run typecheck` 통과
- [ ] **Step 5: 커밋** — `feat(shared): 튜토리얼 장면 목록과 판정 함수 (단계 순서 원 잡기·콤보·견제·피버·점수 구역)`

---

### Task 2: 튜토리얼 방의 장면 진행과 멈춤

**Files:**
- Modify: `server/src/room.ts` (튜토리얼 부분 150~262행, `click` 626행, `join`의 튜토리얼 재전송, `finishResume` 551행)
- Modify: `server/src/index.ts` (`game:resume` 옆 130행에 `tutorial:next`)
- Test: `shared/test/tutorial.test.ts` (방 테스트 다시 씀, 기존 `tutorialRoom`·`slowAt`·`grab` 도우미는 살려 쓴다)

**Interfaces:**
- Consumes: Task 1의 `BEATS`, `freeKinds`, `freeDone`, `enterStep`, `TutorialBeatInfo`.
- Produces:
  - `Room.tutorialNext(id: string): void` — 튜토리얼 방이고 지금 장면이 `card`일 때만 다음 장면.
  - `tut` 상태: `{ i: number; b: number; done: boolean; target: number | null; heldAt: number; spawnedAt: number; zoneCatches: number; timer: Timeout | null }` (`i` 단계, `b` 장면 번호, `target` 짚은 원 id, `heldAt` 멈춘 시각(0이면 안 멈춤)).
  - 이벤트: 장면이 바뀌거나 멈출 때 `tutorial:beat`(멈춘 장면이면 `at` 포함). 단계가 바뀔 때 `tutorial:step`, 마지막 뒤 `tutorial:step { done: true }`.

**동작 (구현 메모)**
- 장면 시작 `startBeat()`: `prep` 적용 → 종류별
  - `focus` + `accept: 'circle'`: 대상 원 하나를 `forceKind`로 만들어 `target`에 둠(`edge`면 가장자리 구역에 닿을 때까지, 아니면 `focusDelayMs` 뒤 멈춤 — `tickTutorial`에서 확인). 그동안 다른 원 생성 없음.
  - `focus` + `accept: 'empty'`, `card`: 바로 멈춤.
  - `free`: 멈추지 않음. `tickTutorial`이 `RULES.tutorial.spawn[step]`으로 원을 만들고, 매 틱 `freeDone`이면 다음 장면.
  - `botSteal`: 내 색 원 하나를 만들고 `focusDelayMs` 뒤 봇이 `claim(bot, c, now, 'click')`. 끝나면 다음 장면.
- 멈추기 `holdBeat(now)`: 협력전 `pauseForVote`와 같은 조용한 멈춤(`pausedAt`, `pausedBy = null`, `game:pause { by: '', until: 0, at }`). 이 둘이 같은 코드가 되도록 `pauseForVote` 본문을 `private silentPause(now: number)`로 떼어 함께 쓴다.
- 풀기: `finishResume()`(카운트다운 없음). 다음 장면이 곧바로 멈추는 장면(card·empty)이면 풀지 않고 멈춘 채 장면만 바꾼다.
- `click()`: 맨 앞(`tut.done` 확인 다음, `pausedAt` 확인 전)에서 튜토리얼이고 지금 장면이 `free`가 아니면 `holdClick(p, d)`로 보낸다.
  - `card`: 무시.
  - `focus circle`: `d.circleId === target`이고 `pausedAt`(멈췄으면) 또는 지금 시각 기준으로 맞았을 때만 → (멈춰 있으면) `finishResume()` → 평소 판정(`claim`) → 다음 장면. 아니면 아무것도 안 함(`rejectTo`도 안 보냄).
  - `focus empty`: `d.circleId === null`이고 그 자리에 원이 없을 때만 → `me.combo = 0`, `emitPlayers()` → 다음 장면. 아니면 무시.
- `free` 장면의 헛클릭은 지금처럼 콤보만 끊김. `zoneCatch` 장면은 `claim` 뒤 그 원의 구역이 `0`이 아니면 `zoneCatches++`.
- 견제 단계에 들어갈 때 봇을 넣는 기존 코드(`advanceTutorial`)는 그대로. 봇은 `think`를 하지 않는다.
- `join` 재접속: `tutorial:step`과 함께 지금 `tutorial:beat`(멈춰 있으면 `at`, 짚은 원 id 포함)를 다시 보낸다.
- 단계 마지막 장면이 끝나면 `nextMs` 뒤 다음 단계(판 비움, `enterStep`), 마지막 단계 뒤 `done`. 멈춘 동안에는 타이머를 미루는 기존 처리를 유지.

- [ ] **Step 1: 실패하는 테스트 작성** — 아래 이름과 단언으로. 도우미 `beats()` = 로그의 `tutorial:beat` 목록, `clickAt(x, y, circleId)` = `clickLog` 비우고 `room.click`.

| 테스트 | 단언 |
|---|---|
| `시작하면 원 잡기 첫 장면, 대상 원 하나만 나오고 600ms 뒤 멈춤` | 첫 `tutorial:beat`이 `{ step: 'own', beat: 'own.mine', kind: 'focus', accept: 'circle' }`, `circles.size === 1`이고 그 원 종류가 내 색. `focusDelayMs` 뒤 `tick()` → `pausedAt > 0`, 마지막 `game:pause`의 `by === ''` |
| `멈춘 짚기 장면: 빈 곳·다른 원 클릭은 아무 일 없음` | 다른 내 색 원을 하나 더 넣고 그 원과 빈 곳을 클릭 → `me.score`·`me.combo`·`me.fever`·`circles.size` 그대로, `click:rejected`·`game:resuming` 로그 없음 |
| `짚은 원을 누르면 잡히고 다시 움직이고 다음 장면(카드)` | 클릭 뒤 `me.score > 0`, `tutorial:beat`의 `beat === 'own.mineCard'`, `kind === 'card'`, `pausedAt > 0`(카드라 멈춘 채) |
| `짚기 대기 중에도 다른 클릭은 무시, 대상 원 클릭은 받음` | 멈추기 전(600ms 안) 빈 곳 클릭 → 콤보 그대로, 대상 원 클릭 → 잡힘·다음 장면 |
| `tutorial:next는 카드 장면에서만, 한 번에 한 장면` | 짚기 장면에서 `tutorialNext` → 장면 그대로. 카드에서 두 번 연달아 → 장면 번호가 1만 오름 |
| `콤보 단계: 콤보 9에서 시작, 짚은 원으로 10이 되며 콤보 보너스` | 콤보 단계 첫 장면에서 `me.combo === 9`, `combo.ten` 클릭 뒤 `me.combo === 10`, 받은 점수(로그의 claim 결과)에 `comboBonus > 0` |
| `빈 곳 짚기: 원 클릭은 무시, 빈 곳 클릭은 콤보 0` | `combo.empty`에서 원 위 클릭 → 콤보 그대로, 빈 곳 → `me.combo === 0`, 다음 장면 `combo.emptyCard` |
| `견제 단계: 봇 원 견제 → 내가 표적, 표적이 풀리면 봇이 내 원을 가져가 봇이 표적, 봇 원을 잡으면 반격` | `steal.do` 클릭 뒤 `me.markedUntil > now`, 봇 콤보 0. `steal.wait`에서 시각을 표적 끝 뒤로 → `steal.bot`. `focusDelayMs` 뒤 `me.combo === 0`, `bot.markedUntil > now`, 장면 `steal.botCard`. `steal.counter` 클릭 결과 `type === 'counter'` |
| `카드 동안 피버·표적 시간이 멈춤` | 피버 시작 직후 `fever.onCard`에서 `feverUntil` 기록 → 시계를 5초 넘기고 `tutorialNext` → `feverUntil`이 5초 밀림 |
| `피버 단계: 게이지 99에서 짚은 원 하나로 피버, 피버가 끝나면 다음 단계` | `fever.go` 시작 때 `me.fever === 99`, 클릭 뒤 `isFever(me, now)`, 장면 `fever.onCard`. `fever.play`에서 피버 끝 뒤 `tick()` → 다음 단계 `zones` |
| `점수 구역: 가장자리에서 멈추고, 사이·가장자리에서 3개 잡으면 완료` | `zones.edge`가 멈출 때 대상 원 `zoneOf(circlePos(c, pausedAt)) === 2`. `zones.play`에서 가운데 원 1개 + 바깥 원 3개 → 마지막 `tutorial:step`의 `done === true`, `game:over` 없음 |
| `멈춤 장면 중 일시정지 요청은 무시` | 카드 장면에서 `room.pause(me.id)` → `game:pause`가 `by: ''` 말고는 새로 없음, 장면 그대로 |
| `다시 접속하면 지금 장면을 다시 받음` | 짚기로 멈춘 중 `room.join('s2', 'k1', 'A')` → 마지막 `tutorial:beat`이 같은 `beat`, `circleId`, `at` |
| `나가면 단계 타이머가 정리됨` | 기존 테스트 유지 |

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: 위 방 테스트 FAIL
- [ ] **Step 3: 구현** — 위 '동작' 그대로. `index.ts`: `socket.on('tutorial:next', () => { const s = here(); if (s) s.room.tutorialNext(s.id); })`
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전부 PASS (`coop.test.ts`의 투표 멈춤 테스트 포함 — `silentPause`로 뗀 뒤에도 그대로)
- [ ] **Step 5: 커밋** — `feat(server): 튜토리얼 장면 진행 (조용한 멈춤, 짚은 동작만 받기, 봇 견제 장면)`

---

### Task 3: 튜토리얼 화면 (짚기·카드·Esc 나가기)

**Files:**
- Modify: `client/src/tutorial.ts`, `client/src/render.ts`, `client/src/main.ts`, `client/src/style.css`
- Test: `shared/test/tutorial.test.ts` (문구 표 테스트 하나)

**Interfaces:**
- Consumes: Task 1 `BEATS`(id 목록 확인용), `TutorialBeatInfo`; Task 2 이벤트 `tutorial:beat`, `tutorial:next`.
- Produces:
  - `export const BEAT_TEXT: Record<string, string>` — 장면 id → 한두 줄 문구(스펙 2절 문구, 숫자 없음). `combo.tenCard`는 `{base}`, `{bonus}` 자리 표시를 두고 화면이 실제 받은 값으로 채운다.
  - `export function showBeat(d: TutorialBeatInfo, h: { onNext: () => void; onSkip: () => void; lastGain: { base: number; bonus: number } | null }): void`
  - `export function holdAccepts(d: TutorialBeatInfo | null, hitId: number | null): 'send' | 'hint' | 'pass'` — 멈춤 중 클릭 처리: 짚기 장면에서 맞는 대상이면 `'send'`, 아니면 `'hint'`(깜빡임만), 자유 연습·장면 없음이면 `'pass'`(평소 처리), 카드면 `'hint'`.
  - `renderer.spotlight(s: { x: number; y: number; r: number } | null)` — 판을 어둡게 덮고 원 자리만 뚫는다(`null`이면 끔). `accept: 'empty'`는 뚫지 않고 말풍선만.
- 화면 동작
  - 짚기: 대상 원 위치(멈춘 시각 `d.at` 기준 `circlePos`)에 `spotlight` + 말풍선. `hint`면 짚은 곳 깜빡임 한 번.
  - 카드: `#stage` 가운데 카드, 카드 클릭·[계속]·Enter·Space → `onNext`(= `socket.emit('tutorial:next')`). `point`가 `me`/`bot`이면 점수판 그 칩에 화살표, `gauge`면 피버 게이지, `zones`면 `guideArt`의 `zones` 그림을 카드에 넣는다.
  - 띠: 단계 이름(`1/5 원 잡기`)과 [건너뛰기]. 자유 연습이면 `count/goal`.
  - `main.ts` `pointerdown`: `pausedView` 때문에 돌아가기 전에, 튜토리얼이면 `holdAccepts`로 판단해 `'send'`면 `game:click` 전송(빈 곳은 `circleId: null`), `'hint'`면 효과·소리 없이 끝.
  - `lastGain`: 내 원 획득 이벤트 처리(main.ts 816~820행 근처)에서 받은 점수와 `comboBonus`를 기억해 둔다.
  - 키: 튜토리얼이면 Esc → `askLeave()`(제목 "연습을 그만할까요?"), P → 아무것도 안 함.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('튜토리얼 문구: 모든 장면에 문구가 있고 숫자를 쓰지 않음 (콤보 카드의 자리 표시만)', () => {
  for (const b of Object.values(BEATS).flat()) {
    if (b.kind === 'botSteal') continue; // 봇 견제는 문구 없이 바로 다음 카드
    const t = BEAT_TEXT[b.id];
    assert.ok(t, b.id);
    assert.ok(!/\d/.test(t.replace(/\{base\}|\{bonus\}/g, '')), `${b.id}: ${t}`);
  }
});

test('멈춤 중 클릭 판단', () => {
  const focus = { step: 'own', beat: 'own.mine', kind: 'focus', accept: 'circle', circleId: 7 } as const;
  assert.equal(holdAccepts(focus, 7), 'send');
  assert.equal(holdAccepts(focus, 8), 'hint');
  assert.equal(holdAccepts(focus, null), 'hint');
  const empty = { step: 'combo', beat: 'combo.empty', kind: 'focus', accept: 'empty' } as const;
  assert.equal(holdAccepts(empty, null), 'send');
  assert.equal(holdAccepts(empty, 3), 'hint');
  assert.equal(holdAccepts({ step: 'own', beat: 'own.mineCard', kind: 'card' }, 7), 'hint');
  assert.equal(holdAccepts({ step: 'zones', beat: 'zones.play', kind: 'free' }, 7), 'pass');
  assert.equal(holdAccepts(null, 7), 'pass');
});
```

(`client/src/tutorial.ts`는 DOM을 함수 안에서만 만지므로 `guide.test.ts`처럼 불러올 수 있다. `BEAT_TEXT`·`holdAccepts`는 DOM을 쓰지 않게.)

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: 두 테스트 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces와 화면 동작대로
- [ ] **Step 4: 통과 확인** — Run: `npm test`, `npm run typecheck`, `npm run build` / Expected: 전부 통과
- [ ] **Step 5: 미리보기로 끝까지 해 보기** — 서버(3001)와 화면(5173)을 따로 띄워([ROADMAP '이어서 작업할 때 알아 둘 것'](../../ROADMAP.md) 참고) [연습하기] → 다섯 단계 완료. 확인: 멈춘 짚기에서 빈 곳·다른 원을 눌러도 콤보·점수 그대로이고 소리 없음 / 콤보 카드의 두 숫자가 방금 뜬 점수와 같음 / 견제 단계에서 봇이 내 원을 가져가는 장면 / 피버 카드 뒤 피버가 이어짐 / Esc → 확인 창 → 나가기 / 다른 탭에 갔다 오기 / 완료 화면 두 버튼
- [ ] **Step 6: 커밋** — `feat(client): 튜토리얼 짚기 표시·설명 카드, 멈춤 중 맞는 클릭만 보내기, Esc 나가기`

---

### Task 4: 도감 기본 규칙 점수 · 대기실 점수표

**Files:**
- Modify: `client/src/codex.ts` (`rulesTab` 68~70행)
- Modify: `client/src/main.ts` (`renderLobby` 331행 근처), `client/index.html` (79행 `rulesBox` 근처), `client/src/style.css`
- Test: `shared/test/codex.test.ts` (새로)

**Interfaces:**
- Produces: `export function rulesTabHTML(): string` (`codex.ts`) — 늘 `scoreTable(DEFAULT_RULES)`. 안내 문구는 스펙 5절 그대로: "기본 규칙 기준이에요. 방 규칙과 증강에 따라 달라질 수 있어요. 이 방의 점수는 대기실에서 볼 수 있어요"
- 대기실: `#rulesBox` 아래 `<button class="btn ghost small" id="scoreBtn">이 방 점수표</button>`. 누르면 `#scorePop`에 `scoreTable(room.rules)`. `renderLobby`가 돌 때 `#scorePop`이 열려 있으면 다시 채운다(방장이 규칙을 바꾸면 바로 반영). 바깥 클릭·Esc로 닫힘.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('도감 규칙 탭: 방 규칙과 상관없이 기본 규칙 숫자와 안내', () => {
  const h = rulesTabHTML();
  assert.ok(h.includes(`피버 중 (×${DEFAULT_RULES.feverMult}, ${DEFAULT_RULES.feverSec}초)`));
  assert.ok(h.includes('방 규칙과 증강에 따라 달라질 수 있어요'));
  assert.ok(!h.includes('×5,'));
});
```

(`rulesTab(ctx)`가 `rulesTabHTML()`을 부르게 바꾸면 `ctx.rules`를 쓰는 곳이 없어진다. `CodexCtx.rules`는 다른 탭이 쓰지 않으면 지운다.)

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: `rulesTabHTML` 없음으로 FAIL
- [ ] **Step 3: 구현** — 위대로
- [ ] **Step 4: 통과 확인** — Run: `npm test`, `npm run typecheck`, `npm run build` / Expected: 통과. 미리보기: 파티 프리셋 방 대기실에서 [이 방 점수표]가 ×5, 도감 규칙 탭은 ×3, 프리셋을 기본으로 바꾸면 열린 점수표가 ×3으로 바뀜
- [ ] **Step 5: 커밋** — `feat(client): 도감 점수표는 기본 규칙 기준, 대기실에 이 방 점수표`

---

### Task 5: 문서

**Files:**
- Modify: `README.md` (튜토리얼 설명), `docs/ROADMAP.md` ('다음 작업' 표에 이번 작업 ✅ 한 줄), `CHANGELOG.md` (`## [미출시]`에 `### 기능` 두 줄)

- [ ] **Step 1: 고치기** — CHANGELOG 기능: "튜토리얼: 판이 멈추고 짚은 원(또는 빈 곳)만 눌러 보는 단계별 설명, 원 잡기 → 콤보 → 견제 → 피버 → 점수 구역. Esc로 나가기", "도감 점수표는 기본 규칙 기준, 대기실에서 이 방 점수표". README·ROADMAP은 같은 내용을 각 문서 말투로.
- [ ] **Step 2: 확인** — Run: `npm run typecheck`, `npm run build` / Expected: 통과
- [ ] **Step 3: 커밋** — `docs: 튜토리얼 멈춤 설명·도감 점수표 반영` (설계·계획 문서도 아직 커밋 전이면 함께)
