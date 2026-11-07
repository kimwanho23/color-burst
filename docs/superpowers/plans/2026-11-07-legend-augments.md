# 레전드 상향·새 증강 10개 (3-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레전드를 "뽑으면 판이 바뀌는" 등급으로 올리고(수치 에픽 ×2 + 증강마다 전용 효과), 약한 침착을 빼고 새 증강 10개를 더해 34개로 만든다.

**Architecture:** 레전드 여부는 `legendOf(picks)`(레전드로 한 번이라도 고른 능력 집합)로 판단한다. 수치·효과 판정은 shared(rules.ts `resolveClaim`·`startFever`·`addFever`·`bossHitInfo`, items.ts `applyItem`)에서 순수하게, 서버에서만 가능한 것(화면의 내 원 자동 획득, 보호막 무시, 자석 개수, 레이저 스턴 시간, 빗나간 클릭 보정)은 room.ts에서. 클라이언트는 아이콘·빗나감 예측·도감만.

**Tech Stack:** TypeScript, npm workspaces, Socket.IO, node:test + tsx

**Spec:** `docs/superpowers/specs/2026-11-07-impact-zones-comeback-design.md` (3차 → 3-2)

## Global Constraints

- 커밋 `<타입>(<범위>): <한국어 요약>`, 한 목적 한 커밋, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 수치만 바꾸는 커밋은 `balance`
- 증강 수치·레전드 효과 수치는 `arcade.ts`에만 (`LEGEND` 상수)
- **작업 순서 (사용자 지시): 전부 구현 → 테스트 한꺼번에 → 브라우저 확인 → 목적별 커밋**
- 레전드 효과는 그 능력을 레전드로 한 번이라도 고르면 붙고, 여러 번 골라도 한 번
- 브랜치: 3-1 브랜치(`feat/comeback-picks`) 위에서 `feat/legend-augments`

## Review Focus

1. **레전드 효과끼리·특별 카드와 겹침** — 보험 레전드(피버 안 깎임)+견제, 반사 무제한+반격 전문가 레전드, 기세+리바운드(콤보가 안 끊기면 리바운드도 안 켜짐). 테스트: Task 2 각 효과 테스트에 겹침 1개씩
2. **헛손질 보정이 다른 사람이 끌고 있는 원·보호 구역 원·보스·아이템·황금 원을 잡음** — 내 일반 원(isMine)만, 끌리는 원·보호 구역 제외. 테스트: Task 3 `헛손질 보정은 내 원만`
3. **점화·사냥꾼 레전드·연쇄 콤보가 연쇄로 서로 부름** — 자동 획득한 원은 'blast'라 다시 연쇄하지 않음. 테스트: Task 3 `자동 획득은 다시 연쇄하지 않음`
4. **과충전 레전드 게이지가 피버가 끝난 뒤 언제 차는지** — 피버가 끝난 다음 틱(서버)에 50%가 채워지고 화면에 보임. 테스트: Task 3 `과충전 레전드: 피버가 끝나면 50%`
5. **침착 삭제 후 기존 방** — 침착을 가진 상태로 진행 중인 게임은 없다(서버 재시작으로 방이 사라짐). 남은 참조가 없는지 타입 검사로 확인

---

### Task 1: 수치·침착 삭제·새 증강 정의 (arcade.ts, icons.ts)

- 레전드 값 = 에픽 × 2 (상한 그대로): picky 6, yellowTaste 6, rainbowHunt 18, comboArtist 6, headStart 30, jackpot 30, edge 3, overtime 6, overcharge 90, frenzy 3, afterglow 6, hammer 6, hunter 60, shield 6, plunder 4, counterPro 12, reflect 6, jammer 3000, wideHand 70, magnet 240(상한 200 → 240). 예열·보험·철면피·파쇄는 이미 상한이라 그대로
- `calm` 삭제 (AbilityId, ABILITIES, `PlayerState.calmLeft`, `resolveMiss`의 침착, room의 exclude, icons, buffs 테스트)
- 새 증강 10개 (id, 분류, values, cap, desc):
  - missSave 헛손질 보정 보조 [40, 60, 80, 120] cap 160 `빈 곳을 클릭하면 반경 ${v} 안의 가장 가까운 내 원을 대신 잡음`. `ASSIST_ABILITIES`에 추가(봇 안 고름)
  - rebound 리바운드 유지 [30, 50, 70, 120] cap 200 `콤보가 끊긴 뒤 3초 동안 점수 +${v}%`
  - rapid 속사 점수 [1, 2, 3, 6] cap 12 `0.4초 안에 연달아 잡으면 두 번째부터 +${v}점`
  - laserProof 레이저 내성 유지 [25, 40, 60, 100] cap 100 `레이저 스턴 시간 −${v}%` (100이면 '레이저에 스턴되지 않음')
  - collector 수집가 보조 [20, 40, 60, 100] cap 200 `아이템 효과 시간 +${v}%`
  - chainCombo 연쇄 콤보 점수 [1, 1, 2, 3] cap 5 `10콤보마다 근처(반경 150) 내 원 ${v}개 자동 획득`
  - centerKing 중앙의 왕 점수 [30, 50, 70, 120] cap 200 `중앙 구역 원 점수 +${v}%`
  - ignite 점화 피버 [1, 2, 3, 5] cap 10 `피버가 터질 때 화면의 내 원 ${v}개 자동 획득`
  - vanguard 선봉 보스 [5, 10, 15, 25] `보스에게 첫 타를 넣으면 +${v}`
  - taunt 도발 견제 [5, 10, 15, 25] cap 50 `견제하면 상대 피버 게이지 −${v}%`
