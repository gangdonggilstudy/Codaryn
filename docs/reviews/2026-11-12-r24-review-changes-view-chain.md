# R-24 병합 전 검토: 변경 보기 후속의 전체 사슬 (DR-29, DR-32 (c), R-16 L-1)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다. 저장소 파일 수정과 커밋은 없다.
- **검토 대상(고정)**: `pm/bundle-2` = `47756b4549c258fa00e9d3d7dc9d782bec57f739`(9개 브랜치를 합친 PM 통합 트리). 기준은 main `eb3eeeb`이다.
- 범위(`git diff main...pm/bundle-2`)
  - `src/tools/index.ts`: `write_file`이 가린 표기의 다이제스트를 기록한다(`saveOriginal`의 `shownOriginal`, `saveNext`).
  - `src/store/changes.ts`: `shown-<n>.json`의 쓰기·읽기, `readRunOriginals`.
  - `src/store/apply-revert.ts`: parked(남은 위치), `listParkedFiles`.
  - `src/app/changes.ts`: 지금 비밀로 다시 계산한 다이제스트와 기록의 비교(`changeShownMatches`)와 표시.
  - 관련 계약 `src/contracts/changes.ts`. doctor의 parked 점검(`src/cli/doctor.ts`)은 내 코드(`1307b21`)라 따로 표시했다.
- 대조한 결정: DR-29(보기는 그 실행처럼 가려질 때만 글을 보인다), DR-32 (c)(조각 대신 조각의 다이제스트를 기록), R-16 L-1(남은 파일을 알린다).
- 실험
  - 빌드 사본: `git archive 47756b4`를 내 worktree의 `.codaryn/r24/b`에 풀고 `tsc`로 빌드했다.
    - typecheck 오류 3건은 모두 `src/i18n`(en, ko, params)이다. DR-36 글이 이 묶음에 없어서이고, 산출물은 만들어진다.
  - 실제 CLI 프로세스(`dist/src/cli/main.js run`, `changes --json`, `doctor --json`)와 실제 엔진·도구·store를 썼다. 모델은 scripted이다.
  - 비밀 값은 키 모양이 아닌 가짜 값 하나다(task `privacy.secretEnv`로 등록).
  - 실제 API·외부 네트워크·키 파일은 쓰지 않았다. 작업 공간은 모두 `.codaryn/r24/w/` 아래에 두었다.
  - 스크립트: `.codaryn/r24/exp24.mjs`(A~D), `.codaryn/r24/exp24-lock.mjs`(D4). 기록: `.codaryn/r24/exp24.log`.

## 1. 요약

- 높음 0, 중간 0, 낮음 2, 정보 5.
- 다음 경우에는 모두 실제 도구가 만든 기록으로 글이 나오지 않았다(path와 상태만, `masking_unverified`).
  - 다른 비밀: 비밀이 든 파일만 글이 없고, 비밀이 없는 파일은 그대로 보인다.
  - 맞지 않는 기록: 서로 바뀐 기록, 옛 버전 기록.
  - 기록 없음.
  - 실행 뒤 바뀐 파일.
- 같은 비밀이면 글이 가려진 채 보이고, 비밀 값은 출력에 없다.
- `shown-<n>.json`은 다이제스트와 SHA-256만 담는다. 보이는 조각이나 비밀 값이 없다. R-19 L-3의 "기록만으로 추측한 비밀 확인"은 더는 되지 않는다(I-1).
- 가리기에 실패한 쓰기는 글을 보일 기록을 남기지 않는다(I-2).
- parked 위치에는 사람의 파일 이름이 없고, doctor가 알린다. 다만 잠금 점검이 ok가 아닐 때 사람용 줄에는 빠진다(L-2, 내 코드).
- 기록 파일을 변조하면(다이제스트를 지금 값으로 바꿔 넣음) 다른 비밀로 볼 때 실행의 비밀 값이 그대로 출력된다(L-1).
  - 전제: 상태 디렉터리에 쓸 수 있어야 한다. 모델의 도구는 쓸 수 없고, task가 허용한 명령과 같은 사용자의 프로세스는 쓸 수 있다.

## 2. 재현 결과 (`exp24.log`)

