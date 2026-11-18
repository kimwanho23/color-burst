# 협력전 콤보 상한과 폭딜 반격 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬은 superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 협력전 콤보 보너스를 10콤보마다 +0.2배, 상한 1.8배로 올린다. 팀 피해를 모으는 분노 게이지가 가득 차면 2초 예고 뒤 피할 수 없는 반격이 나가 모두의 콤보를 0으로 만든다. 단, 우클릭 보호막이 켜져 있던 사람은 콤보를 지킨다.

**구조:** 게이지 계산(새는 양동이)과 보호막 판정은 `shared/src/coopCounter.ts`의 순수 함수로 둔다. 서버 `CoopRun`은 콤보 배율을 받는 피해만 게이지에 넣고, 틱마다 발동과 판정을 처리한다. 상태는 `CoopState.counter`에 싣고, 판정 결과는 `coop:counter` 이벤트로 보낸다. 화면은 받은 값에서 시간이 지난 만큼 빼서 게이지를 그린다.

**기술:** TypeScript, socket.io, Canvas, `node --test`(tsx)

**설계 문서:** `docs/superpowers/specs/2026-11-18-coop-combo-counter-design.md`

## 공통 제약

- 수치는 `shared/src/rules.ts`의 `RULES.coop`에서만 바꾼다. 콤보는 `comboStep: 10, comboPer: 0.2, comboCap: 0.8`이다.
- `RULES.coop.counter`의 값은 다음과 같다.
  - `warnMs: 2_000`
  - `drain`: easy 2.3, normal 1.3, hard 0.8, expert 0.5
  - `cap`: easy 5, normal 2.5, hard 1.5, expert 1
  - `cooldownMs`: easy 30_000, normal 25_000, hard 20_000, expert 15_000
- 게이지 단위는 보스 최대 체력 대비 %다. 원과 약점 피해(`orbDamage`를 거친 피해)만 게이지에 넣고, 실제로 깎은 체력(`dealt`)으로 센다. 봇의 피해도 넣는다.
- 반격은 체력 피해, 기절, 무적을 주지 않는다. 콤보만 0으로 만든다. 대상은 탈락하지 않은 모든 플레이어이며 봇도 포함한다.
- 아이템 방어막(`guard`)은 반격을 막지 않는다. 보호막 횟수는 기존 판당 횟수를 함께 쓰고, 반격 때 따로 소모하지 않는다.
- 테스트는 모든 기능을 구현한 뒤 마지막 작업에서 한꺼번에 작성한다(사용자 규칙). 각 작업은 `npm run typecheck`와 `npm run build`로 확인하고 커밋한다.
- 커밋 형식은 `<타입>(<범위>): <한국어 요약>`이다. 수치 변경은 `balance`를 쓴다. 한 커밋에는 한 가지 목적만 담는다. 원격 푸시는 하지 않는다.
- 화면 문구는 다음과 같다.
  - 예고: `보스 반격! N초`
  - 예고 부가 문구: 보호막이 있는 난이도는 `보호막으로 콤보를 지키세요`, 엑스퍼트는 `콤보가 초기화됩니다`
  - 피드: `반격으로 콤보 초기화`, `보호막으로 콤보 지킴`
  - 대기실: `피해를 너무 몰아 넣으면 보스가 반격해 콤보가 0이 됩니다.`

## 검토 중점

1. **한 틱에 판이 끝나는 경우**: 반격 예고 중에 보스가 처치되거나 팀이 전멸하면 판정하지 않는다. `dispose`가 게이지를 지운다.
2. **보호막 단계와 겹치는 경우**: 예고 중에 수정 보호막 단계가 시작되면 취소한다. 게이지는 0이 되고 재사용 대기는 시작하지 않는다. 판정 대기(`fireAt ≤ now < fireAt + lagMs`) 중에 보호막 단계가 시작되면 판정은 그대로 끝낸다.
3. **일시정지가 예고나 판정 대기와 겹치는 경우**: `shift`가 `at`, `fireAt`, `coolUntil`을 모두 민다. 재개 직후 바로 발동하거나 게이지가 크게 줄면 안 된다.
4. **연결이 끊긴 사람과 탈락한 사람**: 탈락한 사람(`outAt`)은 대상이 아니다. 연결이 끊긴 사람은 대상이다. 콤보가 0인 사람은 `lost`에 넣지 않는다.
5. **한 번의 피해가 용량을 크게 넘는 경우**: 게이지는 `cap`에서 멈추고 예고는 한 번만 시작한다.

---

### 작업 1: 수치 (`RULES.coop`)

**파일:**
- 수정: `shared/src/rules.ts:102-103` (`comboPer`·`comboCap`과 바로 아래 `counter` 블록)

