# R-21 검토 보고서: GUI GU-3~7 (`claude/gui-design` 9c36f5b, `gui/**`)

```
검토자: w3:pA (구현자가 아닌 세션), 읽기 전용. 파일 수정·커밋 없음
대상: claude/gui-design 9c36f5b (main fdd6479 병합 판)
  72074f1 GU-6 설정·프로필·모델 선택
  5c9e178 GU-3 새 작업·진행·취소·결과
  f2ac072 GU-4 실행 목록·되돌리기 미리보기
  45037b4 GU-5 계획 승인(DR-21 동의)·사람 확인
  a914c63 변경 보기(DR-29, 3.4)
  (R10b 수정 d7d3d92, 0e56d2c는 범위 밖, 연기 시험으로만 지나감)
기준: docs/design/standalone-gui.md, DR-20, DR-21, DR-26, DR-29(docs/work-orders/phase-4-5-design.md)
결과: 높음 0, 중간 1, 낮음 0, 참고 6
실행: 루트 typecheck 오류 0 / GUI 빌드·금지 API 검사 통과 / lock 검사 통과 / GUI 유닛 97건 중 97 통과
      / 연기 시험 82건 중 72 통과(그대로), 한 줄 고친 사본에서 82/82(M-1) / 탐침 4개(4절)
실행하지 않은 것: 실제 API(연기 시험과 탐침은 loopback 가짜 API), 새 설치·내려받기, 하드 링크 없는 드라이브의 실제 동의 흐름
```

- 실험은 `git -C D:\project\Codaryn archive 9c36f5b`를 이 worktree의 `.codaryn/r21/tree`(Git이 무시하는 곳)에 풀어서만 했다.
- Electron은 `claude-gui/gui/node_modules/electron/dist/electron.exe`를 경로로만 썼다.
- 연기 시험은 브랜치의 `smoke.mjs`에서 Electron 경로 한 줄만 바꾼 사본으로 돌렸다.
- 실행 뒤 `electron.exe`가 남지 않았다.

## 1. 중점별 결론

| 중점 | 결론 | 근거 |
| --- | --- | --- |
| 화면이 받는 값에 가리지 않은 글·키·환경 값 | 없음 | 엔진 호스트에서 실제 실행을 돌리고 메인으로 가는 줄을 모두 봤다(`host-events.mjs`): 진행 항목 8개와 끝 메시지에 설정 `secretEnv` 값, 가짜 키, 작업 공간 경로, API 주소가 없다(모델이 비밀을 읽고 쓰고 말해도). Electron에서도 화면 글과 `listRuns`·`changes`·`settings` 답에 비밀·키·API 주소가 없었다. 설정 보기는 표시 형태, 모델 id, 프로필 요약, 키·`CODARYN_MODEL`·`CODARYN_LANG`이 있는지(불리언)만 준다. 작업 공간 전체 경로가 화면에 나오는 곳은 최근 목록뿐이다(참고 I-1) |
| preload 통로 | 좁음 | 새 채널 12개(main 8개 → 20개)는 상수 이름이다. preload가 문자열·불리언·0 이상 정수로 바꾸고, 메인이 보낸 쪽과 모양(핸들·실행 id·토큰 형식, 모르는 필드 거부, 길이 상한)을 본 뒤 엔진 호스트도 다시 본다. 작업 공간은 핸들로만 받고 경로 문자열은 받지 않는다. 되돌리기는 미리보기 토큰, 적용은 승인 토큰, 모델 선택은 목록 항목 id로만 받는다. 연기 시험: 위조 토큰 `unknown_preview`·`unknown_plan`, `latest`는 `invalid_args`, 나열하지 않은 실행은 `unknown_run`, 두 번째 시작은 `run_active` |
| 계획 승인 | 전체 다이제스트와 사람의 동작으로만 | 계획 보기의 다이제스트(64자리 16진수로 확인)를 메인이 승인 토큰에 묶는다. 화면은 토큰만 보낸다. 적용 전 메인이 OS 대화상자로 묻는다(기본 "적용 안 함", 다이제스트 앞 12자·개수만 표시). 엔진 호스트는 64자리 다이제스트만 받는다 |
| DR-21 동의 | 사람이 누를 때만, 재사용 없음 | 기본 꺼짐(`askConsent: false`). 그 승인 토큰의 앞 적용이 `consent_required`로 끝났을 때만 물을 수 있다(아니면 `consent_not_asked`, 연기 시험). 메인의 별도 대화상자(기본 "동의하지 않음")에서 동의해야 `consent: true`이고, 엔진 호스트는 그 계획의 다이제스트로만 `unsafeMoveConsent`를 만든다. 적용이 시작되면 그 표시를 지우고, 다른 이유로 끝나면 토큰을 버린다. 다른 계획·다른 실행에 쓰일 길이 없다 |
| 권한을 넓히는 설정 변경 | 해당 없음 | GU-6에는 설정 변경(제안·적용) 통로가 없다. 읽기와 모델 선택(`models --use`)뿐이다. 모델 선택은 넓히기가 아니다 |
| 취소가 엔진까지 | 간다 | 화면의 `cancelRun` → 메인이 실행 토큰으로 → 엔진 호스트가 그 핸들의 `cancel()`. 연기 시험 `cancelDone: cancelled`. 메인이 사라지면 호스트가 모든 실행을 취소한다(`serve`의 `cancelAll`) |
| 바깥 요청·듣는 소켓 | 없음 | 연기 시험: 앱 프로세스의 TCP 0, UDP 0, 바깥 연결 0, 사전 내려받기 없음, 디버깅 스위치 종료, 앱 종료·메인 강제 종료 때 호스트 종료. 가짜 API(loopback)로 간 요청은 모두 가짜 키만 실었다 |