### A. 실제 실행이 남긴 기록

- 작업 공간: `conf.txt`(셋째 줄에 등록한 비밀 값), `plain.txt`(비밀 없음).
- 대본: `read_file conf.txt` → `write_file conf.txt replace_text "mode a" → "mode b"` → `write_file plain.txt`.
- 결과: `needs-input/no_verifier`. 스냅숏 폴더에 `1.orig, 2.orig, index.json, shown-0.json, shown-1.json`이 생겼다.

| # | 경우 | 결과 |
| --- | --- | --- |
| A1 | 같은 비밀로 `changes` | conf.txt 글이 보이고(`unavailable: null`) 가려졌다. 출력에 비밀 값 없음 |
| A2 | 다른 비밀(secretEnv 없음) | conf.txt `masking_unverified`, before·after null. plain.txt는 글이 보임. 출력에 비밀 값 없음 |
| A4 | 실행 뒤 conf.txt를 바꿈 | `changed_since_run`, `masking_unverified` |
| A5 | `shown-*.json`을 지움(DR-29 전 실행과 같음) | 두 파일 모두 `masking_unverified` |
| A6 | 두 기록을 서로 바꿈 / 옛 버전(`schemaVersion: 1`) | 바꾼 쪽은 두 파일 모두 글 없음. 옛 버전은 그 파일만 글 없음 |
| A7 | 실행 디렉터리의 모든 파일에서 비밀 값과 보이는 글을 찾음 | `shown-*.json`에는 둘 다 없다. 비밀 값은 `snapshots/1.orig`(되돌리기용 원본)에만 있다(I-1) |
| A3 | 기록 변조(아래 L-1) | conf.txt 글이 보이고(`unavailable: null`) **출력에 비밀 값이 그대로 있다** |

- 기록 예: `{"schemaVersion":2,"path":"conf.txt","original":"<64 hex>","next":{"sha256":"<64 hex>","partsDigest":"<64 hex>"}}`.

### B. 상태 디렉터리에 쓸 수 있는 것

| # | 경우 | 결과 |
| --- | --- | --- |
| B1 | 모델의 `write_file`로 `.codaryn/runs/probe.json` | `policy_denied`. 파일 없음 |
| B2 | task가 허용한 명령(`node touch.cjs`)이 `.codaryn/`에 파일을 씀 | 써졌다. `run_command` ok, 실행은 `needs-input` |

### C. 가리기에 실패한 쓰기(실제 도구·store, 표지가 든 글에서만 실패하는 대역 게이트웨이)

- 원본을 가릴 수 없을 때: 도구가 쓰지 않는다(`masking_failed`, "masking the current file failed"). 기록도 없다.
- 쓴 글만 가릴 수 없을 때(C1): 쓰기는 됐다. 기록은 `{ original: <digest>, next: null }`이고 `saveNext`가 없었다. 그래서 `changeShownMatches`는 거짓이고 글은 보이지 않는다.
- 실제 게이트웨이는 내부 예외일 때만 실패하므로, 실제 입력으로는 이 경우를 만들 수 없었다. 묶음의 시험(`g-change-shown-write`)과 같은 방법을 썼다.

### D. parked(남은 위치)

| # | 경우 | 결과 |
| --- | --- | --- |
| D1 | `removeSecondName`에서 되돌려 놓기 전에 다른 파일이 그 이름에 생김(실제 `link`가 EEXIST). 사람 파일 이름은 `salary-review-for-kim.txt` | `{"kind":"parked","path":".codaryn/parked/<runId>/3-<16 hex>"}`. `listParkedFiles`도 같은 경로. 파일 이름 없음 |
| D2 | `doctor --json`(잠금 없음) | `lock`: `warn`, `doctor.lock.parked_left {count: 1}`. 메시지·글에 이름 없음 |
| D3 | 끝난 프로세스의 잠금(stale, 점검은 ok) | D2와 같다(parked 경고가 대신함) |
| D4 | 살아 있는 프로세스의 잠금(held, 점검은 warn) | JSON `message`에는 parked가 있다. 글은 `doctor.lock.held`뿐이라 **사람용 줄에는 parked가 없다**(L-2) |
| D5 | parked 아래에 run id 이름의 정션(밖의 폴더를 가리킴)을 심음 | `listParkedFiles`가 따라가지 않았다 |

