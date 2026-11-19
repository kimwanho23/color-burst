# 얼음 원 · 분열 원 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방 규칙 '특수 원'에 얼음 원(터뜨린 사람 빼고 모두 1초 느려짐 → 1초 기절)과 분열 원(터뜨린 사람 색 파편 4개, 남의 커서에 닿으면 기절)을 더한다.

**Architecture:**
- **공용(shared):** 특수 원 셋을 `isSpecial(kind)`로 묶고, 생성은 특수 원 전체 확률 한 번 + 종류 고르기. 얼음의 느려짐은 새 디버프 `frost`(기존 `slow`와 같은 커서 지연, 시간 상수만 다름), 얼어붙는 예약은 `PlayerState.frostAt`. 기절은 기존 `hazardStun`에 콤보·피버를 건드리지 않는 `soft` 옵션.
- **서버:** 폭탄의 `detonate` 옆에 `popSpecial` 분기(폭탄 → `detonate`, 얼음 → `burstIce`, 분열 → `burstSplit`). 폭탄을 다루던 모든 경로(클릭·넓은 손·장판·폭죽·필드 클리어·십자·봇)를 `isSpecial`로 넓힌다. 연쇄 예약 `pendingBlasts`는 특수 원 셋을 모두 받는다. 틱마다 `tickFrost`(얼어붙음)와 `tickPieces`(파편 커서 피격).
- **화면:** 세 겉모양·연출·효과음, 커서 서리·얼음 결정, 방 규칙·도감·점수 출처 문구.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-19-ice-split-circle-design.md`

## Global Constraints

- **원 안에 한글·영어 글자를 그리지 않는다.** 겉모양은 색·무늬·도형으로만. 숫자와 아이템 원의 `?`만 예외.
- 수치는 `RULES.specialCircles`에만 두고, 화면 문구 속 숫자는 상수에서 만든다.
- 수치 초안: `chance: 0.025`, `weights: { bomb: 1, ice: 1, split: 1 }`, `ice: { r: 36, slowMs: 1_000, slowLagMs: 1_200, stunMs: 1_000, botGapMult: 2 }`, `split: { r: 36, count: 4, pieceR: 22, speedMult: 1.5, stunMs: 1_000 }`, `bomb: { halfWidth: 30, chainDelayMs: 150, r: 36 }`.
- 얼음·분열 기절은 콤보를 끊지 않고 피버도 줄이지 않는다. 레이저·가시 공·링 기절의 기존 동작은 그대로.
- 화면 문구는 한국어. 커밋은 Conventional Commits(`<타입>(<범위>): <한국어 요약>`), 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 커밋 전 `npm run typecheck`·`npm run build` 통과. 테스트는 모든 기능을 구현한 뒤 한꺼번에 쓴다(사용자 지시) — Task 6.
- `main` 푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. **얼어 가는 중에 라운드·판이 끝날 때:** 다음 라운드 시작 직후 얼면 안 된다. `beginRound`·`endRound`·판 종료에서 모든 사람의 `frostAt = 0`, `debuffs.frost` 삭제. → Task 6 테스트 2c
2. **파편이 막 기절한(무적 시간 중인) 사람의 커서를 지날 때:** 파편은 사라지고 기절은 연달아 걸리지 않는다. → Task 6 테스트 4c
3. **팀전에서 팀원:** 얼음에 걸리지 않고, 팀원 색 파편에 닿아도 무사하며 평소처럼 잡을 수 있다. → Task 6 테스트 2b·4b
4. **시간 정지·일시정지 중:** `frostAt`이 멈춘 만큼 밀리고, 시간 정지 중(`now < freezeUntil`)에는 파편 피격을 보지 않는다. → Task 6 테스트 2d·4d
5. **같은 틱에 직접 클릭과 넓은 손이 같은 얼음·분열 원을 고를 때:** 한 번만 터진다(파편 4개, `ice:burst` 1회). → Task 6 테스트 5b

---

### Task 1: 앞선 수정 두 개 (웨이브의 폭탄, 기절한 봇)

설계가 함께 고치기로 한 기존 동작이다. 목적이 달라 기능보다 먼저 따로 커밋한다.

**Files:**
- Modify: `shared/src/waves.ts:71` — `makeWave`가 `makeCircle`에 넘기는 옵션
- Modify: `server/src/room.ts:1447-1450` — 봇 루프

- [ ] **Step 1:** `waves.ts:71`에서 `{ ...opts, itemChance: 0 }`을 `{ ...opts, itemChance: 0, bombChance: 0 }`으로 (Task 2에서 이름이 `specialChance`로 바뀌면 그쪽으로 따라 바꾼다).
- [ ] **Step 2:** 봇 루프 `if (!bot || p.outAt) continue;`를 `if (!bot || p.outAt || isStunned(p, now)) continue;`로.
- [ ] **Step 3:** Run `npm.cmd test` → 기존 718개 PASS (실패하면 봇이 기절 중에도 클릭한다고 가정한 기존 테스트이니 고친다). Run `npm.cmd run typecheck`·`npm.cmd run build` → 성공.
- [ ] **Step 4: 커밋 두 개**
  1. `fix(shared): 웨이브 원에 폭탄 원이 섞이지 않게` — `waves.ts`
  2. `fix(server): 기절한 봇은 클릭하지 않기` — `room.ts` (본문: 1등 저격 스턴도 이제 봇에게 먹힌다)

---

### Task 2: 공용 규칙 — 종류·생성·디버프·기절·점수 출처

**Files:**
- Modify: `shared/src/rules.ts` — `RULES.specialCircles`(`:329-332`), `DebuffId`(`:857`), `PlayerState`(`~:800-845`, 새 필드), `newPlayer`(`:989`)·라운드 초기화(`:1020`), `shiftTimes`(`:882`), `hazardStun`(`:1102`), `CircleKind`(`:667`), `Circle`(`:669`), `SrcKey`·`SRC_KEYS`(`:721-722`), `SpawnOpts`·`makeCircle`(`:1413-1449`), `resolveClaim` 옵션과 `addSrc`(`:1628`, `:1866-1868`)
- Modify: `shared/src/cursor.ts:24-28`, `:131-135`
- Modify: `shared/src/waves.ts:71` (옵션 이름)
- Modify: `shared/src/protocol.ts` — `stun`의 `by`(`:254`), 새 이벤트
- Modify: `shared/src/index.ts` (내보내기)

**Interfaces:**
- Produces:
  - `RULES.specialCircles: { chance: number; weights: Record<SpecialKind, number>; bomb: { halfWidth; chainDelayMs; r }; ice: { r; slowMs; slowLagMs; stunMs; botGapMult }; split: { r; count; pieceR; speedMult; stunMs } }` (값은 Global Constraints)
  - `type SpecialKind = 'bomb' | 'ice' | 'split'`, `CircleKind`에 `'ice' | 'split'`, `isSpecial(kind: CircleKind): kind is SpecialKind`
  - `Circle.splitBy?: string` — 파편의 주인(터뜨린 사람 id)
  - `SpawnOpts.specialChance?: number` (`bombChance`를 대신함). `makeCircle`: 아이템이 아니고 `forceKind`가 없을 때 `rand() < specialChance`면 `rand()` 한 번 더 굴려 `weights` 비율로 종류를 고르고 `r = RULES.specialCircles[kind].r`. `specialChance`가 없거나 0이면 `rand()`를 더 부르지 않는다(기존 시드 재현)
  - `DebuffId`에 `'frost'`. `PlayerState.frostAt: number` (0 = 예약 없음, 얼어붙을 서버 시각). `shiftTimes`의 목록에 `'frostAt'`(0이면 밀지 않음 — 기존 `> since` 조건으로 충분)
  - `followCursor(prev, target, dtMs, slow, lagMs = RULES.sabotage.slowLagMs)`; `CursorMode`에 `lagMs?: number`. `cursorModeOf`는 `frost`가 걸려 있으면 `{ slow: true, lagMs: RULES.specialCircles.ice.slowLagMs }`(slow와 둘 다면 더 큰 지연)
  - `hazardStun(p, now, baseMs, G, players, opts: { soft?: boolean } = {})` — `soft`면 `halveFever`와 `breakCombo`를 건너뛴다. 면역·무적 시간·레이저 내성 감소·`hazardUntil`은 같다
  - `SrcKey`·`SRC_KEYS`에 `'split'`(맨 끝). `resolveClaim` 옵션에 `split?: boolean` — 참이면 원 점수·고정 보너스·콤보 몫을 모두 `'split'`에 넣는다(`cross`·`magnet`·`steal`보다 먼저)
  - `protocol.ts`: `stun`의 `by`에 `'ice' | 'split'`; 새 이벤트 `'ice:burst': (d: { circleId: number; by: string; x: number; y: number; targets: string[]; freezeAt: number }) => void`, `'split:burst': (d: { circleId: number; by: string; x: number; y: number }) => void`, `'split:hit': (d: { circleId: number; playerId: string }) => void`

- [ ] **Step 1:** 위 Produces를 넣는다. `bomb.chance`를 쓰던 곳(`room.ts:1822`, 테스트)은 `RULES.specialCircles.chance`·`specialChance`로 바꾼다.
- [ ] **Step 2:** Run `npm.cmd run typecheck` → 오류 없음. `Record<SrcKey,…>`·`CircleKind` 분기가 화면 쪽에서 깨지면 Task 4에서 채울 자리만 임시로 맞춘다.

---

### Task 3: 서버 — 터뜨리기·얼어붙음·파편 피격·봇

**Files:**
- Modify: `server/src/room.ts` — 필드(`~:114`), `click`(`:880-912`), 장판 루프(`:1437-1441`), `tick`(`:1376`, `tickBlasts` 호출 `:1428` 옆), 봇 루프(`:1459`), `spawnOpts`(`:1822`), `detonate`·`queueBlast`·`tickBlasts`(`:1831-1869`), `fireItem`의 `bomb`/`fieldClear`(`:2017-2027`), `finishResume`(`:774-788`), `beginRound`·`endRound`·판 종료(`pendingBlasts = []` 하는 세 곳 `:1162`, `:1223`, `:2058`)
- Modify: `server/src/bot.ts:23-27`, `:52`

**Interfaces:**
- Consumes: Task 2 전부
- Produces:
  - `private popSpecial(p: PlayerState, c: Circle, now: number, chain = false): boolean` — 종류별로 `detonate`/`burstIce`/`burstSplit`를 부르고 그 결과를 돌려준다
  - `private burstIce(p, c, now): boolean`, `private burstSplit(p, c, now): boolean` — 둘 다 `!this.circles.has(c.id) || isGuarded(c, now)`면 `false`, 아니면 원을 지우고 `true`
  - `private tickFrost(now: number): void`, `private tickPieces(now: number): void`
  - `pendingBlasts`는 그대로(`{ by, circleId, at }`), `tickBlasts`는 `detonate` 대신 `popSpecial`

- [ ] **Step 1: 생성** — `spawnOpts`에서 `specialChance: this.G.specialCircles && !this.tutorial ? RULES.specialCircles.chance : 0`.

- [ ] **Step 2: `burstIce`** — 대상은 `this.players` 중 `p` 자신·`!isFoe(p, o, team)`(팀원)·`o.outAt` 제외. 각 대상에게 철벽이거나 `now < o.stunUntil + RULES.laser.immuneMs || now < (o.hazardUntil ?? 0)`이면 건너뛴다. 아니고 `o.frostAt`이 0이면 `addDebuff(o, 'frost', ice.slowMs, now)`, `o.frostAt = now + ice.slowMs`(이미 진행 중이면 그대로 — 설계 '겹침'). `ice:burst { circleId, by: p.id, x, y, targets, freezeAt }`를 보내고 `emitPlayers()`.

- [ ] **Step 3: `tickFrost`** — `frostAt && frostAt <= now`인 사람마다 `frostAt = 0`, `delete debuffs.frost`, `ms = hazardStun(o, now, ice.stunMs, G, players, { soft: true })`; `ms > 0`이면 `stun { playerId, until: o.stunUntil, by: 'ice' }`. 변화가 있으면 `emitPlayers()`. 시간 정지 중(`now < this.freezeUntil`)이면 아무것도 하지 않는다 — 시간 정지 시작 시 모든 `frostAt`과 `debuffs.frost`를 `+ms` 해 두므로 정지가 끝난 뒤 이어진다.

- [ ] **Step 4: `burstSplit`** — 분열 위치 `q`, 시작 각 `a0 = Math.random() * 2π`. `count`개 파편: `kind: p.color`, `from: q`, `angle: a0 + i·2π/count`, `speed: c.speed * split.speedMult`, `r: split.pieceR`, `born: now`, `splitBy: p.id`, `id`는 기존 원 id 발급 방식. `this.circles`에 넣고 각각 `circle:spawn`, 그 전에 `split:burst`.

- [ ] **Step 5: `tickPieces`** — `now < this.freezeUntil`이면 건너뜀. `splitBy`가 있는 원마다 `isGuarded`면 건너뜀. 사람(`!o.bot`, `!o.outAt`, `isFoe(owner, o, team)` — 주인이 없으면 파편 색 주인 기준)마다 `freshCursor(o.id, now)`가 있고 커서가 원 중심에서 `pieceR + RULES.hitPad` 안이면: 원 삭제, `split:hit { circleId, playerId }`, `ms = hazardStun(o, now, split.stunMs, G, players, { soft: true })`, `ms > 0`이면 `stun { …, by: 'split' }`. 가시 공(`:958-978`)과 같은 모양.

- [ ] **Step 6: 경로 연결**
  - `click` 직접 클릭: `c.kind === 'bomb'` 분기를 `isSpecial(c.kind)`로, `popSpecial`이 `false`면 기존처럼 `rejectTo`. 그 앞에 `c.splitBy && !this.owns(c.kind, p)`이면 `hitPiece(p, c, now)` — `tickPieces`의 피격 처리와 같은 동작을 private 함수로 빼서 둘이 함께 쓴다.
  - 넓은 손: `c.kind === 'bomb'`을 `isSpecial(c.kind)`로, `detonate`를 `popSpecial`로.
  - 장판: 같은 식으로.
  - `detonate`의 십자 루프: `o.kind === 'bomb'`이면 그대로 `queueBlast`, `o.kind === 'ice' || o.kind === 'split'`이면 `popSpecial(p, o, now)` 바로.
  - `fireItem` `bomb`/`fieldClear`: `o.kind === 'bomb'`을 `isSpecial(o.kind)`로(셋 다 `queueBlast`).
  - `claim`: `c.splitBy`이고 잡는 사람이 주인이거나 그 팀원이면 `resolveClaim` 옵션 `split: true`.
  - 자석·헛손질 보정은 `owns`만 보므로 얼음·분열을 잡지 않는다. 남의 파편은 넓은 손·자석·장판에 안 잡힌다(`owns` 거짓). 바꾸지 않는다.

- [ ] **Step 7: 일시정지·시간 정지·종료** — `finishResume`은 `shiftTimes`가 `frostAt`·`debuffs`를 밀어 주므로 추가 없음. `timeStop`에서 모든 사람의 `frostAt`(0 아님)과 `debuffs.frost`를 `+ms`. `pendingBlasts = []` 하는 세 곳에서 모든 사람 `frostAt = 0`, `delete debuffs.frost`.

- [ ] **Step 8: 봇** — `bot.ts:52` 가중치에 `ice`·`split`도 5. 남의 파편(`c.splitBy`이고 내 원이 아님)은 가중치 0(눌러 봐야 기절만 한다). `think`에서 `debuffOn(me, 'frost', now)`이면 다음 클릭 간격에 `RULES.specialCircles.ice.botGapMult`를 곱한다. 봇 루프 분기 `target.kind === 'bomb'`을 `isSpecial(target.kind)`·`popSpecial`로. 봇이 남의 파편을 고르면 `claim` 대신 `hitPiece`(봇은 커서가 없지만 클릭은 피격으로 처리 — 설계의 '파편 클릭 = 피격').

- [ ] **Step 9:** Run `npm.cmd run typecheck` → 오류 없음.

---

### Task 4: 화면 — 겉모양·연출·커서·문구

**Files:**
- Modify: `client/src/render.ts` — 원 그리기 분기(`:390` `drawBomb` 옆), 새 `drawIce`·`drawSplit`·`drawPiece`, 새 연출 `iceBurst`·`splitBurst`, 커서 그리기(서리·얼음 결정), `BasicKind`(`:50`)·`shapeSVG`(`:1409`) 제외 목록
- Modify: `client/src/main.ts` — `ice:burst`·`split:burst`·`split:hit` 수신(`bomb:blast` `:1203` 옆), `stun`(`:1243`)의 새 `by`, 넓은 손 빗나감 예측(`:1436`)의 `k === 'bomb'`을 `isSpecial(k)`로
- Modify: `client/src/audio.ts` — `sfx.ice()`, `sfx.split()`
- Modify: `client/src/rulesUI.ts` — '특수 원' 규칙 표 줄을 셋으로
- Modify: `client/src/codex.ts`, 게임 방법(특수 원 항목) — 얼음·분열 설명 각 1줄
- Modify: `client/src/sources.ts` — 출처 `split`, 이름 '분열'
- Modify: `client/src/effectsUI.ts` — `frost` 디버프 표시(기존 디버프 칩 방식)

**Interfaces:**
- Consumes: Task 2의 이벤트·`CursorMode.lagMs`·`frostAt`, Task 3의 서버 동작

- [ ] **Step 1: 겉모양 (글자 없음)** — `drawIce`: 하늘색 반투명 원, 흰 여섯 갈래 눈송이 선, 가장자리 반짝임. `drawSplit`: 회색 원, 가운데서 갈라지는 검은 금 선, 천천히 맥동. `drawPiece`(원에 `splitBy`가 있을 때): 주인 색 원 + 톱니 테두리 + 진행 반대 방향 짧은 잔상. 보호 구역 안이면 기존처럼 반투명.
- [ ] **Step 2: 연출** — `iceBurst(x, y)`: 하늘색 서리 고리가 퍼짐. `splitBurst(x, y)`: 짧은 번쩍임 + 금. `split:hit`: 그 자리 작은 팡. 효과 줄이기면 번쩍임·흔들림 없이 고리·파편만.
- [ ] **Step 3: 커서** — 게임 커서 갱신이 `cursorModeOf`의 `lagMs`를 `followCursor`에 넘긴다. 내가 `ice:burst`의 `targets`에 있으면 `freezeAt`까지 커서 둘레 서리 고리가 차오르고, 기절(`by: 'ice'`) 동안 커서를 얼음 결정 모양으로 그리고 위치를 멈춘다(기존 스턴이 커서를 멈추지 않으면 기절 동안 게임 커서 갱신을 건너뛴다). 남이 얼면 점수판 칩 `stunned` 표시는 기존 그대로.
- [ ] **Step 4: 소리·문구** — `sfx.ice()`(얼음 깨지는 소리), `sfx.split()`(갈라지는 소리)를 기존 합성 효과음 방식으로. 규칙 표: "🧊 얼음 원 | 터뜨린 사람 빼고 모두 {slowMs/1000}초 느려진 뒤 {stunMs/1000}초 얼어붙음", "🪨 분열 원 | 내 색 파편 {count}개가 흩어짐, 남이 닿으면 {stunMs/1000}초 기절". 도감·게임 방법도 같은 뜻 1줄씩. 점수 출처 '분열'.
- [ ] **Step 5:** Run `npm.cmd run typecheck` → 오류 없음. Run `npm.cmd run build` → 성공.

---

### Task 5: 문서

**Files:**
- Modify: `docs/ROADMAP.md:52` — '특수 원: 얼음·분열' 💡 → ✅ (2026-11-19, 설계 링크), `:236` 아이템 '얼음' 💬 줄에 "특수 원 얼음으로 대신함" 메모
- Modify: `docs/HANDOFF.md` — 폭탄 원 절 아래 '얼음·분열 원' 짧은 표(대상·효과·면역·봇 기절 변경·웨이브 수정), 확인할 것
- Modify: `docs/superpowers/specs/2026-11-19-bomb-circle-design.md` — 수치 블록의 `chance`가 `RULES.specialCircles.chance`로 옮겨졌고 셋이 나눠 쓴다는 한 줄

- [ ] **Step 1:** 위 내용을 반영한다. 버전·CHANGELOG는 건드리지 않는다.

---

### Task 6: 테스트와 커밋

**Files:**
- Create: `shared/test/ice-split.test.ts`
- Modify: `shared/test/bomb.test.ts` (`bomb.chance`·`bombChance` 이름 변경 따라가기)

테스트는 `shared/test/bomb.test.ts`의 가짜 io·`playing(t)`·`at(...)` 방식을 따른다. 커서는 방의 커서 기록에 직접 넣는다(가시 공 테스트가 쓰는 방식 — `room.test.ts`에서 `freshCursor`에 쓰이는 저장소 이름을 확인).

- [ ] **Step 1: 테스트 작성**

| 이름 | 핵심 단언 |
|---|---|
| 1a `생성: 특수 원 확률과 종류 비율` | `makeCircle`을 `specialChance: 1`로 3만 번 → `bomb`·`ice`·`split` 각각 1/3 ± 3%, 반지름 36 |
| 1b `방 규칙 꺼짐·협력전·튜토리얼·웨이브에서는 생기지 않는다` | `specialChance: 0`이면 1만 번에 특수 원 0개, `makeWave` 결과에 특수 원 0개, `toGameRules({ ...DEFAULT_RULES, coop: true }).specialCircles === false` |
| 2a `얼음: 1초 느려진 뒤 1초 기절, 콤보·피버 유지` | 클릭 직후 상대 `debuffs.frost > now`, `frostAt === now + 1000`, 터뜨린 사람은 둘 다 없음. `advance(1000)`+`tick` → 상대 `stunUntil === now + 1000`, 상대 `combo`·`fever` 그대로, `stun` 이벤트 `by: 'ice'` |
| 2b `얼음: 팀원·철벽·무적 시간 중이면 안 걸림` | 팀전 팀원 `frostAt === 0`, `fortress` 보유자 0, `hazardUntil > now`인 사람 0 |
| 2c `얼어 가는 중 라운드가 끝나면 얼지 않는다` | `endRound` 뒤 `frostAt === 0`, 다음 틱에 `stunUntil` 변화 없음 |
| 2d `일시정지·시간 정지가 얼어붙음을 민다` | 일시정지 500ms 뒤 재개 → `frostAt` +500, 시간 정지 아이템 → `frostAt` +정지 시간 |
| 3 `기절 공통: 레이저 기절은 예전처럼 콤보를 끊고, 기절한 봇은 클릭하지 않는다` | `hazardStun(p, now, 1000, G, players)` 뒤 아케이드 콤보 0, `{ soft: true }`면 유지. 봇 `stunUntil = now + 5000` → 틱 여러 번 동안 `circle:claimed`의 `by`에 그 봇 없음 |
| 4a `분열: 파편 4개가 터뜨린 사람 색으로 생기고 주인은 닿아도 무사` | `circle:spawn` 4개, 모두 `kind === me.color`, `splitBy === me.id`, `r === 22`. 주인 커서를 파편 위에 두고 틱 → 기절 없음, 파편 남음 |
| 4b `분열: 팀원은 파편을 평소처럼 잡는다` | 팀원 클릭 → `circle:claimed` 그 팀원, `src.split > 0` |
| 4c `분열: 남은 닿거나 클릭하면 기절하고 파편은 사라지며 연달아 기절하지 않는다` | 상대 커서를 파편 위 → `split:hit`, `stun by: 'split'`, 파편 삭제. 바로 다음 파편에 닿음 → 파편은 사라지고 `stunUntil` 그대로. 상대가 다른 파편 클릭 → 견제 아닌 피격(주인 점수 변화 없음) |
| 4d `분열: 보호 구역 안 파편과 시간 정지 중에는 피격 없음` | 중앙 반경 90 안 파편 위 커서 → 기절 없음. `freezeUntil > now` 동안 → 기절 없음 |
| 5a `터지는 경우: 클릭·넓은 손·장판·폭죽·십자로 터지고 자석으로는 안 터짐, 십자는 십자 주인 기준` | 경로별 `ice:burst`/`split:burst` 유무, 십자로 터진 얼음의 `by` = 폭탄 터뜨린 사람, 분열 파편 색 = 그 사람 색 |
| 5b `같은 틱 클릭과 넓은 손에도 한 번만 터진다` | `split:burst` 1회, 파편 4개 |
| 6 `점수 출처: split 포함 합계` | 출처 합 + 기타 − 잃은 점수 = 총점, `SRC_KEYS`에 `split` |

- [ ] **Step 2: 실행** — Run `npm.cmd test` → 기존 718개 + 새 테스트 모두 PASS.
- [ ] **Step 3: 검사** — Run `npm.cmd run typecheck` / `npm.cmd run build` → 둘 다 성공.
- [ ] **Step 4: 목적별 커밋** (Task 1의 두 커밋은 이미 끝남)
  1. `feat: 얼음 원과 분열 원 추가` — Task 2·3·4, `ice-split.test.ts`, `bomb.test.ts` 이름 변경
  2. `docs: 얼음·분열 원 설계와 로드맵 갱신` — Task 5, 설계·계획 문서

  범위는 `CONTRIBUTING.md` 목록을 따르고, 여러 곳에 걸치면 생략한다.
