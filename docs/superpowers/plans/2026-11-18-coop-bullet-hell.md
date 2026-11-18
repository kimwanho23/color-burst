# 협력전 탄막 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 협력전을 "피하면서 줍는" 탄막 보스전으로 바꾼다. 위험 탄막, 10초 고유 패턴, 보스 판 패턴 3개, 위험한 수정 구간, 체력 바, 보스전 아이템, 난이도 4개가 들어간다. 기절하면 커서가 멈추는 규칙은 모든 모드에 적용한다.

**Architecture:** 지금 협력전 뼈대(`server/src/coop.ts`의 `CoopRun` + `shared/src/coop.ts`의 순수 함수)를 유지하고 그 위에 얹는다.
- 탄막은 원(`Circle`)으로 하나씩 보내지 않는다. 무늬 단위(`Volley`: 발사 시각 + 탄 목록)로 한 번 보내고, 모든 화면이 시각으로 위치를 계산한다.
- 탄 맞음은 각 화면이 판정해 `coop:hurt`로 알리고, 서버는 무적·탈락·중복만 걸러 체력을 깎는다.
- 크고 느린 공격(레이저·내려찍기·안전지대·구역 봉인·회전 빔)은 서버가 커서 위치로 판정한다.
- 보스 하나가 쓰는 무늬·패턴·겉모습은 `shared/src/coopBosses.ts`의 보스 정의 한 묶음에서 읽는다.

**Tech Stack:** TypeScript, Node(`tsx`) + socket.io 서버, Vite + canvas 화면, 테스트는 `node:test` (`npm test` = `shared/test/**/*.test.ts`)

**Spec:** `docs/superpowers/specs/2026-11-18-coop-bullet-hell-design.md`

## Global Constraints

