# 폭탄 원 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클래식·아케이드에 폭탄 원을 넣는다. 터뜨리면 가로·세로 십자가 판 끝까지 뻗어 걸린 원·보스·다른 폭탄을 터뜨린 사람의 것으로 만든다. 폭죽에도 잭팟을 켠다.

**Architecture:**
- **공용(shared):** 수치는 `RULES.specialCircles.bomb`. 십자 판정은 새 순수 함수 `inCross`(새 파일 `shared/src/bomb.ts`). 점수 계산은 기존 `resolveClaim`에 새 획득 경로 `via: 'cross'`를 더한다.
- **서버:** `room.ts`에 `detonate`와 연쇄 예약 `pendingBlasts`. 클릭·넓은 손·장판·폭죽·필드 클리어에서 폭탄을 만나면 `detonate`(또는 예약). 걸린 원은 기존 `claim(p, c, now, 'cross', true)`, 보스는 기존 `hitBoss`.
- **화면:** 새 이벤트 `bomb:blast`로 십자 빛줄기를 그리고, `via === 'cross'`인 `circle:claimed`는 폭발 중심에서 거리 순으로 늦춰 터뜨린다.

**Tech Stack:** TypeScript, Socket.IO, Vite + Canvas, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-19-bomb-circle-design.md`

## Global Constraints

- 화면 문구는 한국어. 수치는 `RULES`에만 두고, 문구 속 숫자는 상수에서 만든다.
- 수치 초안: `chance: 0.025`, `halfWidth: 30`, `chainDelayMs: 150`.
- 방 규칙 키는 `specialCircles`(라벨 '특수 원'). 협력전의 `specials`(스페셜 어택)와 헷갈리지 않게 설계 문서의 `specials` 대신 이 이름을 쓴다. 기본 켜짐, 하드코어 프리셋·튜토리얼 꺼짐, 협력전에서는 항상 꺼짐.
- 커밋은 Conventional Commits(`<타입>(<범위>): <한국어 요약>`), 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 폭죽 잭팟은 `balance` 커밋으로 따로.
- 커밋 전 `npm run typecheck`·`npm run build` 통과.
- 테스트는 모든 기능을 구현한 뒤 한꺼번에 쓴다(사용자 지시). 각 Task의 테스트는 Task 6에서 쓰고 실행한다. 커밋도 Task 6에서 목적별로 나눈다.
- `main` 푸시·버전 올리기는 사용자가 요청할 때만.

## Review Focus

1. **붉은(공격형)·보호막 보스가 십자에 걸릴 때:** 직접 클릭하면 감점·무효인 상태다. 십자로 감점받으면 억울하므로 이 상태의 보스는 **십자에서 건너뛴다**(피해·감점 모두 없음). → Task 6 테스트 4b
2. **같은 틱에 넓은 손 범위와 직접 클릭이 같은 폭탄을 동시에 고를 때:** 한 번만 터져야 한다. `detonate`는 폭탄이 `circles`에 없으면 아무것도 하지 않는다. → Task 6 테스트 2b
3. **연쇄 예약 중 라운드가 끝나거나 판이 끝날 때:** 다음 라운드에 이전 라운드의 폭발이 터지면 안 된다. → Task 6 테스트 3b
4. **시간 정지 아이템 중의 연쇄:** 원이 멈춰 있는 동안 예약된 폭탄도 멈춘 시간만큼 늦게 터진다. → Task 6 테스트 3a
5. **폭탄이 보호 구역 안에 있을 때 클릭·넓은 손·장판·다른 십자:** 터지지 않는다(일반 원처럼 못 잡음). → Task 6 테스트 1b

---

### Task 1: 공용 규칙과 십자 판정

**Files:**
- Create: `shared/src/bomb.ts`
- Modify: `shared/src/index.ts` (내보내기)
- Modify: `shared/src/rules.ts` — `RULES`(아이템 원 `items:` 아래 `~:330`), `RoomRules`(`~:434`), `DEFAULT_RULES`(`:495`), `TUTORIAL_RULES`(`:503`), `PRESETS.hardcore`(`:514`), `sanitizeRules` 불리언 목록(`:552`), `GameRules`(`~:588`), `toGameRules`(`~:637`), `CircleKind`(`:658`), `SrcKey`·`emptyStats`(`:712-719`), `ClaimVia`(`:944`), `SpawnOpts`·`makeCircle`(`:1404-1434`), `resolveClaim`(`:1618~1852`)

**Interfaces:**
- Produces:
  - `RULES.specialCircles: { bomb: { chance: number; halfWidth: number; chainDelayMs: number; r: number } }` — `r`은 폭탄 원 반지름 36
  - `RoomRules.specialCircles: boolean`, `GameRules.specialCircles: boolean` (`toGameRules`에서 `r.specialCircles && !r.coop`)
  - `CircleKind`에 `'bomb'`, `ClaimVia`에 `'cross'`, `SrcKey`에 `'bomb'`
  - `SpawnOpts.bombChance?: number` — `makeCircle`은 아이템 판정이 아닐 때 `rand() < bombChance`면 `kind: 'bomb'`, `r = RULES.specialCircles.bomb.r`
  - `inCross(center: Point, q: Point, r: number, halfWidth = RULES.specialCircles.bomb.halfWidth): boolean` — `Math.abs(q.x - center.x) <= r + halfWidth || Math.abs(q.y - center.y) <= r + halfWidth`

- [ ] **Step 1: 규칙·종류·옵션 추가**

위 Produces의 타입과 기본값을 넣는다. `sanitizeRules` 불리언 목록에 `'specialCircles'`. `makeCircle`에서 `forceKind`가 있으면 폭탄 판정을 하지 않는다(튜토리얼 대상 원). `rand()` 호출 순서는 기존 아이템 판정 뒤에 하나 더하는 것으로, `bombChance`가 없으면 `rand()`를 더 부르지 않는다(기존 시드 시뮬레이션 재현).

- [ ] **Step 2: `inCross`를 `shared/src/bomb.ts`에 쓰고 `index.ts`에서 내보낸다**

- [ ] **Step 3: `resolveClaim`의 십자 경로**

`const blast = via === 'blast'` 옆에 `const cross = via === 'cross'`, 그리고 견제 예외에 쓰는 판정을 `const area = blast || cross`로 바꿔 `blast`를 쓰던 견제 관련 자리(`:1671`, `:1760`, `:1762`, `:1794`, `:1803`)에 `area`를 쓴다. 잭팟 조건(`:1806`)은 이 Task에서는 `!blast && !magnet`을 그대로 둔다(십자는 굴림, 폭죽은 Task 2). 점수 출처(`:1848-1850`)는 `cross`면 원 점수와 콤보 몫 모두 `'bomb'`에 넣는다.

- [ ] **Step 4: 확인**

Run: `npm.cmd run typecheck`
Expected: 오류 없음 (`'bomb'` 종류를 다루지 않는 `switch`·`Record`가 있으면 여기서 드러난다. 화면 쪽은 Task 4에서 채우므로 `Record<SrcKey,…>` 같은 곳만 임시로 맞춘다)

---

### Task 2: 폭죽 잭팟 켜기 (balance)

> 같은 줄을 Task 1과 함께 고치므로 커밋을 나누기 위해 **Task 6의 커밋 1 뒤에** 진행한다(대화형 `git add -p`를 쓰지 않는다).

**Files:**
- Modify: `shared/src/rules.ts:1805-1806` (잭팟 조건과 주석)
- Modify: `docs/ROADMAP.md:263` ("폭죽·필드 클리어: 잭팟 없음" 줄)

- [ ] **Step 1:** 잭팟 조건을 `!magnet`으로 바꾸고 주석을 "자석만 없음"으로 고친다. 속사 레전드 확정 잭팟(`rapidForced`)은 그대로 둔다.
- [ ] **Step 2:** ROADMAP 해당 줄을 "폭죽·필드 클리어도 잭팟을 굴린다 (2026-11-19, 아케이드 고점 빌드 허용)"로 고친다.
- [ ] **Step 3:** Run `npm.cmd run typecheck` → 오류 없음.

---

### Task 3: 서버 — 생성·폭발·연쇄·봇

**Files:**
- Modify: `server/src/room.ts` — 필드 선언(`~:112` `freezeUntil` 근처), `click`(`:845-924`), 장판 루프(`:1420-1432`), `tick`(`:1367`), `finishResume`(`:763-791`), `beginRound`(`:1151`), `endRound`(`:1207`), 판 종료(`end`), 원 생성 옵션(`:1808`), `fireItem`의 `bomb`/`fieldClear`(`:1962-1969`), 시간 정지(`timeStop`, `:1970`)
- Modify: `shared/src/protocol.ts` (`ServerToClient`에 `'bomb:blast'`)
- Modify: `server/src/bot.ts:51` (가중치)

**Interfaces:**
- Consumes: Task 1의 `inCross`, `RULES.specialCircles.bomb`, `'cross'`
- Produces:
  - 이벤트 `'bomb:blast': (d: { circleId: number; by: string; x: number; y: number; chain: boolean }) => void`
  - `private pendingBlasts: { by: string; circleId: number; at: number }[]`
  - `private detonate(p: PlayerState, bomb: Circle, now: number, chain = false): void`
  - `private queueBlast(by: string, bomb: Circle, now: number): void` — 같은 `circleId`가 이미 있으면 넣지 않는다

- [ ] **Step 1: 생성** — `:1808`의 `SpawnOpts`에 `bombChance: this.G.specialCircles && !this.tutorial ? RULES.specialCircles.bomb.chance : 0`. 웨이브(`waves.ts`)는 옵션을 넘기지 않으므로 그대로 0.

- [ ] **Step 2: `detonate`**

```
detonate(p, bomb, now, chain):
  if (!this.circles.has(bomb.id) || isGuarded(bomb, now)) return
  this.circles.delete(bomb.id)
  q = circlePos(bomb, now)
  emit 'bomb:blast' { circleId: bomb.id, by: p.id, x: q.x, y: q.y, chain }
  for o of [...this.circles.values()]:
    if o.kind in ('gold', 'item') or isGuarded(o, now): continue
    if !inCross(q, circlePos(o, now), o.r): continue
    if o.kind === 'bomb': queueBlast(p.id, o, now); continue
    if o.kind === 'boss':
      st = bossState(o, now); if st.shielded or st.enraged: continue   // Review Focus 1
      this.hitBoss(p, o, now); continue
    this.claim(p, o, now, 'cross', true)
  this.emitPlayers()
