# U333 PM 전체 unit initial fail 독립 분석

검증 엔지니어(PROBE), 2026-11-14. **실제 실패 원인은 미확정이며 제한 재현에서는 미재현이다. 기존 u22 준비 조건의 경합 가능성이 있고, U333의 직접 회귀 근거는 발견하지 못했다. PM 전체 unit 실패 1건을 통과로 바꾸어 기록하지 않는다.**

- 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`, detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 유지. 시작·종료 status 변경 출력 없음(전역 ignore 접근 경고 있음).
- 읽기 전용 PM판: `f852df5892b80f17f62bafce42af80d205e4d280`, tree `a0406098d084e1c6705516f9ff23d2c06f69d7dc`; 부모 main `818355e9db4ce6ac7548932f40d8069d7fbff47d` / unit `b4a76402dbb0ff75da8f3c350bad3f20ff93224c` 확인.
- 비교 기준: 실제 SEC archive `codex-sec-c11-init-parent-88484a84/source`, commit `88484a844d9c093f5da3d971b5d5ddaa73af7a58`, tree `1a3b02def338d6fff0fc94d8943f5b064a6430fb`. 기존 production dist 392개 핀 일치 확인.
- 소유·산출물: 이 `recovery-probe/u333-flake/` 하위만. 제품·시험·기대값·원본 baseline·타 담당 자료·Git 변경/커밋/push 없음. U334 대기 유지.

## PM initial fail 보존

원본 `pm-unit/.codaryn/codex-u333-recovered-final-evidence/unit-clean.log`를 읽기 전용으로 확인하고, 전체를 `initialfail-unit-clean.log`에 복사했다. 원본·복사 SHA-256은 `provenance.json`의 `initialFail`에 남겼으며 재현 뒤 원본 해시도 같았다.

- 원본 448~456행 및 6293~6313행: `u22-cleanup-output.test.js:89`, only-busy report assertion에서 expected `run_in_progress`, actual `run_not_found`; 시험 기간 774.1567ms.
- 원본 전체: tests 4306 / pass 4294 / fail 1 / cancelled 0 / skipped 10 / TODO 1. 이것이 PM의 유효한 최초 전체 결과다.
- integration exit0, init 관련92/기준56 통과는 전달된 PM/기존 증거이며 이번 독립 재실행 수치에 합산하지 않았다.

## 소스에서 확인한 사실과 원인 추정

1. **확정된 준비 조건의 빈틈:** 원래 `tests/unit/app/u22-cleanup-output.test.ts`의 `busyOn`은 lock 파일 존재와 목록에 같은 runId가 있는지만 확인한다. 목록 항목의 `state === "checked"` 또는 `phase === "running"`은 확인하지 않는다. 따라서 `damaged` 항목도 준비 완료 조건을 만족한다. WAIT는 30,000ms이고 원본 실패는 774ms여서 단순한 WAIT 정상 만료와는 맞지 않는다.
2. **확정된 제품 분기:** `src/store/journal.ts`는 run 디렉터리 생성 후 journal을 열고 첫 줄을 append한다. `src/store/runs.ts:201`의 `firstRecord`는 journal이 없거나 완성된 LF 첫 줄이 없으면 거부하고, `listRunsAt`의 readEntry 실패는 damaged 항목으로 수집한다(502~504행). `src/app/input/run-ref.ts:110`은 checked가 아닌 항목을 건너뛰고, finished run도 없으면 125~126행에서 run_not_found를 반환한다. live lock 확인이 실패한 경우도 같은 최종 코드에 도달할 수 있다.
3. **추정:** 목록에 아직 damaged로 잡힌 실행을 `busyOn`이 받아들인 뒤 report에서도 첫 journal 레코드를 아직 확인하지 못하는 초기화 경합은 관측된 코드와 일치한다. 그러나 원본 로그에는 그 순간의 목록 state/journal/lock snapshot이 없으므로 이것을 실제 initial fail의 확정 원인으로 단정하지 않는다. 일시적인 읽기/lock 판정 문제도 이 로그만으로 배제할 수 없다.
4. **기존 가능성:** 원래 u22와 support, app.ts/runs.ts/report-read.ts/input/run-ref.ts, store runs/lock/journal의 9개 raw Git 파일은 88484a84와 PM판에서 바이트 동일하다. 실제 SEC archive 및 PM 디스크도 raw Git과 줄 끝 차이만 있는지 확인했다. 따라서 위 준비 조건과 오류 경로는 기존판에도 존재한다. 기존판에서 실제 실패를 관측했다는 뜻은 아니다.
5. **U333 관련성:** main→PM판 변경은 init-core/init-command 신규, cli/init.ts와 app/init.ts import, 새 u333 시험의 5파일뿐이다. 해당 only-busy 시험은 startRun/listRuns/report/cancel을 사용하며 createSettings/runInit/initIn을 호출하지 않는다. 새 init 모듈의 최상위는 import·상수·함수 정의이고 실행 시 파일 작업을 시작하지 않는다. 직접적인 동작 변경 연결은 찾지 못했다. 전체 suite의 부하/타이밍 영향 여부는 미확인이다.

## 제한 재현 — 각 1회 후 중지

소유 경로에 PM production dist와 실제 SEC archive production dist를 각각 원본 바이트 그대로 복사했다. SEC archive는 production만 빌드되어 원래 u22의 JS가 없으므로, 양쪽 TS u22/support가 동일한 것을 확인한 뒤 PM에서 이미 컴파일된 **원래 JS 시험·support 두 파일을 무수정으로** 양쪽에 사용했다. 새 oracle·assertion·기대값·import 치환은 없다.

실행은 `run.mjs`에 기록된 sanitized child 환경과 `guard.cjs`를 사용했다. OS/Node 경로는 고정 문자열이며 host 환경 값·키를 읽거나 상속하지 않았다. TEMP/HOME/설치 fixture는 소유 경로 안에만 두고 시험 workspace와 분리했다. child의 네트워크/추가 프로세스는 거부하고 파일 쓰기는 소유 경로로 제한했다. 원래 only-busy 1개를 `--test-name-pattern`으로 선택했으며 `--test-isolation=none`이므로 PM fullsuite와 실행 조건은 다르다. 진단 guard 역시 실험 조건으로 명시한다.

| 실행판 | 실행 수 | 결과 | 시험 자체 시간 |
| --- | --- | --- | --- |
| exact PM dist f852df58 | 1회 | 1 pass / 0 fail, exit0 | 73.5574ms |
| 실제 SEC 88484a84 dist | 1회 | 1 pass / 0 fail, exit0 | 59.8213ms |

원문은 `pm-attempt1.log`, `base88484-attempt1.log`; 정확한 argv/cwd/기간/exit는 `results.json`에 있다. 복사한 dist/시험 및 원본 해시 변화 0. 최대 각3회 허용 중 각1회만 사용했고 fullsuite·추가 반복·강제 지연/결함 주입은 수행하지 않았다.

초기 runner 준비에서 process-local safe.directory를 다른 worktree로 지정해 Git ownership 검사에 거부됐다. 시험 시작 전 오류였으며 자기 runner의 인자만 바로잡았다. 전역/저장소 Git 설정 변경은 없고 시험 횟수·제품 실패 수치에 포함하지 않는다. 앞선 읽기 탐색에서 존재하지 않는 경로 조회와 권한 경고가 있었으나 원본 파일에는 쓰지 않았다.

## PM에게 반환하는 판단 자료

**확정:** 원본 전체 suite 실패1 보존, 두 판의 관련 소스 동일, 준비 조건에 damaged 허용 빈틈 존재, 각1회 제한 재현은 양쪽 통과. **추정:** 기존 초기 journal 준비 경합. **미확인:** 실제 initial fail의 정확한 상태, fullsuite 부하 영향, 기존판 실패 재현. 따라서 U333 회귀로 확정할 근거도, 원본 전체 suite를 모두 통과했다고 선언할 근거도 없다. 제품/시험 수정과 채택 판단은 맡지 않았으며 PM codex-review의 검토·채택 절차에 반환한다. 추가 실행 없이 정지하고 U334 독립 검증은 계속 대기한다.
