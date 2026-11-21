# 협력전 보스 종류 확장 틀 설계 (보스 선택·실행 인터페이스·체력 방식)

2026-11-21 · 서버·공유 규칙·클라이언트 · 이 문서만 읽고 구현할 수 있게 썼다
짝 문서: [문지기 (경계선 보스)](2026-11-21-coop-boss-gatekeeper-design.md) · [폭파공 (설치형 보스)](2026-11-21-coop-boss-bomber-design.md)

## 의도

- 협력전은 지금 보스가 하나(코어)다. 11-18 탄막 설계에서 사용자가 "보스는 하나를 완성하고, 보스 정의를 떼어 두었다가 나중에 3종으로 늘린다"고 정했다. 지금이 그 "나중"이다.
- 데이터 표(`COOP_BOSSES`)만 늘리면 새 보스가 **이름·색만 다른 코어**가 된다. 사용자가 정한 원칙은 **현재 탄막형 보스와 전혀 겹치지 않게** 만드는 것이다. 그래서 새 보스는 패턴 목록이 아니라 **한 판의 진행 방식(핵심 동사) 자체가 다르다.**

| 보스 | 핵심 동사 | 위협 | 체력 방식 | 딜이 들어가는 방식 |
|---|---|---|---|---|
| **코어** (현재) | 피하며 잡는다 | 탄막·레이저·내려찍기 등 | 개인 체력 | 보스가 뿜는 내 색 원을 잡으면 항상 피해 |
| **문지기** (신규) | **지킨다** | 경계선을 넘는 구체 | **공통 체력만**(개인 체력 없음) | 구체를 반사해 보스에게 맞히면 피해 + 그로기 |
| **폭파공** (신규) | **되받아친다** | 시한 폭탄의 십자 폭발 | 개인 체력 | 폭탄을 보스 높이로 반사해 폭발시키면 피해 |

- 세 보스가 서로 다른 동사·위협·딜 방식을 가진다. (사용자 결정: 문지기만 개인 체력이 없고, 코어와 폭파공은 개인 체력을 쓴다.)
- 이 문서는 **공통 틀**만 다룬다: 보스 고르기, 서버 실행 인터페이스, 체력 방식, 화면·결과의 갈래. 각 보스의 규칙은 짝 문서에 있다.

## 목표 / 하지 않는 것 / 실패 기준

**목표**
1. 협력전 설정에서 **난이도 + 보스**(코어 / 문지기 / 폭파공 / 무작위)를 고른다.
2. 서버가 보스마다 다른 실행 객체를 쓰되, **코어의 동작은 한 줄도 바뀌지 않는다.**
3. 개인 체력 보스(코어·폭파공)와 공통 체력 보스(문지기)가 같은 화면 틀 안에서 각자의 체력을 보인다.
4. 보스 하나를 없애거나 고쳐도 다른 보스 코드를 건드리지 않는다.

**하지 않는 것**
- 코어의 규칙·수치 변경, 코어 코드를 새 인터페이스 아래로 옮기는 대규모 리팩터링(코어는 지금 클래스를 인터페이스에 맞춰 얇게 감싸기만 한다).
- 한 판 안에서 보스가 바뀌는 연속 전투. 한 판은 보스 하나다.
- 새 보스에서 쓰지 않는 코어 전용 시스템(수정 파훼, 탄막 무늬, 고유 패턴 10초 타이머)의 이식.

**실패 기준**
- 기존 협력전 테스트(`shared/test/coop*.test.ts` 등)가 깨지거나 코어 판의 서버 이벤트가 바뀌는 것.
- 보스 선택이 방 규칙·재접속·프리셋 보존에서 사라지는 것.
- 새 보스가 코어와 같은 화면 요소(탄막·수정)를 그대로 쓰는 것.

## 현재 코드 (구현자가 먼저 읽을 곳)

