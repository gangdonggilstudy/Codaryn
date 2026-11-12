# 범용 작업 워크플로 설계 (P4-G)

- 작업: P4-G([단계 4·5 설계 작업 지시](../work-orders/phase-4-5-design.md)). 페르소나: 수석 아키텍트(주), 문서·데이터 작업 전문가(보조).
- 기준: main `b386166`(2026-11-12). 코드 근거는 이 커밋의 `파일:줄`이다(`src/`는 생략하고 적는다). **실제 API는 호출하지 않았다.**
- 상태: 설계 초안이며 구현은 없다. PM이 14절 "결정 필요"를 정한 뒤 구현 지시를 만든다.
- 입력: [roadmap](../roadmap.md) 단계 4, [architecture](../architecture.md), [decisions](../decisions.md)(M-2, M-4, M-8, M-9, M-16), [testing](../testing.md) 8절, [unit-test-plan](../unit-test-plan.md) VF-04·05, [UX 설계](ux-design.md) 6·7절, [사용성 개선 지시](../work-orders/phase-4-usability.md)(N-1, N-8, N-11, N-13).

표기
- **[사실]**: 코드나 시험으로 확인한 현재 동작이다. 근거를 `파일:줄`로 단다.
- **[확정]**: 사용자 확정 요구나 PM 결정이다(roadmap, decisions, 작업 지시서).
- **[선택]**: 이 문서의 설계 선택이다. PM 채택 전이다.
- **[권고]**: PM이 정할 항목에 대한 이 문서의 권고다. 14절 번호를 붙인다.
- **[미정]**: 정하지 않은 것이다.

## 1. 요약

1. [사실] 문서 작성은 지금도 task 파일 등록만으로 된다(통합 `a02`). 자료 분석은 256 KiB 이하 텍스트 표까지만 다루고, 수치를 검증할 수단이 없다. 파일 정리는 이동·삭제 도구가 없어서 할 수 없다.
2. [선택] 워크플로는 "이름 붙인 task 기본값 묶음과 상한"(정의)이다. CLI가 정의를 펼쳐 명시적인 task를 만들고, 엔진은 워크플로 이름을 모른다.
   - 엔진은 한 번만 확장한다(도구 묶음, 지시문, 계획 단계, 사람 확인 완료).
   - 그 뒤로는 기존 도구·검증기·계획 방식을 조합하는 워크플로를 설정 등록만으로 더한다.
   - 새 도구나 새 검증기 종류는 코드 추가다.
3. [선택] 파일 이동과 폐기는 모델 도구로 두지 않는다. 모델은 계획을 제안만 한다. 사람이 다이제스트로 확인한 계획을 결정적 적용기가 실행한다. 확인을 거치지 않고 파일을 옮기거나 지우는 경로는 없다.
4. [선택] 자동 검증이 없으면 지금처럼 `needs-input`/`no_verifier`("검증 없음")로 끝난다.
   - 사람 확인을 지정한 워크플로는 자동 검증을 통과한 뒤 `needs-input`/`awaiting_review`로 끝난다.
   - 사람의 판정은 별도 기록으로 남는다.
   - 어느 경우에도 `done`이 되지 않는다.
5. [선택] 단계 4에도 네트워크 도구는 두지 않는다. 실행 중 권한 확인(N-11)은 위치만 정하고, 어댑터 계약(P5-A)과 함께 구현한다. 위치는 엔진의 정책 2차 판정 뒤·실행 전 훅이다.

## 2. 현재 엔진에서 등록만으로 되는 것

### 2.1 확인한 사실

| 항목 | 현재 동작 [사실] | 근거 |
| --- | --- | --- |
| 워크플로 이름 | task의 자유 문자열이다. 엔진은 이 값을 가려 `run_started`에 기록만 하고 분기하지 않는다 | `contracts/task.ts:21-22`, `engine/index.ts:518-531` |
| 간편 형식 | `workflow`가 `"general"`로 고정된다. 정책·검증기는 설정 파일의 값을 쓴다 | `contracts/config.ts:32`, `contracts/config.ts:94-96`, `cli/task.ts:403-416` |
| 도구 목록 | 네 개로 고정이다. 모델에는 언제나 네 개를 모두 제시하고, 목록 밖 이름은 `unknown_tool`이다 | `contracts/tool.ts:9-10`, `contracts/model.ts:29-30`, `engine/index.ts:161-163`, `engine/index.ts:403-414`, `engine/index.ts:554` |
| 도구 설명자 | 엔진이 `BUILTIN_TOOLS`에서 직접 찾는다. 인자 검사, 실행기, 제공자도 네 이름으로 분기한다 | `engine/index.ts:416`, `engine/validate-args.ts:42-43`, `tools/index.ts:416-425`, `model/anthropic/index.ts:382-388` |
| 정책 게이트 | 내장 이름이 아닌 설명자도 받아서, 그 설명자의 요구 권한으로 판정한다 | `policy/index.ts:49-53` |
| 네트워크·파괴적 동작 | 정책값은 `"deny"`만 받는다. 이를 요구하는 호출은 항상 거부한다 | `contracts/task.ts:72-75`, `cli/task.ts:196-197`, `policy/index.ts:125-131` |
| 묻기 | 정책 판정은 허용과 거부 둘뿐이다(주석 "never ask") | `contracts/policy.ts:27-30` |
| 시스템 문구 | 고정 문구 하나다. task별 지시는 목표(첫 사용자 메시지)로만 들어간다 | `engine/index.ts:86-94`, `engine/index.ts:533` |
| 검증기 종류 | `command`와 `file_rules` 둘이다. CLI는 다른 종류를 거부한다. 실행기는 모르는 종류에서 예외를 내고, 엔진이 그것을 `inconclusive`로 바꾼다 | `contracts/verify.ts:36-37`, `cli/task.ts:293-325`, `verify/index.ts:311-334`, `engine/index.ts:658-669` |
| 검증 없음 | 검증기 목록이 비면 `needs-input`/`no_verifier`(종료 코드 3)로 끝나고, 알림 "no automatic verification"을 남긴다 | `engine/index.ts:639-643`, `contracts/engine.ts:78-84` |
| 쓰기 | `write_file` 하나뿐이다. UTF-8 텍스트를 통째로 바꾸거나 한 곳을 치환하며, `expectedHash`가 필수다 | `contracts/tool.ts:33-45` |
| 읽기 | UTF-8 텍스트를 256 KiB까지 읽는다. 그 밖은 `not_text`나 `too_large`다 | `contracts/tool.ts:359`, `workspace/workspace.ts:115-134` |
| 목록 | 경로와 종류(파일·디렉터리)만 준다. 500개까지이고 크기·시각·해시는 없다 | `contracts/tool.ts:77-88`, `contracts/tool.ts:360` |
| 되돌리기 | `file_changed` 기록만 다룬다. 원문을 복원하거나, 이 실행이 만든 파일을 지운다 | `contracts/changes.ts:57`, `contracts/changes.ts:96-101` |
| 명령 인자 | 실행 파일과 인자 접두사만 비교한다. 인자 안의 경로는 검사하지 않는다 | `policy/index.ts:100-114` |
| 보호 대상 확인 | `protectedPaths`가 있으면 SHA-256 목록으로 사후 탐지한다. 항목이 `"."`이면 상태 디렉터리를 뺀 작업 공간 전체가 대상이다 | `cli/assemble.ts:151-158`, `contracts/integrity.ts:57-68` |

실행 확인
- 이 문서를 쓰는 동안 이 worktree에서 빌드한 뒤 통합 `a02-document-task`와 `a05-permissions`를 실행했다. 9건 모두 통과했다(대본 모델이며 실제 API가 아니다).
- `a05`는 모델이 부른 `delete_file`이 `unknown_tool`로 거부되는지 확인한다(`tests/integration/a05-permissions.test.ts:74`, `:115`).

