# R-34 병합 전 검토: DR-39 정리 (pm/bundle-6, 읽기 전용)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 구현자가 아닌 세션이다.
  - 다만 정리 문구(`cleanup.*`, 두 언어)는 내가(N-B) 쓴 것이다. (3)의 문구 판단에는 그 점을 밝혀 둔다.
  - 저장소 파일 수정과 커밋은 없다.
- **검토한 판**: `pm/bundle-6` **`05f3b7c`**(20:39 고정). main `23daf6b` 위에 9개 브랜치를 합친 것이다.
  - 정리 코드 커밋: store `dab75e6`, app `f411b75`, CLI `ae6242d`.
  - 계약: `src/contracts/cleanup.ts`.
- 읽은 것
  - `git diff main...pm/bundle-6`
  - `src/store/cleanup.ts`(전체), `src/cli/cleanup.ts`(전체), `src/app/cleanup.ts`(전체)
  - `src/store/common.ts`의 `isPlainDirectory`, `hasExactRunEntry`, `ensureStateDir`
- 실험
  - `.codaryn/r34/src`(05f3b7c의 `git archive`, typecheck 오류 0)에서 **실제 CLI**를 임시 작업 공간(`%TEMP%/codaryn-r34-*`)에서 돌렸다.
  - 실행은 scripted 모델이다. API 주소는 닫힌 포트 `127.0.0.1:9`이고 키 변수는 넘기지 않았다.
  - 스크립트: `.codaryn/r34/lib.mjs`, `e1*.mjs`~`e10.mjs`.
- 이 판의 정리 시험(store·CLI·app): 21/21 통과.

## 요약

| 심각도 | 건수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 0 | |
| 낮음 | 3 | L-1 일부만 되돌린 실행을 "되돌린 실행"으로 본다(경고 없음, `--reverted`가 고름). L-2 폐기 보관함을 고르고 확인하지 않으면 `discarded_left` 경고 없이 적용 기록만 지워진다. L-3 옮긴 뒤 지우기가 실패하면 "지웠다"고 보고하고, 남은 것이 숨은 디렉터리에 영영 남는다 |
| 정보 | 8 | I-1~I-8 |

- 지우면 안 되는 것은 모두 지켜졌다(2절 확인 목록).
  - 링크(정션·하드 링크)를 따라가 작업 공간 밖을 지우는 길은 없다.
  - 도는 중인 실행, 잠금, parked, `.gitignore`도 지워지지 않는다.
  - 계획 뒤 상태가 바뀌면 아무것도 지우지 않는다.
  - 이상한 이름은 거부되거나 아무것도 고르지 않는다.
- 확인 없는 지우기는 없다. digest 앞 12자 이상(`--confirm`)이 있어야 하고, 사람의 파일은 `--delete-discarded`를 따로 줘야 한다.
- 지운 크기는 디스크와 같고, 출력과 기록에 파일 이름·내용·비밀이 없다. 예외는 L-3의 실패 경우다.

## 1. 발견

### L-1 (낮음) 일부만 되돌린 실행을 "되돌린 실행"으로 본다

- 위치: `src/store/cleanup.ts:155`(`reverted: checked.reverted !== null`), `:256`(`not_reverted`는 `!reverted`일 때만), `:209`(`--reverted`).
- 재현(`e1b.mjs`)
  - 실행 r3이 `c.txt`, `d.txt`를 쓴다.
  - 사람이 `d.txt`를 고친 뒤 되돌리면 결과는 **partial**이다(`d.txt`는 `changed_since_run`으로 건너뜀).
  - 정리 미리보기에서 r3에는 **경고가 없다**. 되돌리지 않은 r1에는 `not_reverted`가 붙는다.
  - `--reverted`는 r3을 r2(완전히 되돌림)와 함께 고른다.
- 영향
  - r3의 기록을 지우면 `d.txt`를 나중에 되돌릴 길(사람이 고친 것을 치운 뒤 다시 되돌리기)이 없어진다. 그런데 사람은 그 말을 듣지 못한다.
  - `--reverted`라는 이름도 "다 되돌린 것"으로 읽힌다.
