# 증강 선택 구조·역전·특별 카드 (3-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아케이드 증강 선택을 "뒤로 갈수록 좋은 카드·두 장 선택"으로 바꾸고, 크게 뒤처진 꼴찌에게 역전 기회(방 인원 배율·특별 카드 12장·레전드)를 주며, 꼴찌 보정 방에서 넓은 손을 순위에 따라 보정한다.

**Architecture:** 선택지 규칙(노말 제외·꼴찌 보장·역전 판정·특별 카드 섞기·두 장 수)과 특별 카드 효과는 shared 순수 함수(테스트). 특별 카드는 저주처럼 `AbilityDef`(분류 '특별', `special`)로 넣어 고른 뒤 게임 끝까지 유지된다. 서버는 판정 시점·두 장 선택 흐름·서버에서만 할 수 있는 효과(하이에나·연쇄 폭발·판 뒤집기)를, 클라이언트는 두 장 선택 화면·특별 카드 모양·역전 표시를 맡는다.

**Tech Stack:** TypeScript, npm workspaces, Socket.IO, Canvas 2D/DOM, node:test + tsx

**Spec:** `docs/superpowers/specs/2026-11-07-impact-zones-comeback-design.md` (3차 → 3-1)

## Global Constraints

- 커밋 `<타입>(<범위>): <한국어 요약>`, 한 목적 한 커밋, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 규칙 수치는 `RULES`(rules.ts), 증강·특별 카드 수치는 `arcade.ts`에만
- **작업 순서 (사용자 지시): 모든 기능 구현 → 테스트를 한꺼번에 작성·실행 → 브라우저 확인 → 목적별 커밋** (단계마다 typecheck·build·test 통과 확인)
- 역전 기회 판정: 꼴찌 점수 < 1등 점수 × 0.6, 2·3·4라운드 끝에만 (1~2라운드 경기에는 없음)
- 방 인원 배율 2인 ×1.1 / 3인 ×1.2 / 4인 ×1.3 (봇 포함 인원)
- 특별 카드 효과는 고른 뒤 게임 끝까지(4·5라운드). 남의 점수를 깎지 않는다
- 넓은 손 순위 보정: 꼴찌 +20, 4인 방의 3등 +10, 상한 80, 방 규칙 '꼴찌 보정'이 켜진 방만
- 푸시·병합·버전은 사용자가 말할 때만

## Review Focus

1. **두 장 고르는 차례에 시간이 다 됨 / 한 장만 고르고 나감·재접속** — 남은 수만큼 무작위로 채워지고, 재접속하면 남은 카드와 "1/2"가 그대로 보임. 테스트: Task 3 `두 장 선택: 마감 때 남은 수만큼 무작위`, `재접속하면 남은 선택지를 다시 받음`
2. **꼴찌가 여럿(동점) / 모두 동점 / 1등 0점** — 동점 꼴찌는 모두 역전 판정 대상, 모두 동점이면 아무도 아님, 1등이 0점 이하면 역전 없음. 테스트: Task 1 `judgeComeback`
3. **역전 기회 중 꼴찌를 벗어났다가 다시 꼴찌가 됨** — 배율은 벗어나는 순간 꺼지고 그 라운드에는 다시 안 켜짐. 테스트: Task 2 `comebackMult`
4. **특별 카드 + 저주 + 이벤트 선물(4장)** — 특별 카드 1장은 저주로 덮이지 않고, 선물이면 4장 중 1장이 특별. 테스트: Task 1 `rollOptions: 역전 꼴찌 3번째 선택`
5. **봇이 역전 꼴찌** — 봇도 특별 카드를 받고(우선 고름) 두 장을 고름. 테스트: Task 3 `봇은 두 장을 고르고 특별 카드를 먼저`

---

### Task 1: 선택지 규칙 (shared/arcade.ts)

**Files:** `shared/src/arcade.ts`, `shared/src/rules.ts`(PlayerState), Test `shared/test/picks.test.ts`(새 파일)

