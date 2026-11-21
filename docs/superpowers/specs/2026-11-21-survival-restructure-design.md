# 서바이벌 모드 재구성 설계 (라운드 탈락 포함)

2026-11-21 · 서버·공유 규칙·클라이언트 · 이 문서만 읽고 구현할 수 있게 썼다
이어지는 문서: [체력전](2026-11-21-survival-hp-battle-design.md) (공격 대상이 정해지는 체력 대결)
보류한 문서: [상점전](2026-11-21-survival-shop-battle-design.md) (골드로 증강을 사는 오토체스형, 어려워서 만들지 않기로 함)

## 의도

- 지금 아케이드는 5라운드에 증강 선택이 6번뿐이라 빌드가 자리 잡기 전에 끝나고, 라운드 하나하나의 결과가 누적 점수에 묻힌다. 그래서 빌드가 콤보·보스·방어 같은 센 카드로 쏠린다. 사용자 진단: **한 판의 호흡이 짧아서 유지(성장)가 안 된다.**
- 해법으로 사용자가 정한 방향: 아케이드·서바이벌 요소를 합치고, **탈락 방식이 서로 다른 서바이벌 하위 모드**를 둔다. 체력으로 오래 버티는 구조가 핵심이다. (처음에는 오토체스형 골드·상점 방식도 검토했으나 구현이 어려워 뺐다.)
- 이 문서는 **공통 틀**을 다룬다: 모드 구조, 이름, 규칙 모델, 화면, 서버 흐름에 끼우는 자리, 그리고 하위 모드 중 가장 작은 **라운드 탈락**. 체력전과 표적전은 짝 문서에서 다룬다.

## 정한 것 (사용자 결정)

1. 게임 모드는 **클래식 · 아케이드 · 협력전 · 서바이벌** 네 가지가 된다.
2. 서바이벌은 안에서 방식을 고른다: **라운드 탈락 / 체력전**. (지금의 "서바이벌"은 인원 모드에서 사라진다.)
3. 인원 모드는 **개인전 / 팀전 2:2** 두 가지만 남는다 (클래식·아케이드에서만 고른다).
4. **라운드 탈락은 증강 사용 여부를 고른다.** 증강을 쓰지 않으면 지금의 클래식 서바이벌, 쓰면 아케이드형이다. "인기 없으면 나중에 없앤다"는 방침이므로 각 방식을 독립적으로 떼어낼 수 있게 만든다.
5. 이름: 아케이드는 그대로 둔다. 서바이벌의 새 하위 모드 이름은 위와 같다.

## 목표 / 하지 않는 것 / 실패 기준

**목표**
1. 모드 선택 화면에서 서바이벌을 고르고 그 안에서 방식을 고른다.
2. 라운드 탈락: 증강을 켜면 **매 라운드 끝에 꼴찌 1명이 탈락**(4명이면 3라운드), 끄면 지금처럼 연속 한 판에서 30초마다 꼴찌 탈락.
3. 체력전이 얹힐 **공통 틀**(서버 흐름의 끼움 자리, 규칙 모델, 화면 자리)을 만든다.
4. 클래식·아케이드·협력전·튜토리얼의 지금 동작은 **한 줄도 바뀌지 않는다.**

**하지 않는 것**
- 체력전의 규칙 자체(짝 문서).
- 팀전과 서바이벌의 결합. 서바이벌은 개인전만 지원한다.
- 협력전 내부.
- 새 글꼴·색·비트맵 이미지.

**실패 기준**
- 기존 테스트(773개)가 깨지거나 클래식 서바이벌의 동작이 바뀌는 것.
- 서바이벌을 없앴을 때 다른 모드 코드를 함께 고쳐야 하는 구조(하위 모드끼리 얽힘).
- 옛 설정 값(`survival: true` + 클래식/아케이드)이 들어왔을 때 서버가 깨지는 것.

## 현재 코드 (구현자가 먼저 읽을 곳)

