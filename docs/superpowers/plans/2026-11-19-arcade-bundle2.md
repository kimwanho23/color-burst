# 아케이드 2차 묶음 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 약한 증강 정리, 새 일반 증강 3장과 조합 1개, 유니크 등급 7장, 등급 확률·레전드 천장, 버그 2개를 아케이드에 넣는다.

**Architecture:** 증강 효과를 읽는 모든 곳을 `modsFor(p)`·`legendsFor(p)`·`combosFor(p)`·`synergiesFor(p)`(arcade.ts) 네 함수로 모은다. 이 함수들이 무의 시간(`p.silenced`)과 거울(`p.mirror`)을 반영한다. 유니크는 저주·특별 카드처럼 `unique: true` 표시가 붙은 카드(tier 0 저장)이고, `rollOptions`가 레어로 굴린 카드 일부를 유니크로 바꾼다.

**Tech Stack:** TypeScript, Node `node:test` + `tsx`, socket.io 서버, Vite 클라이언트.

**Spec:** `docs/superpowers/specs/2026-11-19-arcade-bundle2-design.md`

## Global Constraints

- 작업 브랜치 `feat/arcade-bundle2` (main에서 만듦). `main` 푸시는 Render 배포다. 원격 푸시는 사용자가 요청할 때만.
- 커밋 작성자 `Kim Wan ho`. 메시지 `<타입>(<범위>): <한국어 요약>`. 수치 조정은 `balance`, 기능 `feat`, 버그 `fix`, 구조 `refactor`. 한 커밋 한 목적. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전 `npm run typecheck`와 `npm run build` 통과. 테스트는 `npm test` (단일 파일: `node --import tsx --test shared/test/<파일>.test.ts`).
- 아케이드 증강 수치는 `shared/src/arcade.ts` 상수(`ARCADE`·`LEGEND`·`COMBO`·`AUG`·`GROWTH`·`TIER_ODDS`·새 `UNIQUE`)에, 일반 게임 수치는 `RULES`에 둔다. 설명 문구는 상수로 만든다.
- 정밀 사격 명중 시 글자를 띄우지 않는다 (과녁 링만).
- 유니크: 등급 하나, 수치 고정, 레전드 효과 없음, 사람마다 한 게임 1장, 같은 유니크 중복 없음, 조합·시너지·진화에 안 셈, 색 금빛 주황.
- 무의 시간은 저주·특별 카드를 끄지 않는다.

## Review Focus

1. 무의 시간이 걸린 사람의 증강 효과가 **어느 경로로든** 새면 안 된다(자석 반경, 넓은 손, 강탈, 잭팟, 자동 시전, 보스 점수 등). → Task 1의 소스 검사 테스트 + Task 7 대표 경로 테스트.
2. 공명끼리 피버가 연쇄로 터질 때 무한 반복이 없어야 한다(피버 중엔 게이지가 안 참). → Task 9 `공명: 서로 가진 둘의 피버 연쇄가 끝난다`.
3. 일시정지·재접속 중에 무의 시간이 끝나는 시각이 밀려야 하고, 재접속한 화면이 상태를 그대로 받아야 한다. → Task 7 `무의 시간: 일시정지로 종료 시각이 밀린다`.
4. 봇이 정밀 사격을 떠안게 돼도(다른 선택지가 없을 때) 항상 최대 배율을 받으면 안 된다. → Task 11 `정밀 사격: 봇은 효과 없음`.
5. 저장 상태에 지운 증강 ID(`chainCombo`·`collector`·`jammer`)가 남아 있어도 서버·화면이 터지지 않아야 한다. → Task 2 `지운 증강 ID는 무시`.

---

### Task 1: 효과용 증강 읽기 한 곳으로 모으기 (refactor)

**Files:**
- Modify: `shared/src/arcade.ts` (새 함수, `hasLegend`)
- Modify: `shared/src/rules.ts`, `shared/src/items.ts`, `shared/src/bossScore.ts`, `shared/src/events.ts`, `server/src/room.ts`, `client/src/*.ts` (호출부 치환)
- Modify: `shared/src/rules.ts` `PlayerState`·`newPlayer`
- Test: `shared/test/activepicks.test.ts` (새 파일)

