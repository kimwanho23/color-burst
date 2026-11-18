# 협력전 우클릭 보호막 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 협력전에서 우클릭(모바일은 화면 버튼)으로 1.5초 동안 피하는 공격을 모두 막는 보호막을 판마다 정해진 횟수만큼 쓴다.

**Architecture:** 남은 횟수와 종료 시각은 플레이어별 `CoopFx`에 두어 기존 플레이어 상태 전송·재접속 경로를 탄다. 서버 `CoopRun.damage()`가 아이템 방어막보다 먼저 보호막을 검사한다. 화면은 내 커서에만 파란 구체를 그리고, 우클릭은 클릭 판정에서 빼서 `coop:barrier` 요청으로 바꾼다.

**Tech Stack:** TypeScript, socket.io, Canvas 2D, `node --test` + tsx.

**Spec:** `docs/superpowers/specs/2026-11-18-coop-barrier-design.md`

## Global Constraints

- 수치는 `RULES.coop.barrier`에만 둔다: `durationMs: 1_500`, `uses: { easy: 3, normal: 2, hard: 1, expert: 0 }` (`CLAUDE.md`).
- 관통: `crush`, `rage`, `threat`는 보호막을 뚫는다. 아이템 방어막의 기존 규칙은 바꾸지 않는다.
- 보호막이 막으면 피해·기절·무적 부여 없이 `true`를 돌려주고, 아이템 방어막(`guardUntil`)은 소모하지 않는다.
- 코드 키는 `barrier`, 화면 문구는 '보호막'. 보스 수정 구간(`this.shield`)·아이템 '방어막'(`guard`)과 섞지 않는다.
- 구체는 자기 화면의 자기 커서에만 그린다. 동료가 켰다는 표시는 없다.
- 우클릭은 모든 모드에서 클릭 판정(`game:click`)으로 보내지 않는다.
- 커밋은 Conventional Commits, 한국어 요약, 한 커밋 한 목적. 각 커밋 전 `npm run typecheck`, `npm run build` 통과.

## 실행 순서 (사용자 규칙)

기능마다 테스트하지 않는다. Task 1~4의 구현을 모두 먼저 하고, Task 5에서 테스트를 한꺼번에 작성·실행한다. 통과하면 목적별로 나눠 커밋한다(shared+server 기능, 화면, 테스트, 문서). 원격 푸시는 하지 않는다.

## Review Focus

1. 보호막이 켜진 채 일시정지 → 재개 후 남은 시간이 그대로 이어지고, 클라이언트 구체도 일시정지 동안 줄지 않는다(서버 `shift`가 `barrierUntil`을 밀고 플레이어 상태를 다시 보낸다).
2. 켜진 동안 같은 사람이 우클릭 연타 → 횟수가 한 번만 줄고 종료 시각이 늘어나지 않는다.
3. 엑스퍼트·봇·탈락자·기절 중·카운트다운 중 요청 → 무시, 횟수 그대로.
4. 보호막과 아이템 방어막이 함께 켜진 채 탄에 맞음 → 피해 0, `guardUntil` 그대로. 보호막이 끝난 뒤 맞으면 그제야 방어막이 소모된다.
5. 우클릭을 꾹 누르거나 캔버스 밖에서 놓음 → 원을 잡지 않고 브라우저 메뉴도 뜨지 않는다. 대전 모드에서도 우클릭은 아무 일도 하지 않는다.

---

