# R-12 병합 전 검토 보고서: DR-28 사슬과 R-11 낮음 3건 (pm/bundle-1)

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다. 저장소 파일 수정·커밋은 없다(main 병합 커밋 `55aced6` 외).
- **검토 대상(고정)**: `pm/bundle-1` = `7de824a`(`.codaryn/r12-pinned.txt`)
  - 열 개 브랜치를 합친 PM 통합 트리다.
  - `git archive 7de824a` 빌드 사본(`.codaryn/r12/b1`): typecheck 오류 0
- DR-28 사슬의 커밋
  - 계약: `bed4d81`, `5949f88`
  - 도구가 가린 표기 생성: `src/tools/workflow-tools.ts`
  - store가 `shown` 저장·읽기: `731855d`, 실행 폴더 없음 처리 `5b60432`
  - 엔진의 사전 점검 비교: `f7c75f5`
  - app의 changes 규칙: `8639d50`, `c85fd8c`
  - R-11 낮음: `5bd9c32`
  - 표본으로 확인한 작성자는 모두 `gangdonggil`이고 trailer가 없다.
- **PM 알림 반영**
  - 이 판에는 DR-28의 CLI 쪽 비교(`plan` 보기·`apply`의 사전 비교)가 아직 연결되지 않았다.
  - 그래서 CLI가 비교 없이 보여 주는 것은 **알려진 미연결**로 적고(4절) 건수에 넣지 않는다.
  - CLI 연결 커밋이 `claude/workspace-policy`에 올라오면 이어서 본다.
- 실험
  - 모두 **실제 CLI 프로세스**로 했다(`.codaryn/r12/exp12.mjs`와 changes 확인).
  - 가짜 파일, scripted 모델, 가짜 비밀 A·B(키 모양 아님)를 썼다. A·B는 이동 대상 폴더 이름에 들어간다.
  - 매 경우 `.codaryn` 아래 모든 파일(plan.json 제외)에서 비밀 값, 그 SHA-256, Base64, 16진, URL 인코딩을 찾았다. plan.json은 DR-5대로 실경로를 담는다.
- DR-28 관련 유닛 시험 74건: 70 통과, 1 건너뜀, **3 todo**
  - todo 3건: `tests/unit/cli/g-r11.test.ts:103,113`, `tests/unit/app/plan-review.test.ts:60`
  - 모두 CLI·app의 비교가 아직 없다는 표시다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 6 (I-1~I-6) |
| 알려진 미연결(건수 밖) | CLI `plan` 보기·`apply` 사전 비교(K-1) |

**PM 중점 항목**

| 항목 | 결과(실제 CLI) |
| --- | --- |
| R-11 재현(계획 실행과 다른 비밀로 plan·apply) | **apply는 막힘.** 엔진이 처음에 비교해 `failed`/`plan_stale`(종료 1)과 `plan_secrets_differ` 알림으로 끝난다. 이동·폐기·계획 소모(`applied.json`)가 없고, stdout·stderr·적용 기록에 비밀이 없다. **plan 보기는 아직 비밀이 보인다**(K-1, CLI 미연결) |
| 정상 계획(같은 비밀) | 계획 보기는 `[[CODARYN_SECRET:…]]/a.jpg`로 가려 보인다. 적용은 `done/verified`, 되돌리기는 `complete`. 출력과 기록에 비밀 없음 |
| 가린 표기를 변조·삭제한 계획 파일 | `shown` 형식이 틀리거나 모르는 키가 있으면 `plan`·`apply` 모두 `invalid_run_record`. 삭제(DR-28 이전 형식)하면 엔진이 `plan_stale`(알림 `plan_secrets_differ`)로 막는다. 비밀을 드러내도록 다시 쓰고 새 다이제스트를 승인하는 경우는 I-3 |
| 비밀이 없는 계획 | `shown`은 경로 전체이고 같은 task로 적용된다. 경로에 든 값을 적용 때 비밀로 새로 등록하면 표기가 달라져 막힌다(I-5) |
| 표기는 같지만 실경로가 다른 경우 | 비밀 A와 B를 모두 등록하고 실경로를 `A/a.jpg`에서 `B/a.jpg`로 바꿔도 `shown`은 같다. 보기는 익명 토큰 하나라 사람이 구별할 수 없고, 새 다이제스트를 승인하면 B로 옮겨진다(L-1). 원래 다이제스트로는 승인되지 않는다 |
| 비밀 값이나 해시가 디스크에 남는가 | `shown`은 토큰을 뺀 보이는 조각만 담는다(`["", "/a.jpg"]`). 정상·거부된 적용 모두 `.codaryn` 파일에 비밀 값, SHA-256, Base64, 16진, URL 인코딩이 없다. 예외는 I-3(상태 디렉터리 변조와 새 승인) |
| R-11 낮음 3건 | L-1 반영. L-2 일부 반영(L-2 계속). L-3은 계약 문서에 적었다(I-6) |

