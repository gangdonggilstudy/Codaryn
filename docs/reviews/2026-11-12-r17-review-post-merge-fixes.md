# R-17 읽기 전용 검토: 병합 뒤 작은 수정 (2026-11-12)

## 0. 이해 확인

- 페르소나: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 구현자가 아닌 세션이며 저장소 파일을 바꾸지 않았다. 실험은 `.codaryn/r17` 빌드 사본에서만 했다.
- 기준: main `b05da45`. 15:02:24에 고정했다.
  - `claude/adapter-contract` **`45b8efc`**: `f7b858e`, `0363b69`, `b30bbce`, `52400ab`, `45b8efc`.
  - `claude/workspace-policy` **`fd7d3c3`**: `b5a131c`, `44c4864`, `fd7d3c3`.
  - 두 브랜치를 합친 트리: `git merge-tree --write-tree` → `11a4885`. 충돌 없음. 객체만 썼고 ref는 바꾸지 않았다.
- 대상 지적: R-14 L-1~L-3, I-4와 R-12 L-2~L-4. R-12 L-1은 PM 판단(P-1)을 기다려 범위 밖이다.
- 방법
  - `git log/diff main...<브랜치>`로 읽었다.
  - main, 두 브랜치, 합친 트리 네 사본을 빌드했다.
  - 앱 계층 재현은 빌드된 시험 보조(`tests/unit/app/support.js`)를 쓰고, `changes`는 실제 CLI 프로세스로 돌렸다(`r17.mjs`, `ascii.mjs`).
  - 가짜 값과 scripted 모델만 썼다. API 주소는 닫힌 루프백이다. 실제 API 미실행.

## 1. 결과

- **막힘: 6건 중 4건.** R-14 L-1, L-2, L-3, R-12 L-4가 막혔다. R-14 I-4(정보)도 고쳐졌다.
  - R-12 L-2: 문구 id를 기다리는 todo 시험으로 남았다.
  - R-12 L-3: 이번 커밋들의 범위 밖이라 그대로다.
- **새 발견: 1건(낮음, 문서).** 정보 4건. 고정 뒤 올라온 `0f0099b`(필수 형 변경)도 봤고 문제는 없었다(7절).
- 검사 수치

| 사본 | typecheck | 유닛 | 통합 |
| --- | --- | --- | --- |
| main `b05da45` | 오류 0 | 1508건 중 1503 통과, 0 실패, 3 건너뜀, todo 2(PM 수치) | 519/519(PM 수치) |
| adapter-contract `45b8efc` | 오류 0 | 1512건 중 1508 통과, 0 실패, 3 건너뜀, todo 1 | 519/519 |
| workspace-policy `fd7d3c3` | 오류 0 | 1512건 중 1506 통과, 0 실패, 3 건너뜀, todo 3 | 519/519 |
| 둘을 합친 트리 `11a4885` | 오류 0 | 1516건 중 1511 통과, 0 실패, 3 건너뜀, todo 2 | 519/519 |

## 2. 항목별 (main → 브랜치, 같은 입력)