### 2.2 유형별 판정

| 유형 | 등록만으로 | 이유 |
| --- | --- | --- |
| 문서 작성 | 된다 | task 파일(`workflow: "document"`, 명령 없음, `file_rules`)로 끝까지 실행된다(`tests/integration/a02-document-task.test.ts:33`, `examples/doc-task.json`). 남는 문제는 셋이다. 쓸 수 없는 `run_command`도 모델에 제시된다(`engine/index.ts:554`). 정의를 이름으로 다시 쓸 수 없다. 사람 확인으로 끝낼 수 없다 |
| 자료 분석 | 일부 | 256 KiB 이하 UTF-8 표를 읽고 결과 파일을 쓸 수 있다. 입력은 `protectedPaths`로 쓰기를 막고 무결성 확인을 받게 할 수 있다. 수치 검증기는 없다. 그래서 `file_rules`(존재·문자열)를 쓰거나, 사용자가 작업 공간 밖에 둔 검사 스크립트를 `command` 검증기로 걸어야 한다. 모델의 계산을 확인하는 일반 수단이 없다 |
| 파일 정리 | 안 된다 | 이동·삭제 도구가 없다(`contracts/tool.ts:9-10`). 파괴적 동작은 정책에서 항상 거부된다. `write_file`로는 바이너리를 옮길 수 없고, 옮겨도 원본이 남는다. 되돌리기는 이동을 모른다 |

### 2.3 명령으로 파일을 옮기는 우회는 쓰지 않는다

`run_command`에 `cmd /c move`나 `robocopy` 규칙을 허용하면 지금도 파일을 옮길 수는 있다. 이 방법은 쓰지 않는다.
- 인자 안의 경로를 검사하지 않는다(`policy/index.ts:100-114`). 그래서 작업 공간 밖으로도 옮길 수 있다. 자식 프로세스에는 OS 격리가 없다(architecture.md 7절).
- 파일별 기록과 스냅샷이 없다. 기록에는 명령 결과만 남고, `revert`는 되돌리지 못한다.
- 계획 확인을 거치지 않는다.

[선택] 파일 정리 정의는 명령 규칙을 비워 두도록 강제한다(4.2절의 상한).

## 3. 설계 원칙

1. [확정] 엔진은 하나이고 어댑터는 작업 논리를 갖지 않는다(M-2). 공통 엔진은 Git이나 코드 테스트를 전제로 하지 않는다(M-4).
2. [선택] 엔진은 워크플로 이름을 모른다. 워크플로가 바꾸는 것은 모두 task의 명시적 필드로 엔진에 들어간다. 그 필드가 기록에 남으므로 실행을 나중에 다시 읽을 수 있다.
3. [확정] 권한은 사용자 설정과 CLI 인자로만 정한다(M-9). [선택] 워크플로 정의는 내장 정의와 사용자 설정 파일(작업 공간 밖, S-1)에만 둔다. 작업 공간 안의 파일이나 모델 출력은 정의를 만들거나 바꾸지 못한다.
4. [선택] 되돌릴 수 없는 동작은 모델 도구로 두지 않는다. 파일 배치를 바꾸는 동작(이동, 폐기)은 사람이 확인한 계획을 결정적 적용기가 실행한다.
5. [확정] 검증 결과는 "지정한 검증 범위에서 통과"로만 표현한다(M-16). [선택] 사람 확인은 자동 검증을 대신하지 않으며 `done`을 만들지 않는다.
6. [확정] 모델로 가는 것은 모두 가림본이다(U-5). 가림은 등록한 비밀 값만 대상으로 한다. [선택] 그래서 자료 분석에서는 원자료가 모델로 간다는 점을 정의와 문서에 밝힌다. 개인정보가 든 자료에는 집계만 모델로 보내는 도구(P1)를 쓴다(5.2절).

## 4. 워크플로 정의와 등록

### 4.1 정의

[선택] 워크플로 정의는 task 필드의 기본값과 상한을 묶은 것이다. 아래는 형식 스케치다. 필드 이름은 역할 1이 정한다.

```json
{
  "schemaVersion": 1,
  "id": "organize",
  "label": "파일 정리",
  "tools": ["read_file", "search_files", "inspect_files", "propose_plan"],
  "instructions": "Group the files into folders by type. Propose one plan. Do not change files.",
  "plan": "apply",
  "completion": "verifiers",
  "policy": { "commands": "none", "planActions": ["move", "discard"] },
  "verifiers": [],
  "limits": { "maxModelTurns": 8, "maxToolCalls": 40 }
}
```

| 필드 | 뜻 | 엔진이 받는 형태 |
| --- | --- | --- |
| `tools` | 모델에 제시하고 실행을 허용하는 도구의 상한 | `ResolvedTaskSpec.tools` |
| `instructions` | 워크플로마다 고정된 지시. 고정 시스템 문구 뒤에 붙여 가린 뒤 보낸다(GT-D3) | `ResolvedTaskSpec.instructions` |
| `plan` | `none`, `apply`(확인 뒤 결정적 적용), `run`(확인 뒤 모델이 실행, P1). 6절 | `ResolvedTaskSpec.plan` |
| `completion`, `humanReview` | 자동 검증만 할지, 자동 검증 뒤 사람 확인까지 할지. 8절 | 같은 이름 |
| `policy`, `verifiers`, `limits` | 기본값이다. `commands: "none"`은 명령 규칙을 둘 수 없다는 상한이다 | 해석한 뒤 기존 task 필드 |

- 필드 이름은 키 필드 이름 목록(`contracts/config.ts:104-115`)과 겹치지 않게 짓는다. 정의도 설정 파일과 같은 키 검사(S-6)를 받는다.
- 지시문은 사용자 설정과 같은 신뢰 수준이다. 그래도 가린 뒤 보내고, 첫 `model_request.system`에 기록된다(`engine/index.ts:547`).

### 4.2 등록 위치와 해석 순서

1. **내장 정의**: `general`, `code`, `document`, `analyze`, `organize`다. 로직 없는 데이터 상수로 새 모듈 `src/workflows`에 둔다(GT-D12).
2. **사용자 정의**: 사용자 설정 파일의 `workflows` 맵에 둔다. 기본 설정 위치(N-1)나 `--config`로 읽는다. 내장 id와 같은 id는 `invalid_config`다. 내장 정의를 바꾸려면 복사해서 새 이름을 붙인다.
3. **프로필**(N-8): 프로필은 `workflowRef`로 정의를 고르고, 정책·한도·검증기를 더한다.
4. **task 파일과 간편 형식 인자**: 마지막에 적용한다. 간편 형식에서는 `--workflow <id>`를 쓴다.

정의를 고르는 필드
- [권고 GT-D2] 기존 `workflow` 필드는 이름표로 그대로 두고, 정의 참조용 필드 `workflowRef`를 새로 둔다.
- 근거: 기존 시험과 예시 다수가 `document`나 `code`를 이름표로 쓴다(`tests/integration/r01-privacy-regress.test.ts:331`, `tests/integration/p02-repair-feedback.test.ts:255`, `tests/integration/m01-fake-api-runs.test.ts:106`, `examples/doc-task.json` 등 `tests`·`examples`의 22개 파일). 이름표에 정의를 묶으면, 사용자가 바꾸지 않았는데 이 task들의 도구 목록과 완료 방식이 달라질 수 있다.
- `workflowRef`가 없으면 지금과 동작이 같다. 도구는 네 개, 계획은 없음, 완료는 자동 검증만이다.