## 2. 재현 결과

### 정상(같은 비밀 A)

| 경우 | 결과 |
| --- | --- |
| 1a plan.json | 키는 `schemaVersion, kind, runId, actions`이고 행동마다 `shown`이 있다. 이동 대상은 `["", "/a.jpg"]`, 나머지는 경로 전체다. 계획 실행 출력에 비밀 없음 |
| 1b `plan --task` | `photos/a.jpg -> [[CODARYN_SECRET:…]]/a.jpg`. 비밀 없음 |
| 1c `apply --task` | `done/verified`, 이동·폐기·적용 표시. 출력과 `.codaryn`에 비밀 없음 |
| 1d `revert` | `complete`. 출력에 비밀 없음 |

### R-11 재현(다른 비밀)

| 경우 | 결과 |
| --- | --- |
| 2a·2b `plan --workspace --config <비밀 없음>`(글·JSON) | 종료 0, **비밀 값이 보임**(K-1) |
| 2c `plan --task <비밀 없는 task>` | 같음(K-1) |
| 2d `apply --workspace --workflow organize` | 종료 1 `plan_stale`, 알림 `plan_secrets_differ`. 이동·폐기·`applied.json` 없음. 출력과 `.codaryn`에 비밀 없음 |
| 2e `apply --task <비밀 없는 task>` | 같음 |
| 2f 이어서 계획 실행의 task로 `apply` | `done/verified`. 계획이 소모되지 않았으므로 정상 적용된다 |
| 2g `runs` | 거부된 두 적용이 `apply:failed/plan_stale`로 남는다(I-4) |

### 변조·없음·형식 오류(상태 디렉터리를 쓸 수 있는 경우, result.json의 다이제스트도 함께 고침)

| 경우 | 결과 |
| --- | --- |
| 3a `shown`을 비밀이 보이는 형태로 다시 씀, 새 다이제스트로 비밀 없이 적용 | 적용됨. 출력과 적용 실행의 `journal.jsonl`·`result.json`에 비밀 값(I-3) |
| 3c `shown` 삭제 | `plan`은 보임(K-1). `apply`는 `plan_stale`과 `plan_secrets_differ`로 막힘. 파일 그대로 |
| 3d `shown.from`이 숫자 | `plan`·`apply` 모두 `invalid_run_record` |
| 3e `shown`에 모르는 키(비밀 해시를 넣음) | `plan`·`apply` 모두 `invalid_run_record` |
| 3f 실경로 A→B, `shown` 그대로(A·B 모두 등록) | `plan` 줄은 `[[CODARYN_SECRET:…]]/a.jpg`로 구별되지 않는다. 새 다이제스트로 적용하면 B로 옮겨진다(L-1) |

### 비밀 없는 계획

