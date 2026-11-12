# R-40 병합 전 확인(좁게): 단위 U-3 — 정리의 계약과 store 맞춤

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 이번 범위의 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다(작업 시작 때 `merge main`만).
- **확인한 판(고정)**: `pm/unit-U-3` = `7556be65615e4fb2cc506d3c4785e843ae55adff`. 기준은 main `93dfbd3`이다(`git diff 93dfbd3...pm/unit-U-3`, 7개 파일).
  - store `26a10db`: 계약의 `records_unreadable`과 표지, 알 수 없는 폴더 세기
  - CLI `4d4e414`: 알 수 없는 폴더 보이기, 안내 줄에 손상된 실행 포함
  - 앱 계층 시험 `99ec142`
  - 작성자는 모두 `gangdonggil`이다.
- 빌드: `git archive 7556be6`를 `.codaryn/r40/b`에 풀었다(tsc 오류 0).
  - 이전 판의 정리는 main `6df2eae`의 빌드(`.codaryn/docs22`)를 썼다. `6f85b65`와 `src`가 같다(`git diff 6f85b65 6df2eae -- src` 비어 있음).
- 실험
  - **실제 CLI**를 임시 작업 공간(`%TEMP%`)에서 돌렸다. 모델은 대본 모델이고, API 주소는 닫힌 포트 `127.0.0.1:9`, 키 변수는 넘기지 않았다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - 원 검토 R-34의 스크립트 8개와 R-34b·R-34c의 탐침(`r34b-exp.mjs` 1~10)을 이 판에 다시 돌려 R-34c 판(`39df2ba`) 결과와 비교했다.
  - 새 탐침은 `r40-exp.mjs`다(A 이전 판이 남긴 폴더, B 표지를 못 쓴 경우, C 표지 여러 꼴).
  - 출력은 `.codaryn/r40/`에 있다. ACL은 실험 뒤 풀었다.
- 단위 시험: 정리 관련 7개 파일 50건 모두 통과(켜진 `g-dr44b-cleanup`, `dr44b-cleanup`, `cleanup-r34b` 포함).

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (L-1, L-2) |
| 정보 | 2 (I-1, I-2) |

| 항목 | 결과 |
| --- | --- |
| (1) R-34c L-1의 세 가지 | **맞춰졌다.** 손상된 실행은 `records_unreadable`("records cannot be checked: whether it changed files or was reverted is not known, and removing them may remove the last copies of those files" / 한국어도)이고 여전히 `--include-not-reverted` 없이는 남는다. 표지는 계약의 `cleanup-leftover.json`이고 내용을 `isCleanupLeftoverMark`로 가린다. 표지 없는 폴더는 요약에 "Unknown folders (…never removed): N (B bytes)"로 보이고 지워지지 않는다 |
| (2) 이전 판이 남긴 폴더 | **알 수 없는 폴더로 보이고, 새 판으로는 영영 지울 수 없다**(L-1). 표지를 쓰지 못한 경우의 새 동작도 같은 끝에 이른다(L-2) |
| (3) R-34·R-34b에서 닫힌 것 | **다시 열리지 않았다.** R-34 스크립트 8개의 출력은 안내 줄 문구만 다르다. R-34b·R-34c 탐침 1~10은 의도한 차이(위 세 가지)와 목록 순서 말고는 같다 |

## 2. 확인 결과

### 2.1 세 가지 맞춤

- 손상된 실행(`result.json`을 깨뜨림)
  - 경고 `records_unreadable`이 붙는다. 머리줄 개수에 들어가고, `--confirm`만으로는 남으며(`not_reverted_not_confirmed`), `--include-not-reverted`로 지워진다.
  - 따로 알리는 줄도 "not reverted, only partly reverted, or whose records cannot be checked"로 바뀌었다.
