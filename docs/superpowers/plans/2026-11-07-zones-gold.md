# 점수 구역·황금 원 (2차) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 필드를 중앙·사이·가장자리 3구역(×1/×2/×3)으로 나눠 싸움을 바깥으로 넓히고, 빠르게 튕기는 고정 +20 황금 원과 가장자리 배율 증강 '찰나의 순간'을 넣는다.

**Architecture:** 구역 판정·배율·황금 원 위치/수명·등장 시점은 shared 순수 함수(테스트). 서버는 잡는 순간 원 위치로 구역을 구해 `resolveClaim`에 넘기고, 황금 원은 보스처럼 시점 큐로 내보내며 전용 처리(`claimGold`)로 점수를 준다. 클라이언트는 구역 타원·황금 원 그리기와 연출만.

**Tech Stack:** TypeScript, npm workspaces, Socket.IO, Canvas 2D, node:test + tsx

**Spec:** `docs/superpowers/specs/2026-11-07-impact-zones-comeback-design.md` (2차 섹션)

## Global Constraints

- 커밋: `<타입>(<범위>): <한국어 요약>`, 한 커밋 한 목적, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 규칙 수치는 `RULES`에만, 증강 수치는 `arcade.ts`의 `ABILITIES`에만
- **작업 순서 (사용자 지시): 모든 기능을 먼저 구현 → 아래 테스트를 한꺼번에 작성·실행 → 브라우저 확인 → 목적별 커밋.** 아래 단계의 "테스트"는 그때 쓴다
- 커밋 전에 `npm run typecheck`, `npm run build`, `npm test` 통과
- 푸시·병합·버전은 사용자가 말할 때만

## Review Focus

1. **자석으로 끌려온 원·폭죽으로 잡힌 원의 구역** — 화면에 보이는 위치가 아니라 서버의 원 위치(그 시각 `circlePos`)로 판정. 클라이언트 ×N 글자가 서버 결과(`result.zone`)를 그대로 쓰는지. 테스트: Task 2 `잡는 방법과 상관없이 원 위치로 구역`
2. **황금 원을 넓은 손·자석·장판·폭죽·필드 클리어가 건드림** — 안 잡히고 점수도 안 바뀜. 테스트: Task 3 `황금 원은 직접 클릭으로만`
3. **황금 원이 일시정지·시간 정지 중** — 수명(5초)이 멈춘 만큼 늘고, 일시정지 중 등장 시점이 지나가도 재개 후에 나옴. 테스트: Task 3 `황금 원 수명은 시간 정지만큼 늘어남`
4. **외길 저주 + 가장자리** — 0점 원은 ×3이어도 0, 피버·잭팟과 곱한 값이 정수로 반올림. 테스트: Task 1 `구역 배율은 다른 배율과 곱하고 0점은 그대로`
5. **봇이 황금 원을 다 가져감** — 봇 선호도는 무지개와 같은 6, 봇 반응 지연 그대로. 플레이 후 조정 (테스트 없음, 리뷰어 판단)

---

### Task 1: 구역·찰나의 순간 규칙 (shared)

**Files:** `shared/src/rules.ts`, `shared/src/arcade.ts`, `client/src/icons.ts`(새 증강 아이콘), Test `shared/test/zones.test.ts`(새 파일)

**Interfaces:**
- `RULES.zones = { bounds: [0.35, 0.7], mult: [1, 2, 3] }`
- `type ZoneIndex = 0 | 1 | 2`
- `zoneOf(p: { x: number; y: number }): ZoneIndex` — e = √(((x−800)/800)² + ((y−450)/450)²), `e < bounds[0]` → 0, `e < bounds[1]` → 1, 아니면 2
- `zoneMult(zone: ZoneIndex, m: Mods): number` — `RULES.zones.mult[zone] + (zone === 2 ? m.edge : 0)`
- `resolveClaim(..., opts: { via?, rand?, zone?: ZoneIndex })` — 기본 0. `mult`에 `zoneMult(zone, m)`을 곱한다 (강탈 점수 제외는 지금 구조 그대로)
- `ClaimResult.zone: ZoneIndex`
- 새 능력 `edge` '찰나의 순간', 분류 '점수', values `[0.5, 1, 1.5, 2.5]`, cap 4, desc `가장자리 점수 배율 +${v}`. `AbilityId`에 추가, 아이콘은 lucide `Maximize2`