| 경우 | 결과 |
| --- | --- |
| 4a `shown` | 경로 전체(`["2026/a.jpg"]` 등) |
| 4b 같은 task로 적용 | `done/verified` |
| 4c 계획 실행은 A를 등록하지 않았고(경로에 A 값), 적용 때 A를 등록 | `plan_stale`, `plan_secrets_differ`. 파일 그대로(I-5) |
| 4d 경로에 없는 비밀 B를 더 등록 | `done/verified` |
| 4e 같은 값을 다른 변수 이름으로 등록 | `done/verified` |

### R-11 낮음

| 경우 | 결과 |
| --- | --- |
| 5a L-1: organize task가 턴 20, 설정 없음 | 받아들여진다. 정의 한도는 기본값일 뿐이다(대본이 계획을 내지 않아 `model_error`로 끝남) |
| 5b L-1: 설정이 턴 3 | `invalid_task` "…must not exceed the config file's limits.maxModelTurns". 설정 파일이 있으므로 맞는 문구다 |
| 5c L-2: 설정 없이 간편 형식 `plan` | stdout JSON의 `message`는 고쳐졌다("…reads the run settings, limits included, from the config file; give the plan run's task with --task instead"). 사람용 stderr는 예전 그대로다(L-2) |

### changes(app 규칙 `8639d50`)

- 비밀 A가 든 이름의 파일을 만든 모델 실행이 대상이다.
- `changes --task`(같은 task), `changes --task <비밀 없는 task>` 모두 JSON과 글에 비밀이 없다.
- 경로 표시는 L-3을 본다.

## 3. 낮음

### L-1 가린 보기로는 비밀 이름의 서로 다른 대상을 구별할 수 없다

- 재현 3f: 비밀 A·B가 모두 등록된 상태에서 이동 대상이 `A/a.jpg`이든 `B/a.jpg`이든 `shown`은 `["", "/a.jpg"]`로 같다.
  - `plan` 보기는 실행마다 무작위인 토큰 하나(`[[CODARYN_SECRET:…]]/a.jpg`)만 보인다.
  - 사람은 어느 비밀 이름의 폴더로 가는지 알 수 없다.
- 영향
  - 다이제스트는 바이트를 묶으므로 계획 실행 출력의 다이제스트로 승인하면 바뀐 계획은 거부된다(A11·3f의 원래 다이제스트).
  - 남는 문제는 둘이다. 모델이 처음부터 다른 비밀 폴더를 고른 계획, 그리고 상태 디렉터리 변조 뒤 `plan` 보기만 보고 승인하는 경우다. 둘 다 사람이 차이를 볼 수 없다.
- 권고: 계획 보기의 토큰을 비밀 **이름**으로 보인다(예: `[[R12_B]]/a.jpg`). 값이 아니므로 가림 원칙에 어긋나지 않는다. 또는 사용 안내에 이 한계를 적는다(문서 담당).

### L-2 R-11 L-2가 JSON 메시지에만 반영되었다

- 간편 형식의 `plan`·`apply`·`review`가 설정의 한도를 요구할 때, 안내는 stdout JSON `message`에만 생겼다.
- 사람이 보는 stderr는 "config file — limits.maxModelTurns has an invalid value"와 일반 고치는 법뿐이다.
- 권고: 사람용 오류의 고치는 법에도 "계획 실행의 task를 --task로 준다"를 넣는다.

### L-3 changes가 이미 가려진 기록 경로를 다시 가려 토큰이 겹친다

- 재현: 비밀이 든 이름의 파일을 `changes`로 보면 경로가 `notes-[[[[CODARYN_SECRET:0d84…]]:a4c6…]].md`처럼 나온다.
  - 기록의 가림본 토큰 안의 `CODARYN_SECRET` 조각을 지금 게이트가 한 번 더 가린 것이다.
  - 같은 task이든 비밀 없는 task이든 같다.
- 누출은 없다. 그러나 비교 화면(GUI)에서 그 경로를 읽을 수 없다.
- 권고: 기록에서 온 가림본 경로는 다시 가리지 않거나, 토큰을 그대로 두는 규칙을 app·CLI의 changes에 둔다.

