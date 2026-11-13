# R-80 보안 검토: U-90 실행 사건 목록 `listRunEvents`

- 대상: `pm/unit-U-90` = `96b3671`(main `82451d3` 위, `git diff 82451d3 96b3671`, 6파일 +670/−1). 검토자 w3:p7(nd-docs). 이 단위의 코드를 쓰지 않았다.
- 기준: `docs/design/adapter-contract.md` 5.13(이 판).
- 방법: 읽기 전용. 저장소 수정·커밋 없음.
  - `96b3671`을 `git archive`해 빌드했다. 실행은 그 빌드의 실제 CLI와 대본 모델로 임시 폴더에서 만들었다. `listRunEvents`는 같은 빌드의 앱 계층을 프로세스 안에서 불렀다.
  - 합성 값만 썼다. 네트워크 없음. 키 변수에는 여기서 둔 합성 값만 있다.
  - journal 변형(덧붙임, 끼워 넣음, 깨뜨림, 지움, 크기)은 실행 결과의 사본에만 했다.
  - 스크립트 `.codaryn/r80/r80.mjs`(주), `r80b.mjs`(진짜 실행 두 가지), `r80c.mjs`(필드 이름과 같은 등록 값). 출력은 같은 폴더의 `r80-out.txt`, `r80b-out.txt`, `r80c-out.txt`.
- 결과: **높음 0, 중간 1, 낮음 1, 정보 4.**

## 1. 요청한 여섯 가지의 답

| # | 볼 것 | 결과 |
| --- | --- | --- |
| (1) | 지금 등록한 값·지금 키 값·키 모양이 응답에 남지 않는지(실행 뒤에 등록한 값 포함), 가릴 수 없는 줄, 필드 이름의 비밀 | **남지 않는다.** 실행 때 등록한 값(journal에 토큰), 실행 뒤에 등록한 값 셋(그대로, 역슬래시 든 값, 큰따옴표 든 값), 그 Base64, 지금 키 값, 키 모양 모두 81개 응답 어디에도 없었다. 등록 이름이 필드 이름에 든 줄은 빠졌다(값도 응답에 없음). 가릴 수 없는 줄은 만들지 못했다(5절) |
| (2) | 기록 변경 표시, 손상, 긴 줄, 빈 journal, 도는 중, 다른 작업 공간의 id, id 꼴이 아닌 값, `..` | 표시 → `recordsChanged: true`이고 레코드를 준다. `result.json` 깨짐·빈 journal·256 MiB 넘음 → `invalid_run_record`. 3 MiB 레코드는 혼자 한 쪽. 도는 중(결과 없음, 끝나지 않은 마지막 줄, 살아 있는 잠금) → `incomplete`, 마지막 줄은 세지 않음. 다른 작업 공간의 id와 대소문자만 다른 id → `run_not_found`. 꼴이 아닌 값과 `..` → `invalid_arguments`. **다만 중간의 줄 하나가 깨지거나 빠지면 그 뒤의 진짜 레코드가 모두 빠진다**(M-1) |
| (3) | 쪽의 범위 밖 값, 큰 journal의 상한, 일부만 조용히 주지 않는지 | 범위 밖 값은 모두 `invalid_arguments`. 256 MiB 넘는 journal은 일부를 주지 않고 `invalid_run_record`. 40 MiB journal(2,010 레코드)은 20쪽을 다 넘기면 2,010개로 `total`과 같았다. 조용히 일부만 주는 경우는 M-1뿐이다(`skipped`로 세지만 `status`는 `complete`) |
| (4) | 제어 문자·양방향 문자가 든 글이 정리되는지 | **앱 계층은 정리하지 않는다.** BEL, ESC, SOH, U+202E, U+200B가 응답의 문자열에 그대로 있었다(L-1) |
| (5) | 아무것도 쓰지 않는지, 잠금 없이 실행 중에도 읽는지 | **그렇다.** 모든 호출 뒤 두 작업 공간의 나무(이름·크기·수정 시각)가 같았고, 잠금·실행 디렉터리가 생기지 않았다. 살아 있는 프로세스가 잠금을 쥔 동안에도 읽었고 잠금은 그대로였다 |
| (6) | 사건 종류 목록 밖의 줄 | 빠지고 `skipped`로 센다(`no_such_type`). 적용의 `plan_item_started`는 받되 주지 않는다(적용 실행 10개 레코드에 없음). 다른 실행의 `runId`, JSON이 아닌 줄, 배열, 깊이 70, 필드 이름이 낱말이 아닌 줄도 빠진다 |

