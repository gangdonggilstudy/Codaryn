# R-34c 병합 전 확인(좁게): R-34b의 새 낮음 셋

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 이번 범위의 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다(`merge main`은 "Already up to date").
- **확인한 판(고정)**: `pm/bundle-6c` = `39df2baacd13e07880bc64f465a204f54f2e35ae`. 범위는 `git diff pm/bundle-6b...pm/bundle-6c -- src`의 정리 수정이다.
  - 계약 `eacd18e`: 손상된 실행은 별도 확인, 남은 폴더는 표지로 가림
  - store `40a7ef1`: 손상된 실행을 되돌리지 않은 것으로, 남은 폴더를 표지로
  - CLI `0d10fe3`: 권하는 명령에서 `--include-not-reverted`를 빼고 따로 알림
  - 문구 `9d30686`
  - 작성자는 모두 `gangdonggil`이다.
- 빌드: `git archive 39df2ba`를 `.codaryn/r34c/b`에 풀었다(tsc 오류 0).
- 실험
  - **실제 CLI**를 임시 작업 공간(`%TEMP%`)에서 돌렸다. 모델은 대본 모델이고, API 주소는 닫힌 포트 `127.0.0.1:9`, 키 변수는 넘기지 않았다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - 원 검토 R-34의 스크립트(`e1`~`e10`)와 R-34b의 탐침(`r34b-exp.mjs` 1~7)을 이 판에 다시 돌렸다. R-34c용 8~10절을 더했다.
  - 앞 판(`d6b735a`)의 결과와 비교했다(`r34c/compare.mjs`, `diff`).
  - 출력은 `.codaryn/r34c/r34-rerun.txt`, `r34c-exp.txt`다. ACL은 실험 뒤 풀었다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (L-1) |
| 정보 | 3 (I-1~I-3) |

| R-34b | 결과 |
| --- | --- |
| L-1 손상된 실행 | **닫혔다.** 경고와 별도 확인이 생겼다. 경고 줄은 계약의 `records_unreadable`이 아니라 `not_reverted`다(L-1) |
| L-2 이름만 흉내 낸 폴더 | **닫혔다.** 표지 없는 `cleanup-<16 hex>` 폴더는 지우지 않는다. 다만 계약대로 "보여만" 주지는 않고 아무 데도 나오지 않는다(L-1). 사람이 store의 표지 파일을 넣은 폴더는 남은 폴더로 지운다(I-1) |
| L-3 권하는 명령 | **닫혔다.** 권하는 명령은 `--confirm <digest>`뿐이고 `--include-not-reverted`는 따로 한 줄로 알린다 |
| 앞서 닫힌 것 | **다시 열리지 않았다.** R-34의 셋과 안전 확인 모두 앞 판과 같은 결과다. 달라진 것은 문구, 위 세 수정, 그리고 판단 순서 하나(I-3)뿐이다 |

## 2. 확인 결과

### 2.1 손상된 실행(R-34b L-1)

- r1이 `a.txt`를 만들고, 그 실행의 `result.json`을 깨뜨렸다.
  - 미리보기 경고는 `["not_reverted"]`이고, 머리줄 개수에 들어간다(`notReverted` 2).
  - `--older-than 0 --confirm`만 주면 r1은 `not_reverted_not_confirmed`로 남는다(앞 판에서는 지워졌다).
  - `--include-not-reverted`를 더하면 지워진다.
- 머리줄은 손상된 것을 말한다.
  - en: "Of these, runs not reverted, only partly reverted, or whose records cannot be checked: 2. … without them those runs can no longer be reverted or put back by hand."
  - ko: "그중 되돌리지 않았거나, 일부만 되돌렸거나, 기록을 확인할 수 없는 실행: 2개. … 지우면 그 실행을 더는 되돌릴 수 없고 손으로 되살릴 수도 없습니다."
- 그러나 그 실행의 줄은 "not reverted: without its records it can no longer be reverted"다(L-1).

### 2.2 남은 폴더의 표지(R-34b L-2)

