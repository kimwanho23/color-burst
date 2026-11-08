# 정사각형 판 · 황금 원 배율 · 조합 보너스 · 무지개 사냥 레전드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판을 1100×1100 정사각형으로 바꿔 게임 상자를 꽉 채우고 경계를 분명히 하며, 황금 원이 배율을 받게 하고, 조합 보너스 5개와 무지개 사냥 레전드를 조정한다.

**Architecture:**
- **판:** `FIELD`만 바꾸면 위치 계산이 대부분 따라온다. 직접 적힌 좌표만 `FIELD` 기준으로 고친다.
- **화면 크기 수치:** 판 단위로 적힌 크기·속도는 화면 배율이 거의 같아서 그대로 둔다.
- **화면:** 게임 상자를 정사각형으로 만들고, 판 테두리·바깥 여백·피버 테두리는 캔버스에 그린다.
- **밸런스:** 황금 원·조합·레전드 수치는 `COMBO`·`LEGEND`·`RULES`에서 바꾼다.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-08-square-field-balance-design.md`

## Global Constraints

- 화면 문구는 한국어. 수치는 `RULES`·`COMBO`·`LEGEND`에만, 문구 속 숫자는 상수에서 만든다.
- 커밋은 Conventional Commits(`<타입>(<범위>): <한국어 요약>`), 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 수치 조정은 `balance`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에(사용자 지시). 각 Task의 테스트는 Task 5에서 쓰고 실행하고, 커밋도 Task 5에서 단계별 스냅샷으로 목적별로 나눈다.
- `main` 병합·푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. 판이 바뀐 뒤 원이 판 끝까지 가서 사라져야 한다(가장자리 구역에 원이 실제로 들어감). 반지름만큼 일찍 사라지거나 판 밖에서 맴돌면 안 된다.
2. 레이저·회전 막대·맵 패턴(벽·소용돌이·안개 위치)이 새 판 안에 생기고 판 전체를 덮어야 한다. 대각선 1556보다 짧으면 구석이 비어 안전지대가 된다.
3. 게임 상자 크기가 바뀌어도(창 크기 조절, 세로로 긴 창, 좁은 폰 폭) 클릭 위치와 판 좌표가 맞아야 한다(`toField`).
4. 철옹성과 보험·기세·콤보 고정 아이템이 겹칠 때, 콤보가 가장 많이 남는 규칙 하나만 적용돼야 한다(두 번 줄면 안 됨).
5. 미식가의 노란 원이 외길 저주(노랑 0점)·피버 중 노랑·물들이기 아이템과 겹칠 때도 이상한 점수가 나오면 안 된다.

---

### Task 1: 정사각형 판 (1100×1100)

**Files:**
- Modify: `shared/src/rules.ts` (`FIELD`, 점수 구역 주석)
- Modify: `shared/src/cursor.ts` (`rollLaser`·`rollVolley` 통과점 범위)
- Modify: `client/src/main.ts` (화면 문구 좌표 `(800, y)` → `(FIELD.w / 2, y)`, 폭죽 중심 `{ x: 800, y: 450 }` → 판 중앙, `R: 1000` → 판 대각선)
- Modify: `client/src/render.ts` (시야 방해 낙서 범위, 판 테두리·바깥 여백·피버 테두리, 점수 구역 경계선 조금 진하게)
- Modify: `client/src/style.css`, `client/index.html` 필요 시 (`#app` 최대 폭, `#stage` 정사각형)

**Interfaces:**
- Produces:
  - `FIELD = { w: 1100, h: 1100 }`
  - 레이저 통과점: 판 안쪽 `FIELD × [0.15, 0.85]` 범위. 레이저 선분 길이 2000 그대로(대각선 1556 덮음).
  - 회전 막대 길이 `RULES.patterns.bar.len` 1100 → 1560 (대각선 덮음)
  - 화면 배치
    - 게임 상자 `#stage`는 정사각형이에요. 한 변 = min(사용 가능한 폭, 위쪽 바·점수판·아래 피버 바를 뺀 높이)이고, 가운데 정렬해요.
    - `#app`의 최대 폭은 상자 한 변에 맞춰요.
    - 크기는 CSS(`aspect-ratio: 1`)로 정해요. 높이에 맞추기 어려우면 `main.ts`가 창 크기를 바꿀 때 `--side` 변수를 계산해요.
  - 그림 (`Renderer.draw`)
    - 판 밖(캔버스 여백)은 `rgba(0,0,0,.35)`로 칠해요.
    - 판 테두리는 둥근 사각형(반지름 18), 두께 3, `rgba(255,255,255,.35)`에 바깥쪽 옅은 빛을 둘러요.
    - 내 피버 중이면 테두리가 `#ff9f1c`, 두께 5, 맥동해요.
    - 상자 전체가 빛나던 기존 피버 효과(`#stage.feverOn`의 inset box-shadow)는 빼요.