**Interfaces:**
- Produces (arcade.ts):
  - `type PickHolder = { picks: readonly Pick[]; silenced?: boolean; mirror?: Pick | null }`
  - `activePicks(p: PickHolder): Pick[]`: `silenced`면 저주·특별 카드만, 아니면 `p.picks` 그대로 (거울 미포함).
  - `modsFor(p: PickHolder): Mods`: `modsOf(activePicks(p))`에 `p.mirror`(silenced가 아니면) 값을 더한 결과. 거울 몫은 그 증강의 상한(`evolvedCap`, 진화 여부는 원래 픽 기준)까지. 거울은 진화 판정에 안 들어간다.
  - `legendsFor(p: PickHolder): Set<AbilityId>`: `legendOf(activePicks(p))` + 거울 픽이 tier 3이면 그 id.
  - `combosFor(p: PickHolder): Set<ComboId>` = `combosOf(activePicks(p))` (거울 제외).
  - `synergiesFor(p: PickHolder): Set<SynergyCat>` = `synergiesOf(activePicks(p))` (거울 제외).
  - `hasLegend(p, id)`는 `legendsFor(p).has(id)`로 바꾼다 (시그니처 그대로).
- Produces (rules.ts `PlayerState`): `silenced: boolean`, `silencedUntil: number`, `mirror: Pick | null` (newPlayer 기본 `false`, `0`, `null`).

- [ ] **Step 1: 브랜치 만들기**

Run: `git switch -c feat/arcade-bundle2`

- [ ] **Step 2: 실패하는 테스트 작성** (`shared/test/activepicks.test.ts`)

```ts
test('activePicks: 무의 시간이면 저주·특별만', () => {
  const p = { picks: [{ id: 'hammer', tier: 2 }, { id: 'oneWay', tier: 0 }, { id: 'flip', tier: 0 }], silenced: true } as PickHolder;
  assert.deepEqual(activePicks(p).map((x) => x.id), ['oneWay', 'flip']);
});
test('modsFor: 거울 몫을 더하되 상한까지', () => {
  const p = { picks: [{ id: 'jackpot', tier: 3 }], mirror: { id: 'jackpot', tier: 3 } } as PickHolder;
  assert.equal(modsFor(p).jackpot, 35); // 30 + 30 → 상한 35
});
test('combosFor: 거울은 조합을 완성하지 않음', () => {
  const p = { picks: [{ id: 'comboArtist', tier: 0 }], mirror: { id: 'insurance', tier: 0 } } as PickHolder;
  assert.equal(combosFor(p).has('comboMachine'), false);
});
test('hasLegend: 무의 시간이면 false, 거울 레전드는 true', () => { /* hammer tier3 + silenced → false; mirror {hunter,3} → hasLegend(p,'hunter') true */ });
test('효과 계산은 p.picks를 직접 읽지 않음 (raw-picks 표시 제외)', () => {
  // shared/src·server/src·client/src의 .ts 파일을 읽어
  // /\b(modsOf|legendOf|combosOf|synergiesOf|synergyProgress)\(\s*[\w.]*\bpicks\s*\)/ 에 맞는 줄 중
  // `// raw-picks` 주석이 없는 줄이 0개여야 한다. arcade.ts 안의 정의·내부 구현은 제외한다.
});
```

- [ ] **Step 3: 테스트 실패 확인** — Run: `node --import tsx --test shared/test/activepicks.test.ts` → FAIL (`activePicks` 없음)

- [ ] **Step 4: 함수 구현 후 호출부 치환**

`modsOf(x.picks)` → `modsFor(x)`, `legendOf(x.picks)` → `legendsFor(x)`, `combosOf(x.picks)` → `combosFor(x)`, `synergiesOf(x.picks)` → `synergiesFor(x)`. 바꾸지 않을 곳(화면 표시용 빌드 타일·조합 진행도, 증강 선택 `rollOptions` `owned`, `buildWeight`, 진화 표시, 게임 기록 로그)은 그 줄에 `// raw-picks` 주석을 단다. `addStack`의 최대 칸은 `modsOf(activePicks(p))`(거울 제외)를 쓴다.

- [ ] **Step 5: 전체 확인** — Run: `npm test && npm run typecheck && npm run build` → 모두 PASS (동작 변화 없음)

- [ ] **Step 6: 커밋** — `refactor: 증강 효과 읽기를 modsFor·legendsFor·combosFor로 모으기`

---

### Task 2: 약한 증강 3장 삭제 (연쇄 콤보·수집가·방해 전파)

**Files:**
- Modify: `shared/src/arcade.ts` (`AbilityId`, `ABILITIES`, `LEGEND_TEXT`, `LEGEND.collectorUp`/`chainEvery`/`jammerSlowMs`, `AUG.chainEvery`/`chainR`)
- Modify: `shared/src/rules.ts` (`burstFever`의 jammer, 연쇄 콤보 처리), `shared/src/items.ts` (`applyItem` 수집가 배율), `server/src/room.ts` (`claimItem` 수집가 레전드, 연쇄 콤보, `offPool`의 collector), `client/src/icons.ts`, 도감
- Modify: 기존 테스트 `shared/test/fixes.test.ts`, `legend.test.ts`, `team.test.ts`, `boss-fixes.test.ts`, `room.test.ts`에서 지운 증강을 쓰는 테스트 삭제·수정
- Test: `shared/test/arcade.test.ts`