### Task 1: 공유 수치·타입·메시지

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.coop.special` 옆에 `barrier`)
- Modify: `shared/src/coopItems.ts:28-30` (`CoopFx`, `newCoopFx`)
- Modify: `shared/src/protocol.ts:274` (`coop:hit`), `:346` 근처 (`coop:barrier`)

**Interfaces:**
- Produces:
  ```ts
  RULES.coop.barrier: { durationMs: 1_500, uses: Record<'easy' | 'normal' | 'hard' | 'expert', number> }
  interface CoopFx { guardUntil; fireUntil; power; chain; barrierUntil: number; barrierLeft: number }
  // newCoopFx()는 barrierUntil 0, barrierLeft 0
  ClientToServer['coop:barrier']: () => void
  ServerToClient['coop:hit'] 페이로드에 barrier?: true  // 보호막이 막았을 때만, blocked: true와 함께
  ```

- [ ] **Step 1:** 위 타입·수치를 넣는다. `barrier`에 한 줄 주석(지속 시간, 판당 횟수, 관통 종류).
- [ ] **Step 2:** `npm run typecheck` → 오류 0 (기존 `newCoopFx` 사용처는 그대로 컴파일되어야 한다).

### Task 2: 서버 판정

**Files:**
- Modify: `server/src/coop.ts:111` (판 시작 시 횟수 채움), `:787-797` (`damage`), `:853-858` (`shift`), `activateSpecial` 옆에 새 메서드
- Modify: `server/src/room.ts:586` 옆 (`coopBarrier`)
- Modify: `server/src/index.ts:113` 옆 (이벤트 연결)

**Interfaces:**
- Consumes: Task 1의 `CoopFx.barrierUntil/barrierLeft`, `RULES.coop.barrier`.
- Produces:
  ```ts
  CoopRun.activateBarrier(p: PlayerState, now: number): boolean
  Room.coopBarrier(id: string): void
  ```

- [ ] **Step 1: 횟수 채움.** `:111`에서 사람에게 `newCoopFx()`를 줄 때 `barrierLeft = RULES.coop.barrier.uses[this.level]`.
- [ ] **Step 2: `activateBarrier`.** 거부 조건: `p.bot || p.outAt || !p.connected || p.hp <= 0 || now < p.stunUntil || !p.coopFx || p.coopFx.barrierLeft <= 0 || now < p.coopFx.barrierUntil`. 통과하면 `barrierLeft--`, `barrierUntil = now + durationMs`, `host.emitPlayers()`, `true`. 수정 구간(`this.shield`)에서도 허용한다.
- [ ] **Step 3: `Room.coopBarrier`.** `coopSpecial`과 같은 방 조건(`!this.coop || phase !== 'play' || pausedAt || now < startAt`이면 무시) 뒤 `activateBarrier` 호출. `index.ts`에 `socket.on('coop:barrier', …)`를 `coop:special`과 같은 모양으로.
- [ ] **Step 4: `damage`.** 첫 줄의 탈락·무적 검사 뒤, 아이템 방어막 검사 **앞**에: `by`가 `crush`·`rage`·`threat`가 아니고 `now < p.coopFx.barrierUntil`이면 `immuneUntil`은 건드리지 않고 `coop:hit`을 `{ playerId, by, hp: p.hp, dmg: 0, immuneUntil: p.immuneUntil, blocked: true, barrier: true, circleId? }`로 보내고 `true`. 통계 `st.hits`는 늘리지 않는다.
- [ ] **Step 5: `shift`.** `guardUntil`처럼 `if (fx.barrierUntil) fx.barrierUntil += delta`. 하나라도 밀었으면 끝에서 `host.emitPlayers()`를 부른다(클라이언트 구체 시간 보정).
- [ ] **Step 6:** `npm run typecheck` → 오류 0.

### Task 3: 클라이언트 입력·피격 처리·소리

**Files:**
- Modify: `client/src/main.ts:1269` (`pointerdown`), `:696-712` (`checkBulletHit`), `:713-723` (`coop:hit`)
- Modify: `client/src/audio.ts:81` (`sfx`)
- Modify: `client/src/coopUI.ts` (보호막 HUD·모바일 버튼), `client/src/style.css`

**Interfaces:**
- Consumes: Task 1 메시지.
- Produces:
  ```ts
  sfx.barrierOn: () => void
  // coopUI.ts
  export function renderBarrierHud(stage: HTMLElement, p: PlayerState | undefined, level: CoopLevel, touch: boolean, onUse: () => void): void
  ```

- [ ] **Step 1: 우클릭 분리.** `pointerdown` 맨 앞: `e.pointerType === 'mouse' && e.button !== 0`이면 클릭 판정을 하지 않는다. 그중 `e.button === 2`이고 협력전 진행 중·일시정지 아님·`serverNow() >= startAt`이면 `socket.emit('coop:barrier')`. `cv`에 `contextmenu` → `preventDefault()`.
- [ ] **Step 2: 켜는 소리.** `sfx.barrierOn`(부드럽게 올라가는 짧은 음, 기존 `tone`/`noise` 조합). 플레이어 상태를 받을 때 내 `coopFx.barrierUntil`이 직전 값보다 커지면 재생한다(서버가 승인한 경우에만 울리게).
- [ ] **Step 3: 화면 예측.** `checkBulletHit`의 방어막 분기(`:709`) 옆에 보호막 분기: `m.coopFx && now < m.coopFx.barrierUntil`이면 `coop:hurt`는 그대로 보내되 `m.immuneUntil`을 바꾸지 않고 맞은 연출 없이 돌아간다.
- [ ] **Step 4: 피드.** `coop:hit`의 `blocked` 분기에서 `barrier`이면 동료 피드 문구를 `${p.name}: 보호막으로 막음`(아이콘은 방어막 아이콘 재사용 가능), 내 화면은 기존 '막음!'과 막는 소리.
- [ ] **Step 5: HUD·모바일 버튼.** `renderBarrierHud`를 `renderSpecialHud` 호출하는 두 곳(`main.ts:133`, `:1415`)에서 함께 부른다. 협력전 아님·엑스퍼트(`uses 0`)·`p` 없음이면 숨긴다. PC는 스페셜 HUD 근처에 '보호막 n · 우클릭'. 터치(`(pointer: coarse)` 또는 마지막 `pointerType === 'touch'`)면 같은 자리를 누를 수 있는 버튼으로 만들고 누르면 `onUse`(= `coop:barrier` 전송). 0회면 비활성 모양. 위치·모양은 구현자 판단.
- [ ] **Step 6:** `npm run typecheck` → 오류 0.

### Task 4: 커서 구체

**Files:**
- Modify: `client/src/render.ts:102` (`DrawState.cursor`), `:758` (`drawCursor`)
- Modify: `client/src/main.ts:1526-1528`

**Interfaces:**
- Produces: `DrawState.cursor`에 `barrier: number` — 0이면 꺼짐, 켜진 동안 남은 비율 1→0.

- [ ] **Step 1:** `main.ts`에서 `barrier = m?.coopFx && now < m.coopFx.barrierUntil ? (m.coopFx.barrierUntil - now) / RULES.coop.barrier.durationMs : 0`.
- [ ] **Step 2:** `drawCursor`에서 `c.barrier > 0`이면 커서 뒤에 반지름 약 34의 연한 파란 반투명 원(채움 알파 약 .18, 테두리 알파 약 .6). 남은 비율이 0.25 아래로 내려가면 반지름·알파를 줄여 사라지게 한다. 효과 줄이기(`prefersReduced`)면 일렁임 없이 정적으로. 정확한 값은 구현자 판단.
- [ ] **Step 3:** `npm run typecheck` → 오류 0, `npm run build` → 성공.

### Task 5: 테스트 (Task 1~4 뒤 한꺼번에)

**Files:**
- Create: `shared/test/coopbarrier.test.ts` (`coopitems.test.ts`의 `coopRoom` 하네스 방식을 그대로 복사해 쓴다)
- Modify: 클라이언트 우클릭 테스트를 둘 기존 파일이 없으면 `main.ts`에서 판정 함수를 `client/src/` 순수 함수로 빼고 같은 테스트 파일에서 검사한다.

- [ ] **Step 1: 테스트 작성.**
  - `수치`: `RULES.coop.barrier.durationMs === 1500`, `uses`가 `{ easy: 3, normal: 2, hard: 1, expert: 0 }`.
  - `판 시작 횟수`: 노말 1인 방 → `me.coopFx.barrierLeft === 2`. 엑스퍼트 → 0. 봇은 `coopFx` 없음.
  - `발동`: `activateBarrier(me, now)` → `true`, `barrierLeft === 1`, `barrierUntil === now + 1500`.
  - `켜진 중 재발동`: 바로 다시 → `false`, `barrierLeft === 1`, `barrierUntil` 그대로.
  - `거부`: 기절 중(`stunUntil > now`), 탈락(`outAt`), 0회, 엑스퍼트 → 모두 `false`이고 `barrierLeft` 그대로.
  - `막기`: 켠 뒤 `bullet`, `wall`, `laser`, `beam`, `slam`, `seal`, `safe`, `homing` 각각 `damage` → `true`, `hp` 그대로, `immuneUntil` 그대로, 보낸 `coop:hit`에 `blocked: true, barrier: true`.
  - `관통`: 켠 뒤 `crush`, `rage`, `threat` → `hp`가 해당 난이도 `hurt` 만큼 줄어든다.
  - `방어막 미소모`: `applyItem(me, 'guard')` 후 보호막 켜고 `bullet` → `guardUntil` 그대로. `now + 1500` 이후 `bullet` → 방어막이 막고 `guardUntil === 0`.
  - `종료`: `now + 1500`에 `bullet` → 피해를 받는다.
  - `일시정지`: 켜고 `shift(5000)` → `barrierUntil === now + 1500 + 5000`.
  - `방 조건`: `Room.coopBarrier`를 카운트다운 중(`now < startAt`)에 부르면 `barrierLeft` 그대로.
  - `우클릭`: 마우스 `button 2`는 클릭 판정 대상이 아니고 `button 0`은 대상이다(추출한 순수 함수로).
- [ ] **Step 2:** `npm test` → 새 테스트 포함 전체 통과(기존 595개 + 신규).
- [ ] **Step 3:** `npm run typecheck`, `npm run build` 통과.
- [ ] **Step 4: 커밋 (목적별).**
  ```bash
  git add shared/src server/src
  git commit -m "feat: 협력전 우클릭 보호막 판정 추가"
  git add client/src
  git commit -m "feat(client): 협력전 보호막 입력·구체·HUD"
  git add shared/test
  git commit -m "test: 협력전 보호막 발동·막기·관통 테스트 추가"
  ```
  각 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 6: 문서

**Files:**
- Modify: `docs/HANDOFF.md` (유도탄 절 아래 '우클릭 보호막' 절: 동작, 수치, 관통, 주요 코드 위치, 실제 플레이 확인 항목. 111행 '구상 단계' 문장 갱신)
- Modify: `docs/ROADMAP.md:7` (다음 후보 갱신)
- Modify: `docs/superpowers/specs/2026-11-18-coop-barrier-design.md` (상태: 구현 완료)

- [ ] **Step 1:** 문서 갱신. 실제 플레이 확인 항목: 우클릭 체감·연타, 모바일 버튼 위치, 구체 가독성, 일시정지·재접속 뒤 이어짐.
- [ ] **Step 2: 커밋.** 설계·계획 문서와 함께 `docs: 협력전 우클릭 보호막 설계·계획·인수인계 정리`.