- 커밋 메시지는 `<타입>(<범위>): <한국어 요약>` (CONTRIBUTING.md). 수치 조정은 `balance`. 한 커밋에 한 목적.
- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`(협력전은 `RULES.coop`)에만 둔다. 다른 파일에 숫자를 박지 않는다.
- 커밋 전에 `npm test`, `npm run typecheck`, `npm run build`가 모두 통과해야 한다.
- 커밋 작성자는 `Kim Wan ho`. `main`에 푸시하지 않는다(푸시 = Render 배포). 버전은 올리지 않는다(사용자가 따로 정함).
- 화면 문구는 지금 화면 말투("~해요")를 따르고, 문구에 점수·배율 숫자를 박지 않는다(수치는 `RULES`에서 읽어 넣는다).
- 클래식·아케이드의 규칙·맵 패턴은 바꾸지 않는다. 예외는 Task 1(기절 커서 멈춤)뿐이다.
- 보스는 하나(`core`)만 만든다. 혼자 하기 관전은 만들지 않는다.

## Review Focus

1. **일시정지·재개, 다시 접속**: 탄막·봉인·빔·미사일 시각이 같이 밀려야 한다. 재개 직후 밀린 탄이 한꺼번에 덮치면 안 된다. → Task 6에 `shift()`·`state()` 테스트.
2. **같은 탄을 두 번 보고, 무적 중 보고**: 체력이 한 번만 깎여야 한다. → Task 6 테스트.
3. **탈락한 사람·봇·연결 끊긴 사람의 피격 보고**: 무시해야 한다. → Task 6 테스트.
4. **피할 길이 없는 판 패턴**: 구역 봉인은 세 줄을 다 막으면 안 되고, 내려오는 벽은 틈이 반드시 있어야 한다(난수가 어떻든). → Task 7 테스트.
5. **수정 구간 중 체력 0, 엑스퍼트 분노**: 수정 구간에 탈락하면 그 사람 수정이 치워지고, 엑스퍼트 분노는 판을 "수정 구간 실패"로 끝내야 한다. → Task 5·8 테스트.

---

### Task 0: 앞선 수정 커밋

지금 작업 트리에는 이전 대화의 수정 세 가지가 커밋 안 된 채 있다. 각각 따로 커밋한다.

- [ ] **Step 1: 검사** — `npm test && npm run typecheck && npm run build`가 모두 통과하는지 확인 (기대: 테스트 501개 통과).
- [ ] **Step 2: 커밋 세 개** (`git add`는 파일을 골라서)
  - `fix: 카오스에도 레이저 빈도 적용` — `shared/src/cursor.ts`, `shared/test/laserfreq.test.ts`, `client/src/lobbyUI.ts`
  - `fix(client): 튜토리얼 설명 카드에서 마우스 잠금을 풀어 버튼을 누를 수 있게` — `client/src/main.ts`의 `overlayUp` 부분
  - `feat: 게임 모드를 클래식·아케이드·협력전으로, 타임어택 삭제, 게임 설정 창 크기·닫기 버튼 고정` — 나머지 (`client/src/main.ts` 남은 부분이 섞여 있으면 이 커밋에 같이 넣는다)
- [ ] **Step 3: 설계 문서 커밋** `docs: 협력전 탄막 개편 설계·구현 계획 문서 추가` — spec과 이 plan

---

### Task 1: 기절하면 커서가 멈춘다 (모든 모드)

**Files:**
- Modify: `client/src/cursor.ts` (`GameCursor`)
- Modify: `client/src/main.ts` (`moveCursor`, `frame()`의 `gameCursor.frame` 호출)
- Test: `shared/test/gamecursor.test.ts`

**Interfaces:**
- Produces: `GameCursor.frame(mode, dtMs, inAura = false, fx = null, frozen = false)`. `frozen`이면 `pos`를 그대로 두고 쌓인 이동량은 버린다. `frozen`이 참→거짓으로 바뀌는 프레임에 `slideFrom = pos`로 미끄러져 돌아가기 시작한다(`RULES.sabotage.slideMs`).
- Produces: `GameCursor.move()`는 마지막 `frame`이 frozen이었으면 `real`만 갱신하고 `pos`는 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트** (`gamecursor.test.ts`에 추가, 기존 `clock` 도우미 사용)
  - `기절: 커서가 그 자리에 멈추고 이동이 버려진다` — `move({x:100,y:100})` → `frame(null,16)` → `frame(null,16,false,null,true)` 뒤 `move({x:400,y:400},{x:300,y:300})` → `frame(null,16,false,null,true)` → `pos`가 `{x:100,y:100}`
  - `기절이 풀리면 진짜 위치로 미끄러져 돌아온다` — 위에 이어 `frame(null,16)` 직후 `pos`는 여전히 100 근처, 시계를 `slideMs` 넘겨 `frame` → `pos`가 `{x:400,y:400}`
- [ ] **Step 2: `npm test`** → 새 테스트 FAIL
- [ ] **Step 3: 구현** — `GameCursor`에 `private frozen = false`. 그리고 `main.ts`:
  - `frame()`에서 `const stunnedNow = live && !!m && isStunned(m, now)`를 `gameCursor.frame(..., fx, stunnedNow)`에 넘긴다.
  - `moveCursor`의 잠금 분기에서 `stunnedNow`면 `lockPos`를 바꾸지 않는다. 기절 상태는 모듈 변수 `cursorFrozen`으로 `frame()`이 갱신한다.
- [ ] **Step 4: `npm test`, `npm run typecheck`** → 통과
- [ ] **Step 5: 브라우저 확인** — `preview_start server`·`client`, 혼자 하기(카오스 프리셋, 레이저 자주)로 레이저에 맞으면 커서가 멈추고 1.5초 뒤 미끄러져 돌아오는지 본다.
- [ ] **Step 6: 커밋** `feat(client): 기절하면 커서가 그 자리에 멈춤 (모든 모드)`

---

### Task 2: 협력전 난이도 4개, 설정 화면은 난이도만

**Files:**
- Modify: `shared/src/rules.ts` (`CoopLevel`, `COOP_LEVELS`, `RULES.coop.levels.expert`)
- Modify: `client/src/rulesUI.ts`, `client/src/lobbyUI.ts`, `client/src/icons.ts`(필요하면)
- Test: `shared/test/coop.test.ts`, `shared/test/lobbyui.test.ts`

**Interfaces:**
- Produces: `type CoopLevel = 'easy' | 'normal' | 'hard' | 'expert'`, `COOP_LEVELS = ['easy','normal','hard','expert']`.
- Produces: `RULES.coop.levels.expert`. 지금 있는 필드를 모두 하드에서 한 칸 더 세게 잡는다(간격은 짧게, 수정 횟수 많게, 제한 시간 짧게). 이후 Task에서 더하는 필드도 네 난이도 모두에 넣는다.

- [ ] **Step 1: 실패하는 테스트**
  - `coop.test.ts`: `sanitizeRules(DEFAULT_RULES, { coop: true, coopLevel: 'expert' }).coopLevel === 'expert'`; `Object.keys(RULES.coop.levels)`가 네 개.
  - `lobbyui.test.ts`: `rulesChips({ ...DEFAULT_RULES, coop: true, coopLevel: 'expert' })`의 글자에 `'협력전 · 엑스퍼트'`가 있고, 레이저·맵 패턴·보스 원 칩은 없다. `rulesSummary(...)`의 제목이 `'협력전 · 엑스퍼트'`로 시작한다.
- [ ] **Step 2: `npm test`** → FAIL
- [ ] **Step 3: 구현**
  - `rulesUI.ts`: `coop`이면 게임 모드 줄 + 협력전 난이도 네 칸(`이지·노말·하드·엑스퍼트`)과 짧은 안내만 그린다. 방 규칙 프리셋·고급 설정·라운드 시간은 그리지 않는다. 네 칸이 한 줄에 들어가도록 `.modeopts`를 그대로 쓴다(최소 폭 때문에 줄바꿈되면 `coop-levels` 클래스에서 `min-width`를 줄인다).
  - 엑스퍼트 아이콘은 `UI`에 `expert`를 더한다(lucide `Skull`).
  - 칩·요약은 협력전이면 `협력전 · <난이도>`, 생명 대신 `체력 100`, `180초`만 보여 준다.
- [ ] **Step 4: `npm test`, `npm run typecheck`** → 통과. 브라우저에서 협력전을 누르면 창 크기가 그대로이고 난이도 네 칸만 보이는지 확인.
- [ ] **Step 5: 커밋** `feat: 협력전 난이도 엑스퍼트 추가, 협력전 설정은 난이도만`

---

### Task 3: 협력전 보호 구역 끔, 잡을 원 두 배

**Files:**
- Modify: `shared/src/rules.ts` (`Circle.noGuard`, `isGuarded`, `RULES.coop.orb.gapMs`)
- Modify: `shared/src/coop.ts` (`makeOrb`, `makeCrystal`, `makeThreat`가 `noGuard: true`)
- Modify: `client/src/render.ts` (보호 구역 점선은 `DrawState.coop`이면 안 그림), `client/src/main.ts` (`DrawState`에 `coop: !!rules.coop`)
- Test: `shared/test/coop.test.ts`

**Interfaces:**
- Produces: `Circle.noGuard?: true`. `isGuarded(c, t)`는 `c.noGuard`면 거짓이다. 봇·자석·넓은 손·튜토리얼은 모두 `isGuarded`를 거치므로 따로 고치지 않는다.

- [ ] **Step 1: 실패하는 테스트** — `협력전 원은 판 가운데를 지나도 잡힌다`: `makeOrb(1, 0, {x:FIELD.w/2, y:FIELD.h/2}, Math.PI/2, 0, 280)`이 `t=0`에 `isGuarded` 거짓이고 `isHit(c, 0, FIELD.w/2, FIELD.h/2)` 참. `RULES.coop.orb.gapMs === 450`.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: `npm test`, typecheck 통과**
- [ ] **Step 5: 커밋** `feat: 협력전에서 가운데 보호 구역을 끄고 보스가 뿜는 원을 두 배로`

---

### Task 4: 보스 정의와 탄막 무늬 (순수 함수)

**Files:**
- Create: `shared/src/coopBullets.ts`, `shared/src/coopBosses.ts` (`shared/src/index.ts`에서 export)
- Modify: `shared/src/rules.ts` (`RULES.coop.bullets`, 난이도별 `bulletEveryMs`·`bulletSpeed`)
- Test: Create `shared/test/coopbullets.test.ts`

**Interfaces (Produces):**
```ts
export type BulletShape = 'spiral' | 'ring' | 'aimed' | 'scatter' | 'wall';
export interface Shot { x: number; y: number; a: number; v: number; d: number } // 출발점, 각도, 속도(필드/초), 발사 지연 ms
export interface Volley { id: number; at: number; r: number; shots: Shot[] }
export function makeVolley(shape: BulletShape, id: number, at: number, from: Point, o: { speed: number; phase: CoopPhase; aim?: Point; gaps?: number }, rand: () => number): Volley;
export function shotPos(v: Volley, i: number, t: number): Point | null;   // 발사 전이면 null
export function shotGone(v: Volley, i: number, t: number): boolean;        // 판 밖으로 나감
export function volleyDone(v: Volley, t: number): boolean;                 // 모든 탄이 나감
export function hitShot(cursor: Point, volleys: readonly Volley[], t: number, skip: ReadonlySet<string>): { volleyId: number; shot: number } | null; // skip 키는 `${volleyId}:${shot}`
export interface CoopBoss { id: 'core'; name: string; rims: [string, string, string]; body: string;
  bullets: Record<CoopPhase, BulletShape[]>; shieldBullets: [BulletShape[], BulletShape[]];
  skills: Record<CoopPhase, CoopSkill[]> }
