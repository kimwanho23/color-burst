# 타격감·레이저·도감 (1차) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보스 처치·피버·아이템 획득을 더 크게 보이게 하고, 레이저를 굵은 여러 줄 탄막으로 바꾸고(카오스는 2초마다), 증강 중첩 표시와 도감을 넣는다.

**Architecture:** 레이저는 "한 번에 같이 쏘는 여러 줄" = `LaserVolley`로 바꾸고, 서버가 동시에 여러 볼리를 들고 판정한다. 수치·도형 생성·스턴 무적 판정은 shared(순수 함수, 테스트), 서버는 예약·판정, 클라이언트는 그리기만. 연출(히트스톱·흔들림·배너·알림·피버)은 클라이언트 전용이라 수치는 render.ts 상수에 둔다.

**Tech Stack:** TypeScript, npm workspaces (shared/server/client), Socket.IO, Canvas 2D, node:test + tsx

**Spec:** `docs/superpowers/specs/2026-11-07-impact-zones-comeback-design.md` (1차 섹션)

## Global Constraints

- 커밋: Conventional Commits `<타입>(<범위>): <한국어 요약>`, 수치 조정은 `balance`, 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`에서만 (화면 연출 수치는 클라이언트 상수)
- 커밋 전에 `npm run typecheck`, `npm run build`, `npm test` 통과
- 빔 폭은 화면 높이의 약 30%: `RULES.laser.width` 18 → 135 (판정은 중심선에서 135 이내 = 빔 폭 270), 경고 1초 → 1.2초
- 스턴이 끝난 뒤 1초 동안 레이저 스턴 무적
- 카오스: 2초마다 최소 1볼리, 겹쳐 나올 수 있음
- 설정 '화면 효과 줄이기'(`.reduce-fx`, renderer `reduceMotion`)면 히트스톱·흔들림·피버 움직임 없음
- 구현 후 커밋 (계획 문서만 따로 커밋하지 않음), 푸시·병합·버전은 사용자가 말할 때만

## Review Focus

1. **볼리 도중 일시정지·시간 정지** — 날아오던 모든 볼리의 발사 시각이 같이 밀려야 함(하나만 밀리면 재개 직후 예고 없이 맞음). 테스트: Task 2 `일시정지·시간 정지는 모든 볼리를 민다`
2. **한 볼리의 두 줄이 동시에 커서를 지남 / 겹친 두 볼리** — 스턴은 한 번, `stun` 알림도 한 번. 테스트: Task 2 `여러 줄·겹친 볼리에도 스턴은 한 번`
3. **저격으로 스턴 중인 사람이 레이저에 닿음** — 스턴이 늘어나지 않음(연속 스턴 방지). 테스트: Task 1 `canLaserStun`, Task 2 같은 테스트에 저격 스턴 경우 포함
4. **볼리 중 재접속** — 상태 스냅샷의 `lasers`로 예고 띠가 그대로 보임. 테스트: Task 2 `상태 스냅샷에 진행 중 볼리`
5. **카오스 판 시작·끝** — 2초 간격이라도 시작 3초·끝 1초 조용한 시간은 지킴. 테스트: Task 2 `카오스도 시작·끝 조용한 시간`

---

### Task 1: 레이저 규칙 (shared)

**Files:**
- Modify: `shared/src/rules.ts` (`RULES.laser`, `RULES.chaos`)
- Modify: `shared/src/cursor.ts` (`rollLaser` 옆에 볼리 함수, `nextLaserIn`)
- Modify: `shared/src/protocol.ts` (`LaserShot` → `LaserVolley`)
- Test: `shared/test/cursor.test.ts`, `shared/test/chaos.test.ts`

**Interfaces:**
- Produces:
  - `interface LaserVolley { lines: { a: Point; b: Point }[]; at: number }` (protocol.ts, `LaserShot` 대체)
  - `type VolleyKind = 'single' | 'parallel' | 'cross' | 'radial'`
  - `rollVolley(rand?: () => number): { kind: VolleyKind; lines: { a: Point; b: Point }[] }`
  - `volleyHits(cursor: Point, lines: readonly { a: Point; b: Point }[]): boolean`
  - `canLaserStun(p: PlayerState, now: number): boolean` = `now >= p.stunUntil + RULES.laser.immuneMs`
  - `nextLaserIn(rand?, chaos?)`: 카오스면 `rand() < quickChance ? quickMs : everyMs`

- [ ] **Step 1: 굵기·경고 시간 balance 커밋 (테스트 먼저)**

`cursor.test.ts`의 `laserHits: 18 안이면 맞음`을 바꾼다:
```ts
test('laserHits: 135 안이면 맞음 (빔 폭 270)', () => {
  const a = { x: 0, y: 100 }, b = { x: 1600, y: 100 };
  assert.equal(laserHits({ x: 800, y: 235 }, a, b), true);
  assert.equal(laserHits({ x: 800, y: 236 }, a, b), false);
  assert.equal(RULES.laser.warnMs, 1200);
});
```
Run: `npm test` → FAIL. `RULES.laser.width: 135`, `warnMs: 1_200` → PASS. 커밋 `balance(shared): 레이저 빔 폭 36→270, 경고 1.2초`

- [ ] **Step 2: 볼리·무적·카오스 간격 테스트 작성**

`cursor.test.ts`:
```ts
test('rollVolley: 확률 순서 single 40 / parallel 25 / cross 20 / radial 15', () => {
  const kind = (r: number) => rollVolley(seq([r, 0.5, 0.5, 0.5])).kind;
  assert.deepEqual([kind(0), kind(0.39), kind(0.4), kind(0.64), kind(0.65), kind(0.84), kind(0.85)],
    ['single', 'single', 'parallel', 'parallel', 'cross', 'cross', 'radial']);
});
test('rollVolley: 평행 두 줄 사이에 safeGap 틈', () => {
  const { lines } = rollVolley(seq([0.5, 0.5, 0.5, 0.5]));
  assert.equal(lines.length, 2);
  const d = distToSegment(lines[1].a, lines[0].a, lines[0].b); // 두 선분은 길이·중심이 같고 수직으로만 밀려 있어 끝점의 수선이 선분 안에 떨어진다
  assert.ok(Math.abs(d - (2 * RULES.laser.width + RULES.laser.safeGap)) < 1e-6);
});
test('rollVolley: X자는 한 점에서 수직, 방사는 3줄 60°', () => {
  const cross = rollVolley(seq([0.7, 0.5, 0.5, 0.5])).lines;
  assert.equal(cross.length, 2);
  const ang = (l: { a: Point; b: Point }) => Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
  assert.ok(Math.abs(Math.abs(Math.cos(ang(cross[0]) - ang(cross[1])))) < 1e-9);
  assert.equal(rollVolley(seq([0.9, 0.5, 0.5, 0.5])).lines.length, 3);
});
test('volleyHits: 한 줄이라도 닿으면 true', () => {
  const lines = [{ a: { x: 0, y: 100 }, b: { x: 1600, y: 100 } }, { a: { x: 0, y: 800 }, b: { x: 1600, y: 800 } }];
  assert.equal(volleyHits({ x: 5, y: 790 }, lines), true);
  assert.equal(volleyHits({ x: 5, y: 450 }, lines), false);
});
test('canLaserStun: 스턴 중·스턴 끝나고 1초 안에는 안 됨', () => {
  const p = newPlayer('a', 'a', 0); const now = 1_000_000;
  assert.equal(canLaserStun(p, now), true);
  p.stunUntil = now + 500; assert.equal(canLaserStun(p, now), false);
  p.stunUntil = now - 999; assert.equal(canLaserStun(p, now), false);
  p.stunUntil = now - 1000; assert.equal(canLaserStun(p, now), true);
});
```
(`seq(values)`는 순서대로 값을 돌려주는 테스트 도우미, 파일 안에 정의. `Point` 타입 import 추가)

`chaos.test.ts`의 `nextLaserIn(() => 0, true) === 5000`을 바꾼다:
```ts
assert.equal(nextLaserIn(() => 0, true), 600);    // 35% 확률로 0.6초 뒤 겹쳐서
assert.equal(nextLaserIn(() => 0.5, true), 2000); // 아니면 2초마다
```

- [ ] **Step 3: 실패 확인** — Run: `npm test` → FAIL (`rollVolley` 없음 등)

- [ ] **Step 4: 구현**
  - `RULES.laser`에 `immuneMs: 1_000`, `safeGap: 160`, `volleyOdds: { single: 40, parallel: 25, cross: 20, radial: 15 }`
  - `RULES.chaos`에서 `laserIntervalMult` 삭제, `laserEveryMs: 2_000, laserQuickChance: 0.35, laserQuickMs: 600` 추가 (주석: 카오스 레이저는 2초마다, 35% 확률로 0.6초 뒤 한 번 더 겹침)
  - `rollVolley`: 첫 `rand()`로 종류, 중심점·각도는 `rollLaser`와 같은 방식(중심 x 200~1400, y 150~750, 길이 4000). parallel = 중심에서 수직 방향 ±(2·width+safeGap)/2 두 줄, cross = 같은 중심 수직 두 줄, radial = 같은 중심 60° 간격 세 줄. `rollLaser`는 single 생성에 재사용
  - `LaserShot`을 쓰던 곳의 타입 이름은 Task 2에서 바꾼다 (이 Task에서는 protocol에 `LaserVolley`만 추가하고 `LaserShot`은 Task 2에서 삭제)
- [ ] **Step 5: 통과 확인** — Run: `npm test` → PASS, `npm run typecheck` → 0 오류
- [ ] **Step 6: 커밋** `feat(shared): 레이저 여러 줄 볼리·스턴 뒤 무적·카오스 2초 간격 규칙`

### Task 2: 서버 볼리 판정 + 클라이언트 레이저 그리기

**Files:**
- Modify: `server/src/room.ts` (`laser` → `lasers`, `updateLaser`, 일시정지·시간 정지 이동, 스냅샷)
- Modify: `shared/src/protocol.ts` (`LaserShot` 삭제, 상태 `lasers: LaserVolley[]`, `'laser:warn': (d: LaserVolley) => void`)
- Modify: `client/src/main.ts` (`laser` → `lasers` 배열, 발사 효과음 볼리마다), `client/src/render.ts` (`DrawState.lasers`, `drawLaser`)
- Test: `shared/test/room.test.ts` (`Priv.laser` → `lasers`, 기존 레이저·시간 정지 테스트 갱신)

**Interfaces:**
- Consumes: Task 1의 `LaserVolley`, `rollVolley`, `volleyHits`, `canLaserStun`, `nextLaserIn`
- Produces: room 필드 `lasers: (LaserVolley & { hit: Set<string> })[]`, 스냅샷 `lasers: LaserVolley[]`

- [ ] **Step 1: 방 테스트 작성** (`room.test.ts`, 기존 1단계 레이저 테스트를 `lasers: [{ lines: [{a,b}], at, hit }]` 꼴로 고치고 아래 추가)
  - `여러 줄·겹친 볼리에도 스턴은 한 번`: 커서 (800,300). 볼리 A 두 줄(y=300, x=800 세로), 볼리 B 한 줄(y=300) 둘 다 `at: now-10` → `updateLaser(now)` 뒤 `sent.filter(e=>e==='stun').length === 1`, `stunUntil ≈ now+1500`. 이어서 `me.stunUntil = now + 2000`(저격 스턴 흉내)인 다른 플레이어도 같은 줄 위 → `stunUntil` 그대로
  - `일시정지·시간 정지는 모든 볼리를 민다`: 볼리 두 개(`at` 서로 다름) → 일시정지 2초 후 재개하면 둘 다 `at + 2000`; 시간 정지 아이템이면 아직 안 쏜 볼리만 `+ freezeMs`
  - `상태 스냅샷에 진행 중 볼리`: `lasers` 하나 넣고 스냅샷(상태를 만드는 메서드, 기존 `pulls`·`laser`가 들어가는 곳)의 `lasers.length === 1`, `hit` 필드는 없음
  - `카오스도 시작·끝 조용한 시간`: 카오스 방, `startAt` 기준 경과 1초에 `updateLaser` → 볼리 없음; 끝까지 1초 남았을 때도 없음; 경과 5초면 하나 생기고 `nextLaserAt - 경과 ∈ {600, 2000}`
- [ ] **Step 2: 실패 확인** — Run: `npm test` → FAIL
- [ ] **Step 3: 서버 구현** — `updateLaser(now)`:
  1. 예약 시각이 됐고 조용한 시간·시간 정지가 아니면 `rollVolley()`로 새 볼리를 `at: now + warnMs`로 추가, `laser:warn` 알림, `nextLaserAt = 경과 + nextLaserIn(rand, chaos)` (이제 예약은 "쏜 뒤"가 아니라 "예고한 뒤"부터 센다. 일반 모드 10~15초라 체감 차이 없음)
  2. 각 볼리: `now < at` 건너뜀, `now ≥ at + fireMs` 제거, 아니면 봇 아님·`hit`에 없음·최신 커서·`volleyHits`·`canLaserStun` 모두 맞는 사람만 스턴 + `hit` 추가 + `stun` 알림
  - 일시정지 재개(기존 `this.laser.at += delta` 자리)와 시간 정지(기존 `freezeMs` 자리)는 배열 전체에 적용
- [ ] **Step 4: 클라이언트 구현**
  - main.ts: `lasers: LaserVolley[]`, `laser:warn`이면 push + 발사 시각에 `sfx.laserFire()` 타이머(볼리마다), 매 프레임 `at + fireMs` 지난 것 제거, 상태 스냅샷이면 통째로 교체
  - render.ts `drawLaser(v)`: 예고 중에는 줄마다 폭 `width*2` 반투명 붉은 띠(알파 0.10~0.22 맥동) + 가운데 점선, 발사 중에는 지금처럼 붉은 띠 + 흰 심(심 굵기 5 → 14)
- [ ] **Step 5: 통과 확인** — `npm test` PASS, `npm run typecheck` 0, `npm run build` 성공
- [ ] **Step 6: 브라우저 확인** — 카오스로 혼자 하기: 2초마다 띠 예고 → 발사, 가끔 겹침, 평행 두 줄 사이 틈이 보이고 커서를 넣으면 안 맞음
- [ ] **Step 7: 커밋** `feat: 레이저를 굵은 여러 줄 볼리로, 카오스는 2초마다`

### Task 3: 보스 처치·아이템 획득·피버 연출

**Files:**
- Modify: `client/src/render.ts` (히트스톱, 흔들림 세기, 배너, 파편 배율)
- Modify: `client/src/main.ts` (`boss:killed`, `item:got`, 피버 중 burst)
- Modify: `client/src/effectsUI.ts` (알림 줄, 칩 아이콘 팝)
- Modify: `client/index.html` (`#feed`), `client/src/style.css` (알림·팝·피버 테두리)