덮어쓰기 규칙 [선택]
- 뒤 단계가 앞 단계를 덮는다. 단, 다음 상한은 넘을 수 없다.
  - `tools`는 줄이기만 할 수 있다.
  - 정의의 `plan: "apply"`는 `none`으로 바꿀 수 없다.
  - `commands: "none"` 상한이 있으면 명령 규칙을 둘 수 없다.
  - 한도는 S-7의 상한 규칙을 그대로 따른다.
- 위반은 `invalid_task`나 `invalid_config`다. 오류에는 필드 위치만 적고 값은 적지 않는다(N-6).
- 펼친 결과는 지금의 `ResolvedTaskSpec`처럼 모든 필드가 명시된 task다. `run_started`에는 정의 id와 펼친 `tools`, `plan`, `completion`을 남긴다(9절).

### 4.3 엔진을 고쳐야 하는 이유

roadmap 단계 4의 완료 기준은 "엔진을 고쳐야 했다면 그 이유를 결정 기록에 남긴다"이다. 아래 변경은 단계 4를 열 때 한 번 한다. 그 뒤로는 오른쪽 열의 범위를 등록만으로 더한다.

| 번호 | 엔진 변경 | 등록만으로는 안 되는 이유(근거) | 변경 뒤 등록으로 되는 것 |
| --- | --- | --- | --- |
| E1 | task가 도구 묶음을 지정한다. 엔진은 그 묶음만 모델에 제시하고, 묶음 밖 호출은 `unknown_tool`로 거부한다. 설명자는 등록표에서 찾는다 | 도구 목록이 엔진에 고정돼 있다(`engine/index.ts:554`, `engine/index.ts:161-163`, `engine/index.ts:416`) | 워크플로마다 다른 도구 묶음 |
| E2 | task의 `instructions`를 고정 시스템 문구 뒤에 붙인다(가린 뒤 보낸다) | 시스템 문구가 상수다(`engine/index.ts:86-94`). 지시를 목표에 섞으면 사용자의 목표와 워크플로 지시가 기록에서 구분되지 않는다 | 워크플로별 지시 |
| E3 | 계획 단계. `plan`이 `apply`나 `run`이면 읽기 도구와 `propose_plan`만 제시한다. 제안이 성공하면 실행을 `needs-input`/`plan_pending`으로 끝낸다. 적용은 별도 진입점 `applyPlan`이 맡는다(6절) | 정책 판정에 "묻기"가 없고(`contracts/policy.ts:27-30`), 실행을 멈췄다가 이어 가는 상태가 없다 | 계획 확인이 필요한 모든 워크플로 |
| E4 | 완료 방식. `completion: "human_review"`이면 자동 검증을 통과한 뒤 `needs-input`/`awaiting_review`로 끝낸다(8절) | 자동 검증을 통과하면 바로 `done`이다(`engine/index.ts:704-708`) | 사람 확인으로 끝나는 워크플로 |
| E5 | 도구 설명자에 `endsRun: "plan"` 속성을 둔다. 엔진은 도구 이름이 아니라 이 속성을 보고 E3을 처리한다 | 엔진이 특정 도구 이름으로 분기하면 E1의 등록표가 무의미해진다 | 엔진이 도구 이름을 모르는 상태 유지 |

코드 추가가 필요한 것(엔진 반복 논리는 바꾸지 않음)
- 새 도구: `propose_plan`, `inspect_files`, P1 `query_table`. 도구는 실행 코드이므로 등록 대상이 아니다. `tools`와 `contracts`에 추가한다.
- 새 검증기 종류: `data_checks`(VF-04), `inventory`(VF-05). 검증기도 실행 코드다. 플러그인 런타임은 두지 않는다(architecture.md 1절).
- 적용기와 되돌리기: 이동·폐기 실행과 그 기록, 되돌리기다(`tools`, `store`).
- `command` 검증기는 지금처럼 남는다. 사용자는 작업 공간 밖의 검사 스크립트를 코드 변경 없이 걸 수 있다.

## 5. 워크플로별 설계

| 항목 | 문서 작성 `document` | 자료 분석 `analyze` | 파일 정리 `organize` |
| --- | --- | --- | --- |
| 목표 | UTF-8 텍스트 문서(Markdown, txt 등)를 만들거나 고친다 | 작업 공간의 표(CSV, TSV, JSON Lines)로 결과 표와 보고서를 만든다 | 파일을 폴더로 분류·이름 변경·폐기한다 |
| 도구 | `read_file`, `search_files`, `write_file` | P0: `read_file`, `search_files`, `write_file`. P1: `query_table`을 추가하거나, 원자료 읽기 대신 쓴다 | `read_file`, `search_files`, `inspect_files`, `propose_plan`. 쓰기 도구는 없다 |
| 명령 | 없음(상한은 아님) | 없음(상한은 아님. 7.1절 경고) | 없음(상한 `commands: "none"`) |
| 권한 | 원본 자료 폴더를 `protectedPaths`로 둔다(예: `sources`) | 입력 자료 폴더를 `protectedPaths`로 둔다. 무결성 확인이 따라온다(`cli/assemble.ts:151-158`) | `planActions: ["move", "discard"]`. 계획의 경로마다 쓰기 권한을 판정하고 보호 경로를 막는다 |
| 계획 확인 | `none`. 필요하면 프로필에서 `run`(P1) | `none`. 필요하면 `run`(P1) | `apply`(필수, 바꿀 수 없음) |
| 자동 검증 | `file_rules`. P1에서 `markdown` 규칙(제목 존재·순서, 상대 링크 대상 존재) | `data_checks`: 열 이름, 행 수, 다시 계산한 집계와의 대조 | 적용 뒤 `inventory`(필수, 끌 수 없음). 사용자가 `file_rules`를 더할 수 있다 |
| 완료 | 검증기가 있으면 `verifiers`, 없으면 "검증 없음" | `human_review`(GT-D7). 확인 목록 예: "해석이 결과 표와 맞는가", "빠진 자료가 없는가" | `verifiers` |
| 확인하지 못하는 것 | 서술의 타당성, 문체 | 분석 방법의 적절성, 보고서 본문의 수치(결과 표만 대조) | 분류 의도가 맞는지 |
| 형식 한계 | `.docx`, `.pdf` 등 구조 문서는 다루지 않는다(`not_text`) | 256 KiB 초과 표는 P0에서 읽지 못한다. 숫자는 `.` 소수점 형식만 | 디렉터리 이동은 파일 단위로 펼친다. 빈 폴더는 남긴다(GT-D14) |

### 5.1 문서 작성

- [사실] 지금 형태 그대로 쓸 수 있다(2.2절). 정의는 도구 묶음, 지시문, 기본 검증만 더한다.
- 지시문 초안: "Keep lines you were not asked to change. Do not create files outside the paths named in the goal."
- [선택] 토큰이 든 줄(보호 줄)은 모델이 바꿀 수 없다(privacy.md 7절). 비밀이 든 문서를 고치는 작업은 그 줄 밖에서만 할 수 있다는 점을 사용 문서에 적는다.
- [선택] `markdown` 규칙은 `file_rules`의 규칙 종류로 더한다(P1). 새 검증기 종류를 만들지 않는다. 링크 검사는 작업 공간 안 상대 경로만 보고 외부 URL은 열지 않는다(네트워크 없음).

### 5.2 자료 분석

- 결과의 형태를 정한다. [선택] 분석 결과는 두 파일로 낸다.
  - 기계가 읽는 결과 표(`out/summary.csv` 등): 검증 대상이다.
  - 사람이 읽는 보고서(`out/report.md`): 사람 확인 대상이다.
