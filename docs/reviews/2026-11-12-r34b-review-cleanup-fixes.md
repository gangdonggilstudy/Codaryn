# R-34b 병합 전 재검토: 정리(DR-39)의 수정 DR-44

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 이번 범위의 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다(`merge main`은 "Already up to date").
- **검토 대상(고정)**: `pm/bundle-6b` = `d6b735a3de1b9871e88150868aa6c2550f984648`. 기준은 `pm/bundle-6` `05f3b7c`이다(`git diff pm/bundle-6...pm/bundle-6b`).
- DR-44의 커밋
  - 계약 `73ec895`
  - store `0e8eab7`, `0c8394d`
  - CLI `d77a86f`, `322d8b2`
  - 앱 계층 `ef5f389`, 시험 `f4d62c9`
  - 문구 `1d1ea6c`
  - GUI `90eae16`, `f581cec`(GUI는 범위 밖이라 읽기만 했다)
  - 작성자는 모두 `gangdonggil`이고 trailer가 없다.
- 원 검토: `claude-quality/.codaryn/report-R34.md`(`05f3b7c`, 낮음 L-1~L-3). 결정은 "되돌리지 않은(일부만 되돌린 것 포함) 실행의 기록은 `--include-not-reverted`로 따로 확인해야 지운다"이다.
- 빌드: `git archive d6b735a`를 이 worktree의 `.codaryn/r34b/b`에 풀었다. 루트 node_modules는 사본이고, `tsc` 오류는 0이다.
- 실험
  - **실제 CLI**를 임시 작업 공간(`%TEMP%/codaryn-r34-*`, `%TEMP%/codaryn-r34b-*`)에서 돌렸다.
  - 모델은 대본 모델뿐이다. API 주소는 닫힌 포트 `127.0.0.1:9`이고 키 변수는 넘기지 않았다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - 원 검토의 스크립트(`lib.mjs`, `e1`~`e10`)를 내 사본(`.codaryn/r34b/`)에 복사하고 빌드 경로만 바꿔 다시 돌렸다. 결과는 `r34-rerun.txt`다.
  - 새 탐침은 `r34b-exp.mjs`, 출력은 `r34b-exp.txt`다.
- 단위 시험: DR-39·DR-44 관련 9개 파일 85건 모두 통과(`g-dr44-cleanup`, `dr44-cleanup`, `dr44-cleanup-removal`, `cleanup-dr44`, `g-cleanup`, i18n `catalog`, `dr39-cleanup`, `g-dr39-cleanup`, app `cleanup`).

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 6 (I-1~I-6) |

**PM 중점 항목**

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | 세 재현 절차가 닫혔는가 | **닫혔다.** R-34 L-1: 일부만 되돌린 실행은 `partly_reverted`이고 `--reverted`가 고르지 않는다. L-2: 적용 실행에 `discarded_left`가 늘 붙는다. L-3: 옮긴 뒤 지우기 실패는 `partly_removed`, 종료 1이고, 남은 것이 다음 미리보기에 나와 지워진다(2.1) |
| 2 | 별도 확인 없이 되돌리지 않은 실행이 지워지는 길 | `--confirm`만, `--reverted`와 함께, 실행 id 지정, JSON과 글 모드, 다른 선택의 digest 다시 쓰기, `--include-not-reverted`만으로는 **모두 막혔다**(2.2). 다만 기록이 손상된 실행(`result.json`을 읽을 수 없음)은 경고도 별도 확인도 없이 지워진다(L-1). 미리보기의 안내 줄이 `--include-not-reverted`를 붙인 명령을 그대로 권한다(L-3) |
| 3 | 실패 뒤 남은 폴더, `partly_removed`와 종료 1, 이름을 흉내 낸 폴더 | 남은 폴더는 다음 미리보기에 `leftover`로 나오고 지워진다. 그때 `partly_removed`와 종료 1이 맞다. 그러나 **이름만 흉내 낸 사람의 일반 폴더도 "앞선 정리가 남긴 것"으로 보이고, 아무 선택의 `--confirm`으로 지워진다**(L-2). 정션, 대문자·짧은 이름, 파일은 고르지 않는다 |
| 4 | 원 검토에서 안전하다고 본 것 | **그대로다.** 작업 공간 밖으로 나가지 않는다(안의 정션·하드 링크를 지워도 밖은 그대로, `runs`·실행·`discarded`·`.codaryn` 정션은 항목 0). 도는 실행은 `lock_held`, 적용 중 `workspace_locked`(6). parked·`.gitignore`가 남는다. 미리보기 뒤 새 실행·되돌리기·새 남은 폴더는 `plan_changed`(3)이고 아무것도 지우지 않는다(2.3) |
| 5 | 두 언어 문구가 잃는 것을 분명히 말하는가 | 경고 문구(`not_reverted`, `partly_reverted`, `discarded_left`, 머리줄, 남겨 둔 이유)는 두 언어 모두 잃는 것을 분명히 말한다(2.4). 남은 폴더의 문구는 안에 무엇이 있는지 말하지 않는다(I-3). 한국어 출력에 영어 조각이 남아 있다(I-4) |

