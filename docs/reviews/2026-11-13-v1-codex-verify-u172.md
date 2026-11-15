# V-1 U-172 독립 보안 검증

- 검증자: codex-sec, 보안·개인정보 검토자.
- 대상: `pm/unit-U-172`, `9db60f367e2ab39164bed7e62d86750e807d58f1`; 기준 `07cd600`.
- 결과: **높음 1건 / 중간 0건 / 낮음 1건**. 같은 원인의 재현 사례는 합산하지 않았다.
- 작업 위치: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-sec-v1-9db60f3` (이하 `$V`). `git archive` 사본이며 새 worktree·브랜치는 만들지 않았다.
- 원본 저장소: `D:/project/Codaryn`, `main`; 시작·종료 `git status --short` 출력 0행. 추적 파일 수정·커밋·푸시 0회. 검토한 앱 파일 4개의 최종 blob 해시가 대상 판과 모두 일치했다.
- Windows, Node `v26.13.1`. 실제 API·외부 네트워크 호출 0회, 실제 키 파일 조회 0회. 실험 데이터는 합성값만 사용했다.

## 높음 H-1: 경로 검사 후 정션 교체로 작업 공간·상태 디렉터리 경계 우회

- 위치: `src/app/workspace-text.ts:143`, `:148`, `:158`, `:334`, `:346`; 연계 `src/workspace/workspace.ts:113`, `:120`, `:254`, `:260`.
- 전제: 같은 로컬 파일 시스템에서 대상의 부모 디렉터리를 이름 변경하고 정션을 만들 수 있는 다른 행위자. 쓰기 재현에서는 바깥 파일과 원래 파일의 초기 내용이 같아 SHA-256도 같다.
- 재현: `$V/probe-v1.mjs`의 `race-read-junction`, `race-write-junction`, `race-state-read`.
  1. 임시 작업 공간에 `sub/a.txt`, 작업 공간 밖의 형제 폴더에 `outside/a.txt`를 만든다. 두 폴더 모두 `$V` 아래다.
  2. 앱의 공개 `readWorkspaceText` 또는 `writeWorkspaceText`를 호출한다.
  3. 읽기는 경로·lstat 검사 후 Workspace의 stat 반환 직전에, 쓰기는 초기 읽기·편집 가능 판정 후 두 번째 대상 readFile 호출 직전에 `sub`를 `sub-old`로 이름 변경하고 `sub → outside` 정션을 만든다.
  4. 읽기 결과 `opened`, 바깥 합성 텍스트 반환 `true`. 쓰기 결과 `written`, 바깥 파일 변경 `true`, 원래 `sub-old/a.txt` 보존 `true`, 교체 시 실제 작업 공간 잠금 `held`.
  5. 정션의 목적지를 `.codaryn/hidden`으로 바꾼 읽기도 `opened`, 상태 디렉터리 합성 텍스트 반환 `true`.
- 실제 디렉터리·파일·정션을 사용했다. 기존 `nodeFileLayer`의 stat/readFile 경계에 대기를 삽입해 교체 시점을 고정했으며, 원래 I/O 결과를 조작하거나 제품 소스를 수정하지 않았다. 별도 공격 프로세스의 확률적 성공률은 측정하지 않았다.
- 재현 결과: 경계 우회 **3/3**. 공개 앱 API에서 재현. 잠금과 동일 내용 해시가 경로 교체를 막지 못했다.

## 낮음 L-1: 잠금 해제의 false 반환을 성공으로 처리

- 위치: `src/app/workspace-text.ts:319–320`; `src/store/lock.ts:634–642`의 반환 계약.
- 재현 A: `release-false`. `writeWorkspaceTextIn`의 해제 훅이 `false`를 반환하게 하면 실제 잠금은 `held`인데 응답은 `written`, `lockLeft: false`다.
- 재현 B: `real-release-false`. 공개 앱 쓰기의 실제 rename 완료 직후 임시 `.codaryn/lock.json`의 runId를 다른 유효한 값으로 바꾼다. 실제 `releaseLock`은 소유자 불일치로 false를 반환한다. 응답 `written`, `lockLeft: false`, 실제 잠금 `held`를 확인했다.
- 반환값을 검사하지 않고 `released = true`로 설정한다. 잠금 해제 미완료 안내가 누락된다. 재현 **2/2**.

## 실행 수치와 차단 확인

| 시험 | 결과 |
| --- | --- |
| 대상 앱 diff | 4파일, +556 / -1행 |
| TypeScript 빌드 | 종료 코드 0 |
| 기존 U-172 단위 시험 | 19개 통과, 실패 0, 건너뜀 0 |
| 별도 재현 harness 최종 실행 | 62개 기록: 기대 충족 56, 결함 재현 5, 실행 불가 1 |
| 바깥 경로·절대/드라이브/UNC·ADS·제어 문자 경로 | invalid_arguments 확인; UNC는 문자열 거부만 시험, 연결 0회 |
| `.codaryn` 대소문자·끝 점/공백·DOS 장치명 | refused |
| 실제 8.3 별칭 | 임시 항목에만 fsutil로 지정. 상태 디렉터리 refused, 보호 경로 protected, 설정 파일 settings_file/not_editable |
| 설정 파일의 대소문자 | settings_file/not_editable |
| 공개 앱에 작업 공간 내부 task 파일 지정 | 긴 이름·8.3 이름 모두 invalid_task, 파일 변경 false |
| 고정된 내부·외부 정션 | 둘 다 refused |
| 외부 파일의 하드 링크 | 읽기 opened/hard_link, 쓰기 not_editable, 바깥 파일 보존 |
| 읽은 뒤 하드 링크 추가 | 저장 시 다시 검사하여 not_editable/hard_link |
| 등록 합성 비밀·키 모양·제로폭 문자로 나눈 키 | 3개 모두 masked=true, editable=false, 원문 미반환 |
| 새 글의 키/합성 비밀·ESC/CR/NUL/C1/방향/줄 구분 제어 문자 | text_refused; 키 분할 포함 |
| NUL 포함 파일·잘못된 UTF-8 | not_text |
| 파일 크기 | 262,144바이트 opened; 262,145바이트 too_large |
| 새 글 크기 | 262,145바이트 text_refused/too_large |
| CRLF·BOM 복원 후 상한 | LF 131,071개 → 262,145바이트, text_refused/too_large |
| CRLF·BOM 보존 | 저장 결과 6바이트: 239,187,191,122,13,10 |
| 기존 잠금 | 읽기 workspace_locked 이유, 쓰기 workspace_locked |
| 열 때 해시 불일치 | conflict |
| 임시 파일 작성 후 최종 해시 직전 외부 편집 | 세 번째 readFile에서 검사, conflict, 외부 편집 보존 |
| I/O 예외·가림 예외 | unreadable / mask_failed; 주입한 오류 원문 미반환 |

실행 불가 1건: 실제 파일 심볼릭 링크 생성이 `EPERM`. 정션 생성과 정션 우회는 실행했다. 다른 OS·파일 시스템, 별도 프로세스 경쟁 성공률, 가용 메모리 고갈 시험은 실행하지 않았다.

## 실행 명령·재현 산출물

관리용 저장소에서 먼저 AGENTS.md와 PM·페르소나 지침을 읽고 아래 명령을 실행했다. `$V`는 위의 절대 경로다.

```powershell
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 07cd600 9db60f3 -- src/app
git show 9db60f3:docs/work-orders/phase-4-5-design.md
git archive --format=tar --output="$V/snapshot.tar" 9db60f3
tar -xf "$V/snapshot.tar" -C $V
```

아래 명령의 작업 디렉터리는 `$V`다. 테스트 임시 경로도 `$V/test-tmp`로 한정했다. 의존성 설치 0회; 기존 로컬 TypeScript를 사용했다.

```powershell
node --version
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
$env:TEMP = "$V/test-tmp"
$env:TMP = $env:TEMP
node --test dist/tests/unit/app/u172-workspace-text.test.js
node probe-v1.mjs
```

8.3 별칭 재현에서 harness가 실행한 명령:

```text
fsutil.exe file setshortname <자체 임시 .codaryn 폴더> V1STAT~1
fsutil.exe file setshortname <자체 임시 protected folder> V1PROT~1
fsutil.exe file setshortname <자체 임시 LongSettingsName.json> V1SET~1.JSN
fsutil.exe file setshortname <자체 임시 LongTaskDefinition.json> V1TASK~1.JSN
cmd.exe /d /c for %I in ("<자체 임시 경로>") do @echo %~sI
```

최종 원본 대조: `git ls-tree -r 9db60f3 -- src/app/app.ts src/app/index.ts src/app/types.ts src/app/workspace-text.ts`와 사본 4파일에 대한 `git hash-object`; **4/4 일치**.

- 재현 코드: `$V/probe-v1.mjs`.
- 최종 수치·결과: `$V/probe-results.json`, `$V/probe-v1.log`.
- 단위 시험 출력: `$V/unit-u172.log`.
- harness를 다시 실행하면 자기 폴더 아래 새로운 `attacks-*` 폴더만 만든다. 초기 탐색 실패 후 경로 인용과 NUL 파일명 충돌을 수정한 최종 실행 수치를 위에 기록했다.