| 위치 | 내용 |
|---|---|
| `shared/src/rules.ts` `RoomRules` 470~490행 | `mode: 'classic' \| 'arcade'`, `team`, `survival`, `coop`, `coopLevel` (`MODE_KEYS`) |
| `rules.ts` 575~595행 `sanitizeRules` | 모드 상호 배타 처리: 협력전이 팀전·서바이벌·아케이드를 끔, 팀전과 서바이벌은 같이 못 켬 |
| `rules.ts` `toGameRules`(657행) | `survival: r.survival && !r.team`. `GameRules.survival`을 서버가 읽음 |
| `rules.ts` 2045~2075행 | `survivalRoundMs(n)`, `survivalCuts(n, rounds)`(아케이드 뒤쪽 라운드 컷), `pickOut`, `isLowest`, `survivalRanking` |
| `server/src/room.ts` 689행 | 시작 때 `survivalN` 저장, 클래식 서바이벌이면 `roundMs = survivalRoundMs(n)` |
| `room.ts` 1196행 | 라운드 시작: `nextCutAt` (클래식 서바이벌 30초 컷) |
| `room.ts` 1244~1252행 `startPick` | 아케이드 라운드 끝 정산: `applyRoundCurses` → **서바이벌이면 `survivalCuts` 라운드에 `eliminate(pickOut())`** → 이벤트 → 선택지 |
| `room.ts` 1388행, 1611행 `updateSurvival` | 클래식 서바이벌 컷 틱(경고 3초 전, 탈락, 1명 남으면 `end()`) |
| `room.ts` 2212행 | 결과 순위: 서바이벌이면 `survivalRanking` (탈락 순서) |
| `client/src/rulesUI.ts` `renderRules` | 게임 모드 3버튼(`.modes.three`), 인원 모드 3버튼(개인전·팀전·서바이벌) |
| `client/src/lobbyUI.ts` `rulesSummary` | 제목 "서바이벌", 시간 문구 "N초마다 꼴찌 탈락" |
| `client/src/guide.ts` 슬라이드 `survival`, `codex.ts` | 서바이벌 설명 문구 |
| `README.md` | 모드 설명 |

## 규칙 모델 (공유)

`RoomRules`에 필드를 더하고 `survival`의 의미를 정리한다. 내부 이름 `survival`은 유지해 옛 저장값과 호환한다.

```ts
export type SurvivalKind = 'cut' | 'target';     // 라운드 탈락 / 체력전(공격 대상)
// RoomRules에 추가
survival: boolean;            // 서바이벌 모드인가 (기존 필드, 의미 확장)
survivalKind: SurvivalKind;   // 기본 'cut'
survivalAugments: boolean;    // 'cut'일 때만 의미: 증강 사용 (기본 false)
```

- `MODE_KEYS`에 `survivalKind`, `survivalAugments`를 추가한다(프리셋이 바꾸지 않는 모드 설정).
- **상호 배타**: `survival`이 켜지면 `team=false`, `coop=false`. 협력전·팀전이 켜지면 `survival=false`. (`sanitizeRules` 규칙은 지금과 같은 "이번에 새로 고른 쪽이 이긴다".)
- **모드 판정 도우미** (`rules.ts`에 순수 함수): `isSurvival(r)`, `survivalKindOf(r)`, `usesAugments(r)` = 아케이드이거나 (서바이벌 && 'cut' && `survivalAugments`) 이거나 아니면 false(체력전은 증강을 쓰지 않는다).
- **`toGameRules`**: 라운드 탈락+증강은 `arcade: true`에 해당하는 라운드 흐름을 탄다(아래 서버 흐름). 라운드 탈락+증강 끔은 지금 클래식 서바이벌(`arcade:false`, `survival:true`)과 같다. 체력전은 증강 없이 클래식 규칙으로 라운드를 반복한다(짝 문서).
- **옛 값 이전**: 저장/전송된 옛 규칙 중 `survival:true` + `mode:'arcade'`는 `survival:true, survivalKind:'cut', survivalAugments:true`로, `survival:true` + `mode:'classic'`은 `survivalAugments:false`로 읽는다. (옛 아케이드 서바이벌은 "뒤쪽 라운드 컷"이었으나 이제 "매 라운드 컷"으로 바뀐다. 의도한 변경이다.)

## 서버 흐름에 끼우는 자리 (접근: 규칙 단위로 교체)

`room.ts`가 이미 2,300줄이므로 서바이벌 로직은 **`server/src/survival/`**에 규칙 객체로 모아 두고, `room.ts`에는 호출 자리만 둔다. 서바이벌이 아닌 모드는 객체가 `null`이라 지금 경로를 그대로 탄다.