**Interfaces:**
- Produces (render.ts `Renderer`):
  - `hitstop(ms: number): void` — 그 시간 동안 원·보스 위치 계산에 쓰는 시각을 멈춘다(파티클·글자는 계속)
  - `shakeFor(sec: number, amp: number): void` — 기존 `miss`의 흔들림(0.15초, 8)도 이걸로
  - `banner(txt: string, col: string): void` — 화면 위쪽(y 230) 큰 글자(크기 2.2) 1.2초, 처음 0.15초 커지며 등장
  - `burst(x, y, col, big, scale = 1)` — 파편 수 × scale
- Produces (effectsUI.ts):
  - `pushFeed(el: HTMLElement, iconHtml: string, text: string, col: string): void` — 최대 3줄, 줄마다 1.2초 뒤 사라짐, 넘치면 오래된 줄부터 삭제
  - `popOnChip(scoresEl: HTMLElement, playerId: string, iconHtml: string): void` — `[data-id]` 칩 위치에 `position: fixed` 아이콘을 띄워 0.8초 동안 위로 떠오르며 사라짐 (점수판이 다시 그려져도 안 지워지게 body에 붙인다)
- 상수 (render.ts): `BOSS_HITSTOP_MS = 80`, `BOSS_SHAKE = { sec: 0.35, amp: 22 }`, `FEVER_BURST = 1.5`

