# 도우미·변화 요소 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아케이드 새 능력(넓은 손·자석·잭팟), 클래식·아케이드 공통 아이템 원 16종, 아케이드 진행자 이벤트(라운드 테마 포함)와 그 이펙트를 넣는다.

**Architecture:** 판정은 지금처럼 서버가 한다. 순수 규칙(판정 범위, 버프, 아이템 효과, 잭팟, 진행자 이벤트 계산)은 `shared`에 함수로 두고 `node:test`로 검증한다. 서버 `Room`은 그 함수를 불러 상태를 바꾸고 이벤트를 보내며, 클라이언트는 받은 이벤트로 연출만 한다. 원 위치는 계속 `circlePos`(발사 정보 + 시각)로 결정하고, 시간 정지·역발사는 원 데이터에 필드를 더해 같은 식으로 계산한다.

**Tech Stack:** TypeScript 5.6, Node 20+ (`node:test` + `tsx`), Socket.IO 4, Vite 5, Canvas 2D, lucide

**Spec:** `docs/ROADMAP.md`의 "새 능력: 잭팟", "진행자 이벤트", "도우미·변화 요소"(규칙 메모, 아이템 목록, 효과 겹침 규칙, 이펙트) 섹션

## Global Constraints

- 커밋: `<타입>(<범위>): <한국어 요약>` (CONTRIBUTING.md). 한 커밋 한 목적. 커밋 전 `npm run typecheck`와 `npm run build` 통과
- 방 규칙 기본값·밸런스 수치는 `shared/src/rules.ts`의 `RULES`에 둔다. 아케이드 능력 수치는 기존 관례대로 `shared/src/arcade.ts`(`ABILITIES`, `CURSE`와 같은 상수)
- `main` 푸시 = Render 배포. 이 계획은 **푸시하지 않는다**. `render.yaml`은 건드리지 않는다
- "내 원" = 내 색, 노란색(`'y'`), 무지개. 넓은 손·자석·장판은 내 원만 잡는다. 남의 색·보스·아이템 원은 직접 정확히 눌렀을 때만
- 판정 순서: ① 보통 판정으로 직접 맞은 원 ② 넓은 손 범위 안의 내 원 전부 ③ (①② 모두 없을 때) 자석 범위 안 가장 가까운 내 원 ④ 보스
- 점수 배율 순서: 기본 점수(+능력 가산) → 피버(또는 여운) → 점수 2배·황금 손(서로 겹치지 않음, ×2 한 번) → 잭팟. 저주 배율(`scoreBoostOf`)은 지금처럼 곱한다. 최종값 `Math.round`
- 저주의 대가는 아이템이 못 뚫는다 (외길 노란색 0점, 유리 대포 −5점, 표적 자처 표적 유지)
- 아이템 효과는 아케이드 라운드가 끝나면 사라진다. 같은 아이템을 다시 잡으면 남은 시간에 더하되 원래 효과 시간의 2배까지
- 폭죽·필드 클리어(이하 "블라스트")는 남의 색까지 잡고, 견제 페널티·표적·반격·강탈 없음, 잭팟 없음, 보스·아이템 원 제외, 점수는 원마다 평소 규칙(남의 색 +1)
- 잭팟: 터질 확률 5/10/15/25% (상한 50%), 배율 ×1.5 (70%) / ×2 (25%) / ×3 (5%). 보스 타격·막타 포함, MVP 제외, 블라스트 제외
- 진행자 이벤트: 아케이드 전용, 라운드 사이마다 10%, 한 게임 최대 2번
- 이펙트: 금색 = 점수, 하늘색 = 보조, 아이템 등급색 = 흔함 흰 / 희귀 파랑 / 전설 프리즘. '화면 효과 줄이기' 켜짐 → 흔들림·번쩍임·파편 생략, 링과 숫자만. 파티클 상한
- 슬로우, 안개, 얼음, 치명타 피해(짝 능력), 콤보 단계 보상은 이번 범위 밖

### 이 계획이 새로 정한 것 (스펙에 없던 값, 검토 대상)

| 항목 | 값 |
|---|---|
| 아이템 원 등장 | 일반 원이 생길 때마다 2.5% 확률로 대신 아이템 원. 등급 확률 흔함 70 / 희귀 25 / 전설 5 |
| 아이템 원 크기·점수 | 반지름 34, 잡아도 점수·콤보 없음 (효과만) |
| 아이템 넓은 손·자석 수치 | 넓은 손 반지름 35, 자석 거리 70 (능력과 더하고 능력 상한 적용) |
| 장판 | 반지름 90 |
| 폭죽 | 반지름 180 |
| 즉시 피버 (피버 중) | 피버 시간 +3초 |
| 보호막 | 견제당해도 콤보 끊김·강탈 없음 (상대 흡혈귀 대가는 그대로) |
| 꼴찌 보정 (켜진 방) | 꼴찌가 잡은 아이템 효과 시간 ×1.5 |
| 방 규칙 | `items` 아이템 원 (기본 켜짐, 하드코어 꺼짐), `hostEvents` 진행자 이벤트 (기본 켜짐, 아케이드에서만 보임) |
| 봇 | 넓은 손·자석 능력은 고르지 않음. 아이템 원 가중치 5 |
| 진행자 | 이름·모습 미정 → 화면 표시는 "진행자" + 아이콘, `HOST_NAME` 상수 하나로 나중에 교체 |
| 진행자 등장 시 | 능력 선택 시간 +3초 (룰렛 연출 시간) |
| 순위 역전 룰렛 | 1등과 꼴찌의 점수를 맞바꿈. 다른 이벤트 가중치 1, 이것만 0.2 |
| 세금 | 걷은 돈은 다음 라운드에 가장 많이 번 사람(라운드 점수 증가량 기준)이 라운드 끝에 받음 |
| 라운드 테마 수치 | 골드 러시 노란 확률 0.6, 보스 러시 보스 3마리(라운드 25%·55%·85% 지점), 무지개 비 15%, 아이템 원 폭주 확률 ×4, 역발사 = 원이 화면 가장자리에서 중앙으로 |

## Review Focus

