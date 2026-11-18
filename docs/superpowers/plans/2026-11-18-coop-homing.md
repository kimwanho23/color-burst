# 협력전 엑스퍼트 유도탄 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엑스퍼트 2·3단계 고유 패턴 `homing`을 추가한다. 살아 있는 사람마다 1발이 그 사람 커서를 선회 속도 제한 안에서 쫓는다.

**Architecture:** 이동·판정은 `shared/src/coop.ts`의 순수 함수로 두고, `server/src/coop.ts`가 틱마다 그 함수로 탄을 움직이고 판정한 뒤 `coop:homing`으로 상태를 보낸다. 화면은 받은 상태를 서버 시각 기준으로 짧게 외삽해 그린다.

**Tech Stack:** TypeScript, socket.io, Canvas 2D, `node --test` + tsx.

**Spec:** `docs/superpowers/specs/2026-11-18-coop-homing-design.md`

## Global Constraints

- 모든 수치는 `RULES.coop.homing`과 각 난이도 `hurt.homing`에만 둔다 (`CLAUDE.md`).
- 수치 초기값: `warnMs 1500, lifeMs 5000, fadeMs 400, r 16, sendMs 50, speed [300, 340], turnDeg [140, 160]` (배열은 [2단계, 3단계]).
- `hurt.homing`: 이지 15, 노말 20, 하드 25, 엑스퍼트 30. `hurtFx.homing`은 `threat`와 같은 `{ immuneMs: 1_000, stunMs: 0 }`.
- `hurt`·`hurtFx` 표는 `as Record<CoopHitBy, …>`로 캐스팅되어 있어 키가 빠져도 타입 검사가 잡지 못한다. 네 난이도 표와 `hurtFx` 모두에 직접 넣는다.
- 엑스퍼트 2·3단계에서만 쓴다. 봇은 대상이 아니다. 클릭으로 제거할 수 없다.
- 코드 키는 `homing`, 화면 문구는 '유도탄'. 기존 '추적 원'(`threat`)과 섞지 않는다.
- 커밋은 Conventional Commits, 한국어 요약. 각 커밋 전 `npm run typecheck`, `npm run build` 통과.

## 실행 순서 (사용자 규칙)

기능마다 테스트하지 않는다. Task 1~3의 구현 단계를 모두 먼저 하고, 그 뒤 각 Task에 적힌 테스트를 한꺼번에 작성하고 실행한다. 테스트가 통과하면 커밋을 목적별로 나눈다(shared+server 기능, 화면 연출, 테스트, 문서). 아래 Task 안의 "실패 확인" 단계는 건너뛰고, 테스트 내용은 작성할 테스트의 명세로 쓴다.

## Review Focus

1. 대상이 탄 비행 중 탈락하거나 방을 나감 → 그 탄만 즉시 사라지고 나머지는 계속 난다.
2. 일시정지 중 → 탄이 제자리에 멈추고, 재개 직후 한 틱에 멀리 순간이동하지 않는다.
3. 커서 정보가 없는 대상(아직 커서를 안 보냄) → 탄은 현재 방향으로 직진하고 판정하지 않는다.
4. 무적 중인 대상에 닿음 → 피해 없이 탄은 계속 쫓는다(무적이 풀린 뒤 다시 맞힐 수 있음). 방어막에 막히면 탄은 사라진다.
5. 판이 끝나거나(`dispose`) 보호막 단계가 시작됨 → 다음 틱에 아무것도 보내지 않고, 화면에서 탄이 지워진다.

---

