# 성장 증강 · 대기실 편의 · 팀전/서바이벌/타임어택 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙의 다섯 묶음(대기실 편의, 스택형·자동 시전형 증강, 시너지·진화, 팀전·서바이벌 옵션, 타임어택)을 넣는다.

**Architecture:** 규칙 판정은 `shared`의 순수 함수로 만들고 테스트한 뒤, 서버 `Room`이 상태를 바꾸고 이벤트를 보내며, 화면(`client/src`)은 받은 상태를 그린다. 새 플레이어 상태는 `PlayerState`, 새 방 옵션은 `RoomRules`에 둔다.

**Tech Stack:** TypeScript 5, Node 20 + Socket.IO(서버), Vite + Canvas(화면), `node:test`(테스트, `npm test`).

**Spec:** `docs/superpowers/specs/2026-11-09-growth-lobby-modes-design.md`

## Global Constraints

- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`(모드·대기실)와 `shared/src/arcade.ts`(증강)에만 둔다.
- 커밋 메시지: `<타입>(<범위>): <한국어 요약>` (CONTRIBUTING.md). 기능과 테스트는 따로 커밋. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전에 `npm run typecheck`, `npm run build`, `npm test`가 모두 통과.
- `main`에 푸시하지 않는다(푸시 = Render 배포). 버전 올리기는 이 계획 밖.
- 화면 문구는 한국어 존댓말 "~해요" 체, 기존 화면과 같은 말투.
- 테스트 파일은 `shared/test/*.test.ts` (서버 `Room`도 여기서 `../../server/src/room.ts`로 가져와 테스트, `room.test.ts`의 `playingRoom()`·`fakeIo()` 패턴).

## Review Focus

1. **대기실에서 방장이 나감/끊김:** 준비 상태가 남은 사람에게 이상하게 남지 않고, 새 방장은 준비 표시가 지워져야 한다 → Task 1에 테스트.
2. **팀전에서 같은 팀 색을 견제로 처리:** 반사·반격·강탈·표적이 같은 팀에게 걸리면 안 된다 → Task 5에 테스트(같은 팀 색 claim의 `type`이 `'own'`, `marked` false).
3. **서바이벌에서 탈락자가 마지막 순간 자석·장판으로 점수를 얻음:** 탈락 뒤 `claim`이 전혀 일어나지 않아야 한다 → Task 6에 테스트.
4. **서바이벌 중 일시정지:** 30초 탈락 시각이 멈춘 시간만큼 밀려야 한다 → Task 6에 테스트.
5. **진화와 레전드가 겹침:** 레전드로 한 번 고른 뒤 3번째로 진화해도 레전드 효과가 두 번 적용되지 않는다(`hasLegend`는 boolean) → Task 4에 테스트.

---

### Task 1: 대기실 편의 (준비 · 방장 넘기기 · 강퇴)

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerState`, `newPlayer`)
- Modify: `shared/src/protocol.ts` (`ClientToServer`, `ServerToClient`)
- Modify: `server/src/room.ts` (`setReady`, `giveHost`, `kick`, `start`, `setRules`, `setOptions`, `end`, `join`)
- Modify: `server/src/index.ts` (소켓 핸들러)
- Modify: `client/src/main.ts` (`renderLobby`, 준비 버튼, 참가자 메뉴, `room:kicked`), `client/index.html`, `client/src/style.css`
- Test: `shared/test/lobby.test.ts`

**Interfaces:**
- Produces: `PlayerState.ready: boolean` (기본 false). `Room.setReady(id: string, on: boolean): void`, `Room.giveHost(id: string, to: string): void`, `Room.kick(id: string, target: string): void`, `Room.notReady(): number` (방장·봇 제외 준비 안 한 사람 수). 이벤트 `'lobby:ready': (on: boolean) => void`, `'lobby:host': (playerId: string) => void`, `'lobby:kick': (playerId: string) => void`, 서버 → `'room:kicked': () => void`.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/lobby.test.ts`, 소켓 대신 `room.test.ts`의 `fakeIo` 패턴; 내보낸 소켓 알림은 `sent` 배열로 확인)

```ts
test('준비: 방장 뺀 사람이 모두 준비해야 시작, 규칙을 바꾸면 준비가 풀림', () => {
  // A(방장), B 입장 → room.start(A) === '아직 준비 안 한 사람이 있어요.'
  // room.setReady(B, true) → room.start(A) === null
});
test('준비: 규칙·옵션 변경, 게임이 끝나 대기실로 오면 모두 준비 해제', () => { /* setRules 뒤 B.ready === false */ });
test('방장 넘기기: 방장만, 봇·없는 사람에게는 안 됨, 새 방장의 준비 표시는 지움', () => { /* giveHost(A,B) → hostId B, B.ready false; giveHost(B,'bot-1') 무시 */ });
test('강퇴: 방장만·대기실에서만, 내보낸 키는 다시 못 들어옴', () => {
  // kick(A,B) → players에 B 없음, sent에 'room:kicked'; 같은 키 join → { error: '이 방에서 내보내졌어요.' }
  // B가 kick(B,A) → 무시; 게임 중 kick → 무시
});
test('방장이 나가면 넘겨받은 사람의 준비 표시가 지워짐', () => { /* Review Focus 1 */ });
```

- [ ] **Step 2: 실행해서 실패 확인** — Run: `node --import tsx --test shared/test/lobby.test.ts` / Expected: FAIL (`setReady is not a function`)
- [ ] **Step 3: 구현**
  - `start()` 맨 앞(방장 확인 뒤): `notReady() > 0`이면 `'아직 준비 안 한 사람이 있어요.'`. 혼자 하기는 검사하지 않음.
  - `setRules`·`setOptions`·`end()`: 사람 모두 `ready = false`. `passHostIfNeeded`·`giveHost`: 새 방장 `ready = false`.
  - `kick`: `this.kicked: Set<string>`(키)에 넣고 `remove`, 그 소켓에 `room:kicked`. `join`에서 `kicked.has(key)`면 `{ error: '이 방에서 내보내졌어요.' }`.
  - 화면: 대기실 참가자 칩에 ✓, 방장 아닌 사람에게 [준비]/[준비 취소] 버튼, 방장 시작 버튼 아래 `${n}명이 아직 준비 안 했어요`(시작 버튼 disabled). 방장이 다른 사람 칩을 누르면 작은 메뉴 [방장 넘기기] [내보내기], 내보내기는 `confirmDialog`("○○님을 내보낼까요?", ok '내보내기', cancel '취소'). `room:kicked` → `resetToHome('방장이 내보냈어요')`.
- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test` / Expected: 전부 PASS
- [ ] **Step 5: 화면 확인** — 두 탭(같은 브라우저 다른 키는 시크릿 창)으로 준비·넘기기·내보내기 한 번씩. 브라우저 창에서 확인 못 하면 보고에 적는다.
- [ ] **Step 6: 커밋** — `feat: 대기실 준비·방장 넘기기·내보내기` / `test: 대기실 준비·방장 넘기기·내보내기`