**Interfaces (Produces):**
- `ARCADE.picksPerRound = [1, 1, 2, 2]` (선택 차례별 고를 수), `ARCADE.noNormalFrom = 1` (이 차례부터 모두 노말 제외), `ARCADE.lastGuarantee = [1, 2, 3, 3]` (꼴찌: 이 등급 이상이 1장 이상), `ARCADE.comeback = { ratio: 0.6, from: 1, specialAt: 2, legendAt: 3, roomMult: { 2: 1.1, 3: 1.2, 4: 1.3 } }` (from·specialAt·legendAt은 선택 차례 0부터)
- `AbilityCategory`에 `'특별'`, `AbilityDef.special?: true`
- `SPECIALS: readonly AbilityDef[]` 12장 (id·이름은 아래 표, values `[1,1,1,1]`, cap 1, desc는 효과 문장), `ALL_ABILITIES`에 포함, `isSpecial(id)`
- `PlayerState.comeback: boolean` (newPlayer·resetForRound에서 false)
- `judgeComeback(players: PlayerState[]): Set<string>` — 1등 점수 > 0이고 꼴찌(최저 점수, 모두 동점이면 없음) 점수 < 1등 × ratio인 꼴찌 id들
- `RollOpts`에 `minTier?: Tier`(이 등급 미만은 안 나옴), `guarantee?: Tier`(1장 이상 이 등급 이상, 없으면 무작위 1장을 그 등급으로), `special?: boolean`(1장을 무작위 특별 카드로 바꿈, 저주보다 나중에 끼워 저주가 덮지 않게, 저주와 다른 자리)
- `rollOptions` 호출부(서버)가 차례에 맞게 위 옵션을 넣는다 (Task 4). 기존 `lastPlace` 등급 확률 상향은 그대로

| id | 이름 | 효과(desc) |
|---|---|---|
| comebackBoost | 대역전 | 내 모든 점수 ×1.5 |
| flip | 판 뒤집기 | 라운드가 끝날 때 1등과의 점수 차의 20%를 내 점수에 더함 |
| focusFire | 집중 포화 | 라운드를 피버로 시작, 피버 배율 +2 |
| hyena | 하이에나 | 1등이 원을 잡을 때마다 20% 확률로 내 점수 +3 |
| chaser | 추격자 | 모든 원이 한 단계 바깥 구역 배율 (중앙 ×2 · 사이 ×3 · 가장자리 ×4) |
| momentum | 기세 | 콤보가 끊기지 않고, 콤보 보너스가 5콤보마다 |
| allHands | 만능 손 | 남의 색 원도 내 색처럼 +3, 견제 페널티·표적 없음 |
| fortress | 철벽 | 견제·레이저·방해 아이템에 걸리지 않음 |
| chainBlast | 연쇄 폭발 | 원을 잡으면 15% 확률로 반지름 120 안의 내 원도 함께 |
| bossFeast | 막타 독식 | 보스에게 주는 피해 2배, 막타 점수 2배 |
| lastFlame | 마지막 불꽃 | 라운드 마지막 15초 동안 점수 ×2 |
| itemHunter | 아이템 사냥꾼 | 아이템 원을 잡으면 한 등급 위 아이템, 효과 시간 2배 |

특별 카드 수치는 `SPECIAL = { boost: 1.5, flipPct: 20, focusMult: 2, hyenaChance: 0.2, hyenaGain: 3, momentumEvery: 5, chainChance: 0.15, chainR: 120, feastMult: 2, flameMs: 15_000, flameMult: 2, hunterDur: 2 }` (arcade.ts)

**테스트 (구현 후):**
- `judgeComeback`: [1000, 500, 900] → 꼴찌(500) 포함 / [1000, 600] → 없음(정확히 60%) / [100, 50, 50] → 둘 다 / [0, 0] → 없음 / [-5, -10] → 없음
- `rollOptions: 노말 제외` — `minTier: 1`이면 1000번 굴려도 tier 0 없음(저주·특별 제외)
- `rollOptions: 꼴찌 보장` — `guarantee: 3`이면 항상 1장 이상 tier 3
- `rollOptions: 역전 꼴찌 3번째 선택` — `special: true, forceCurse: true` → 특별 1장 + 저주 1장 + 나머지, 서로 다른 자리; count 4(선물)면 4장 중 특별 1장
- `SPECIALS` 12장, 모두 분류 '특별', `rollOptions`의 일반 풀에는 안 나옴

### Task 2: 특별 카드 효과·역전 배율·넓은 손 순위 (shared/rules.ts·items.ts·cursor.ts)

**Files:** `shared/src/rules.ts`, `shared/src/items.ts`, `shared/src/cursor.ts`, Test `shared/test/specials.test.ts`(새 파일)

