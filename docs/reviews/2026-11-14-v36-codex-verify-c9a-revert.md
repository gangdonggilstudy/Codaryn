# V-36 — C-9a 되돌리기·실행 목록 이동 검증

- 담당: codex-review, 읽기 전용 독립 검증. **높음 0 / 중간 0 / 낮음 0**.
- 대상 `pm/unit-C9a`: `48686875bc1317e0c04cfbcb9b4688893b947daa`. 기준 main: `b4cddea172390628ee1f46c2bd09fab7789bd0bc`. 시작·종료 조회 동일.
- 사본: `.codaryn/v36/base`, `.codaryn/v36/head`, 각각 git archive. Windows / Node `v26.13.1`. 양쪽 TypeScript 빌드 exit 0.
- 실제 CLI **25사례 × 2언어 × 2출력 모드 = 100쌍 / 비교 대상 200호출**, 정규화 후 차이 **0**. 어댑터·질문·검사 순서 **12쌍 / 24호출**, 차이 **0**. 관련 시험 **91/91 통과**.
- 미검증: OS 공유 핸들에 의한 실제 삭제 실패, 실제 터미널의 키 입력. 각각 EBUSY 파일 연산 경계 주입 및 ask 콜백 주입으로 제품의 실패·동의 경로를 검증했다. 아래에 차단 근거와 구분을 기록한다.

## 이동 코드와 판단

| 위치 | 확인 |
|---|---|
| `src/app/revert-command.ts:43`~createRevertCommand 끝 | 기준 `src/cli/assemble.ts`의 interface·도우미·되돌리기 본문 **294줄 원문 동일**(개행 CRLF/LF만 통일). [moved.mjs](v36/moved.mjs), [결과](v36/moved-results.json). |
| `src/app/workspace-root.ts:24` | resolveWorkspaceRoot 함수 원문 동일. 장치/네트워크 경로 검사 → realpath → 디렉터리 검사 순서 유지. |
| `src/app/input/text-safety.ts:49`, `src/app/runs.ts:80`, `src/cli/runs.ts:137` | 기존 두 hideKeysInStrings와 공유 함수의 문자열·배열·객체 순회 동일. 공백과 단일 if문의 중괄호만 정규화해 비교. JSON은 문자열 값별로 가림. |
| `src/cli/runs.ts:138` | text는 여전히 `hideKeys(io.human.runsText(output), currentKey)`: **그린 뒤 가림**. |
| `src/app/revert-command.ts:185`, `:206`, `:217`, `:222`, `:295`, `:310`, `:333` | dry-run+동의 거부, 실행 식별/동의 일치, journal 존재·손상 검사, 잠금, 되돌리기 및 기록 쓰기, 잠금 해제 순서 유지. |
| `src/app/revert-command.ts:389`, `:430`, `:447`; `src/cli/revert.ts:98`, `:117`, `:124` | startRevert → revertOnce → 질문 시 두 번째 revertOnce → revertOutput 연결. CLI의 질문·계획 안내·출력은 그대로 남음. |

검증한 입력에서는 **기록이 가리킨 범위 밖의 파일 변경, 실제 되돌리기의 잠금 우회, 예전에 거부하던 동의 수락, runs의 새 원문 노출을 찾지 못했다**. dry-run은 기존 계약대로 잠금을 잡지 않고 파일·되돌리기 기록도 쓰지 않는다. 오늘의 unreadablePaths를 보지 않는 기존 동작은 이번 결함으로 세지 않았다.

## 실제 CLI 재현·대조

[matrix.mjs](v36/matrix.mjs)는 기준 CLI의 scripted 모델로 원본 수정·새 파일 생성 실행을 만들고, 별도의 scripted `propose_plan` 및 실제 CLI `apply --digest`로 이동·폐기 기록을 만들었다. 이 두 seed를 **동일한 절대 작업 공간 경로**에 복원한 뒤 base/head를 각각 실행했다. 각 사례를 `en/ko` 및 `--json` 유무로 반복했다. 실행에는 OS 경로와 합성 환경만 전달했고 실제 키는 사용하지 않았다.

비교 대상: stdout, stderr, exit code, 작업 공간의 모든 일반 파일 해시, 링크 이름·대상, revert.json, 잠금 잔류. 외부 대상은 시험 폴더 안의 별도 sentinel이며 **모든 경우 원래 바이트 유지**. 아래 exit·결과는 네 출력/언어 조합에서 공통이다.

