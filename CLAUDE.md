# 컬러 버스트 작업 지침

- 커밋 메시지는 반드시 `CONTRIBUTING.md`의 Conventional Commits 규칙을 따른다 (`<타입>(<범위>): <한국어 요약>`). 게임 수치 조정은 `balance` 타입.
- 한 커밋에는 한 가지 목적만. 기능과 버전 올리기는 따로 커밋한다.
- 규칙·밸런스 수치는 `shared/src/rules.ts`의 `RULES`에서만 바꾼다.
- 커밋 전에 `npm run typecheck`와 `npm run build`가 통과해야 한다.
- `main` 푸시는 곧 Render 배포다. `render.yaml`의 `plan: free`는 사용자 확인 없이 바꾸지 않는다.
- 버전을 올릴 때는 루트·shared·server·client의 `package.json`을 모두 맞추고 `CHANGELOG.md`를 갱신한다.