1. **일시정지 중 버프·장판·시간 정지** — 멈췄다 풀면 남은 시간이 그대로여야 한다. `shiftTimes` 테스트(Task 3)와 시간 정지 `holds` 이동 테스트(Task 5)
2. **재접속** — 게임 중 새로고침하면 버프 아이콘, 장판, 멈춘 원, 역발사 원이 같은 위치로 복원된다. `game:sync`에 `zones`, `theme`가 들어가고 원·플레이어 데이터에 필드가 들어 있다 (Task 6, 10 수동 확인 단계)
3. **같은 원을 두 사람이 동시에** — 노란 원을 두 사람의 장판·넓은 손이 같은 틱에 노리면 한 번만 잡힌다. 서버 `claim`은 원이 `circles`에 아직 있을 때만 처리 (Task 6 수동 확인 + 코드 가드)
4. **빈 곳 페널티가 꺼진 방** — 헛클릭 무효 아이템이 나오지 않는다. `rollItem` 테스트(Task 5)
5. **필드 클리어로 원 20개 이상 동시 처리** — 잭팟 없음, 점수 합이 원마다 평소 규칙과 같음, 파티클 상한으로 프레임 유지. `resolveClaim` 블라스트 테스트(Task 4)와 렌더 상한(Task 8)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `shared/src/rules.ts` (수정) | 판정 범위(`isHit` pad, `isMine`, `assistTargets`), 버프 상태와 헬퍼, `resolveClaim` 옵션(경로·잭팟·블라스트), `circlePos`의 `holds`·`rev`, `RULES.items`, 방 규칙 `items`/`hostEvents` |
| `shared/src/arcade.ts` (수정) | 능력 `wideHand`·`magnet`·`jackpot`, 분류 `보조`, `JACKPOT`, `jackpotMult` |
| `shared/src/items.ts` (새 파일) | 아이템 정의 `ITEMS`, 등급·아이템 뽑기, 플레이어에게 적용하는 효과 `applyItem`, 방 단위 효과 종류 반환 |
| `shared/src/host.ts` (새 파일) | 진행자 이벤트 정의, 뽑기, 적용(점수·능력·선택지·테마), 라운드 테마 상수 |
| `shared/src/protocol.ts` (수정) | 새 이벤트(`item:got`, `zone:add`, `circles:hold`, `arcade:host`), `PlayPayload.zones/theme`, `ClaimResult` 확장, 보스 이벤트 `jackpot` |
| `shared/test/*.test.ts` (새 파일) | 규칙 함수 테스트 |
| `server/src/room.ts` (수정) | 클릭 판정 순서, 아이템 처리, 장판 틱, 블라스트, 시간 정지, 내 색 비, 테마 적용 생성, 진행자 이벤트, 일시정지 이동 |
| `server/src/bot.ts` (수정) | 아이템 원 가중치 |
| `client/src/main.ts` (수정) | 클릭 예측(빈 곳 표시 여부), 새 이벤트 처리, 버프 HUD, 진행자 오버레이 연결 |
| `client/src/render.ts` (수정) | 아이템 원, 장판, 새 Fx(링 범위·끌림 선·충격파·번쩍임·동전), 정지 표시, 잭팟 단계, 파티클 상한, `toScreen` |
| `client/src/effectsUI.ts` (새 파일) | DOM 오버레이: 아이템 룰렛 팝업, 버프 바, 점수판 버프 칩, 진행자 룰렛 |
| `client/src/icons.ts`, `audio.ts`, `rulesUI.ts`, `style.css`, `index.html` (수정) | 아이콘·효과음·방 규칙 토글·스타일·DOM 자리 |
| `package.json` (수정) | `test` 스크립트 |

---

### Task 1: 테스트 실행 환경

**Files:**
- Modify: `package.json` (scripts)
- Create: `shared/test/geometry.test.ts`

**Interfaces:**
- Produces: `npm test` = `node --import tsx --test "shared/test/**/*.test.ts"` (tsx는 server 의존성으로 이미 설치됨, 새 의존성 없음)

- [ ] **Step 1: 루트 `package.json`에 `"test": "node --import tsx --test \"shared/test/**/*.test.ts\""` 추가**
- [ ] **Step 2: 기존 동작을 고정하는 테스트 작성** — `isHit`: 반지름 40 원 중심에서 52 떨어진 점은 맞음, 53은 안 맞음 (`RULES.hitPad` 12)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHit, type Circle } from '../src/index.ts';
const still = (r = 40): Circle => ({ id: 1, kind: 0, angle: 0, speed: 0, r, born: 0 });
test('isHit 기본 여유 12', () => {
  assert.equal(isHit(still(), 0, 800 + 52, 450), true);
  assert.equal(isHit(still(), 0, 800 + 53, 450), false);
});
```

- [ ] **Step 3: `npm test` 실행** → PASS 1
- [ ] **Step 4: 커밋** `build: node:test 기반 테스트 스크립트 추가`

---

### Task 2: 판정 범위 — `isHit` 여유, 내 원, 보조 판정 대상

**Files:**
- Modify: `shared/src/rules.ts` (`isHit` 부근)
- Test: `shared/test/geometry.test.ts`

**Interfaces:**
- Produces:
  - `isHit(c: Circle, t: number, x: number, y: number, pad = RULES.hitPad): boolean`
  - `isMine(kind: CircleKind, color: ColorIndex): boolean` — 내 색·`'y'`·`'rainbow'`만 true
  - `assistTargets(circles: Iterable<Circle>, color: ColorIndex, x: number, y: number, t: number, reach: number, magnet: number, skip?: ReadonlySet<number>): { range: Circle[]; magnet: Circle | null }` — `range`: `reach > 0`이면 `isMine`이고 `isHit(c,t,x,y,RULES.hitPad+reach)`인 원 전부(`skip` 제외). `magnet`: `range`가 비고 `magnet > 0`이면 `isHit(…, hitPad+magnet)`인 내 원 중 원 둘레까지 거리가 가장 가까운 것

- [ ] **Step 1: 실패하는 테스트**
  - `isHit(still(), 0, 852+20, 450, 12+20)` → true
  - `isMine(0, 0)`, `isMine('y', 2)`, `isMine('rainbow', 1)` → true / `isMine(1, 0)`, `isMine('boss', 0)`, `isMine('item', 0)` → false
  - 원 3개(내 색 at +60, 노란 at −60, 남의 색 at +0,+70)에 `reach 25`, 클릭 (800,450) → `range` = 내 색·노란 2개, 남의 색 없음
  - 같은 배치에 `reach 0, magnet 50`, 클릭이 내 색 원 둘레에서 40 떨어짐 → `magnet`이 그 원, `range` 빈 배열
  - `reach 25`로 하나라도 잡히면 `magnet`은 null
- [ ] **Step 2: `npm test`** → FAIL (`isMine` 없음)
- [ ] **Step 3: 구현** (`CircleKind`에 `'item'` 추가는 Task 5. 여기서는 `isMine`이 `typeof kind === 'number' ? kind === color : kind === 'y' || kind === 'rainbow'`)
- [ ] **Step 4: `npm test`** → PASS
- [ ] **Step 5: 커밋**은 Task 4 끝에서 능력과 함께 (`feat(shared): …`). 여기서는 커밋하지 않는다

---

### Task 3: 버프 상태

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerState`, `newPlayer`, `startRound`, `breakCombo`, `resolveMiss`, `resolveClaim`)
- Test: `shared/test/buffs.test.ts`