## 2. (1) 가림의 실제

실행 A: `secretEnv`에 V1을 등록하고, V1·V2·VB(역슬래시)·VQ(큰따옴표)·V2의 Base64·키 값·키 모양·제어 문자가 든 파일을 읽은 뒤, 모델의 마지막 답에 V2·키 모양·키 값·제어 문자를 넣었다. journal 원문에는 V1만 토큰이고 나머지는 그대로였다.

| 조회 때의 설정 | V1 | V2 | VB | VQ | V2 Base64 | 키 값 | 키 모양 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V1~VQ 등록, `OPENAI_API_KEY`에 키 값 | 없음 | 없음 | 없음 | 없음 | 없음 | 없음 | 없음 |
| V1만 등록, 키 변수 없음 | 없음 | 있음 | 없음 | 없음 | 있음 | 있음 | 없음 |

- 둘째 줄은 계약대로다("지금 등록한 값만 가린다"). 그때의 키 값은 키가 아니라 그냥 글이다.
- 덧붙인 위조 레코드(꼴이 맞는 `model_response`, V2·키 모양·키 값 포함)도 가려서 주었다.

## 3. (2)(6) journal 변형과 결과

| 변형(사본) | 결과 |
| --- | --- |
| 끝에 열 줄 덧붙임: 모르는 종류, 다른 실행, JSON 아님, 배열, 등록 값이 든 필드 이름, `bad-name` 필드, 깊이 70, 꼴이 맞는 위조 `model_response`, 3 MiB `model_response`, `tool_decision` | `total` 13, `skipped` 7. 위조 셋은 가려서 줌. 쪽: 0+11(5 KiB), 11+1(3,072 KiB), 12+1 |
| `records-changed.json` | `recordsChanged: true`, 10개 모두 |
| `result.json`을 깨뜨림 | `invalid_run_record` |
| 빈 journal | `invalid_run_record` |
| **seq 2 줄을 깨뜨림** | **`total` 1, `skipped` 9, `complete`** |
| **seq 2 줄을 지움** | **`total` 1, `skipped` 8** |
| **seq 5 줄에 `"bad key"` 필드를 더함** | **`total` 4, `skipped` 6** |
| **진짜 seq 3 앞에 꼴이 맞는 위조 seq 3을 끼움** | **위조가 주어지고 진짜 seq 3(`model_request`)은 빠짐** |
| 결과 없음, 끝나지 않은 마지막 줄, 살아 있는 잠금 | `incomplete`, 10개, `skipped` 0 |
| 결과 있음, 끝나지 않은 마지막 줄 | `complete`, 10개, `skipped` 1 |
| 268,439,810바이트(한도 268,435,456) | `invalid_run_record` |
| 40,311,274바이트, 2,010 레코드 | 20쪽, 합 2,010(= `total`), 등록 값 없음, 쪽마다 약 6.3초 |

실행 id: `latest`, `..`, `../x`, `a/b`, `a\b`, `""`, `.`, `...`, 129자, 앞 공백, null, 5 → `invalid_arguments`. 128자, 없는 id, 대소문자만 다른 id, 다른 작업 공간의 적용·계획 실행 id → `run_not_found`. 적용 실행은 자기 작업 공간에서 `runKind: "apply"`, 10개, `plan_item_started` 없음.

## 4. (3) `offset`·`limit`·`types`

| 값 | 결과 |
| --- | --- |
| `offset` −1, 0.5, NaN, Infinity, 2^53, 문자열 `"1"`, 없음 | `invalid_arguments` |
| `offset` `MAX_SAFE_INTEGER`, 100(레코드 10) | 빈 쪽, 응답의 `offset` 10(I-3) |
| `limit` 0, 1001, 1.5, null | `invalid_arguments` |
| `limit` 1000, 1 | 10개 / 1개(`nextOffset` 1) |
| `types` `[]`, `["nope"]`, `["plan_item_started"]`, 문자열 | `invalid_arguments` |
| `types` `["model_response"]`, 같은 이름 두 번 | 2개, `total` 2 |
| `types` `["file_moved"]`(모델 실행) | 0개 |