### Task 1: 공유 수치·타입·순수 함수

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.coop`에 `homing`, `hurtFx.homing`, 네 난이도 `hurt.homing`)
- Modify: `shared/src/coopBosses.ts` (`CoopSkill`에 `'homing'`, `expertSkills` 2·3단계 목록에 추가)
- Modify: `shared/src/protocol.ts` (`CoopHitBy`에 `'homing'`, `CoopState.homing`, `ServerToClient['coop:homing']`)
- Modify: `shared/src/coop.ts` (타입과 함수)
- Test: `shared/test/coophoming.test.ts` (새 파일)

**Interfaces:**
- Produces (`shared/src/coop.ts`, `index.ts`에서 다시 내보냄):
  ```ts
  export interface HomingShot { id: number; target: string; x: number; y: number; angle: number; born: number }
  /** warnAt 예고 시작, at 발사 시각, t 위치를 잰 서버 시각. 발사 전에는 shots가 비고 targets로 예고한다 */
  export interface Homing { warnAt: number; at: number; t: number; phase: 2 | 3; targets: string[]; shots: HomingShot[] }
  export function homingRule(phase: 2 | 3): { speed: number; turnRad: number }
  export function steerHoming(s: { x: number; y: number; angle: number }, to: Point | null, speed: number, turnRad: number, dtMs: number): { x: number; y: number; angle: number }
  export function homingHits(from: Point, to: Point, cursor: Point, r: number): boolean
  export function homingAlpha(s: HomingShot, t: number): number // 0~1, lifeMs 뒤 fadeMs 동안 1→0
  ```
- `CoopState.homing: Homing | null`, `'coop:homing': (d: Homing | null) => void`.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/coophoming.test.ts`)

  ```ts
  test('유도탄 수치·스킬 목록', () => {
    assert.ok(COOP_BOSSES.core.expertSkills[2]!.includes('homing') && COOP_BOSSES.core.expertSkills[3]!.includes('homing'));
    assert.ok(!COOP_BOSSES.core.expertSkills[1]?.includes('homing'));
    for (const ph of [1, 2, 3] as const) assert.ok(!COOP_BOSSES.core.skills[ph].includes('homing'));
    const H = RULES.coop.levels;
    assert.deepEqual([H.easy.hurt.homing, H.normal.hurt.homing, H.hard.hurt.homing, H.expert.hurt.homing], [15, 20, 25, 30]);
    assert.deepEqual(RULES.coop.hurtFx.homing, { immuneMs: 1_000, stunMs: 0 });
    assert.equal(homingRule(2).speed, 300);
    assert.ok(Math.abs(homingRule(3).turnRad - (160 * Math.PI) / 180) < 1e-9);
  });
  test('선회 상한: 뒤쪽 목표여도 한 번에 turnRad×dt만큼만 돈다', () => {
    const s = steerHoming({ x: 0, y: 0, angle: 0 }, { x: -100, y: 1 }, 300, Math.PI, 100);
    assert.ok(Math.abs(Math.abs(s.angle) - Math.PI / 10) < 1e-9);
    assert.ok(Math.abs(Math.hypot(s.x, s.y) - 30) < 1e-9); // 300/s × 0.1s
  });
  test('선회 상한 안이면 목표를 정확히 향한다', () => {
    const s = steerHoming({ x: 0, y: 0, angle: 0 }, { x: 100, y: 10 }, 300, Math.PI, 1000);
    assert.ok(Math.abs(s.angle - Math.atan2(10, 100)) < 1e-9);
  });
  test('목표 없으면 직진, 각도 경계(±π)를 짧은 쪽으로 돈다', () => {
    assert.deepEqual(steerHoming({ x: 0, y: 0, angle: 0 }, null, 100, 1, 1000), { x: 100, y: 0, angle: 0 });
    const s = steerHoming({ x: 0, y: 0, angle: Math.PI - 0.05 }, { x: -100, y: -10 }, 0, 1, 1000);
    assert.ok(Math.cos(s.angle) < -0.99); // 반대로 크게 돌지 않음
  });
  test('선분 판정: 틱 사이에 건너뛴 커서도 맞는다', () => {
    assert.ok(homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 15 }, 16));
    assert.ok(!homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 17 }, 16));
    assert.ok(!homingHits({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 130, y: 0 }, 16));
  });
  test('흐려짐: lifeMs 전 1, lifeMs+fadeMs에 0', () => {
    const s = { id: 1, target: 'a', x: 0, y: 0, angle: 0, born: 1000 };
    const H = RULES.coop.homing;
    assert.equal(homingAlpha(s, 1000 + H.lifeMs - 1), 1);
    assert.equal(homingAlpha(s, 1000 + H.lifeMs + H.fadeMs), 0);
  });
  ```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test shared/test/coophoming.test.ts` → import 오류나 `homing` 없음으로 FAIL.

- [ ] **Step 3: 구현**
  - `RULES.coop.homing = { warnMs: 1_500, lifeMs: 5_000, fadeMs: 400, r: 16, sendMs: 50, speed: [300, 340], turnDeg: [140, 160] }`. 주석에 각 항목 설명.
  - `hurtFx.homing`, 네 난이도 `hurt.homing` (Global Constraints 값).
  - `steerHoming`: 목표 방향과 현재 각의 차를 (−π, π]로 접어 `±turnRad×dt/1000`로 자른 뒤 회전하고 `speed×dt/1000`만큼 전진. 목표가 없거나 목표와 겹치면 회전 없이 전진.
  - `homingHits`: 점–선분 거리 ≤ r.
  - `protocol.ts`: `CoopHitBy`에 `'homing'`, `CoopState`에 `homing: Homing | null` (주석: 재접속·재개 때 화면이 이어서 그리도록), `'coop:homing'` 이벤트.

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS. `npm run typecheck`는 서버 `state()`가 `homing`을 안 채워 실패할 수 있다. Task 2에서 고친다.

- [ ] **Step 5: 커밋** — Task 2와 함께 커밋한다(타입 검사를 통과해야 커밋할 수 있으므로).

---

### Task 2: 서버 발사·이동·판정

**Files:**
- Modify: `server/src/coop.ts`
- Test: `shared/test/coop.test.ts` (기존 `coopRoom`, `spySkills`, `noSkills`, `SkillRun` 도우미 사용)

**Interfaces:**
- Consumes: Task 1의 `Homing`, `HomingShot`, `homingRule`, `steerHoming`, `homingHits`, `RULES.coop.homing`.
- Produces: 서버 이벤트 `coop:homing`(예고 시작, 발사, `sendMs`마다 위치, 소멸 시 `null`), `state().homing`.

- [ ] **Step 1: 실패하는 테스트 작성** (`shared/test/coop.test.ts` 끝, 테스트 이름 앞에 `유도탄:`)

  - `유도탄: 엑스퍼트 1단계·다른 난이도에서는 쓰지 않는다` — `useSkill('homing', t)` 뒤 `coop:homing` 전송 없음.
  - `유도탄: 예고 뒤 살아 있는 사람마다 1발, 봇 제외` — 사람 2·봇 2 엑스퍼트 2단계. `useSkill` 직후 보낸 값의 `targets`가 사람 id 둘, `shots` 빈 배열, `at === t + warnMs`. `tick(at)` 뒤 `shots.length === 2`, 각 `target`이 사람 id, `born === at`.
  - `유도탄: 가만히 있는 사람은 맞고, 한 발은 한 번만` — 커서를 보스 아래 고정. 50ms 간격으로 `lifeMs`까지 tick. `coop:hit`의 `by === 'homing'`이 정확히 1번, 그 사람 체력이 `hurt.homing`(엑스퍼트 30)만큼 줄고, 맞은 뒤 그 탄이 `shots`에서 빠진다.
  - `유도탄: 수명 뒤에는 맞지 않고 lifeMs+fadeMs에 null` — 커서를 탄이 닿지 않는 곳에 두고 `born + lifeMs`까지 진행한 뒤 커서를 탄 위치로 옮겨도 `homing` 피격 없음. `born + lifeMs + fadeMs` tick 뒤 마지막 `coop:homing`이 `null`.
  - `유도탄: 대상 탈락 시 그 탄만 사라짐` — 한 사람 `outAt` 설정 후 tick → 그 사람 탄 없음, 다른 탄 남음.
  - `유도탄: 일시정지 shift는 시각을 밀고 위치는 그대로` — 비행 중 `shift(5000)` 뒤 `homing.at`, `t`, 각 `born`이 5000 늘고, `tick(t+5000)`에서 이동 거리 0.
  - `유도탄: 보호막 단계·탄막 지우기·dispose는 지운다` — 각각 뒤 `state().homing === null`, 앞 두 경우 `coop:homing null` 전송.
  - `유도탄: 방어막은 막고 탄도 사라진다, 무적이면 탄은 계속` — `coopFx.guardUntil` 설정 시 `blocked: true` 피격과 탄 제거. `immuneUntil` 미래면 피격 없음, 탄 유지.

- [ ] **Step 2: 실패 확인** — `npm test` 중 `유도탄:` 테스트 FAIL.

- [ ] **Step 3: 구현** (`server/src/coop.ts`)
  - 필드 `private homing: Homing | null = null; private homingSentAt = 0;`
  - `useSkill`: `k === 'homing'`이면 `crush`와 같은 조건(엑스퍼트 아님 또는 1단계)에서 return. `this.homing`이 이미 있으면 return. `{ warnAt: now, at: now + warnMs, t: now, phase, targets: alive().map(id), shots: [] }` 만들고 emit.
  - `tick`의 `tickBeam` 다음에 `this.tickHoming(now); if (!this.boss) return;`
  - `tickHoming(now)`:
    - 예고 중이면 return.
    - 발사 전(`shots` 비고 아직 발사 안 함)이면 `targets` 중 살아 있는 사람마다 `circlePos(this.boss, at)`에서 커서 방향(커서 없으면 아래 `π/2`)으로 `HomingShot` 생성(`id: host.nextId()`, `born: at`), `t = at`, emit. 발사 여부는 `t >= at`으로 구분한다.
    - 비행: `dt = now − t`. 탄마다
      - 대상이 살아 있지 않으면 제거.
      - `now ≥ born + lifeMs + fadeMs`면 제거.
      - `steerHoming(shot, cursor, speed, turnRad, dt)`로 이동. `now < born + lifeMs`이고 커서가 있고 `homingHits(이전, 다음, cursor, r)`이면 `damage(p, 'homing', now)`. true면 제거.
      - 필드(`FIELD`) 밖으로 `r` 넘게 나가면 제거.
      - 판이 끝나면(`!this.boss || this.homing !== h`) 즉시 return.
    - `t = now`. 탄이 모두 사라지면 `homing = null`, emit `null`. 아니면 `now − homingSentAt ≥ sendMs`이거나 탄 수가 바뀌었을 때 emit.
  - `clearSlamsSafe`, `clearShots`(탄막 지우기 아이템), `dispose`에서 `homing = null`(앞 둘은 emit `null`).
  - `shift`: `warnAt`, `at`, `t`, 각 `born` += delta, 있으면 emit.
  - `state()`: `homing: this.homing ? 깊은 복사 : null`.

- [ ] **Step 4: 통과 확인** — `npm test` 전체 PASS, `npm run typecheck` PASS.

- [ ] **Step 5: 커밋**
  ```bash
  git add shared/src shared/test server/src/coop.ts
  git commit -m "feat: 협력전 엑스퍼트 유도탄 패턴 추가"
  ```

---

### Task 3: 화면 수신·그리기

**Files:**
- Modify: `client/src/main.ts` (수신, 배너, 초기화, 렌더 상태 전달, 피격 문구)
- Modify: `client/src/render.ts` (`homing` 상태 필드, `drawHoming`)

**Interfaces:**
- Consumes: `Homing`, `homingRule`, `homingAlpha`, `RULES.coop.homing`, `'coop:homing'`, `CoopState.homing`.

- [ ] **Step 1: 수신**
  - `let coopHoming: Homing | null = null;`
  - `socket.on('coop:homing', d => …)`: 새로 생긴 예고면 배너 `'유도탄! 멈추지 말고 움직이세요'`(`#ff5d73`)와 `sfx.patternWarn()`.
  - `coop:state`에 `homing`이 오면 그 값으로 바꾼다(재접속·재개).
  - `coopSeal = null`을 하는 두 초기화 줄(약 535, 1185행)에 `coopHoming = null` 추가.
  - 피격 문구(약 723행)에 `by === 'homing' ? '유도탄'` 추가.
  - 렌더 상태에 `homing: rules.coop ? coopHoming : undefined`.