- 표지
  - 정리가 옮긴 폴더에 `cleanup-leftover.json`(`{"schemaVersion":1,"kind":"cleanup_leftover","leftoverId":…}`)을 쓴다.
  - 옮긴 뒤 지우기가 실패하면 그 표지와 지우지 못한 것이 남는다. 다음 미리보기에 남은 폴더로 나오고, ACL을 푼 뒤 확인하면 지워진다.
- 같은 이름 꼴의 폴더 여섯(`r40-exp.mjs` C)

  | 폴더 안 | 결과 |
  | --- | --- |
  | 표지 없음 | 알 수 없는 폴더(보임, 남음) |
  | 이전 판 표지(`.codaryn-cleanup`) | 알 수 없는 폴더(보임, 남음) |
  | 계약 표지, `leftoverId`가 다름 | 알 수 없는 폴더(보임, 남음) |
  | 계약 표지, 필드 하나 더 | 알 수 없는 폴더(보임, 남음) |
  | 계약 표지, 4096바이트 넘음 | 알 수 없는 폴더(보임, 남음) |
  | 계약 표지 그대로 | 남은 폴더, 함께 지워짐(I-1) |

  - 두 언어 요약 줄: "Unknown folders (.codaryn/cleanup-…, named like a cleanup's leftover but without its mark; never removed): 5 (5299 bytes)" / "알 수 없는 폴더(.codaryn/cleanup-…, 정리가 남긴 폴더의 이름이지만 그 표지가 없음, 지우지 않음): 5개(5299바이트)"

### 2.2 이전 판(`6f85b65`의 정리)이 남긴 폴더

- 이전 판으로 실행 하나를 지우다 ACL로 실패시켰다(`partly_removed`, 종료 1). 남은 폴더에는 `.codaryn-cleanup`과 `held/`가 있다.
- ACL을 푼 뒤 새 판의 결과
  - 미리보기: 항목 없음, 요약에 "Unknown folders …: 1 (98 bytes)", 끝 줄 "Nothing to clean up."
  - 다른 실행을 고른 확인(`--include-not-reverted`까지 줌): 그 실행만 지우고 남은 폴더는 그대로다.
  - 같은 작업 공간을 이전 판으로 보면 그 폴더는 여전히 남은 폴더 항목이다.

### 2.3 앞서 닫힌 것

다음은 R-34c 판과 같은 결과다.
- 일부만 되돌린 실행의 `partly_reverted`와 `--reverted`
- 확인 없는 길(`--confirm`만, 실행 id, JSON·글, 다른 digest, `--include-not-reverted`만)
- 적용의 `discarded_left`와 계획의 `used_by_kept_apply`
- 안의 정션·하드 링크를 지워도 밖이 그대로인 것, `runs`·실행·`discarded`·`.codaryn` 정션
- `lock_held`, `workspace_locked`, parked·`.gitignore`
- `plan_changed`, 이름 거부
- 옮기기 실패의 `io_error`
- 두 언어 적용 문구

## 3. 낮음

### L-1 이전 판이 남긴 폴더는 새 판에서 지울 길이 없다

- 원인: 표지의 이름과 내용이 바뀌었다(`.codaryn-cleanup` → `cleanup-leftover.json`, 내용 확인). 이전 표지를 알아보는 길이 없다.
- 재현: 2.2
- 영향
  - 남은 폴더에는 실행 기록의 일부가 들어 있다. 실행 기록에는 스냅숏, 곧 작업 공간 원본의 평문 사본이 들 수 있다. 폐기 보관함을 지우다 남았다면 사람의 파일이다.
  - 이것들이 상태 디렉터리에 남고, 정리 명령으로는 지울 수 없다.
  - 요약 줄은 "never removed"라고만 하고, 그것이 무엇일 수 있는지, 어떻게 지우는지는 말하지 않는다.
  - 이전 판의 지우기가 실패한 작업 공간에서만 생기므로 드물다.