## 2. 재현 결과

### 2.1 원 검토의 세 절차

| R-34 | 이 판의 실제 CLI 결과 |
| --- | --- |
| L-1 일부만 되돌린 실행 | r1(되돌리지 않음), r2(완전히 되돌림), r3(`d.txt`를 사람이 고친 뒤 되돌림, `partial`). 미리보기 경고: r1 `not_reverted`, r2 없음, r3 **`partly_reverted`**. `--reverted`는 r2만 고른다. 머리줄 "Of these, runs not reverted or only partly reverted: 2" |
| L-2 폐기 보관함을 남긴 적용 기록 | 계획·적용(이동 하나, 폐기 하나). 적용 실행의 경고는 `not_reverted`와 **`discarded_left`**다(조건부 문구: "if its discarded files stay (their folder not selected, or its deletion not confirmed)…"). `--confirm`만 주면 적용 `not_reverted_not_confirmed`, 계획 `used_by_kept_apply`, 보관함 `not_confirmed`로 셋 다 남는다. `--include-not-reverted`를 더하고 `--delete-discarded`를 빼면 적용·계획 기록은 지워지고 보관함은 남는다. 그 뒤 적용의 되돌리기는 `run_not_found`다. 미리보기가 말한 그대로이고, DR-44 (c)가 정한 "경고"다 |
| L-3 옮긴 뒤 지우기 실패 | 실행 기록 안 파일에 지우기 거부 ACL을 걸고 `--run <id> --confirm … --include-not-reverted`를 했다. **종료 1, `kept: partly_removed`, `removed` 0**이고, `cleanup.jsonl`에도 0으로 적혔다. `.codaryn/cleanup-<16 hex>`에 1개 파일, 5바이트가 남았다. 다음 미리보기에 `leftover` 항목(1개 파일)과 요약 "Left over by an earlier cleanup…: 1 (5 bytes)"가 나왔다. ACL을 둔 채 확인하면 다시 `partly_removed`, 종료 1이다. ACL을 풀고 확인하면 종료 0, "Also removed: leftover folders 1, 5 bytes"이고, 남은 폴더는 0개가 됐다. `cleanup.jsonl`에 `leftovers` 1이 적혔다 |

### 2.2 별도 확인 없이 지워지는 길(r1, r3은 확인이 필요한 실행)

