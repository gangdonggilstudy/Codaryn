# R-119 검토: U-314·U-315 (이행 C-9a: 되돌리기 명령·규칙, 작업 공간 경로 해석을 앱으로) — GUI·통합 쪽

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다. src는 Codex V-36이 본다.
- 판: `pm/unit-C9a` = `48686875bc1317e0c04cfbcb9b4688893b947daa`. main `b4cddea1` 위다.
  - `src/app/revert-command.ts`(+468), `src/app/workspace-root.ts`(+34), `src/app/runs.ts`
  - `src/cli/assemble.ts`(−333), `src/cli/revert.ts`, `src/cli/runs.ts`
  - 판 비교 사례 +53
- 판 사본 둘(base = main `b4cddea1`, head)의 빌드로 쟀다. 실제 API·외부 네트워크·임시 worktree는 쓰지 않았다.

## 결론

- **높음 0, 중간 0, 낮음 1, 참고 1.** 낮음 하나는 이 판이 만든 것이 아니다(base도 같음).

| 시험(head) | 결과 |
|---|---|
| 루트 build | exit 0(base도 exit 0) |
| GUI `npm test` | 424/424 |
| smoke 조용함 | 227/227, 31초, 시작 때 CPU 63%, node 22개, host 107 ms |
| smoke 부하 1 | 227/227, 55초, CPU 100%, node 85개, host 108 ms |
| smoke 부하 2 | 227/227, 52초, CPU 100%, node 72개, host 1,318 ms |

- 세 번 모두 되돌리기·실행 목록·트리의 smoke 점검 23개가 통과했다(`revertPreview…`, `previewLatest`, `previewUnlisted`, `runs…`, `tree…` 등).

## 1. GUI가 받는 값: base와 head가 같다 (`probe/gui-revert.mjs`)

- 엔진 호스트처럼 했다: `app.revert({ workspace, runId, dryRun, unsafeMoveConsent })`, `app.listRuns`, `app.listWorkspaceDir`.
- 결과는 호스트의 읽기 함수(`revertValue`, `runsValue`, `treeValue`; head의 GUI 빌드)를 거쳤다.
- 실행은 head의 CLI로 만들었고, 경우마다 두 판에 같은 꼴의 작업 공간을 따로 만들었다.
- 실행 id·토큰·시각·pid·상자 폴더만 바꿨다.

| 경우 | head(창이 받는 것) | base와 |
|---|---|---|
| 문서 실행의 미리보기 → 되돌리기 → 다시 | partial(아래 L-1), 두 번째는 `already_reverted` | 같음 |
| 이동 계획 적용의 미리보기 → 되돌리기 | complete, 보관함에서 되살림·되옮김 | 같음 |
| 손상된 실행(journal 한 줄 깨짐) | 되돌리기 `invalid_run_record`, 실행 목록에서 손상 표시 | 같음 |
| 쥔 잠금(살아 있는 프로세스) | 되돌리기 `workspace_locked`, 실행 목록은 동작 | 같음 |
| 실행 목록(문서 실행, 계획 실행, 적용 실행; 계획 적용 상태 판정 포함), 트리(루트, `notes/`) | 같은 줄과 항목 | 같음 |
| 위험하게 옮긴 적용의 되돌리기(하드 링크 없음 흉내, `fs-faults`): 미리보기 → 동의 없이 → 이 실행의 동의로 | 미리보기 `moveSafetyUnchecked: true` → partial(7개 `unsafe_move`로 건너뜀) → complete(7개 unsafe) | 같음 |

## 2. 낮음

### L-1 (낮음, 이 판 전부터) GUI의 되돌리기 목록이 `missing_record` 경로를 가리지 않고 보인다

- 등록한 가릴 값이 이름에 든 파일을 만든 실행을 되돌리면 두 줄이 건너뜀에 남는다(usage 908~909행).
  - 기록의 가린 경로(`notes/<TOKEN>.md`, `missing_snapshot`)
  - 디스크의 실제 파일(`notes/<원문>.md`, `missing_record`)