export type CoopSkill = 'laser' | 'threat' | 'slam' | 'safe' | 'seal' | 'wall' | 'beam';
export const COOP_BOSSES: { core: CoopBoss };
```
- 수치(`RULES.coop.bullets`): 탄 반지름 `r: 10`, 단계 배율 `phaseMult: [1, 1.3, 1.6]`, 수정 구간 배율 `shieldMult: 2`, 겹침 확률 `overlap: [0, 0.25, 0.5]`, 무늬별 발 수(나선 12발 0.08초 간격, 링 14발(3단계 두 겹 엇갈림), 조준 부채꼴 5발 ±20°, 흩뿌리기 10발). 난이도별 `bulletEveryMs` 이지 1600 / 노말 1200 / 하드 950 / 엑스퍼트 750, `bulletSpeed` 220 / 260 / 300 / 340.
- `COOP_BOSSES.core`: bullets 1단계 `['ring','scatter']`, 2단계 `['ring','scatter','aimed','spiral']`, 3단계 전부(`wall` 제외). skills 1 `['laser','threat']`, 2 `['laser','threat','slam','seal','wall','beam']`, 3은 2 + `'safe'`. shieldBullets `[['spiral','ring'], ['spiral','ring','aimed']]`. rims는 단계별 테두리 색 3개(1 흰색 계열 → 3 붉은 계열).
- `wall`: 보스 아래 y에서 가로로 늘어선 탄, 모두 아래(π/2)로. `gaps`개 틈(틈 폭 = 커서가 지나갈 120 이상)을 무작위 자리에 남긴다.

- [ ] **Step 1: 실패하는 테스트** (`coopbullets.test.ts`)
  - `링: 발 수와 아래쪽 퍼짐`, `조준 부채꼴: 가운데 탄이 aim을 향함`, `shotPos: 발사 전 null, 1초 뒤 v만큼 이동`.
  - `hitShot: 반지름 안이면 맞음, skip에 있으면 무시`.
  - `벽: 틈이 gaps개, 틈마다 폭 ≥ 120` — `rand`를 0, 0.5, 0.999로 바꿔도 성립.
  - `보스 정의: 단계마다 skills가 spec 표와 같다`.
- [ ] **Step 2: FAIL** → **Step 3: 구현** (위치 계산은 `shared/src/rules.ts`의 `circlePos`와 같은 직선 운동, 보스 이동은 발사 순간 `from`으로 고정) → **Step 4: 통과**
- [ ] **Step 5: 커밋** `feat(shared): 협력전 보스 정의와 탄막 무늬`

---

### Task 5: 체력 바 100과 난이도별 피격 표

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerState.lives` → `hp`, `RULES.coop.hpMax`, `RULES.coop.hurtFx`, `levels.*.hurt`, `RULES.coop.heal`)
- Modify: `shared/src/protocol.ts` (`CoopHitBy`, `coop:hit`의 `lives` → `hp`, `CoopResult.reason`)
- Modify: `server/src/coop.ts` (`damage`, `breakShield` 회복, `tickRage` 엑스퍼트 패배), `server/src/room.ts` (`coop.damage` 호출 쪽), `server/src/gameLog.ts` (`lives` → `hp`)
- Modify: `client/src/coopUI.ts` (`heartsHtml` → `hpBarHtml`), `client/src/main.ts` (`coop:hit`, 아래 줄 내 체력), `client/src/style.css`
- Test: `shared/test/coop.test.ts` (기존 `lives` 테스트를 체력으로 바꾼다)