## 2. 결과

### 중간

#### R21-M-1 병합된 판에서 GUI의 계획 보기·적용·사람 확인·변경 보기가 모두 실패한다(`--workflow` 값 없음)

- 위치
  - `gui/src/engine-host/runs.ts` `taskForm`: `{ input, configPath, varsFile, profile }`로 `workflowRef`가 없다. 형이 없는 `Obj`라 컴파일러가 잡지 못한다.
  - `src/app/apply.ts` `taskFormArguments`: `settings.workflowRef !== null`이면 `--workflow`를 더한다. `src/app/app.ts` `runRequestOf`는 그 값을 그대로 옮기고 `runArguments`(130행)가 같은 조건으로 더한다. R-14 L-3(`52400ab`, main `13474e3`)에서 `TaskForm.workflowRef`를 필수로 했다.
- 재현
  - `taskform-gap.mjs`(빌드된 앱 계층)
    - 호스트 모양의 형식으로 `taskFormArguments`는 `["--workspace","W","--workflow",undefined]`를 만든다.
    - `changes`는 `workflowRef: null`이면 `ok`, 필드가 없으면 `invalid_arguments: --workflow needs a value`다. `plan`도 같다.
  - 연기 시험 그대로: 82건 중 72 통과. 실패 10건은 `changesShown`, `changesRows`, `planShown`, `planActions`, `applyByWorkflow`, `consentUnasked`(앞의 계획 실패 때문에 `invalid_args`), `applyDone`, `applyMoved`, `reviewRecorded`, `closeGuard`다.
  - 빌드 사본의 `taskForm`에 `workflowRef: null` 한 줄만 더하면 82건 모두 통과했다. 원인은 이것 하나다.
- 영향
  - 보안 문제는 아니다(실패는 실행 전 거부이고 아무것도 바뀌지 않는다).
  - 그러나 이 판을 main에 병합하면 GU-5 전체와 변경 보기가 동작하지 않는다.
  - GUI 브랜치의 연기 시험은 main 병합 전 판에서는 통과했을 것이다 [추정].
- 권고
  - GUI 담당: `taskForm`에 `workflowRef: null`을 둔다. 형을 앱 계층의 `TaskForm`으로 맞춰 컴파일러가 잡게 한다.
  - 앱 계층(w3:pA, 나): 요청이 JSON 통로를 지나오므로 빠진 `workflowRef`를 `null`로 읽는다(`?? null`). `taskFormArguments`와 `runRequestOf`에 한 줄씩이다. PM 지시가 있으면 고친다.
  - 병합 전 연기 시험을 병합된 판에서 돌린다.