## 5. 지적

### M-1(중간) 레코드 하나가 빠지면 그 뒤의 진짜 레코드가 모두 빠진다. 위조 줄은 진짜 레코드를 밀어낸다

- 규칙: 줄은 `seq`가 "마지막으로 받은 레코드의 다음 수"일 때만 받는다. 줄 하나를 받지 못하면 기대하는 수가 그대로 남아, 그 뒤의 진짜 줄은 모두 수가 맞지 않아 빠진다.
- 재현(실행 A의 사본, 레코드 10개):
  - seq 2 줄을 깨뜨림 → `total` 1, `skipped` 9.
  - seq 2 줄을 지움 → `total` 1, `skipped` 8.
  - seq 5 줄에 낱말이 아닌 필드 이름 하나를 더함 → `total` 4, `skipped` 6.
  - 진짜 seq 3 앞에 꼴이 맞는 위조 seq 3을 끼움 → 위조가 seq 3으로 주어지고 진짜 `model_request`는 빠진다(그 뒤는 맞음).
- 정상 설정에서도 생긴다(r80c, 진짜 실행):
  - 조회 때 `secretEnv`에 `text`를 등록하면 `total` 3, `skipped` 7(첫 `model_response`부터 모두 빠짐).
  - `turn`을 등록하면 `total` 2, `skipped` 8.
  - 등록 값과 같은 필드 이름이 든 레코드를 빼는 것은 계약대로다. 그 뒤의 레코드까지 모두 빠지는 것은 계약에 없다.
  - `secretEnv` 값에는 길이 하한이 없다(privacy.md PV-D2).
- 진짜 실행에서 모델이 `file_path` 같은 꼴의 인자 키를 보내도 빠지지 않았다(인자는 JSON 문자열로 기록됨, r80b). 그래서 진짜 실행에서는 위의 등록 값 경우가 아니면 생기지 않는다.
- 계약 5.13은 "그래서 끼워 넣은 줄 뒤의 진짜 줄도 받는다"고 적는다. 이는 수가 맞지 않는 줄을 끼운 경우에만 맞다. 줄이 깨지거나 빠지거나 걸러진 경우, 그리고 수가 맞는 위조 줄을 끼운 경우는 다르다.
- 영향:
  - 값이 새지는 않는다.
  - 기록 탭이 `status: "complete"`로 레코드 일부만 보인다. 빠진 수는 `skipped`로만 나온다.
  - 실행이 끝난 뒤 같은 사용자의 다른 프로그램이 줄 하나를 고치면 그 뒤의 기록을 기록 탭에서 감출 수 있다. 실행 중에 바뀐 것은 기록 변경 표시가 잡는다(DR-38). 그 뒤의 것은 알려진 한계(DR-37 (b))다.
  - 같은 사본(seq 2를 깨뜨린 것)을 같은 빌드의 `report`는 `invalid_run_record`("the run's records cannot be used: a journal line is not JSON")로 거부했다(실제 CLI). 이 함수는 손상이라 하지 않고 1개짜리 목록을 `complete`로 준다. 두 판정이 다르다(`runs`는 그 실행을 `checked`로 보인다).
- 고칠 방향(제안, 택일):
  1. 걸러서 뺀 진짜 줄(`seq`가 기대값과 같은 줄)도 수를 센다. 그러면 필드 이름 경우의 연쇄가 끊긴다.
  2. 기대값보다 큰 `seq`를 만나면 거기서 다시 맞추고 그 사이를 "빠짐"으로 알린다.
  3. 연쇄가 끊긴 자리 뒤에 진짜로 보이는 줄이 남으면 `invalid_run_record`나 `status: "incomplete"`처럼 드러나게 한다.
  - 위조 줄이 진짜를 밀어내는 경우는 같은 `seq`가 두 번 나오는 것으로 알아챌 수 있다(기록 변경으로 다루는 쪽).