- 되돌리기 결과의 `skipped[].parkedAt`(JSON)과 사람용 요약의 수(`revert.parked`)는 코드(`src/cli/human/output.ts`)와 묶음의 시험(`c0856a9`)으로 확인했다. 실제 되돌리기로 parked를 만들어 보지는 않았다(링크를 쓸 수 없는 볼륨이나 경쟁이 필요하다).

### 묶음의 시험

- `g-change-shown-write`, `app/dr29-changes`, `app/r11-changes`, `cli/changes`, `cli/g-doctor-parked`, `store/changes`: 74건 모두 통과(같은 빌드).

## 3. 낮음

### R24-L-1 상태 디렉터리에 쓸 수 있는 명령이 기록을 바꾸면, 다른 비밀로 본 변경 보기가 실행의 비밀 값을 그대로 보인다

- 위치
  - `src/app/changes.ts`: `changeShownMatches`가 기록을 믿는다.
  - `src/store/changes.ts` `readShown`: 모양만 검사한다.
  - 계약 `ChangeShown` 주석.
- 재현(A3)
  - A의 실행 뒤 `snapshots/shown-0.json`을 다시 썼다. `original`, `next.partsDigest`는 비밀 없이 가린 원본·현재 글의 다이제스트이고, `next.sha256`은 현재 파일의 SHA-256이다.
  - 그 뒤 다른 비밀(secretEnv 없음)로 `codaryn changes --json`을 실행했다.
  - 결과: conf.txt가 `unavailable: null`로 before·after를 보였고, 출력에 실행 때 등록한 비밀 값이 그대로 있었다.
  - 기록을 원래대로 돌리면 다시 `masking_unverified`다.
- 전제
  - 모델의 도구는 `.codaryn` 아래에 쓸 수 없다(B1, `policy_denied`).
  - task가 허용한 명령은 쓸 수 있다(B2). 그런 명령이 있는 실행이면 모델이 그 명령을 부를 수 있고, 지금 실행의 기록뿐 아니라 이전 실행의 기록도 바꿀 수 있다.
  - 같은 사용자의 다른 프로세스도 쓸 수 있다.
- 영향
  - DR-29의 "그 실행처럼 가려질 때만 글을 보인다"는 기록이 정직할 때만 성립한다. 기록에는 인증이 없다.
  - 드러나는 값은 사람의 작업 공간 파일에 이미 있는 값이다. 그 명령도 파일을 직접 읽을 수 있다. 출력은 로컬(CLI, GUI)로만 간다.
  - 그래서 밖으로 새는 새 경로는 아니고, 가림 규칙이 깨지는 경로다. 낮음으로 둔다.
  - 같은 전제로 저널·스냅숏 같은 다른 상태 파일도 바뀔 수 있다. 이 검토 범위보다 넓은, 전부터 있던 성질이다.
- 권고(담당: 계약·엔진·앱 계층, PM 판단)
  1. 계약(`ChangeShown`)과 어댑터 계약에 한계를 적는다. 이 기록은 모델의 도구에 대해서만 믿을 수 있고, 상태 디렉터리에 쓸 수 있는 명령이나 프로세스는 바꿀 수 있다.
  2. 실행 중 막기: 엔진이 `run_command` 앞뒤로 `.codaryn/runs/`의 목록·크기·수정 시각(또는 기록 파일 해시)을 비교한다. 바뀌었으면 그 실행을 실패나 알림으로 끝낸다. 허용한 명령이 이전 실행의 기록을 바꾸는 경로도 잡는다.
  3. 같은 사용자의 프로세스는 막을 수 없다(키를 어디에 두어도 그 사용자가 쓸 수 있다). 1로 충분한지 PM이 정한다.

### R24-L-2 잠금 점검이 ok가 아니면 doctor의 사람용 줄에 parked 파일이 빠진다 (내 코드 `1307b21`)