```ts
// server/src/survival/ruleset.ts
export interface SurvivalRuleset {
  readonly kind: SurvivalKind;
  /** 시작: 판 길이·초기값 (체력 등). 클래식 컷형은 roundMs를 돌려줌 */
  setup(players: PlayerState[], G: GameRules): { roundMs?: number };
  /** 라운드가 시작될 때 (대상 배정 등) */
  onRoundStart(round: number, alive: PlayerState[]): void;
  /** 클릭 판정 (체력전): 내 색 / 수비(원만 제거) / 무시. 없으면 항상 기존 경로 */
  clickRule?(p: PlayerState, circle: Circle): 'own' | 'defend' | 'ignore';
  /** 틱 (클래식 컷 경고, 체력전 피해 대조·탈락) */
  tick?(now: number): void;
  /** 라운드 정산: 탈락·체력. 탈락자 목록을 돌려줌 */
  settle(round: number, alive: PlayerState[]): { out: PlayerState[]; over: boolean };
  /** 라운드 사이 단계: 없음 / 증강 선택 */
  intermission: 'none' | 'pick';
  /** 결과 순위용 */
  rank(players: readonly PlayerState[]): PlayerState[];
}
```

`room.ts`의 호출 자리 (줄 번호는 현재 기준):

| 자리 | 하는 일 |
|---|---|
| 시작(689행) | `this.survivalRule = makeRuleset(rules)` (서바이벌이 아니면 `null`). `setup()` 결과를 `G`에 반영 |
| 라운드 시작(`beginRound`, 1196행 부근) | `onRoundStart`, 클래식 컷형은 `nextCutAt` 설정을 규칙으로 옮김 |
| 클릭 판정 | 체력전만 `clickRule`(내 색/수비/무시, 짝 문서). 점수 피해는 틱 대조라 `onScore` 호출 지점이 필요 없다 |
| `startPick`(1244행) | 지금의 `survivalCuts` 분기를 `settle()` 호출로 교체. `over`이면 `end()`. `intermission`이 `'pick'`이면 지금 선택 단계, `'none'`이면 선택을 건너뛰고 다음 라운드(체력전) |
| 틱(1388행) | 클래식 컷형만 `updateSurvival` (규칙 객체의 `tick`으로 옮겨도 좋음) |
| 결과(2212행) | `rank()` |

**원칙**: 이 틀을 넣고도 **서바이벌이 아닌 판의 동작은 바이트 단위로 같다**. 서바이벌 분기는 전부 `survivalRule !== null` 안에 둔다. 지금의 `survivalCuts`·`updateSurvival`·`survivalRoundMs`는 `kind === 'cut'` 규칙 객체가 쓴다.

### 라운드 탈락 (kind = 'cut')

- **증강 끔 (`survivalAugments:false`)**: 지금의 클래식 서바이벌과 같다. 연속 한 판, `survivalRoundMs(n)`, 30초마다 경고 후 꼴찌 탈락, 1명 남으면 끝. **코드를 바꾸지 않고 규칙 객체가 기존 함수를 부른다.**
- **증강 켬 (`survivalAugments:true`)**: 아케이드 라운드 흐름(라운드 30~90초 + 증강 선택). **매 라운드 끝(저주 정산 뒤, 랜덤 이벤트 앞)에 누적 점수 꼴찌 1명을 탈락**시킨다(`pickOut`). 라운드 수는 `인원 − 1`이다(4명 → 3라운드). 마지막 라운드는 남은 2명의 1:1이다.
  - 라운드 수가 아케이드(5)와 다르므로 `ARCADE.rounds` 대신 `survivalRounds(n) = n − 1`을 쓴다. 증강 선택 횟수·등급 확률 표(`TIER_ODDS`, `picksPerRound`)는 라운드 번호로 인덱싱하므로 3라운드면 앞쪽 값만 쓴다. (내 판단: 라운드가 줄어도 확률 표는 그대로 둔다.)
  - 탈락자는 선택 단계에 참여하지 않는다(지금도 `!p.outAt`만 고른다). 탈락자는 관전한다(지금 "탈락 · 구경 중" 배너).

## 화면

### 규칙 설정 창 (`renderRules`)

```
게임 모드   [클래식] [아케이드] [협력전] [서바이벌]        ← 4칸 (.modes.four)

(클래식·아케이드를 골랐을 때)
인원 모드   [개인전] [팀전 2:2]

(서바이벌을 골랐을 때)
방식        [라운드 탈락] [체력전]                  ← 인원 모드 줄 자리에 들어감
(라운드 탈락일 때만)
증강        [사용 안 함] [사용]                              ← 세그먼트 2칸
```