**Interfaces:**
- Produces: `type CoopHitBy = 'bullet' | 'wall' | 'threat' | 'beam' | 'laser' | 'slam' | 'seal' | 'safe' | 'rage' | 'hazard'`. `'hazard'`(아케이드 맵 패턴)는 Task 7에서 협력전 맵 패턴을 없앨 때 함께 지운다. 그때까지는 `seal`과 같은 값을 쓴다.
- Produces: `RULES.coop.levels[l].hurt: Record<CoopHitBy, number>`. 값은 spec 표 그대로이고, 엑스퍼트 `rage`만 `Infinity`(= 즉시 패배).

| | bullet·wall | threat | beam | laser | slam | seal | safe | rage |
|---|---|---|---|---|---|---|---|---|
| easy | 5 | 15 | 20 | 20 | 20 | 10 | 30 | 30 |
| normal | 10 | 20 | 25 | 30 | 30 | 20 | 40 | 50 |
| hard | 15 | 25 | 30 | 40 | 40 | 30 | 50 | 70 |
| expert | 20 | 30 | 35 | 50 | 50 | 40 | 60 | Infinity |

(`hazard`는 Task 7 전까지 각 난이도의 `seal` 값, `hurtFx.hazard`는 2000/1000.)

- Produces: `RULES.coop.hurtFx: Record<CoopHitBy, { immuneMs: number; stunMs: number }>` — bullet·wall 600/0, threat 1000/0, beam·laser·slam·seal·safe 2000/1000, rage 2000/0. 기절 중에는 무적이 함께 걸려 있다(무적 2초 ⊃ 기절 1초).
- Produces: `CoopRun.damage(p, by, now, circleId?) → boolean`. 체력을 `hurt[by]`만큼 깎고 `immuneUntil = now + hurtFx[by].immuneMs`, `stunMs > 0`이면 `host.stun(p, now, stunMs)`(CoopHost `stun` 시그니처에 `ms`를 더한다). 체력 0이면 지금처럼 `eliminate` → 모두 탈락이면 `finish(false)`.
- Produces: `RULES.coop.heal = { burstStart: 25 }`. `breakShield`에서 엑스퍼트가 아니면 살아 있는 사람 모두 `hp = min(hpMax, hp + 25)`.
- Produces: `CoopResult.reason?: 'crystal' | 'wipe' | 'time'`. 엑스퍼트 분노는 `finish(false)` 전에 `reason = 'crystal'`. `CoopHost.finish(win, reason?)`.
- 화면: 점수판 칩은 `hpBarHtml(p)`(작은 막대 + 숫자). 아래 줄(협력전에서 비어 있는 피버 자리)에 내 체력 막대를 크게. 맞으면 막대 흔들림 + 판 테두리 0.3초 붉게. 결과 화면 패배 문구에 `reason === 'crystal'`이면 "수정 구간 실패".

- [ ] **Step 1: 실패하는 테스트**
  - `피격: 노말 레이저 −30, 무적 2초, 기절 1초`
  - `피격: 무적 중이면 깎이지 않음`
  - `피격: 체력 0이면 탈락, 모두 탈락이면 패배`
  - `회복: 큰 피해 구간 시작에 +25(최대 100), 엑스퍼트는 회복 없음`
  - `엑스퍼트 분노: 바로 패배, reason 'crystal'`
  - `수정 구간 중 탈락하면 그 사람 수정이 치워진다` (기존 테스트가 있으면 체력으로 바꿔 유지)
- [ ] **Step 2: FAIL** → **Step 3: 구현** (`grep -rn "lives" shared server client`로 남은 곳을 모두 `hp`로) → **Step 4: `npm test`, typecheck 통과**
- [ ] **Step 5: 브라우저 확인** — 혼자 하기 협력전 노말에서 레이저에 맞으면 체력이 30 줄고 칩·아래 줄이 같이 바뀌는지.
- [ ] **Step 6: 커밋** `feat: 협력전 생명 3개를 체력 바 100으로, 난이도별 피격 피해`

---

### Task 6: 탄막 발사와 화면 판정