### L-1(낮음) 제어 문자·양방향 문자를 앱 계층에서 정리하지 않고, 5.13은 어댑터가 정리해야 한다고 적지 않는다

- 재현: 모델의 답과 파일 내용에 BEL(U+0007), ESC(U+001B, `[31m` 색 바꿈 꼴), SOH(U+0001), U+202E, U+200B를 넣은 실행. 응답의 `model_response.text`, `tool_result`의 내용 등에 그대로 있었다(JSON 이스케이프된 채).
- 위조 줄의 낯선 필드(예: 계약에 없는 `call.name`)도 가리기만 하고 도구 이름 제한을 거치지 않는다. U+202E가 든 이름이 그대로 나왔다. 진짜 `tool_decision.tool`은 제한된다(I-1).
- 기준:
  - AC 5.2: "화면에 내기 전에 어댑터가 제어 문자를 정리한다".
  - 5.13: "어댑터는 필드를 바깥 자료처럼 읽는다"까지만 있다.
  - 기록 탭은 사람이 읽을 원문(모델의 답, 도구 결과)을 가장 많이 보이는 화면이다. ESC 꼴은 터미널, 양방향 문자는 화면에서 글을 바꿔 보이게 할 수 있다.
- 고칠 방향(제안): 5.13에 "글은 정리하지 않고 준다. 어댑터는 보이기 전에 제어 문자와 양방향·보이지 않는 문자를 정리한다(AC 5.2)"를 적는다. GUI 쪽 단위의 완료 기준에 이 시험을 넣는다. 아니면 앱 계층에서 `cleanText`(줄바꿈·탭 유지)를 문자열마다 거친다.

### 정보

- **I-1 작업 종류 도구 이름이 `(unknown tool)`로 나온다.** 정리 작업의 계획 실행에서 `inspect_files`, `propose_plan`이 `tool_decision.tool`, `tool_result.result.tool`, `model_response.toolCalls[].name` 여섯 곳 모두 `(unknown tool)`이었다(journal에는 진짜 이름). 도구 이름 제한(`events.ts`의 `limitToolNames`)이 내장 네 도구(`TOOL_NAMES`)만 알기 때문이다. 실행 중 이벤트(`startRun`)에서도 같다(이 단위 전부터).
- **I-2 큰 journal의 쪽당 시간.** 40 MiB journal은 쪽마다 약 6.3초였다(20쪽에 약 2분). 한도 256 MiB면 쪽마다 약 40초로 어림한다. 계약의 한계 절에 "쪽마다 다시 읽고 가린다"는 있고, 이 수치는 없다.
- **I-3 끝을 넘은 `offset`.** 응답의 `offset`은 `total`로 줄인 값이다(100 → 10).
- **I-4 `total`은 `types`로 거른 뒤의 수다**(`["model_response"]` → `total` 2). 계약의 "`total`과 `skipped`는 쪽마다 journal 전체로 센다"는 "같은 거름이면 쪽마다 같다"는 뜻으로 읽어야 맞다.

## 6. 판 수치

- 이 검토의 판(`96b3671`을 `git archive`해 빌드, 키 변수 없음, APPDATA를 임시 폴더로): 타입 검사 통과, 유닛 2,738건 중 2,734 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과.

## 7. 확인하지 않은 것

- 가리기가 실패해 빠지는 줄: 가림 게이트가 실패하는 길(토큰 id 충돌 여덟 번)을 만들 수 없었다. 코드상 `null`이면 그 줄을 빼고 `skipped`로 센다.
- 심볼릭 링크나 정션인 journal·result.json(`lstat`이 일반 파일이 아니면 `invalid_run_record`인 것은 코드로만 봄).
- GUI의 기록 탭(이 판에 없음).
- Linux·macOS.


---

# R-80b 좁은 확인: U-90 고친 판