**인터페이스:**
- 만드는 것: `RULES.coop.counter: { warnMs: number; drain: Record<CoopLevel, number>; cap: Record<CoopLevel, number>; cooldownMs: Record<CoopLevel, number> }`

- [ ] **1단계:** `comboPer`를 0.2로, `comboCap`을 0.8로 바꾼다. 주석은 "상한 1.8배(40콤보)"로 고친다.
- [ ] **2단계:** `counter` 블록을 공통 제약의 값 그대로 추가한다. 주석에 단위(최대 체력 %, %/초)와 설계 문서의 '난이도별 감각'을 한 줄로 적는다.
- [ ] **3단계:** `npm run typecheck`를 실행한다. 오류가 없어야 한다.
- [ ] **4단계:** 커밋한다. `balance(shared): 협력전 콤보 상한 1.8배와 반격 수치 추가`

### 작업 2: 게이지 순수 함수 (`shared/src/coopCounter.ts`)

**파일:**
- 생성: `shared/src/coopCounter.ts`
- 수정: `shared/src/index.ts` (`export * from './coopCounter.ts'`)
- 수정: `shared/src/protocol.ts` (`CoopState.counter`, `CoopPlayerResult.counterLost`·`counterSaved`, `'coop:counter'` 이벤트)

**인터페이스:**
- 만드는 것:
  - `interface CoopCounter { value: number; at: number; fireAt: number; coolUntil: number }`
    - `value`: `at` 시각의 게이지(%)
    - `fireAt`: 반격 발동 시각, 0이면 예고 없음
    - `coolUntil`: 재사용 대기가 끝나는 시각
  - `newCounter(now: number): CoopCounter`: 0, now, 0, 0을 돌려준다.
  - `counterValue(g: CoopCounter, now: number, level: CoopLevel): number`: `max(0, value − drain × (now − at)/1000)`. 화면도 이 함수를 쓴다.
  - `fillCounter(g: CoopCounter, pct: number, now: number, level: CoopLevel): boolean`: 먼저 `counterValue`로 정산하고 `at = now`로 둔다. 그다음 `min(cap, 정산값 + pct)`를 넣는다. 용량에 닿았고 `fireAt === 0`이면 `fireAt = now + warnMs`로 두고 `true`를 돌려준다. `fireAt > 0`이거나 `now < coolUntil`이면 아무것도 하지 않고 `false`를 돌려준다.
  - `barrierCovers(fx: CoopFx | undefined, fireAt: number): boolean`: `fx`가 있고 `fx.barrierUntil > 0`이며 `fx.barrierUntil − durationMs ≤ fireAt + lagMs`이고 `fireAt < fx.barrierUntil + lagMs`이면 참이다.
  - `CoopState.counter: CoopCounter | null`
  - `CoopPlayerResult.counterLost: number; counterSaved: number`
  - 서버에서 화면으로 가는 이벤트 `'coop:counter': (d: { lost: string[]; saved: string[] }) => void`

- [ ] **1단계:** 위 타입과 네 함수를 만든다. 수치는 `RULES.coop.counter`와 `RULES.coop.barrier`에서만 읽는다.
- [ ] **2단계:** 프로토콜 타입을 추가한다. `CoopPlayerResult`를 새로 만드는 곳(`server/src/coop.ts`의 `stat`)에 `counterLost: 0, counterSaved: 0`을 넣는다.
- [ ] **3단계:** `npm run typecheck`를 실행한다. 오류가 없어야 한다.
- [ ] **4단계:** 커밋한다. `feat(shared): 협력전 분노 게이지 계산 함수`

### 작업 3: 서버 반격 (`server/src/coop.ts`)

**파일:**
- 수정: `server/src/coop.ts`
  - 필드
  - `start`
  - `catchOrb`
  - `hitWeak`
  - `hurtBoss`
  - `tick`
  - `beginShield`
  - `shift`
  - `state`
  - `dispose`

**인터페이스:**
- 쓰는 것: 작업 2의 `newCounter`, `fillCounter`, `barrierCovers`, `CoopCounter`
- 만드는 것:
  - `private counter: CoopCounter | null`
  - `hurtBoss(p, dmg, now, at, combo = false)`
  - `private tickCounter(now: number): void`

- [ ] **1단계:** `start`에서 `this.counter = newCounter(now)`로 둔다. `dispose`에서는 `null`로 둔다.
- [ ] **2단계:** `hurtBoss`에 다섯 번째 인자 `combo: boolean = false`를 추가한다. 다음을 모두 만족하면 `fillCounter(counter, dealt / maxHp × 100, now, level)`을 부른다.
  - `combo`가 참이다.
  - `dealt > 0`이다.
  - 보스가 처치되지 않았고 `crossed`가 아니다.
  - 큰 피해 구간이 아니다(`!this.inBurst(now)`).
  - 보호막 단계가 아니다(`!this.shield`).

  `fillCounter`가 `true`를 돌려주면 `coop:state`를 보낸다. 기존 경로가 이미 보내므로 중복으로 보내지 않는다. `catchOrb`와 `hitWeak`만 `combo = true`로 부른다. 스페셜 어택과 미사일은 그대로 둔다.