- 권고(store w3:p6): `reverted.status === "complete"`만 되돌린 실행으로 본다.
  - partial은 `not_reverted`를 붙이거나, 새 경고(예: `partly_reverted`, 계약·N-B 문구)를 둔다.
  - `--reverted`는 complete만 고른다.

### L-2 (낮음) 폐기 보관함을 고르고 확인하지 않으면, 경고 없이 적용 기록만 지워져 사람의 파일을 되돌릴 수 없게 된다

- 위치: `src/store/cleanup.ts:257`. `discarded_left`는 **고르지 않았을 때만** 붙는다(`!selectedDiscarded.has(id)`). 확인(`confirmation.discarded`)은 보지 않는다.
- 재현
  - CLI(`e2.mjs`)
    - `cleanup --older-than 0 --discarded-older-than 0`의 미리보기에서 적용 실행의 경고는 `not_reverted`뿐이다.
    - 같은 digest로 `--confirm`만 준다(`--delete-discarded` 없이). 결과는 적용·계획·실행 기록이 지워지고 폐기 보관함은 `not_confirmed`로 남는 것이다.
    - 그 뒤 적용 실행의 되돌리기는 `run_not_found`다. 폐기된 `y.txt`는 보관함에 남았지만 되돌리기로는 제자리에 갈 수 없다.
  - 앱 계층(`e9.mjs`): `applyCleanupIn(... confirmation: { discarded: false })`도 같다. GUI 경로다.
- 영향
  - 사람이 본 미리보기에는 "적용 기록은 지우지만 폐기 보관함은 남아 되돌릴 수 없다"(`discarded_left`)는 말이 없다.
  - 확인할 때 보관함 삭제만 빼는 것은 자연스러운 선택이라 일어나기 쉽다.
  - 파일 자체는 남는다(사람이 손으로 옮길 수 있다). 그래서 낮음이다.
- 권고(store, CLI·앱)
  - (가) 고른 보관함의 적용 실행에도 `discarded_left`를 "보관함 삭제를 확인하지 않으면"이라는 조건부로 미리 보인다.
  - 또는 (나) 보관함 삭제를 확인하지 않은 확인에서는 그 적용 실행 기록도 `not_confirmed`로 남긴다.
  - (나)가 안전한 쪽이다.
- 덧붙임: 보관함만 남은 미리보기의 끝 줄이 "To remove the run records, run the same command with --confirm …"라고 한다. 지울 실행 기록은 없는데도 그렇다(I-3).

### L-3 (낮음) 옮긴 뒤 지우기가 실패하면 "지웠다"고 보고하고, 남은 것이 숨은 디렉터리에 남는다

- 위치: `src/store/cleanup.ts:326-334`
  - 항목 디렉터리를 `.codaryn/cleanup-<hex>`로 옮긴다(`rename`).
  - `rm(aside, { recursive: true, force: true }).catch(() => undefined)`로 지우고 오류를 버린다.
  - 그리고 `removed`에 넣는다.
  - `scan`은 `cleanup-*`를 보지 않는다.
- 재현(`e6e7.mjs` E7a)
  - 실행 기록 안의 하위 폴더 파일 하나에 지우기 거부 ACL을 걸었다(`icacls /deny (D)`와 상위의 `(DC)`).
  - `cleanup --run <id> --confirm …` 결과: **종료 0, `removed` 1, `kept` 0**. `cleanup.jsonl`에도 그 실행이 5개 파일 4,523바이트를 지운 것으로 적힌다.
  - 실제로는 `.codaryn/cleanup-…`에 파일이 남았다(이 재현에서는 1개).
  - 다음 미리보기와 요약은 그것을 보이지 않는다(항목 0, 실행 기록 0바이트). 다시 지울 방법도 없다.
- 영향
  - "지운 것의 요약이 실제와 같은지"(중점 5)가 이 경우 깨진다.
  - 실행 기록에는 스냅숏(작업 공간 원본의 평문 사본, architecture A-5)이 있다. 남는 것이 스냅숏이면 숨은 곳에 평문이 남는다.
  - 조건이 옮긴 뒤의 삭제 실패(권한, 다른 프로세스의 잠김)라서 드물다. 그래서 낮음이다.
  - 비교: 옮기기 자체가 실패하면(파일을 나눔 없이 연 프로세스, E7b) 그 항목은 `io_error`로 남는다(종료 1). 핸들이 닫힌 뒤 다시 돌리면 지워진다. 이 길은 안전하다.
