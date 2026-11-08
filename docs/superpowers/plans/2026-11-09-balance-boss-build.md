# 밸런스 정리 · 보스 빌드 구현 계획 (1차 묶음)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 꼴찌 보정·자석·잭팟·배율 쌓임을 줄이고, 강탈·출발 신호·선봉을 살리고, 보스 빌드가 독식으로 고득점을 내게 하며, 결과 화면에 점수 출처 통계를 보여 준다.

**Architecture:**
- **수치:** `RULES`(rules.ts)와 `ARCADE`·`LEGEND`·`COMBO`·`AUG`(arcade.ts)에서만 바꾼다. 문구는 상수에서 만든다.
- **배율 상한:** `capMult`로 일반 원·황금 원·보스에서 잭팟 전 배율을 묶는다.
- **보스:** 보스 타격 계산을 서버(`room.ts`)에서 공용 순수 함수 `strikeBoss`(새 파일 `shared/src/bossScore.ts`)로 옮긴다. 서버는 원 삭제·알림·자동 획득만 한다. 이래야 단위 테스트가 쉽다.
- **통계:** `PlayerStats.src`에 출처별 점수를 모으고, '기타'는 화면에서 총점과의 차이로 계산한다.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-09-balance-boss-build-design.md`

## Global Constraints

- 화면 문구는 한국어. 수치는 `RULES`·`ARCADE`·`LEGEND`·`COMBO`·`AUG`에만 두고, 문구 속 숫자는 상수에서 만든다.
- 커밋은 Conventional Commits(`<타입>(<범위>): <한국어 요약>`), 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 수치 조정은 `balance`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에 쓴다(사용자 지시). 각 Task의 테스트는 Task 7에서 쓰고 실행한다. 커밋도 Task 7에서 Task별 스냅샷으로 목적별로 나눈다.
- `main` 병합·푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. 출발 신호 창(처음 N초) 안에서 일시정지하면 창이 그만큼 밀려야 한다. 일시정지가 창을 갉아먹으면 안 된다. → Task 4 테스트
2. 보스가 처치되지 않고 화면 밖으로 나가거나 라운드가 끝나 사라지면 독식·막타가 없어야 한다. 그 보스에 넣은 피해가 다음 보스로 이어지면 안 된다. → Task 5 테스트
3. 남은 체력보다 큰 피해(파쇄 레전드 + 보스 헌터 +1)로 막타를 치면 타격 점수와 독식 계산은 **실제로 깎은 양**까지만 센다. → Task 5 테스트
4. 증강 없이 **자석 아이템만** 먹은 사람도, 피버 중 노란 원(피버 중엔 내 색 취급)을 끌어올 때도 같은 자석 규칙(70%, 콤보·게이지·잭팟 없음)을 받는다. → Task 2 테스트
5. 이벤트·저주·특별 카드 정산·하이에나·방패 레전드처럼 점수가 따로 오가도 출처 합 + 기타 − 잃은 점수 = 총점이어야 한다(기타는 음수일 수 있음). → Task 6 테스트

---

### Task 1: 꼴찌 보정

**Files:**
- Modify: `shared/src/arcade.ts` (`ARCADE.lastGuarantee`)
- Modify: `server/src/room.ts` (`Offer`, `roll`, 첫 장 고른 뒤 다시 뽑기 ~`:355-365`)

**Interfaces:**
- Produces:
  - `ARCADE.lastGuarantee = [1, 2, 2, 3]`
  - `Offer.firstDone: boolean` (처음 false, 그 차례의 첫 카드를 고르면 true)
  - `roll(p, o)`: `guarantee`는 `o.last && !o.firstDone`일 때만. 첫 선택 전 다시 뽑기는 보장 유지, 첫 장 고른 뒤 새 3장과 그 뒤 다시 뽑기는 보장 없음.

- [ ] **Step 1: 구현** — 위대로. 시간이 다 돼 자동으로 고르는 경로(`~:794`)는 그대로.
- [ ] **Step 2: 타입 검사·빌드** — `npm run typecheck && npm run build` → 성공.
- [ ] **Step 3: 테스트 (Task 7에서 실행)** — `shared/test/tuning.test.ts`(새 파일)

```ts
test('꼴찌 보장 등급: 차례별 레어·에픽·에픽·레전드', () => { /* ARCADE.lastGuarantee 깊은 비교 [1,2,2,3] */ });
test('2장 차례: 꼴찌의 첫 묶음엔 보장, 첫 장을 고른 뒤 새 3장엔 보장 없음', () => {
  /* Room으로 4라운드 뒤 꼴찌 차례를 만들고 Math.random을 노말만 나오게 고정 →
     첫 묶음에 tier ≥ 3 카드 1장, 첫 장 고른 뒤 새 묶음은 모두 tier < 3 */
});
```

### Task 2: 자석

**Files:**
- Modify: `shared/src/arcade.ts` (`magnet` 값·상한·설명, `LEGEND.magnetPerSec`)
- Modify: `shared/src/rules.ts` (`RULES.magnet`, `RULES.items.magnet`, `resolveClaim` 자석 경로)
- Modify: `shared/src/cursor.ts` (`pickMagnetTargets` 무지개 제외)
- Modify: `shared/src/items.ts` (자석 아이템 설명)

**Interfaces:**
- Produces:
  - `magnet.values = [45, 65, 90, 180]`, `cap: 180`
  - `RULES.magnet = { pullMs: 400, perSec: 1 }`, `AUG.magnetPointPct = 70`, `LEGEND.magnetPerSec = 2`, `RULES.items.magnet = 70`
  - `pickMagnetTargets`: `c.kind === 'rainbow'`이면 건너뜀
  - `resolveClaim(..., { via: 'magnet' })`
    - 점수 = `Math.round(pts × mult × AUG.magnetPointPct / 100)` (잭팟 1 고정)
    - `claimer.combo`가 오르지 않는다.
    - 콤보 보너스 없음, 피버 게이지 변화 없음(`addFever` 호출 안 함), 속사도 세지 않음(이미 click/save만).
    - 방법: 함수 안에 `const magnet = via === 'magnet'`과 지역 함수 `bump()`(콤보 +1, 자석이면 아무것도 안 함)·`gauge(amt, raw?)`(자석이면 false)를 두고 각 분기의 `claimer.combo++`·`addFever(...)`를 이것으로 바꾼다.
  - 자석 설명: `` `커서 둘레 ${v} 안의 내 원을 끌어당겨 잡음 (무지개 제외, 점수 ${AUG.magnetPointPct}%만)` `` (설명이 arcade.ts에 있어서 수치도 `AUG`에 둔다)
  - 레전드 문구는 `LEGEND.magnetPerSec`에서 만든 그대로(`1초에 2개까지 끌어옴`).

- [ ] **Step 1: 구현** — 위대로. 서버 `updatePulls`의 주석 "1초에 4개"를 상수 기준 문장으로.
- [ ] **Step 2: 타입 검사·빌드** — 성공.
- [ ] **Step 3: 테스트 (Task 7)** — `shared/test/tuning.test.ts`

```ts
test('자석 반경 45/65/90/180, 상한 180, 아이템 +70, 1초 1개(레전드 2), 0.4초', () => {});
test('자석은 무지개 원을 끌지 않는다 (내 색·노랑만)', () => {});
test('자석 획득: 점수 70%, 콤보 그대로, 콤보 보너스·잭팟·피버 게이지 없음', () => {
  /* combo 9(다음이 콤보 보너스 문턱), fever 0, 잭팟 100% 증강 → via magnet 내 색:
     gained === Math.round(3 * 0.7), combo 9, fever 0, jackpot 1, comboBonus false */
});
test('자석 아이템만 있어도, 피버 중 노란 원도 같은 자석 규칙', () => { /* Review Focus 4 */ });
```

### Task 3: 잭팟 상한 · 배율 쌓임 상한

**Files:**
- Modify: `shared/src/arcade.ts` (`jackpot.cap`)
- Modify: `shared/src/rules.ts` (`RULES.multCap`, `capMult`, `resolveClaim`, `goldGain`)

**Interfaces:**
- Produces:
  - `jackpot.cap = 35` (행운아 +10은 상한 밖이라 최대 45 — 지금 `luckyMods` 구조 그대로)
  - `RULES.multCap = 20`
  - `export const capMult = (x: number) => Math.min(RULES.multCap, x)` — `resolveClaim`의 `mult`와 `goldGain`의 `mult`를 감싼다. 잭팟은 그 밖에서 곱한다.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 테스트 (Task 7)** — `shared/test/tuning.test.ts`

```ts
test('잭팟 확률 상한 35, 행운아 포함 45, 레전드 배율 ×2/×3/×5 그대로', () => {});
test('배율 쌓임 상한: 피버 ×12·가장자리 ×7·점수 2배면 ×20으로, 잭팟은 그 위에', () => {
  /* 일반 원 pts 3 → gained 60 (잭팟 없음), 잭팟 ×2 고정이면 120. 황금 원도 20×20=400 */
});
```

### Task 4: 강탈 · 출발 신호

**Files:**
- Modify: `shared/src/arcade.ts` (`plunder`·`headStart` 값·설명, `AUG`, `LEGEND_TEXT`)
- Modify: `shared/src/rules.ts` (`resolveClaim` 강탈, `startRound`, `extraMult`, `shiftTimes`, 새 `headStartMsOf`)

**Interfaces:**
- Produces:
  - 강탈: `plunder.values = [1, 2, 3, 5]`(%), `AUG.plunderMax = 30`
    - 빼앗는 점수 = 상대 이번 라운드 점수 `r = max(0, owner.score − owner.roundStart)`가 0이면 0, 아니면 `min(AUG.plunderMax, max(1, round(r × v / 100)))`
    - 레전드이고 상대가 1등이면 그 값 ×2(상한도 60)
    - 흡혈귀·보호막·철벽 처리는 지금 그대로
    - 설명: `` `견제하면 상대의 이번 라운드 점수 ${v}%를 빼앗음 (최대 ${AUG.plunderMax}점)` ``
  - 출발 신호: `headStart.values = [5, 8, 10, 15]`(초), `cap: 20`, `AUG.headStartMult = 1.3`. `LEGEND.headStartMult 1.5`, `LEGEND.headStartMs 10_000`은 그대로(레전드 최소 시간)
    - `export function headStartMsOf(p: PlayerState): number` = `m.headStart × 1000`, 레전드면 `max(그 값, LEGEND.headStartMs)`, 증강 없으면 0
    - `extraMult`의 출발 신호 배율: `now < p.roundBegin + headStartMsOf(p)`이면 레전드 `LEGEND.headStartMult`, 아니면 `AUG.headStartMult`
    - `startRound`의 `p.score += m.headStart` 삭제
    - `shiftTimes`: `LEGEND.headStartMs` 대신 `headStartMsOf(p)`
    - 설명: `` `라운드 처음 ${v}초 동안 점수 ×${AUG.headStartMult}` ``
    - 레전드 문구: `` `배율 ×${AUG.headStartMult} → ×${L_.headStartMult}, 최소 ${sec(L_.headStartMs)}` ``

- [ ] **Step 1: 구현**
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 테스트 (Task 7)** — `shared/test/tuning.test.ts`

```ts
test('강탈: 상대 라운드 점수의 %, 최소 1, 상한 30, 라운드 점수 0이면 0', () => {
  /* 라운드 점수 1000, 5% → 30(상한), 100점 3% → 3, 10점 1% → 1, 0점 → 0 */
});
test('강탈 레전드: 1등이면 2배, 상한 60. 보호막·철벽이면 0', () => {});
test('출발 신호: 처음 N초 ×1.3, 중첩 합 상한 20초, 시작 보너스 점수 없음', () => {});
test('출발 신호 레전드: ×1.5, 레어(8초)여도 10초', () => {});
test('출발 신호 창 안에서 일시정지하면 창이 그만큼 밀림', () => { /* Review Focus 1, shiftTimes */ });
```

### Task 5: 보스 빌드

**Files:**
- Create: `shared/src/bossScore.ts` (`strikeBoss`)
- Modify: `shared/src/index.ts` (내보내기)
- Modify: `shared/src/rules.ts`
  - `RULES.boss`: `feverMultCap` 삭제, `feverGain: 4`, `solo: { pct: 50, points: 60, killMult: 2 }` 추가
  - `bossMult` 삭제
  - 새 `comboBonusOf`, `resolveClaim`이 그것을 씀
  - 보스 등장 횟수(`bossTimes`·`rollBossCount`)는 **바꾸지 않는다**
- Modify: `shared/src/arcade.ts` (`vanguard` 값·설명, `COMBO.bossSoloFever`, 보스 헌터 조합 문구)
- Modify: `shared/src/protocol.ts` (`'boss:killed'`에 `solo: string | null` 추가)
- Modify: `server/src/room.ts` (`hitBoss`가 `strikeBoss`를 부르고 원 삭제·알림·사냥꾼 레전드·점화만)
- Modify: `client/src/main.ts` (`boss:killed`에서 `solo`가 나면 "독식!" 문구, 기존 처치 문구 아래)

**Interfaces:**
- Consumes: `capMult`(Task 3)
- Produces:
  - `export function comboBonusOf(p: PlayerState, before: number, fever: boolean): number` — 지금 `resolveClaim`의 콤보 보너스 계산(기세·콤보 장인·레전드·콤보 머신·폭주 레전드)을 그대로 옮긴 것. 문턱을 안 넘었으면 0.
  - `vanguard.values = [2, 3, 4, 6]`(배율), 설명 `` `보스마다 내 첫 타 점수 ×${v}` ``. 레전드(등장 3초 안 피해 2배) 그대로.
  - `COMBO.bossSoloFever = 25`. 보스 헌터 문구에 "붉은 공격형도 감점 없이 때림, 독식하면 피버 게이지 +25" 추가.
  - 새 함수:
    ```ts
    export interface BossStrike {
      blocked: boolean; enraged: boolean; damage: number; gained: number; jackpot: number;
      killed: boolean; killGained: number; killJackpot: number; solo: boolean;
      mvp: string | null; mvpGained: number; feverStarted: boolean; comboBonus: boolean;
    }
    export function strikeBoss(
      p: PlayerState, c: Circle, hits: Map<string, number>, players: PlayerState[], now: number, G: GameRules, rand?: () => number,
    ): BossStrike
    ```
  - `strikeBoss` 규칙 (순서대로)
    1. 보호막(파쇄 레전드 아니면): `blocked`, 변화 없음.
    2. 붉은 공격형이고 보스 헌터 조합이 **없으면**: 지금처럼 `ragePenalty` 감점, `enraged`. 조합이 있으면 일반 타격으로 처리.
    3. 피해 = `min(bossHitInfo(p).damage × 선봉 레전드 배율, c.hp)`. `hits`에 피해를 더하고 `c.hp`를 깎는다.
    4. 콤보 +1. 피버 게이지 `+RULES.boss.feverGain`(`addFever`, 결과를 `feverStarted`). 콤보 보너스 = `comboBonusOf(p, before, fever)`.
    5. 배율 `mult = capMult((피버 ? feverMultOf : 여운 ? afterMultOf : 1) × info.boost × itemMult(p, now, true) × zoneMult(zoneOf(circlePos(c, now)), m) × extraMult(p, now, players))`.
    6. 타격 점수 = `round((info.hit × 피해 × (내 첫 타면 m.vanguard, 아니면 1) + 콤보 보너스) × mult × 잭팟)`. 선봉 증강이 없으면(`m.vanguard` 0) 배율 1로 본다. "내 첫 타"는 3번에서 더하기 전 `hits`에 내 id가 없던 경우.
    7. 체력이 0이 되면 막타.
       - 독식: `hits.get(p.id) × 100 >= c.maxHp × RULES.boss.solo.pct`이면 `solo: true`, `+round(RULES.boss.solo.points × mult)`. 보스 헌터 조합이면 `addFever(p, COMBO.bossSoloFever, ...)`.
       - 막타 점수 = `round(info.kill × (독식이면 RULES.boss.solo.killMult, 아니면 1) × mult × 막타 잭팟)`
       - MVP는 지금 규칙 그대로(+5, 배율 없음).
       - `killGained`에 막타와 독식 점수를 합친다. `p.stats.bossKills++`.
    8. `p.stats.bossHits++`는 피해가 들어간 타격만.
  - `room.hitBoss`
    - 막타면 원 삭제, `bossHits` 삭제, `bossKilledAt`, `'boss:killed'`(`gained = 타격 + killGained`, `solo: 독식이면 p.id`)
    - 사냥꾼 레전드 자동 획득
    - `feverStarted`이고 점화가 있으면 `claim`의 점화와 같은 자동 획득
    - 아니면 `'boss:hit'`
    - 보스가 화면 밖으로 나가 지워질 때 `bossHits`에서도 지운다(지금 안 지우면 추가).

- [ ] **Step 1: 구현** — 위대로. `bossMult`·`feverMultCap`을 쓰던 곳(클라이언트 포함)을 `grep -rn "bossMult\|feverMultCap"`으로 모두 정리.
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 테스트 (Task 7)** — `shared/test/boss-build.test.ts`(새 파일, `strikeBoss` 직접 호출)

```ts
test('보스 점수에 피버 배율 전부(상한 없음)와 점수 구역 배율', () => {});
test('보스 타격: 콤보 +1, 피버 게이지 +4, 문턱 넘으면 콤보 보너스. 보호막·공격형은 없음', () => {});
test('타격 점수는 피해 비례: 파쇄 3타면 3배, 남은 체력보다 큰 피해는 남은 만큼만', () => { /* Review Focus 3 */ });
test('독식: 최대 체력 50% 이상이면 +60×배율, 49%면 없음', () => { /* 4인 체력 24: 12 → 있음, 11 → 없음 */ });
test('독식한 사람이 막타면 막타 점수 2배, 독식 아닌 막타는 그대로, 보스 헌터 ×2와 곱함', () => {});
test('독식 실제 깎은 양 기준: 막타 초과 피해는 세지 않음', () => {});
test('선봉: 남이 먼저 때린 보스도 내 첫 타면 ×N, 같은 보스 두 번째는 보통', () => {});
test('보스 헌터: 붉은 공격형도 감점 없이 피해, 독식하면 피버 게이지 +25', () => {});
test('배율 쌓임 상한은 보스에도 적용, 잭팟은 그 위', () => {});
test('화면 밖으로 나간 보스는 독식·막타 없음, 피해 기록도 지워짐', () => { /* Review Focus 2, Room 테스트 */ });
```
기존 `bosses.test.ts`·`combos.test.ts`·`room.test.ts` 중 피버 상한·선봉 고정 점수·타격 점수가 피해와 무관함을 기대하던 것은 새 규칙에 맞춘다.

### Task 6: 점수 출처 통계

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerStats`, `emptyStats`, 새 `addSrc`·`otherOf`, `resolveClaim`, 감점 지점)
- Modify: `shared/src/bossScore.ts` (기록)
- Modify: `server/src/room.ts` (`claimGold`, 공격형 감점)
- Create: `client/src/sources.ts` (결과 화면 막대)
- Modify: `client/src/results.ts`, `client/index.html`(`#srcBox`), `client/src/style.css`