- 권고(store·CLI·문서): 셋 중 하나를 고른다.
  - (가) 이전 표지(`.codaryn-cleanup`, 일반 파일)도 한 판 동안 남은 폴더로 받아들인다.
  - (나) 요약 줄 다음에 "정리가 남긴 것이라고 확인되면 손으로 지운다"는 안내와 그 안에 원본 사본이 있을 수 있다는 말을 둔다.
  - (다) 사용 안내 18.8절에 같은 내용을 적는다(문서 담당 몫, 내가 할 수 있다).

### L-2 표지를 쓰지 못하고 지우기도 실패하면, 실행 기록이 사라진 채 지울 수 없는 폴더로 남는다

- 원인: `src/store/cleanup.ts`의 옮긴 뒤 처리
  - 이전 판: 표지를 쓰지 못하면 폴더를 제자리로 되돌리고 `io_error`로 남겼다(다시 시도할 수 있음).
  - 이 판: 표지 쓰기 실패를 무시하고 지우기를 계속한다(계약 주석 "a mark that cannot be written does not stop the removal; what is then left is an unknown folder"대로).
- 재현(`r40-exp.mjs` B)
  - 실행 기록 폴더에 파일 만들기 거부(`WD`)를, 그 안 파일에 지우기 거부(`D`, `DC`)를 걸었다.
  - 이전 판: 종료 1, `io_error`, 실행 기록은 그대로다. ACL을 풀면 다음 미리보기에서 다시 고를 수 있다.
  - 이 판: 종료 1, `partly_removed`이다. `runs`에서 그 실행이 사라졌고, 표지 없는 `cleanup-<hex>/held/`가 남았다. ACL을 푼 뒤 미리보기는 알 수 없는 폴더 1개(5바이트)만 보이고, 고를 항목이 없어 지울 수 없다.
- 영향
  - 사람이 지우기를 확인한 실행이므로 지운 것 자체는 뜻대로다.
  - 그러나 R-34 L-3에서 닫은 "남은 것이 지울 수 없는 숨은 곳에 남는다"가 이 이중 실패에서는 다시 생긴다. 이제는 요약에 보인다는 점만 다르다.
  - 표지 쓰기 실패(권한, 디스크 가득)와 지우기 실패가 겹쳐야 하므로 드물다.
- 권고(store): 이전 판처럼, 표지를 쓰지 못하면 폴더를 제자리로 되돌리고 `io_error`로 남긴다. 그래야 다시 시도할 수 있다. 계약 주석도 맞춘다.

## 4. 정보

- **I-1 계약 표지를 그대로 흉내 낸 폴더는 남은 폴더로 지운다**(R-34c I-1과 같은 성질): `leftoverId`까지 맞춘 `cleanup-leftover.json`을 사람이나 허용된 명령이 넣으면 지워진다. 미리보기에 크기와 함께 나온다. 표지는 우연을 막는 것이다.
- **I-2 한국어 출력의 영어 조각은 그대로다**(R-34b I-4): 바뀐 안내 줄("The records of N run(s) not reverted, only partly reverted, or whose records cannot be checked are kept unless…")도 한국어 출력에서 영어다. 크기 조각 "N file(s), N bytes"도 같다.

## 5. PM 판단 필요

- **P-1(L-1)**: 이전 판의 남은 폴더를 받아들일지(가), 안내만 할지(나·다)
- **P-2(L-2)**: 표지를 쓰지 못한 경우를 이전처럼 되돌려 `io_error`로 남길지

사용자에게 물을 질문은 없다.

## 6. 실행한 것

- 읽기: `git diff 93dfbd3...pm/unit-U-3 -- src`(store, CLI)
- 빌드: `7556be6`(tsc 0). 단위 시험 50건 통과.
- 실험
  - `r40-exp.mjs` A·B·C(이전 판 빌드와 새 판 빌드를 같은 작업 공간에)
  - R-34 스크립트 8개와 R-34b·R-34c 탐침 1~10 재실행, `r40/compare.mjs`와 `diff`로 R-34c 판과 비교
- 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용.