- [ ] **Step 2: 그리기** (`render.ts`, `drawBeam` 다음 순서로 호출)
  - 예고(`t < at`): 대상마다 보스 위치에서 대상 커서 쪽으로 점선과 대상 플레이어 색 고리. 경고 진행률만큼 고리를 채운다.
  - 비행: 탄마다 `min(now − homing.t, 120ms)`만큼 현재 `angle`로 외삽한 위치에 반지름 `r` 원. 색은 대상 플레이어 색, 바깥 붉은 테두리. 투명도는 `homingAlpha`. 효과 줄이기가 꺼져 있으면 짧은 꼬리 잔상.
  - 일시정지 화면(`viewNow`)에서는 외삽하지 않는다.

- [ ] **Step 3: 검증** — `npm run typecheck`, `npm run build` PASS. `npm test` 전체 PASS.

- [ ] **Step 4: 커밋**
  ```bash
  git add client/src/main.ts client/src/render.ts
  git commit -m "feat(client): 협력전 유도탄 예고·비행 연출"
  ```

---

### Task 4: 문서 정리

**Files:**
- Modify: `docs/HANDOFF.md` (엑스퍼트 단계별 난이도 아래 '유도탄' 절. 구상 단계 문단에서 추적탄 문장 제거)
- Modify: `docs/ROADMAP.md` (다음 후보를 우클릭 보호막으로)
- Modify: `docs/superpowers/specs/2026-11-18-coop-homing-design.md` (상태: 구현 완료)

- [ ] **Step 1: 문서 갱신** — 동작, 수치 표, 주요 코드 위치, 실제 플레이 확인 항목(속도·선회 체감, 멀티플레이 동시 추격, 일시정지·재접속).
- [ ] **Step 2: 커밋**
  ```bash
  git add docs
  git commit -m "docs: 협력전 유도탄 인수인계 정리"
  ```