**Interfaces:**
- `comebackMult(p, players): number` — `p.comeback`이 아니면 1. 꼴찌가 아니면(`isLast` 거짓) `p.comeback = false`로 끄고 1. 꼴찌면 `ARCADE.comeback.roomMult[players.length] ?? 1`
- `PlayerState.roundEnd: number` — `startRound`에서 `endAt || startAt + G.roundMs`, `shiftTimes` 대상에 추가
- `extraMult(p, now, players): number` = `comebackMult × (lastFlame && now ≥ roundEnd − flameMs ? flameMult : 1)` — `resolveClaim`의 mult, 서버 보스 타격·막타·황금 원 점수에 곱함
- `scoreBoostOf(m)`에 대역전 +50%
- `zoneMult(zone, m)`: 추격자면 기본 배율에 +1 (중앙 2, 사이 3, 가장자리 4), 가장자리면 찰나의 순간도 더함
- 기세: `breakCombo`가 아무것도 안 함, 콤보 보너스 주기 `min(5, comboPeriod(m.comboArtist))`
- 만능 손: `resolveClaim`에서 남의 색 원이면 내 색 분기처럼 (점수 own, 콤보 +1, 피버 own, 견제·표적·강탈·반사 없음, `res.type = 'own'`)
- 철벽: 견제당할 때 `guarded`와 같게(콤보·강탈 막힘), `canLaserStun` 거짓, `applyItem` 방해(감도·반대·시야)에서 제외, 저격 대상에서 제외
- 집중 포화: `startRound`에서 피버 시작, `feverMultOf` +2
- 막타 독식: `bossHitInfo` damage ×2, kill ×2
- 아이템 사냥꾼: `applyItem` 버프 시간 ×2 (꼴찌 보정 ×1.5와 곱함). 등급 올리기는 서버(Task 4)
- `endRoundSpecials(players): RoundEffect[]` — 판 뒤집기: 1등(최고 점수)이 아닌 사람이 flip을 가졌으면 `round((top − score) × 20%)` 더함. `RoundEffect.id`에 `'flip'`
- `hyenaGains(claimer, players, rand): { playerId: string; delta: number }[]` — claimer가 지금 1등(동점 포함)일 때, 다른 사람 중 hyena를 가진 사람마다 `rand() < 0.2`면 +3 (점수에 바로 더하고 목록 반환)
- `PlayerState.rankReach: number`, `applyRankReach(players, G)` — `G.comeback`이 아니면 모두 0. 최저 점수 무리 +20(모두 동점이면 없음), 인원 4명일 때 그다음 낮은 점수 무리 +10(그 무리가 1등 점수가 아니면). `reachOf`에 `p.rankReach`를 더하고 상한 그대로

**테스트 (구현 후):** `comebackMult`(3인 1.2, 꼴찌 벗어나면 1이고 comeback false로 꺼짐) / `extraMult` 마지막 불꽃(끝 15초 전 1, 안쪽 2) / 대역전 resolveClaim 내 색 3→5 (반올림) / 추격자 zoneMult 2·3·4 / 기세 견제당해도 콤보 유지, 5콤보 보너스 / 만능 손 남의 색 +3·표적 없음 / 철벽 견제 콤보 유지·`canLaserStun` false·감도 감소 안 걸림 / 집중 포화 startRound 피버 + 배율 +2 / 막타 독식 damage·kill 2배 / `endRoundSpecials` [1000, 400] → +120, 1등은 0 / `hyenaGains` 1등이 잡을 때만, rand 0.19 → +3, 0.2 → 없음 / `applyRankReach` 4인 점수 [10, 20, 30, 40] → 10점 +20, 20점 +10, 나머지 0; 3인 [10, 20, 30] → 10점만 +20; 꼴찌 보정 꺼진 방은 모두 0; `reachOf` 상한 80

### Task 3: 서버 (room.ts)

**Files:** `server/src/room.ts`, `shared/src/protocol.ts`, Test `shared/test/room.test.ts`

