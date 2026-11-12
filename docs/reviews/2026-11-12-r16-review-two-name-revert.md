# R-16 교차 검토 보고서: 끊긴 이동이 남긴 두 이름의 되돌리기(store, 읽기 전용)

## 0. 대상과 방법

- 대상: `claude/core-tools` **`4e3235b`**(gangdonggil, 2026-11-12 14:57)
  - fix(store): a move cut between its link and the removal of its source leaves one file under two names; the revert removes the added name and keeps the original (R-15 L-1)
  - 바뀐 파일: `src/store/apply-revert.ts`(+52), `tests/unit/store/g-apply-revert.test.ts`(+111)
- 기준: 검토 R-15 L-1(`docs/reviews/2026-11-12-r15-review-late-engine-changes.md`)
- 빌드: `git archive 4e3235b`를 스크래치에 풀어 빌드했다(tsc 오류 0). store 유닛 153건 모두 통과했다.
- 재현 방식: R-15의 `crash.mjs`와 같다.
  - 실제 엔진 `applyPlan`, 실제 적용기, store 기록과 계획 점유를 쓴다.
  - 자식 프로세스를 링크 뒤·원본 지우기 전에 `process.exit`로 끊는다.
  - 되돌리기는 store의 `revertRun`이다.
- 값은 모두 가짜다. 실제 API, 네트워크, 키 파일은 쓰지 않았고, 저장소 파일도 고치지 않았다.
- 스크립트와 출력(스크래치): `r16/exp/lib.mjs`, `child.mjs`, `r16.mjs`, `r16.out`

## 1. 요약

| 등급 | 건수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 0 | |
| 낮음 | 1 | L-1 되돌려 놓기에 실패하면 옮겨 둔 파일이 상태 디렉터리에 남고 알려지지 않는다 |
| 정보 | 2 | I-1 끝 기록이 있는 이동에도 적용된다, I-2 옮겨 둔 이름 |

중점별 결과

- R-15 L-1(이동, 폐기): 풀린다.
  - 더해진 이름(목적지, 보관본)만 지우고, 원래 자리가 같은 파일을 유지한다(nlink 2 → 1).
  - 두 번째 되돌리기는 빈 결과다.
- 같은 내용의 다른 파일(복사본): 원래 자리든 목적지든 지우지 않는다(`changed_since_run`).
- 지우기 직전에 다른 파일이 놓인 경우
  - 옮겨 둔 뒤 다시 확인해서 지우지 않는다.
  - 다만 되돌려 놓는 자리가 그새 차면 L-1이 된다.
- 작업 공간 밖·링크
  - 목적지 디렉터리가 바깥 폴더로 가는 정션이면 손대지 않는다(`changed_since_run`). 바깥 이름도 그대로다.
  - 바깥에 세 번째 이름이 있는 경우도 바깥은 그대로다.
- 드라이 런: 결과만 말하고 파일, 되돌리기 기록, 옮겨 둔 이름 어느 것도 만들거나 바꾸지 않는다.
- 정상 되돌리기: 끝까지 간 이동·폐기의 결과가 그대로다(`moved_back`, `restored_from_discard`).

## 2. 재현 결과(`r16.out`)

| # | 경우 | 끊긴 뒤 상태 | 드라이 런 | 되돌리기 | 뒤 상태 |
| --- | --- | --- | --- | --- | --- |
| 1 | 이동, 링크 뒤·지우기 전(기록: `apply_started`, `plan_checked`, `plan_item_started`) | `a.txt`·`x/a.txt` 같은 ino, nlink 2 | `moved_back`, 파일·`revert.json`·옮긴 이름 변화 없음 | `moved_back` | `a.txt`만, nlink 1. 두 번째 되돌리기는 빈 결과 |
| 2 | 폐기, 같은 지점 | `a.txt`·보관본 같은 ino | `restored_from_discard` | `restored_from_discard` | `a.txt`만, nlink 1 |
| 3 | 1 뒤 `a.txt`를 같은 내용 복사본으로 바꿈(다른 ino) | | `changed_since_run` | `changed_since_run` | 두 파일 모두 남음 |
| 3b | 1 뒤 목적지를 같은 내용 복사본으로 바꿈 | | | `changed_since_run` | 두 파일 모두 남음 |
| 4 | `removeSecondName`(export)을 다른 파일에 직접 부름 | | | `false` | 두 파일 그대로, 옮긴 이름 없음 |
| 4b | 4와 같고, 옮겨 둔 동안 원래 이름에 새 파일을 쓰는 경쟁자 | | | `false` | **300회 중 300회 옮겨 둔 파일이 `.codaryn/revert-*.tmp`에 남음** → L-1 |
| 5 | 1 뒤 `x`를 바깥 폴더로 가는 정션으로 바꾸고, 바깥에 같은 파일의 이름을 둠 | | `changed_since_run` | `changed_since_run` | `a.txt`와 바깥 이름 그대로 |
| 5b | 1에 바깥 하드 링크를 더함(nlink 3) | | | `moved_back` | `x/a.txt`만 지워지고 `a.txt`와 바깥 이름은 남음(바깥 nlink 2) |
| 6 | 끝까지 간 이동 / 폐기 | | `moved_back` / `restored_from_discard` | 같음 | 원래 자리로 돌아옴 |
| 6b | 끝까지 간 이동 뒤 사람이 `a.txt`에 하드 링크를 만듦(끝 기록 있음) | 같은 ino, nlink 2 | | `moved_back` | `x/a.txt`가 지워지고 `a.txt`만 남음 → I-1 |