## 4. 알려진 미연결 (PM 알림, 건수 밖)

- **K-1** CLI의 `plan` 보기와 `apply`의 사전 비교가 없다.
  - `src/cli/plan-commands.ts`의 `loadShown`은 지금 비밀로 다시 가릴 뿐, `planActionShownMatches`를 부르지 않는다. 호출하는 곳은 `src/engine/apply.ts:295` 하나다.
  - 그래서 R-11 재현의 보기(2a~2c)는 비밀 값을 보인다.
  - `--digest` 없이 터미널에서 적용하면 같은 `renderPlan`으로 묻는다. 그 질문에도 보일 것이다(코드 확인, TTY가 없어 실행하지 않음).
  - 엔진 비교 덕분에 옮기거나 기록하지는 않는다.
- 연결되면 다시 볼 것
  - 보기·질문 전에 `plan_secrets_differ`(종료 2)로 멈추는지
  - 거부된 적용이 적용 실행을 남기지 않는지(I-4)
  - todo 3건이 실제 시험이 되는지
  - 엔진의 두 번째 방어가 그대로인지

## 5. 정보

- **I-1** 도구는 해석된 실경로(`source.relative`, `destination.relative`)를 그 실행의 게이트로 가린 결과에서 `shown`을 만든다. 가리지 못하면 계획을 저장하지 않는다(`workflow-tools.ts`).
- **I-2** 엔진의 비교는 사전 점검의 맨 처음이다. 인벤토리, 정책 판정, 계획 소모, 경로 기록보다 앞선다. 거부된 적용의 `journal.jsonl`·`result.json`에 경로나 비밀이 없음을 확인했다.
- **I-3** 상태 디렉터리를 쓸 수 있는 쪽(허용 명령, T-11)이 `shown`을 비밀이 보이는 형태로 다시 쓰고, 사람이 그 새 다이제스트를 승인해 비밀 없이 적용하면, 비밀 값이 적용 기록에 남는다(3a).
  - 계약 서두의 "다이제스트는 상태 디렉터리를 쓸 수 있는 쪽에 대한 방어가 아니다"에 해당하는 알려진 한계다.
  - 계획 실행 출력의 다이제스트로 승인하면 막힌다.
- **I-4** 엔진이 막은 적용은 매번 적용 실행(`failed`/`plan_stale`, 종료 1)을 남긴다. 이유는 `plan_stale`이고 알림이 `plan_secrets_differ`를 말한다. CLI 비교가 연결되면 그 앞에서 `plan_secrets_differ`(종료 2)로 끝나 적용 실행이 생기지 않을 것이다(K-1).
- **I-5** 계획 실행 뒤에 비밀을 새로 등록하면, 그 비밀이 경로에 있는 옛 계획은 적용할 수 없다(4c). DR-28대로 엄격한 쪽이다. 알림이 계획을 다시 만들라고 안내한다. 사용 안내에 적을 일이다(문서 담당).
- **I-6** R-11 L-3은 계약 문서 `docs/cli-contract.md` 18.1에만 적혔다("사람이 task나 설정에 둔 command 검증기는 막지 않는다").
  - 내 사용 안내 18.1은 organize의 명령 금지만 적었다. 다음 문서 작업에서 "적용 뒤 task의 command 검증기는 실행된다"를 더한다.
  - I-5와 L-1의 한계도 함께 적는다.

## 6. PM 판단 필요

- **P-1(L-1)**: 계획 보기의 토큰에 비밀 이름을 보일지, 문서로 한계를 알릴지
- **P-2(K-1)**: CLI 연결 커밋이 올라오면 이 보고서의 2a~2c, 3c, 터미널 질문 경로를 다시 확인한다. 병합 판정은 그 뒤로 미룰지

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기
  - `git log/show main..7de824a`의 DR-28·R-11 커밋
  - `src/contracts/plan.ts`의 DR-28 절과 `planActionShown`·`planActionShownMatches`
  - `src/tools/workflow-tools.ts`의 `shown` 생성
  - `src/cli/plan-commands.ts`의 `loadShown`
  - `src/engine/apply.ts`의 비교 위치
  - 시험의 todo