**Interfaces:**
- Consumes: `strikeBoss`(Task 5)
- Produces:
  - ```ts
    export type SrcKey = 'circle' | 'combo' | 'magnet' | 'gold' | 'boss' | 'steal';
    export interface ScoreSrc extends Record<SrcKey, number> { lost: number; fever: number; jackpot: number }
    // PlayerStats.src: ScoreSrc, emptyStats가 모두 0으로
    export function addSrc(p: PlayerState, key: SrcKey, gained: number, opt?: { fever?: boolean; jackpot?: number }): void
    // gained를 key에 더하고, fever면 src.fever에도, jackpot > 1이면 src.jackpot에 gained − round(gained / jackpot)
    export const otherOf = (p: PlayerState) => p.score − Σ src[SrcKey] + p.stats.src.lost
    ```
  - 기록 지점
    - `resolveClaim`
      - 자석은 `magnet`, 견제·반격은 `steal`(강탈 포함), 나머지는 `circle`.
      - 콤보 보너스 몫은 `combo`로 따로 넣는다. 나누는 비율은 `pts` 안 기본/보너스 비율이다.
      - 상대가 강탈·흡혈로 잃은 점수는 그 상대의 `src.lost`에 넣는다.
      - 방패 레전드는 견제한 사람의 `lost`와 주인의 `steal`에 넣는다.
    - `strikeBoss`: 타격·막타·독식은 `boss`, MVP는 MVP 받은 사람의 `boss`.
    - `claimGold`: `gold`
    - 공격형 감점·유리 대포 헛클릭 감점: `lost`
    - 그 밖(이벤트·저주·특별 카드·하이에나·뒤집기 등)은 기록하지 않는다. 화면에서 `otherOf`로 '기타'가 된다.
  - `sourcesHtml(ranking: PlayerState[], myId: string): string` (`client/src/sources.ts`)
    - 플레이어마다 한 줄이에요. 이름, 그리고 출처별 가로 막대(원·콤보 보너스·자석·황금 원·보스·견제·기타)를 보여 줘요. 막대 색은 출처마다 고정이고 범례가 있어요.
    - 마우스를 올리면 설명 카드(`data-tip`)에 출처별 점수와 비율, 잃은 점수, 참고값(피버 중·잭팟 추가분)이 나와요.
    - 기타가 음수면 막대 없이 숫자만 보여 줘요.
  - 결과 화면에서 `#graphBox` 아래 `#srcBox`에 넣어요. 아케이드·클래식 모두예요.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 타입 검사·빌드**