| 지적 | 커밋 | main | 고친 판(ac, 합친 트리) | 판정 |
| --- | --- | --- | --- | --- |
| R-14 L-1 손상 실행의 `changes` | `0363b69` | 검토의 위조 실행(미래 시각, journal만)에서 `changes`가 `ok`이고 `forged-path.md`를 낸다. CLI는 종료 0 | 앱·CLI 모두 `invalid_run_record`(종료 2, JSON 한 줄)이고 경로가 나오지 않는다 | 막힘 |
| 같은 L-1 덧붙임(D1) 대소문자 변형 id | `0363b69` | `invalid_run_record` | `run_not_found`(N-27 a와 같음). 앞쪽 `T`→`t`, 뒤쪽 16진수 대문자 둘 다 확인 | 막힘 |
| R-14 L-2 명령 검증기 추가 | `b30bbce` | 넓히기 `[]`, 확인 없이 써짐 | `verifier_command_added@verifiers[0]`. 확인 없는 적용은 `invalid_arguments`이고 파일은 그대로다. 확인하면 써진다. 인자를 바꾸면 `verifier_removed`와 `verifier_command_added`가 함께 나온다 | 막힘 |
| R-14 L-3 `TaskForm.workflowRef` | `52400ab` | 간편 형식 적용이 `run_not_plan` | `--workflow organize`로 `apply:done/verified`이고 파일이 옮겨졌다. task 형식에 `workflowRef`를 함께 주면 `invalid_arguments`, 없는 워크플로는 `invalid_config` | 막힘 |
| R-14 I-4 낡은 글 | `52400ab`, `45b8efc` | `app.ts:438` 주석, `adapter-contract.md:173` | 둘 다 고쳐짐 | 고침 |
| R-12 L-4 앱 DR-28 시험 todo | `f7b858e` | todo 표시 2곳 | `plan-review.test.ts`에 todo 없음. 그 시험이 실제로 돌아 통과한다 | 막힘 |
| R-12 L-2 간편 형식 설정 안내가 stderr에 없음 | `44c4864` | JSON `message`에만 | 같다. stderr 경우는 `tests/unit/cli/g-r12.test.ts:51` `todo`("문구 id(계약 담당)와 두 언어 글(N-B)")다. `cli-contract.md`가 알려진 차이로 적었다 | 안 막힘(대기) |
| R-12 L-3 `changes` 경로의 토큰 겹침 | 없음 | `notes-[[[[CODARYN_SECRET:…]]:…]].md` | 같다(네 사본 모두). 계약 문서 18.6은 "기록의 가린 경로를 지금 비밀로 한 번 더 가린 것"이라고만 적는다 | 안 막힘(범위 밖) |

`changes` 명령 확인(실제 CLI, 네 사본 같음, 표시만 다름)
- `--json`
  - stdout은 한 줄이고 `exitCode`가 종료 코드와 같다.
  - `kind: "changes"`, `masking: "current_secrets"`.
  - 파일마다 `before`·`after`가 `null`이다. `unavailable`은 `masking_unverified`이고, 경로에 토큰이 있으면 `masked_path`다.
- DR-29: 파일 글은 어느 사본에서도 나오지 않는다. 경로와 상태(`as_run_left`, `changed_since_run`)만 나온다.
- 글 출력(`b5a131c`)
  - wp와 합친 트리에서 "paths and states only … (DR-29)" 줄이 한 번 나오고, 파일마다 붙던 `(masking_unverified)` 줄이 없어졌다. `masked_path`는 파일마다 그대로 나온다.
  - main은 파일마다 `the text is not shown (masking_unverified)`이다.
- 비밀이 든 파일 이름에서 JSON, 글, stderr, 오류 출력 어디에도 비밀 값이 없다.
- 비ASCII 파일 이름(한글, é)에서도 stdout은 ASCII 한 줄이다. 0x80 이상 바이트 0개이고 JSON 경로는 원래 이름으로 돌아온다(N-19).
- `--workflow`를 주면 `invalid_arguments`(종료 2, JSON 한 줄)다. 문서 18.6의 "받지 않는다"와 같다.
- 손상·변형 id의 오류도 JSON 한 줄과 종료 코드 2를 지킨다.

## 3. 새 발견

### L-1(낮음, 문서) `cli-contract.md` 18.7의 공통 규칙에 `changes`가 빠졌다

- 위치: 합친 트리 `docs/cli-contract.md` 18.7 "기록을 읽는 명령의 공통 규칙"
  - 명시한 id는 `inspectRun`을 따르고, 손상 실행은 `revert`, `report`, `plan`, `apply`, `review`가 `invalid_run_record`로 거부한다고 적혀 있다.
  - `0363b69`(adapter-contract) 뒤로 `changes`도 같은 판정을 쓴다(위 2절, 실제 CLI 확인).
- 두 브랜치가 따로 쓰여 생긴 차이다. `fd7d3c3`의 문서 대조는 main 기준이라 `0363b69`를 보지 못했다.
- 18.6 `changes`에도 `run_not_found`·`invalid_run_record`가 적혀 있지 않다.
- 권고(CLI 문서 담당): 두 브랜치를 합칠 때 18.7의 목록에 `changes`를 더한다.

## 4. 정보

- **I-1** 손상의 종류
  - 실제 실행 디렉터리를 다른 과거 id로 복사하고 경로 하나를 바꾼 위조(내 변형 F1)는 main에서도 `invalid_run_record`였다. 기존 실경로 확인에 걸린다.
  - main을 통과한 것은 검토의 위조(journal만, 미래 시각)였다. 고친 판은 둘 다 막는다.