**Files:**
- Modify: `shared/src/protocol.ts` (`coop:volley`, `coop:clear`, `coop:hurt`, `CoopState.volleys`)
- Modify: `server/src/coop.ts` (탄막 일정, `reportHurt`), `server/src/room.ts` (`coop:hurt` 소켓 처리)
- Modify: `client/src/main.ts` (탄 보관·판정·보고), `client/src/render.ts` (탄 그리기)
- Test: `shared/test/coop.test.ts`

**Interfaces:**
- Consumes: Task 4의 `makeVolley`, `hitShot`, `volleyDone`, `COOP_BOSSES.core`. Task 5의 `damage`.
- Produces (서버→화면): `'coop:volley': (v: Volley) => void`, `'coop:clear': (d: { before: number }) => void` (그 시각 이전에 쏜 탄 모두 지움). `CoopState.volleys: Volley[]`(아직 끝나지 않은 것).
- Produces (화면→서버): `'coop:hurt': (d: { volleyId: number; shot: number }) => void`.
- Produces: `CoopRun.reportHurt(p: PlayerState, volleyId: number, shot: number, now: number): boolean`. 다음을 모두 만족할 때만 `damage(p, v.wall ? 'wall' : 'bullet', now)`:
  - 그 탄막이 있고 지워지지 않았다.
  - `shotPos`가 null이 아니고 `!shotGone`이다. 시각은 `now - RULES.lagWindowMs ~ now`를 허용한다.
  - 같은 `(p.id, volleyId, shot)` 보고가 처음이다.
  - `p`가 사람이고 탈락하지 않았고 연결돼 있다.
- 일정:
  - `CoopRun.tick`에서 보호막·큰 피해 구간이 아니면 `bulletEveryMs / phaseMult[phase-1]`마다 `bullets[phase]`에서 하나를 고른다. `overlap[phase-1]` 확률로 하나 더 고른다.
  - 보호막 중이면 `bulletEveryMs / shieldMult`마다 `shieldBullets[no]`에서 고른다.
  - 조준 무늬는 살아 있는 사람 커서(`cursorOf`)를 돌아가며 노린다.
  - 큰 피해 구간이 시작되면 `coop:clear`(보스가 무너짐).
- `shift(delta)`: 탄막 `at`, 다음 발사 시각을 민다(그 뒤 `coop:state`로 화면이 탄막 목록을 통째로 바꾼다).
- 화면:
  - `coopVolleys: Volley[]`를 보관한다.
  - 매 프레임 조건이 맞으면 `hitShot`으로 맞음을 확인한다. 조건은 내가 살아 있고, 무적이 아니고, 게임 커서가 있고, 일시정지·라운드 끝이 아닐 때다.
  - 맞으면 보고하고 같은 탄은 `skip`에 넣는다. 서버 응답(`coop:hit`)을 기다리지 않고 맞은 연출을 먼저 낸다.
  - 탄은 어두운 빨강 몸통 + 밝은 테두리 + 가시 4개로, 원보다 위·수정보다 아래에 그린다. 끝난 탄막은 `volleyDone`으로 버린다.
  - 터치는 마지막으로 닿은 자리가 `gameCursor.pos`라 따로 처리하지 않는다. 첫 터치 전에는 `pos`가 null이라 판정하지 않는다.

- [ ] **Step 1: 실패하는 테스트** (`coop.test.ts`, 기존 가짜 `CoopHost` 도우미 사용)
  - `탄막: 노말 1단계 1.2초마다 발사, 2단계는 1.2/1.3초`
  - `탄막: 보호막 중에도 shieldBullets로 발사, 큰 피해 구간에는 멈추고 coop:clear`
  - `reportHurt: 같은 탄 두 번 보고 → 한 번만 깎임` (Review Focus 2)
  - `reportHurt: 무적 중·탈락·봇·끊김이면 무시` (Review Focus 2·3)
  - `reportHurt: 없는 탄막·지워진 탄·발사 전 탄이면 무시`
  - `shift: 일시정지 뒤 탄막 at과 다음 발사가 delta만큼 밀리고 state().volleys에 반영` (Review Focus 1)
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: `npm test`, typecheck 통과**
- [ ] **Step 5: 브라우저 확인** — 혼자 하기 협력전 노말:
  - 탄이 보이고, 맞으면 체력이 10 줄고 0.6초 깜빡인다.
  - 일시정지 → 재개 뒤 탄이 이어서 움직인다.
  - 새로고침(다시 접속) 뒤 탄이 다시 그려진다.
- [ ] **Step 6: 커밋** `feat: 협력전 위험 탄막 (무늬 단위 전송, 화면 판정)`

---

### Task 7: 10초 고유 패턴과 보스 판 패턴 3개

**Files:**
- Modify: `shared/src/coop.ts` (판 패턴 순수 함수), `shared/src/rules.ts` (`RULES.coop.skillEveryMs`, `seal`·`beam`·`wall` 수치, `phasePatterns` 삭제, 쓰지 않게 된 `laserEvery`·`threatEvery`·`slamEvery`·`safeEvery`·`mapEvery`·`phase3Mult` 삭제)
- Modify: `shared/src/protocol.ts` (`coop:seal`, `coop:beam`, `CoopState.seal`·`beam`)
- Modify: `server/src/coop.ts` (`schedule`·`next` 대신 고유 패턴 일정), `server/src/room.ts` (협력전 맵 패턴 경로 제거)
- Modify: `client/src/main.ts`, `client/src/render.ts` (봉인·빔 그리기, 경고)
- Test: `shared/test/coop.test.ts`

