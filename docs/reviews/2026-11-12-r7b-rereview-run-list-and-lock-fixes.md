# R-7b 재검토: N-27 (a)~(e) 수정을 R-7의 재현 입력으로 다시 확인

## 0. 이해 확인

- 페르소나: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 읽기 전용 재검토이며 저장(w3:p6)·CLI(w3:p2) 수정의 구현자가 아니다.
- worktree: `D:\project\Codaryn\.worktrees\claude-quality`(main 변화 없음). 저장소 파일 수정·커밋 없음.
- **검토한 커밋**: `claude/core-tools` `b5bc346`(12:42:52 고정). 네 수정이 모두 들어 있다.
  - `13d3f3e` fix(store): 디렉터리 이름이 글자 그대로 같을 때만 실행 id를 받는다(N-27 a).
  - `c22863e` fix(store): Linux 잠금 주인을 부팅 뒤 틱과 boot id로 판정한다(N-27 d).
  - `0d50341` fix(cli): 손상 실행의 report 거부, report JSON을 쓰기 전에 키를 가린다(N-27 b, c).
  - `f530e35` feat(cli): 모든 `--run` id에 store의 실행 판정을 쓴다(N-27 a 연결).
  - 비교(수정 전): R-7이 본 `2a94a44`.
- 방법:
  - 두 커밋을 `git archive`로 `.codaryn/r7b/old`, `.codaryn/r7b/new`에 빌드 사본으로 만들었다. new는 i18n 타입 오류 4건이 있고(병합 순서, 3절 정보 1), 산출물은 만들어진다.
  - R-7 원문의 재현 입력(R-2 M-2 형식의 위조 기록, BEL로 끊긴 키 모양, 깨진 `revert.json`, 살아 있는 잠금)을 원문 설명대로 다시 만들었다.
  - 두 빌드의 실제 CLI 프로세스에 같은 입력을 넣었다. old에서 원래 결함이 재현되므로 입력이 맞다.
  - 실제 API 미실행. API 주소는 닫힌 루프백이다.

## 1. 결과

- **막힘: R-7 항목 5건 중 5건.**
  - M-1, L-2, L-3, I-2는 실제 CLI로 막힌 것을 확인했다.
  - L-1은 Linux 호스트가 없어 코드와 주입한 `/proc`으로 확인했다.
- **새 발견: 0건**(결함 없음). 정보 3건(3절).
- 정상 실행의 runs·report·revert는 두 빌드가 같은 결과를 냈다.

## 2. 항목별

| R-7 | 결정 | old `2a94a44` | new `b5bc346` | 판정 |
| --- | --- | --- | --- | --- |
| M-1 대소문자만 바꾼 id(미래) | N-27 a | 목록에 대문자 id가 `damaged`. 소문자 id로 `revert --dry-run`은 `complete`(notes.md 삭제 예정), 실제 revert는 `complete`이고 **notes.md가 지워짐**. report는 `incomplete` | 대문자 `invalid_run_record`. 소문자 id는 dry-run, revert, report 모두 `run_not_found`이고 notes.md는 남음 | 막힘 |
| M-1 과거 시각 변형 `20261111…` | N-27 a | 위와 같이 지워짐 | 위와 같이 막힘 | 막힘 |
| M-1 섞인 대소문자 `…235957z-0C0FFEE2` | N-27 a | 지워짐 | `run_not_found`, 남음 | 막힘 |
| I-2 손상 실행의 report | N-27 b | `report --json` 종료 3, 위조 내용이 보고서로 나옴. 글 출력도 보고서 | `invalid_run_record`(종료 2), "no report is shown". 글 출력도 같은 오류. 같은 실행의 revert도 `invalid_run_record` | 막힘 |
| L-2 BEL로 끊긴 키 모양의 report JSON | N-27 c | JSON에 `sk-ant-AB\u0007CDEF…`가 그대로 있음 | JSON의 경로가 `[key]`. 글 출력도 가림 | 막힘 |
| L-3 깨진 `revert.json`의 runs 글 출력 | N-27 e | `internal_error`(종료 70) | 종료 0, "되돌리기 기록 손상" 표시 | 막힘(이 트리에는 N-B 문구 `a0cba7b`가 있다) |
| L-3 `workspace_locked`의 stderr | N-27 e | 비어 있음 | 지우라는 안내(`lock.json`) 있음, 종료 6 | 막힘 |
| L-1 Linux 벽시계 변화 | N-27 d | (Windows라 재현 불가) | 아래 참고 | 코드·주입으로 막힘 확인 |