- `data_checks`(VF-04) 규칙(스케치):
  - `table_shape`: 경로, 형식, 열 이름(정확히 또는 포함), 행 수 조건(값, 범위, 다른 표의 행 수와 같음).
  - `aggregate_match`: 원본 표에서 `sum`, `count`, `min`, `max`, `mean`을 다시 계산한다. 기준 열로 묶을 수 있다. 결과 표의 해당 칸과 허용 오차(절대·상대) 안에서 맞는지 본다.
  - 원본을 해석하지 못하면 `inconclusive`다(모델이 고칠 수 없음). 결과 표를 해석하지 못하면 `fail`이다(모델이 고칠 수 있음).
  - 근거에는 열 이름, 행 번호, 다시 계산한 수와 결과 표의 수만 적는다. 그 밖의 칸 값은 적지 않는다.
  - 한계에 "열거한 형태와 집계만 확인한다. 방법, 해석, 보고서 본문의 주장은 확인하지 않는다"를 적는다.
- 계산 정확도: P0에서는 모델이 표를 읽고 계산해 결과 표를 쓴다. `data_checks`가 틀린 수를 찾으면 재수정 반복(R-1)으로 돌려보낸다.
- P1 `query_table`(읽기 전용 도구): 작업 공간의 표에 집계 질의를 실행한다. 모델에는 집계 결과만 돌려준다.
  - 쓰는 이유 1: 크기 한도(256 KiB)를 넘는 표를 다룰 수 있다. 스트리밍으로 읽고 상한(예: 64 MiB)을 둔다.
  - 쓰는 이유 2: 원자료 행이 모델로 가지 않는다.
  - 쓰는 이유 3: 모델이 직접 계산하지 않는다.
  - 표 해석과 집계는 순수 모듈 `src/tabular`에 두고, 도구와 `data_checks`가 함께 쓴다.
  - 한계: 두 쪽이 같은 계산 코드를 쓰므로 검증기는 "보고한 수가 계산과 맞는가"만 확인한다. 계산 자체의 정확성은 `src/tabular` 유닛 시험이 맡는다. 이 한계를 검증 결과의 한계 목록에 적는다.
- 민감정보 [미정, PM 질문 1]
  - `read_file`과 `search_files`(text)는 표의 행을 그대로 모델에 보낸다. 가림은 등록한 비밀 값에만 적용된다.
  - 이름, 연락처 같은 개인정보는 등록하지 않으면 가려지지 않는다.
  - [권고 GT-D8] P0의 `analyze` 정의 설명과 사용 문서에 이 점을 적는다. 개인정보가 든 자료는 P1의 `query_table`과 "읽기 제외 경로"를 함께 쓰는 `analyze-private` 정의로만 다룬다.
  - "읽기 제외 경로"는 단계 0 설계만 있다(privacy.md 20행, implementation-map.md 73행). `read_file`과 `search_files`는 그 경로를 거부하고, `query_table`만 그 경로의 집계를 낸다.
  - 집계 그룹이 작으면 개인을 특정할 수 있다. 그래서 그룹 최소 크기 이하의 결과는 숨기는 규칙을 둔다. 값은 [미정]이다.

### 5.3 파일 정리

- 흐름은 6절이다. 제안 실행 → `plan_pending` → 사람 확인 → 적용 → `inventory` 검증 → 결과 순서다.
- `inspect_files`(읽기 전용 도구, 신규):
  - 경로 목록에 크기, 수정 시각, 텍스트 여부, 선택적으로 SHA-256(중복 찾기용)을 준다.
  - 내용은 주지 않으므로 바이너리 파일도 다룬다.
  - 결과는 가린 뒤 보낸다. 한 번에 500개까지이고, 쪽 단위로 이어 읽는다(`contracts/tool.ts:360`과 같은 상한).
- 폐기(삭제 요청) [권고 GT-D5]:
  - 파일을 지우지 않고 상태 디렉터리의 실행별 보관함 `.codaryn/runs/<적용 runId>/discarded/`로 옮긴다.
  - 파일 도구는 이 안에 닿지 않는다. `revert`가 되살린다.
  - 실제로 지우는 시점은 사용자가 실행 디렉터리를 지울 때다(스냅샷 수명과 같다. architecture.md 11절 A-5).
  - 영구 삭제는 단계 4 범위 밖이다.
- 이동 규칙 [선택]:
  - 대상이 이미 있으면 계획 검증에서 거부한다(`destination_exists`). 덮어쓰지 않는다.
  - 대상의 부모 폴더는 만든다. 경로는 작업 공간 안이어야 한다.
  - 다른 볼륨으로의 이동(`EXDEV`)은 복사하지 않고 그 항목을 실패로 남긴다. 작업 공간 안 링크가 다른 볼륨을 가리킬 때 생긴다.
  - 원본과 대상이 같거나, 대상이 서로 겹치거나, 한 원본이 두 번 나오는 계획은 거부한다.
  - 계획 하나는 1,000개 항목까지다(값은 [미정]).

## 6. 실행 전 계획 확인

### 6.1 방식

| `plan` | 흐름 | 쓰는 곳 | 상태 |
| --- | --- | --- | --- |
| `none` | 지금처럼 바로 실행한다 | 문서 작성, 자료 분석, 코드 | 구현됨(지금 동작) |
| `apply` | 모델이 행동 목록을 제안하고 사람이 확인하면, 적용기가 목록을 그대로 실행한다. 모델은 적용에 관여하지 않는다 | 파일 정리(필수) | P0 |
| `run` | 모델이 의도(바꿀 파일, 개요)를 제안하고 사람이 확인하면, 새 실행이 승인된 계획을 지시로 받는다. 이때 쓰기는 계획에 적힌 경로로만 제한한다(정책 `writablePaths`) | 큰 문서 개편, 분석 | P1 |

[권고 GT-D4] 계획 확인은 실행 중에 엔진을 멈춰 기다리는 질문이 아니다. "실행 사이의 확인"으로 둔다.
- 엔진은 비대화형 원칙(`contracts/policy.ts:27-30`)을 지킨다.
- CLI 비대화형, CLI 터미널, GUI·VS Code가 같은 의미로 동작한다. 대화형 어댑터는 제안이 끝나자마자 계획을 보여 주고, 승인되면 같은 프로세스에서 적용을 이어 부를 수 있다. 의미는 같다.
- 확인을 기다리는 동안 모델 연결이나 잠금을 잡고 있지 않는다.

### 6.2 `apply` 흐름

```
codaryn run (workflowRef: organize)
  └ 모델: 읽기 도구 → propose_plan 1회
  └ 엔진: 계획 검증(형식, 정책, 원본 해시) → plan.json 저장, plan_proposed 기록
  └ 결과: needs-input / plan_pending (종료 코드 3), 작업 공간 파일은 바뀌지 않음
codaryn plan --workspace <d> --run <id>          # 계획과 다이제스트를 보여 준다(가림본)
codaryn apply --workspace <d> --run <id> --digest <앞 12자 이상>
  └ 잠금 → 사전 점검(전 항목) → 적용(순서대로) → inventory 검증 → 결과(새 runId)
codaryn revert --workspace <d> --run <적용 runId>  # 이동을 되돌리고 보관함의 파일을 되살린다
```

### 6.3 계획의 내용과 저장

- `propose_plan` 인자(스케치): `summary`(한 줄), `actions`(`{kind:"move", from, to}`, `{kind:"discard", path}`), `notes`.
- 엔진과 도구가 하는 일:
  1. 인자 형식을 검사한다.
  2. 행동마다 정책을 판정한다. 정책 게이트는 내장 이름이 아닌 설명자도 받으므로(`policy/index.ts:49-53`), 행동마다 합성 설명자를 쓴다. `move`는 `from`과 `to`를 쓰기로, `discard`는 `path`를 쓰기로 판정한다. 보호 경로, 상태 디렉터리, 루트 밖, 토큰 복원 규칙이 그대로 적용된다.
  3. `policy.planActions`에 없는 종류는 거부한다.
  4. 원본마다 크기와 SHA-256을 계산한다. 이것은 모델이 아니라 도구가 계산한다.