- **I-2** 넓히기 판정
  - 설정을 읽을 때 정규화되므로, 같은 명령 검증기의 키 순서를 바꾸거나 위치를 옮기면 넓히기로 잡히지 않는다(오탐 없음).
  - 프로필 안의 명령 검증기 추가는 원래대로 `profile_changed`다.
- **I-3** 간편 형식 `changes --workspace … --run latest`
  - 설정 파일이 없으면 `invalid_config`("limits.maxModelTurns is not set …")다. 읽기만 하는 명령도 실행 전 단계 1~8을 그대로 돌리기 때문이다(adapter-contract 설계).
  - stderr에는 "has an invalid value"와 일반 고치는 법만 나온다. R-12 L-2와 같은 뿌리다.
- **I-4** todo 수
  - wp가 R-12 L-2의 stderr 경우를 todo로 더해 1건 늘었다(main 2 → wp 3).
  - ac가 R-12 L-4를 지워 1건 줄었다. 합친 트리는 2건이다(위 L-2 대기 1, 엔진 `g-real-combination` 1).
  - L-2의 todo는 문구 id가 생기면 N-B(나)가 두 언어 글을 채우고 지울 몫이다.

## 5. 검사하지 않은 범위

- GUI(Electron) 화면과 메인 프로세스.
  - `gui/src/engine-host/host.ts`는 `TaskForm`이 아니라 자체 형을 써서 필수 필드 추가의 영향이 없음을 코드로만 봤다. GUI 빌드는 돌리지 않았다.
- Linux·macOS, 대소문자를 구분하는 볼륨.
- 실제 Anthropic API.
- R-12 L-1(PM 판단 P-1)과 R-13·R-15의 낮음 지적.

## 6. 재현 자료(`.codaryn/r17`, Git 추적 제외)

- 사본: `main/`, `ac/`, `wp/`, `both/`.
- `r17.mjs <사본>`: A(L-1, 앱과 CLI), B(L-2), C(L-3), D(`changes` CLI). 결과는 `rep-*.json`, 모은 표는 `rep-all.json`.
- `ascii.mjs <사본>`: 비ASCII 경로의 JSON 한 줄.
- 시험 출력: `unit-*.txt`, `int-*.txt`, `tc-*.txt`.

## 7. 검토 중 움직인 브랜치 (15:02 고정 뒤)

- `claude/adapter-contract`가 `0f0099b`(15:03)로 나아갔다. 지시의 "필수 형 변경"이 이 커밋이라 함께 봤다.
  - `0f0099b` feat(app): `CodarynApp`의 `plan`, `applyPlan`, `review`를 선택에서 필수로 바꿨다(PM 결정, A-5 질문 1). 형과 문서, 시험의 `!`·`?.` 정리만 있다.
  - 구현체는 `createCodarynApp` 하나이고 셋을 모두 갖는다. GUI 호스트(`gui/src/engine-host/host.ts:19`, `main.ts:40`)는 `CodarynApp`을 가져오지 않고 자체 부분 형(`HostApp`)을 써서 영향이 없다. GUI 빌드는 돌리지 않았다.
  - `0f0099b` 사본: typecheck 오류 0, 유닛 1512건 중 1508 통과·0 실패·3 건너뜀·todo 1, 통합 519/519.
  - `0f0099b`와 `fd7d3c3`을 합친 트리(`69c4c99`, 충돌 없음): typecheck 오류 0, 유닛 1516건 중 1511 통과·0 실패·3 건너뜀·todo 2, 통합 519/519.
  - `r17.mjs` 결과는 실행 id와 무작위 16진수를 지우고 비교하면 `45b8efc`, 그리고 합친 트리와 모든 필드가 같다. 2절 판정은 그대로다.
- `claude/workspace-policy`가 `f02bcc0`(15:07, `main` 병합)으로 나아갔다.
  - 들어온 것은 main의 R-15 L-1 store 수정(`4e3235b`, R-16에서 검토)과 문서(`1396caa` DR-31, `207d36e`)다. 이 브랜치의 CLI 변경은 `fd7d3c3`과 같다.
  - 이 검토 범위 밖이라 보지 않았다.
