# 게임 중 나가기 · 게임 방법 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 중 나가기 버튼과 확인 창을 만들고, 나간 자리는 봇이 이어받게 하며, 처음 화면·대기실에 "게임 방법" 창(첫 접속 때 한 번 자동)을 만든다.

**Architecture:**
- **서버:** `Room.leave`가 게임 중이면 그 PlayerState를 그대로 봇으로 바꾼다(`bot = true`, 이름 "(봇)", `bots`에 `Bot` 추가). 그래서 점수·증강·상태가 이어진다.
- **클라이언트:**
  - 공용 확인 창(`confirm.ts`)을 만든다.
  - 게임 방법 창(`guide.ts`)은 도감 창 모양을 따르고, 내용 HTML은 DOM 없이 만드는 순수 함수로 둬서 테스트한다.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-09-leave-and-guide-design.md`

## Global Constraints

- 화면 문구는 한국어. 숫자는 `RULES`·방 규칙(`RoomRules`)에서 가져온다.
- 커밋은 Conventional Commits(`<타입>(<범위>): <한국어 요약>`), 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에(사용자 지시). 각 Task의 테스트는 Task 4에서 쓰고 실행하고, 커밋도 Task 4에서 Task별 스냅샷으로 나눈다.
- 브라우저 저장소(`localStorage`) 읽기·쓰기는 try/catch로 감싼다.
- `main` 병합·푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. 라운드 시작 카운트다운 중, "라운드 종료!" 연출 중(증강 선택 직전)에 나가도 봇이 이어받고 게임이 멈추지 않아야 한다. → Task 1 테스트
2. 나가기를 두 번 누르거나(빠른 연속 클릭), 나간 뒤 소켓 끊김 이벤트가 또 와도 두 번 바뀌거나 오류가 나면 안 된다. → Task 1 테스트
3. 나간 사람이 같은 키로 다시 들어오려 하면 그 자리를 되찾지 못해야 한다("이미 게임이 진행 중"). → Task 1 테스트
4. 사람 1명 + 봇 3명 방에서 그 사람이 나가면 봇끼리 계속하지 않고 방이 끝나야 한다. → Task 1 테스트
5. `localStorage`가 막힌 환경(시크릿 창 등)에서 게임 방법 자동 표시가 오류 없이 넘어가야 한다. → Task 3 (브라우저 확인)

---

### Task 1: 서버 — 게임 중 나가면 봇이 이어받기

**Files:**
- Modify: `server/src/room.ts` (`leave`, 새 `takeOver`, `autoPick`, `finishPick`)
- Modify: `shared/src/protocol.ts` (`'player:left'`)

**Interfaces:**
- Produces:
  - `'player:left': (d: { id: string; name: string }) => void` — name은 원래 이름
  - `Room.leave(playerId, socketId)`
    - 로비: 지금처럼 `remove`
    - 게임 중 + 혼자 하기: `remove(playerId)` (사람이 없으니 방 종료)
    - 게임 중 + 여럿: `takeOver(p)`
  - `private takeOver(p: PlayerState)`
    - 이미 봇이면 무시
    - 상태 바꾸기: `p.bot = true`, `p.connected = true`, `p.name = \`${원래 이름} (봇)\``, `this.bots.set(p.id, new Bot(this.botLevel))`
    - 정리: `keyToId`·`socketOf`·`cursors`·`pulls`(그 사람이 끌던 원) 지우기
    - 일시정지를 건 사람이었으면(`pausedBy === p.id && pausedAt && !resumeAt`) `beginResume()`
    - 증강 선택 중이고 그 사람 선택이 안 끝났으면 `autoPick(p.id)`, 모두 골랐으면 `finishPick()`
    - 나머지: `passHostIfNeeded`, `checkEmpty`, `'player:left'` 보내기, `broadcastState`, `emitPlayers`
  - `private autoPick(id: string)` — `finishPick`의 "남은 수만큼 무작위" 부분을 이 함수로 빼서 둘이 같이 쓴다.
  - 봇 끼리만 남는 경우는 `checkEmpty`가 지금처럼 방을 끝낸다(사람 접속 0명).

- [ ] **Step 1: 구현** — 위대로.
- [ ] **Step 2: 타입 검사·빌드** — `npm run typecheck && npm run build` → 성공.
- [ ] **Step 3: 테스트 (Task 4에서 실행)** — `shared/test/room.test.ts`