- 저장:
  - 원본 경로(복원된 실경로), 해시, 해석된 정책·검증기 사본, 정의 id를 `.codaryn/runs/<runId>/plan.json`에 쓴다.
  - 이 파일은 로컬 원문이다. 스냅샷처럼 모델로 보내거나 출력하지 않는다(R-8, T-11과 같은 성격).
- 다이제스트: `plan.json` 바이트의 SHA-256이다. `plan_proposed` 기록에는 가린 행동 목록과 다이제스트를 남긴다.
- `codaryn plan`은 기록(가림본)에서 행동 목록을 보여 준다. 그 기록의 다이제스트와 `plan.json`의 다이제스트가 같은지도 확인한다. 사용자가 본 목록과 적용될 파일이 같은 것임을 다이제스트로 묶는다.

### 6.4 적용기 규칙 [선택]

1. 승인: `--digest`가 기록의 다이제스트, `plan.json`의 다이제스트와 모두 맞아야 한다. 터미널이면 목록을 보여 주고 `[y/N]`으로 묻는다. 비대화형이면 `--digest`가 없을 때 거부한다(`plan_not_approved`). 기본값은 언제나 "바꾸지 않음"이다(ux-design.md 7절).
2. 한 번만 적용한다. 이미 적용된 계획은 `plan_already_applied`다. 적용 기록이 계획 runId를 가리킨다.
3. 사전 점검은 모든 항목을 먼저 본다. 원본이 있고 해시가 같은지, 대상이 없는지, 정책을 통과하는지(지금 설정 기준으로 다시 판정)다. 하나라도 어긋나면 아무것도 옮기지 않고 `plan_stale`로 끝난다.
4. 적용은 계획 순서대로 한다. 실행 중에 실패하면 거기서 멈추고, 그때까지 한 것을 기록에 남긴다. 상태는 `failed`/`apply_incomplete`다. 되돌리기는 `revert`로 한다.
5. 기록: 항목마다 `file_moved`(이전 경로, 새 경로, SHA-256)나 `file_discarded`(경로, 보관 위치, SHA-256)를 남긴다. 경로는 가린다.
6. 검증:
   - `inventory`(VF-05)는 항상 실행한다. 사전 점검 때 상태 디렉터리 밖 작업 공간 전체의 목록을 잡는다. 지금의 무결성 목록 기능(`contracts/integrity.ts:57-68`, `"."` 항목)을 다시 쓴다.
   - 그 목록에 계획을 적용한 기대 목록이 적용 뒤의 실제 목록과 정확히 같아야 `pass`다.
   - 사라진 파일, 내용이 바뀐 파일, 계획에 없던 변화가 있으면 `fail`이다. 확인하지 못한 항목이 있으면 `inconclusive`다.
   - 사용자 검증기도 이어서 실행한다.
   - 적용 단계에는 모델이 없으므로 재수정하지 않는다.
7. 결과: 적용은 새 runId의 실행 기록을 만들고 `planRunId`로 계획 실행을 가리킨다(GT-D13). `revert`는 적용 runId로 한다. 되돌릴 때는 대상의 해시가 기록과 같고 원래 자리가 비어 있을 때만 옮긴다. 아니면 `skipped`(`changed_since_run`)다.

### 6.5 화면과 어댑터

- CLI 비대화형: `plan`으로 보고 `apply --digest`로 승인한다. 승인 경로(`cli-tty`, `cli-flag`)를 기록에 남긴다.
- GUI·VS Code: 계획 화면(이동 표, 개수, 폐기 목록, 다이제스트)과 "적용" 단추를 둔다. 단추는 어댑터의 `applyPlan(runId, digest)`를 부른다(P5-A와 맞출 점, 12절).

## 7. 네트워크·파괴적 동작의 확인과 기록

### 7.1 동작별 처리

| 동작 | 단계 4 처리 | 확인 | 기록 |
| --- | --- | --- | --- |
| 파일 이동·이름 변경 | 적용기만 한다. 모델 도구는 없다 | 계획 확인(필수) | `plan_proposed`, `plan_approved`, `file_moved` |
| 폐기(삭제 요청) | 상태 디렉터리 보관함으로 옮긴다 | 계획 확인 | `file_discarded` |
| 기존 파일 위로 이동(덮어쓰기) | 하지 않는다. 계획 검증에서 거부한다 | — | `plan_rejected`에 사유 코드 |
| 영구 삭제, 보관함 비우기 | 단계 4 범위 밖. 사용자가 실행 디렉터리를 지운다 | — | — |
| 버전 확인 없는 덮어쓰기 | 지금처럼 없다. `write_file`은 `expectedHash`가 맞을 때만 쓴다 | — | `file_changed` |
| 허용한 명령이 하는 파괴적 동작 | 허용 목록을 정한 사람의 책임이다. 인자 경로는 검사하지 않는다(`policy/index.ts:100-114`). `organize`는 명령을 금지한다. `allowExtraArgs: true` 규칙과 `planActions`를 함께 쓰면 `doctor`가 경고한다 | 설정할 때 경고(ux-design.md 7절) | `tool_result`(명령 결과만) |
| 네트워크 | 도구가 없고 `network: "deny"`를 유지한다. 외부 발송은 단계 4에서 하지 않는다(roadmap) | — | — |

네트워크를 쓰는 도구를 나중에 들일 때의 조건 [미정, 단계 4 이후 별도 결정]
- 설명자에 `requires.network: true`를 둔다. 정책 게이트는 이미 이 요구를 판정한다(`policy/index.ts:126-128`).
- 정책은 `"deny"` 대신 호스트 허용 목록을 받는다.
- 호출마다 7.3절의 실행 중 확인을 거친다.
- 기록에는 호스트, 보낸 바이트 수, 가린 요약을 남긴다.

### 7.2 기록 사건

[선택] 확인은 그 자체를 기록한다. 사람의 신원은 남기지 않고 경로만 남긴다.
- `plan_proposed`: 가린 행동 목록, 다이제스트, 항목 수.
- `plan_rejected`: 계획 검증 실패. 항목 위치와 사유 코드.
- `plan_approved`: 다이제스트, 승인 경로(`cli-tty`, `cli-flag`, `adapter`).
- `file_moved`, `file_discarded`: 6.4절.
- `review_recorded`: 사람 확인의 판정(8절). 이 사건은 실행 기록이 아니라 `review.json`에 쓴다.

### 7.3 실행 중 권한 확인(N-11)의 위치

- [확정] N-11은 실행 중 권한 확인을 단계 4 이후로 미뤘다.
- [권고 GT-D9] 위치는 엔진의 정책 2차 판정이 허용한 뒤, 실행하기 전이다(`engine/index.ts:456-469` 사이).
  - 정책 판정에 세 번째 값 `ask`를 둔다. `ask`를 낼 수 있는 것은 명령 규칙에 `confirm: true`를 붙인 경우와, 나중에 들일 네트워크 도구뿐이다.
  - 루트 밖, 상태 디렉터리, 보호 경로, 토큰 복원 거부는 묻지 않고 거부한다.
  - 엔진은 `EngineDeps.confirm?(요청)`을 부른다. 요청에는 가린 실효 인자를 담는다. 없으면 거부로 보고 코드는 `confirmation_unavailable`이다.
  - 기록은 `tool_decision`에 단계 `confirm`을 더해 남긴다.
  - CLI는 터미널일 때만 묻고, 비대화형이면 거부한다.
  - GUI·VS Code는 어댑터의 확인 질문 통로를 쓴다.