- 권고(store)
  - 삭제 실패를 결과에 드러낸다. 예: `kept`의 `io_error`나 새 이유 "일부 남음", 종료 1.
  - `rm`에 `maxRetries`를 준다.
  - 다음 요약·정리에서 남은 `cleanup-*`를 찾아 보이고, 지울 수 있게 한다.
  - 정리 기록(`cleanup.jsonl`)에는 실제로 지운 것만 적는다.

## 2. 확인한 것 (문제 없음)

| 중점 | 경우(실제 CLI) | 결과 |
| --- | --- | --- |
| (1) 링크 | 실행 기록 안의 **정션**(밖 폴더를 가리킴)과 **하드 링크**(밖 파일) | 실행 기록만 지워지고 밖 폴더·파일은 그대로다. 파일 심볼릭 링크는 이 호스트에 권한이 없어 만들지 못했다(I-8) |
| (1) 링크 | `.codaryn/runs`가 정션 / 실행 디렉터리 하나가 정션 / `discarded/<id>`가 정션 / `.codaryn` 자체가 정션 | 모두 항목이 0이고 밖은 그대로다. 실경로를 대조해서다(`isPlainDirectory`, realpath). `.codaryn` 정션은 I-4 |
| (1) 이름 | `--run ..`, `.`, `../x`, `latest`, `<id>,..`, `--discarded-run ..` | 모두 `invalid_arguments` |
| (1) 이름 | 대소문자만 바꾼 id | 항목 0(정확한 이름만) |
| (1) 도는 중인 실행 | 7초 명령을 도는 실행 중 | 미리보기에서 `lock_held`로 막혔다. 적용은 `workspace_locked`(종료 6)이고 아무것도 지우지 않았다 |
| (1) 지우지 않는 것 | 전부 고르고 보관함까지 확인 | `parked/`(1개, 7바이트), `.gitignore`가 남고 잠금은 풀렸다. 계획 실행은 그것을 쓰는 적용이 함께 지워질 때만 지워진다 |
| (1) 계획 뒤 변화 | 미리보기 뒤 새 실행 / 미리보기 뒤 되돌리기 | 둘 다 `plan_changed`(종료 3)이고 아무것도 지우지 않았다 |
| (2) 확인 없이 | `--delete-discarded`만 / 11자 digest / 대문자 digest / 틀린 digest / 다른 선택의 digest | 앞의 셋은 `invalid_arguments`, 뒤의 둘은 `plan_changed`. 모두 아무것도 지우지 않았다 |
| (2) JSON·비대화형 | `--json` 미리보기 | 지우지 않는다. 묻는 것이 없고 digest 확인만이 지우는 길이다(I-7) |
| (3) 경고 문구 | 되돌리지 않은 실행·적용 실행 | 두 언어 모두 "not reverted: without its records it can no longer be reverted" / "되돌리지 않은 실행: 기록을 지우면 더는 되돌릴 수 없음". 잃는 것을 분명히 말한다. 예외는 L-1, L-2 |
| (4) 중간 실패 | 옮기기 실패(열린 파일) | 그 항목은 `io_error`(종료 1)이고 나머지는 지워졌다. 다시 돌리면 지워진다. 옮긴 뒤 실패는 L-3 |
| (5) 출력 | JSON·글(ko/en) 미리보기·적용 | 파일 이름(`a.txt`, `y.txt` 등)과 내용, 비밀 모양 글이 없다. 실행 id·크기·코드만 나온다. 키 가림(`hideKeys`)도 거친다 |
| (5) 요약과 실제 | 지운 4항목의 파일·바이트 | 지우기 전에 잰 디스크 값과 모두 같다. `cleanup.jsonl`은 개수와 바이트만 담는다(이름·경로 없음, DR-39) |
| 앱 계층 | 모르는 필드, `..` id, 짧은 digest, 불리언 아닌 discarded | 모두 `invalid_arguments`. 틀린 digest는 `plan_changed`, `discarded: false`는 보관함을 남긴다 |