- CLI의 사람용 요약은 이 `missing_record` 경로를 찍지 않고 `?`로 보인다. 근거: `src/cli/human/output.ts:760` "comes from the snapshot index unmasked … not printed", usage 909행.
- GUI의 되돌리기 결과 목록은 모든 건너뜀의 `path`를 그대로 보인다(`gui/src/renderer/runs/runs-screen.ts:61`).
  - 엔진 호스트의 `shown`은 키 모양만 지우고, 등록 값은 가리지 않는다.
  - 그래서 그 원문 값이 GUI 화면에 나온다. 탐침의 `revertDocument-head.json`이 보인다.
- CLI의 JSON(`RevertOutput.skipped`)에도 원문이 있다. 계약 주석은 "Paths as the run's journal recorded them (masked)"라고 적었다.
- 나오는 것은 사람 자신의 작업 공간 파일 이름이고, 화면은 그 기계 안이다. 그러나 CLI가 일부러 감추는 값을 GUI가 보이므로 낮음으로 둔다.
- 제안(결정은 p5u-gui·PM, 기능 단위)
  - GUI도 `missing_record` 경로를 CLI처럼 감춘다(엔진 호스트의 `revertValue`나 화면에서).
  - 계약 주석(JSON의 `skipped`가 가린 경로라는 말)은 na-core가 사실에 맞춘다.

## 3. 통합이 지키는 것과 빈 곳

- CLI의 되돌리기 기대값은 넓게 고정돼 있다.
  - p04: 바이트 복원, 새 파일 삭제, 사용자 변경 보존, 두 번째 되돌리기, 바꾼 것 없는 실행, 오류 넷(없는 실행, 경로 탈출 id, 잠금, 깨진 journal)
  - n01: 문서의 블록과 같은 stderr
  - n03: `latest`, 손상 실행, 대소문자 바꾼 id, 잠금 거부의 stderr
  - n06: 적용의 역순 되돌리기, `already_reverted`, 사용자 변경 뒤 partial, 보관함 링크
  - n15: run 계획 수행 실행
  - n19: 취소된 적용
- 실행 목록은 n03, 트리는 n14·smoke가 본다.
- **빈 곳:** c01에 되돌리기를 CLI 대 앱으로 맞대는 사례가 없다. GUI가 쓰는 `app.revert`의 기대값은 smoke(미리보기 중심)와 GUI 단위 시험(가짜 앱)만 본다.
  - 위험하게 옮긴 적용의 되돌리기(DR-25의 동의 길)는 통합에 없다. 이제 `fs-faults`로 만들 수 있다.

### I-1 (참고) U-317 제안 (시험만, 제안만)

c01에 셋을 더한다.
1. 문서 실행과 이동 계획 적용의 미리보기 → 되돌리기 → 다시: CLI `revert --json`과 앱 `revert`의 결과·되돌리기 기록이 같다.
2. 오류: 없는 실행, 손상된 실행, 쥔 잠금. CLI 오류 JSON과 앱의 거부가 같다.
3. 위험하게 옮긴 적용(`fs-faults`의 하드 링크 없음)의 되돌리기: 동의 없이 partial(`unsafe_move`), 이 실행의 동의로 complete. CLI `--allow-unsafe-move`와 앱의 `unsafeMoveConsent`가 같다.

L-1의 원문 경로는 지금 동작으로 고정하지 않는다. 고칠 때 시험이 바뀌어야 하므로 그 기능 단위에서 다룬다.

## 4. 판정 근거로 본 것

- `git diff b4cddea1 48686875`의 되돌리기·실행 목록 길
- GUI: `gui/src/engine-host/host.ts`(revert, listRuns, listWorkspaceDir를 부르는 곳), `history.ts`(`revertValue`, `runsValue`), `tree.ts`(`treeValue`), `gui/src/renderer/runs/runs-screen.ts`
- CLI의 감춤: `src/cli/human/output.ts:92`·`:760`, `docs/usage.md` 908~909행, `docs/cli-contract.md` 184·375행
- 탐침(커밋하지 않음): `r119/probe/gui-revert.mjs`와 결과 json