| 위치 | 내용 |
|---|---|
| `server/src/coop.ts` `CoopRun` | 협력전 한 판. `CoopHost`(방이 넘기는 기능)로만 방과 이야기한다. 코어 전체 로직(수정·보호막·큰 피해 구간·분노·고유 패턴·탄막·아이템·스페셜) |
| `server/src/room.ts` 1655행 | `this.coop = new CoopRun(host, this.rules.coopLevel)` 생성. 방이 부르는 곳: `tick`, `catchOrb`·`catchItem`·`hitCrystal`·`popThreat`·`threatEscaped`, `onShot`·`reportHurt`, `damage`('laser'), `activateSpecial`·`activateBarrier`, `shift`, `recheck`, `busy`, `state(true)`, `result`, `dispose`, `orbComboAdd`, `boss` |
| `shared/src/coopBosses.ts` | `COOP_BOSSES: { core }`(`CoopBoss` 정의: 탄막 무늬·고유 패턴·색). `id: 'core'` 단일 타입 |
| `shared/src/rules.ts` `RULES.coop`(157행~) | 협력전 수치. 난이도 `RULES.coop.levels` |
| `shared/src/protocol.ts` | `coop:*` 이벤트들, `CoopState`(15행) |
| `client/src/coopUI.ts`, `client/src/main.ts`, `client/src/render.ts` | 협력전 HUD·판 그리기. `coopState.bossId`로 보스 원을 찾음 |
| `client/src/rulesUI.ts` `renderRules` | 협력전 난이도 3~4버튼(`.coop-levels`) |
| `client/src/lobbyUI.ts` | `rulesSummary`/`rulesChips`의 협력전 분기, `COOP_NAME` |

## 규칙 모델 (공유)

```ts
// shared/src/rules.ts
export type CoopBossId = 'core' | 'gatekeeper' | 'bomber';
export const COOP_BOSS_IDS: readonly CoopBossId[] = ['core', 'gatekeeper', 'bomber'];
// RoomRules에 추가
coopBoss: CoopBossId | 'random';   // 기본 'core'
```

- `MODE_KEYS`에 `coopBoss`를 추가한다(프리셋이 바꾸지 않는 모드 설정). `sanitizeRules`는 목록에 없는 값을 `'core'`로 돌린다. 옛 규칙(필드 없음)은 `'core'`로 읽는다.
- `'random'`은 **판을 시작할 때 서버가 한 번 고른다**(`startCoop`). 고른 보스는 `CoopState.boss`로 모두에게 알린다. 재접속해도 같은 보스다.
- `COOP_BOSSES`의 `CoopBoss.id`를 `CoopBossId`로 넓힌다. 코어 전용 데이터(`bullets`, `skills` 등)는 지금 그대로 코어에만 있고, 새 보스는 이 표를 쓰지 않는다(각자 `RULES.coop.gatekeeper`·`RULES.coop.bomber`에 수치를 둔다). 이름·색 같은 공통 표시 정보만 표에 `name`, `rims`, `body`로 둔다.
- 수치는 `RULES.coop` 아래에 보스별 객체로 둔다(프로젝트 규칙: 규칙·밸런스 수치는 `RULES`에서만 바꾼다).

## 서버: 보스 실행 인터페이스

`CoopRun`이 이미 `CoopHost`로 방과 분리되어 있으므로, 방은 "보스 실행 객체"만 안다. 인터페이스를 `server/src/coop/run.ts`에 정의하고 `CoopRun`은 그 인터페이스를 구현한다고 선언한다(메서드 이름 변경 없음).