- `LEGEND` 상수(arcade.ts): `{ hammerChance: 0.15, hammerDmg: 3, comboBonusAdd: 10, headStartMs: 10_000, headStartMult: 1.5, jackpotMults: [2, 3, 5], preheatMult: 2, overtimeMs: 100, overchargeKeep: 50, afterglowMult: 2, shieldDrain: 3, plunderTopMult: 2, jammerSlowMs: 2_000, wideHandMult: 1.5, magnetPerSec: 4, missSaveMult: 1.5, rapidStreak: 5, laserFever: 20, collectorUp: 0.5, chainEvery: 5, comboAdd: 1 }` 와 새 증강 수치 `AUG = { reboundMs: 3_000, rapidMs: 400, chainEvery: 10, chainR: 150, vanguardMs: 3_000 }`
- `legendOf(picks): Set<AbilityId>`, `hasLegend(p, id)`
- 레전드 효과 설명: `AbilityDef.legend?: string` — 카드·도감에 "레전드: …" 줄 (각 증강에 설계서 표의 문장)
- icons: 새 10개 아이콘 (아직 안 쓴 lucide)

### Task 2: 레전드 효과 (shared)

| 증강 | 위치 | 구현 |
|---|---|---|
| 편식가 | resolveClaim 내 색 분기 | 피버 충전량 ×2 |
| 노란 맛 | 노란 분기 | 피버 충전량을 `RULES.fever.own`으로 |
| 무지개 사냥 | 무지개 분기 | 피버가 아니면 바로 `startFever`, `feverStarted = true` |
| 콤보 장인 | 콤보 보너스 | +5 → +15 |
| 출발 신호 | `extraMult` | `PlayerState.roundBegin`(startRound의 startAt, shiftTimes 대상) 뒤 10초 ×1.5 |
| 잭팟 | `jackpotMult(m, rand, legend)` | 배율 [2, 3, 5] (확률 70/25/5 그대로) |
| 찰나의 순간 | resolveClaim | 가장자리(zone 2)에서 일반으로 잡으면 콤보 +1 더 |
| 예열 | startRound/startFever | `PlayerState.firstFever` 플래그, 첫 피버 때 `feverBonus = 2` (feverMultOf에 더함, 피버가 끝나면 0) |
| 연장전 | resolveClaim | 피버 중 일반으로 잡을 때마다 `feverUntil += 100` |
| 과충전 | startFever + `settleFever(p, now)` | 피버 시작 때 `feverCarry = 50`, 피버가 끝난 뒤 처음 `settleFever`에서 게이지에 더함. resolveClaim 처음과 서버 틱에서 호출 |
| 폭주 | 콤보 보너스 | 피버 중이면 보너스 ×2 |
| 여운 | resolveClaim·bossMult | 여운 배율 1.5 → 2 (`afterMultOf(p)`) |
| 해머 | bossHitInfo | 15% 확률로 피해 3 (`max`) |
| 보험 | addFever | 음수 변화 무시 |
| 방패 | 견제 분기 | 견제당한 사람이 방패 레전드면 견제한 사람 점수 3을 가져옴 (`res.drainedBy` 기록) |
| 철면피 | 견제 분기 | 견제한 사람의 피버 감소 없음 |
| 강탈 | 견제 분기 | 대상이 1등(동점 포함)이면 강탈량 ×2 |
| 반격 전문가 | 반격 분기 | 상대(표적) 콤보도 끊음 (`brokeComboOf`) |
| 견제 반사 | 반사 조건 | 횟수 무시, 차감 안 함 |
| 방해 전파 | addFever 피버 시작 | 다른 사람(철벽 제외)에게 감도 감소 2초 |
| 넓은 손 | resolveClaim | via 'range'면 ×1.5 |
| 헛손질 보정 | resolveClaim | via 'save'면 ×1.5 (`ClaimVia`에 'save') |