**Interfaces:**
- Produces:
  - `type BuffId = 'wideHand' | 'magnet' | 'missGuard' | 'comboLock' | 'guard' | 'double' | 'paint'`
  - `PlayerState.buffs: Partial<Record<BuffId, number>>` (끝나는 서버 시각), `PlayerState.goldLeft: number` (황금 손 남은 원 수)
  - `buffOn(p: PlayerState, id: BuffId, now: number): boolean`
  - `addBuff(p: PlayerState, id: BuffId, ms: number, now: number): void` — `until = min(max(until, now) + ms, now + 2*ms)`
  - `shiftTimes(p: PlayerState, since: number, delta: number): void` — `since` 이후에 끝나는 `feverUntil·markedUntil·afterUntil·blurUntil·buffs.*`를 `delta`만큼 뒤로 (room.resume의 기존 4줄을 이 함수로 대체)
  - `itemMult(p: PlayerState, now: number, consume: boolean): number` — `double` 켜짐 → 2 (황금 손 소모 안 함) / 아니면 `goldLeft > 0` → 2 (`consume`이면 1 줄임) / 아니면 1
- 규칙 반영:
  - `startRound`: `buffs = {}`, `goldLeft = 0`
  - `breakCombo`: `comboLock` 켜짐이면 아무것도 안 하고 false (`now` 인자 추가)
  - `resolveMiss`: `missGuard` 켜짐 → 콤보·피버 페널티 건너뜀, 침착 횟수 유지, **유리 대포 −5는 그대로**
  - `resolveClaim`: 노란 원 + `paint` 켜짐 → 내 색 점수·내 색 피버 충전 (외길이면 0점 유지) / 남의 색 견제 시 원 주인이 `guard` 켜짐 → 콤보 안 끊김(`res.shielded = true`, 방패 횟수 안 씀), 강탈 0 (흡혈귀 `CURSE.vampire`는 그대로) / 최종 배율에 `itemMult(claimer, now, true)` 곱함

- [ ] **Step 1: 실패하는 테스트** (`newPlayer`로 플레이어 2명, `toGameRules(DEFAULT_RULES)`)
  - `addBuff(p,'double',5000,0)` → `5000`; 이어서 `addBuff(p,'double',5000,1000)` → `10000`; 이어서 `addBuff(p,'double',5000,2000)` → `12000` (상한 `now + 2×ms`)
  - `shiftTimes(p, 500, 3000)`: `buffs.double 10000 → 13000`, `markedUntil 400`은 그대로
  - `comboLock` 켜고 견제당함(남이 내 색 잡음) → 내 `combo` 유지
  - `missGuard` 켜고 `resolveMiss` → `combo`·`fever` 그대로, `calmLeft` 그대로 / 유리 대포 보유 시 점수 −5
  - `paint` 켜고 노란 원 → `gained === 3`, 외길 보유 시 `gained === 0`
  - `double` + 내 색 → `gained === 6`; `goldLeft = 2`만 → 6이고 `goldLeft === 1`; `double`과 `goldLeft` 둘 다 → 6이고 `goldLeft` 그대로
  - 원 주인 `guard` 켜짐 + 상대 강탈 능력 → `brokeComboOf === null`, `shielded === true`, `plundered === 0`
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: `npm test`** → PASS, `npm run typecheck` → 통과 (`room.resume`을 `shiftTimes` 호출로 바꿔야 통과)

---

### Task 4: 아케이드 능력 — 넓은 손, 자석, 잭팟 + 블라스트 판정

**Files:**
- Modify: `shared/src/arcade.ts`, `shared/src/rules.ts` (`resolveClaim`, `ClaimResult`), `server/src/room.ts` (`roll`의 `exclude`는 그대로, 봇 선택), `client/src/icons.ts`
- Test: `shared/test/arcade.test.ts`

**Interfaces:**
- Produces (arcade.ts):
  - `AbilityCategory`에 `'보조'` 추가, `AbilityId`에 `'wideHand' | 'magnet' | 'jackpot'`
  - `ABILITIES`에 추가: `{ id: 'jackpot', name: '잭팟', cat: '점수', values: [5,10,15,25], cap: 50, desc: (v) => \`원을 잡을 때 ${v}% 확률로 잭팟 (×1.5~×3)\` }`, `{ id: 'wideHand', name: '넓은 손', cat: '보조', values: [15,25,35,55], cap: 80, desc: (v) => \`클릭 둘레 ${v} 안의 내 원을 한 번에\` }`, `{ id: 'magnet', name: '자석', cat: '보조', values: [30,50,70,110], cap: 150, desc: (v) => \`빗나가면 ${v} 안의 가장 가까운 내 원을 잡음\` }`
  - `export const JACKPOT = { mults: [1.5, 2, 3], odds: [70, 25, 5] } as const`
  - `jackpotMult(m: Mods, rand = Math.random): number` — `rand() < m.jackpot/100`이면 odds로 고른 배율, 아니면 1
  - `ASSIST_ABILITIES: readonly AbilityId[] = ['wideHand', 'magnet']` (봇 제외용)
- Produces (rules.ts):
  - `type ClaimVia = 'click' | 'range' | 'magnet' | 'zone' | 'blast'`
  - `ClaimResult`에 `via: ClaimVia`, `jackpot: number` (터지지 않으면 1)
  - `resolveClaim(claimer, kind, players, now, G, opts: { via?: ClaimVia; rand?: () => number } = {})` — `via === 'blast'`: 남의 색은 `type 'feverSteal'`, `pts = P.stealCalm`, 콤보 끊기·피버 감소·표적·반격·강탈·흡혈귀·원 주인 콤보 끊기 **모두 없음**, `stats.steals` 증가 안 함, 잭팟 안 굴림. 그 밖의 경로: 최종 배율 마지막에 `jackpotMult(m, rand)`
  - `reachOf(p: PlayerState, now: number): number` = `min(ABILITY.wideHand.cap, m.wideHand + (buffOn wideHand ? RULES.items.wideHand : 0))`, `magnetOf(p, now)` 같은 식 (`RULES.items`는 Task 5에서 만드니 이 Task에서 `RULES.items = { wideHand: 35, magnet: 70 }`부터 둔다)