- [ ] **Step 1: 구현** — 위대로. `grep -rnE "\b(800|450|1600|900)\b"`로 판 좌표가 남지 않았는지 확인(소리 주파수·시간 값은 제외).
- [ ] **Step 2: 타입 검사·빌드** — `npm run typecheck && npm run build` → 성공.
- [ ] **Step 3: 테스트 (Task 5에서 실행)** — `shared/test/field.test.ts`(새 파일)

```ts
test('판은 1100×1100 정사각형, 점수 구역은 원(같은 거리면 방향과 상관없이 같은 구역)', () => {});
test('원은 판 끝(반지름까지 포함)을 지나야 사라짐 — 위·아래·왼쪽·오른쪽 같은 거리', () => {});
test('레이저 통과점은 판 안, 선분은 판 대각선을 덮음', () => {});
test('회전 막대는 어느 각도에서도 판 끝까지 닿음', () => {});
```
기존 테스트 중 1600×900 좌표를 직접 쓰는 것(`cursorTarget` 거울 위치, 구역, 패턴 범위 등)은 `FIELD` 기준으로 고친다.

### Task 2: 황금 원 배율

**Files:**
- Modify: `shared/src/rules.ts` (새 `goldGain`)
- Modify: `server/src/room.ts` (`claimGold`)

**Interfaces:**
- Produces: `goldGain(p: PlayerState, now: number, players: PlayerState[], G: GameRules, zone: ZoneIndex, rand?: () => number): { gained: number; jackpot: number }`
  - `RULES.gold.points × (피버면 feverMultOf, 여운이면 afterMultOf, 아니면 1) × scoreBoostOf(m) × itemMult(p, now, true) × zoneMult(zone, m) × extraMult(p, now, players) × jackpotMult(luckyMods(p, m), rand, hasLegend(p,'jackpot'))`를 반올림해요.
  - 콤보·피버 게이지는 그대로예요.
  - `claimGold`는 잡은 자리 `zoneOf({x, y})`로 이 함수를 불러요. `gold:got`에 `jackpot`을 실어 보내고, 클라이언트는 잭팟이면 잭팟 연출을 해요.

- [ ] **Step 1: 구현** — 위대로.
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 5에서 실행)** — `shared/test/gold.test.ts`에 추가

```ts
test('황금 원: 피버·구역·아이템 2배·잭팟 배율이 곱해짐, 콤보·게이지 그대로', () => {
  // 평소 중앙: 20 / 가장자리: 60 / 피버(×3) 가장자리: 180 / 점수 2배 아이템: 두 배 / rand 0(잭팟 확정 상황)이면 잭팟 배율 곱
});
```

### Task 3: 조합 보너스 5개

**Files:**
- Modify: `shared/src/arcade.ts` (`COMBO`, `COMBOS` 문구)
- Modify: `shared/src/rules.ts` (`resolveClaim`, `bossHitInfo`, `breakCombo`, `startRound`, `PlayerState.ironLeft` 삭제)
- Modify: `server/src/room.ts` (보스 타격·막타 점수가 `bossHitInfo`의 값을 쓰는지 확인)
- Modify: `client/src/main.ts`, `client/src/effectsUI.ts` (철옹성 남은 횟수 표시 삭제, 발동 표시)

**Interfaces:**
- Produces:
  - `COMBO = { feverAdd: 1, comboBonusMult: 2, bossDmgAdd: 1, bossHitMult: 1.5, bossKillMult: 2, stealMult: 3, stealMarkCutMs: 1_000, jackpotAdd: 10, outskirtsMult: 1.5, ironKeepPct: 80 }` (`comboBonusAdd`·`stealAdd`·`ironPerRound` 삭제)
  - **콤보 머신:** 콤보 보너스 점수 `(기본 + 장인 레전드) × (폭주 레전드 2배) × comboBonusMult`
  - **보스 헌터:** `bossHitInfo`에서 `damage += bossDmgAdd`(지금처럼 해머 레전드 뒤), `hit ×= bossHitMult`, `kill ×= bossKillMult`
  - **견제왕:** 견제·반격으로 얻는 `pts ×= stealMult`(폭죽·필드 클리어 제외). 표적 시간 `markMs −= stealMarkCutMs`(0 아래로 안 감, 철면피와 같이 적용)
  - **철옹성:** `breakCombo`에서 끊길 때 `kept = max(보험으로 남는 콤보, floor(combo × ironKeepPct/100))`. 기세·콤보 고정 아이템이면 지금처럼 안 줄어요(먼저 판정). 리바운드 판정은 실제로 줄어든 양 기준이에요.
  - **미식가:** 노란 원을 내 색 원과 같은 분기로 처리해요.
    - 점수는 `own`(편식가 포함, 외길이면 0) + `yellowTaste`예요.
    - 피버 게이지는 `RULES.fever.own`(편식가 레전드면 2배)이에요.
    - `res.type = 'own'`이에요.
  - **문구 (`COMBOS[].text`, 상수에서)**
    - 콤보 머신: "콤보 보너스 ×2"
    - 보스 헌터: "보스 피해 +1, 타격 점수 ×1.5, 막타 점수 ×2"
    - 견제왕: "견제·반격 점수 ×3, 표적 시간 −1초"
    - 철옹성: "콤보가 끊기지 않고 20%만 줄어듦"
    - 미식가: "노란 원도 내 색 원처럼 (점수·피버 게이지)"
  - **클라이언트**
    - 철옹성 칩의 남은 횟수 표시를 지워요.
    - 내 콤보가 0이 아닌 값으로 줄었고 철옹성을 가졌으면 "철옹성! 콤보 유지"를 띄우고 칩을 반짝여요(`players` 갱신에서 이전 콤보와 비교).