```ts
test('게임 중 나가면 그 자리를 봇이 이어받음: 점수·증강 유지, 이름 (봇), 알림', () => {});
test('증강 고르는 중에 나가면 바로 무작위로 고르고, 모두 골랐으면 다음 라운드', () => {});
test('일시정지를 건 사람이 나가면 다시 시작 카운트다운', () => {});
test('혼자 하기에서 나가면 방이 끝남, 사람이 모두 나가면 방이 끝남(봇끼리 안 함)', () => {});
test('연결 끊김은 봇이 되지 않고 다시 들어올 수 있음', () => {});
test('나간 사람은 같은 키로 자리를 되찾지 못함', () => { /* Review Focus 3 */ });
test('나가기를 두 번·나간 뒤 끊김이 와도 한 번만 바뀜', () => { /* Review Focus 2 */ });
test('시작 카운트다운 중·라운드 종료 연출 중에 나가도 이어받음', () => { /* Review Focus 1 */ });
```

### Task 2: 클라이언트 — 나가기 버튼과 확인 창

**Files:**
- Create: `client/src/confirm.ts`
- Modify: `client/index.html` (위쪽 바 `#leaveTop`, 일시정지 화면 `#pauseLeaveBtn`)
- Modify: `client/src/main.ts`, `client/src/style.css`

**Interfaces:**
- Consumes: `'player:left'`(Task 1)
- Produces:
  - `export function confirmDialog(host: HTMLElement, o: { title: string; text: string; ok: string; cancel: string }): Promise<boolean>` — 도감과 같은 overlay·card 모양. Esc·바깥 클릭·[취소]는 false. 이미 열려 있으면 그 창을 닫고 새로 연다.
  - `#leaveTop`
    - `iconbtn`, 아이콘은 `UI.leave`, `aria-label="게임 나가기"`
    - 게임 중(`playing`)에만 보이고, 위치는 `#codexTop` 옆
  - `#pauseLeaveBtn`: `btn ghost`, "게임 나가기"
  - 누르면 `confirmDialog`가 떠요.
    - 제목: "게임에서 나갈까요?"
    - 본문: 혼자 하기면 "게임이 끝나요.", 아니면 "봇이 이어서 플레이하고, 다시 들어올 수 없어요."
    - 버튼: ok "나가기", cancel "계속하기"
    - [나가기]를 고르면 대기실 '방 나가기'와 같은 처리를 해요(`socket.emit('room:leave')`, `store('cb-room', null)`, `resetToHome()`).
  - `socket.on('player:left', ({ name }) => pushFeed($('feed'), icon(UI.leave, 18), \`${name}님이 나갔어요. 봇이 이어받아요.\`, '#9ca2d6'))`
  - 확인 창이 떠 있는 동안 게임 클릭은 막힌다(overlay가 가림). 일시정지는 걸지 않는다(여럿이 하는 방에서는 계속 진행).

- [ ] **Step 1: 구현**
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 화면 확인 (Task 4)** — 게임 중 버튼 보임/대기실에서 숨김, 확인 창 [계속하기]·Esc는 그대로, [나가기]는 처음 화면, 다른 탭(두 번째 브라우저 탭)에 알림.

### Task 3: 클라이언트 — 게임 방법

**Files:**
- Create: `client/src/guide.ts`
- Modify: `client/index.html` (처음 화면 `#guideBtn`, 대기실 `#guideBtn2`), `client/src/main.ts`, `client/src/style.css`(필요 시), `client/src/icons.ts`(`UI.guide` 아이콘, lucide `BookOpen` 또는 `CircleHelp`)