- Consumes: Task 2 `assistTargets`, Task 3 `buffOn`, `itemMult`

- [ ] **Step 1: 실패하는 테스트**
  - `modsOf([{id:'jackpot',tier:3},{id:'jackpot',tier:3}]).jackpot === 50` (상한)
  - `jackpotMult` — `jackpot 25`, rand 순서 `[0.1, 0.5]` → 1.5; `[0.1, 0.8]` → 2; `[0.1, 0.97]` → 3; `[0.3]` → 1
  - 잭팟 레전드 + 내 색, rand `[0.1, 0.8]` → `gained === 6`, `jackpot === 2`; 피버 ×3 중 → `round(3*3*2) = 18`
  - 블라스트로 남의 색(주인 콤보 5, 표적 아님) → `gained 1`, `type 'feverSteal'`, `marked false`, 주인 `combo === 5`, 내 `combo` 그대로, `stats.steals === 0`; 잭팟 보유 + rand 0 → `jackpot === 1`
  - 블라스트로 원 주인이 표적이어도 `type !== 'counter'`
  - `reachOf`: 능력 55+55 → 80; 능력 55 + 아이템 버프 → 80
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**. `icons.ts` `ABILITY_ICON`에 `jackpot: Coins`, `wideHand: Hand`, `magnet: Magnet`, `CATEGORY_ICON`에 `보조: LifeBuoy` (lucide에서 import)
- [ ] **Step 4: 봇 선택** — `room.ts endRound`의 봇 선택에서 `ASSIST_ABILITIES` 포함 선택지는 후보에서 뺀다 (모두 그것뿐이면 그대로 고름)
- [ ] **Step 5: `npm test`, `npm run typecheck`, `npm run build`** → 모두 통과
- [ ] **Step 6: 커밋** `feat(shared): 아케이드 능력 잭팟·넓은 손·자석 규칙 추가` (Task 2~4 shared 변경 + icons + 봇 선택. 서버 판정 연결은 Task 6)

---

### Task 5: 아이템 정의와 원 데이터 (아이템 원, 시간 정지)

**Files:**
- Create: `shared/src/items.ts`
- Modify: `shared/src/rules.ts` (`RULES.items`, `CircleKind`, `Circle`, `circlePos`, `makeCircle`, `RoomRules`/`DEFAULT_RULES`/`PRESETS.hardcore`/`sanitizeRules`/`GameRules`), `shared/src/index.ts`
- Test: `shared/test/items.test.ts`

**Interfaces:**
- Produces (rules.ts):
  - `RULES.items = { chance: 0.025, tierOdds: [70, 25, 5], r: 34, wideHand: 35, magnet: 70, zoneR: 90, zoneMs: 4000, bombR: 180, freezeMs: 1500, feverCharge: 50, feverExtendMs: 3000, comebackDur: 1.5 }`
  - `CircleKind`에 `'item'`; `Circle`에 `itemTier?: 0 | 1 | 2`, `holds?: [from: number, ms: number][]`, `rev?: boolean`(Task 9에서 사용)
  - `circlePos(c, t)`: 경과 시간 = `t - born - Σ overlap(hold, [born, t])` (hold 구간과 겹친 만큼 뺌)
  - `RoomRules.items: boolean`, `RoomRules.hostEvents: boolean`; 기본 둘 다 true, `PRESETS.hardcore`는 `items: false`; `sanitizeRules` 불리언 목록에 둘 추가; `GameRules.items`, `GameRules.hostEvents`
  - `makeCircle(…, opts: { itemChance?: number; forceKind?: CircleKind; yellowChance?: number; rainbowChance?: number } = {})` — 먼저 `rand() < (opts.itemChance ?? 0)`이면 `kind 'item'`, `r = RULES.items.r`, `itemTier`는 `tierOdds`로. 아니면 기존 로직 (`forceKind`가 있으면 그 색, 확률 덮어쓰기는 테마용)
- Produces (items.ts):
  - `type ItemId = 'wideHand' | 'magnet' | 'missGuard' | 'comboLock' | 'guard' | 'markClear' | 'feverCharge' | 'instantFever' | 'goldHand' | 'double' | 'paint' | 'rain' | 'zone' | 'bomb' | 'timeStop' | 'fieldClear'`
  - `ITEMS: Record<ItemId, { name: string; tier: 0|1|2; ms?: number; buff?: BuffId }>` — 스펙 표 그대로:
    - 흔함(0): 넓은 손 5000, 자석 5000, 헛클릭 무효 8000, 콤보 고정 5000, 보호막 5000, 표적 해제, 피버 충전
    - 희귀(1): 즉시 피버, 황금 손(원 5개), 점수 2배 5000, 물들이기 5000, 내 색 비 3000, 장판, 폭죽
    - 전설(2): 시간 정지, 필드 클리어
  - `rollItem(tier: 0|1|2, G: GameRules, rand = Math.random): ItemId` — 그 등급에서 균등. `!G.missPenalty`면 `missGuard` 제외
  - `type RoomAction = null | { kind: 'zone' | 'bomb' | 'fieldClear' | 'timeStop' | 'rain' }`
  - `applyItem(p: PlayerState, id: ItemId, now: number, G: GameRules, players: PlayerState[]): RoomAction` — 버프류는 `addBuff(p, buff, ms × (G.comeback && isLast ? comebackDur : 1), now)`, `markClear`는 표적 자처가 없으면 `markedUntil = now`, `feverCharge`는 피버 게이지 +50(피버 시작 가능, `chargeFever`로 rules.ts의 `addFever`를 export), `instantFever`는 피버 아니면 `startFever`, 피버 중이면 `feverUntil += feverExtendMs`, `goldHand`는 `goldLeft += 5`. 방 단위 효과는 해당 `RoomAction` 반환
  - rules.ts에서 `isLast`, `startFever`, `addFever`(이름 `chargeFever`로)를 export
  - `holdCircles(circles: Iterable<Circle>, now: number, ms: number): number[]` — 보스 포함 모든 원에 `[now, ms]` 추가, id 목록 반환
- Consumes: Task 3 `addBuff`, `BuffId`

