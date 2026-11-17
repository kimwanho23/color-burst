# 대기실 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대기실을 헤더 + 자리 4칸(빈 칸 (+)로 봇 추가, 봇마다 난이도) + 규칙 요약·설정 창 구조로 바꾸고, 방 링크를 복사·공유할 수 있게 한다.

**Architecture:** 서버에서 봇을 대기실부터 플레이어로 둔다(`PlayerState.botLevel`, 방장만 `lobby:addBot`/`removeBot`/`botLevel`). 봇까지 4칸이면 가득 참, 팀전만 시작 때 빈 칸을 채운다. 화면은 칸 배열과 규칙 요약을 DOM 없는 순수 함수(`client/src/lobbyUI.ts`)로 만들고, `main.ts`가 그린다. 규칙 편집(`renderRules`)은 새 설정 창으로 옮긴다.

**Tech Stack:** TypeScript, Socket.IO, Vite, `node:test` (`npm test`)

**Spec:** `docs/superpowers/specs/2026-11-17-lobby-rework-design.md`

## Global Constraints

- 최대 인원 `MAX_PLAYERS`(4)는 사람 + 봇을 합친 수.
- 봇 추가·빼기·난이도 변경은 방장만, 대기실(`phase === 'lobby'`)에서만.
- 새 봇의 기본 난이도는 보통(`BotLevel` 1).
- 팀전만 시작할 때 빈 칸을 보통 봇으로 채운다. 서바이벌·협력전·개인전은 있는 인원 그대로.
- 버튼 아래·옆의 부가 설명 문구는 넣지 않는다(오류 문구는 그대로).
- 커밋: Conventional Commits 한국어, 작성자 `Kim Wan ho`. 커밋 전 `npm run typecheck`·`npm run build` 통과. `main` 푸시 금지.

## Review Focus

1. **게임 중 나간 사람 자리의 봇** — 판이 끝나 대기실로 오면 그 봇은 빠지고 방장이 넣은 봇은 남는다 → Task 1 테스트 `판이 끝나면 대기실 봇만 남음`.
2. **봇 색으로 내 색 바꾸기** — 봇이 가진 색을 누르면 봇과 색을 맞바꾼다(막히지 않음) → Task 1 테스트 `봇 색을 고르면 봇과 맞바꿈`.
3. **팀이 꽉 찬 쪽에 봇 추가** — 팀전에서 팀 A가 2명이면 팀 A로 봇 추가는 무시 → Task 1 테스트 `팀전 봇 추가는 그 팀 자리가 있을 때만`.
4. **링크로 열었는데 방이 가득 참·없음** — 처음 화면에 기존 오류가 보이고 코드 칸은 채워진 채 → Task 3 미리보기 확인 항목.
5. **방장이 넘어감** — 새 방장 화면에 (+)·난이도·× 조작이 바로 생기고, 이전 방장 화면에서는 사라짐 → Task 2 테스트 `lobbySlots: 방장만 조작 표시`.

---

## File Structure

| 파일 | 맡는 일 |
|---|---|
| `shared/src/rules.ts` | `PlayerState.botLevel?`, `PlayerState.filler?` |
| `shared/src/protocol.ts` | `lobby:addBot`·`lobby:removeBot`·`lobby:botLevel` 추가, `lobby:options`·`RoomState.fillBots`/`botLevel` 제거 |
| `server/src/room.ts` | 대기실 봇, 가득 참 판정, 시작·종료 때 봇 처리, 색 맞바꾸기, 혼자 하기 봇 3명 |
| `server/src/index.ts` | 새 소켓 이벤트 연결 |
| `client/src/lobbyUI.ts` (새) | `lobbySlots`, `rulesSummary` (DOM 없음) |
| `client/src/main.ts`, `client/index.html`, `client/src/style.css` | 대기실 그리기, 규칙 설정 창, 링크 복사·자동 입장 |
| `client/src/rulesUI.ts` | 모드·프리셋 버튼의 부가 설명 줄 제거 |
| `shared/test/lobby.test.ts`, 기존 테스트들 | 봇 테스트, `fillBots`·`setOptions` 쓰던 곳 정리 |

---