- 구현 시점: P5-A 어댑터 계약과 함께(단계 5 시작) 한다. 단계 4의 계획 확인은 실행 사이의 확인이라 이 훅이 필요 없다.
- `contracts/policy.ts:27`의 "never ask" 주석은 그때 바꾼다.

## 8. 완료 판정: 검증 없음과 사람 확인

| 경우 | 끝 상태 | 근거 |
| --- | --- | --- |
| 검증기 없음, 사람 확인 없음 | `needs-input`/`no_verifier`, 알림 "no automatic verification"(지금 동작, "검증 없음") | `engine/index.ts:639-643` |
| 검증기 모두 통과, 사람 확인 없음 | `done`/`verified`(지금 동작) | `engine/index.ts:704-708` |
| 검증기 모두 통과(또는 검증기 없음), 사람 확인 있음 | `needs-input`/`awaiting_review`(신규). 확인 목록을 결과에 담는다 | E4 |
| 검증기 실패 | 지금처럼 재수정하거나 `failed`. 사람 확인으로 넘기지 않는다 | R-1~R-3 |
| 판단 불가 | 지금처럼 `needs-input`/`verifier_inconclusive` | `engine/index.ts:704-707` |

사람 확인의 기록 [권고 GT-D6]
- `codaryn review --workspace <d> --run <id> --accept|--reject [--note <문장>]`로 판정을 남긴다.
- 판정은 `.codaryn/runs/<id>/review.json`에 쓴다. `result.json`과 기록의 끝 상태는 바꾸지 않는다. 기록은 추가 전용이고, `done`은 "지정한 검증 통과"만 뜻하기 때문이다(M-16).
- 메모는 키 검사(S-8)를 거친다. `report`는 "사람 확인: 승인(시각)"처럼 보여 준다.
- GUI는 결과 화면에 확인 목록과 승인·반려 단추를 둔다.
- 이렇게 하면 roadmap의 "자동 검증이 없는 작업은 검증 없음 또는 사람 확인으로 끝난다"를 그대로 만족한다.

## 9. 계약 변경 제안

`src/contracts`는 고치지 않았다. 아래는 역할 1에게 넘길 제안이다. 이름은 바뀔 수 있다.

| 파일 | 추가·변경 | 관련 |
| --- | --- | --- |
| `task.ts` | `TaskSpec.workflowRef?: string`. `ResolvedTaskSpec`에 `tools: readonly ToolName[]`, `instructions: string \| null`, `plan: "none" \| "apply" \| "run"`, `completion: "verifiers" \| "human_review"`, `humanReview: { checklist: readonly string[] } \| null`를 둔다. `PolicyConfig`에 `planActions?: readonly ("move" \| "discard")[]`, P1 `writablePaths?`, P1 `unreadablePaths?`를 둔다 | E1~E4, 6절 |
| `config.ts` | `CodarynConfig.workflows?: Record<string, WorkflowDefinition>`. `WorkflowDefinition` 형식(4.1절). 프로필(N-8)에 `workflowRef?` | 4.2절 |
| `tool.ts` | `TOOL_NAMES`에 `propose_plan`, `inspect_files`(P1 `query_table`). `ToolDescriptor.endsRun?: "plan"`. 인자·결과 형식과 `TOOL_DEFINITIONS` | E1, E5 |
| `model.ts` | `ModelRequest.tools`는 task의 묶음이다(형식은 그대로) | E1 |
| `engine.ts` | 이유 `plan_pending`, `awaiting_review`(`needs-input`), `apply_incomplete`, `plan_stale`(`failed`). 적용 결과 `ApplyResult`(`kind: "apply"`, `planRunId`, 상태, 검증기, 이동·폐기 목록, 기록 경로). `EngineResult.review?: { checklist }`. 진입점 `ApplyPlan`. P5 `EngineDeps.confirm?` | E3, E4, 6.4절, 7.3절 |
| `journal.ts` | `run_started`에 `workflowRef`, `tools`, `plan`, `completion`. 사건 `plan_proposed`, `plan_rejected`, `plan_approved`, `file_moved`, `file_discarded` | 7.2절 |
| `changes.ts` | `RevertAction`에 `moved_back`, `restored_from_discard`. `revertRun`이 이동·폐기 기록을 다룬다 | 6.4절 7 |
| `verify.ts` | `VerifierConfig`에 `data_checks`. 엔진만 만드는 `inventory` 결과 종류. P1 `file_rules` 규칙에 `markdown_heading`, `markdown_links` | 5절 |
| `policy.ts` | P5 `PolicyDecision`에 `ask` | 7.3절 |
| `commands.ts` | `plan`, `apply`, `review` 명령의 출력 객체. `CLI_ERROR_EXIT_CODES`에 `plan_not_approved`, `plan_already_applied`, `run_not_plan` | 6.4절, 8절 |

호환
- `workflowRef`가 없는 task는 `tools`가 네 개, `instructions`가 null, `plan`이 `none`, `completion`이 `verifiers`로 해석된다. 기록과 결과는 지금과 같다.
- 기록의 `schemaVersion`은 그대로 두고 필드만 더한다. 옛 기록을 읽는 `report`는 없는 필드를 기본값으로 본다. 단계 2의 `repairAttempts`와 같은 방식이다(`contracts/engine.ts:127-131`).

## 10. 시험 계획

### 10.1 유닛 P0

| ID | 대상 | 확인 |
| --- | --- | --- |
| GT-U01 | 정의 해석 | 모르는 필드, 키 모양 값, 내장 id와 겹치는 id, task 파일 안의 `workflows`는 거부한다. 오류에는 위치만 적는다 |
| GT-U02 | 해석 순서와 상한 | 정의 → 프로필 → task 순으로 적용된다. `tools`는 줄이기만 되고, `plan: "apply"`는 약하게 할 수 없고, `commands: "none"`이면 규칙을 거부한다 |
| GT-U03 | 엔진 도구 묶음(E1) | 모델 요청의 `tools`가 task 묶음과 같다. 묶음 밖 호출은 `unknown_tool`이고 실행기가 불리지 않는다(대본 모델) |
| GT-U04 | 계획 단계(E3, E5) | `write_file`과 `run_command`는 제시되지 않고, 불러도 거부된다. `propose_plan`이 성공하면 `plan_pending`이다. 작업 공간 해시 목록이 바뀌지 않는다 |
| GT-U05 | 계획 검증 | 루트 밖, 상태 디렉터리, 보호 경로, 대상 있음, 대상 중복, 원본 중복, 같은 경로, `planActions` 밖 종류, 복원할 수 없는 토큰은 각 코드로 `plan_rejected`가 되고 `plan.json`을 만들지 않는다 |
| GT-U06 | 승인 | 다이제스트가 없거나 틀리거나, 기록과 `plan.json`이 다르거나, 이미 적용된 계획이면 아무것도 옮기지 않는다 |
| GT-U07 | 사전 점검 | 계획 뒤 원본 내용이 바뀌었거나 대상이 생겼으면 `plan_stale`이고 아무것도 옮기지 않는다 |
| GT-U08 | 적용 기록과 되돌리기 | `file_moved`와 `file_discarded`가 남는다. 되돌리면 원래 배치가 된다. 대상이 바뀌었으면 건너뛴다. 중간 실패 뒤에는 한 것만 되돌린다 |
| GT-U09 | `inventory`(VF-05) | 사라진 파일, 내용 변경, 계획 밖 이동·생성은 `fail`이다. 확인 못 한 항목은 `inconclusive`다. 계획대로면 `pass`다 |
| GT-U10 | `data_checks`(VF-04) | 열 불일치, 행 수 불일치, 허용 오차 밖 집계는 `fail`이다. 원본을 해석하지 못하면 `inconclusive`, 결과를 해석하지 못하면 `fail`이다. 근거에 지정 밖 칸 값이 없다 |
| GT-U11 | 완료(E4) | 자동 검증 통과와 사람 확인이 있으면 `awaiting_review`다. 실패하면 지금처럼 재수정이나 `failed`다. 검증기와 사람 확인이 둘 다 없으면 `no_verifier`다(회귀) |
| GT-U12 | `review` | `review.json`만 쓰고 `result.json`과 기록은 바뀌지 않는다. 메모 키 검사를 한다. `report`에 판정이 보인다 |
| GT-U13 | 지시문(E2) | 등록 비밀이 든 지시문은 가려져 보내지고 기록된다. 지시문은 첫 `model_request.system`에만 있다 |
| GT-U14 | 하위 호환 | `workflowRef`가 없는 기존 task는 도구 네 개, 지금과 같은 기록·결과를 낸다(기존 유닛·통합 전체 회귀) |

