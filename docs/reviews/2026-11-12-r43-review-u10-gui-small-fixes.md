# R-43 병합 전 검토: 단위 U-10 (R38-L-1, R-39 I-3)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: unit/U-10-p5u-gui 24c4ead (main a7f3a2f 위 커밋 하나, 5개 파일 +38/-1, gui/ 만)
결과: 높음 0, 중간 0, 낮음 0, 참고 3
실행(24c4ead 를 이 worktree 의 .codaryn/r43/tree 에 풀어 빌드):
  루트 빌드 0
  GUI npm test: 빌드·lock 검사 통과, GUI 유닛 148건 중 148 통과(새 시험 2건 포함)
  연기 시험 한 번: 155건 중 155 통과
  Electron 은 claude-gui 의 설치된 것을 경로로만 썼다. smoke.mjs 의 경로 한 줄만 바꾼 사본으로 돌렸고, 새로 내려받지 않았다
  끝난 뒤 electron.exe 없음
실행하지 않은 것: Linux 의 실제 저장 대화상자, 실제 API
```

## 1. 중점별 결론

| 중점 | 결론 | 근거 |
| --- | --- | --- |
| R38-L-1이 닫혔는가 | **닫힘. Linux 실기 확인은 남음** | `gui/src/main/app.ts`의 `chooseSavePath`가 `saveDialogOptions`를 쓴다(`gui/src/main/save-file.ts`). 그 함수는 기본 위치와 md 걸러 보기를 그대로 두고 `properties: ["showOverwriteConfirmation"]`을 더한다. 창이 있을 때와 없을 때 두 `showSaveDialog` 호출이 같은 옵션을 받는다. Electron에서 이 속성은 Linux에만 뜻이 있다. Windows·macOS 대화상자는 원래 덮어쓰기를 묻는다. 새 유닛 시험이 옵션을 고정한다 |
| 새 문구가 두 언어로 있는가 | **있음** | `gui/src/renderer/i18n/en.ts:414`, `ko.ts:416`의 `error.plan_records_changed`. 새 시험이 두 언어 모두 키가 있고 `error.default`와 다름을 본다 |
| 창에 실제로 이 문구가 나오는가 | **나옴** | CLI `runApply`(`src/cli/plan-commands.ts:382`)가 묻기 전에 `plan_records_changed`로 거부한다. 앱 계층은 코드를 그대로 넘긴다. GUI의 `hostCodeOf`는 `^[a-z][a-z0-9_]{0,63}$`에 맞는 코드를 그대로 두고, `errorText`가 `error.<code>`를 찾는다 |
| CLI의 뜻과 같은가 | **같음. 까닭 한 구절이 빠짐(I-1)** | 아래 비교 |

뜻 비교(CLI `src/i18n/*.ts`의 `error.plan_records_changed.what`/`.fix`, GUI의 `error.plan_records_changed`):

| 뜻 | CLI | GUI en | GUI ko |
| --- | --- | --- | --- |
| 계획 실행에 기록 변경 표시가 있음 | 있음 | 있음 | 있음 |
| 실행이 아닌 것이 기록을 바꿨음 | 있음 | 있음 | 있음 |
| 그래서 계획이 읽은 것과 다를 수 있음 | 있음 | **없음** | **없음** |
| 아무것도 바꾸지 않았음 | "nothing was asked or changed" | "not applied (nothing was changed)" | "적용하지 않았습니다(아무것도 바꾸지 않음)" |
| 계획을 새로 만들고, 읽고, 그것을 적용 | `codaryn plan`으로 | 같은 작업 종류로(창에 맞는 말) | 같은 작업 종류로 |
| 표시가 있는 실행은 증거로 남음 | 있음 | 있음 | 있음 |

두 언어의 GUI 문구는 서로 같은 뜻이다.

## 2. 참고 (건수에 넣지 않음)

- **I-1** GUI 문구에 CLI의 까닭 "그 계획이 읽은 것과 다를 수 있어 / its plan may not be the one you read"가 없다.
  - 사람이 할 일(새 계획을 만들어 확인하고 적용)과 결과(아무것도 바뀌지 않음)는 같다.
  - 왜 다시 만들어야 하는지는 이 구절이 알려 준다. 넣으면 CLI와 똑같아진다. 선택 사항이다.
- **I-2** 새 시험의 Windows 경로 글자 `"C:\Users\me\Documents\codaryn-report-x.md"`(`gui/tests/unit/u10-fixes.test.ts`)는 JS 문자열이다.
  - 그래서 역슬래시가 이스케이프로 사라져 값이 `C:UsersmeDocumentscodaryn-report-x.md`가 된다.
  - 넘긴 값과 기대한 값이 같은 글자라 시험은 맞게 통과한다. 시험의 뜻(기본 위치가 그대로 지나감)도 지켜진다.
  - 보기에 쓴 경로만 Windows 경로가 아니다. `\\`나 `path.join`을 쓰면 된다.
- **I-3** 연기 시험은 저장 대화상자를 주입점(`answerSaveDialog`)으로 대신하므로 `saveDialogOptions`를 지나지 않는다.
  - R38-L-1이 닫혔다는 근거는 유닛 시험, 코드 읽기, Electron 문서다.
  - Linux 실기 확인은 Linux 검증 때 한다.
  - 엔진이 잠금 아래에서 다시 확인해 `failed`/`plan_stale`로 끝내는 길(`src/contracts/plan.ts:603`)에서는 이 문구가 아니라 `plan_stale` 쪽 표시가 나온다. 이번 범위 밖이다.

## 3. 실행 기록

- 빌드·GUI npm test: `.codaryn/r43/gui-test.txt`, `root-build.txt`
- 연기 시험: `.codaryn/r43/smoke-1.txt`
- 문구 비교: `git -C D:/project/Codaryn show 24c4ead:gui/src/renderer/i18n/{en,ko}.ts`, `git grep plan_records_changed a7f3a2f -- src/i18n`