- 대상: `pm/unit-U-90` = `6432eae`(main `5c931d1` 위). R-80이 본 `96b3671` 뒤의 수정: `unit/U-90-p5a-adapter`의 `8ecdaf3`(줄을 번호로 판정, 손상을 알림, 글 정리)과 `04da8d2`(main `f7b878a`를 들임: U-74의 기록 종류 둘, U-106, U-107). 검토자 w3:p7(nd-docs).
- 방법: 읽기 전용. `6432eae`를 `git archive`해 빌드했다. 실행은 그 빌드의 실제 CLI와 대본 모델로 임시 폴더에서 만들었고, journal 변형은 사본에만 했다. `report`도 같은 빌드의 실제 CLI로 같은 사본에 불렀다. "앞 판과 달라졌는지"는 R-80의 빌드(`96b3671`)를 같은 프로세스에서 함께 불러 비교했다. 스크립트 `.codaryn/r80b/r80b.mjs`, `r80b2.mjs`, 출력 `r80b-out.txt`, `r80b2-out.txt`.
- 결과: **R-80 M-1은 고쳐졌다. L-1은 문자열 자체는 고쳐졌고 하나가 남았다**(높음 0, 중간 0, 낮음 1, 정보 2).

## 1. 확인 항목

| 볼 것 | 결과 |
| --- | --- |
| 걸러 낸 줄 뒤의 진짜 레코드가 이어지는지 | **이어진다.** seq 5에 낱말이 아닌 필드 이름을 더하면 5만 빠지고 6~10이 나온다(`complete`, `skipped` 1). 조회 때 `text`를 등록하면 4·7·8만, `turn`을 등록하면 3·4·7·8만 빠지고 9·10까지 나온다(R-80에서는 3개·2개만 나왔다) |
| 깨진 줄·빠진 번호·같은 번호 두 번에서 `complete`가 아닌 값과 빠진 수 | **그렇다.** 셋 다 `status: "damaged"`, `missing: 1`이다(2절) |
| 같은 번호가 두 번이면 둘 다 빠지는지 | **둘 다 빠진다.** 진짜 seq 3 앞에 꼴이 맞는 위조 seq 3을 끼우면 3은 주지 않고(`skipped` 2, `missing` 1), 위조 글은 응답에 없다. 4~10은 나온다 |
| `report`가 거부하는 사본에서 `complete`라 하지 않는지 | **그렇다.** `report --json`이 `invalid_run_record`인 여섯 사본 모두 `damaged`였다. `report`가 받는 사본 셋은 `complete` 둘, `incomplete` 하나(2절) |
| L-1: 제어·양방향·보이지 않는 문자의 정리(줄바꿈·탭 유지) | **응답의 문자열에는 남지 않는다.** BEL·ESC·SOH·U+202E·영폭 공백·BOM·소프트 하이픈·이체 선택자·영폭 연결자가 `?`가 되고, CR LF는 LF가 되며, LF와 탭은 남았다(3절). 다만 JSON 글을 담은 문자열 안쪽은 남는다(L-1) |
| 새 기록 종류 둘(`confirmation_requested`, `confirmation_answered`) | **목록에 나오고 같은 처리를 거친다.** 질문의 `tool`은 `(unknown tool)`로 제한되고, `subject`의 등록 값은 토큰, 키 모양은 `[key]`, BEL과 U+202E는 `?`였다. `types`로 둘만 고를 수 있다(4절) |
| 5.13의 문장이 실제와 맞는지 | 잰 문장은 모두 맞다(5절). 재지 못한 것은 5절 끝에 적었다 |
| 정상 실행의 목록이 앞 판과 달라졌는지 | **달라지지 않았다.** 3절 체험 실행(레코드 34개)을 두 빌드로 부르면 레코드가 모두 같고, 출력은 새 필드 `missing: 0`만 다르다. 제어 문자가 든 실행은 그 글이 정리된 만큼 다르다(의도대로) |

## 2. 변형과 결과(실행 A의 사본, 레코드 10개)