**Interfaces:**
- Consumes: `COOP_BOSSES.core.skills`, Task 4의 `makeVolley('wall', …)`, Task 5의 `damage`.
- Produces:
```ts
export interface Seal { lanes: number[]; warnAt: number; at: number; until: number } // lanes ⊂ {0,1,2}, 판을 세로 3등분
export function rollSeal(phase: CoopPhase, now: number, rand: () => number): Seal;   // 2단계 1줄, 3단계 2줄, 늘 한 줄 이상 남김
export function inSeal(pt: Point, s: Seal, t: number): boolean;                       // at ≤ t < until 이고 pt가 막힌 줄 안
export interface Beam { at: number; until: number; count: number; a0: number; w: number } // 보스 중심에서 count줄, 각속도 w(라디안/초)
export function beamHits(pt: Point, b: Beam, from: Point, t: number, half: number): boolean;
export function pickSkill(list: readonly CoopSkill[], last: CoopSkill | null, rand: () => number): CoopSkill; // 직전과 다른 것 (목록이 하나면 그것)
```
- 수치: `skillEveryMs: 10_000`. 판 시작 첫 패턴은 `RULES.laser.startQuietMs` 뒤.
  - `seal = { warnMs: 2_000, ms: 5_000 }`
  - `beam = { warnMs: 2_000, ms: 4_000, count: [2, 3], w: 0.6, halfWidth: 22 }` (2단계 2줄, 3단계 3줄)
  - `wall = { gaps: [2, 1], speed: [140, 180] }`
- 일정: 보호막·큰 피해 구간에는 고유 패턴을 쓰지 않고, 끝나면 그 시각부터 다시 10초를 센다.
- 판정: 봉인·빔은 서버가 매 tick `cursorOf`로 판정한다. 한 패턴에서 한 사람은 한 번만 맞는다(무적이 막음). 벽은 Task 6의 탄 판정을 그대로 쓴다.
- 경고 화면:
  - 봉인: 막힐 줄에 붉은 빗금.
  - 빔: 보스에서 뻗는 얇은 선 + 도는 방향 화살표.
  - 벽: 보스 아래에 벽 줄 미리보기.
- 협력전에서는 `setPattern`(아케이드 맵 패턴)을 부르지 않는다. 방의 맵 패턴 위험 판정(`room.ts` 900행 근처) 안의 `this.coop` 분기를 지우고, `CoopHitBy`·`hurt`·`hurtFx`에서 `'hazard'`를 뺀다.

- [ ] **Step 1: 실패하는 테스트**
  - `고유 패턴: 10초마다 하나, 직전과 다름, 1단계는 레이저·추적 원만`
  - `고유 패턴: 보호막·큰 피해 구간에는 안 나오고, 끝난 뒤 10초 뒤 다시`
  - `구역 봉인: rand가 무엇이든 막힌 줄은 2단계 1개, 3단계 2개, 남은 줄 ≥ 1` (rand 0, 0.33, 0.66, 0.999로; Review Focus 4)
  - `구역 봉인: 경고 중에는 안 맞고 at~until 사이 막힌 줄 안이면 맞음 (노말 −20, 기절 1초)`
  - `회전 빔: 빔 위의 점은 맞고 빔 사이의 점은 안 맞음, 시간이 지나면 돈다`
  - `내려오는 벽: 2단계 틈 2개, 3단계 틈 1개` (Review Focus 4)
  - `협력전에서는 아케이드 맵 패턴이 나오지 않는다`
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: 통과**
- [ ] **Step 5: 브라우저 확인** — 2단계까지 가서(테스트용으로 잠시 `hpBase`를 낮추고 확인 뒤 되돌림, `git diff`로 확인) 봉인·벽·빔 경고와 피격.
- [ ] **Step 6: 커밋** `feat: 협력전 고유 패턴을 10초마다 하나로, 보스 판 패턴(구역 봉인·내려오는 벽·회전 빔)`

---

### Task 8: 위험한 수정 구간, 큰 피해 구간 길이, 단계 연출

**Files:**
- Modify: `shared/src/coop.ts` (`burstMsFor`, `placeCrystals`), `shared/src/rules.ts` (`RULES.coop.burst`)
- Modify: `server/src/coop.ts` (`breakShield`, `CoopState.burstUntil`, `breaks` 기록)
- Modify: `client/src/main.ts`, `client/src/render.ts`, `client/src/coopUI.ts`, `client/src/style.css`
- Test: `shared/test/coop.test.ts`

**Interfaces:**
- Produces: `burstMsFor(shieldLeftMs: number): number` = `min(burst.maxMs, burst.baseMs + shieldLeftMs × burst.leftRatio)`. 수치는 `RULES.coop.burst = { baseMs: 4_000, leftRatio: 0.5, maxMs: 10_000, mult, orbGapMs }`이고, `ms`는 없앤다.
- Produces: `CoopResult.breaks: { ms: number; rages: number; burstMs: number }[]`.
- `placeCrystals`: 보스 바로 아래 부채꼴(보스 중심에서 아래로 ±35°, 거리 600 안)은 피한다.
- 화면:
  - 보호막이 올라오면 판 테두리가 붉게 맥동하고(0.5초 주기) 보스가 떨린다. `coopState.shield`가 있는 동안 계속되고, '화면 효과 줄이기'면 맥동만 남긴다.
  - 수정은 탄 위에 그린다.
  - 큰 피해 구간이 끝나 `phase`가 바뀌면 현수막 "2단계"/"3단계"를 띄우고, 보스 테두리 색을 `COOP_BOSSES.core.rims[phase-1]`로 그린다.