---

### Task 2: 성장 증강 정의와 순수 함수 (스택형 · 자동 시전형)

**Files:**
- Modify: `shared/src/arcade.ts` (`AbilityId`, `AbilityCategory`에 `'성장'`, `ABILITIES`, `LEGEND`, `LEGEND_TEXT`, 새 함수)
- Modify: `shared/src/rules.ts` (`PlayerState.stacks`, `PlayerState.autoAt`, `newPlayer`, `resetForRound`, `shiftTimes`)
- Modify: `client/src/icons.ts` (`ABILITY_ICON`에 6개)
- Test: `shared/test/growth.test.ts`

**Interfaces:**
- Produces:
  - 능력 6개 (스펙 1·2절 표의 id·이름·값·cap 그대로): `drill`, `crownMark`, `luckStack`(분류 `'성장'`), `autoMagnet`, `autoCharge`, `autoGuard`(분류 `'보조'`).
  - `GROWTH = { drillEvery: 10, drillPts: 1, crownFever: 0.2, luckPct: 1, autoMs: { autoMagnet: 2000, autoGuard: 2000 }, autoCharge: 10 }` (arcade.ts). `LEGEND`에 `autoCharge: 15, autoGuardMs: 3000, autoMagnetAdd: 1, luckHighMult: 2`.
  - `type StackId = 'drill' | 'crownMark' | 'luckStack'`, `type AutoId = 'autoMagnet' | 'autoCharge' | 'autoGuard'`.
  - `addStack(p: PlayerState, id: StackId): boolean` — 최대 칸(`modsOf(p.picks)[id]`, 진화 cap 반영)을 넘지 않게 1 올림, 올랐으면 true.
  - `stackBonus(p: PlayerState): { own: number; feverMult: number; jackpot: number }` — 단련 칸×1, 왕의 증표 칸×0.2, 행운 축적 칸×1.
  - `autoEveryMs(p: PlayerState, id: AutoId): number` — `60000 / modsOf(p.picks)[id]`, 없으면 `Infinity`.
  - `PlayerState.stacks: Partial<Record<StackId, number>>`, `PlayerState.autoAt: Partial<Record<AutoId, number>>` (둘 다 `{}`). `resetForRound`에서 `stacks = {}`. `shiftTimes`가 `autoAt`도 민다.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('스택: 최대 칸까지만 쌓이고 같은 증강을 또 고르면 최대 칸이 늘어남', () => {
  // drill 노말(2) → addStack 3번: true,true,false, stacks.drill === 2; 레어 drill 추가 → 최대 5
});
test('스택 보너스: 단련 3칸 = 내 색 +3, 왕의 증표 2칸 = 피버 배율 +0.4, 행운 축적 4칸 = 잭팟 +4%', () => {});
test('자동 시전 간격: 1분에 3번 = 20초, 겹쳐 고르면 합산(3+4 = 7번), cap 넘지 않음, 없으면 Infinity', () => {});
test('shiftTimes가 다음 자동 발동 시각도 민다', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/growth.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 설명(`desc`)은 스펙 문구: 단련 `10콤보마다 내 색 +1점이 쌓임 (최대 ${v}칸)`, 왕의 증표 `보스 막타마다 피버 배율 +0.2가 쌓임 (최대 ${v}칸)`, 행운 축적 `잭팟이 터질 때마다 잭팟 확률 +1%가 쌓임 (최대 ${v}칸)`, 자기장 `1분에 ${v}번 자석 2초`, 충전기 `1분에 ${v}번 피버 게이지 +10`, 보호막 발생기 `1분에 ${v}번 보호막 2초`. `LEGEND_TEXT`는 스펙 1·2절 레전드 효과 문구.
- [ ] **Step 4: 통과 확인** — `npm test` 전부 PASS, `npm run typecheck` 통과(아이콘 Record 누락이면 여기서 잡힌다)
- [ ] **Step 5: 커밋** — `feat(shared): 성장 증강 6개(스택형·자동 시전형) 정의` / `test: 성장 증강 스택·자동 시전 간격`

---

### Task 3: 성장 증강을 게임에 연결

**Files:**
- Modify: `shared/src/rules.ts` (`resolveClaim`: 콤보 10 도달 시 `addStack(drill)`, 내 색 점수에 `stackBonus.own`, 잭팟 확률에 `stackBonus.jackpot` + 잭팟 터지면 `addStack(luckStack)`; `feverMultOf`에 `stackBonus.feverMult`; `startRound`에서 `autoAt` 첫 시각)
- Modify: `shared/src/bossScore.ts` (막타 → `addStack(crownMark)`, 레전드면 독식도)
- Modify: `server/src/room.ts` (`tick`에서 `updateAuto(now)`), `shared/src/protocol.ts` (`'auto:fire': (d: { playerId: string; id: AutoId }) => void`, `'stack:up': (d: { playerId: string; id: StackId; n: number }) => void`)
- Modify: `client/src/main.ts`, `client/src/arcadeUI.ts` (칩에 `n/최대`, 반짝임), `client/src/effectsUI.ts` (자동 발동 칩)
- Test: `shared/test/growth.test.ts`, `shared/test/room.test.ts`

**Interfaces:**
- Consumes: Task 2의 `addStack`, `stackBonus`, `autoEveryMs`, `GROWTH`, `LEGEND`.
- Produces: `startRound`가 `p.autoAt[id] = startAt + autoEveryMs(p, id)` (가진 것만). `Room.updateAuto(now: number): void` — `now >= autoAt`이면 효과 적용(`addBuff(p,'magnet', ms)`, `addFever(p, n, …)`, `addBuff(p,'guard', ms)`), 다음 시각 `+= autoEveryMs`, `auto:fire` 전송.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('단련: 10콤보에 닿으면 한 칸, 다음 내 색 원이 +1점', () => { /* resolveClaim 반복으로 combo 10 → stacks.drill 1, 다음 own gained가 1 큼 */ });
test('행운 축적: 잭팟이 터지면 한 칸, 잭팟 확률 상한 35%는 그대로', () => {});
test('왕의 증표: 보스 막타마다 한 칸, 피버 배율에 +0.2', () => {});
test('자동 시전(방): 충전기 1분 6번이면 10초마다 피버 게이지 +10, 피버 중엔 그대로', (t) => { /* mock timers, tick */ });
test('자동 시전(방): 일시정지하면 다음 발동도 밀림', (t) => {});
```

- [ ] **Step 2: 실패 확인** — `npm test` / Expected: 새 테스트 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 자기장은 봇이면 건너뜀(봇은 커서 없음).
- [ ] **Step 4: 통과 확인** — `npm test` PASS
- [ ] **Step 5: 화면 확인** — 혼자 하기 아케이드에서 도감·증강 칩에 성장 증강이 보이는지(브라우저 확인 불가 시 보고)
- [ ] **Step 6: 커밋** — `feat: 성장 증강을 게임에 연결 (쌓기·자동 발동·표시)` / `test: 성장 증강 쌓기·자동 발동`

---

### Task 4: 시너지 · 진화

**Files:**
- Modify: `shared/src/arcade.ts` (`SYNERGY`, `synergiesOf`, `synergyProgress`, `evolvedOf`, `hasLegend`, `legendOf`, `modsOf` cap, `buildWeight`)
- Modify: `shared/src/rules.ts` (`resolveClaim`·`addFever`·`breakCombo`·`addBuff`에 시너지 보너스)
- Modify: `shared/src/bossScore.ts` (보스 시너지 ×1.2)
- Modify: `client/src/arcadeUI.ts` (시너지 진행도, "진화까지 1장"·진화 배지, 시너지 칩), `client/src/codex.ts` (진화·시너지 설명 한 줄씩)
- Test: `shared/test/synergy.test.ts`

**Interfaces:**
- Produces:
  - `SYNERGY: Record<'점수'|'피버'|'보스'|'유지'|'견제'|'보조', { need: number; text: string }>` — 스펙 3절 표 그대로(점수 3, 나머지 2). 수치 상수: `SYN = { ownAdd: 1, feverGain: 1.15, bossHit: 1.2, keepPct: 50, stealAdd: 2, buffAddMs: 1000 }`.
  - `synergiesOf(picks: readonly Pick[] | undefined): Set<SynergyCat>` — 분류별 서로 다른 id 수 ≥ need. 저주·특별·성장 제외.
  - `synergyProgress(picks): { cat: SynergyCat; have: number; need: number }[]` — 하나 이상 가진 분류만.
  - `EVOLVE = { count: 3, capMult: 1.5, weight: 2 }`. `evolvedOf(picks): Set<AbilityId>` — 3번 이상 고른 id(저주·특별 제외).
  - `hasLegend(p, id)` = 레전드로 고름 `||` `evolvedOf(p.picks).has(id)`. `legendOf`도 진화 포함.
  - `modsOf`: 진화한 id는 `cap * EVOLVE.capMult`.
  - `buildWeight`: 2번 고른 id는 `× EVOLVE.weight`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('시너지: 피버 2종이면 활성, 같은 증강 2번은 1종, 저주·특별·성장은 세지 않음', () => {});
test('시너지 보너스: 점수 3종 → 내 색 +1, 견제 2종 → 견제 점수 +2, 유지 2종 → 콤보가 끊길 때 절반 (철옹성이면 철옹성 규칙)', () => {});
test('진화: 같은 증강 3번이면 hasLegend 참, cap 1.5배 (잭팟 35 → 52.5지만 전체 잭팟 상한은 그대로)', () => {});
test('진화: 레전드로 고른 뒤 진화해도 레전드 효과는 한 번 (Review Focus 5)', () => {});
test('빌드 가중치: 2번 고른 증강은 ×2', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/synergy.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 잭팟 확률 전체 상한(`RULES` 35%)은 진화 cap과 따로 유지.
- [ ] **Step 4: 통과 확인** — `npm test` PASS (기존 잭팟·레전드 테스트 포함)
- [ ] **Step 5: 커밋** — `feat: 증강 시너지(같은 분류 개수)와 진화(같은 증강 3번)` / `test: 시너지·진화`

---

### Task 5: 팀전 2:2

**Files:**
- Modify: `shared/src/rules.ts` (`RoomRules.team`, `sanitizeRules`, `DEFAULT_RULES`, `MODE_KEYS`, `PlayerState.team`, `RULES.team`, `ownsKind`, `teamOf`, `resolveClaim`, `rangeTargets`, `teamRanking`)
- Modify: `shared/src/cursor.ts` (`pickMagnetTargets`가 `ownsKind` 사용)
- Modify: `server/src/room.ts` (모든 `isMine(c.kind, p.color)` → `ownsKind(c.kind, p, this.players)`, 팀 배정, `setTeam`, `start` 4명·봇 채우기, `end` 팀 승패·전적), `server/src/bot.ts` (같은 팀 색 가중치 = 내 색)
- Modify: `shared/src/protocol.ts` (`'lobby:team': (team: 0 | 1) => void`, `GameOver.teams?: { team: 0 | 1; score: number; ids: string[] }[]`)
- Modify: `client/src/main.ts` (빗나감 판정 `ownsKind`, 점수판 팀 묶음), `client/src/rulesUI.ts` (팀전 토글), `client/src/results.ts` (승리 팀), `client/src/render.ts` (같은 팀 색 원 하이라이트가 있으면 같은 함수)
- Test: `shared/test/team.test.ts`

**Interfaces:**
- Produces:
  - `RoomRules.team: boolean` (기본 false, `MODE_KEYS`에 추가해 프리셋이 안 바꿈). `RULES.team = { size: 2 }`.
  - `PlayerState.team: 0 | 1` (기본 0).
  - `ownsKind(kind: CircleKind, me: PlayerState, players: readonly PlayerState[], team: boolean): boolean` — `isMine(kind, me.color)` 또는 (`team`이고 `kind`가 같은 팀 다른 사람 색). 화면·서버·봇 모두 이 함수.
  - `teamRanking(players): { team: 0 | 1; score: number; best: number; ids: string[] }[]` — 합 내림차순, 동점이면 `best`(팀 최고 개인 점수).
  - `Room.setTeam(id: string, team: 0 | 1): void` — 대기실, 팀원 2명 넘으면 무시.
  - `resolveClaim`의 `opts`에 `team?: boolean` 추가. 같은 팀 색 → 내 색 분기(`type: 'own'`), `owner` 판정(반사·반격·강탈)은 상대 팀만.
- Rules: `sanitizeRules`에서 `team && survival`이면 `survival = false`. 팀전 켜면 `start`에서 봇 채우기 강제, 4명 미만이면 `'팀전은 4명이 필요해요. 봇 채우기를 켜 주세요.'`는 생기지 않게 강제로 채움. 팀 배정은 들어온 순서 0·1·0·1, 봇은 빈 팀부터.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('ownsKind: 팀전이면 같은 팀 색도 내 것, 아니면 그대로', () => {});
test('팀전 claim: 같은 팀 색은 own(내 색 점수·게이지), 표적·견제 없음 (Review Focus 2)', () => {});
test('팀전 claim: 상대 팀 색은 견제, 상대 팀 표적은 반격', () => {});
test('teamRanking: 합으로, 같으면 팀 최고 개인 점수', () => {});
test('팀전 방: 시작하면 4명(봇 채움), 팀 0·1·0·1, 팀 바꾸기는 2명 넘으면 거절', () => {});
test('팀전 방: 게임이 끝나면 이긴 팀 사람에게 1승, game:over에 teams', () => {});
test('sanitizeRules: 팀전과 서바이벌을 같이 켜면 팀전만', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/team.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 점수판은 팀전이면 팀별 묶음 + 팀 합계 줄. 결과 화면 맨 위 `${팀 이름} 승리` + 팀 합계(팀 이름: '팀 A' / '팀 B').
- [ ] **Step 4: 통과 확인** — `npm test` PASS (기존 견제·반사·자석 테스트가 팀전 꺼짐에서 그대로 통과해야 함)
- [ ] **Step 5: 화면 확인** — 혼자 하기로는 팀전을 켤 수 없으니 방 만들기 + 봇 채우기로 한 판(브라우저 확인 불가 시 보고)
- [ ] **Step 6: 커밋** — `feat: 팀전 2:2 (같은 팀 색 = 내 색, 팀 합계 승패)` / `test: 팀전`

---

### Task 6: 서바이벌

**Files:**
- Modify: `shared/src/rules.ts` (`RoomRules.survival`, `RULES.survival`, `PlayerState.outAt`·`outRank`, `survivalRoundMs`, `survivalCuts`, `pickOut`, `survivalRanking`, `toGameRules`)
- Modify: `server/src/room.ts` (`tick`의 탈락 판정 `updateSurvival(now)`, 탈락자 claim·click·cursor·pull·zone·bot 무시, 스폰 색에서 제외, `endRound` 아케이드 탈락, `startPick` 탈락자 건너뜀, `end` 순위, `finishResume`가 다음 탈락 시각을 밂)
- Modify: `shared/src/protocol.ts` (`'player:out': (d: { id: string; rank: number }) => void`, `'survival:warn': (d: { id: string; at: number }) => void`, `PlayPayload.nextCutAt: number`)
- Modify: `client/src/main.ts` (탈락 현수막·효과음, "탈락 · 구경 중", 꼴찌 칩 깜빡임, 점수판 흐림+순위), `client/src/rulesUI.ts` (서바이벌 토글), `client/src/results.ts` (탈락 순서 순위)
- Test: `shared/test/survival.test.ts`

**Interfaces:**
- Produces:
  - `RoomRules.survival: boolean` (기본 false, `MODE_KEYS`). `RULES.survival = { everyMs: 30_000, warnMs: 3_000, minPlayers: 3 }`.
  - `PlayerState.outAt: number` (0 = 살아 있음), `outRank: number` (0 = 미정).
  - `survivalRoundMs(n: number): number` = `(n - 1) * RULES.survival.everyMs` (클래식 판 시간; `toGameRules`에 인원이 필요하므로 `Room.start`에서 `G.roundMs`를 덮어씀).
  - `survivalCuts(n: number, rounds: number): number[]` — 아케이드에서 탈락이 일어나는 라운드 번호(끝난 뒤). 4명·5라운드 → `[3, 4]`, 3명 → `[4]`.
  - `pickOut(alive: readonly PlayerState[], rand?: () => number): PlayerState` — 최저 점수, 같으면 낮은 콤보, 같으면 무작위.
  - `survivalRanking(players): PlayerState[]` — 살아 있는 사람(점수순) 먼저, 그다음 `outAt` 늦은 순.
  - `Room.nextCutAt: number` — 클래식 다음 탈락 시각. `warnMs` 전에 `survival:warn`, 시각이 되면 `pickOut` → `outAt`, `outRank = 살아 있던 수`, `player:out`. 살아 있는 사람이 1명이면 `end()`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('survivalRoundMs: 4명 90초, 3명 60초', () => {});
test('survivalCuts: 4명 [3,4], 3명 [4]', () => {});
test('pickOut: 최저 점수, 같으면 낮은 콤보, 같으면 무작위', () => {});
test('서바이벌 방(클래식): 30초마다 꼴찌 탈락, 3초 전 경고, 1명 남으면 끝, 순위는 탈락 순서', (t) => {});
test('서바이벌: 탈락자는 클릭·자석·장판으로 점수를 얻지 못함, 그 색 원은 더 안 나옴 (Review Focus 3)', (t) => {});
test('서바이벌: 일시정지하면 다음 탈락 시각도 밀림 (Review Focus 4)', (t) => {});
test('서바이벌 방(아케이드): 3·4라운드 뒤 꼴찌 탈락, 탈락자는 증강 선택 건너뜀', (t) => {});
test('서바이벌: 3명 미만이면 봇으로 채워 시작', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/survival.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 클래식 서바이벌의 마지막 10초 가속은 `G.roundMs` 기준이라 덮어쓴 값으로 자연스럽게 맞는다. 탈락 문구: 현수막 `${name} 탈락!`, 탈락한 본인 화면 `탈락 · 구경 중`.
- [ ] **Step 4: 통과 확인** — `npm test` PASS
- [ ] **Step 5: 커밋** — `feat: 서바이벌 (30초마다·뒤쪽 라운드마다 꼴찌 탈락)` / `test: 서바이벌`

---

### Task 7: 타임어택

**Files:**
- Modify: `shared/src/rules.ts` (`TIME_ATTACK_RULES: RoomRules` — 기본 프리셋에서 `boss/laser/sabotage false, mapPct 0, eventPct 0, themePct 0, mode 'classic', roundSec 60`)
- Modify: `shared/src/protocol.ts` (`'room:solo'` 데이터에 `timeAttack?: boolean`, `RoomSnapshot.timeAttack: boolean`)
- Modify: `server/src/index.ts`, `server/src/room.ts` (생성자 옵션 `timeAttack`, 규칙 고정·`setRules` 무시, `start`에서 봇 없이 1명 허용, 스폰 색은 내 색만)
- Modify: `client/src/main.ts` (혼자 하기 화면 세 번째 선택, 바로 시작, 결과 `최고 기록 ○점` / `신기록!`, 처음 화면 최고 기록 한 줄), `client/index.html`
- Test: `shared/test/timeattack.test.ts`

**Interfaces:**
- Produces: `new Room(io, code, onEmpty, solo = false, timeAttack = false)`. `Room.timeAttack: boolean`. 화면 저장 키 `cb-timeattack-best` (try/catch로 감쌈).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('타임어택 방: 봇 없이 혼자 시작, 규칙 고정(보스·레이저·방해·맵 패턴·이벤트 끔), 규칙 변경 무시', () => {});
test('타임어택 방: 나오는 원은 내 색·노랑·무지개·황금·아이템뿐', (t) => { /* tick 여러 번 → 남의 색 kind 없음 */ });
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test shared/test/timeattack.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces.
- [ ] **Step 4: 통과 확인** — `npm test` PASS
- [ ] **Step 5: 화면 확인** — 타임어택 한 판 → 결과 화면 기록 표시, 두 번째 판에서 신기록 판정
- [ ] **Step 6: 커밋** — `feat: 타임어택 (혼자·봇 없이 60초 기록 도전)` / `test: 타임어택`

---

### Task 8: 게임 방법 · 도감 · 로드맵 반영

**Files:**
- Modify: `client/src/guide.ts`, `client/src/guideArt.ts` (심화에 슬라이드 3장: `growth` 성장 증강·시너지·진화, `team` 팀전, `survival` 서바이벌 — 그림은 기존 헬퍼 `ball`·`cur`·`label`로)
- Modify: `client/src/codex.ts` (성장 분류, 시너지 표, 진화 한 줄)
- Modify: `docs/ROADMAP.md` (해당 ⏳ → ✅, 새 단계 표), 스펙 상태 줄 `구현 완료`
- Test: `shared/test/guide.test.ts` (심화 슬라이드 수 7 → 10, 팀전 꺼진 방에서 팀 슬라이드 꺼짐 표시)

- [ ] **Step 1: 테스트 수정·추가** → 실패 확인
- [ ] **Step 2: 구현** → `npm test` PASS
- [ ] **Step 3: 커밋** — `feat(client): 게임 방법·도감에 성장 증강·팀전·서바이벌` / `test: 게임 방법 새 슬라이드` / `docs: 로드맵에 성장 증강·대기실 편의·새 모드 반영`

---

## 마무리

- 전체 `npm run typecheck`, `npm run build`, `npm test` 통과 확인.
- 브랜치 전체를 한 번 리뷰(가장 좋은 모델) 뒤 사용자에게 보고. 버전 올리기·푸시는 사용자 확인 후 별도.