```

협력전 원(`threat`, `crystal`, `coopItem`)은 협력전에 폭탄이 없으므로 따로 막지 않는다.

- [ ] **Step 3: 연쇄 처리** — `tick`에서 `pendingBlasts` 중 `at <= now`인 것을 꺼내, 터뜨린 사람이 아직 있고(`outAt` 없음) 폭탄이 `circles`에 있으면 `detonate(p, bomb, now, true)`. `finishResume`에서 `at += delta`, 시간 정지 시작 시 `at += ms`. `beginRound`·`endRound`·판 종료에서 `pendingBlasts = []`.

- [ ] **Step 4: 터지는 경로 연결**
  - `click` 직접 클릭 분기: `else if (c.kind === 'bomb') this.detonate(p, c, now)`를 `item` 분기 옆에.
  - 넓은 손 루프: `owns` 검사 앞에서 `c.kind === 'bomb'`이고 범위 안이면 `detonate(p, c, now)` 후 `ranged = got = true`.
  - 장판 루프: `c.kind === 'bomb'`이고 장판 안이면 `detonate(owner, c, now)`.
  - `fireItem`의 `bomb`/`fieldClear` 루프: `o.kind === 'bomb'`이면 `queueBlast(p.id, o, now)`(폭죽이 먼저 퍼진 뒤 터지게).
  - 자석·헛손질 보정(`nearestMine`, `updatePulls`)은 `owns`만 보므로 바꾸지 않는다. 폭탄이 여기서 잡히지 않는지 Task 6에서 확인.

- [ ] **Step 5: 봇** — `bot.ts` 가중치에 `if (c.kind === 'bomb') return 5;`(아이템 원과 같음). 봇의 클릭은 `click`을 거치므로 다른 변경은 없다.

- [ ] **Step 6:** Run `npm.cmd run typecheck` → 오류 없음.

---

### Task 4: 화면 — 폭탄 원·십자 연출·방 규칙·도감·통계

**Files:**
- Modify: `client/src/render.ts` (`:382` 원 그리기 분기, 새 `drawBomb`, 새 `crossBlast`)
- Modify: `client/src/main.ts` (`bomb:blast` 수신, `:1119` 근처 `circle:claimed`의 늦춘 터짐)
- Modify: `client/src/audio.ts` (새 `sfx.cross()`)
- Modify: `client/src/rulesUI.ts` (`BoolKey`, 토글 목록 `:35`, 규칙 표 `:165`)
- Modify: `client/src/codex.ts` (특수 원 설명 1줄)
- Modify: `client/src/sources.ts` (점수 출처 `bomb` 줄, 이름 '폭탄')

**Interfaces:**
- Consumes: Task 3의 `'bomb:blast'`, Task 1의 `'cross'`·`'bomb'`

- [ ] **Step 1: 폭탄 원** — `drawBomb(c, x, y, frameNow, r)`: 검은 원, 흰 십자 무늬, 위쪽 심지 점이 약 4Hz로 깜빡임. 보호 구역 안이면 기존 원처럼 반투명.
- [ ] **Step 2: 십자 연출** — `crossBlast(x, y)`: 중심에서 네 방향 빛줄기가 약 200ms 동안 판 끝까지 뻗고 사라짐. 줄 굵기는 `RULES.specialCircles.bomb.halfWidth * 2`. 효과 줄이기(`reduceFx`)면 번쩍임·흔들림 없이 빛줄기만.
- [ ] **Step 3: 수신** — `bomb:blast`에서 `crossCenter = { x, y }`를 저장하고 `renderer.crossBlast`, `sfx.cross()`. `circle:claimed`에서 `via === 'cross'`면 `renderer.burstDelayed(x, y, 색, 거리 / CORNER * 350)`(거리는 `crossCenter`에서), 점수 글자는 폭죽처럼 꼬리말 없이 띄운다. 잭팟 표시는 기존 코드 그대로.
- [ ] **Step 4: 방 규칙·도감·통계** — 토글 라벨 '특수 원', 규칙 표 줄 "💣 폭탄 원 | 누르면 가로·세로 판 끝까지 터져 걸린 원을 모두 가져감". 도감에 같은 설명. 점수 출처에 '폭탄'.
- [ ] **Step 5:** Run `npm.cmd run typecheck` → 오류 없음. Run `npm.cmd run build` → 성공.

---

### Task 5: 문서

**Files:**
- Modify: `docs/ROADMAP.md` (`:51` 특수 원 줄 → 폭탄 원 ✅, 얼음·분열 💡로 남김)
- Modify: `docs/superpowers/specs/2026-11-19-bomb-circle-design.md` (방 규칙 키 `specialCircles`, 붉은·보호막 보스 건너뜀, 보스 타격은 점수 출처 '보스'에 남음)

- [ ] **Step 1:** 위 내용을 반영한다. 버전·CHANGELOG는 건드리지 않는다.

---

### Task 6: 테스트와 커밋

**Files:**
- Create: `shared/test/bomb.test.ts`

테스트는 `shared/test/room.test.ts`의 가짜 io·`playingRoom()` 방식을 따른다(방의 `circles`·`pendingBlasts`를 `as unknown as`로 꺼내고 `Date.now`를 `t.mock.method`로 고정).

- [ ] **Step 1: 테스트 작성**

| 이름 | 핵심 단언 |
|---|---|
| 1a `inCross: 줄 위·줄 밖·판 끝` | 중심 (550,550)에서 (550,1080)·(20,550) 참, (650,650) r40 거짓, (550+40+30, 900) 참·(550+40+31, 900) 거짓 |
| 1b `보호 구역 안 폭탄·원은 터지지 않고 잡히지 않는다` | 중앙 반경 90 안 폭탄 클릭 → `circles`에 남음, 십자 위 보호 구역 원 남음 |
| 2a `연쇄: B는 150ms 뒤 B 위치에서 터지고 점수는 A를 터뜨린 사람` | A 클릭 직후 B가 `pendingBlasts`에 1개, `now + 150` 틱 뒤 B 십자 위 원의 획득자 = A 클릭한 사람 |
| 2b `서로 걸린 A·B와 넓은 손 동시 판정에도 한 번만 터진다` | `bomb:blast` 이벤트 수 = 2 |
| 3a `일시정지·시간 정지가 연쇄를 민다` | 일시정지 500ms 뒤 재개 → `at`이 500 증가, 시간 정지 아이템 → `at`이 `freezeMs × 지속배율`만큼 증가 |
| 3b `라운드 끝·판 끝에 예약을 비운다` | `endRound` 뒤 `pendingBlasts.length === 0` |
| 4a `보스: 십자 타격이 독식 기여도와 막타` | 체력 1 보스가 십자에 걸리면 `boss:killed`의 `by` = 터뜨린 사람, `bossHits`에 기여 기록 |
| 4b `붉은·보호막 보스는 십자에서 건너뛴다` | 점수 변화 0, 보스 체력 그대로 |
| 5 `걸린 원: 콤보·피버 게이지·잭팟, 견제 페널티 없음, 상자 충전·점화` | 남의 색 원 → 주인 점수 감소 없음, 내 콤보 +n, 잭팟 강제(`rand`) 시 `result.jackpot > 1`, 보물 상자 충전량 증가, 점화 보유 시 피버 시작에 자동 획득 발생 |
| 6 `자석·헛손질 보정으로는 터지지 않고 넓은 손·장판·폭죽으로는 터진다` | 경로별 `bomb:blast` 유무 |
| 7 `방 규칙 꺼짐·협력전·튜토리얼에서는 생기지 않는다` | `makeCircle(... { bombChance: 0 })` 1만 번에 `bomb` 0개, `toGameRules({ ...DEFAULT_RULES, coop: true }).specialCircles === false`, 하드코어 프리셋 `false` |
| 8 `폭죽 잭팟` | `via: 'blast'`인 `resolveClaim`에 잭팟 확정 `rand` → `jackpot > 1` |
| 9 `점수 출처: bomb 포함 합계` | 출처 합 + 기타 − 잃은 점수 = 총점, `src.bomb > 0` |

- [ ] **Step 2: 실행**

Run: `npm.cmd test`
Expected: 기존 595개 + 새 테스트 모두 PASS (이 시점은 Task 2 전이라 테스트 8은 아직 넣지 않는다).

- [ ] **Step 3: 검사**

Run: `npm.cmd run typecheck` / `npm.cmd run build`
Expected: 둘 다 성공

- [ ] **Step 4: 목적별 커밋**

1. `feat: 폭탄 원과 십자 폭발 추가` — Task 1·3·4, `bomb.test.ts`(테스트 8 제외). 이 시점에 테스트·타입 검사·빌드 통과 확인
2. Task 2를 적용하고 테스트 8을 더하고, "폭죽은 잭팟 없음"을 단언하던 기존 테스트가 있으면 고친 뒤 다시 `npm.cmd test`·타입 검사·빌드 → `balance(shared): 폭죽과 필드 클리어에도 잭팟 적용` — Task 2, 테스트 8, 고친 기존 테스트
3. `docs: 폭탄 원 설계와 로드맵 갱신` — Task 5, 설계·계획 문서

각 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 범위는 `CONTRIBUTING.md` 목록(`shared`·`server`·`client`·`audio`·`deploy`·`release`)을 따르고, 여러 곳에 걸치면 생략한다.