| 시도 | 결과 |
| --- | --- |
| `--older-than 0 --confirm <digest>` | r2만 지움. r1, r3은 `not_reverted_not_confirmed`, 종료 0 |
| `--run <r1> --confirm <digest>`(JSON, 글 모드 모두) | 지우지 않음(`not_reverted_not_confirmed`), 종료 0 |
| `--reverted --confirm … --include-not-reverted` | r1, r3은 고르지 않으므로 지운 것 없음 |
| `--reverted`의 digest로 `--older-than 0 --confirm … --include-not-reverted` | `plan_changed`(3), 지운 것 없음 |
| r2만 고른 digest로 `--run <r1> --confirm … --include-not-reverted` | `plan_changed`(3) |
| `--include-not-reverted`만(`--confirm` 없이) | `invalid_arguments`(2) |
| `--older-than 0 --confirm … --include-not-reverted` | r1, r3 지움(결정대로) |
| 되돌리기 기록(`revert.json`)을 깨뜨린 r2 | `not_reverted`로 바뀌어 별도 확인이 필요해진다(안전한 쪽) |
| 결과 기록(`result.json`)을 깨뜨린 r1(파일을 바꾸고 되돌리지 않은 실행) | **경고 없음, `--confirm`만으로 지워짐**(L-1) |
| 앱 계층을 `includeNotReverted` 없이 부르기(원 검토 `e9`) | `invalid_arguments`(새 필수 필드), 지운 것 없음 |

### 2.3 원 검토의 안전 확인 다시 돌림(`e2`~`e10`)

- 이름: `..`, `.`, `../x`, `latest`, `<id>,..`, `--discarded-run ..`는 모두 `invalid_arguments`다. 대소문자만 다른 id는 항목 0이다.
- 계획 뒤 변화: 미리보기 뒤 새 실행, 미리보기 뒤 되돌리기 모두 `plan_changed`(3)다. 미리보기 뒤에 생긴 `cleanup-<hex>` 폴더도 `plan_changed`다.
- 도는 실행: 미리보기에서 `lock_held`로 막히고, 적용은 `workspace_locked`(6)다.
- 링크
  - `runs` 정션, 실행 정션, `discarded/<id>` 정션, `.codaryn` 정션은 모두 항목 0이고 밖은 그대로다.
  - 실행 기록 안의 정션과 하드 링크를 `--include-not-reverted`로 지웠을 때 밖의 폴더와 하드 링크 대상 내용은 그대로였다.
- 지우지 않는 것: parked(`p.bin`), `.gitignore`가 남고 잠금은 풀렸다.
- 옮기기 실패(나눔 없이 연 파일): `io_error`, 종료 1이다. 핸들이 닫힌 뒤 다시 돌리면 지워진다(원 검토와 같다).

### 2.4 문구(두 언어)

- 미리보기 머리줄
  - en: "Of these, runs not reverted or only partly reverted: N. Their records go only with a confirmation of their own; without them those runs can no longer be reverted."
  - ko: "그중 되돌리지 않았거나 일부만 되돌린 실행: N개. 이 기록은 따로 확인해야 지우며, 지우면 그 실행을 더는 되돌릴 수 없습니다."
- 경고
  - `partly_reverted`: "without its records the rest can no longer be reverted" / "일부만 되돌린 실행: 기록을 지우면 나머지는 더는 되돌릴 수 없음"
  - `discarded_left`(조건부): 두 언어 모두 보관함이 남는 두 경우와 그때 잃는 것(되돌리기로 제자리에 돌려놓을 수 없음)을 말한다.
- 적용 뒤 남겨 둔 이유: "not reverted or only partly reverted, and removing it was not confirmed apart" / "되돌리지 않았거나 일부만 되돌린 실행이고, 따로 확인하지 않음"
- 남은 폴더: "left over by an earlier cleanup that could not remove it entirely" / "앞선 정리가 다 지우지 못하고 남긴 것"(I-3)

## 3. 낮음

### L-1 기록이 손상된 실행은 파일을 바꿨어도 경고와 별도 확인 없이 지워진다

- 위치
  - `src/store/cleanup.ts` 165~184행: 확인된 기록(`checked`)이 없으면 `kind: null`, `changes: 0`이다.
  - `src/contracts/cleanup.ts` `cleanupRecordWarnings`: `kind !== null && changes > 0`일 때만 `not_reverted`·`partly_reverted`를 붙인다.