- 표지가 없는 일반 폴더 `.codaryn/cleanup-0123456789abcdef/`(사람의 파일 하나)
  - 항목이 아니고, 아무 선택의 `--confirm` 뒤에도 남았다.
  - 요약·미리보기 어디에도 나오지 않는다(`summary.unknownFolders` 없음, 글 출력에 줄 없음).
- 사람이 store의 표지 파일(`.codaryn-cleanup`, 내용은 아무것)을 넣은 같은 꼴의 폴더
  - "left over by an earlier cleanup…" 항목이 됐고, 완전히 되돌린 실행 하나를 고른 `--confirm`으로 함께 지워졌다(I-1).
- 계약의 표지(`cleanup-leftover.json`, 계약의 내용 그대로)를 넣은 폴더
  - 남은 폴더로 보지 않고 지우지도 않는다. store가 이 이름을 쓰지 않는다(L-1).
- 정리가 실제로 남긴 폴더(ACL로 지우기 실패)
  - 종료 1, `partly_removed`다.
  - 남은 폴더에는 표지 `.codaryn-cleanup`과 지우지 못한 `held/`가 있다(표지를 마지막에 지운다).
  - 다음 미리보기에 `leftover`로 나오고, ACL을 푼 뒤 확인하면 지워진다(남은 폴더 0).

### 2.3 권하는 명령(R-34b L-3)

- 미리보기 끝 줄
  - "Nothing was removed. To remove the run records, run the same command with --confirm <digest>."
  - 그다음 따로 "The records of N run(s) not reverted, or only partly, are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted."
- 사람의 파일 줄("People's discarded files are deleted only with --delete-discarded besides.")은 그대로다.

### 2.4 앞서 닫힌 것

원 검토 스크립트 8개를 앞 판과 이 판에서 돌려 정규화한 출력을 비교했다(실행 id, 시각, digest를 바꿔서). 다른 곳은 다음뿐이다.
- 위 문구 바뀜
- R-34 E7b의 판단 순서(I-3)

R-34b 탐침 1~7도 다음 넷 말고는 같다(목록 순서 하나 포함).
- 손상된 실행(2.1)
- 남은 폴더에 표지가 하나 더 든 것(2.2)
- 흉내 낸 폴더를 이제 지우지 않는 것(2.2)
- 목록 순서

그대로인 것:
- 일부만 되돌린 실행은 `partly_reverted`이고 `--reverted`가 고르지 않는다.
- 확인 없는 길(`--confirm`만, 실행 id 지정, JSON·글, 다른 선택의 digest, `--include-not-reverted`만)은 막혀 있다.
- 적용의 `discarded_left`, 계획의 `used_by_kept_apply`가 붙는다.
- 실행 기록 안의 정션·하드 링크를 지워도 밖은 그대로다. `runs`·실행·`discarded`·`.codaryn` 정션은 항목 0이다.
- `lock_held`, `workspace_locked`(6)이다.
- parked·`.gitignore`가 남는다.
- 계획 뒤 변화는 `plan_changed`(3)이다.
- 이름 거부(`..`, `latest` 등)가 그대로다.
- 두 언어 적용 문구가 같다.

## 3. 낮음

### L-1 계약과 store가 세 곳에서 다르다(수정이 두 브랜치에서 따로 들어왔다)