## 3. 낮음

### L-1 되돌려 놓기에 실패하면 옮겨 둔 파일이 상태 디렉터리에 남고 알려지지 않는다

- 위치: `src/store/apply-revert.ts` `removeSecondName`
  - 더해진 이름을 `.codaryn/revert-<16진>.tmp`로 옮긴다.
  - 다시 확인해 같은 파일이 아니면 `moveWithoutReplacing(parked, added)`로 되돌려 놓는다.
  - 이 호출이 `taken`(그새 그 이름에 무언가 생김)이나 `failed`를 돌려주면 결과를 보지 않는다. 옮겨 둔 파일은 상태 디렉터리에 남는다.
  - 되돌리기 결과는 그 항목의 `io_error` 하나다.
- 재현(4b)
  - 원래 이름에 다른 파일을 두고 부르면서, 같은 프로세스의 경쟁자가 그 이름에 `wx`로 계속 쓰게 했다.
  - 300회 모두 옮겨 둔 파일("other")이 `.codaryn/revert-*.tmp`에 남았다. 원래 이름에는 경쟁자의 파일이 있었다.
  - 잃은 내용은 없다. 그러나 사람의 파일이 보이지 않는 상태 디렉터리로 옮겨졌고, 어디로 갔는지 아무도 알려 주지 않는다.
- 선행 조건(실제 흐름)
  - 되돌리기는 작업 공간 잠금을 쥐고 있다. 그래서 경쟁자는 Codaryn 밖의 프로세스다(편집기, 동기화 도구 등).
  - 경합이 두 번 겹쳐야 한다.
    - 첫째, 확인(`sameFile(away, back)`)과 옮기기 사이에, 또는 옮긴 뒤에 원래 자리나 목적지가 다른 파일로 바뀌어 다시 확인이 실패해야 한다.
    - 둘째, 되돌려 놓기 전에 그 이름에 새 파일이 생겨야 한다.
  - 4b는 첫째 조건을 처음부터 만든 강한 재현이다. 그래서 낮음으로 둔다.
- 권고(store 담당)
  - 되돌려 놓기가 실패하면 옮겨 둔 파일을 사람이 찾을 수 있게 한다. 예를 들어 결과에 그 경로를 담은 건너뜀 사유를 둔다.
  - 또는 옮겨 둘 곳을 같은 디렉터리 안의 숨긴 이름 대신, 되돌리기 기록에 남는 이름으로 정한다.
  - 함수 주석의 "put back without replacing anything"은 맞지만, 되돌려 놓지 못한 경우를 적어야 한다.

## 4. 정보

- **I-1** 새 규칙은 시작 기록만 있는 행동뿐 아니라 끝 기록(`file_moved`)이 있는 이동에도 적용된다(주석: "the apply's, or a revert's own move back").
  - 6b: 끝까지 간 이동 뒤 사람이 원래 자리에 하드 링크를 일부러 만들었다. 되돌리기는 목적지 이름을 지우고 `moved_back`이다.
  - 내용은 남고 결과도 "원래 자리로 돌아옴"과 같아서 잃는 것은 없다. 다만 사람이 둔 두 번째 이름이 하나 줄어든다.
  - 이전에는 `original_path_taken`으로 손대지 않았을 경우다. 의도라면 계약 주석(`changes.ts`의 되돌리기 규칙)에 한 줄 적어 두면 좋다.
- **I-2** 옮겨 둔 이름(`revert-<8바이트 16진>.tmp`)은 상태 디렉터리 바로 아래에 생기고, 지우기 전에 다시 확인한다.
  - 상태 디렉터리를 쓸 수 있는 허용 명령(T-11)이 그 이름을 맞혀 확인과 삭제 사이에 바꿔 넣는 경우를 생각할 수는 있다. 실제로는 무작위 이름과 짧은 창 때문에 현실성이 낮다.
  - 그 이름이 실행 목록이나 다른 판단에 끼어들지는 않는다(`listRuns`는 `runs/` 아래만 본다).

## 5. 검사하지 않은 범위

- Linux·macOS(ino 판정, 대소문자를 구분하는 볼륨)
- 하드 링크가 없는 볼륨(FAT·exFAT): 그곳에서는 L-1 상태 자체가 생기지 않는다(링크를 만들 수 없음). `ino` 0 검사는 코드로만 확인했다.
- CLI·앱 계층의 출력: 되돌리기 결과 형이 바뀌지 않아 따로 보지 않았다.
- 대소문자만 다른 이동(Windows): 계획 단계에서 `destination_exists`로 막히는지 실행하지 않았다.

## 6. 담당별 요청

- store(w3:p6): L-1(되돌려 놓기 실패 시 옮겨 둔 파일을 알림), I-1(끝 기록이 있는 이동에 적용되는 점을 계약·주석에 적을지)