| 사례 / 재현 조작 | head 결과(base와 동일) |
|---|---|
| 정상 수정·생성 실행 되돌리기 | exit **0**, complete. docs/edit.txt가 원래 CRLF 바이트로 복원되고 new.txt 삭제. 다른 사용자 파일 변경 0. |
| 살아 있는 **별도 Node 자식 프로세스 PID**로 lock.json 점유 | exit **6**, workspace_locked. 파일·기록 변경 0, 기존 잠금 유지. |
| releaseLock의 실제 CLI 파일 연산 rm에 EBUSY 주입 | exit **0**, complete 유지. 원래 두 파일은 되돌리고 revert.json 기록, 잠금 잔류, stderr에 해제 실패 안내. JSON 결과에 새 필드 추가 없음. |
| journal 첫 기록을 20바이트로 자름 | exit **2**, invalid_run_record. 파일·기록 변경 0. |
| journal 첫 기록 또는 중간 기록의 runId를 다른 실행으로 바꿈 | 두 사례 모두 exit **2**, invalid_run_record. 파일·기록 변경 0. |
| 실행 폴더를 다른 자체 fixture 폴더로 향하는 junction으로 교체 | exit **2**, invalid_run_record. 파일·되돌리기 기록 변경 0. |
| journal.jsonl 제거 | exit **2**, run_not_found. 파일·기록 변경 0. |
| records-changed.json 생성 | exit **0**, complete. recordsChanged 표시 유지, 각 파일을 정상 검사 후 되돌림. |
| `--run latest` | exit **0**, 같은 seed 실행 선택·복원. latest 안내 포함 출력 동일. |
| 이미 되돌린 일반 실행 재실행 | exit **0**, complete. 사용자 파일 재변경 0, already_reverted 및 이전 되돌린 시각 표시, revert.json 갱신. |
| `--dry-run` | exit **0**, complete. 잠금·파일·기록 쓰기 0. |
| 일반 실행 또는 apply 실행에 `--dry-run --allow-unsafe-move` | 두 사례 모두 exit **2**, invalid_arguments. 파일·기록 변경 0. |
| 일반 CLI에서 `--allow-unsafe-move` | 기존처럼 유효한 cli-flag 동의. exit **0**, 정상 복원. 어댑터 경로의 flag 거부와 구분. |
| 적용된 계획의 **plan 실행**을 되돌림 | exit **0**, complete. apply 실행을 되돌리라는 안내, 파일 변경·plan의 revert.json 생성 **0**. |
| **apply 실행** 되돌리기 | exit **0**, complete. 이동 파일·폐기 파일 2개가 원래 위치·바이트로 복귀. |
| hard-link 연산 ENOTSUP 주입, 동의 없음 | exit **3**, partial. 파일 2개 unsafe_move로 건너뜀, 사용자 파일 변경 0. |
| 같은 ENOTSUP + `--allow-unsafe-move` | exit **0**, complete. 파일 2개 unsafe=true로 복귀, 기록 동의 채널 cli-flag. |
| 이미 되돌린 apply 재실행 | exit **0**, complete. 파일 재변경 0, already_reverted, revert.json 갱신. |
| 수정 파일의 부모 docs를 작업 공간 밖 sentinel 폴더로 향하는 junction으로 바꿈 | exit **3**, partial. 링크 밖 파일 변경 0. 새로 만들었던 정상 new.txt만 삭제. |
| file_changed.path를 `../external/sentinel.txt`로 바꿈 | exit **3**, partial. sentinel 및 사용자 파일 변경 0, 결과·기록 동일. |
| 키 모양의 합성 실행 폴더 이름 + `codaryn runs` | exit **0**, listed. 두 언어·text/JSON 모두 합성 키 원문 노출 **0**, 쓰기 0. |
| `codaryn runs --workspace \\.\C:\` | exit **2**, invalid_arguments. 쓰기 0, 출력 동일. |
| 정상 journal 뒤에 잘린 마지막 조각 `{"type":` 추가 | exit **0**, 정상 복원. **기존 T-10 예외**로 마지막 미완성 줄을 무시한다(`src/store/changes.ts:505`, changedPaths). 첫 기록 손상과 다른 동작이며 이동 회귀 아님. |

원시 대조에서 차이 1개는 apply 재되돌리기 한국어 안내의 이전 시각 **08:59:27 / 08:59:28**이었다. ISO 시각에 더해 이 현지 시각 표현을 정규화한 뒤 차이 0. 정규화 대상은 시각과 새 잠금의 무작위 실행 ID·PID·프로세스 시작 시각뿐이다. 사용자 파일·journal·snapshot·기존 result는 바이트 해시로 비교했다. [원시 결과](v36/matrix-results.json), [최종 대조](v36/matrix-final-results.json), [정규화 재대조 스크립트](v36/recheck.mjs). 실제 출력 쌍은 결과의 root 아래 각 `사례-언어-json/text.json`에 보존했다. 출력 표현만 다시 비교했으며 제품 실행을 성공으로 바꾼 것은 아니다.

## 동의·잠금·검사 순서 경계

[adapter.mjs](v36/adapter.mjs)는 각 판의 runRevert와 createRevertCommand 및 실제 store.revertRun을 직접 호출했다. unsafe_move를 만드는 hard-link ENOTSUP만 주입했다. 실제 CLI 입력으로 어댑터 채널을 지정할 수 없으므로 이 부분은 같은 프로세스의 앱/CLI 조합 경계 시험이다.

- 어댑터 동의 없음: partial, 질문 0. 올바른 adapter/runId: complete, unsafe 복원 2개, 질문 0.
- 다른 runId, cli-flag로 위장한 어댑터 동의, 어댑터와 `--allow-unsafe-move`, 어댑터 동의와 dry-run: **4종 모두 invalid_arguments**, store.revertRun 호출 **0**, 기록 쓰기 **0**, 파일 바이트 변경 **0**.
- 질문의 yes 응답: 질문 **1**, 실제 store 되돌리기 **2**, 기록 쓰기 **2**. 질문 시 잠금 없음, 각 실제 되돌리기와 기록 쓰기에서는 **현재 PID 소유 잠금 존재**, 되돌리는 실행과 잠금 runId가 다름. no 응답: 질문 1, 되돌리기 1, partial. 양쪽 종료 후 잠금 잔류 0. OS 터미널 대신 ask 콜백으로 응답을 주입했다.
- 잘못된 어댑터 flag와 다른 오류를 함께 줌: 장치 경로이면 디렉터리 검사 **0**에서 invalid_arguments; 없는 폴더면 workspace_not_found; 되돌리기 연결이 없으면 internal_error; 모두 통과한 뒤 어댑터 flag를 invalid_arguments로 거부. **4개 우선순위 사례에서 두 판 동일**, store 호출 0.
- [adapter-results.json](v36/adapter-results.json): 총 **12쌍**, 차이 0.

## 명령·관련 시험·제한

```powershell
# D:/project/Codaryn
Get-Content AGENTS.md -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse pm/unit-C9a main
git diff -M b4cddea1 48686875bc1317e0c04cfbcb9b4688893b947daa -- src
git archive --format=tar --output=.worktrees/codex-verify/.codaryn/v36/base.tar b4cddea1
git archive --format=tar --output=.worktrees/codex-verify/.codaryn/v36/head.tar 48686875bc1317e0c04cfbcb9b4688893b947daa
# v36 안에서 각각 추출
tar -xf base.tar -C base
tar -xf head.tar -C head
# base, head 각각을 cwd로 지정
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
# v36
node ./moved.mjs
node --import ./guard.mjs ./matrix.mjs
node ./recheck.mjs
node --import ./guard.mjs ./adapter.mjs
node ./run-units.mjs
node --import ./guard.mjs ./os-release.mjs
```

- 관련 시험만 실행: `cli/g-revert-consent`, `cli/runs`, `app/n7-runs`, `store/g-apply-revert`, `store/apply-revert-no-link`, `cli/human/u139-revert-records-changed`의 `.test.js`. **6파일 / 91 tests / 91 pass / 0 fail / 0 skipped / 0 TODO**, **5451.9917 ms**. [TAP](v36/unit-tests.tap), [실행기](v36/run-units.mjs).
- **실제 OS 삭제 거부 추가 시험은 미완료.** [os-release.mjs](v36/os-release.mjs)는 Windows FileShare.ReadWrite로 잠금 파일을 열어 삭제를 막으려 했으나, 보조 [hold-file.ps1](v36/hold-file.ps1)이 PowerShell 실행 정책의 `UnauthorizedAccess`로 시작되지 않았다. [차단 로그](v36/os-release-d4pKtP/base.helper.log). 두 번의 준비 시도 모두 준비 완료 표지가 없어 assertion 실패; 성공 건수에 넣지 않았다. 권한 요청·ExecutionPolicy 변경·우회는 하지 않았다. 잠금 해제 실패의 제품 동작은 위 실제 CLI EBUSY 주입 **4쌍**으로만 확인했다.
- 초기 fixture에서 propose_plan 입력에 불필요한 sha256을 넣어 invalid_args가 발생했으나 도구 입력 스키마에 맞춰 제거했다. 이동 비교의 함수 검색도 제네릭 `<T>`를 처리하도록 수정했다. 끝 조각 허용을 손상 거부로 예상한 초기 assertion은 T-10 계약을 확인해 별도 사례로 분리했다. 제품 소스 수정 0.
- 실제 API·실제 키·외부 네트워크·전체 시험 묶음·Windows 외 플랫폼·실제 터미널 키 입력은 실행하지 않았다. 모든 합성 자료와 시험 쓰기는 v36 안, 최종 보고서는 지정 .codaryn 경로. 재귀 정리는 절대 경로와 실경로가 v36 안인지 guard로 검사. main·codex-verify 마지막 `git status --short` 출력 각 **0행**. 커밋·푸시·worktree 추가·권한 요청 **0**.
