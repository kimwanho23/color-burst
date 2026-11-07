# 증강 조합·빌드 가중치·대평등 (3-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정해진 증강을 모으면 추가 효과가 붙는 조합 8개, 빌드가 잡히도록 선택지에 가중치, 점수를 평균 쪽으로 절반 당기는 랜덤 이벤트 '대평등'을 넣는다.

**Architecture:** 조합 정의·판정(`combosOf`)·가중치는 arcade.ts, 조합 효과는 기존 계산 지점(feverMultOf·resolveClaim·bossHitInfo·breakCombo·magnet)에, 대평등은 events.ts. 서버는 이벤트 조건(라운드·한 게임 1번)만, 클라이언트는 진행도·완성 배너·도감 탭.

**Tech Stack:** TypeScript, npm workspaces, Socket.IO, node:test + tsx

**Spec:** `docs/superpowers/specs/2026-11-07-impact-zones-comeback-design.md` (3차 → 3-3)

## Global Constraints

- 커밋 규칙·`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, 조합·가중치 수치는 arcade.ts, 이벤트 수치는 events.ts `RANDOM_EVENT`
- **작업 순서: 전부 구현 → 테스트 한꺼번에 → 확인 → 목적별 커밋**
- 조합은 등급과 상관없이 해당 증강을 모두 가지면 완성. 같은 조합 효과는 한 번
- 가중치는 저주·특별 카드에는 적용 안 함
- 브랜치: `feat/legend-augments` 위에서 `feat/combos`

## Review Focus

1. **조합 효과 중복** — 같은 증강을 여러 번 골라도 조합 효과는 한 번. 테스트: Task 1 `combosOf`
2. **가중치가 이미 가진 증강만 계속 나오게 함** — 같은 분류 ×2·조합 ×3이어도 다른 증강이 나올 확률이 남음(0 아님), 선택지 3장은 서로 다름. 테스트: Task 1 `가중치: 다른 증강도 나옴`
3. **대평등이 3라운드 전·두 번째로 나옴** — 3라운드가 끝나기 전에는 후보에서 빠지고, 한 게임 1번. 테스트: Task 2
4. **대평등 반올림·음수** — 점수 합이 크게 바뀌지 않고(반올림 차이만), 음수 점수도 평균 쪽으로. 테스트: Task 2
5. **철옹성 + 기세·보험** — 끊김을 막을 때 횟수만 쓰고, 기세로 이미 안 끊기면 횟수를 안 씀. 테스트: Task 1

---

### Task 1: 조합·가중치 (shared)

- `COMBOS` (arcade.ts): `{ id, name, needs: AbilityId[], text }` 8개
  - feverMaster 피버 마스터 [preheat, overtime, frenzy] 피버 배율 +1
  - comboMachine 콤보 머신 [comboArtist, insurance] 콤보 보너스 +5
  - bossHunter 보스 헌터 [hammer, hunter, crusher] 보스에게 주는 피해 +1
  - stealKing 견제왕 [plunder, counterPro, thickSkin] 견제할 때마다 +2 (steal·feverSteal·counter)
  - lucky 행운아 [jackpot, rainbowHunt] 잭팟 확률 +10%
  - outskirts 변두리 [edge, magnet] 커서가 가장자리 구역이면 자석 범위 ×1.5
  - gourmet 미식가 [picky, yellowTaste] 편식가의 노란색 −1 대가 없음
  - ironWall 철옹성 [shield, insurance, rebound] 라운드마다 한 번 콤보 끊김을 막음
- `COMBO = { feverAdd: 1, comboBonusAdd: 5, bossDmgAdd: 1, stealAdd: 2, jackpotAdd: 10, outskirtsMult: 1.5, ironPerRound: 1 }`
- `combosOf(picks): Set<ComboId>`, `comboProgress(picks): { id, have, need }[]` (하나 이상 가진 조합만)
- 효과 연결: feverMultOf +1 / 콤보 보너스 +5 / bossHitInfo 피해 +1 / resolveClaim 견제 계열 pts +2 / 잭팟 확률 +10 (`jackpotMult`에 넘기는 m.jackpot에 더함, 보스도) / `magnetOf(p, now, cursor?)` 가장자리면 ×1.5 (상한 무시하지 않음: 상한 240 × 1.5까지) / 노란 분기 picky 대가 없음 / `PlayerState.ironLeft`(startRound에서 철옹성이면 1), breakCombo가 실제로 줄이기 직전에 ironLeft > 0이면 쓰고 막음 (기세·콤보 고정으로 이미 안 끊기면 안 씀)
- 가중치: `RollOpts.owned?: readonly Pick[]` — 일반 풀에서 고를 때 무게 = 1 × (가진 증강과 같은 분류면 `WEIGHT.sameCat` 2) × (가진 증강이 1개 이상 들어 있고 아직 완성 안 된 조합의 나머지면 `WEIGHT.comboPart` 3). 무게 비례로 하나씩 뽑고 뽑은 것은 풀에서 뺀다(중복 없음)

**테스트 (구현 후, `shared/test/combos.test.ts`):** combosOf(완성·미완성·여러 번 골라도 한 번) / comboProgress / 각 조합 효과 1개씩 / 철옹성(라운드에 한 번만 막음, 기세면 안 씀) / 가중치: owned에 피버 2개면 1000번 중 피버 분류 비율이 균등(약 6/34)보다 확실히 높고, 다른 분류도 나옴 / 3장 서로 다름

### Task 2: 대평등 (events.ts, room.ts)

- `EventId`에 `'equality'`, `EVENTS.equality = { name: '대평등' }`, `RANDOM_EVENT.equalityFrom = 3`(이 라운드가 끝난 뒤부터)
- `rollEvent(players, used, rand, chance, ctx?: { round: number; usedIds: ReadonlySet<EventId> })` — ctx가 있으면 `round < equalityFrom`이거나 이미 쓴 대평등은 후보에서 뺀다
- `applyEvent('equality')`: 평균 avg, 각자 `delta = Math.round((avg − score) / 2)`, text "모두의 점수가 평균 쪽으로 절반 움직였어요"
- 서버: `eventsUsedIds: Set<EventId>`(게임 시작 때 비움), rollEvent에 ctx 전달, 일어난 이벤트 id 기록
- 클라이언트: 이벤트 아이콘(lucide `Scale`)

**테스트:** applyEvent equality [1000, 200] → [800, 400], [100, −50, 10] 평균 쪽 / rollEvent: round 2면 안 나옴, usedIds에 있으면 안 나옴, round 3이면 나올 수 있음(난수 고정)

### Task 3: 클라이언트

- 선택 화면 "내 능력" 아래 조합 진행: 하나 이상 가진 조합만 "피버 마스터 2/3 · 피버 배율 +1", 완성은 금색 "완성"
- 카드: 이 카드를 고르면 완성되는 조합이 있으면 "조합 완성: 피버 마스터" 띠
- 게임 중이 아닌 선택 직후 완성되면 배너 "조합 완성! 피버 마스터"(내 것만, players 갱신으로 감지)
- 도감 '조합' 탭 8개, 가중치 안내 문장 ("가진 증강과 같은 분류·조합 조각이 더 자주 나와요")
- 클라이언트 자석 범위 표시에 변두리 반영

### Task 4: 테스트·확인·문서·커밋

- 테스트·typecheck·build, 브라우저(선택 화면 조합 진행·카드 띠·도감 탭을 테스트 데이터로)
- README·로드맵 3-3 ✅·설계서 "3차 구현 완료"
- 커밋: `feat(shared): 증강 조합 8개와 빌드 가중치` / `feat: 랜덤 이벤트 대평등` / `feat(client): 조합 진행·완성 표시·도감 조합 탭` / `docs: 3-3 반영`
