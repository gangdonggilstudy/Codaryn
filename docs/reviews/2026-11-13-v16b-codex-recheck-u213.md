# V-16b — U-213 시간 한도·읽기 제외 재확인

- 검증자: **codex-probe / 검증 엔지니어**, Windows, Node v26.13.1.
- 기준 `cff3c764d7ab6a4e4b3d4fb52f32445a58b7a36e`, 후보 `dcde67a10a9b8cde2740df9a275987ac18ceaa14` (`unit/U-213-p5u-gui`).
- R = `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v16b-dcde67a`. `git archive` 사본은 `R/compare/base`, `R/compare/head`.
- **읽기 기능 범위의 새 발견: 높음 0 / 중간 0 / 낮음 0. V-16 중간 1건은 재현에서 해소됐다.**
- **별도 검증 전제 불일치:** 요청한 main 포함 검사는 실패했다. 후보의 `cff3c764` 통합 완료를 승인할 수 없다. 아래 기능 시험은 지정한 두 해시 그대로 실행했다.

## 1. main 포함 여부

| 검사 | 결과 |
| --- | --- |
| `git merge-base --is-ancestor cff3c764 dcde67a...` | **exit 1: 조상 아님** |
| `git merge-base --is-ancestor f52c228 dcde67a...` | exit 0 |
| 후보에 없는 기준 쪽 커밋 | `58e0aaf8` U-220 구현, `8e58a5e1` 병합, `cff3c764` 채택 |
| `git diff cff3c764 dcde67a... -- src` | U-213 외에 U-220 잠금 해제 처리의 제거가 포함됨 |

후보의 병합 커밋은 `dd96be1c`(main `f52c228` 수용)이다. 기준에 있는 `lockLeft` 전달 및 잠금 해제 실패를 결과와 별도로 알리는 처리가 후보의 `src/cli/assemble.ts`, `main.ts`, `plan-commands.ts`, `revert.ts`, `run.ts`에는 없다. 이는 읽기 재시도 결함 건수와 분리한 **통합 대상 불일치**다. U-220의 실패 상황을 실행 재현하지 않았으며, 아래 일반 CLI 출력 27건의 같음이 이 누락을 검증해 주지는 않는다.

## 2. V-16 중간 1건 재현

V-16의 `deadline.mjs`, `deadline-minimal.mjs`를 그대로 새 판에 실행했다. 실제 도구 시험은 첫 세 번의 폴더 변경 뒤 대기 중 이벤트 루프를 2.1초 멈추는 같은 재현이다.

| 재현 | 이전 V-16 | 이번 시도 수 | 이번 결과 | 한도 뒤 새 시도 |
| --- | --- | ---: | --- | ---: |
| 내용 검색 | 4번째 읽기 시작 | 3 | 빈 결과, `truncated:true` | 0 |
| 이름 검색 | 4번째 목록 시작 | 3 | `io_error` | 0 |
| inspect_files | 4번째 목록 시작 | 3 | `io_error` | 0 |
| 주입 시계: 대기 종료가 한도와 같음 | 2,000 ms에 4번째 시작 | 3 | `changed` | 0 |
| 주입 시계: 한도보다 1 ms 늦음 | 2,001 ms에 4번째 시작 | 3 | `changed` | 0 |
| 정상 시계 대조 | 50 ms에 4번째 성공 | 4 | `read` | 0 |

실제 도구 세 호출은 2,231 / 2,211 / 2,238 ms에 반환했다. 강제로 막힌 이벤트 루프 때문에 반환 자체는 2초를 넘지만, 문제가 됐던 **늦은 대기 뒤 추가 시도**는 없다.

## 3. 작업 공간 밖 반환 경합

| 후보 도구 | 기존 V-10 계열 틀 | 4~6번째 시도 경합 | 외부 내용 / 이름 / 해시 |
| --- | ---: | ---: | --- |
| read_file | 13 | 9 | 0 / 0 / 0 |
| search_files 내용 | 13 | 9 | 0 / 0 / 0 |
| search_files 이름 | 3 | 9 | 0 / 0 / 0 |
| inspect_files | 3 | 9 | 0 / 0 / 0 |
| 합계 | **32** | **36** | **0 / 0 / 0** |

기존 32회에는 내부 경로 대조 4회, Windows가 바꾸기를 막은 9회가 들어 있다. 이 9회를 제품의 방어 성공으로 세지 않는다. 추가 36회는 50/200/500 ms 대기 뒤 부모 확인 직후·사용 직전·ABA를 넣었고 모두 지정 시도에 도달했다. 기준 판 대조 12회도 실행했다. 변경 시각의 한 눈금 안 ABA 한계가 닫혔다고 주장하지 않는다.

## 4. main 읽기 제외 판정과 재시도

V-13b의 `probe.mjs`, `errors.mjs`를 복사하고 사본 import 경로만 바꿔 실행했다. 별도 시험은 **같은 실제 트리**에서 두 판을 실행하고, 결과 전체를 JSON 문자열/UTF-8 바이트로 비교했다. 시각·오류·`withheld`·`truncated`·`next`·해시를 지우거나 정규화하지 않았다.