### 참고 (건수에 넣지 않음)

- I-1 최근 작업 공간 목록이 폴더 전체 경로를 화면에 보인다(재현: 홈 화면 글에 `D:\…\ws`). R-10b I-2와 같다. 두 번째 시작으로 들어온 폴더는 대화상자에서 고른 것이 아니다.
- I-2 엔진 호스트의 표시용 정리(`shown`, `gui/src/engine-host/main.ts:159`)는 `ANTHROPIC_API_KEY` 값만 숨긴다. main에 지금 다른 제공자의 키 변수가 없어 맞다. 두 번째 제공자의 키 변수가 들어오면 그 값도 숨겨야 한다.
- I-3 `listModels`는 화면이 부르면 메인이 확인 없이 실제 API를 부른다(설계 3.10·339행: "사람이 '목록 가져오기'를 누를 때만 부른다"). 화면의 단추로만 부르지만, 침해된 화면이면 키로 목록 요청을 되풀이할 수 있다. 키가 밖으로 나가는 길은 아니다.
- I-4 동의로 다시 적용할 때는 적용 확인 대화상자 대신 동의 대화상자 하나만 나온다. 같은 계획을 앞서 확인했으므로 의도에 맞다. 동의 대화상자에 다이제스트 앞 12자가 나온다.
- I-5 변경 보기는 앱 계층이 글을 주어도 엔진 호스트가 `before`·`after`를 버리고, 메인은 그 키가 있으면 거부한다(경로·상태만). DR-29의 앱 계층 구현(`89692ac`, 미병합)이 들어와 기록이 있는 실행에서 글을 보여도 GUI는 아직 보이지 않는다. 다음 GU 일이다.
- I-6 하드 링크 없는 드라이브의 실제 `consent_required` → 동의 → 적용 흐름은 재현하지 않았다. 코드와 연기 시험의 거부 경우(`consent_not_asked`, 위조 토큰)로만 봤다.

## 3. 그 밖에 확인한 것

- 화면 코드
  - 금지 HTML API 검사가 빌드에서 통과했다. `fetch`·`location`·`window.open`·HTML 삽입이 없다.
  - 속성은 `id`, `class`, `role`, `type`, `for`, `data-*`만 쓴다.
- 이벤트
  - preload는 `plain()`(JSON 사본)으로 넘기고 이벤트 객체를 넘기지 않는다.
  - 메인은 실행 토큰이 맞는 메시지만 보내고, 끝 결과는 `toRunResultView`로 필드마다 다시 본다.
  - 엔진 호스트의 진행 항목은 CLI의 `progressLine`(공용 문구)에 `cleanText`·`hideKeys`를 더한 것이다.
- 되돌리기: 나열한 실행만 미리보기할 수 있다. 미리보기 토큰은 한 번 쓰면 버린다. 메인 대화상자(기본 "되돌리지 않음")를 거친다.
- 대화상자 글: 값은 개수, 실행 id, 다이제스트 앞부분뿐이다(경로·목표 없음).

## 4. 실행 기록

- 빌드·유닛·lock: 위 머리글.
- 연기 시험
  - 그대로: 72/82(`smoke.txt`)
  - `taskForm`에 `workflowRef: null`을 더한 사본: 82/82(`smoke-patched.txt`). 빌드 파일은 실행 뒤 원래대로 되돌렸다.
- 탐침: 모두 `D:\project\Codaryn\.worktrees\claude-adapter\.codaryn\r21\probes\` 아래에 있다.
  - `taskform-gap.mjs`: M-1
  - `host-events.mjs`: 엔진 호스트의 진행·끝 줄 노출 검사
  - `run-secret.mjs`·`secret-run.mjs`: Electron 화면과 API 답 노출 검사, I-1
  - 위 사본에서 돌렸고, 끝난 뒤 되돌렸다.

## 5. 고친 것

없음(읽기 전용 검토).