- 빌드: `git archive 7de824a`, typecheck 0
- 시험: DR-28 관련 유닛 74건
- 실험: 실제 CLI로 1a~5c와 changes 두 경우. 경우마다 출력과 `.codaryn` 파일에서 비밀의 값·해시·인코딩을 찾았다.

---

# R-12 이어서: CLI의 DR-28 비교 연결 확인

## 0. 대상

- **검토 대상(고정)**: `claude/workspace-policy` = `2948744`(`.codaryn/r12b-pinned.txt`)
  - `pm/bundle-1` `7de824a`를 포함한다.
  - 연결분은 두 커밋이다: `2f6d5c8` fix(cli)와 `2948744` docs(cli-contract)
  - 작성자 `gangdonggil`, trailer 없음
- 연결분(`git diff pm/bundle-1...2948744`)
  - `src/cli/plan-commands.ts`의 `loadShown`이 행동마다 `planActionShownMatches`를 부른다. 다르거나 `shown`이 없으면 `plan_secrets_differ`(종료 2)로 끝난다.
  - `loadShown`은 `plan`과 `apply`가 모두 계획을 읽은 직후에 부른다. 승인 확인, 터미널 질문, `--allow-unsafe-move` 처리, 잠금, 엔진 호출보다 앞이다.
  - 시험 `tests/unit/cli/g-r11.test.ts`의 todo 2건이 실제 시험이 되었다. 질문 횟수 0과 `--allow-unsafe-move`도 확인한다.
  - 계약 문서 18.3에 규칙을 더하고, 18.9의 미연결 항목을 지웠다.
- 빌드: `git archive 2948744`, typecheck 0
- DR-28 관련 유닛: 75건 중 73 통과, 1 건너뜀, todo 1(L-4)
- 실험: 실제 CLI 프로세스로 했다(`.codaryn/r12/exp12b.mjs`).
  - 터미널은 stdin·stderr를 TTY로 표시하는 preload로 흉내 내고, 답은 stdin으로 넣었다.
  - 하드 링크 없는 드라이브는 R-9b 이후의 preload를 썼다.

## 1. 결과 요약

- **K-1 막힘.** 계획 실행과 다른 비밀로 한 `plan` 보기와 `apply`가 모두 `plan_secrets_differ`(종료 2)로 끝난다.
  - 계획 줄, 다이제스트, `[y/N]` 질문을 하나도 내지 않는다.
  - 적용 실행을 만들지 않고, 계획을 소모하지 않고, 옮기지 않는다.
  - 출력과 `.codaryn`에 비밀(값, SHA-256, Base64, 16진, URL 인코딩)이 없다.
- **I-4 해소.** 거부된 적용이 더는 `failed`/`plan_stale` 적용 실행을 남기지 않는다(`applyRuns: 0`).
- 같은 비밀의 정상 경로는 그대로다: 보기, `--digest` 적용, 터미널 승인(`cli-tty`), 하드 링크 없는 드라이브의 터미널 동의, 비밀 없는 계획.
- 앞 절의 L-1~L-3과 I-3은 이번 연결과 관계없어 그대로다. 새 발견은 L-4 하나다.

| 심각도(R-12 전체) | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 4 (L-1~L-3, L-4 신규) |
| 정보 | 6 (I-4는 해소로 표시) |

## 2. 재현 결과(`2948744`)