| 계약(`eacd18e`, `src/contracts/cleanup.ts`) | store(`40a7ef1`, `src/store/cleanup.ts`) | 사람에게 보이는 차이 |
| --- | --- | --- |
| 손상된 실행의 경고는 `records_unreadable`(`cleanupRecordWarnings`가 `kind: null`에 붙임). 문구 `cleanup.warning.records_unreadable`도 있다 | `kind === null`이면 `cleanupRecordWarnings`를 부르지 않고 `not_reverted`를 붙인다 | 실행 줄이 "not reverted"라고 사실과 다르게 말한다. 그 실행이 파일을 바꿨는지, 되돌렸는지는 알 수 없다. 새 문구는 쓰이지 않는다. 별도 확인은 둘 다 받으므로 지우는 동작은 같다 |
| 표지 파일은 `cleanup-leftover.json`(`CLEANUP_LEFTOVER_MARK_FILE_NAME`)이고, 내용은 `isCleanupLeftoverMark`(정확한 세 필드와 그 폴더의 id)로 가린다 | 표지 파일은 `.codaryn-cleanup`이다. 일반 파일이기만 하면 내용은 보지 않는다. 쓰는 내용도 `{schemaVersion, kind, target, at}`이라 계약의 꼴(`leftoverId`)과 다르다 | 계약의 함수로 store의 남은 폴더를 가리면 모두 "표지 없음"이 된다(앞으로 앱·GUI가 계약을 쓰면 어긋난다) |
| 표지 없는 같은 이름 꼴은 `StateSummary.unknownFolders`로 "보여만" 준다. 문구 `cleanup.summary.unknown_folders`도 있다 | `unknownFolders`를 만들지 않는다. CLI도 그리지 않는다 | 그런 폴더가 있다는 것을 사람이 알 수 없다. 지우지는 않으므로 안전한 쪽이다 |

- 영향: 지우는 쪽의 안전은 지켜진다. 사람이 보는 말과 계약이 정한 것이 다르고, 새 문구 두 개가 쓰이지 않는다.
- 권고(store): 계약의 이름과 함수(`CLEANUP_LEFTOVER_MARK_FILE_NAME`, `isCleanupLeftoverMark`, `cleanupRecordWarnings`)를 쓰고 `unknownFolders`를 채운다. CLI가 그것을 그린다. 병합 전이 아니어도 된다(동작은 안전하다).

## 4. 정보

- **I-1 표지를 흉내 낸 폴더**: 사람(또는 허용된 명령)이 `.codaryn/cleanup-<16 hex>/` 안에 `.codaryn-cleanup` 파일을 넣으면, 그 폴더는 남은 폴더로 보이고 아무 선택의 `--confirm`으로 지워진다. 미리보기에는 크기와 함께 나온다. 표지는 우연을 막는 것이고 일부러 만든 것은 막지 못한다. 계약의 꼴(내용 확인)도 같은 내용을 쓰면 흉내 낼 수 있다.
- **I-2 한국어 출력의 영어 조각**(R-34b I-4와 같다): 새 안내 줄("The records of N run(s) … --include-not-reverted yourself …")과 "Nothing was removed…" 줄, 크기 조각 "N file(s), N bytes"는 한국어 출력에서도 영어다.
- **I-3 R-34 E7b(옮기기 실패)의 순서가 바뀌었다**
  - 앞 판에서는 별도 확인 없이 고른 되돌리지 않은 실행이 먼저 옮기기를 시도해 `io_error`(종료 1)였다. 이 판에서는 옮기기 전에 `not_reverted_not_confirmed`로 남는다(종료 0).
  - 같은 경우에 `--include-not-reverted`를 주면 앞 판과 같이 `io_error`, 종료 1, 남은 폴더 0이다. 다른 실행은 지워졌다.
  - 지우는 것은 어느 쪽도 없다.

## 5. PM 판단 필요

- **P-1(L-1)**: 계약과 store를 맞추는 것(경고 코드, 표지 이름과 내용, 알 수 없는 폴더 보이기)을 병합 전에 할지, 후속으로 둘지

사용자에게 물을 질문은 없다.

## 6. 실행한 것

- 읽기: `git diff pm/bundle-6b...pm/bundle-6c -- src`(계약·store·CLI·문구), store와 CLI·앱에서 새 계약 이름의 쓰임 검색
- 빌드: `39df2ba`(tsc 0)
- 실험
  - 원 검토 스크립트 8개 재실행과 앞 판 비교
  - R-34b 탐침 1~7 재실행과 비교
  - 8절(표지 셋, 두 언어 미리보기), 9절(손상된 실행, 두 언어 문구, 확인 유무), 10절(옮긴 뒤 실패와 표지)
  - E7b를 `--include-not-reverted`로 다시 돌림
- 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용.