- [ ] **Step 3: 테스트 (Task 7)** — `shared/test/sources.test.ts`(새 파일)

```ts
test('출처: 직접 클릭은 circle, 콤보 보너스 몫은 combo로 나뉨', () => {});
test('출처: 자석·견제(강탈 포함)·황금 원·보스(타격·막타·독식·MVP)가 제 칸에', () => {});
test('잃은 점수: 강탈·흡혈·방패 레전드·공격형·유리 대포', () => {});
test('참고값: 피버 중 점수, 잭팟 추가분', () => {});
test('출처 합 − 잃은 점수 + 기타 = 총점, 이벤트 정산이 있으면 기타가 맞춰 줌(음수 가능)', () => { /* Review Focus 5 */ });
```

### Task 7: 테스트·확인·문서·커밋·리뷰

- [ ] **Step 1: 테스트 작성** — Task 1~6의 테스트를 쓰고, 바뀐 규칙에 맞춰 기존 테스트를 고친다. 대상은 자석 반경·개수, 잭팟 상한, 출발 신호 시작 점수, 강탈 고정 점수, 선봉, 보스 피버 상한, 보스 타격 점수, 꼴찌 보장이다.
- [ ] **Step 2: 전체 테스트** — `npm test` → 모두 통과.
- [ ] **Step 3: 타입 검사·빌드** — `npm run typecheck && npm run build` → 성공.
- [ ] **Step 4: 브라우저 확인** (봇 방, 아케이드 30초)
  - 보스 타격 때 콤보가 오르는지, 독식하면 "독식!"이 뜨는지 봐요.
  - 결과 화면의 출처 막대와 설명 카드를 봐요.
  - 증강 카드·도감·조합 설명 문구(자석·잭팟·강탈·출발 신호·선봉·보스 헌터)를 봐요.