### Task 1: 서버 — 대기실 봇

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerState` 601행 근처), `shared/src/protocol.ts`
- Modify: `server/src/room.ts` (`fillBots`·`botLevel` 35~36행, `join` 386행, `setColor` 498행, `setOptions` 506행, `start` 585~610행, `takeOver` 457행, 판 끝 1776행), `server/src/index.ts` (107~112행)
- Test: `shared/test/lobby.test.ts`; `fillBots`를 쓰는 `boss-fixes`·`coop`·`gamelog`·`room`·`survival`·`team` 테스트

**Interfaces:**
- Produces:
  - `PlayerState.botLevel?: BotLevel` — 대기실에서 넣은 봇(혼자 하기 기본 봇 포함). `PlayerState.filler?: boolean` — 팀전 시작 때 채운 봇.
  - `Room.addBot(id: string, team?: 0 | 1): void`, `Room.removeBot(id: string, botId: string): void`, `Room.setBotLevel(id: string, botId: string, level: BotLevel): void`
  - 소켓: `'lobby:addBot': (d: { team?: 0 | 1 }) => void`, `'lobby:removeBot': (botId: string) => void`, `'lobby:botLevel': (d: { id: string; level: BotLevel }) => void`
  - 제거: `Room.fillBots`, `Room.botLevel`, `Room.setOptions`, `'lobby:options'`, `RoomState.fillBots`·`botLevel`
- 동작
  - `addBot`: 방장·대기실·`players.length < MAX_PLAYERS`·빈 색이 있을 때만. 이름은 비어 있는 가장 앞 글자(봇 A, B, C). `botLevel = 1`. 팀전이면 `team` 인자 팀(그 팀이 `RULES.team.size` 미만일 때만, 아니면 무시), 인자가 없으면 `smallerTeam()`. 준비 해제(`unready`)와 `broadcastState`.
  - `join`: 봇을 걸러 내던 줄(`this.players = this.players.filter((x) => !x.bot)`)을 없애고, `players.length >= MAX_PLAYERS`면 `'방이 가득 찼어요.'`.
  - 혼자 하기 방(`solo && !timeAttack && !tutorial`): 첫 사람이 들어올 때 보통 봇 3명을 넣는다.
  - `setColor`: 고른 색을 봇이 갖고 있으면 그 봇과 맞바꾼다. 사람이 갖고 있으면 지금처럼 무시.
  - `start`: 봇을 지우지 않는다. 기존 `filler` 봇만 빼고, `this.bots`를 모든 봇의 `botLevel ?? 1`로 다시 만든다. `rules.team`일 때만 빈 칸을 `filler: true` 보통 봇으로 채운다. 인원 부족 문구는 `'혼자서는 시작할 수 없어요. 친구를 부르거나 봇을 추가해 주세요.'`, 협력전은 1명도 시작 가능.
  - `takeOver`: `new Bot(1)` (방 전체 난이도가 없어짐). 이어받은 봇은 `botLevel`이 없다.
  - 판 끝(대기실로): `players = players.filter((p) => !p.bot || (p.botLevel !== undefined && !p.filler))`, `bots.clear()`.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/lobby.test.ts`에 추가. `lobby()` 도우미의 `room.fillBots = false` 줄은 지운다)