- [ ] **Step 1: 구현**
  - `boss:killed`: `hitstop(80)` → `shakeFor(0.35, 22)` → 큰 파편 2번 + `shockwave(x, y, 260)` → `banner(\`${이름} 보스 처치! +${gained}\`, 처치한 사람 색)` (내가 잡았으면 '내가 보스 처치!'). 기존 막타 글자는 유지
  - `reduceMotion`이면 `hitstop`·`shakeFor`는 아무것도 안 함 (배너는 나옴)
  - `item:got`: 잡은 사람이 내가 아니면 `pushFeed(#feed, 아이템 아이콘, \`${이름}: ${아이템 이름}\`, 색)`, 누구든 `popOnChip(#scores, by, 아이템 아이콘)`
  - `circle:claimed`에서 잡은 사람이 피버 중이면 `burst(..., FEVER_BURST)`
  - CSS `#stage.feverOn`: 테두리를 주황→빨강 그라데이션으로 0.5초 주기 맥동(`@keyframes feverPulse`, 안쪽 그림자 세기 변화) + 배경 살짝 밝아짐. `.reduce-fx #stage.feverOn`과 `prefers-reduced-motion`이면 애니메이션 없이 지금 테두리만
  - `#feed`: 점수판 아래 가운데, 줄마다 아이콘 + 글자, 잡은 사람 색 왼쪽 막대