- [ ] **Step 1: 실패하는 테스트**
  - `circlePos`: 속도 100, `born 0`, `holds [[1000,1500]]` → t=1000과 t=2500의 x가 같고, t=3500은 t=2000(holds 없음)과 같음
  - `makeCircle(…, { itemChance: 1 })` → `kind 'item'`, `r 34`, `itemTier` 0~2
  - `rollItem(0, G 빈 곳 페널티 끔)`을 rand 값 여러 개로 → 결과에 `missGuard` 없음
  - `applyItem(p,'double',…)` → `buffOn(p,'double',now)`; 꼴찌 보정 켬 + 꼴찌 → `buffs.double === now + 7500`
  - `applyItem` 표적 자처 보유 + `markClear` → `markedUntil` 유지
  - `applyItem` `instantFever` 피버 중 → `feverUntil` +3000
  - `applyItem(…,'bomb')` → `{ kind: 'bomb' }`
  - `sanitizeRules(DEFAULT_RULES, { items: false })`.items === false, `PRESETS.hardcore.rules.items === false`
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현** (`index.ts`에 `export * from './items.ts'`)
- [ ] **Step 4: `npm test`, `npm run typecheck`** → 통과. `'item'` 추가로 깨지는 곳(render `BasicKind`, bot 가중치, `resolveClaim` 호출부)은 Task 6·7·8에서 채우되, 이 Task에서는 타입만 맞춘다 (render: `item`은 일단 건너뜀)

---

### Task 6: 서버 — 클릭 판정 순서, 아이템, 장판, 블라스트, 시간 정지, 잭팟

**Files:**
- Modify: `server/src/room.ts`, `server/src/bot.ts`, `shared/src/protocol.ts`

**Interfaces:**
- Produces (protocol.ts):
  - `export interface Zone { id: number; by: string; x: number; y: number; r: number; until: number }`
  - `PlayPayload.zones: Zone[]` (`theme`은 Task 10에서 추가)
  - ServerToClient: `'item:got': (d: { circleId: number; by: string; item: ItemId; tier: 0|1|2; x: number; y: number }) => void`, `'zone:add': (z: Zone) => void`, `'circles:hold': (d: { ids: number[]; at: number; ms: number }) => void`
  - `'boss:hit'`·`'boss:killed'` 데이터에 `jackpot: number`
- Room 동작:
  - `hitWithLag(c, now, x, y, pad = RULES.hitPad)` — `isHit`에 pad 전달
  - `click`: (1) `circleId`가 있고 직접 맞음 → 그 원 처리 (`item`이면 `claimItem`, 보스면 `hitBoss`, 아니면 `claim(…,'click')`). (2) 직접 처리 여부와 상관없이 `reachOf(p) > 0`이면 남은 원 중 `isMine`이고 `hitWithLag(c, now, x, y, hitPad + reach)`인 원 전부 `claim(…,'range')`. (3) (1)(2)에서 하나도 못 잡았고 `magnetOf(p) > 0`이면 `hitWithLag(…, hitPad + magnet)`인 내 원 중 클릭 시점 위치 기준 가장 가까운 것 `claim(…,'magnet')`. (4) 아무것도 없으면 지금처럼 `resolveMiss`. `circleId`가 있었는데 직접 안 맞았으면 `rejectTo`는 그대로 보낸다
  - `claim(p, c, now, via)`: 맨 앞에 `if (!this.circles.has(c.id)) return` (Review Focus 3), `resolveClaim(…, { via })`
  - `claimItem(p, c, now)`: 원 삭제 → `rollItem(c.itemTier, G)` → `applyItem` → `'item:got'` 전송 → `RoomAction` 처리: `zone` → `zones`에 `{ x, y: 잡은 위치, r: zoneR, until: now + zoneMs }` 추가 후 `'zone:add'` / `bomb` → 잡은 위치에서 `bombR` 안(원 둘레 기준)의 보스·아이템 아닌 원 전부 `claim(…,'blast')` / `fieldClear` → 보스·아이템 아닌 원 전부 `claim(…,'blast')` / `timeStop` → `holdCircles` 후 `'circles:hold'`, `this.freezeUntil = now + freezeMs` (그동안 생성 멈춤: `lastSpawn`을 끝 시각까지 밀기) / `rain` → `this.rain = { color: p.color, until: now + 3000 }`
  - `tick`: 장판마다 `isMine(c.kind, 주인 색)`이고 `circlePos` 거리 ≤ `c.r + z.r`인 원 `claim(owner,…,'zone')`; 끝난 장판 삭제. 생성 시 `itemChance: G.items ? RULES.items.chance : 0`, `rain` 중이면 `forceKind: rain.color`
  - `hitBoss`: 타격·막타 각각 `jackpotMult(modsOf(p.picks))`를 곱하고 `itemMult(p, now, true)`도 곱함 (막타는 타격과 막타를 따로 굴림, MVP는 제외). 이벤트에 `jackpot`(막타 이벤트는 막타 쪽 배율)
  - `beginRound`: `zones`, `rain`, `freezeUntil` 초기화
  - `resume`: 기존 시각 이동을 `shiftTimes`로, 그리고 `zones.until`, `rain.until`, `freezeUntil`, 원의 `holds` 시작 시각도 `delta`만큼 (pausedAt 이후인 것만)
  - `playPayload`에 `zones`
  - `bot.ts think`: `c.kind === 'item'` → 가중치 5; 봇이 고르면 room에서 `claimItem`
- Consumes: Task 2~5 전부

- [ ] **Step 1: protocol 타입 추가 → `npm run typecheck`** → client에서 새 필드 미사용이라 통과해야 함 (실패 시 타입 정리)
- [ ] **Step 2: room·bot 구현**
- [ ] **Step 3: `npm test`, `npm run typecheck`** → 통과
- [ ] **Step 4: 수동 확인** — `npm run dev`, 혼자 하기 클래식: 서버 로그 에러 없음, 아이템 원(아직 안 그려짐)을 봇이 잡을 때 `item:got`이 오는지 브라우저 콘솔에서 `socket` 이벤트로 확인. 게임 중 새로고침 → `game:sync`에 `zones` 포함
- [ ] **Step 5: 커밋은 Task 8 끝에서 아이템 기능 전체로** (서버만으로는 화면이 없어 기능이 완결되지 않음)

---

### Task 7: 클라이언트 — 클릭 예측, 이벤트 처리, 버프 HUD, 방 규칙 토글

**Files:**
- Create: `client/src/effectsUI.ts`
- Modify: `client/src/main.ts`, `client/src/rulesUI.ts`, `client/src/audio.ts`, `client/src/icons.ts`, `client/index.html`, `client/src/style.css`