- [ ] **Step 1: 실패하는 테스트**
  - `큰 피해 구간 길이: 남은 12초 → 10초(상한), 남은 2초 → 5초, 남은 0초 → 4초`
  - `수정 구간: 잡을 원은 안 나오고 탄막은 나온다` (Task 6의 shieldBullets와 함께)
  - `수정 자리: 보스 아래 부채꼴에 놓이지 않음` (rand 여러 개)
  - `breaks에 burstMs가 남는다`
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: 통과**
- [ ] **Step 5: 브라우저 확인** — 첫 보호막의 붉은 맥동·탄막, 빨리 깼을 때 큰 피해 구간이 길어지는지, "2단계" 현수막과 테두리 색.
- [ ] **Step 6: 커밋** `feat: 협력전 수정 구간을 위험 구간으로, 빨리 깰수록 큰 피해 구간이 길게`

---

### Task 9: 보스전 아이템 10개

**Files:**
- Create: `shared/src/coopItems.ts` (export)
- Modify: `shared/src/rules.ts` (`RULES.coop.items`, `PlayerState.coopFx`, `Circle.coopItem`), `shared/src/coop.ts` (`orbDamage`에 배율)
- Modify: `server/src/coop.ts` (`spawnOrbs`에서 아이템 원, `catchItem`, `hitWeak`, 미사일 일정), `server/src/room.ts` (협력전 아이템 원·보스 약점 클릭 경로, 봇은 아이템 원을 고르지 않음)
- Modify: `shared/src/protocol.ts` (`coop:item`, `coop:missile`, `CoopState.weak`)
- Modify: `client/src/main.ts` (보스 클릭: 약점이 있으면 보냄), `client/src/render.ts`, `client/src/effectsUI.ts`(버프 줄), `client/src/icons.ts`
- Test: Create `shared/test/coopitems.test.ts`

**Interfaces:**
- Produces:
```ts
export type CoopItemId = 'clear' | 'guard' | 'heal' | 'healAll' | 'fire' | 'power' | 'weak' | 'chain' | 'combo' | 'missile';
export function rollCoopItem(level: CoopLevel, rand: () => number): CoopItemId; // 엑스퍼트는 heal·healAll 제외
export interface CoopFx { guardUntil: number; fireUntil: number; power: number; chain: number } // power 0~3
export function coopDamageMult(fx: CoopFx | undefined, now: number): number;    // (1 + 0.2×power) × (fire면 1.5)
```
- `PlayerState.coopFx?: CoopFx` (`emitPlayers`로 같이 간다). `Circle.coopItem?: true` (`kind: 'item'`, `noGuard: true`, 잡을 때 종류를 굴린다).
- 수치(`RULES.coop.items`):
  - 등장: 원 하나가 나올 때 `chance` 이지 4% / 노말 3% / 하드 2.5% / 엑스퍼트 1.5%. 큰 피해 구간이 끝난 뒤·단계가 오른 뒤 10초 동안은 ×2.
  - 가중치: 같게 시작하고 판 기록을 보고 조정한다.
  - `guardMs: 3_000`, `heal: 20`, `healAll: 10`, `fireMs: 5_000`, `fireMult: 1.5`, `powerStep: 0.2`, `powerMax: 3`, `weakMs: 5_000`, `weakR: 34`, `weakDmg: 1.5`(원 기본 피해 배수, 콤보·강화 배율 받음), `chainN: 3`, `chainMult: 2`, `comboAdd: 10`, `missiles: 8`, `missileGapMs: 200`, `missilePct: 0.04`(합계, 보스 최대 체력 기준 고정 피해).
- 효과 규칙:
  - `clear`: `coop:clear`(그 시각 이전 탄 모두, 벽 포함)
  - `guard`: 다음 `damage` 한 번을 막고 `guardUntil = 0`
  - `power`: 단계가 오르면(`breakShield`) 0으로
  - `weak`: `CoopState.weak = { until, dx, dy }`(보스 중심 기준 약점 자리). 약점 안 클릭마다 피해
  - `chain`: 다음 원 3개 피해 ×2
  - `missile`: 200ms 간격 8발, 각 `maxHp × 0.04 / 8`을 `applyRaidDamage`로(배율 없음, 경계 못 넘음). 보호막이 올라오면 남은 발은 막힌다(피해 0)
- 피해 곱 순서: `orbDamage` × `coopDamageMult` × (chain이면 2). 큰 피해 구간 배율은 `orbDamage` 안에 이미 있다.
- 화면: `?` 원(개인전 아이템 원 그림 재사용, 테두리 색만 협력전 전용). 잡으면 아이콘 룰렛 0.4초. 미사일은 잡은 자리에서 보스로 곡선 비행. 약점은 보스 몸의 노란 과녁. 버프 줄에 방어막·화력·공격력(×N)·연쇄(남은 수).