| 변형 | `listRunEvents` | 받은 번호 | `report --json` |
| --- | --- | --- | --- |
| 바꾸지 않음 | `complete`, 10, `skipped` 0, `missing` 0 | 1~10 | 받음 |
| seq 2 줄을 깨뜨림 | **`damaged`**, 9, `skipped` 1, `missing` 1 | 1, 3~10 | `invalid_run_record` |
| seq 2 줄을 지움 | **`damaged`**, 9, `skipped` 0, `missing` 1 | 1, 3~10 | `invalid_run_record` |
| seq 5에 `"bad key"` 필드를 더함 | `complete`, 9, `skipped` 1, `missing` 0 | 1~4, 6~10 | 받음 |
| 진짜 seq 3 앞에 위조 seq 3 | **`damaged`**, 9, `skipped` 2, `missing` 1 | 1, 2, 4~10(위조 글 없음) | `invalid_run_record` |
| 끝난 실행의 끝나지 않은 마지막 줄 | **`damaged`**, 10, `skipped` 1, `missing` 0 | 1~10 | `invalid_run_record` |
| seq 3 앞에 seq 50인 줄 | **`damaged`**, 3, `skipped` 8, `missing` 47 | 1, 2, 50 | `invalid_run_record` |
| 다른 실행의 줄을 덧붙임 | **`damaged`**, 10, `skipped` 1, `missing` 0 | 1~10 | `invalid_run_record` |
| seq 11에 모르는 종류를 덧붙임 | `complete`, 10, `skipped` 1, `missing` 0 | 1~10 | 받음 |
| `result.json` 없음, 끝나지 않은 마지막 줄 | `incomplete`, 10, `skipped` 0, `missing` 0 | 1~10 | 받음 |
| 바꾸지 않음, 조회 때 `text` 등록 | `complete`, 7, `skipped` 3 | 1~3, 5, 6, 9, 10 | — |
| 바꾸지 않음, 조회 때 `turn` 등록 | `complete`, 6, `skipped` 4 | 1, 2, 5, 6, 9, 10 | — |

- seq 50 경우는 5.13의 한계("기대보다 훨씬 큰 번호를 단 위조 줄이 앞에 있으면 그 뒤의 진짜 줄은 빠진다. 상태는 `damaged`이고 `missing`이 그만큼 크다")대로다. 조용히 일부만 주지는 않는다.

## 3. L-1 정리(실행 A, 등록 값과 키 값을 지금 등록하고 조회)

모델의 마지막 답에 BEL, ESC(`[31m` 꼴), SOH, CR LF, 탭, U+202E, U+200B, U+FEFF, U+00AD, U+FE0F, U+200D, LF를 넣었다. 새 판의 `model_response.text`(실제):

```
"done: [[CODARYN_SECRET:4c200ddc1fe7381e]] [key] bell? esc?[31m soh? crlf\nline tab\tend rlo?evil zw?sp bom? shy? vs? zwj? lf\nnext"
```

- 응답의 모든 문자열을 하나하나 보았다. 제어(C0, DEL, C1)·양방향·영폭·BOM·소프트 하이픈·이체 선택자 문자와 CR이 든 문자열은 없었다.
- 등록 값(토큰), 키 값, 키 모양(`[key]`)은 응답 어디에도 원문이 없었다.

## 4. 새 기록 종류

U-74의 규칙은 아직 어떤 파일로도 켤 수 없어 진짜 실행으로는 만들 수 없다. 그래서 실행 A의 사본 끝에 다음 번호로 두 줄을 꼴대로 덧붙였다. 질문의 `tool`은 U+202E가 든 이름, `subject`는 등록 값·키 모양·BEL·U+202E가 든 글이다.

- 결과: `complete`, 12, `skipped` 0, `missing` 0. `report --json`도 받았다.
- `confirmation_requested`: `tool` `"(unknown tool)"`, `subject` `"run [[CODARYN_SECRET:596dbf8792a7d31d]] [key] bell? rlo?"`.
- `confirmation_answered`: `{"decision":"deny","by":"default"}`.
- `types: ["confirmation_requested", "confirmation_answered"]`: 2개(seq 11, 12).

## 5. 5.13의 문장 대조