```ts
export interface CoopBossRun {
  readonly id: CoopBossId;
  readonly level: CoopLevel;
  /** 보스 원 (방이 보스 체력 표시·방해 판정에 읽음). 없으면 null */
  boss: Circle | null;
  start(now: number): void;
  tick(now: number): void;
  recheck(): void;
  busy(): boolean;
  shift(delta: number): void;
  state(withVolleys?: boolean): CoopState;
  result(now: number, startAt: number, win: boolean, reason?: CoopResult['reason']): CoopResult;
  dispose(): void;
  /** 원 클릭이 방에서 coop 경로로 오면 여기서 먼저 판단한다 (새 보스의 반사·해제) */
  clickCircle?(p: PlayerState, c: Circle, at: Point, now: number): 'handled' | 'default';
  /** 빈 곳 클릭 (새 보스는 무시하거나 쓴다) */
  clickEmpty?(p: PlayerState, at: Point, now: number): void;
  /** 플레이어가 움직일 수 있는 영역 (폭파공은 하단) */
  bounds?(): { x0: number; y0: number; x1: number; y1: number } | null;
  // 코어 전용(새 보스는 구현하지 않음, 방이 `?.`로 부름): catchOrb, catchItem, hitCrystal, popThreat,
  // threatEscaped, onShot, reportHurt, damage, activateSpecial, activateBarrier, orbComboAdd, setCrystalSource
}
```

- 방(`room.ts`)은 `makeCoopRun(id, host, level)`(새 `server/src/coop/index.ts`)로 만들고 `this.coop: CoopBossRun | null`로 든다. 코어 전용 메서드는 선택 메서드로 선언해 호출 지점에서 `this.coop.catchOrb?.(...)`처럼 부른다. **코어 판에서는 기존과 동일하게 호출된다.**
- **클릭 흐름**: 방이 `catchCoopOrb`로 가기 전에(`room.ts` 882행·1464행) `this.coop.clickCircle?.(...)`을 먼저 부른다. `'handled'`면 거기서 끝, `'default'`(또는 메서드 없음)이면 지금 경로를 탄다. 코어는 이 메서드가 없어 지금과 같다.
- **움직임 제한**: 서버는 `bounds()`가 있으면 그 밖의 클릭을 무시한다. 클라이언트는 커서를 그 안으로 가둔다.
- 새 파일 배치: `server/src/coop/index.ts`(팩토리), `server/src/coop/run.ts`(인터페이스), `server/src/coop/gatekeeper.ts`, `server/src/coop/bomber.ts`. 코어(`server/src/coop.ts`)는 위치를 바꾸지 않는다.

## 체력 방식

| 구분 | 코어·폭파공 | 문지기 |
|---|---|---|
| 개인 체력 | 있음 (`PlayerState.hp`, 0 → 탈락, 모두 탈락하면 패배) | **없음**. `hp`를 쓰지 않는다 |
| 공통 체력 | 없음 | 있음 (`CoopState.shared: { hp, max }`) |
| 패배 | 모두 탈락 또는 시간 초과 | 공통 체력 0 또는 시간 초과 |

- `CoopState`에 `boss: CoopBossId`와 `shared?: { hp: number; max: number }`를 더한다. 공통 체력 보스는 `shared`를 채운다.
- 결과(`CoopResult`)의 사람별 체력·탈락 시각은 공통 체력 보스에서는 비워 두고 `sharedLeft`(남은 공통 체력 비율)를 싣는다. 별 계산(`coopStars(win, aliveRatio, leftMs)`)의 `aliveRatio` 자리에 문지기는 **남은 공통 체력 비율**을 넣는다.
- 판 기록 `[game]` 줄(`server/src/gameLog.ts`)에 `coopResult.boss`와 `sharedLeft`를 더한다.

## 화면 (클라이언트)

### 설정 창·대기실

```
협력전 난이도   [이지] [노말] [하드] [엑스퍼트]            ← 지금 것
협력전 보스     [코어] [문지기] [폭파공] [무작위]            ← 새 줄 (.modes four)
```

- 보스 버튼마다 아이콘과 한 줄 설명(툴팁): 코어 "탄막을 피하며 원을 잡아요", 문지기 "경계선을 넘기 전에 구체를 되받아쳐요", 폭파공 "시한 폭탄을 보스에게 되돌려 보내요", 무작위 "시작할 때 정해져요".
- 협력전 대기실의 규칙 목록(`coopRules`, `coopRuleList`)은 **고른 보스의 설명**으로 바뀐다. 보스 이름과 한 줄 규칙, 체력 방식(개인/공통)을 보인다.
- 규칙 패널 제목: `협력전 · 노말 · 문지기`. (`rulesSummary`의 `who` 문구에 보스 이름을 더한다.)