- 재현(`r34b-exp.mjs` 2)
  - r1이 `a.txt`를 만든 뒤, 그 실행의 `result.json`을 깨뜨렸다.
  - 미리보기에서 r1의 경고는 `[]`이고 막히지도 않는다.
  - `--older-than 0 --confirm`(별도 확인 없음)이 r1을 지웠다. 함께 고른 r2, r3은 `not_reverted_not_confirmed`로 남았다.
- 영향
  - 손상된 실행은 `revert`가 거부한다(`invalid_run_record`). 그래도 그 기록의 스냅숏(바꾸기 전 원본)은 사람이 손으로 되살릴 수 있는 마지막 사본이다.
  - DR-44의 원칙("되돌릴 길을 말없이 잃지 않는다")과 달리, 미리보기가 손상 사실도 말하지 않고 별도 확인도 받지 않는다.
  - 조건이 기록 손상이라 드물다. 기록을 바꾼 명령이 있었다면 DR-38의 표시(`records_changed`)가 붙을 수 있지만, 실행 밖의 손상은 표시가 없다.
- 권고(store·계약): 확인할 수 없는 기록의 실행(`kind: null`)은 `not_reverted`처럼 별도 확인을 받거나, 새 경고(예: "기록을 확인할 수 없음: 되돌릴 수 있는지 알 수 없음")를 붙인다. 안전한 쪽은 앞의 것이다.

### L-2 이름이 `cleanup-<16자리 16진수>`인 일반 폴더는 무엇이든 "앞선 정리가 남긴 것"으로 보고 지운다

- 위치: `src/store/cleanup.ts` 59행, 201~203행, 435~438행. 상태 디렉터리 바로 아래의 이름이 `CLEANUP_LEFTOVER_PATTERN_SOURCE`에 맞는 일반 폴더면 남은 폴더다. 정리가 그 폴더를 만들었다는 표지나 기록은 보지 않는다. 계획마다 늘 들어간다(고를 수 없다).
- 재현(`r34b-exp.mjs` 4)
  - `.codaryn/cleanup-0123456789abcdef/person.txt`를 손으로 만들었다.
  - 완전히 되돌린 실행 하나만 고른 미리보기(`--run <id>`)에 "Leftover folders to remove: 1 (16 bytes)"와 "left over by an earlier cleanup that could not remove it entirely"가 나왔다.
  - 그 digest로 `--confirm`만 주자 그 폴더가 지워졌다(종료 0).
  - 같은 이름 꼴의 정션(밖을 가리킴), 대문자 이름, 짧은 이름, 파일은 고르지 않았고 밖은 그대로였다.
- 영향
  - 상태 디렉터리는 Codaryn의 것이라 사람이 폴더를 두는 일은 드물다. 다만 허용된 명령은 그곳에 쓸 수 있다.
  - 미리보기가 크기를 보이고 `--confirm`이 필요하므로 말없이 지우는 것은 아니다. 그러나 출처를 사실과 다르게 말하고, 지우는 것을 고르지 않은 실행 하나의 정리에 함께 붙는다.
- 권고(store): 옮길 때 그 폴더 안에 표지(예: 정리가 쓴 작은 파일, 또는 `cleanup.jsonl`에 남긴 이름)를 두고, 표지가 있는 것만 남은 폴더로 본다. 표지 없는 같은 이름 꼴은 요약에 "알 수 없는 폴더"로만 보이고 지우지 않는다.

### L-3 미리보기의 안내 줄이 `--include-not-reverted`를 붙인 명령을 그대로 권한다

- 위치: `src/cli/cleanup.ts` 390~392행. 계획에 되돌리지 않은 실행이 있으면 "To remove the run records, run the same command with --confirm <digest> --include-not-reverted."이다.
  - 사람의 파일(`--delete-discarded`)은 명령에 붙이지 않고 따로 한 줄로 알린다("People's discarded files are deleted only with --delete-discarded besides.").