### 10.2 통합 사례(실제 CLI 프로세스, 대본 모델)

| ID | 사례 | 기대 |
| --- | --- | --- |
| GI-01 | 사용자 설정에만 등록한 문서 정의(`workflows.memo`)로 실행 | `done`/`verified`. 엔진 코드 변경 없이 등록만으로 추가됨을 보이는 수용 근거 |
| GI-02 | 파일 정리: 실행 → `plan` → `apply --digest` → `revert` | `plan_pending`(종료 코드 3)까지 작업 공간 해시가 그대로다. 적용 뒤 `inventory` 통과, `done`. 되돌리면 원래 배치와 해시로 돌아간다. 바이너리 파일을 포함한다 |
| GI-03 | 승인 없는 적용 | 비대화형에서 `--digest`가 없거나 틀리면 거부하고 아무것도 옮기지 않는다 |
| GI-04 | 오래된 계획 | 계획과 적용 사이에 원본을 바꾸면 `plan_stale`이고 아무것도 옮기지 않는다 |
| GI-05 | 계획 단계의 쓰기·명령 시도 | `write_file`과 `run_command`가 거부되고 파일이 바뀌지 않는다 |
| GI-06 | 자료 분석 | 보호된 입력 CSV에서 결과 표와 보고서를 만든다. `data_checks` 통과 → `awaiting_review` → `review --accept` → `report`에 판정이 보인다. 입력의 무결성 확인은 변화 없음 |
| GI-07 | 자료 분석 재수정 | 틀린 합계를 쓰면 `data_checks`가 실패하고, 재수정 뒤 통과한다 |
| GI-08 | 검증 없는 등록 정의 | `no_verifier`, 종료 코드 3, 알림(회귀) |

모의 API(가짜 HTTP 서버, 이름에 `[모의 API·실제 API 아님]`)
- 새 도구 정의(`propose_plan`, `inspect_files`)의 `input_schema`가 요청 본문에 들어간다.
- 계획 단계 요청에는 쓰기 도구 정의가 없다.

## 11. 구현 분할안

한 파일의 소유자는 하나다. 계약 추가분을 먼저 커밋한다(development-workflow.md 4절).

| 작업 | 소유 파일 | 선행 | 페르소나 |
| --- | --- | --- | --- |
| G-A 계약(역할 1) | `src/contracts/**`, `tests/unit/contracts/**`, `docs/cli-contract.md` | PM의 14절 결정 | 수석 아키텍트 + CLI 개발자 |
| G-B 엔진 | `src/engine/**`, `tests/unit/engine/g-*.test.ts`(신규) | G-A | CLI 개발자 |
| G-C 도구·적용기 | `src/tools/**`, `tests/unit/tools/g-*.test.ts`(신규) | G-A | CLI 개발자 + 보안·개인정보 검토자 |
| G-D 검증기·표 해석 | `src/verify/**`, `src/tabular/**`(신규), `tests/unit/verify/g-*.test.ts`, `tests/unit/tabular/**` | G-A | 검증 엔지니어 + 문서·데이터 작업 전문가 |
| G-E 저장·되돌리기 | `src/store/**`(계획·검토 파일, 이동·폐기 되돌리기), `tests/unit/store/g-*.test.ts` | G-A, N-C 병합 뒤(N-C가 `src/store`의 실행 목록 조회를 소유한다) | CLI 개발자 |
| G-F CLI 연결과 내장 정의 | `src/cli/**`(정의 해석, `plan`·`apply`·`review` 명령, 조립, 진행 줄), `src/workflows/**`(신규, 데이터), `tests/unit/cli/g-*.test.ts` | G-B~G-E, N-A 병합 뒤(N-A가 `src/cli/**`를 소유한다) | CLI 개발자 |
| G-G 통합 시험 | `tests/integration/**`, `tests/support/**`, `tests/fixtures/**` | G-F | 검증 엔지니어 |
| G-H 사용 문서와 예시 | `docs/usage.md`(워크플로 절), `examples/workflows/**` | G-F, N-D 병합 뒤 | 문서·데이터 작업 전문가 |

- 순서: G-A → (G-B, G-C, G-D, G-E 병렬) → G-F → G-G → G-H → 교차 검토(구현자가 아닌 세션).
- P0 범위: E1~E5, `propose_plan`, `inspect_files`, 적용기, `inventory`, `data_checks`, `review`, 내장 정의 다섯 개.
- P1 범위: `query_table`, `src/tabular` 스트리밍, `plan: "run"`과 `writablePaths`, `unreadablePaths`, `markdown` 규칙, `analyze-private`.
- 새 의존성은 없다. CSV 해석은 직접 구현한다(RFC 4180의 부분 집합).

## 12. 다른 문서와 맞출 점

다른 작업자의 문서는 고치지 않았다. 해당 담당이나 PM이 맞춘다.

- **P5-A `adapter-contract.md`**: 작성 시점(main `b386166`)에 `claude/adapter-contract` 브랜치는 main보다 앞선 커밋이 없어 읽지 못했다. 아래는 가정이다.
  - 확인 질문을 세 종류로 나눈다.
    - 계획 승인: 실행 사이의 확인이다. 어댑터가 계획을 보여 주고 `applyPlan(runId, digest)`를 부른다.
    - 사람 확인: `awaiting_review` 뒤의 판정 기록이다.
    - 권한 확인: N-11, 실행 중 확인이며 단계 5에서 구현한다. `EngineDeps.confirm`.
  - 진행 이벤트에 `plan_proposed`, `file_moved`, `file_discarded`를 더한다.
  - 취소 신호는 적용기에도 같은 의미로 쓴다. 항목 사이에서 멈추고 한 것을 기록한다.