| 테스트 | 단언 |
|---|---|
| `봇 추가: 방장만, 보통으로, 봇까지 4칸이면 더 못 넣음` | `room.addBot(b)` 무시(2명). `addBot(a)` 두 번 → `players.length === 4`, 봇 `botLevel === 1`, 이름 `봇 A`·`봇 B`. 세 번째 무시 |
| `봇까지 4칸이면 사람은 가득 참, 봇을 빼면 들어옴` | 위 상태에서 `room.join('s3','k3','C')`가 `{ error: '방이 가득 찼어요.' }`. `removeBot(a, 봇A.id)` 뒤 `join` 성공 |
| `봇 빼기·난이도: 방장만, 대기실에서만` | `setBotLevel(b, bot, 2)` 무시, `setBotLevel(a, bot, 2)` → 2, `removeBot(b, bot)` 무시 |
| `봇 색을 고르면 봇과 맞바꿈` | 봇 색 `c`, 내 색 `m` → `setColor(a, c)` 뒤 내 색 `c`, 봇 색 `m` |
| `팀전 봇 추가는 그 팀 자리가 있을 때만` | 팀전 규칙, A·B가 팀 0·1 → `addBot(a, 0)` 팀 0 봇, 다시 `addBot(a, 0)` 무시(팀 0이 2명) |
| `시작: 봇마다 난이도로 Bot을 만들고, 개인전은 빈 칸을 채우지 않음` | 봇 1(난이도 2) + 사람 2 → 시작 뒤 `players.length === 3`, `room.bots.get(bot.id)`의 레벨이 2(`(bot as unknown as {level:number}).level`) |
| `팀전 시작은 빈 칸을 채우고 판이 끝나면 채운 봇은 빠짐` | 팀전 사람 2 → 시작 뒤 4명(채운 2명 `filler`), `end()` 뒤 다시 2명 |
| `판이 끝나면 대기실 봇만 남음` | 봇 1 + 사람 2(A·B), 시작 후 `room.leave(B)`(이어받기) → `end()` 뒤 남은 봇은 대기실 봇 1명뿐, 난이도 그대로 |
| `혼자 하기 방은 보통 봇 3명으로 시작` | `new Room(io,'S',()=>{},true)` + join → 봇 3명, 모두 `botLevel === 1` |
| `협력전은 1명도 시작` | 사람 1명 방(혼자 하기 아님), 협력전 규칙 → `start(a) === null` |

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/lobby.test.ts` / Expected: `addBot` 없음 등으로 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces·동작대로. 기존 `준비: 규칙·옵션 변경…` 테스트의 `setOptions` 줄은 `addBot(a)`로 바꾼다(봇 추가도 준비 해제).
- [ ] **Step 4: 다른 테스트 정리** — `room.fillBots = false` 줄을 모두 지운다(이제 기본이 봇 없음). Run: `npm test`. 봇 자동 채움에 기대던 테스트가 깨지면 그 테스트에서 `room.addBot(host)`로 필요한 수만큼 넣는다. Expected: 전부 PASS
- [ ] **Step 5: 확인·커밋** — `npm run typecheck`(화면 쪽 `fillBots`·`botLevel`·`lobby:options` 참조는 이 Task에서 타입이 깨지지 않을 만큼만 지운다: 체크박스·난이도 줄 처리 제거) → `feat(server): 대기실에서 봇을 자리로 추가하고 봇마다 난이도, 봇까지 4칸이면 가득 참`

---

### Task 2: 화면 — 자리 칸과 규칙 요약

**Files:**
- Create: `client/src/lobbyUI.ts`
- Modify: `client/index.html` (대기실 61~92행), `client/src/main.ts` (`renderLobby` 343행, `renderMembers` 401행, `members` 클릭 418행), `client/src/rulesUI.ts`, `client/src/style.css`
- Test: `shared/test/lobbyui.test.ts` (새)

**Interfaces:**
- Consumes: Task 1의 `PlayerState.botLevel`, 소켓 `lobby:addBot`·`lobby:removeBot`·`lobby:botLevel`.
- Produces (`client/src/lobbyUI.ts`, DOM 없음):
  ```ts
  export type Slot =
    | { kind: 'human'; p: PlayerState; me: boolean; isHost: boolean }
    | { kind: 'bot'; p: PlayerState; canEdit: boolean }
    | { kind: 'empty'; team?: 0 | 1; canAdd: boolean; canJoin: boolean };
  /** 늘 4칸. 팀전이면 [팀0, 팀0, 팀1, 팀1] 순서(팀 안에서는 들어온 순서, 빈 칸은 뒤) */
  export function lobbySlots(players: readonly PlayerState[], hostId: string, myId: string, team: boolean): Slot[];
  /** 규칙 요약 두 줄 */
  export function rulesSummary(r: RoomRules): { title: string; detail: string };
  ```
  - `canAdd`·`canEdit`: 내가 방장일 때. `canJoin`: 팀전이고 내 팀이 그 칸의 팀과 다를 때.
  - `rulesSummary.title`: `인원모드 · 클래식|아케이드 · 프리셋이름`. 인원모드는 개인전/팀전 2:2/서바이벌/협력전(이지·노말·하드), 프리셋은 `matchPreset(r)`의 `PRESETS[id].name`, 없으면 `커스텀`. 협력전은 `협력전 노말 · 클래식 · …`.
  - `rulesSummary.detail`: 클래식은 `${roundSec}초`(협력전은 `RULES.coop.timeSec`), 아케이드는 `${ARCADE.rounds}라운드 · 라운드 ${arcadeRoundSec}초` · `피버 ×${feverMult} ${feverSec}초` · 켜진 것만 `보스`·`아이템`·`레이저`·`맵 패턴`(`mapPct > 0`)을 ` · `로 잇는다.
- 화면(`main.ts`·`index.html`)
  - 대기실 카드 맨 위 `.lobby-head`: 왼쪽 [방 나가기](`leaveBtn`을 여기로), 방 이름(`방 K7QZ`, 혼자 하기는 `혼자 하기`, 타임어택은 `타임어택`), [링크 복사](`copyLinkBtn`, Task 3에서 동작), 오른쪽 [도감](`codexBtn2`)·[게임 방법](`guideBtn2`). 기존 `codeBlock`·`soloTitle`·`taTitle`·아래 `btnrow`·`picksLbl`·`picks`·`hostOpts`·`lobbyHint`는 없앤다.
  - `.slots`: `lobbySlots` 4칸. 사람 칸(색 원·이름·방장/준비), 내 칸 클릭 → 색 고르기 팝업(지금 `picks` 버튼들을 팝업으로), 방장이 남의 칸 클릭 → 기존 [방장 넘기기]·[내보내기]. 봇 칸(색 원·이름·난이도 세 버튼·×), 빈 칸((+) 봇 추가, 팀전이면 [이 팀으로]도). 팀전이면 `.teamgroup` 둘로 묶고 팀 이름과 `n/2`. 타임어택 대기실에서는 칸을 숨긴다.
  - `.lobby-rules`: `rulesSummary` 두 줄, [규칙 바꾸기](방장)/[규칙 보기](그 밖), [이 방 점수표](지금 것 이동). 오른쪽에 [게임 시작]/[준비].
  - 규칙 설정 창 `#rulesModal`: 지금 `rulesBox`를 그 안으로 옮겨 `renderRules`가 그대로 그린다. 닫기 버튼·Esc·바깥 클릭으로 닫힘. 방장이 아니면 `editable=false`로 같은 창.
  - `rulesUI.ts`: 모드·프리셋 버튼의 설명 `<span>`·경고 줄을 없애고, 같은 글은 버튼 `title`로 옮긴다.
  - 간격: 대기실 카드 `max-width`를 넓히고(예 760px) 칸 사이 `gap` 12px 이상, 600px 미만이면 칸 2×2.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/lobbyui.test.ts`)

```ts
test('lobbySlots: 늘 4칸, 사람·봇·빈 칸 순서', () => {
  // 사람 A(방장, 나) · 봇 1 → [human(me,isHost), bot(canEdit), empty(canAdd), empty(canAdd)]
});
test('lobbySlots: 방장만 조작 표시', () => {
  // 같은 players로 myId가 방장이 아닐 때: bot.canEdit === false, empty.canAdd === false
});
test('lobbySlots: 팀전은 팀0 두 칸 뒤 팀1 두 칸, 내 팀이 아닌 빈 칸만 canJoin', () => {
  // 팀0: 나, 팀1: B → [human(나,t0), empty(team 0, canJoin false), human(B,t1), empty(team 1, canJoin true)]
});
test('rulesSummary: 기본·협력전·아케이드', () => {
  assert.deepEqual(rulesSummary(DEFAULT_RULES).title, '개인전 · 클래식 · 기본');
  assert.ok(rulesSummary(DEFAULT_RULES).detail.startsWith('60초 · 피버 ×3 7초'));
  assert.ok(rulesSummary({ ...DEFAULT_RULES, coop: true }).title.startsWith('협력전 노말'));
  assert.ok(rulesSummary({ ...DEFAULT_RULES, mode: 'arcade' }).detail.startsWith(`${ARCADE.rounds}라운드`));
  assert.ok(rulesSummary({ ...DEFAULT_RULES, feverSec: 9 }).title.endsWith('커스텀'));
});
```
(각 주석은 그대로 `assert.deepEqual`로 쓴다. `players`는 `newPlayer`로 만든다)

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/lobbyui.test.ts` / Expected: 모듈 없음으로 FAIL
- [ ] **Step 3: `lobbyUI.ts` 구현** → Step 1 테스트 PASS
- [ ] **Step 4: 화면 바꾸기** — 위 '화면' 그대로. `npm run typecheck`, `npm run build` 통과
- [ ] **Step 5: 미리보기 확인** — 서버(3001)·화면(5173) 두 창으로: 방 만들기 → (+)로 봇 2명, 난이도 바꾸기, × 빼기 / 두 번째 탭으로 입장해 방장 아닌 화면에 조작이 없는지 / 봇 색 고르기 맞바꿈 / 팀전으로 바꿔 팀 칸·[이 팀으로] / 규칙 바꾸기 창 열고 프리셋 바꾸면 요약이 바뀜 / 혼자 하기 대기실 봇 3명 / 좁은 창(375px)에서 2×2 / 가로 스크롤 없음
- [ ] **Step 6: 커밋** — `feat(client): 대기실을 헤더·자리 4칸·규칙 요약과 설정 창으로 개편`