- [ ] **Step 1: 실패하는 테스트** (`coopitems.test.ts`)
  - `rollCoopItem: 엑스퍼트는 회복이 안 나옴` (rand 전 범위)
  - `방어막: 3초 안 한 번 막고 사라짐, 3초 뒤엔 못 막음`
  - `공격력 강화: +20%씩 최대 +60%, 단계가 오르면 0`
  - `화력 강화 × 공격력 강화 × 연쇄 폭발이 곱해진다`
  - `미사일: 8발 합계 최대 체력 4%, 콤보·강화와 상관없음, 경계를 넘지 않음, 보호막 뒤 발은 0`
  - `약점: 활성 중 약점 안 클릭은 피해, 밖이나 끝난 뒤는 아무 일 없음`
  - `회복: heal +20, healAll 살아 있는 사람 +10, 100 넘지 않음`
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: `npm test`, typecheck 통과**
- [ ] **Step 5: 브라우저 확인** — 테스트용으로 잠시 `chance`를 높여 열 가지를 한 번씩 잡아 본다(확인 뒤 되돌리고 `git diff`로 확인).
- [ ] **Step 6: 커밋** `feat: 협력전 보스전 아이템 10개`

---

### Task 10: 관전 다듬기 (여럿이 할 때)

**Files:**
- Modify: `client/src/main.ts` (`outBanner` 문구, 탈락하면 게임 커서·탄 판정 끔), `server/src/room.ts`(필요할 때만)
- Test: `shared/test/coop.test.ts`

- [ ] **Step 1: 실패하는 테스트** — `여럿: 한 사람이 탈락해도 다른 사람이 살아 있으면 판이 계속되고, 탈락한 사람의 coop:hurt는 무시` (Task 6 `reportHurt`)
- [ ] **Step 2: FAIL이면 고치고, 이미 통과하면 그대로 둔다**
- [ ] **Step 3: 화면** — 협력전에서 탈락하면 띠를 "탈락 · 구경 중 · 남은 사람 N명"으로 바꾼다. 내 게임 커서는 그리지 않는다. `aimLive`는 이미 `outAt`이면 거짓이라 잠금도 풀린다.
- [ ] **Step 4: 브라우저 확인** — 탭 두 개로 방을 만들고 들어가 협력전을 시작한다. 한쪽이 일부러 맞아 탈락하면 결과창이 아니라 판을 계속 보는지, 다른 쪽이 이기거나 지면 그때 둘 다 결과창이 뜨는지 확인한다.
- [ ] **Step 5: 커밋** `fix(client): 협력전 탈락 뒤 관전 화면 정리`

---

### Task 11: 판 길이 맞추기, 판 기록, 문서

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.coop.hpBase`), `server/src/gameLog.ts`, `server/src/coop.ts` (단계별 시각·피격 기록)
- Modify: `CHANGELOG.md` (`[미출시]`), `docs/ROADMAP.md`, `client/src/guide.ts`·`client/src/codex.ts`의 협력전 설명(하트·생명 문구)
- Test: `shared/test/gamelog.test.ts`, `shared/test/coop.test.ts`

**Interfaces:**
- Produces: `CoopResult.phaseMs: number[]`(각 단계가 끝난 판 기준 ms), `CoopPlayerResult.hits: Partial<Record<CoopHitBy, number>>`, `CoopPlayerResult.hpLeft: number`. `gameRecord`의 `coopResult`에 그대로 싣는다.

- [ ] **Step 1: 실패하는 테스트** — `판 기록: coopResult에 phaseMs, 사람마다 hits·hpLeft`
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: 통과**
- [ ] **Step 5: 판 길이 처음 값**
  - 봇 3명(보통) + 사람 없는 시뮬레이션은 할 수 없으니, 봇 피해 몫으로 어림한다. 봇 피해 = 원 간격 × `botGapMult`, × `botWeight`.
  - 노말 혼자(봇 3) 기준 보스가 120~150초에 잡히도록 `hpBase`를 다시 잡는다.
    - 사람 하나가 0.45초마다 원 하나를 잡는다고 하면, 콤보 보너스 포함 초당 약 2.6 피해다.
    - 여기에 큰 피해 구간 두 번(각 평균 7초, ×`burst.mult`)이 더해진다.
  - 계산을 `rules.ts` 주석으로 남기고 별도 커밋 `balance(coop): 탄막 개편에 맞춰 보스 체력 조정`.
- [ ] **Step 6: 문서**
  - `CHANGELOG.md [미출시]`에 기능 줄을 적는다: 탄막, 고유 패턴, 판 패턴, 수정 구간, 체력 바, 아이템, 엑스퍼트, 기절 커서 멈춤, 타임어택 삭제, 게임 모드 변경.
  - `docs/ROADMAP.md` 다음 작업 표의 협력전 줄에 "탄막 개편 (2026-11-18), 설계 `2026-11-18-coop-bullet-hell-design.md`"를 적는다. 3차 표의 타임어택은 "삭제 (2026-11-18)"로 바꾼다.
  - 게임 방법·도감의 협력전 설명을 체력 바·탄막에 맞게 고친다.
- [ ] **Step 7: 마지막 검사** — `npm test && npm run typecheck && npm run build` 통과. 브라우저에서 노말 한 판을 끝까지 해 보고 걸린 시간과 단계별 시각을 서버 로그(`[game]` 줄)에서 확인한다.
- [ ] **Step 8: 커밋** `docs: 협력전 탄막 개편 반영` (CHANGELOG·ROADMAP·안내 문구)