**Interfaces:**
- Produces (effectsUI.ts):
  - `ITEM_ICON: Record<ItemId, IconNode>` (icons.ts에 두고 effectsUI가 사용: wideHand `Hand`, magnet `Magnet`, missGuard `Wind`, comboLock `Lock`, guard `ShieldCheck`, markClear `CircleOff`, feverCharge `BatteryCharging`, instantFever `Flame`, goldHand `HandCoins`, double `ChevronsUp`, paint `Paintbrush`, rain `CloudRain`, zone `CircleDot`, bomb `Bomb`, timeStop `Timer`, fieldClear `Sparkles`)
  - `showItemPop(stage: HTMLElement, sx: number, sy: number, item: ItemId, tier: 0|1|2, reduce: boolean): void` — 화면 좌표에 아이콘이 0.4초 동안 무작위 아이템 아이콘으로 바뀌다 멈추고 이름 표시 후 1초 뒤 사라짐 (`reduce`면 룰렛 없이 바로 결과)
  - `renderBuffBar(el: HTMLElement, p: PlayerState, now: number): void` — 걸린 버프·황금 손 남은 수를 아이콘 + `conic-gradient` 원형 타이머로, 끝나기 1초 전 `.blink`
  - `buffChips(p: PlayerState, now: number, size = 12): string` — 점수판 칩용 작은 아이콘
- main.ts 동작:
  - 클릭: 직접 맞은 원 찾기는 지금 그대로. 못 찾았을 때 `assistTargets(circles, me.color, x, y, now, reachOf(me, now), magnetOf(me, now), pending)` 결과가 있으면 빈 곳 표시(✕, 흔들림, 소리)를 하지 않는다. `reach > 0`이면 클릭마다 `renderer.reachRing(x, y, reach)`. 예측한 원은 `pending`에 넣지 않는다 (서버 `circle:claimed`가 지움). 전송은 지금처럼 `{ circleId, x, y }`
  - `circle:claimed`: `result.via === 'magnet'` → `renderer.pullLine(클릭 위치, x, y)` (마지막 클릭 위치를 기억), `result.jackpot > 1` → `renderer.jackpot(x, y, result.jackpot, false)` + `sfx.jackpot(result.jackpot)`, `result.via === 'blast'` → 바로 터뜨리지 않고 `renderer.burstDelayed(x, y, col, 지연)` (지연 = 마지막 `item:got` 폭발 중심과의 거리 순위 × 30ms. 서버는 `item:got`을 블라스트 `circle:claimed`보다 먼저 보낸다)
  - `item:got`: 원 삭제, 내가 잡았으면 `showItemPop` + `sfx.item(tier)`, 남이면 이름 글자. 아이템이 `bomb`이면 `renderer.shockwave(x, y, RULES.items.bombR)`, `fieldClear`면 `renderer.flash()` + `renderer.shockwave(800, 450, 1000)`, `timeStop`은 `circles:hold`에서
  - `zone:add`: `zones` 배열에 추가, 프레임마다 끝난 것 삭제, `game:start/sync`에서 `d.zones`로 교체
  - `circles:hold`: 해당 id 원에 `holds.push([at, ms])`, `frozenUntil = at + ms` 기억 → DrawState `frozen`
  - 보스 이벤트 `jackpot > 1` → `renderer.jackpot(x, y, jackpot, true)`
  - `updateHud`: `renderBuffBar($('buffs'), me, now)`; `renderScores`에 `buffChips` 붙임 (점수판은 `players` 이벤트마다 다시 그리므로, 버프 만료 표시는 1초마다 `renderScores` 한 번 더)
- rulesUI.ts: `BOOL_FIELDS`에 `{ key: 'items', label: '아이템 원' }`, 아케이드일 때만 `{ key: 'hostEvents', label: '진행자 이벤트' }`; `BoolKey` 확장. 점수표 아래 한 줄 설명 "`?` 원을 잡으면 무작위 아이템"
- audio.ts `sfx`: `item(tier)`, `jackpot(mult)` (1.5/2/3 단계별로 음 높이·길이 증가), `bomb`, `clear`, `freeze`, `zone`
- index.html: `#stage` 안에 `<div id="buffs" class="buffs"></div>`, `<div id="itemPops"></div>`

- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm run typecheck`, `npm run build`** → 통과
- [ ] **Step 3: 수동 확인** (Task 8 뒤에 한 번에)

---

### Task 8: 렌더 이펙트

**Files:**
- Modify: `client/src/render.ts`

**Interfaces:**
- Produces:
  - `DrawState`에 `zones: { x: number; y: number; r: number; until: number; color: ColorIndex }[]`, `frozen: boolean`
  - `toScreen(x: number, y: number): { x: number; y: number }` (`toField`의 역, `#stage` 기준 CSS 픽셀)
  - `reachRing(x, y, r)`: 하늘색(`#7fd3ff`) 링이 0 → r로 0.25초
  - `pullLine(x0, y0, x1, y1)`: 하늘색 2차 곡선 0.2초
  - `shockwave(x, y, R)`: 흰 링이 R까지 0.35초 (`reduceMotion`이어도 링은 그림)
  - `flash()`: 화면 전체 흰색 0.12초 (`reduceMotion`이면 생략)
  - `jackpot(x, y, mult, boss)`: 금색(`#ffd166`) 스파크 — ×1.5: 8개 / ×2: 16개 + 큰 링 / ×3: 24개 + 동전 파편(원형 금색 입자, 중력) + `flash()`. `boss`면 개수·링 크기 1.5배. 떠오르는 숫자는 main이 `text(…, '#ffd166', 1 + (mult-1)*0.5)`로 (글자 '잭팟'은 쓰지 않음)
  - 블라스트 순차 폭발: `circle:claimed`의 `via === 'blast'`는 `burstDelayed(x, y, col, delayMs)` — main이 폭발 중심과의 거리 순으로 30ms 간격 지연을 넘긴다 (필드 클리어는 화면 중앙 기준)
  - `const MAX_FX = 400`: `fx.push` 전용 헬퍼에서 넘으면 새 스파크·동전은 버림 (링·글자는 유지)
  - 아이템 원 그리기: 등급색 테두리(흔함 `#fff`, 희귀 `#4d9bff`, 전설은 프리즘 그라데이션이 시간에 따라 회전), 안쪽 어두운 원 + 천천히 도는 `?` 글자
  - 장판: 주인 색 반투명 원 + 점선 테두리, 테두리 길이 = 남은 시간 비율
  - `frozen`: 원 레이어에 `ctx.filter = 'saturate(0.25)'`, 멈춘 원 위에 작은 시계 바늘 (선 2개)
  - `burst`가 쓰는 스파크도 헬퍼 경유