L-1 확인 내용(`c22863e`):
- 잠금에 `processStartTicks`(`/proc/<pid>/stat` 22번째 필드)와 `bootId`를 함께 적는다. 둘 다 있으면 다른 비교보다 먼저 정확히 대조한다. 벽시계와 무관하다.
- 주입 실행(`linuxProcessIdentity`에 `platform: "linux"`와 가짜 `/proc` 내용):
  - 명령 이름에 공백·괄호가 있어도(`my (weird) proc) x`) 22번째 필드를 맞게 읽는다.
  - 잘린 줄, 괄호 없음, boot id 형식 오류, `/proc` 읽기 실패, Windows는 모두 null이고 예전 규칙으로 돌아간다.
- 이 저장소의 잠금 시험 `lock-identity`·`lock-start-time` 15건 통과.
- Windows의 시작 시각 불일치 잠금은 두 빌드 모두 실행이 회수하고 `done`이다(N-25 b 회귀 없음).
- 남는 한계: `/proc`을 읽을 수 없는 Linux(예: `hidepid`)에서는 예전 벽시계 비교로 돌아가므로 L-1이 남는다. 커밋 설명대로 Linux 호스트에서는 실행하지 않았다.

정상 흐름(두 빌드 같음):
- 데모 실행 두 번 `done`. `runs --json` 두 항목 `checked`, `runs` 글 종료 0.
- `report --run <id> --json`은 `complete`, `report --run latest`는 종료 0.
- `revert --run latest --dry-run`은 최신 실행을 고른다.
- 첫 실행 되돌리기: `summary.md:deleted`이고 `notes.md`는 남는다.
- 다시 되돌리기: `complete`, `already_reverted`, `revertedBefore: complete`. 되돌린 뒤 `report` `complete`.

## 3. 정보

1. **병합 순서(N-27 e와 같은 부류)**
   - `b5bc346`의 계약에는 새 문구 매개변수 종류 `digest`(`e57e8f9`)가 있다. 이 트리의 `src/i18n/params.ts`에는 없어서 타입 검사가 실패하고 i18n 유닛 9건이 실패한다. 빠진 문구 id도 있다(이 트리에는 N-B의 DR-21 문구 `cee5faf`가 아직 없다).
   - 지금은 `digest` 종류를 쓰는 고정 문구가 없어 실행 중에 이 경로로 들어가지 않는다.
   - PM 답(재검토 뒤): `digest` 종류는 더하지 않는다. `e57e8f9`는 계약 담당이 보고 전에 고쳐 다시 만든 커밋의 옛 판이다. 최종 판 `8723c10`은 다이제스트를 매개변수가 아니라 메시지 뒤 항목으로 낸다. 옛 판이 든 브랜치는 최종 판을 받아 해소한다. N-B 카탈로그는 이미 `8723c10` 기준이다(`b5a467d`).
2. **A-1 유닛 기대가 뒤져 있다**:
   - `tests/unit/app/n7-runs.test.ts`가 두 번째 되돌리기에 `changed_since_run`을 기대하는데 N-22 뒤로 `already_reverted`다.
   - `app.test`(doctor 점검 수), `r1-decisions`(AC-D15)는 앞서 보고한 것과 같다.
   - N-27과 무관하다. new 빌드 유닛: 1298건 중 1283 통과, 12 실패(i18n 9, A-1 3), 3 건너뜀.
3. **통합**: new 빌드 387건 중 379 통과, 8 실패(`s01`·`p04`·`n01`)이며 이전 묶음 트리와 같은 시험 기대 문제다. N-27로 새로 생긴 실패는 없다.

## 4. 검사하지 않은 범위

- Linux·macOS 실제 호스트(대소문자 구분 볼륨, `/proc`, `ps`).
- `plan`, `apply`, `review`의 `--run`(f530e35가 같은 판정을 쓰게 했지만, 이 트리에서 계획 실행을 끝까지 만드는 CLI 흐름은 돌리지 않았다).
- R-7 I-1(시계를 뒤로 맞춘 경우)은 결정된 동작이라 다시 보지 않았다.

## 5. 재현 자료 (`.codaryn/r7b/`, Git 추적 제외)

- `old/`, `new/`: 빌드 사본.
- `exp.mjs` → `exp.out`(K1~K3, B, C, G, L, N, 정상 되돌리기 흐름).
- `unit-new.txt`, `integration-new.txt`.