- 위치: `src/cli/doctor.ts` 잠금 점검. parked 수는 `message`에 덧붙지만, 글은 `doctor.lock.<state>` 그대로다.
- 재현(D4)
  - parked 파일 하나가 있고, 살아 있는 프로세스가 잠금을 쥔 작업 공간에서 doctor를 실행했다.
  - JSON `message`: "... remove that file; 1 file(s) a revert could not put back are in .codaryn/parked/ ..."
  - 사람용 줄: `[warning] workspace lock  a running process holds the workspace lock; ...`. parked가 없다.
  - `unreadable`, `reclaim_left`도 같은 길이다(코드).
- 영향: 그동안 사람은 남은 파일을 모른다. R-16 L-1의 "알린다"가 사람용 출력에서 그 경우에만 빠진다.
- 권고(담당: CLI, 나): DR-36 (b)의 `DoctorCheck.notes`로 `doctor.lock.parked_left {count}`를 잠금 점검의 메모로 싣는다. 사람용 출력은 메모를 점검 줄 아래에 보인다(`7547ac1`에서 렌더러가 이미 메모를 보인다). 재현 시험을 먼저 넣는다.

## 4. 정보

- **I-1 R-19 L-3(추측한 비밀 확인)**
  - 기록만으로는 더는 되지 않는다(A7, A8). `shown-*.json`에는 보이는 조각이 없다.
  - 저널로는 된다. 모델이 그 파일을 읽었으면 저널의 `read_file` 결과(가린 글)에서 조각을 얻고, 저널의 `previousHash`와 맞춰 볼 수 있다. 맞는 추측은 일치했고 틀린 추측은 일치하지 않았다.
  - 다만 같은 실행 디렉터리의 `snapshots/<n>.orig`에는 되돌리기용 원본이 평문으로 있다(DR-14, A7). 실행 디렉터리를 읽을 수 있는 사람에게는 이 확인이 새 정보를 주지 않는다. 계약 주석(`ChangeShown`)이 이 성질을 적고 있다.
- **I-2 가리기 실패**
  - 원본을 가릴 수 없으면 쓰지 않는다. 쓴 글을 가릴 수 없으면 `next: null`이라 글을 보이지 않는다(C).
  - 두 번째 쓰기에서 실패해도 앞 기록의 `next.sha256`이 지금 파일과 달라서 글이 보이지 않는다(코드).
- **I-3 기록의 검사(`readShown`)**: 정확한 키, 버전 2, 그 항목의 경로, 원본이 있었는지와 맞는 `original`, SHA-256 모양, 일반 파일(링크 아님), 크기 상한. A6의 바뀐 기록과 옛 버전은 모두 걸렸다.
- **I-4 parked 이름과 링크**: 위치는 `<행동 번호>-<무작위 16 hex>`이고 사람의 파일 이름이 없다(D1). 정션으로 심은 run 폴더는 따라가지 않는다(D5).
- **I-5 묶음의 typecheck**: `src/i18n/en.ts`, `ko.ts`, `params.ts`에서 3건. DR-36의 문구 id와 매개변수 종류에 글이 없어서다(N-B). 이 검토의 동작에는 영향이 없었다.

## 5. PM 판단 필요

- P-1(L-1): 한계를 계약에 적는 것으로 둘지, 실행 중 상태 디렉터리 변경 감지(권고 2)를 엔진에 더할지.
- P-2(L-2): 내 코드라 내가 고치는 것으로 하면, DR-36 정렬과 같은 묶음에서 낸다.

## 6. 실행한 것

- 읽기
  - `git diff main...pm/bundle-2 -- src/tools src/store src/app/changes.ts src/contracts/changes.ts src/cli/doctor.ts`
  - `git show pm/bundle-2:<파일>`(계약, store, 앱, 도구, doctor)
  - DR-29, DR-32, R-16, R-19의 결정·보고
- 빌드: `git archive 47756b4` → `.codaryn/r24/b`, `tsc`(오류 3, i18n)
- 실험: `exp24.mjs`(A0~A8, B1~B2, C1, D1~D3), `exp24-lock.mjs`(D4), 정션 확인(D5)
- 묶음의 시험 74건(같은 빌드)
- 저장소 파일 수정·커밋 없음. 실제 API·외부 네트워크 미사용.