| 경우 | 결과 |
| --- | --- |
| A1 `plan --workspace --config <비밀 없음>` | 종료 2 `plan_secrets_differ`. 계획 출력 없음, 비밀 없음 |
| A2 같은 형식 `--json` | 같음 |
| A3 `plan --task <비밀 없는 task>` | 같음 |
| A4 `apply --workspace … --digest` | 같음 |
| A5 `apply --task <비밀 없는 task> --digest` | 같음 |
| A6 A5 + `--allow-unsafe-move` | 같음 |
| A7 터미널, `--digest` 없음, 답 `y` | 같음. **질문 없음** |
| A8 A7 + `--allow-unsafe-move`, 답 `y`, `y` | 같음. 질문 없음 |
| A9 A4~A8 뒤의 상태 | 이동·폐기·`applied.json`·적용 실행 0, `.codaryn`에 비밀 없음 |
| A10 이어서 계획 실행의 task로 보기·적용 | 보기는 `[[CODARYN_SECRET:…]]/a.jpg`, 적용 `done/verified`. 비밀 없음 |
| A11 적용된 계획을 다른 비밀로 보기 | `plan_secrets_differ` |
| B1 하드 링크 없음, 다른 비밀, `--allow-unsafe-move` | `plan_secrets_differ`. `consent_required`나 이동 없음 |
| B2 하드 링크 없음, 다른 비밀, 터미널(답 `y`, `y`) | `plan_secrets_differ`. 동의 질문 없음 |
| B3 B1~B2 뒤의 상태 | 변화 없음, 적용 실행 0 |
| B4 하드 링크 없음, 같은 비밀, 터미널 동의 `y` | `done/verified`, 두 이동 `unsafe: true`. 적용 실행 둘(`consent_required` 하나와 동의한 적용 하나), 비밀 없음 |
| C1 같은 비밀, 터미널 승인 `y` | `Apply this plan? [y/N]`을 묻는다. 질문에 비밀 없음(가린 계획), 승인 기록 `cli-tty`, `done/verified` |
| C2 같은 비밀, 터미널 답 없음(기본 아니오) | `plan_not_approved`. 변화 없음 |
| D1·D2 `shown`을 지운 계획(DR-28 전 형식) | 보기·적용 모두 `plan_secrets_differ`. 적용 실행 0 |
| D3 `shown`을 비밀이 보이는 형태로 다시 씀(상태 디렉터리 변조) | 비밀 없는 형식으로 보면 비밀이 보인다(I-3 그대로). 계획 실행의 task(비밀 등록)로 보거나 적용하면 `plan_secrets_differ`라서, 정상 형식을 쓰는 사람에게는 변조가 드러난다 |
| D4 실경로 A→B, `shown` 그대로 | 보기는 익명 토큰(L-1 그대로). 원래 다이제스트로는 `plan_not_approved` |
| E1·E2 비밀 없는 계획 | 간편 형식 보기(`2026/a.jpg`)와 적용(`done/verified`) 정상 |

## 3. 새 발견

### L-4 app 계층의 DR-28 회귀 시험이 아직 todo다

- 위치: `tests/unit/app/plan-review.test.ts:58-60`
  - "a task form with other secrets than the plan run shows and moves nothing: plan_secrets_differ"가 `{ todo: … }`로 남아 있다.
  - 주석은 "Remove the todo once both are merged"다.
- 확인: 빌드 사본에서 todo만 빼고 돌리면 통과한다(6건 중 6 통과).
- 영향: 지금은 통과하지만 todo라서, 나중에 이 경로가 깨져도 시험 묶음이 실패하지 않는다.
- 권고: todo를 지운다(app 담당 w3:pA).

## 4. PM 판단 필요

- **P-3**: L-4의 todo 제거를 병합 조건에 넣을지
- 앞 절의 P-1(L-1 비밀 이름 표시)은 그대로다. P-2(K-1)는 이번 확인으로 닫는다.

## 5. 실행한 것

- 읽기: `git diff pm/bundle-1...2948744`(CLI·계약 문서·시험)
- 빌드: `2948744`
- 시험: DR-28 유닛 75건, app 시험의 todo를 뺀 사본 6건
- 실험: 실제 CLI로 A1~E2. 저장소 파일 변경과 커밋은 없다.
