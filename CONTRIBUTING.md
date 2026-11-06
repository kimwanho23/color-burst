# 작업 규칙

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/) 형식을 따른다.

```
<타입>(<범위>): <요약>

<본문 (선택)>

<꼬리말 (선택)>
```

### 타입

| 타입 | 언제 | 버전 영향 (정식 출시 후) |
|---|---|---|
| `feat` | 새 기능 (새 원 종류, 새 화면, 새 옵션) | MINOR |
| `fix` | 버그 수정 | PATCH |
| `balance` | 규칙 수치 조정 (점수, 피버 시간, 봇 난이도 등 `RULES` 값) | MINOR |
| `refactor` | 동작은 그대로, 코드 구조만 변경 | - |
| `perf` | 성능 개선 | PATCH |
| `style` | 화면 디자인·CSS 변경 (게임 동작 무관) | PATCH |
| `docs` | 문서만 변경 (README, CHANGELOG 등) | - |
| `test` | 테스트 추가·수정 | - |
| `build` | 빌드 설정, 의존성 (package.json, vite 설정) | - |
| `ci` | 배포 설정 (render.yaml 등) | - |
| `chore` | 그 밖의 잡일, 버전 올리기 | - |

### 범위 (선택)

`shared` · `server` · `client` · `audio` · `deploy` · `release`

여러 곳에 걸치면 범위를 생략한다.

### 요약 쓰는 법

- 한국어로, 50자 이내, 끝에 마침표 없음
- 무엇을 했는지 짧게: `피버 중 견제 페널티 제거`, `재접속 시 남은 원 복원`
- 첫 줄만 보고도 무슨 변경인지 알 수 있게

### 본문과 꼬리말

- 본문: **왜** 바꿨는지, 무엇이 달라지는지. 한 줄 비우고 작성
- 호환이 깨지는 변경: 꼬리말에 `BREAKING CHANGE: 설명` (MAJOR)
- 이슈 연결: `Closes #12`

### 예시

```
feat(server): 빈 자리 봇 채우기 추가

혼자서도 테스트할 수 있도록 빈 색상 자리를 봇으로 채운다.
봇 난이도는 쉬움/보통/어려움 중 방장이 고른다.
```

```
balance(shared): 피버 배율 2배에서 3배로 상향
```

```
fix(client): 새로고침 후 첫 클릭 전까지 음악이 안 나오는 문제 수정
```

```
chore(release): v1.0.0-beta.2
```

## 버전과 릴리즈

자세한 단계는 [README의 버전과 릴리즈](README.md#버전과-릴리즈) 참고.

- 릴리즈 커밋은 `chore(release): vX.Y.Z` 하나로: 모든 `package.json` 버전 + `package-lock.json` + `CHANGELOG.md`
- 태그는 `vX.Y.Z` 형식 (`v1.0.0-beta.2`)
- CHANGELOG는 커밋 타입별로 정리: 기능(feat) / 밸런스(balance) / 수정(fix) / 기타

## 브랜치

지금은 `main` 하나로 작업한다. `main`에 푸시하면 Render에 자동 배포되므로, 친구들과 게임 중일 때는 푸시하지 않는다.

정식 출시 후에는 `develop`(베타 서버) → `main`(정식 서버)로 나누고, 기능 브랜치는 `feat/기능명`, `fix/버그명`으로 만든다.