- Consumes: Task 7의 호출들

- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm run typecheck`, `npm run build`** → 통과
- [ ] **Step 3: 수동 확인** — 혼자 하기 클래식(아이템 원 켬):
  - `?` 원이 보이고 직접 눌러야만 잡힘, 잡으면 룰렛 팝업 → 버프 바에 타이머
  - 넓은 손 버프 중 원 사이를 눌러 내 원 2개가 한 번에 잡힘, 남의 색은 안 잡힘, 하늘색 링
  - 자석 버프 중 빗나간 클릭이 근처 내 원을 끌어오는 선
  - 장판 위를 지나는 내 원이 자동으로 터짐
  - 폭죽·필드 클리어에서 남의 색도 터지고 "표적" 글자가 안 뜸, 연쇄 폭발 순서
  - 시간 정지 동안 원이 멈추고 채도가 내려감, 끝나면 그 자리에서 다시 움직임
  - 일시정지 → 5초 대기 → 재개: 버프 남은 시간, 장판, 정지 시간이 이어짐 (Review Focus 1)
  - 게임 중 새로고침: 장판·멈춘 원·버프 아이콘 복원 (Review Focus 2)
  - 설정 '화면 효과 줄이기' 켜고 필드 클리어: 번쩍임 없음, 링과 숫자만
  - 방 규칙 '빈 곳 클릭 페널티' 끄고 여러 판: 헛클릭 무효가 안 나옴 (Review Focus 4)
  - 아케이드에서 잭팟·넓은 손·자석 능력 카드가 나오고 효과 동작, 보스 막타 잭팟 ×3 연출
- [ ] **Step 4: 커밋** — 두 개로 나눈다:
  - `feat: 넓은 손·자석·잭팟 판정과 연출 연결` (room의 click 판정 순서·hitBoss 잭팟, main 클릭 예측·잭팟 연출, render reachRing·pullLine·jackpot)
  - `feat: 아이템 원 16종 추가` (items·zone·blast·timeStop·rain 서버 처리, effectsUI, 버프 HUD, 아이템 렌더, 방 규칙 토글, 효과음)
  - 두 커밋이 한 파일(room.ts, main.ts, render.ts)에 섞이면 `git add -p`로 나누고, 나누기 어려우면 하나의 `feat: 아이템 원과 보조·잭팟 능력 추가`로 합친다 (각 커밋 시점에 typecheck·build 통과가 우선)

---

### Task 9: 진행자 이벤트·라운드 테마 규칙 (shared)

**Files:**
- Create: `shared/src/host.ts`
- Modify: `shared/src/rules.ts` (`circlePos`·`isOut`의 `rev`, `bossTimes` 옵션), `shared/src/arcade.ts` (`RollOpts.forceCurse`), `shared/src/index.ts`
- Test: `shared/test/host.test.ts`

**Interfaces:**
- Produces (host.ts):
  - `HOST = { chance: 0.1, maxPerGame: 2, pickBonusMs: 3000, robinPct: 10, taxPct: 5, lottery: 30, swapWeight: 0.2 } as const`
  - `type ThemeId = 'goldRush' | 'bossRush' | 'reverse' | 'rainbowRain' | 'itemRush' | 'allYellow'`
  - `THEMES: Record<ThemeId, { name: string; desc: string }>` 와 `THEME = { goldRushYellow: 0.6, bossRushAt: [0.25, 0.55, 0.85], rainbowRain: 0.15, itemRushMult: 4 } as const`
  - `type HostEventId = 'robinHood' | 'tax' | 'lottery' | 'swap' | 'abilitySwap' | 'demote' | 'gift' | 'curseDelivery' | 'theme'` (전원 같은 색은 테마 `allYellow`)
  - `interface HostResult { id: HostEventId; text: string; changes: { playerId: string; delta: number }[]; theme?: ThemeId; giftTo?: string; curseTo?: string; swapped?: [string, string]; demoted?: { playerId: string; id: AbilityId } }`
  - `rollHost(players: PlayerState[], used: number, rand = Math.random): HostEventId | null` — `used >= maxPerGame` 또는 `rand() >= chance` → null. 적용할 수 없는 이벤트 제외(꼴찌가 없으면 로빈 후드·순위 역전·선물 제외, 저주 아닌 능력이 있는 사람이 2명 미만이면 능력 교환 제외, 1등에게 등급 올라간 능력이 없으면 강등 제외, 저주 상한 아닌 사람이 없으면 저주 배달 제외). 가중치는 `swap`만 `swapWeight`
  - `applyHost(id: HostEventId, players: PlayerState[], G: GameRules, rand = Math.random): HostResult` — 점수 변경은 정수 내림, 음수 금지. `tax`는 `changes`에 모두의 −5%, 걷은 합은 `HostResult.pot?: number` (지급은 room). `theme`은 6개 중 균등, 단 `!G.boss`면 `bossRush`, `!G.items`면 `itemRush` 제외
  - `RollOpts.forceCurse?: boolean` — 선택지 하나를 반드시 저주로 (저주 상한이면 무시)
- Produces (rules.ts):
  - `circlePos`: `c.rev`이면 같은 방향의 화면 가장자리 거리 `D`(원 반지름 포함)에서 출발해 중앙으로 — 위치 = 중앙 + 방향 × (`D` − 이동거리). `isOut`: `rev`이면 이동거리 ≥ `D`일 때 true
  - `bossTimes(G, theme?: ThemeId | null)`: `bossRush`면 `THEME.bossRushAt × roundMs`

- [ ] **Step 1: 실패하는 테스트**
  - `rollHost(players, 0, seq([0.05, …]))` → null 아님; `rollHost(players, 0, seq([0.2]))` → null; `rollHost(players, 2, () => 0)` → null
  - 모두 동점이면 `robinHood`·`swap`·`gift`가 절대 안 나옴 (rand 값 여러 개로)
  - `applyHost('robinHood')` 1등 100, 꼴찌 20 → 1등 90, 꼴찌 30
  - `applyHost('swap')` 1등 100, 꼴찌 20 → 맞바뀜
  - `applyHost('demote')` 1등의 레어 능력 → 노말, `demoted` 채워짐
  - `applyHost('theme', …, G 보스 끔)`을 rand 여러 개로 → `bossRush` 안 나옴
  - `rev` 원: 속도 100, 각도 0 → t=0에서 x ≈ 1600 + r, t가 늘수록 x 감소, 중앙 도달 후 `isOut` true
  - `rollOptions(0, false, rand, { forceCurse: true })` → 저주 1장 포함
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: `npm test`, `npm run typecheck`** → 통과

---

### Task 10: 서버 — 진행자 이벤트와 테마 적용

**Files:**
- Modify: `server/src/room.ts`, `shared/src/protocol.ts`

**Interfaces:**
- Produces (protocol.ts): `'arcade:host': (d: HostResult) => void`, `PlayPayload.theme`에 실제 값, `ArcadeState.theme: ThemeId | null` (선택 화면에서 다음 라운드 테마 공개)
- Room 동작:
  - 필드: `hostUsed = 0`, `theme: ThemeId | null = null`, `taxPot = 0`
  - `endRound`: 저주 적용 다음에 `G.hostEvents`이면 `rollHost(players, hostUsed)` → 있으면 `applyHost` → `hostUsed++`, `theme`/`taxPot`/`giftTo`/`curseTo` 저장, `'arcade:host'` 전송, `pickEndsAt += HOST.pickBonusMs`(타이머도). 선물 대상은 선택지 `ARCADE.optionCount + 1`개, 저주 배달 대상은 `forceCurse`
  - 라운드 끝(다음 `endRound` 또는 `end`) 앞에서 `taxPot > 0`이면 이번 라운드 증가량 1등에게 지급하고 `arcade:effects`와 같은 방식으로 알림 (`RoundEffect.id`에 `'tax'` 추가)
  - `beginRound`: `bossQueue = bossTimes(G, theme)`; 생성 옵션 — `goldRush` → `yellowChance 0.6`, `rainbowRain` → `rainbowChance 0.15`, `itemRush` → `itemChance × 4`, `allYellow` → `forceKind 'y'`(아이템·보스 제외), `reverse` → 생성한 원에 `rev = true`. 라운드가 끝나면(`finishPick` 직후 다음 라운드 시작 때 적용, 그 라운드가 끝나면) `theme = null`
  - `start`: `hostUsed = 0`, `theme = null`, `taxPot = 0`
  - 봇 선택 타이머는 `HOST.pickBonusMs`만큼 늦게 시작
- Consumes: Task 9

- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm test`, `npm run typecheck`** → 통과
- [ ] **Step 3: 수동 확인** — 확인용으로 잠시 `HOST.chance`를 1로 바꿔 혼자 하기 아케이드 진행 → 매 라운드 사이 `arcade:host` 수신, 최대 2번, 확인 후 0.1로 되돌림 (되돌린 것을 `git diff`로 확인)