---

### Task 3: 링크 복사와 링크로 바로 들어오기

**Files:**
- Modify: `client/src/main.ts` (314행 `location.hash` 처리, 헤더 [링크 복사])

**Interfaces:**
- Consumes: Task 2의 `#copyLinkBtn`.
- Produces: `export function roomLink(origin: string, pathname: string, code: string): string` in `client/src/lobbyUI.ts` → `${origin}${pathname}#${code}`.
- 동작: [링크 복사] → `navigator.clipboard.writeText(roomLink(...))`, 성공하면 버튼 글이 1.5초 "복사했어요", 실패하면 링크를 고른 상태의 입력칸을 잠깐 보여 준다. 처음 화면: `location.hash`가 4글자 방 코드이고 저장된 이름(`getName()`이 기본값이 아닌 값)이 있으면 연결 직후 `room:join`을 한 번 보낸다. 실패하면 지금처럼 `homeErr`에 오류, 코드 칸은 채워 둔다.

- [ ] **Step 1: 실패하는 테스트** (`shared/test/lobbyui.test.ts`에 추가) — `roomLink('http://x.com', '/', 'K7QZ') === 'http://x.com/#K7QZ'`, `roomLink('https://a.b', '/game/', 'AB12') === 'https://a.b/game/#AB12'`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — Run: `node --import tsx --test shared/test/lobbyui.test.ts`
- [ ] **Step 3: 미리보기 확인** — 방 만들고 [링크 복사] 글 바뀜 / 다른 탭에서 그 링크 열기: 이름이 저장돼 있으면 바로 대기실, 없으면 처음 화면에 코드만 채워짐 / 봇까지 4칸인 방 링크 → 처음 화면에 "방이 가득 찼어요." / 없는 코드 → 기존 오류
- [ ] **Step 4: 커밋** — `feat(client): 대기실 링크 복사, 링크로 열면 저장된 이름으로 바로 입장`

---

### Task 4: 문서

**Files:**
- Modify: `README.md`(대기실·봇 채우기 설명, 20행 '혼자 테스트'), `docs/ROADMAP.md`(다음 작업 표에 대기실 개편 ✅와 관전석 💡), `CHANGELOG.md`(`[미출시]` 기능)

- [ ] **Step 1: 고치기** — CHANGELOG 기능 한 줄씩: "대기실 개편: 헤더(방 나가기·링크 복사), 자리 4칸에서 (+)로 봇 추가·봇마다 난이도, 규칙은 요약과 설정 창", "봇까지 4명이면 방이 가득 참, 팀전만 시작할 때 빈 자리를 봇으로", "링크로 열면 저장된 이름으로 바로 입장". README '혼자 테스트'를 "대기실 빈 칸의 (+)로 봇을 넣고 시작"으로.
- [ ] **Step 2: 확인·커밋** — `npm run typecheck`·`npm run build` → `docs: 대기실 개편 반영`