- [ ] **Step 1: 구현** — 위대로.
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 5에서 실행)** — `shared/test/combos.test.ts`의 기존 조합 효과·철옹성 테스트를 새 규칙으로 바꾸고 추가

```ts
test('콤보 머신: 콤보 보너스 ×2 (장인 레전드 +10까지 두 배)', () => {});
test('보스 헌터: 피해 +1, 타격 점수 ×1.5, 막타 ×2 (해머 레전드 3타 뒤에도 +1)', () => {});
test('견제왕: 견제·반격 점수 ×3, 표적 시간 −1초, 폭죽으로 잡은 남의 색은 제외', () => {});
test('철옹성: 끊겨도 80% 유지, 보험 100%면 그대로, 기세면 안 줄어듦, 견제당해도 80%', () => {});
test('미식가: 노란 원 = 내 색 점수(편식가 포함)·게이지, 외길이면 0점', () => {});
```

### Task 4: 무지개 사냥 레전드

**Files:**
- Modify: `shared/src/arcade.ts` (`LEGEND.rainbowFeverMult: 2`, `LEGEND_TEXT.rainbowHunt`)
- Modify: `shared/src/rules.ts` (`resolveClaim` 무지개 분기)

**Interfaces:**
- Produces:
  - 무지개 분기에서 즉시 피버(`burstFever`)를 없애요. 대신 `addFever(RULES.fever.rainbow × (레전드면 LEGEND.rainbowFeverMult))`예요.
  - 문구는 `무지개 원의 피버 게이지 ${LEGEND.rainbowFeverMult}배`예요.

- [ ] **Step 1: 구현** — 위대로. `burstFever`가 다른 곳에서 안 쓰이면 `addFever` 안으로 되돌린다.
- [ ] **Step 2: 타입 검사** — `npm run typecheck`.
- [ ] **Step 3: 테스트 (Task 5에서 실행)** — `legend.test.ts`·`fixes.test.ts`의 무지개 사냥 레전드 테스트를 바꾼다

```ts
test('무지개 사냥 레전드: 게이지 +50, 0에서는 피버 아님, 50 이상이면 그때 피버(방해 전파도)', () => {});
```

### Task 5: 테스트·확인·문서·커밋·리뷰

- [ ] **Step 1: 테스트 작성** — Task 1~4의 테스트를 쓰고, 바뀐 규칙에 맞춰 기존 테스트를 고친다.
- [ ] **Step 2: 전체 테스트** — `npm test` → 모두 통과.
- [ ] **Step 3: 타입 검사·빌드** — `npm run typecheck && npm run build`.
- [ ] **Step 4: 브라우저 확인**
  - 데스크톱 크기(1920×960)와 세로로 긴 창(800×1200), 폰 폭(375)에서 확인해요.
    - 정사각형 상자, 판 테두리, 여백 어둡게
    - 피버 때 판 테두리
    - 점수 구역 원, 클릭 위치 일치
  - 장애물 코스로 레이저·막대가 구석까지 닿는지 확인해요.
- [ ] **Step 5: 문서** — `README.md`(판 크기·황금 원·조합 표·무지개 사냥), `docs/ROADMAP.md`, 설계 문서 상태 '구현 완료'.
- [ ] **Step 6: 커밋 (목적별)**
  - `feat: 판을 1100×1100 정사각형으로, 판 테두리·피버 테두리`
  - `balance: 황금 원이 다른 원처럼 배율을 받음`
  - `balance: 조합 보너스 조정 (콤보 머신·보스 헌터·견제왕·철옹성·미식가)`
  - `balance: 무지개 사냥 레전드를 즉시 피버 대신 게이지 2배로`
  - `test: …`
  - `docs: …` (설계·계획 포함)
- [ ] **Step 7: 최종 리뷰** — 새 리뷰어(가장 좋은 모델)가 전체를 보고, 중요한 지적만 재현 테스트 → 수정.