### 판 안

- 협력전 HUD(`coopUI.ts`)를 `boss`에 따라 갈라 그린다. 코어는 지금 그대로. 문지기는 **공통 체력 막대**를 크게 두고 개인 체력 막대(`#myhp`)를 숨긴다. 폭파공은 개인 체력 막대를 그대로 쓴다.
- `render.ts`는 보스별 그리기 함수(`drawGatekeeper`, `drawBomber`)를 짝 문서대로 추가한다. 보스 원 그리기의 공통부는 `coopState.bossId` 경로를 그대로 쓴다.
- 코어의 수정·탄막·분노 UI는 새 보스에서는 그려지지 않는다(상태가 오지 않으므로).

### 결과 화면

- 승패·별·시간은 지금처럼. 공통 체력 보스는 사람별 피해 표 대신 **사람별 기여**(반사한 구체 수 등, 보스 문서에서 정함)를 보인다.

## 구현 범위와 순서 (빌더용)

1. `shared`: `CoopBossId`, `coopBoss` 규칙(`sanitizeRules`, `MODE_KEYS`), `CoopState`·`CoopResult` 확장, 테스트(규칙 정규화, 옛 값 이전).
2. `server/src/coop/run.ts` 인터페이스와 `CoopRun`의 선언(변경 없음) + `makeCoopRun` + `room.ts`의 호출 지점을 선택 호출로 바꿈. **기존 테스트 전부 통과**가 이 단계의 완료 기준이다.
3. 클라이언트: 설정 창 보스 줄, 대기실 규칙 설명 분기, HUD 갈래.
4. 문지기, 폭파공을 짝 문서 순서대로 추가한다(서로 독립이므로 병렬 가능).
5. 시뮬레이션: 서버 `Room`을 가상 시계·고정 시드로 돌리는 도구(`scripts/sim/`, 체력전 문서 4단계와 같은 도구)로 보스별 승률·판 길이를 본다.

## 완료 기준

- 협력전을 고르면 보스 줄이 보이고, 코어·문지기·폭파공·무작위 중 고른 대로 판이 시작된다. 무작위는 시작 때 한 번 정해지고 재접속해도 같다.
- 코어 판은 지금과 똑같이 동작한다(이벤트·결과 포함, 기존 테스트 통과).
- 문지기 판에서는 개인 체력이 보이지 않고 공통 체력만 있다. 폭파공 판에서는 개인 체력이 있다.
- 새 보스를 지워도(보스 파일·규칙 값만 제거) 코어와 나머지 보스가 동작한다.
- `npm test`, `npm run typecheck`, `npm run build`가 통과한다.

## 내가 정한 것 (검수 때 확인)

- 새 보스는 `COOP_BOSSES` 데이터 표가 아니라 **별도 실행 클래스**로 만든다. 코어는 클래스를 그대로 두고 인터페이스만 선언한다.
- 보스 이름 **문지기**와 **폭파공**은 가칭이다(사용자가 부른 "경계선 보스", "설치형 보스"에서 지었다).
- 보스 선택에 **무작위**를 둔다. 기본은 코어다.
- 새 보스는 1차에서 스페셜 어택·아이템·분노 시스템을 쓰지 않는다(보스 문서에서 보스별로 예외를 정한다).
- 난이도(이지~엑스퍼트)는 보스마다 자기 표를 가진다.

## 열어 둔 것 (빌더가 판단)

- `CoopState`를 보스별 하위 타입으로 쪼갤지, 선택 필드로 두고 하나로 둘지.
- 인터페이스의 선택 메서드 목록을 방이 부르는 지점에서 어떻게 줄일지.
- 보스 아이콘 모양(`icons.ts`).