**테스트 (구현 후 작성):**
```ts
test('zoneOf: 타원 0.35 / 0.7 경계', () => {
  assert.equal(zoneOf({ x: 800, y: 450 }), 0);
  assert.equal(zoneOf({ x: 800 + 0.34 * 800, y: 450 }), 0);
  assert.equal(zoneOf({ x: 800 + 0.35 * 800, y: 450 }), 1);
  assert.equal(zoneOf({ x: 800, y: 450 + 0.69 * 450 }), 1);
  assert.equal(zoneOf({ x: 800, y: 450 + 0.7 * 450 }), 2);
  assert.equal(zoneOf({ x: 0, y: 0 }), 2);
});
test('zoneMult: 1/2/3, 찰나의 순간은 가장자리만', () => {
  const m = modsOf([{ id: 'edge', tier: 3 }]);
  assert.deepEqual([0, 1, 2].map((z) => zoneMult(z as 0, m)), [1, 2, 5.5]);
  assert.equal(modsOf(Array(5).fill({ id: 'edge', tier: 3 })).edge, 4);
});
test('구역 배율은 다른 배율과 곱하고 0점은 그대로', () => {
  // 내 색 +3 가장자리 → 9, 피버(×3)면 27, 외길 노란 0점은 0
  // (resolveClaim으로 각각 확인: zone 2, 피버 상태 설정, oneWay 저주)
});
```
(세 번째 테스트는 기존 `balance.test.ts`·`buffs.test.ts`의 플레이어 준비 방식을 따라 assert 3개로 쓴다)

### Task 2: 서버·클라이언트 구역 적용

**Files:** `server/src/room.ts` (`claim`), `client/src/main.ts` (`circle:claimed` 글자), `client/src/render.ts` (구역 타원), Test `shared/test/room.test.ts`

- `room.claim(p, c, now, via)`: `const pos = circlePos(c, now)`를 먼저 구해 `resolveClaim(..., { via, zone: zoneOf(pos) })`, emit의 x, y도 같은 pos
- 클라이언트: 내가 잡은 원 글자에 `result.zone > 0`이면 ` ×${RULES.zones.mult[zone]}`(찰나의 순간 반영은 서버 gained로 충분, 글자는 구역 기본 배율만), 가장자리면 글자색 금색 계열 아닌 하늘색(`#7ee0ff`)으로 구분
- render.ts: 발사 보호 구역 점선 옆에 경계 두 개를 `ctx.ellipse(800, 450, 800·b, 450·b)`로 점선(알파 0.07, 가장자리 경계는 0.1), 효과 줄이기와 무관하게 표시

**테스트:** `잡는 방법과 상관없이 원 위치로 구역` — 가장자리(1500, 450)에 느린 내 색 원 → 클릭 claim → `me.score === 9` (3×3); 중앙 가까이(1000, 450 → e=0.25)에 → 3; 같은 가장자리 원을 `claim(p, c, now, 'blast', true)` 직접 호출해도 9

### Task 3: 황금 원

**Files:** `shared/src/rules.ts`, `server/src/room.ts`, `server/src/bot.ts`, `shared/src/protocol.ts`, `client/src/main.ts`, `client/src/render.ts`, `client/src/codex.ts`(보스 탭에 "황금 원" 한 줄 — 탭 이름은 그대로 두고 맨 아래), Test `shared/test/gold.test.ts`(새 파일), `shared/test/room.test.ts`