---

### Task 11: 클라이언트 — 진행자 오버레이와 테마 표시

**Files:**
- Modify: `client/src/effectsUI.ts`, `client/src/main.ts`, `client/src/arcadeUI.ts`, `client/src/icons.ts`, `client/src/audio.ts`, `client/src/style.css`, `client/index.html`

**Interfaces:**
- Produces:
  - `HOST_NAME = '진행자'` (effectsUI.ts), 진행자 아이콘 `Megaphone`
  - `showHost(el: HTMLElement, r: HostResult, players: PlayerState[], reduce: boolean): Promise<void>` — 진행자가 위에서 내려오고 이벤트 아이콘 칸 9개가 박힌 룰렛 휠이 돌다 `r.id`에서 멈춤 → 결과 카드(`r.text`, 바뀐 점수) → 합계 2.5초 (`reduce`면 휠 없이 결과 카드만 1.2초). 끝나면 resolve
  - main: `arcade:host` 수신 → 능력 선택 오버레이 위에 `showHost`, 끝날 때까지 카드 고르기 막음(`holdRender` 재사용), `sfx.host`
  - `arcadeUI.renderPick`: `state.theme`이 있으면 상단에 "다음 라운드: {테마 이름} — {설명}" 띠. 라운드 결과 목록에서 `RoundEffect.id === 'tax'`는 능력 이름 대신 "세금 수령"으로 표시 (`ABILITY[id]` 조회 전에 분기)
  - 게임 중 HUD: 테마 라운드면 시작 카운트다운 때 테마 이름을 `renderer.text`로 크게
  - 역발사 원은 `circlePos`만으로 그려지므로 렌더 변경 없음

- [ ] **Step 1: 구현**
- [ ] **Step 2: `npm run typecheck`, `npm run build`** → 통과
- [ ] **Step 3: 수동 확인** (Task 10의 확률 1 상태로): 룰렛 연출, 결과 점수가 점수판과 일치, 선물 대상의 선택지 4장, 저주 배달 대상 선택지에 저주, 다음 라운드 테마 띠와 실제 동작(역발사 원이 가장자리에서 중앙으로), 혼자 하기에서 봇이 이벤트 대상일 때도 정상
- [ ] **Step 4: 커밋** `feat: 아케이드 진행자 이벤트와 라운드 테마 추가` (Task 9~11)

---

### Task 12: 문서

**Files:**
- Modify: `README.md` (현재 규칙 표 아래에 아이템 원·잭팟 한 줄씩, 기능 목록에 아이템 원·진행자 이벤트, 방 규칙 목록에 `아이템 원`·`진행자 이벤트`, 구조에 `items.ts`·`host.ts`·`effectsUI.ts`·`shared/test`, 실행 방법에 `npm test`), `docs/ROADMAP.md` (구현한 항목 ⏳ → ✅, 버전 표기 `(1.0.0-beta.6)`, "이 계획이 새로 정한 것" 값 반영), `CLAUDE.md`는 건드리지 않음

- [ ] **Step 1: 수정**
- [ ] **Step 2: 커밋** `docs: 아이템·잭팟·진행자 이벤트 문서 반영` (지금까지 커밋하지 않은 ROADMAP 계획 변경도 여기 포함)

---

### Task 13: 버전 올리기 (사용자 확인 후)

- [ ] **Step 1: 사용자에게 1.0.0-beta.6으로 올릴지 확인**
- [ ] **Step 2: 루트·shared·server·client `package.json` `version` → `1.0.0-beta.6`, `npm install --package-lock-only`, `CHANGELOG.md`에 `## [1.0.0-beta.6] - 날짜` (기능: 아이템 원, 넓은 손·자석·잭팟, 진행자 이벤트·라운드 테마, 방 규칙 토글)**
- [ ] **Step 3: `npm run typecheck`, `npm run build`** → 통과
- [ ] **Step 4: 커밋** `chore(release): v1.0.0-beta.6` — 태그·푸시는 하지 않는다