**Interfaces:**
- Produces:
  - `export type GuideTab = 'basic' | 'more'`
  - `export function guideBody(tab: GuideTab, rules: RoomRules): string` — DOM 없이 HTML 문자열. render.ts·icons.ts를 import하지 않는다(테스트에서 node로 불러야 해서).
  - `export function openGuide(host: HTMLElement, rules: RoomRules): void`
    - 도감 창 모양(`overlay codex` + `cx-card`)에 탭 [기본] [심화]를 둬요.
    - ✕·Esc·바깥 클릭으로 닫혀요.
  - 내용은 설계 문서 2장 그대로예요. 숫자는 이렇게 가져와요.
    - 내 색 `RULES.points.own`, 노란 원 `RULES.points.yellow`, 무지개 `RULES.points.rainbow`
    - 콤보 보너스 `RULES.comboBonus` (10콤보마다)
    - 피버 `rules.feverSec`초 ×`rules.feverMult`
    - 견제 `RULES.points.stealCalm`, 표적 `rules.markSec`초, 반격 `RULES.points.counter`
    - 보스: 막타 `RULES.boss.kill`, 최다 타격 `RULES.boss.mvp`, 독식 `RULES.boss.solo.pct`% → +`RULES.boss.solo.points`
    - 점수 구역 `RULES.zones.mult`
  - 꺼진 요소는 항목에 `class="off"`를 붙이고 문구 "이 방에선 꺼져 있어요"를 넣어요.
    - `rules.stealPenalty` 꺼짐 → 견제 페널티 문장
    - `rules.missPenalty` 꺼짐 → 빈 곳 페널티
    - `rules.boss` 꺼짐 → 보스
    - `rules.laser` 꺼짐 → 레이저
    - `rules.items` 꺼짐 → 아이템 원
  - 버튼
    - `#guideBtn`(처음 화면)과 `#guideBtn2`(대기실)는 도감 버튼 옆에 둬요. 글자는 "게임 방법"이고 아이콘이 붙어요.
    - 누르면 `openGuide($('stage'), room ? rules : DEFAULT_RULES)`
  - 첫 접속 자동 표시
    - 처음 화면을 처음 보일 때, `localStorage['cb-guide-seen']`이 없으면 열고 '1'을 저장해요.
    - 읽기·쓰기는 try/catch로 감싸요. 예외가 나면 띄우지 않아요.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 테스트 (Task 4)** — `shared/test/guide.test.ts`(새 파일, `../../client/src/guide.ts`를 import)

```ts
test('게임 방법 기본 탭: 점수·콤보·피버·견제·반격·페널티·점수 구역 숫자가 규칙을 따름', () => {
  /* DEFAULT_RULES: '+3', '+2', '+5', '10콤보', '+5', '7초', '×3', '4초', '+6', '×1', '×2', '×3' 포함.
     feverMult 5·feverSec 10·markSec 6인 규칙이면 '×5', '10초', '6초' */
});
test('게임 방법 심화 탭: 보스(막타·최다 타격·독식), 아케이드 항목', () => {});
test('꺼진 요소는 "이 방에선 꺼져 있어요" (보스·레이저·아이템·빈 곳 페널티·견제 페널티)', () => {});
```

### Task 4: 테스트·확인·문서·커밋·리뷰

- [ ] **Step 1: 테스트 작성** — Task 1·3 테스트.
- [ ] **Step 2: 전체 테스트** — `npm test` → 모두 통과.
- [ ] **Step 3: 타입 검사·빌드** — `npm run typecheck && npm run build`.
- [ ] **Step 4: 브라우저 확인**
  - 탭 두 개로 같은 방에 들어가서 확인해요.
    - 게임 중 나가기 버튼과 확인 창
    - 나간 쪽은 처음 화면으로 가요.
    - 남은 쪽에는 알림이 뜨고, 점수판에 "(봇)"이 보여요.
  - 혼자 하기에서 나가기를 확인해요.
  - 게임 방법을 확인해요.
    - 처음 접속 때 자동으로 뜨는지(저장소를 지운 뒤)
    - 탭 두 개, 꺼진 요소 표시
    - 대기실 버튼
- [ ] **Step 5: 문서**
  - `README.md`: 게임 중 나가기, 게임 방법, 구조의 새 파일을 적어요.
  - `docs/ROADMAP.md`에 항목을 추가해요.
  - 설계 문서 상태를 '구현 완료'로 바꿔요.
- [ ] **Step 6: 커밋 (목적별)**
  - `feat(server): 게임 중 나가면 봇이 자리를 이어받음`
  - `feat(client): 게임 중 나가기 버튼과 확인 창`
  - `feat(client): 게임 방법 창 (처음 접속 때 한 번 자동)`
  - `test: …`
  - `docs: …` (설계·계획 포함)
- [ ] **Step 7: 최종 리뷰** — 새 리뷰어(가장 좋은 모델)가 전체를 봐요. 중요한 지적만 재현 테스트를 쓰고 고쳐요.