**Interfaces:** Produces: 없음 (삭제만). `modsOf`/`groupPicks`/화면은 모르는 id를 건너뛴다.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('지운 증강은 목록에 없음', () => {
  for (const id of ['chainCombo', 'collector', 'jammer']) assert.equal(ABILITIES.some((a) => a.id === id), false);
});
test('지운 증강 ID는 무시', () => {
  const picks = [{ id: 'jammer', tier: 3 }, { id: 'hammer', tier: 1 }] as unknown as Pick[];
  assert.equal(modsOf(picks).hammer, 2);
  assert.doesNotThrow(() => { legendOf(picks); combosOf(picks); synergiesOf(picks); groupPicks(picks); });
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test shared/test/arcade.test.ts` → FAIL
- [ ] **Step 3: 삭제 구현.** `groupPicks`·`legendOf`·`synergyProgress`·클라이언트 `tierLabel`·아이콘 조회가 `ABILITY[id]`가 없을 때 건너뛰게 한다.
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋** — `feat(shared): 약한 증강 연쇄 콤보·수집가·방해 전파 삭제`

---

### Task 3: 방패·도발 리메이크

**Files:**
- Modify: `shared/src/arcade.ts` (`shield`·`taunt` desc), `shared/src/rules.ts` (`breakCombo`, 견제 경로의 방패·도발 처리), `shared/src/items.ts` (1등 저격의 콤보 0)
- Test: `shared/test/legend.test.ts` 또는 새 `shared/test/remake.test.ts`

**Interfaces:**
- Consumes: `modsFor`, `legendsFor` (Task 1)
- Produces: `breakCombo(p, m, now, byOther?)`가 콤보 고정·기세 다음에 `p.shieldLeft > 0`이면 1 소모하고 `false`(안 줄어듦)를 돌려준다. 1등 저격도 콤보를 0으로 만들기 전에 같은 방패 판정을 거친다(`breakComboAll(p, now)` 같은 작은 함수로 묶어도 됨).

- [ ] **Step 1: 실패하는 테스트** (`remake.test.ts`)

```ts
test('방패: 헛클릭으로 끊겨도 막고 횟수 1 소모', () => { /* shield tier0 → shieldLeft 1, combo 12, resolveMiss → combo 12, shieldLeft 0; 두 번째 헛클릭 → 보험 없으면 0 */ });
test('방패: 보험보다 먼저', () => { /* shield + insurance 40, combo 10, 헛클릭 → combo 10, shieldLeft 0 */ });
test('방패: 1등 저격 콤보 0도 막음', () => {});
test('방패 레전드: 견제로 막으면 견제한 사람 점수 3점 빼앗음', () => {});
test('도발: 상대 게이지에서 뺀 만큼 내 게이지에 더함', () => { /* taunt 10, 상대 fever 30 → 상대 20, 나 +10 (충전 배율 없음) */ });
test('도발: 상대에게 있는 만큼만', () => { /* taunt 25, 상대 fever 5 → 상대 0, 나 +5 */ });
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test shared/test/remake.test.ts` → FAIL
- [ ] **Step 3: 구현.** 방패 desc `콤보가 끊길 때 통째로 막음, 라운드당 ${v}번`. 도발 desc `견제하면 상대 피버 게이지 ${v}%를 빼앗아 내 게이지에`. 내 게이지에는 `addFever(..., raw = true)`로 더한다.
- [ ] **Step 4: 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: 커밋 두 개** — `feat(shared): 방패를 원인 무관 콤보 끊김 막기로 리메이크`, `feat(shared): 도발이 상대 피버 게이지를 빼앗아 오게 리메이크`

---

### Task 4: 버그 2개

**Files:**
- Modify: `shared/src/rules.ts` (`resolveClaim` 물들이기 분기, `comboBonusOf`, 단련 칸 `drillOnCombo` 주변, `breakCombo`, `startRound`)
- Modify: `PlayerState`에 `comboPaidTo: number` (newPlayer 0)
- Test: `shared/test/fixes.test.ts`

**Interfaces:** Produces: `p.comboPaidTo` — 이미 보상한 콤보 높이. 콤보 보너스·단련 문턱은 `crossedCombo(Math.max(before, p.comboPaidTo), p.combo, every)`로 판정하고 판정 뒤 `p.comboPaidTo = Math.max(p.comboPaidTo, p.combo)`. 콤보가 0이 되면(어떤 경로든) `comboPaidTo = 0`. `startRound`에서도 0.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('물들이기 + 미식가 + 편식가 레전드: 노란 원 게이지 2배', () => {
  // picky tier3 + yellowTaste, 물들이기 버프 → 노란 원 하나 → fever 증가량 === RULES.fever.own * LEGEND.pickyFeverMult (충전 배율 1인 기본 규칙)
});
test('철옹성: 일부 줄어든 뒤 같은 문턱을 다시 넘어도 콤보 보너스 없음', () => {
  // ironWall 조합, combo 9 → 10 (보너스) → 헛클릭(8로 줄어듦) → 9 → 10: 두 번째 comboBonus === false
});
test('콤보가 0이 되면 문턱 보상 다시 받음', () => { /* 0으로 끊긴 뒤 다시 10 → 보너스 */ });
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test shared/test/fixes.test.ts` → 새 3개 FAIL
- [ ] **Step 3: 구현.** 물들이기 분기의 게이지를 `RULES.fever.own * (L.has('picky') ? LEGEND.pickyFeverMult : 1)`로.
- [ ] **Step 4: 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: 커밋 두 개** — `fix(shared): 물들이기·미식가·편식가 레전드 노란 원 게이지 절반`, `fix(shared): 콤보가 일부 줄어든 뒤 같은 문턱 보너스를 다시 주지 않음`

---

### Task 5: 등급 확률과 레전드 천장

**Files:**
- Modify: `shared/src/arcade.ts` (`TIER_ODDS`, `LAST_PLACE_FINAL_ODDS`, 새 `hasLegendPick`)
- Modify: `server/src/room.ts` (`roll`)
- Test: `shared/test/picks.test.ts`, `shared/test/room.test.ts`

**Interfaces:**
- Produces: `hasLegendPick(picks: readonly Pick[]): boolean` — tier 3이고 저주·특별·유니크가 아닌 픽이 있으면 true (진화 미포함).
- `room.roll`: `k === 2 && !o.firstDone && p && !hasLegendPick(p.picks)`이면 `allLegend: true`. 다시 뽑기도 같은 `roll`을 거치므로 유지된다.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('확률 표: 3·4라운드 뒤와 꼴찌 마지막 줄', () => {
  assert.deepEqual(TIER_ODDS[2], [40, 27, 30, 3]);
  assert.deepEqual(TIER_ODDS[3], [25, 22, 48, 5]);
  assert.deepEqual([...LAST_PLACE_FINAL_ODDS], [15, 20, 50, 15]);
});
test('hasLegendPick: 일반 레전드만', () => { /* hammer 3 → true; flip(특별)·oneWay(저주) tier3 기록 → false */ });
test('천장: 3라운드 뒤 첫 묶음, 레전드 없는 사람은 전부 레전드', () => { /* Room을 아케이드로 3라운드 뒤 선택까지 진행(room.test.ts의 기존 헬퍼 사용), offer 3장 tier 모두 3 */ });
test('천장: 이미 레전드가 있으면 평소대로', () => {});
test('천장: 다시 뽑아도 전부 레전드', () => {});
```

- [ ] **Step 2: 실패 확인** — 해당 테스트 파일 실행 → FAIL
- [ ] **Step 3: 구현** (표 값 교체는 `balance` 커밋, 천장은 `feat` 커밋으로 나눈다)
- [ ] **Step 4: 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: 커밋 두 개** — `balance(shared): 3·4라운드 뒤 레어 확률을 에픽으로 옮김`, `feat(server): 3라운드 뒤까지 레전드가 없으면 전부 레전드 (천장 1회)`

---

### Task 6: 유니크 등급 기반

**Files:**
- Modify: `shared/src/arcade.ts` (`AbilityDef.unique`, `AbilityCategory`에 `'유니크'`, `UNIQUES` 배열, `ALL_ABILITIES`, `isUnique`, `UNIQUE_ODDS`, `UNIQUE_LAST_FINAL`, `rollOptions`, `RollOpts.unique`)
- Modify: `server/src/room.ts` (`roll`에서 `unique` 옵션), `client/src/arcadeUI.ts` (`tierLabel`, 카드 테두리), `client/src/codex.ts` (유니크 분류), `client/src/style.css` (금빛 주황), `client/src/icons.ts`
- Test: `shared/test/unique.test.ts` (새 파일)

**Interfaces:**
- Produces:
  - `type UniqueId = 'silence' | 'mirror' | 'resonance' | 'huntInstinct' | 'harvest' | 'ember' | 'goldCollector'` (`AbilityId`에 포함)
  - `UNIQUES: readonly AbilityDef[]` — 각 `{ cat: '유니크', values: [1,1,1,1], cap: 1, unique: true, aim: AbilityCategory }` (`aim`은 빌드 가중치용 분류: silence 견제, mirror 보조, resonance 피버, huntInstinct 보스, harvest 점수, ember 피버, goldCollector 점수). 이름·설명은 스펙 3절 표 그대로.
  - `UNIQUE = { silenceMs: 2_000, resonanceFever: 20, hunt: { assist: 1, solo: 3, pct: 10, max: 10, shortRoundMs: 60_000 }, harvest: { every: 25, pct: 2, max: 15 }, ember: { ms: 1_000, max: 5 }, gold: { points: 20, pct: 5, max: 3 } } as const`
  - `UNIQUE_ODDS = [0, 3, 8, 10] as const` (차례별, 카드 한 장의 실제 확률 %), `UNIQUE_LAST_FINAL = 10`
  - `isUnique(id: AbilityId): boolean`
  - `RollOpts.unique?: boolean` — true면 유니크가 나올 수 있다 (room이 `!p.picks.some(isUnique) && !allLegend`일 때 true).
- `rollOptions` 알고리즘: 등급을 굴린 결과가 레어(1)면 확률 `uniquePct / 100 / (odds[1] / Σodds)`로 그 카드를 유니크로 바꾼다. `uniquePct`는 꼴찌면 다음 차례 줄(마지막이면 `UNIQUE_LAST_FINAL`), 아니면 `UNIQUE_ODDS[i]`. 한 묶음에 유니크는 최대 1장. 고르는 유니크는 아직 안 가진 것 중 `buildWeight`(유니크는 `aim` 분류로 같은 분류 판정)로. 저주·특별 끼우기와 꼴찌 등급 보장은 유니크 자리를 건드리지 않는다. 유니크는 tier 0으로 저장.
- `combosOf`·`synergyProgress`·`evolvedOf`는 유니크를 세지 않는다.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('유니크 실제 확률: 차례별 카드 한 장', () => {
  // 시드 고정 rand로 rollOptions(k, false, rand, { minTier: k >= 1 ? 1 : 0, unique: true }, 1)를 20만 번 → 유니크 비율
  // k=1 ≈ 3%, k=2 ≈ 8%, k=3 ≈ 10% (±0.5%p), 레전드 비율 k=2 ≈ 5%, k=3 ≈ 6.7% (그대로)
});
test('유니크: unique 옵션이 없으면 안 나옴', () => {});
test('유니크: 한 묶음 최대 1장, 가진 유니크는 다시 안 나옴', () => {});
test('유니크: allLegend 묶음에는 없음', () => {});
test('유니크: 조합·시너지·진화에 안 셈', () => {});
test('꼴찌: 1라운드 뒤에도 다음 줄 확률(3%)로 유니크', () => {});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test shared/test/unique.test.ts` → FAIL
- [ ] **Step 3: 구현** (효과는 아직 없음, 카드만 뜨고 고를 수 있음)
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋** — `feat: 유니크 등급 추가 (게임당 1장, 레어 몫에서 등장)`

---

### Task 7: 유니크 — 무의 시간

**Files:**
- Modify: `shared/src/rules.ts` (`burstFever`, `shiftTimes`), `server/src/room.ts` (틱에서 해제, 라운드 끝 해제, `emitPlayers`), `client/src/main.ts`·`arcadeUI.ts`·`render.ts` (띠, 회색 타일, 점수판 표시, 피버 시작 파동)
- Test: `shared/test/unique.test.ts`

**Interfaces:**
- Consumes: `modsFor`, `PlayerState.silenced`/`silencedUntil` (Task 1), `UNIQUE.silenceMs` (Task 6)
- Produces: `burstFever`에서 `modsFor(p).silence`면 적(`isFoe(p, o, G.team)`) 모두에게 `o.silenced = true; o.silencedUntil = now + UNIQUE.silenceMs` (덮어쓰기). 해제는 `releaseSilence(p: PlayerState, now: number): boolean` (rules.ts, `now >= silencedUntil`이면 false로 바꾸고 true 반환) — 서버 틱이 호출하고 바뀌면 `emitPlayers`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('무의 시간: 내 피버가 시작되면 상대 증강이 2초 꺼짐', () => {
  // A: silence 유니크, B: hammer·jackpot·comboMachine 조합·hunter 레전드·oneWay 저주·flip 특별
  // A startFever 경로(burstFever) → B.silenced, modsFor(B).hammer 0, jackpot 0, combosFor(B) 빔, hasLegend(B,'hunter') false, modsFor(B).oneWay 1, flip 1
});
test('무의 시간: 2초 뒤 풀림', () => { /* releaseSilence(B, now + 2000) → true, modsFor(B).hammer 복귀 */ });
test('무의 시간: 다시 걸리면 덮어씀', () => {});
test('무의 시간: 팀전은 상대 팀만', () => {});
test('무의 시간: 걸린 사람은 자기 무의 시간이 안 터짐', () => {});
test('무의 시간: 걸린 동안 성장 칸이 안 쌓임', () => { /* drill 보유, silenced, 10콤보 → stacks.drill 그대로 */ });
test('무의 시간: 대표 경로 — 자석 반경·넓은 손·자동 시전·보스 타격 점수가 꺼짐', () => { /* magnetOf, reachOf, autoEveryMs, 보스 점수 함수 */ });
test('무의 시간: 일시정지로 종료 시각이 밀린다', () => { /* shiftTimes(p, since, 5000) → silencedUntil += 5000 */ });
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현.** `shiftTimes`의 키 목록에 `silencedUntil`. 라운드가 끝나면 모두 `silenced = false`. 화면: 걸린 사람은 "무의 시간" 띠와 내 증강 타일 회색, 점수판 칩에 작은 표시.
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋** — `feat: 유니크 무의 시간 (내 피버에 상대 증강 2초 끔)`

---

### Task 8: 유니크 — 거울

**Files:**
- Modify: `server/src/room.ts` (라운드 시작에 `p.mirror` 정하기, 라운드 끝에 `null`), `shared/src/arcade.ts` (`pickMirror`), 화면(`arcadeUI.ts` "거울: ○○" 타일)
- Test: `shared/test/unique.test.ts`

**Interfaces:**
- Produces: `pickMirror(p: PlayerState, players: readonly PlayerState[], team: boolean, rand?: () => number): Pick | null` — `p.picks`(raw)에 `mirror` 유니크가 없으면 null. 대상: 나를 뺀 적 중 점수 1등(내가 전체 1등이면 적 중 1등 = "2등"), 그 사람의 일반 증강(저주·특별·유니크 제외) 중 무작위 하나를 `{ id, tier }` 그대로. 없으면 null.

- [ ] **Step 1: 실패하는 테스트** — `거울: 1등의 일반 증강 하나`, `거울: 내가 1등이면 2등`, `거울: 유니크·저주·특별은 안 고름`, `거울: 팀전은 상대 팀 1등`, `거울: 대상에게 일반 증강이 없으면 null`, `거울: 복사한 증강 효과가 modsFor에 들어가고 무의 시간이면 빠짐`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** (라운드 시작 `startRound` 호출 직후 room에서 `p.mirror = pickMirror(...)`)
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋** — `feat: 유니크 거울 (라운드마다 1등의 증강 하나 복사)`

---

### Task 9: 유니크 — 공명·불씨

**Files:**
- Modify: `shared/src/rules.ts` (`burstFever`, `startFever`의 피버 시간, `settleFever` 또는 피버가 끝나는 지점), `PlayerState.stacks` 키 확장
- Test: `shared/test/unique.test.ts`

**Interfaces:**
- Produces: `p.stacks.ember` (0~`UNIQUE.ember.max`). 피버가 끝날 때 `modsFor(p).ember`면 +1 (무의 시간이면 안 쌓임). 피버 시간 = 기존 + `stacks.ember * UNIQUE.ember.ms` (`modsFor(p).ember`일 때만).
- `burstFever(p, ...)`: 다른 모든 사람 `o`(팀원·봇 포함)에 대해 `modsFor(o).resonance`면 `addFever(o, UNIQUE.resonanceFever, now, G, players, true)`.

- [ ] **Step 1: 실패하는 테스트** — `공명: 남의 피버에 내 게이지 +20`, `공명: 무의 시간이면 없음`, `공명: 서로 가진 둘의 피버 연쇄가 끝난다` (A·B 모두 공명, 게이지 90에서 A 피버 → B 피버 → A는 피버 중이라 안 참, 호출이 끝남), `불씨: 피버가 끝날 때 한 칸, 다음 피버 +1초`, `불씨: 상한 5칸`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: 커밋** — `feat(shared): 유니크 공명·불씨`

---

### Task 10: 유니크 — 사냥 본능·수확·황금 수집가

**Files:**
- Modify: `shared/src/rules.ts` (`extraMult`, `resolveClaim`의 원 획득 수 세기, `goldGain`), `shared/src/bossScore.ts` (보스 점수 배율), `server/src/room.ts` (보스 처치 관여·독식 판정 지점, `claimGold`)
- Modify: `PlayerState`에 `harvestCount: number` (0)
- Test: `shared/test/unique.test.ts`

**Interfaces:**
- Produces: `addUniqueStack(p: PlayerState, id: 'huntInstinct' | 'harvest' | 'goldCollector', n?: number): void` (rules.ts) — `modsFor(p)[id]`가 없거나 무의 시간이면 안 쌓음, `UNIQUE.*.max`까지.
  - 사냥 본능: 처치된 보스에 피해를 1 이상 준 사람 +`assist`, 독식한 사람 +`solo` (독식이면 관여분과 합쳐 +3이 아니라 +3만). `G.roundMs < UNIQUE.hunt.shortRoundMs`면 2배. 보스 점수(타격·막타·독식·MVP)에 ×`(1 + 칸 × pct/100)`.
  - 수확: 점수 출처 '원'으로 들어가는 획득(직접 클릭·넓은 손·헛손질 보정·자동 획득, 자석 제외)마다 `harvestCount++`, `every`마다 한 칸. `extraMult`에 ×`(1 + 칸 × 2/100)`.
  - 황금 수집가: `goldGain`에 +`gold.points`(배율 전 기본 점수에), 잡을 때마다 한 칸. `extraMult`에 ×`(1 + 칸 × 5/100)`.
  - `extraMult` 안이라 배율 쌓임 상한(×20) 안에 들어간다.

- [ ] **Step 1: 실패하는 테스트** — 각 유니크의 칸 쌓임·상한·배율, `사냥 본능: 30초 라운드는 칸 2배`, `수확: 자석 획득은 안 셈`, `황금 수집가: 황금 원 +20`, `무의 시간이면 칸 효과 없음`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 확인** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: 커밋** — `feat: 유니크 사냥 본능·수확·황금 수집가`

---

### Task 11: 정밀 사격

**Files:**
- Modify: `shared/src/arcade.ts` (`precise` 증강, `AUG.preciseR: 0.4`, `ASSIST_ABILITIES`), `shared/src/rules.ts` (`resolveClaim` opts에 `precise?: boolean`, 배율·레전드 콤보), `server/src/room.ts` (`click`에서 정밀 판정 후 `claim`에 전달), `client/src/render.ts` (과녁 링, 글자 없음)
- Test: `shared/test/precise.test.ts` (새 파일)

**Interfaces:**
- Produces: `{ id: 'precise', name: '정밀 사격', cat: '점수', values: [0.3, 0.5, 0.8, 1.5], cap: 2, desc: (v) => \`원 가운데(반지름 ${AUG.preciseR * 100}% 안)를 직접 누르면 점수 ×${1 + v}\` }`, `LEGEND_TEXT.precise = '정밀하게 맞히면 콤보 +2'`.
- `room.click`: 직접 맞은 일반 원(`claim(..., 'click')` 경로)에서 `hitWithLag`와 같은 지연 창으로 클릭이 원 중심에서 `c.r * AUG.preciseR` 안이었는지 보고 `claim(p, c, now, 'click', false, precise)`. `claim`이 `resolveClaim(..., { via, zone, precise })`로 넘긴다.
- `resolveClaim`: `opts.precise && via === 'click' && !claimer.bot && modsFor(claimer).precise`이면 일반 원 점수에 ×`(1 + m.precise)`를 배율 상한 안의 곱으로, 레전드면 콤보 +1 더(총 +2). 결과에 `res.precise = true` (화면 링용).

- [ ] **Step 1: 실패하는 테스트** — `정밀 사격: precise면 ×1.3 (노말)`, `정밀 사격: 중첩 상한 ×3`, `정밀 사격: range·magnet·missSave·auto는 없음`, `정밀 사격: 레전드 콤보 +2`, `정밀 사격: 봇은 효과 없음`, `정밀 사격: 보스·황금·아이템 원은 없음`. 서버 판정은 `room.test.ts`에 `정밀 사격: 중심 40% 안 클릭만 precise` (경계 안·밖 두 점).
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋** — `feat: 새 증강 정밀 사격`

---

### Task 12: 보물 상자·아이템 애호가·잡화점

**Files:**
- Modify: `shared/src/arcade.ts` (`treasure`·`itemLover` 증강, `COMBOS`에 `bazaar`, `COMBO.bazaarDur: 1.5`, `COMBO.bazaarFever: 50`, `AUG.treasureFloor`)
- Modify: `shared/src/items.ts` (`applyItem` 버프 시간 ×잡화점), `shared/src/rules.ts` (`rollItemTier` export)
- Modify: `server/src/room.ts` (`claimItem`을 `activateItem`으로 나눔, 콤보 증가 지점에서 상자 카운터, `offPool`에 두 증강)
- Modify: `shared/src/protocol.ts` (`'item:got'`의 `circleId: number | null`, `extra?: boolean`), `client/src/main.ts` (룰렛을 커서 위치·추가 발동도)
- Modify: `PlayerState`에 `chestCount: number` (0)
- Test: `shared/test/items.test.ts`, `shared/test/room.test.ts`

**Interfaces:**
- Produces:
  - `{ id: 'treasure', name: '보물 상자', cat: '보조', values: [50, 67, 83, 125], cap: 167, desc: (v) => \`${treasureEvery(v)}콤보마다 무작위 아이템이 바로 발동\` }` — `treasureEvery(v: number): number = Math.max(6, Math.round(1000 / v))` (노말 20, 레어 15, 에픽 12, 레전드 8, 노말 둘 10, 하한 6). `LEGEND_TEXT.treasure = '희귀 이상 아이템만'`.
  - `{ id: 'itemLover', name: '아이템 애호가', cat: '보조', values: [40, 60, 80, 100], cap: 100, desc: (v) => \`아이템이 발동하면 ${v}% 확률로 새 아이템이 한 번 더\` }`. `LEGEND_TEXT.itemLover = '추가 발동에 성공하면 한 번 더 (최대 3개)'`.
  - `COMBOS`의 `{ id: 'bazaar', name: '잡화점', needs: ['treasure', 'itemLover'], text: \`아이템 효과 시간 ×${COMBO.bazaarDur}, 아이템이 발동할 때마다 피버 게이지 +${COMBO.bazaarFever}\` }`.
  - room: `private activateItem(p: PlayerState, tier: 0 | 1 | 2, x: number, y: number, now: number, circleId: number | null, extra = false): void` — `rollItem` → `applyItem` → `item:got` → 방 단위 효과(장판·폭죽 등은 x, y 기준) → 잡화점이면 `addFever(p, COMBO.bazaarFever, ..., true)` → `extra`가 아니면 애호가 판정: 성공 시 `rollItemTier`로 새 등급을 굴려 `activateItem(..., extra = true)`; 레전드면 성공할 때마다 한 번 더, 추가분 최대 2개. 추가분도 잡화점 +50을 받는다(사용자 결정).
  - `claimItem`은 원을 지우고 `activateItem(p, tier, x, y, now, c.id)`만 부른다(아이템 사냥꾼 등급 올리기는 지금처럼).
  - 상자: 콤보가 오른 만큼(`claim`의 `comboBefore` 비교, `hitBoss`도 같게) `p.chestCount += 증가량`; `modsFor(p).treasure`가 있으면 `treasureEvery` 이상일 때마다 빼고 `activateItem(p, tier, 커서 x, y, now, null)`. tier는 `rollItemTier`, 레전드면 최소 1. 무의 시간이면 카운터만 쌓지 않음(Claude 결정: 꺼진 동안 효과 없음).
  - `applyItem` 버프 시간에 `combosFor(p).has('bazaar') ? COMBO.bazaarDur : 1` 곱하기.

- [ ] **Step 1: 실패하는 테스트** — `treasureEvery: 20/15/12/8, 노말 둘 10, 하한 6`, `보물 상자: N콤보마다 발동, 끊겨도 카운터 유지`, `보물 상자 레전드: 희귀 이상`, `아이템 애호가: 100%면 한 번 더`, `아이템 애호가 레전드: 최대 3개`, `아이템 애호가: 추가분은 다시 판정 안 함 (노말)`, `잡화점: 효과 시간 ×1.5`, `잡화점: 발동마다 게이지 +50, 추가분 포함`, `아이템 원이 꺼진 방에는 두 증강이 안 나옴`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 5: 커밋 두 개** — `feat: 새 증강 보물 상자·아이템 애호가`, `feat(shared): 조합 잡화점`

---

### Task 13: 도감·문서 마무리와 화면 확인

**Files:**
- Modify: `client/src/codex.ts` (유니크 분류·확률 안내), `client/src/icons.ts` (새 아이콘 빠진 것), `docs/ROADMAP.md`, `CHANGELOG.md`, `docs/HANDOFF.md`
- Test: `shared/test/codex.test.ts` (모든 증강·유니크·조합에 아이콘과 도감 항목이 있는지 — 기존 테스트가 있으면 갱신)

- [ ] **Step 1: 도감 테스트 갱신 후 실패 확인** — `node --import tsx --test shared/test/codex.test.ts`
- [ ] **Step 2: 도감·아이콘 채우기** → PASS
- [ ] **Step 3: 문서.** ROADMAP 5번 아케이드 2차 묶음 ✅ (날짜 2026-11-19, 설계 링크), 이번에 안 한 후보(스펙 '넣지 않는 것'의 첫 줄 목록)를 💡로. CHANGELOG [미출시]에 기능·밸런스·수정으로 나눠 추가. HANDOFF에 아케이드 2차 묶음 요약과 확인할 것(유니크 체감, 잡화점 피버 빈도, 정밀 사격 40% 범위).
- [ ] **Step 4: 화면 확인** — 미리보기로 혼자 하기 아케이드를 띄워 유니크 카드 색·라벨, 무의 시간 띠, 거울 타일, 정밀 사격 과녁 링(글자 없음), 보물 상자 룰렛을 확인. 확인 못 한 것은 HANDOFF에 적는다.
- [ ] **Step 5: 전체 확인** — `npm test && npm run typecheck && npm run build` → PASS
- [ ] **Step 6: 커밋** — `docs: 아케이드 2차 묶음 로드맵·변경 기록·인수인계`
