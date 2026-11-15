# V-10b — U-189 정확성 재확인

- 검증자: **codex-probe / 검증 엔지니어**. Windows, Node `v26.13.1`.
- 브랜치: `unit/U-189-p5u-gui`; 후보 `a287b13772bca0bec57cf4b30f4ab84a15c097da`, 비교 기준 `6f9eff4ae241553c9d9759659231d1032ca10ed1`. 수정 검토는 `0146e76..a287b13 -- src`.
- 실험 위치 R: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10b-a287b13`. 두 판은 `R/compare/base`, `R/compare/head`의 git archive 사본이다. 새 worktree·브랜치 없음.
- **높음 0 / 중간 1 / 낮음 0.** 같은 경합 틀에서는 후보의 외부 내용·이름·해시 반환 0건. 정상 폴더 변경으로 내용 검색이 결과를 조용히 누락하는 중간 1건은 아래에 재현했다.

## 1. 같은 경합 틀의 결과

셀은 **내용 / 이름 / 해시 반환 건수**. 숫자가 있는 셀마다 1회 실행, `—`는 해당 틀에 없는 조합이다. 작업 공간 밖 대상도 R 안에 만든 합성 파일이다.

| 교체 시점·조건 (`race.mjs`의 stage) | read_file | search_files 내용 | search_files 이름 | inspect_files |
| --- | --- | --- | --- | --- |
| gate-to-tool-outside | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |
| gate-to-tool-inside¹ | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |
| resolved-to-use | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |
| after-resolve | 0/0/0 | 0/0/0 | — | — |
| first-parent-after | 0/0/0 | 0/0/0 | — | — |
| first-leaf-after | 0/0/0 | 0/0/0 | — | — |
| before-open | 0/0/0 | 0/0/0 | — | — |
| after-open² | 0/0/0 | 0/0/0 | — | — |
| after-fstat² | 0/0/0 | 0/0/0 | — | — |
| second-parent-before² | 0/0/0 | 0/0/0 | — | — |
| second-leaf-after² | 0/0/0 | 0/0/0 | — | — |
| before-read² | 0/0/0 | 0/0/0 | — | — |
| aba-parent | 0/0/0 | 0/0/0 | — | — |
| **후보 호출 합계** | **13회** | **13회** | **3회** | **3회** |

¹ 작업 공간 **안의 다른 경로**로 교체하는 대조군이다. 외부 유출 사례로 세지 않는다. 네 도구 모두 `policy_denied`.

² `read_file` 5건과 내용 검색 4건은 Windows가 열린 파일의 부모 폴더 rename을 거부하여 **교체가 성립하지 않았다**. 내용 검색의 `second-parent-before`는 목록 검사 중 교체되어 제품이 거부했다. OS가 막은 9건을 제품 방어 성공으로 세지 않는다. 같은 스크립트라도 새 목록 검사 때문에 부모 lstat 순번이 가리키는 단계가 앞당겨진 경우가 있다.

- 후보 32회 + 기준 판 대조 12회 = 스크립트 합계 44회. 기존 `aba-parent` 2건, 이름 찾기·inspect의 `resolved-to-use` 2건, inspect의 내부 경로 교체 1건 모두 이번 후보에서 차단됐다.
- 원문: `R/race-results.json`, `R/cases-final/*/result.json`의 결과와 실제 lstat/fstat·교체 기록. 외부 경계에서 시점만 맞췄으며 파일 식별자나 반환 바이트를 위조하지 않았다.

## 2. 정상 사용과 폴더 항목 변경

`normal.mjs`와 `race.mjs`는 V-10 파일을 **수정 없이 복사**했고 SHA-256 일치도 확인했다.

| 기존 정상 틀 | 결과 |
| --- | --- |
| 안정된 입력: 8종 × 3도구 × 일반/내부 링크 | 48쌍, 기준·후보 차이 0; 새 거짓 거부 0 |
| 다른 프로세스의 시점을 맞춘 파일 변경 | 5건: 동일 파일 덮어쓰기·축소 성공, 상한 초과 성장 `too_large`, 원자적 파일 교체는 재시도 후 성공 |
| 다른 프로세스의 동일 파일 연속 덮어쓰기 | 도구별 20회, 총 60/60 성공; 거짓 거부 0 |

8종은 일반·한글/이모지·BOM/CRLF·빈 파일·64 KiB·256 KiB·256 KiB+1·1 MiB다. 큰 파일 거부/검색 제외는 두 판이 같았다. 기존 틀의 56행은 48쌍+변경 5건+동시 쓰기 3묶음이다. 원자적 교체 행의 옛 기대값은 `io_error`라 `pass:false`로 남지만, 이번 결과는 **재시도로 정상 성공**한 것이므로 결함으로 세지 않는다.

추가 `churn.mjs`: 대상 `parent/a.txt`는 항상 같은 바이트·같은 파일이다. 그 옆 또는 작업 공간 루트에서 다른 파일을 만들고 지운다. 링크 교체는 없다.

| 시점 고정 변경 | 사례 | 거짓 거부 | 실제 시도 수 |
| --- | ---: | ---: | --- |
| 길 위 폴더 변경 1회 후 안정 | 8 | 0 | 각각 2회 |
| 길 위 폴더 변경 2회 후 안정 | 8 | 0 | 각각 3회 |
| 길 위 폴더를 매 시도 변경, 총 3회 | 8 | 6 (`io_error`) | 각각 3회 |
| 경로 밖 형제 폴더 내부 변경 | 12 | 0 | 각각 1회 |

총 36건 중 명시적 거짓 거부 6건. 3회 변경 중 성공한 2건은 ctime 변화가 2번만 관측됐다. **파일 시스템 작업 횟수와 관측 가능한 ctime 변화 횟수는 같다고 보장할 수 없다.** 모든 사례는 변경을 멈춘 뒤 재호출하면 성공했다. “세 번 재시도”는 최초 포함 **최대 3회 시도**, 추가 재시도는 최대 2회다.

실제 별도 프로세스가 멈추지 않고 생성·삭제하는 동안 측정한 1회 실행 결과:

| 도구 | 변경 위치 | 호출 | 명시적 거짓 거부 (`io_error`) | 성공으로 반환했으나 정상 대상 누락 |
| --- | --- | ---: | ---: | ---: |
| read_file | 대상 부모 | 20 | 15 | 0 |
| read_file | workspace 루트 | 20 | 7 | 0 |
| search_files 내용 | 대상 부모 | 20 | 0 | 7 |
| search_files 내용 | workspace 루트 | 20 | 1 | 6 |
| search_files 이름 | 대상 부모 | 20 | 1 | 0 |
| search_files 이름 | workspace 루트 | 20 | 1 | 0 |
| inspect_files | 대상 부모 | 20 | 20 | 0 |
| inspect_files | workspace 루트 | 20 | 15 | 0 |
| **합계** | | **160** | **60** | **13** |

이는 높은 빈도의 실제 동시 변경에서 얻은 수치이며 일정한 발생률을 뜻하지 않는다. 대상 파일은 160회 모두 변하지 않았고, 변경 프로세스를 멈춘 뒤 8개 묶음 모두 정상 결과로 돌아왔다. 원문: `R/churn-results.json`.

## 3. 중간 1 — 내용 검색이 재시도 소진을 숨기고 결과 없음으로 반환

- 위치: 후보 `src/tools/index.ts:288`의 `if (!read.ok) continue;`. 새 읽기 검사가 세 번 모두 폴더 변경을 감지해 `io_error`를 내도 검색은 해당 파일을 조용히 건너뛴다. 반환은 `ok:true`, `entries:[]`, `truncated:false`다. 사용자는 실제로 있는 문구가 없다고 판단할 수 있다.
- 재현: R에서 `node ./search-omission.mjs` (최초 실행 또는 새 실험 루트에서 실행). `parent/a.txt`는 `inside needle\n` 그대로 두고, 파일 열기 뒤 형제 임시 파일을 생성·삭제한다. ctime 구분을 위해 각 변경 직전에 3ms 기다린다. 정책·도구·workspace는 실제 제품 모듈이다.

| 판 | 정상 대상 변경 | 읽기 시도 | `needle` 검색 결과 |
| --- | --- | ---: | --- |
| 기준 `6f9eff4` | 없음 | 기존 readFile 1회 | 정상 일치 1개 |
| 후보 `a287b13` | 없음 | openRead 3회 | 성공·결과 0개·`truncated:false` |

- 원문: `R/search-omission-results.json`. 위 실제 동시 실행에서도 같은 조용한 누락 13건을 관측했다. 명시적인 `io_error`의 보수적 거부와 별도인 정확성 문제다. 불완전한 검색임을 알려야 하는지 PM 판단이 필요하다. 제품 코드는 고치지 않았다.

## 4. 검증·명령·한계

| 검사 | 결과 |
| --- | --- |
| 두 archive 사본 컴파일 | 2/2 성공 |
| 기존 CLI 비교 | 27개 시나리오·508개 정규화 산출물, 차이 0, 종료 0 |
| 관련 시험 8개 파일 | 총 96, 통과 95, 실패 0, 건너뜀 1, 취소·todo 0; 러너 1,295.6939 ms |
| 건너뜀 | 현재 볼륨이 실제 8.3 짧은 이름을 생성하지 않는 사례 1건 |

실행 명령(처음 비교 명령은 관리 저장소 cwd, 나머지는 R cwd):

```powershell
git -C D:/project/Codaryn diff 0146e76 a287b13772bca0bec57cf4b30f4ab84a15c097da -- src
node D:/project/Codaryn/scripts/compare-cli-boards.mjs --base 6f9eff4 --head a287b13772bca0bec57cf4b30f4ab84a15c097da --work D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10b-a287b13/compare --out D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v10b-a287b13/compare.md --keep
node ./race.mjs
node ./normal.mjs
node ./churn.mjs
node ./search-omission.mjs
node ./test-runner.mjs
```

시험 래퍼는 TEMP/TMP를 R/tmp로 제한하고 재귀 정리 경로를 검사한 뒤 `node --test --test-concurrency=1 --test-reporter=tap`으로 관련 파일만 실행했다. 정확한 인자는 `test-command.json`, 출력은 `unit-tests.tap`, `test-result.json`; 비교 원문은 `compare.md`. 새 폴더를 만드는 탐침이므로 재현 시 기존 사례를 덮어쓰지 않고 새 `codex-probe-*` 루트를 사용한다.

저장소 수정·커밋·푸시·worktree 추가·실제 API·외부 네트워크·키 파일 조회·권한 요청 모두 0. 작성한 것은 R의 검증 자료와 이 보고서다. 시작·종료 관리 저장소의 status 변경 출력 없음. 중간에 실험 cwd에서 Git 소유권 검사 오류가 있었지만 설정을 바꾸지 않았고 관리 cwd의 읽기 전용 재확인은 성공했다.

미검증: 전체 시험 묶음, 실제 터미널/Electron/API, FAT/exFAT·다른 OS, workspace 루트 자체의 반복 교체, 가능한 모든 시점. 루트 부모를 검사하지 않는 틈과 ctime 보장 한계는 새 `guard.ts`에도 명시되어 있다. 같은 32건의 유출 0을 완전한 경합 방어로 해석하지 않는다. 채택은 PM 판단이다.