- 재현: 원 검토 `e1b`를 다시 돌린 미리보기(되돌리지 않은 실행 3개)의 끝 줄. 한국어 출력에서도 이 줄은 영어다.
- 영향
  - 머리줄이 별도 확인임을 설명하지만, 권하는 명령을 그대로 옮겨 붙이면 별도 확인이 따로 내린 판단이 되지 못한다.
  - DR-44 (a)의 "따로 확인"이 사람의 파일과 같은 무게로 다뤄지지 않는다.
- 권고(CLI·문구): 권하는 명령에서 `--include-not-reverted`를 빼고, 사람의 파일처럼 따로 한 줄로 알린다. 예: "Runs not reverted are removed only with --include-not-reverted besides." 그리고 두 언어 문구 id로 둔다(I-4).

## 4. 정보

- **I-1 원 검토의 세 낮음은 결정대로 닫혔다**(2.1). 계획 실행은 그것을 쓰는 적용이 남으면 함께 남는다(`used_by_kept_apply`). 손상된 되돌리기 기록은 "되돌리지 않음"으로 다룬다(안전한 쪽).
- **I-2 원 검토의 안전 확인은 그대로다**(2.3).
- **I-3 남은 폴더의 문구가 안에 무엇이 있을 수 있는지 말하지 않는다**: 남은 폴더에는 스냅숏(작업 공간 원본의 평문 사본)이나 폐기 보관함의 사람 파일이 남을 수 있다. 문구는 "앞선 정리가 다 지우지 못하고 남긴 것"뿐이다. 지우면 되살릴 수 없다는 말도 없다. 사람의 파일 보관함에 붙는 "people's own files are deleted" 같은 말이 없다.
- **I-4 한국어 출력의 영어 조각이 남아 있다(원 검토 I-2와 같음, 이번에 늘었다)**
  - 크기 조각 "N file(s), N bytes"
  - 미리보기 끝의 안내 줄들. 새 "Nothing was removed. To remove what earlier cleanups left, run the same command with --confirm …"을 포함한다.
  - 적용 뒤 줄의 대상 이름표 "run"
- **I-5 `.codaryn` 자체가 정션이면 빈 계획의 적용이 `cleanup.jsonl`을 정션 너머에 쓴다**(원 검토 I-4와 같음). 지우는 것은 없다.
- **I-6 확인하지 않은 범위**: GUI(Electron)의 정리 화면과 GUI 시험(PM도 돌리지 않음), Linux·macOS, 파일 심볼릭 링크(이 호스트 권한 없음, EPERM), 아주 큰 상태 디렉터리의 시간, 실제 API.

## 5. PM 판단 필요

- **P-1(L-1)**: 기록을 확인할 수 없는 실행의 기록도 `--include-not-reverted`로 따로 확인받게 할지
- **P-2(L-2)**: 남은 폴더를 이름만이 아니라 정리가 남긴 표지로 가릴지(병합 전, 또는 후속)
- **P-3(L-3)**: 미리보기가 권하는 명령에 `--include-not-reverted`를 넣지 않고 따로 알릴지

사용자에게 물을 질문은 없다.

## 6. 실행한 것

- 읽기
  - `git diff pm/bundle-6...pm/bundle-6b`의 `src/contracts/cleanup.ts`, `src/store/cleanup.ts`(남은 폴더, 경고, 지우기), `src/cli/cleanup.ts`(옵션, 확인, 출력, 안내 줄)
  - 원 검토 보고서
- 빌드: `d6b735a`(tsc 0). 단위 시험 85건 통과.
- 실험
  - 원 검토 스크립트 9개 재실행(`r34-rerun.txt`)
  - `r34b-exp.mjs` 1~7: 확인 없는 길, 손상 기록, 옮긴 뒤 실패와 남은 폴더, 흉내 낸 폴더, 안의 링크, 보관함이 있는 적용, 두 언어 적용 문구
  - 임시 작업 공간과 ACL은 실험 뒤 풀었다.
- 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용.