- 방식 버튼마다 아이콘과 한 줄 설명(툴팁): 라운드 탈락 "라운드마다 꼴찌가 탈락", 체력전 "정해진 상대에게 점수만큼 피해, 체력이 0이면 탈락".
- 서바이벌은 개인전만이라 인원 모드 줄을 숨긴다. 서바이벌에서 팀전이 필요한 사용자는 없다. (내 판단)
- 프리셋은 서바이벌에서도 그대로 쓸 수 있다(프리셋은 `MODE_KEYS` 밖의 값만 바꾼다).
- 모드 카드 부제(툴팁): 아케이드 "5라운드, 능력 고르기", 서바이벌 "마지막 1명이 남을 때까지".

### 대기실·점수·결과

- `rulesSummary`/규칙 패널 제목: `개인전 · 서바이벌 · 라운드 탈락`처럼 방식까지 쓴다. 시간 칸: 라운드 탈락+증강 끔은 `30초마다 꼴찌 탈락`(지금), 증강 켬은 `라운드 N초 · 매 라운드 탈락`, 체력전은 짝 문서.
- 게임 방법 `survival` 슬라이드와 도감·README의 서바이벌 문구를 새 구조에 맞게 고친다.
- 결과 화면은 지금 서바이벌 결과(탈락 순서 순위)를 그대로 쓴다.

## 구현 범위와 순서 (빌더용)

1. `shared/src/rules.ts`: `SurvivalKind`, 필드, `sanitizeRules` 확장, 도우미 함수, 옛 값 이전. 테스트(`shared/test`): 모드 상호 배타, 이전, `usesAugments`.
2. `server/src/survival/`: `SurvivalRuleset` 인터페이스, `cut` 규칙(증강 끔은 기존 함수 호출, 켬은 매 라운드 탈락, `survivalRounds`). `room.ts`에 끼움 자리. **기존 테스트 773개 전부 통과**해야 이 단계가 끝난 것이다.
3. 클라이언트: 모드 4버튼, 방식 버튼, 증강 세그먼트, 요약 문구, 게임 방법·도감·README 문구. (규칙 창 레이아웃은 [대기실 개편 문서](2026-11-21-lobby-readability-design.md)와 겹치므로 그 문서가 먼저 구현되었으면 그 구조 위에 얹는다.)
4. 체력전은 짝 문서의 순서에 따라 규칙 객체로 추가한다.

## 완료 기준

- 서바이벌 → 라운드 탈락 → 증강 끔으로 방을 시작하면 지금 클래식 서바이벌과 같은 판이 열린다(30초 경고·탈락, 결과 화면까지).
- 증강 켬이면 4명 방에서 3라운드가 돌고 매 라운드 끝에 점수 꼴찌 1명이 탈락하며 남은 사람만 증강을 고른다. 마지막 2명이 1:1을 한다.
- 인원 모드는 클래식·아케이드에서만 개인전/팀전이 보이고, 서바이벌에서는 방식 줄이 보인다. 협력전과 팀전은 서바이벌과 함께 켜지지 않는다.
- 옛 `survival:true` 규칙이 들어와도 서버가 깨지지 않고 위 이전 규칙대로 읽는다.
- `npm test`, `npm run typecheck`, `npm run build`가 통과한다.

## 내가 정한 것 (검수 때 확인)

- 구현 접근은 "규칙 객체로 교체"(`server/src/survival/`)로 정했다. (확인하지 않은 선택이다. 단순 확장으로 가려면 규칙 객체의 호출 자리만 `room.ts` 안의 분기로 바꾸면 된다.)
- 내부 이름 `survival` 유지, 새 필드 `survivalKind`·`survivalAugments`.
- 서바이벌은 개인전만. 팀전 결합 없음.
- 증강 켠 라운드 탈락의 라운드 수는 `인원 − 1`이고 증강 확률 표는 그대로.
- 옛 "아케이드 서바이벌(뒤쪽 라운드만 컷)"은 "매 라운드 컷"으로 바뀐다.

## 열어 둔 것 (빌더가 판단)

- 규칙 객체에 `tick`을 둘지, 클래식 컷형의 `updateSurvival`을 `room.ts`에 남길지.
- 모드 4버튼 아이콘(서바이벌 아이콘은 새로 고를 것).
- 서바이벌 결과 화면의 부제 문구.