- [ ] **3단계:** `tickCounter(now)`를 만들어 `tick`의 `tickRage` 다음에서 부른다. `counter.fireAt > 0`이고 `now ≥ fireAt + lagMs`이면 다음을 처리한다.
  1. 탈락하지 않은 모든 플레이어 `p`마다 `barrierCovers(p.coopFx, fireAt)`이면 `saved`에 넣고 `stat.counterSaved++` 한다.
  2. 그렇지 않고 `p.combo > 0`이면 `p.combo = 0`으로 만들고 `lost`에 넣고 `stat.counterLost++` 한다.
  3. 게이지를 `{ value: 0, at: now, fireAt: 0, coolUntil: fireAt + cooldownMs }`로 바꾼다.
  4. `coop:counter { lost, saved }`, `coop:state`를 보내고, 아무나 콤보를 잃었으면 `emitPlayers`도 보낸다.
- [ ] **4단계:** `beginShield`에서 `now < counter.fireAt`이면 게이지를 `newCounter(now)`로 되돌린다. 이때 재사용 대기는 시작하지 않는다.
- [ ] **5단계:** `shift(delta)`에서 `counter.at`, `counter.fireAt`(0이 아니면), `counter.coolUntil`(0이 아니면)에 `delta`를 더한다.
- [ ] **6단계:** `state()`에 `counter: this.counter ? { ...this.counter } : null`을 싣는다.
- [ ] **7단계:** `npm run typecheck && npm run build`를 실행한다. 둘 다 통과해야 한다.
- [ ] **8단계:** 커밋한다. `feat(server): 협력전 폭딜 반격과 보호막 판정`

### 작업 4: 화면 (게이지, 예고, 발동, 피드, 대기실 안내)

**파일:**
- 수정: `client/src/coopUI.ts` (`renderCoopHud`, 대기실 스페셜 어택 설명 문자열 10행)
- 수정: `client/src/main.ts` (`coop:counter` 수신, 예고 경고음)
- 수정: `client/src/render.ts` (발동 번쩍임 `drawCounterFlash`, `reduceMotion` 존중)
- 수정: `client/src/style.css` (`.ch-rage-gauge`)

**인터페이스:**
- 쓰는 것: `CoopState.counter`, `counterValue`, `RULES.coop.counter`, `'coop:counter'`

- [ ] **1단계:** `renderCoopHud`에서 `.ch-bar` 아래에 붉은 얇은 게이지 `<div class="ch-rage-gauge"><i style="width:…%">`를 그린다. 너비는 `counterValue / cap × 100`이다.
  - 재사용 대기 중(`now < coolUntil`)이면 `cooling` 클래스로 흐리게 하고 `N초`를 표시한다.
  - 예고 중(`fireAt > now`)이면 상태 문구를 `보스 반격! N초`와 부가 문구로 바꾼다. 예고는 분노 다음으로 우선한다.
  - 게이지가 매 프레임 줄어들도록 HUD를 그리는 기존 주기를 그대로 쓴다. 주기가 없으면 렌더 루프에서 부른다.
- [ ] **2단계:** `coop:state`에서 `counter.fireAt`이 새로 생기면 `sfx.patternWarn()`를 한 번 낸다.
- [ ] **3단계:** `render.ts`에 `drawCounterFlash(ctx, fireAt, now)`를 만든다. 발동 뒤 400ms 동안 화면 전체를 붉게 덮었다가 흐려진다. `reduceMotion`이면 테두리 8px만 붉게 한다. `main.ts`에서 보관한 `fireAt`으로 그린다.
- [ ] **4단계:** `coop:counter`를 받으면 다음을 처리한다.
  - 내가 `lost`에 있으면 `myHurtFx('반격으로 콤보 초기화')`와 `sfx.comboBroken()`
  - 내가 `saved`에 있으면 기존 `'막음!'` 연출
  - 다른 사람은 피드에 `${이름}: 반격으로 콤보 초기화` 또는 `${이름}: 보호막으로 콤보 지킴`
  - 피드도 0.15초 묶음(`BLOCK_FX_GAP_MS`)을 그대로 따른다.
- [ ] **5단계:** 대기실 설명의 보호막 줄 뒤에 공통 제약의 대기실 문구를 `<br>`로 붙인다.
- [ ] **6단계:** `npm run typecheck && npm run build`를 실행한다. 둘 다 통과해야 한다.
- [ ] **7단계:** 커밋한다. `feat(client): 협력전 분노 게이지와 반격 연출`