| 문장 | 실제 |
| --- | --- |
| 이 실행의 줄이 아닌 것(깨진 줄, 다른 실행의 줄)은 `skipped`, journal은 손상 | 맞다(깨진 seq 2, 다른 실행의 줄 → `damaged`) |
| 같은 번호를 두 줄 이상이 주면 모두 빼고 그 번호를 `missing`으로 셈, 손상 | 맞다(위조 seq 3) |
| 제자리의 줄은 주든 안 주든 번호를 센다. 그 뒤가 이어진다. 거르는 것은 손상이 아니다 | 맞다(`bad key`, 모르는 종류, `text`·`turn` 등록 → `complete`) |
| 기대보다 큰 번호면 거기서 다시 맞추고 사이는 빠짐, 손상. 작은 번호는 빼고 손상 | 맞다(seq 50: 1, 2, 50만, `missing` 47. 그 뒤의 3~10은 작은 번호로 빠짐) |
| 질문의 `tool`은 내장 도구가 아니면 `(unknown tool)`, `subject`도 가리고 정리 | 맞다(4절) |
| CR LF는 LF, 제어·양방향은 `?`, 줄바꿈·탭은 남음, 기본 무시 문자도 `?` | 맞다(3절). 다만 아래 L-1 |
| `report`의 읽기가 거부하면 `damaged` | 맞다(2절의 여섯 사본) |
| 끝난 실행의 끝나지 않은 마지막 줄은 손상 | 맞다 |
| `result.json`이 없으면 `incomplete`, 끝나지 않은 마지막 줄은 세지 않음 | 맞다(`skipped` 0) |
| `missing`은 손상이 아니면 0 | 맞다 |

- 재지 않은 것: "그 밖의 손상은 `incomplete`보다 `damaged`가 먼저"(결과 없음과 깨진 중간 줄이 함께인 경우), "가린 뒤에 정리하므로 그런 문자로 끊긴 값이나 키도 먼저 찾는다"(이 판에서 따로 재지 않음. 같은 순서의 5.12는 R-78에서 영폭 공백으로 끊긴 값이 가려지는 것을 보았다), 적용 실행의 목록.

## 6. 지적

### L-1(낮음, R-80 L-1의 남은 부분) JSON 글을 담은 문자열의 안쪽은 정리되지 않는다

- 재현: 실행 A(읽은 파일에 BEL, ESC, SOH, CR LF가 듦)의 새 목록에서, `tool_result.result.content`와 `model_request`의 도구 메시지 내용은 JSON 글이다. 그 문자열 자체에는 제어 문자가 없다(JSON 이스케이프 `\u0007`, `\r` 꼴로만 있다). 그러나 `JSON.parse`로 풀면 안쪽 문자열에 BEL, ESC, SOH, CR이 그대로 나온다(seq 6 `tool_result`, seq 7 `model_request`).
  - 키 모양은 안쪽에서도 `[key]`였다. 가림은 이스케이프된 글에서도 찾는다.
- 영향: 그 내용을 글 그대로 보이는 어댑터는 안전하다. 내용을 풀어 파일 내용을 보이는 어댑터는 정리되지 않은 글을 받는다. 5.13의 "모든 문자열을 정리해 준다"는 응답의 문자열에 대해서는 맞고, 그 안의 JSON 글에 대해서는 말하지 않는다.
- 고칠 방향(제안, 택일):
  1. 5.13에 "도구 결과의 `content`는 JSON 글이고, 풀면 그 안의 글은 정리되지 않았다. 어댑터는 풀어 보일 때 정리한다(AC 5.2)"를 적는다.
  2. 앱 계층이 JSON 글로 읽히는 문자열은 풀어서 정리한 뒤 다시 직렬화한다(글이 바뀌므로 다이제스트나 다른 대조에 쓰이지 않는지 먼저 본다).

### 정보

- **I-1 정상 실행의 목록**: 3절 체험 실행을 두 빌드로 부른 결과가 `missing: 0` 하나만 빼고 같다. GUI의 기록 탭이 앞 판을 기준으로 만들어졌어도 레코드는 그대로다. 새 필드 `missing`과 새 상태 값 `damaged`만 더해 읽으면 된다.
- **I-2 위조 줄 하나로 `damaged`**: 실행이 끝난 뒤 다른 프로그램이 다른 실행의 줄 하나만 덧붙여도 목록 전체가 `damaged`가 된다(레코드는 그대로 준다). `report`도 같은 사본을 거부하므로 둘의 판정이 맞다. 기록 탭이 `damaged`를 어떻게 보일지는 GUI 단위의 몫이다.

## 7. 판 수치

- 이 확인의 판(`6432eae`를 `git archive`해 빌드, 키 변수 없음, APPDATA를 임시 폴더로): 타입 검사 통과, 유닛 2,875건 중 2,871 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과.