**Interfaces:**
- 프로토콜 `ArcadeOffer`에 `need: number`(남은 고를 수), `comeback: boolean`(역전 기회인지)
- offers 값에 `need`, `comeback` 추가. `startPick`: 선택 차례 `k = round − 1`. `k ≥ comeback.from`이면 `judgeComeback`으로 모든 플레이어 `p.comeback` 갱신(그 밖은 false). 각자 `roll`에 `minTier: k ≥ noNormalFrom ? 1 : 0`, `guarantee: last ? lastGuarantee[k] : undefined`, `special: comeback && k === specialAt`, `allLegend: allLegend || (comeback && k === legendAt)`; `need = picksPerRound[k]`
- `choose(id, index)`: 그 카드 적용 → options에서 빼고 `need--`. `need > 0`이면 `sendOffer`만, 0이면 chosen. `reroll`: 남은 need 그대로 새 3장(선물이면 4장)
- `finishPick`: 안 끝난 사람은 남은 카드에서 need장을 무작위로
- 봇: `need`만큼 차례로 고른다 (1~3초 간격). 우선순위 특별 카드 > 높은 등급, 기존 저주·보조 규칙 유지
- 라운드 끝 정산(`applyRoundCurses`)에 `endRoundSpecials` 결과를 effects에 합침
- `claim`: `resolveClaim` 뒤 `hyenaGains`(있으면 `special:gain` 알림), 연쇄 폭발(via가 'blast'가 아니고 claimer가 chainBlast면 15% 확률로 그 위치 반지름 120 안의 내 원을 `'blast'`로 잡음)
- 보스 타격·막타 점수, `claimGold` 점수에 `extraMult` 곱함
- `claimItem`: claimer가 itemHunter면 tier `min(2, tier + 1)`로 아이템을 굴림
- `emitPlayers` 직전에 `applyRankReach(this.players, this.G)`
- 프로토콜 새 이벤트 `'special:gain': (d: { playerId: string; id: AbilityId; delta: number }) => void`

**테스트 (구현 후):** `두 장 선택: 하나 고르면 남은 카드·need 1을 다시 보냄` / `두 장 선택: 마감 때 남은 수만큼 무작위` / `재접속하면 남은 선택지를 다시 받음` / `3라운드 끝 역전 꼴찌는 특별 카드를 받음, 아니면 안 받음` / `4라운드 끝 역전 꼴찌는 전부 레전드` / `1라운드 끝은 역전 판정 안 함` / `봇은 두 장을 고르고 특별 카드를 먼저` / `연쇄 폭발: 근처 내 원을 함께 잡음 (Math.random 고정)`

### Task 4: 클라이언트

**Files:** `client/src/arcadeUI.ts`, `client/src/main.ts`, `client/src/effectsUI.ts`, `client/src/codex.ts`, `client/src/icons.ts`, `client/src/style.css`

- 선택 화면: `offer.need`가 2면 제목 옆 "2장 고르기", 하나 고른 뒤 "1장 더". 남은 카드는 다시 깔지 않고 고른 카드만 빠짐
- 특별 카드 모양: `tierClass`가 특별이면 `'special'` — 검붉은 바탕(#3a0d14 → #1a0508) + 금빛 테두리(#ffd166) + 은은한 빛, 등급 자리에 "특별"
- `offer.comeback`이면 선택 화면 위에 "역전 기회! 꼴찌 점수 ×N (꼴찌를 벗어나면 꺼짐)" 띠 (꼴찌 보너스 문구 대신)
- 게임 중: 내 버프 바 맨 앞에 역전 배율 칩(`p.comeback && isLast`) "×1.2"
- `special:gain`(내 것): 화면 위쪽에 "하이에나 +3" 작은 글자
- 도감에 '특별' 탭 (12장, "역전 기회인 꼴찌만 3라운드 뒤 선택에서 받음")
- 아이콘: 특별 카드 12개에 아직 안 쓴 lucide 아이콘을 하나씩

### Task 5: 테스트·확인·문서·커밋

- 위 테스트를 모두 쓰고 `npm test`, typecheck, build
- 브라우저: 혼자 하기 아케이드에서 봇 점수를 올려 꼴찌가 되게 한 뒤(콘솔 대신 실제 플레이가 어려우면 서버 테스트로 대신하고 그 사실을 기록) 두 장 선택 화면·특별 카드 모양·역전 띠 확인
- README(아케이드 설명), 로드맵 3.5단계 3-1 ✅, 설계서 상태
- 커밋(목적별): `feat(shared): 증강 선택 구조·역전 판정·특별 카드 규칙` / `feat(shared): 특별 카드 효과·역전 배율·넓은 손 순위 보정` / `feat(server): 두 장 선택·역전 기회·특별 카드 처리` / `feat(client): 두 장 선택 화면·특별 카드·역전 표시` / `docs: 3-1 반영`

## 정한 것 (설계서가 말하지 않은 부분)

- 역전 기회·등급 보장·노말 제외는 아케이드 선택 규칙이라 방 규칙 '꼴찌 보정'과 상관없이 적용 (지금 꼴찌 등급 상향도 그렇다). 넓은 손 순위 보정만 '꼴찌 보정' 규칙을 따른다
- 만능 손은 점수 판정만 바꾸고, 넓은 손·자석·장판이 남의 색을 잡게 하지는 않는다
- 하이에나의 "1등"은 그 원을 잡은 직후 점수 기준(동점 1등 포함)