## 3. 정보

- **I-1** 되돌리지 않은 적용 실행의 폐기 보관함만 지운 경우
  - 경고는 `people_files`("사람의 파일을 지움")뿐이다. 그 적용을 되돌려도 그 파일은 돌아오지 않는다는 말은 없다.
  - 그 뒤 되돌리기는 partial이고, 그 파일의 이유를 `changed_since_run`이라고 한다. 실제 이유는 폐기 사본이 없는 것이라 오해를 부른다(store의 되돌리기 이유).
- **I-2** 한국어 출력에 영어가 섞인다
  - 크기 조각 "2 file(s), 4403 bytes"(`sizeText`)와 끝의 안내 두 줄("Nothing was removed. To remove…", "People's discarded files…")은 고정 영어이고 문구 id가 없다(CLI 주석이 밝힘).
  - 확인 머리줄 `cleanup.confirm.runs/discarded`는 질문형("…지울까요?")이다. 묻지 않는 CLI 미리보기에서는 답할 곳 없는 질문처럼 읽힌다.
  - 이 문구는 내 몫(N-B)이다. CLI 미리보기용 머리줄과 안내 문구 id가 계약에 생기면 맞춘다.
- **I-3** 보관함 항목만 있는 미리보기도 끝 줄이 "To remove the run records"라고 한다.
- **I-4** `.codaryn` 자체가 정션이면 빈 계획의 적용도 잠금을 잡고 `cleanup.jsonl`을 정션 너머(작업 공간 밖)에 쓴다. 지워지는 것은 없다.
- **I-5** 끝나지 못한(결과 없음) 실행은 잠금이 없어도 `no_result`로 늘 막힌다. 손으로 지우는 것 말고 정리할 길이 없다. 설계상 안전한 쪽이다.
- **I-6** `discarded/` 아래 대소문자만 다른 이름의 폴더가 요약에는 세지지만, 나이로는 골라지지 않는다(정확한 `--discarded-run`으로만). 무해하다.
- **I-7** 확인은 digest뿐이고 터미널 질문이 없다. 스크립트가 `--json` 미리보기의 digest로 바로 확인할 수 있다. `apply`의 다이제스트 승인과 같은 설계다.
- **I-8** 파일 심볼릭 링크(실행 기록 안)는 이 호스트에서 만들 권한이 없어 확인하지 않았다(EPERM). 코드는 `lstat`으로 보고 따라가지 않는다(`measure`의 `"o"`).

## 4. PM 질문

1. **되돌리지 않은 실행 기록의 삭제를 막을지**(중점 3)
   - 지금은 경고만 하고 digest 하나로 다른 항목과 함께 지운다.
   - 근거
     - 그 기록은 실행이 바꾼 파일을 되돌릴 유일한 수단이다. 지우면 되돌릴 수 없다.
     - 경고는 긴 목록의 줄 끝에 붙는다.
     - 사람의 파일(보관함)은 따로 확인(`--delete-discarded`)을 받는데, 되돌릴 길을 잃는 쪽은 그렇지 않다.
   - 가정: 막지는 않는다(오래된 실행을 정리할 수 있어야 한다). 대신 다음을 둔다.
     - (가) `--delete-discarded`처럼 별도 확인(예: `--include-not-reverted`, GUI는 따로 묻기)
     - (나) 확인 머리줄에 "되돌리지 않은 실행 N개 포함"
     - 이때 L-1의 일부만 되돌린 실행도 같이 다룬다.
2. **L-1~L-3를 병합 전에 고칠지**
   - 가정: L-2(나)와 L-3는 병합 전, L-1과 I-1~I-3은 후속이다.
   - L-2와 L-3는 사람이 본 것과 실제가 어긋나는 문제다.

## 5. 검사하지 않은 범위

- GUI(Electron) 메인·화면의 정리 흐름과 GUI 시험(PM도 돌리지 않음). 앱 계층 함수만 확인했다.
- Linux·macOS(대소문자 구분 볼륨, 심볼릭 링크 권한), 네트워크 드라이브.
- 매우 큰 상태 디렉터리의 시간(`measure`가 트리를 두 번 걷는다).
- 실제 API.