| 기존 V-13b 재현 | 횟수 | 결과 |
| --- | ---: | --- |
| 제외 폴더 없음·0·1·497·498·499·500·1,001개 | 48호출 | 공개 결과 바이트 차이 0 |
| 제외 안의 99,998·99,999·100,001개 항목 모의 | 18호출 | 바이트 차이 0, 모의 배열 접근 0 |
| 제외 안의 EACCES·EIO·ENOENT 전체 경계 주입 | 18호출 | 바이트 차이 0 |
| readdir/lstat/open 각각의 세 오류 | 54호출 | 바이트 차이 0; 제외 해제 대조에서 주입 확인 |
| 나열 도중 제외 폴더 안에 추가 | 6호출·6추가 | 바이트 차이 0 |
| 제외 대상·내부·끊어진·외부 정션 | 6호출 | 숨긴 별칭/내용 반환 없음; 직접 요청 거부 |
| 제외 생략/빈 배열, 큰 공개 목록 포함 main 비교 | **30쌍** | **30쌍 동일** |

추가 재시도 시험은 나열·내용 검색·이름 검색·inspect 일반/해시/이어 읽기의 6호출이다. 제외 폴더에 고정 파일 0·1·500·1,001개를 두는 네 상태를 진행하면서, 각 대기 중에도 그 안에 파일을 추가했다. 공개 파일은 바꾸지 않았다.

| 추가 시험 | 횟수 | 관측 시도 | 결과 |
| --- | ---: | --- | --- |
| 네 상태의 조용한 main↔후보 비교 | 24쌍 | 1 | 전부 동일, 숨긴 수에 따른 차이 0 |
| 공개 부모가 처음 3회 변경 | 24호출 | **4회**, 대기 50 ms | 24 성공, 조용한 main 결과와 동일 |
| 처음 5회 변경 | 24호출 | **6회**, 대기 50·200·500 ms | 24 성공, 조용한 main 결과와 동일 |
| 매번 변경 | 24호출 | 6회 | 24 `io_error`, 숨긴 반환 0 |
| 제외 안의 9종 경계 오류 + 처음 3회 변경 | 54호출 | 4회 | 54 성공, 조용한 결과와 동일 |
| 대기 중 공개 별칭을 제외 폴더로 돌림 | **18호출** | 대기 50/200/500 ms 각각 | 18회 전환, 전환 후 조용한 main/후보와 동일, 별칭·내용 반환 0 |

추가 수·오류·재시도 시험에서 제외 폴더/하위의 **readdir 0 / lstat 0 / open 0**이었다. 숨긴 이름·내용·해시 반환도 0이었다. 6회 모두 변경한 경우의 거부는 의도한 보수적 동작이다. V-13b의 과거 `[]` 차이는 이번 main↔후보 비교에서는 나타나지 않았으며, 과거 기준 판과 다시 비교한 것은 아니다.

## 5. 출력·실행 기록

| 항목 | 결과 |
| --- | --- |
| 두 판 빌드 | 2/2 통과 |
| CLI 출력 비교 | **27 시나리오·508 정규화 산출물, 차이 0** |
| 관련 유닛 12파일 | **111건: 110 통과 / 0 실패 / 1 건너뜀**, 22,289 ms |

건너뜀은 실제 8.3 짧은 이름 미생성 1건이다. 최초 추가 제외 재시도 틀은 helper의 export 이름 착오로 제품 호출 전에 중단됐다. 틀을 `createWorkspaceWithFileLayer(..., nodeFileLayer)`로 바로잡고 새 fixture에서 실행한 결과만 위에 포함했다. 제품 파일은 바꾸지 않았다.

저장소 cwd에서 실행:

```powershell
git merge-base --is-ancestor cff3c764 dcde67a10a9b8cde2740df9a275987ac18ceaa14
git diff cff3c764 dcde67a10a9b8cde2740df9a275987ac18ceaa14 -- src
node scripts/compare-cli-boards.mjs --base cff3c764 --head dcde67a10a9b8cde2740df9a275987ac18ceaa14 --work D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v16b-dcde67a/compare --out D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v16b-dcde67a/compare.md --keep
```

R에서 실행: `node deadline.mjs`, `node deadline-minimal.mjs`, `node race.mjs`, `node late-races.mjs`, `node prepare-replays.mjs`, `node hidden-original.mjs`, `node hidden-errors.mjs`, `node hidden-retry.mjs`, `node hidden-alias-wait.mjs`, `node test-runner.mjs`, `node summarize.mjs`.

근거는 R의 `summary.json`, `deadline-results.json`, `race-results.json`, `late-race-results.json`, `results.json`, `error-results.json`, `hidden-retry-results.json`, `hidden-alias-wait-results.json`, `compare.md`, `unit-tests.tap`, `test-command.json`, `source.diff`. 최소 시계 재현은 그대로 재실행 가능하고, 파일 시험은 기존 fixture를 덮어쓰지 않으므로 새 실험 폴더에서 다시 준비한다. 선택 유닛은 workspace 4파일, tools 7파일, policy 1파일이며 `node --test`로만 실행했다.

저장소 시작/종료 상태는 변경 없음. 작성은 R과 이 보고서만, 실제 API·외부 네트워크·키 조회·권한 요청·커밋·푸시·worktree 추가는 0회. CLI 비교의 모의 HTTP는 127.0.0.1만 사용했다. 전체 시험·실제 터미널/GUI/API·다른 OS·몰아치기 수치의 재측정·U-220 잠금 실패 상황은 미실행이다. **읽기 수정은 검사 범위에서 통과했지만, `cff3c764`를 포함한 통합 판이라는 전제는 충족되지 않았다.**