- [ ] **Step 5: 문서**
  - `README.md`: 증강 표·보스 규칙·결과 화면을 고쳐요.
  - `docs/ROADMAP.md`: 1차는 완료, 2차(유니크·스택형·무의 시간·커서 강화)는 다음으로 적어요.
  - 설계 문서 상태를 '구현 완료'로 바꿔요.
- [ ] **Step 6: 커밋 (목적별)**
  - `balance: 꼴찌 보장을 레어·에픽·에픽·레전드로, 2장 차례는 첫 묶음에만`
  - `balance: 자석 너프 (반경·속도·개수, 무지개 제외, 끌어온 원은 점수 70%만)`
  - `balance: 잭팟 확률 상한 35%, 배율 쌓임 상한 ×20`
  - `balance: 강탈을 라운드 점수 %로, 출발 신호를 처음 몇 초 ×1.3으로`
  - `balance: 보스 빌드 (배율·콤보·피해 비례·독식 보너스·선봉·보스 헌터)`
  - `feat: 결과 화면에 점수 출처 통계`
  - `test: …`
  - `docs: …` (설계·계획 포함)
- [ ] **Step 7: 최종 리뷰** — 새 리뷰어(가장 좋은 모델)가 전체를 봐요. 중요한 지적만 재현 테스트를 쓰고 고쳐요.