**Interfaces:**
- `RULES.gold = { r: 22, speed: 520, lifeSec: 5, points: 20, countOdds: [25, 50, 25], startMs: 3_000, endMs: 6_000 }`
- `CircleKind`에 `'gold'` 추가
- `circlePos`: `c.boss === 'runner' || c.kind === 'gold'`면 fold(튕김)
- `isOut`: 황금 원은 `traveled ≥ speed × lifeSec`이면 사라짐 (시간 정지 holds가 traveled에 반영되므로 자동으로 늘어남)
- `makeGold(id: number, now: number, rand?): Circle` — kind 'gold', 무작위 각도, r·speed는 RULES.gold (게임 속도 배율 안 받음)
- `goldTimes(roundMs: number, rand?): number[]` — 개수는 countOdds로 1~3, 각 시점은 `startMs ~ roundMs − endMs` 균등, 오름차순
- protocol: `'gold:got': (d: { circleId: number; by: string; gained: number; x: number; y: number }) => void`
- room: `goldQueue`(라운드 시작 때 `goldTimes(G.roundMs)`), 틱에서 보스 큐처럼(시간 정지 중엔 미룸) `makeGold`로 내보내고 `circle:spawn`(기존 원 생성 알림); 클릭·봇 분기에 `kind === 'gold'` → `claimGold(p, c, now)`: 원 삭제, `p.score += RULES.gold.points`, `gold:got` 알림, `emitPlayers`. `stats.hits`는 올리지 않음
- 다른 경로 제외: 넓은 손·장판·자석은 `isMine`이 'gold'에 false라 자동 제외. 폭죽·필드 클리어 루프(`o.kind === 'boss' || o.kind === 'item'`)에 `'gold'` 추가, 봇 자석 후보(`pickMagnetTargets`)도 isMine 기준이라 제외
- bot.ts: 선호도 `if (c.kind === 'gold') return 6;`
- 클라이언트: 클릭은 기존 일반 원 경로 그대로(pending). `gold:got`: 원 삭제, 금빛 파편 `burst(x, y, GOLD, true, 2)` + `jackpot` 없이, 내가 잡으면 `+20` 금색 큰 글자·`sfx.jackpot(2)`, 남이면 `pushFeed(..., '황금 원 +20')`·`popOnChip`
- render: `drawCircle`에 'gold' — 금색 방사 그라데이션 + 흰 반짝임 + 짧은 잔상 꼬리(직전 위치 3개 반투명), 렌즈 휨 그대로 적용

**테스트:**
```ts
test('makeGold·circlePos: 벽에서 튕겨 화면 안에 머묾', ...) // 30초 동안 0.1초 간격 위치가 [r, W−r]×[r, H−r] 안
test('isOut: 황금 원은 5초 뒤 사라짐', ...) // born+4999 false, born+5000 true
test('황금 원 수명은 시간 정지만큼 늘어남', ...) // holds [[born+1000, 1500]] → born+6000 false, born+6500 true
test('goldTimes: 1~3개, 3초 ~ 끝 6초 전, 오름차순', ...) // rand 0 → 1개, 0.5 → 2개, 0.99 → 3개, 모두 범위 안
test('황금 원은 직접 클릭으로만, +20 고정', ...) // room: 가장자리 황금 원, 피버·점수 2배 버프 중 클릭 → score +20, combo·fever 그대로; 넓은 손 범위 안·폭죽 범위 안이어도 안 잡힘
```

### Task 4: 문서와 커밋

- README(점수 구역, 황금 원, 찰나의 순간), 로드맵 3.5단계 2차 항목 ✅, 설계서 상태 "2차 구현 완료"
- 커밋 (목적별): `feat(shared): 점수 구역·찰나의 순간 규칙` / `feat: 점수 구역 배율 적용과 표시` / `feat: 황금 원 추가` / `docs: 점수 구역·황금 원 반영`