### 작업 5: 테스트 (모든 기능 구현 뒤 한꺼번에)

**파일:**
- 수정: `shared/test/coop.test.ts:57-68` (`orbDamage` 기대값)
- 생성: `shared/test/coopcounter.test.ts`. `coopbarrier.test.ts`의 `coopRoom` 하네스 방식을 그대로 쓴다.

- [ ] **1단계:** `coop.test.ts`의 `orbDamage` 테스트를 고친다. 제목은 `콤보 30에 +60%, 상한 80%`이고 기대값은 다음과 같다.

| 콤보 | 피해 |
|---|---|
| 30 | 1.6 |
| 40 | 1.8 |
| 100 | 1.8 |
| 39 | 1.6 |

- [ ] **2단계:** `coopcounter.test.ts`에 아래 테스트를 쓴다(이름과 확인 내용).
  - `수치: RULES.coop.counter`: `drain`, `cap`, `cooldownMs`, `warnMs`가 공통 제약의 값과 같다.
  - `counterValue: 초당 drain만큼 줄고 0 아래로 내려가지 않음`: 노말 2.5에서 1초 뒤 1.2, 10초 뒤 0
  - `fillCounter: 용량에서 멈추고 처음 닿을 때만 예고`: 노말에 3을 넣으면 값 2.5, `true`, `fireAt = now + 2000`. 한 번 더 넣으면 `false`, `fireAt`은 그대로다.
  - `fillCounter: 재사용 대기 중에는 차지 않음`
  - `barrierCovers: 경계`: 다음 경우를 모두 확인한다.

| 보호막 시작 | 기대값 |
|---|---|
| `fireAt − 1500` (끝 = `fireAt`) | 참 (`lagMs` 안) |
| `fireAt − 1650 − 1` | 거짓 |
| `fireAt + 150` (늦게 도착) | 참 |
| `fireAt + 151` | 거짓 |
| `fx`가 없을 때 | 거짓 |

  - `서버: 원 피해만 게이지에 들어감`: `catchOrb` 경로로 피해를 넣으면 `state().counter.value > 0`이다. 스페셜 어택과 미사일 피해로는 0을 유지한다.
  - `서버: 큰 피해 구간·보호막 단계에서는 차지 않음`
  - `서버: 예고 2초 + lagMs 뒤 콤보 0, 보호막 켠 사람은 유지`: `coop:counter`의 `lost`와 `saved`, `counterLost`와 `counterSaved` 통계를 확인한다. 봇의 콤보도 0이 된다. 체력은 그대로다.
  - `서버: 아이템 방어막은 반격을 막지 않음`
  - `서버: 발동 뒤 재사용 대기 동안 게이지 0 유지`
  - `서버: 예고 중 보호막 단계가 시작되면 취소, 대기 없음`
  - `서버: 일시정지 shift가 at·fireAt·coolUntil을 민다`: 재개 직후 발동하지 않는다.
  - `서버: 예고 중 보스 처치나 전멸이면 판정하지 않음`
  - `서버: 탈락한 사람은 대상 아님, 콤보 0인 사람은 lost에 없음`
  - `서버: 재접속 상태(state)에 counter가 실림`
- [ ] **3단계:** `npm test`를 실행한다. 모두 통과해야 한다(기존 595개 + 새 테스트). 실패하면 원인을 고치고 다시 실행한다.
- [ ] **4단계:** `npm run typecheck && npm run build`를 실행한다. 둘 다 통과해야 한다.
- [ ] **5단계:** 커밋한다. `test: 협력전 콤보 상한과 폭딜 반격 테스트`

### 작업 6: 문서

**파일:**
- 수정: `docs/HANDOFF.md` (콤보·반격 절을 새로 쓰고 123행의 '논의 단계' 문단을 바꾼다)
- 수정: `docs/ROADMAP.md` (7행의 다음 후보 문구, 협력전 표에 ✅ 행)
- 함께 커밋: 설계 문서와 이 계획 문서

- [ ] **1단계:** `HANDOFF.md`에 다음을 적는다.
  - 동작 요약: 수치 표, 보호막 공유, 아이템 방어막 불가, 취소 규칙
  - 구현 위치: `coopCounter.ts`, `tickCounter`, `renderCoopHud`, `drawCounterFlash`
  - 실제 플레이로 확인할 것: 난이도별 감각, 보스 처치 시간 변화
- [ ] **2단계:** `ROADMAP.md`를 갱신한다.
- [ ] **3단계:** 커밋한다. `docs: 협력전 콤보 상한·폭딜 반격 설계·계획·인수인계`