- [ ] **Step 2: 검사** — `npm run typecheck` 0, `npm run build` 성공, `npm test` PASS
- [ ] **Step 3: 브라우저 확인** — 혼자 하기에서 보스를 직접 처치: 멈칫 + 흔들림 + 배너. 봇이 아이템을 잡으면 위쪽 알림과 칩 위 아이콘. 피버 테두리 맥동. 설정에서 효과 줄이기를 켜면 멈칫·흔들림·맥동 없음
- [ ] **Step 4: 커밋** `feat(client): 보스 처치 타격감·아이템 획득 알림·피버 연출 강화`

### Task 4: 증강 중첩 표시와 도감

**Files:**
- Modify: `shared/src/arcade.ts` (`groupPicks`)
- Test: `shared/test/arcade.test.ts`
- Modify: `client/src/arcadeUI.ts` (`pickChips`가 묶어서 ×N)
- Create: `client/src/codex.ts` (도감 창)
- Modify: `client/index.html` (처음 화면·대기실에 '도감' 버튼, 도감 오버레이), `client/src/main.ts` (버튼 연결), `client/src/style.css`

**Interfaces:**
- Produces:
  - `groupPicks(picks: readonly Pick[]): { id: AbilityId; tier: Tier; count: number }[]` — 처음 고른 순서대로, tier는 그중 가장 높은 등급, count는 개수
  - `openCodex(host: HTMLElement): void` / 닫기는 버튼·`Esc`·바깥 클릭