- 새 증강 중 shared에서 하는 것: 리바운드(`breakCombo`가 실제로 줄이면 `reboundUntil = now + 3000`, `reboundLost`; resolveClaim에서 창 안이면 ×(1 + v/100), 레전드면 창 안 첫 획득에 `combo += floor(lost/2)` 한 번), 속사(`lastClaimAt`·`rapidStreak`, 0.4초 안이면 streak+1, 2 이상이면 +v점; 레전드 streak 5에 `rapidJackpot = true` → 다음 잭팟 굴림을 확정), 수집가(applyItem 시간 ×(1 + v/100)), 중앙의 왕(zoneMult 중앙 ×(1 + v/100), 레전드 중앙 콤보 +1 더), 도발(견제 분기: 대상 피버 게이지 −v%, 레전드면 피버 중인 대상 `feverUntil −= 1000`)
- 새 `PlayerState` 필드는 newPlayer·startRound에서 초기화: `roundBegin, firstFever, feverBonus, feverCarry, reboundUntil, reboundLost, reboundUsed, lastClaimAt, rapidStreak, rapidJackpot`

**테스트 (구현 후, `shared/test/legend.test.ts`):** 표의 효과마다 1개 이상 + Review Focus 1의 겹침(보험 레전드 견제당한 사람 피버 그대로·반사 무제한 3번 연속·기세면 리바운드 안 켜짐) + legendOf(레전드 한 번이면 포함, 레어만이면 없음) + 수치 표(에픽×2) 스냅샷

### Task 3: 서버 (room.ts)

- 사냥꾼 레전드: 막타 때 화면의 내 원(보호 구역·끌림 제외)을 모두 'blast'로 잡음
- 파쇄 레전드: 방어형 보호막 무시
- 자석 레전드: `perSec` 4
- 선봉: 보스의 첫 타(아무도 안 때린 보스)면 +v (배율 적용 전 타격 점수에 더함), 레전드는 보스 `born` 3초 안 피해 ×2
- 헛손질 보정: 빈 곳 클릭(원 id 없음, 넓은 손으로도 못 잡음)이면 반경 v 안 가장 가까운 내 일반 원(isMine, 보호 구역·끌림 제외, 지연 보정 위치)을 via 'save'로 잡고 빈 곳 페널티 없음
- 레이저 내성: 스턴 시간 ×(1 − v/100), 0이면 스턴 없음(알림 없음). 레전드면 닿을 때 피버 +20(`addFever`, 한 레이저에 한 번)
- 수집가 레전드: 아이템 원 50% 확률로 한 등급 위 (아이템 사냥꾼과 겹치면 최대 전설)
- 연쇄 콤보: claim 뒤 콤보가 주기(10, 레전드 5)의 배수가 되면 위치 반경 150 안 가까운 내 원 v개를 'blast'로
- 점화: claim 결과 `feverStarted`면 화면의 내 원 v개(레전드 전부)를 가까운 순으로 'blast'로
- 서버 틱에서 모든 플레이어 `settleFever`
- 방패 레전드로 빼앗긴 점수는 `emitPlayers`로 반영

**테스트 (구현 후, room.test.ts):** `헛손질 보정은 내 원만`(남의 색·끌리는 원·보호 구역 원 제외, 페널티 없음) / `자동 획득은 다시 연쇄하지 않음`(점화+연쇄 콤보+연쇄 폭발 함께여도 claim 수 유한, 'blast'만) / `과충전 레전드: 피버가 끝나면 50%` / `사냥꾼 레전드 막타` / `파쇄 레전드 보호막 무시` / `레이저 내성 100이면 스턴 없음, 레전드는 피버 +20` / `선봉 첫 타 +v`

### Task 4: 클라이언트

- 카드: 레전드 등급 카드에 "레전드: {legend 문장}" 줄, 일반 등급 카드에도 작은 글씨로 "레전드면: …"
- 도감 증강 탭: 증강마다 레전드 효과 줄
- 빗나감 예측: 헛손질 보정이 있으면 반경 안 내 원이 있을 때 빗나감 표시·소리 없음
- 아이콘 10개

### Task 5: 테스트·확인·문서·커밋

- 테스트 작성·실행, typecheck, build. 브라우저: 선택 카드·도감에 레전드 문장 표시 확인 (테스트 데이터로 그려도 됨)
- README 능력 개수 34개, 로드맵 3.5단계 3-2 ✅, 설계서 상태
- 커밋: `balance(shared): 레전드 수치를 에픽 ×2로` / `feat(shared): 침착 삭제, 새 증강 10개 정의` / `feat(shared): 레전드 전용 효과` / `feat(server): 레전드·새 증강 서버 처리` / `feat(client): 레전드 효과 표시·새 증강 아이콘·헛손질 보정 예측` / `docs: 3-2 반영`
