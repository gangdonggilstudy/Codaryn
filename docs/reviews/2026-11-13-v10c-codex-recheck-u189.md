# V-10c — U-189 검색 불완전 표시 재확인

- 검증자: **codex-probe / 검증 엔지니어**, Windows, Node `v26.13.1`.
- 브랜치 `unit/U-189-p5u-gui`, 후보 `6326aeb3917eb7f2763e0ed031da84c80f92a8be`. 수정은 `a287b13..6326aeb -- src`, 기존 동작 비교는 `6f9eff4ae241553c9d9759659231d1032ca10ed1` 기준.
- 실험 루트 R: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10c-6326aeb`. 두 판은 R/compare 아래 git archive 사본. 새 worktree·브랜치 없음.
- **추가 발견: 높음 0 / 중간 0 / 낮음 0. V-10b 중간 1건은 재현 입력에서 해소됐다.** 지속적인 정상 폴더 변경에 대한 보수적 거부는 아래 수치대로 남는다.

## 1. 검색이 불완전함을 알리는 자리

기존 `search-omission.mjs`를 수정 없이 실행했다. 대상 `parent/a.txt`의 `inside needle\n`은 그대로 두고, 파일을 연 직후 형제 파일을 생성·삭제한다.

| 항목 | 기준 `6f9eff4` | V-10b 후보 `a287b13`¹ | 이번 `6326aeb` |
| --- | --- | --- | --- |
| 대상 바이트 변경 | 없음 | 없음 | 없음 |
| 파일 읽기 | 1회 | 3회 시도 | 3회 시도 |
| `ok` | true | true | true |
| `payload.entries` | 일치 1개 | 빈 배열 | 빈 배열 |
| `payload.truncated` | false | **false** | **true** |

¹ V-10b에서 보존한 실행 결과이며 이번에 그 판을 다시 실행한 것은 아니다. 이번 원문은 `R/search-omission-results.json`.

- 표시 위치는 **기존 도구 결과 본문의 `truncated` 불리언**이다. 새 오류 코드·필드·입력 인수·도구 정의를 추가하지 않았다. `src/tools/index.ts:288` 부근에서 읽기 `io_error`로 건너뛸 때 true로 바꾼다.
- 엔진은 이 payload를 가려 JSON으로 만들고 `ToolResult.content` 및 journal의 `tool_result`에 넣는다(`src/engine/index.ts:1095,1104`, 코드 확인). 따라서 모델이 받는 도구 결과의 불완전 표시다. 이번 재현은 실제 도구 결과까지 실행했고, 별도 UI 알림이나 실제 API 수신까지 확인한 것은 아니다.
- 이 상황의 **실제 결과 값**이 false→true로 달라지는 것은 수정 목적이다. 도구 선언과 고정 요청 틀이 바뀌었다는 뜻은 아니다.

| 정의·고정 값 확인 | 결과 |
| --- | --- |
| `a287b13..6326aeb`의 `src/contracts`, `src/model`, `tests/unit/model` | 변경 파일 0 |
| 기준·후보의 실행 시점 정의 상수 5종² | 직렬화 값과 SHA-256 모두 동일 |
| `contracts/tool.ts`, `sp0-golden.ts`, `sp0-scenarios.ts` | 두 archive의 파일 바이트 동일 |
| SP-0 고정 시험 | 8개 시험 통과, 6분류·64개 고정 시나리오 일치 |

² `BUILTIN_TOOLS`, `WORKFLOW_TOOLS`, `TOOL_DEFINITIONS`, `WORKFLOW_TOOL_DEFINITIONS`, `ALL_TOOL_DEFINITIONS`. 원문: `R/definition-audit.json`, `R/unit-tests.tap`. SP-0는 모의 전송이며 실제 API가 아니다.

## 2. 같은 경합 틀

`race.mjs`·`normal.mjs`·`search-omission.mjs`는 V-10b 파일과 SHA-256이 같다.

| 후보 도구·모드 | 호출 | 외부 내용 | 외부 이름 | 외부 해시 |
| --- | ---: | ---: | ---: | ---: |
| read_file | 13 | 0 | 0 | 0 |
| search_files 내용 | 13 | 0 | 0 | 0 |
| search_files 이름 | 3 | 0 | 0 | 0 |
| inspect_files | 3 | 0 | 0 | 0 |
| **합계** | **32** | **0** | **0** | **0** |

gate→도구, resolve→사용, 첫 경로 검사·open·fstat·두 번째 검사·read 주변, `aba-parent`를 기존 틀 그대로 실행했다. 이름·inspect는 기존 틀의 3단계다. 32건에는 내부 다른 경로 교체 대조군 4건이 포함된다. 9건은 Windows가 열린 파일의 부모 rename 자체를 막았으므로 제품 방어 성공으로 세지 않는다. 기준 판 대조 12회를 포함한 스크립트 총 실행은 44회. 단계별 원문: `R/race-results.json`, `R/cases-final/*/result.json`.

## 3. 정상 사용과 남는 거짓 거부

| 정상 입력 검사 | 결과 |
| --- | --- |
| 일반/내부 링크, 한글·BOM·빈 파일·64 KiB·256 KiB·상한 초과 등 | 48쌍 비교, 새 차이·거짓 거부 0 |
| 다른 프로세스의 시점 고정 파일 변경 | 5건: 덮어쓰기·축소·파일 교체 성공, 상한 초과 성장 `too_large` |
| 다른 프로세스가 같은 파일을 연속 덮어씀 | 세 도구 각 20회, 총 60/60 성공 |
| 정상 형제 파일 생성·삭제 시점 고정 | 36건 중 `io_error` 거짓 거부 5건; 모두 변경 중단 후 성공 |

옛 정상 틀의 파일 교체 행은 기대값 `io_error` 때문에 `pass:false`지만, 이번에도 재시도 후 정상 성공한 것이며 결함이 아니다. 한 번의 동일 파일 교체를 거부하지 않는다는 뜻이다. 원문: `normal-results.json`, `churn-results.json`.

별도 프로세스가 정상 형제 파일을 계속 생성·삭제할 때의 이번 실측:

| 도구 | 변경 위치 | 호출 | 명시적 거짓 거부 | 정상 대상 누락 + 불완전 표시 | 표시 없는 누락 |
| --- | --- | ---: | ---: | ---: | ---: |
| read_file | 대상 부모 | 20 | 4 | 0 | 0 |
| read_file | workspace 루트 | 20 | 9 | 0 | 0 |
| search_files 내용 | 대상 부모 | 20 | 2 | 4 | 0 |
| search_files 내용 | workspace 루트 | 20 | 0 | 8 | 0 |
| search_files 이름 | 대상 부모 | 20 | 0 | 0 | 0 |
| search_files 이름 | workspace 루트 | 20 | 1 | 0 | 0 |
| inspect_files | 대상 부모 | 20 | 17 | 0 | 0 |
| inspect_files | workspace 루트 | 20 | 17 | 0 | 0 |
| **합계** | | **160** | **50** | **12** | **0** |

명시적 거부는 모두 `io_error`, 대상 파일은 항상 그대로였다. 검색에서 대상이 빠진 12건 모두 `truncated:true`였다. 불완전 표시 전체는 15건이며 나머지 3건은 대상 일치를 반환했지만 다른 읽기 누락도 표시한 경우다. `churn.mjs`에는 기존 측정에 `truncated`별 집계를 더했으며 입력·변경 동작은 유지했다. 변경을 멈춘 뒤 8개 묶음 모두 성공했다. 횟수는 동시 실행 타이밍에 의존하므로 V-10b와의 비율 차이를 성능 개선으로 해석하지 않는다.

## 4. 실행·검증 범위

| 검사 | 결과 |
| --- | --- |
| archive 두 판 컴파일 | 2/2 성공 |
| 기존 CLI 비교 | 27개 시나리오·508개 정규화 산출물, 차이 0, 종료 0 |
| 관련 시험 10개 파일 | 총 106, 통과 105, 실패 0, 건너뜀 1, 취소·todo 0; 러너 1,501.7998 ms |
| 건너뜀 | 볼륨에서 실제 8.3 짧은 이름이 생성되지 않는 사례 |

실행 명령(비교는 관리 저장소 cwd, 탐침은 R cwd):

```powershell
git -C D:/project/Codaryn diff a287b13 6326aeb3917eb7f2763e0ed031da84c80f92a8be -- src
node D:/project/Codaryn/scripts/compare-cli-boards.mjs --base 6f9eff4 --head 6326aeb3917eb7f2763e0ed031da84c80f92a8be --work D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10c-6326aeb/compare --out D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10c-6326aeb/compare.md --keep
node ./search-omission.mjs
node ./race.mjs
node ./normal.mjs
node ./churn.mjs
node ./test-runner.mjs
node ./definition-audit.mjs
```

시험 래퍼는 R/tmp와 재귀 정리 경로 검사 아래 관련 파일만 `node --test --test-concurrency=1 --test-reporter=tap`으로 실행했다. 정확한 인자는 `test-command.json`, 원문은 `unit-tests.tap`, `test-result.json`, `compare.md`와 각 `*-results.json`. 기존 사례를 덮어쓰지 않으므로 재현은 새 `codex-probe-*` 루트에서 한다.

저장소 수정·커밋·푸시·worktree 추가·실제 API·외부 네트워크·키 파일 조회·권한 요청 모두 0. 시작·종료 관리 저장소 status의 변경 출력 없음. 작성한 것은 R의 자료와 이 보고서다.

미실행: 전체 시험 묶음, 실제 API/GUI/터미널, 다른 OS·FAT/exFAT, workspace 루트 자체 반복 교체 등 새 공격 시점. ctime 관측 및 보수적 거부의 한계는 V-10b 그대로다. 같은 틀의 0건을 완전한 경합 방어로 주장하지 않는다. PM에게는 **V-10b 중간 1건 해소 확인**, 남은 정상 변경 거부 수치는 알려진 동작으로 제출한다.