- [ ] **Step 1: 테스트 작성** (`arcade.test.ts`)
```ts
test('groupPicks: 같은 증강은 하나로, 가장 높은 등급, 개수', () => {
  assert.deepEqual(groupPicks([{ id: 'hammer', tier: 0 }, { id: 'jackpot', tier: 1 }, { id: 'hammer', tier: 2 }]),
    [{ id: 'hammer', tier: 2, count: 2 }, { id: 'jackpot', tier: 1, count: 1 }]);
  assert.deepEqual(groupPicks([]), []);
});
```
- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: 구현**
  - `groupPicks` (arcade.ts), `buildSummary`도 이것을 쓰도록 정리
  - `pickChips`: 묶은 칩마다 아이콘 + `count > 1`이면 `<em>×N</em>`, title에 합친 수치 설명(`ABILITY[id].desc(modsOf(picks)[id])`)
  - `codex.ts`: 탭 4개 — **증강**(분류별, 등급 4칸 수치 `desc(values[t])`, 상한 있으면 "중첩 상한 N"), **저주**(보상/대가), **아이템**(등급별, 이름·설명, 방해 아이템 표시), **보스**(일반·방어형·공격형·이동형 한 줄 설명, 이동형은 오오라 포함). 맨 위 안내: "같은 증강을 또 고르면 수치가 더해져요 (중첩). 일부는 상한이 있어요"
  - 보스 설명 문구는 README '보스 종류' 줄을 따른다
- [ ] **Step 4: 통과 확인** — `npm test` PASS, typecheck 0, build 성공
- [ ] **Step 5: 브라우저 확인** — 처음 화면·대기실에서 도감 열고 탭 전환·닫기, 아케이드에서 같은 증강 두 번 고르면 점수판 칩에 ×2
- [ ] **Step 6: 커밋** `feat(client): 증강 중첩 표시와 도감 추가`

### Task 5: 문서

- [ ] README 기능 목록(레이저 볼리·카오스 2초, 도감, 연출), 로드맵에 1차 항목 ✅, 설계서 상태 "1차 구현 완료"
- [ ] 검사 후 커밋 `docs: 타격감·레이저·도감 1차 반영` (이 계획 문서도 함께)