- **P5-U `standalone-gui.md`**: 계획 화면(이동 표, 폐기 목록, 개수, 다이제스트, 기본값 "적용 안 함"), 사람 확인 화면(확인 목록, 승인·반려), 자료 분석의 개인정보 안내.
- **ux-design.md**: 6절 상태 표에 `plan_pending`, `awaiting_review`, `plan_stale`, `apply_incomplete`를 더한다. 7절 위험 동작 표에 "계획 적용"을 더한다. 3절 명령 표에 `plan`, `apply`, `review`를 더한다.
- **architecture.md**: 2절 모듈 표에 `workflows`(데이터)와 `tabular`(순수)를 더한다. 2절 39행의 "`workflows/*`는 만들지 않았다"를 고친다. 3절 권한 표의 "파괴적 동작" 행에 적용기를 반영한다. 4절에 계획 단계와 적용을 더한다.
- **decisions.md**: E1~E5를 엔진 변경 이유와 함께 기록한다(roadmap 단계 4 완료 기준). PM 결정 계열 문자는 기존 계열과 겹치지 않게 정한다(D-1).
- **cli-contract.md**: task 필드, 새 명령, 종료 코드, `plan.json`·`review.json`·보관함 위치.
- **testing.md 8절, unit-test-plan.md VF-04·05**: 10절 사례로 바꾼다. testing.md 11절 미정 "작업 유형별 검증기 공통 계약"을 해소한다.
- **privacy.md**: 자료 분석의 원자료 노출(5.2절). `plan.json`과 보관함은 로컬 원문이다. "읽기 제외 경로"가 P1에서 구현 대상이 된다.
- **phase-4-usability.md N-8**: 프로필에 `workflowRef` 필드를 둔다. N-9 한 줄 실행에 `--workflow`.
- **design/README.md**: 색인 표에 이 문서를 더한다(색인 소유자가 한다).
- **usage.md**: 워크플로 절, 파일 정리 시작 전 사본이나 Git 권고(ux-design.md 4.4절의 경고와 같다).
- **기존 시험**: `workflowRef`를 쓰지 않는 한 영향이 없어야 한다(GT-U14). `document`·`code` 이름표를 쓰는 시험·예시 22개 파일이 회귀 기준이다.

## 13. 미정

- 계획 항목 상한, `inspect_files` 쪽 크기, `query_table` 입력 상한, 집계 그룹 최소 크기의 값.
- `plan: "run"`(P1)에서 승인된 계획과 실제 쓰기의 대응을 어디까지 강제할지(경로만, 또는 개요 대조까지).
- 바이너리 문서(`.docx`, `.xlsx`, `.pdf`)의 읽기·쓰기. 이미지·구조 문서 처리는 설계만 있다(implementation-map.md 9절).
- 다른 볼륨 이동을 복사로 처리할지. 지금 설계는 실패로 남긴다.
- 빈 폴더 정리 행동(`remove_empty_dir`)을 둘지(GT-D14).
- 네트워크 도구와 외부 발송(roadmap 단계 4 미포함, decisions O-10).

## 14. 결정 필요

| 번호 | 선택지 | 권고 | 근거 |
| --- | --- | --- | --- |
| GT-D1 | 등록 단위: (a) 워크플로 정의(설정 `workflows`와 내장)와 그것을 고르는 프로필, (b) N-8 프로필만 넓힘, (c) task 파일에 정의를 직접 씀 | (a) | 도구 묶음·계획·완료 방식은 정책보다 고정된 성격이다. 프로필은 사용자별 정책·한도를 맡는다. (c)는 재사용이 안 된다 |
| GT-D2 | 정의를 고르는 필드: (a) 기존 `workflow` 값이 등록 id면 펼침, (b) 새 필드 `workflowRef` | (b) | 기존 시험·예시 22개 파일이 `document`·`code` 이름표를 쓴다(4.2절). (a)는 사용자가 바꾸지 않은 task의 동작을 바꾼다 |
| GT-D3 | 지시문 위치: (a) 시스템 문구 뒤에 붙임(엔진 필드), (b) CLI가 목표에 합침(엔진 변경 없음) | (a) | (b)는 사용자 목표와 워크플로 지시가 기록에서 섞인다. (a)는 첫 `model_request.system`에 기록되어 감사가 쉽다(`engine/index.ts:547`) |
| GT-D4 | 계획 확인: (a) 실행 사이(`plan_pending` → `apply --digest`), (b) 실행 중 엔진이 멈춰 질문 | (a) | 엔진의 비대화형 원칙(`contracts/policy.ts:27-30`)을 지킨다. CLI 비대화형과 GUI가 같은 의미로 동작한다. 모델이 적용에 관여하지 않는다 |
| GT-D5 | 폐기: (a) 상태 디렉터리 보관함으로 이동, (b) 영구 삭제, (c) 지원 안 함 | (a) | 되돌릴 수 있다. 파괴적 동작 정책 `deny`를 유지한다. 수명 관리는 스냅샷과 같다(A-5) |
| GT-D6 | 사람 확인: (a) 새 이유 `awaiting_review`와 `review.json`, (b) 항상 `inconclusive`를 내는 `human` 검증기 | (a) | (b)는 `verifier_inconclusive`와 구분되지 않고, 다른 검증 실패와 섞이면 `failed`가 된다(`engine/index.ts:710`) |
| GT-D7 | 자료 분석의 기본 완료: 사람 확인을 기본으로 켤지 | 켠다. 문서 작성은 끈다 | 수치 검증이 보고서의 해석을 다루지 못한다. 문서는 `file_rules`와 되돌리기로 충분한 경우가 많다 |
| GT-D8 | 개인정보가 든 자료 분석: (a) P0부터 원자료 읽기 허용과 안내, (b) `query_table`과 읽기 제외 경로(P1) 전까지 개인정보 자료는 다루지 않음 | (b). P0 정의 설명과 사용 문서에는 (a)의 안내(원자료가 모델로 간다)를 넣는다 | 가림은 등록 값만 대상이다(U-5, privacy.md). 페르소나 금지사항 "민감정보를 치환 없이 외부로 보내는 흐름을 설계하지 않는다". 사용자 판단 필요(PM 질문 1) |
| GT-D9 | N-11 위치와 시점 | 엔진의 정책 2차 판정 뒤·실행 전 훅, `PolicyDecision`의 `ask`. P5-A와 함께 단계 5 시작에 구현 | 실효 인자를 보여 줄 수 있는 유일한 지점이다(`engine/index.ts:456-469`). 확인 통로가 어댑터 계약에 있다 |
| GT-D10 | 파일 정리에서 명령 금지를 상한으로 강제할지 | 강제한다(`commands: "none"`) | 명령 인자 경로를 검사하지 않아 우회가 된다(2.3절, `policy/index.ts:100-114`) |
| GT-D11 | 256 KiB 읽기 상한을 자료 분석 때문에 올릴지 | 올리지 않는다. 큰 표는 P1 `query_table`로만 | 상한은 모델 문맥과 가림 비용의 보호선이다. 큰 원자료를 모델로 보내는 것은 GT-D8과도 충돌한다 |
| GT-D12 | 새 모듈 `src/workflows`(데이터), `src/tabular`(순수) | 둔다 | 엔진이 워크플로를 모르게 하면서 내장 정의를 둘 곳이 필요하다. 표 해석은 도구와 검증기가 함께 쓴다 |
| GT-D13 | 적용 기록: (a) 새 runId와 `planRunId`, (b) 계획 실행의 기록에 이어 씀 | (a) | 계획 실행에는 이미 `run_finished`가 있다. 적용마다 잠금·기록·결과·되돌리기 단위가 분명해진다 |
| GT-D14 | 이동 뒤 빈 폴더 | 단계 4는 남기고 결과에 알린다 | 폴더 삭제는 파괴적 동작이며 이득이 작다. 필요하면 다음 결정으로 `remove_empty_dir` 행동을 더한다 |

PM 질문(사용자 판단이 필요한 것. 아래 가정으로 이 문서를 썼다)
1. 개인정보가 든 표를 분석할 때 원자료 행을 Anthropic API로 보내도 되는가? 가정: 안 된다. 집계 도구(P1) 전에는 개인정보 자료를 다루지 않는다(GT-D8).
2. "삭제"를 상태 디렉터리 보관함으로 옮기는 것으로 대신해도 되는가? 가정: 된다(GT-D5).
3. 파일 정리가 바이너리 파일(이미지, 오피스 문서)을 옮겨도 되는가? 내용은 읽지 않는다. 가정: 된다.
4. 자료 분석은 기본으로 사람 확인을 거쳐야 하는가? 가정: 그렇다(GT-D7).
