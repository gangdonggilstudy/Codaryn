# F6 교차 검토: 스냅샷 저장과 되돌리기 (main 8e1a166)

- 검토자: p6. 구현자가 아닙니다. 읽기 전용으로 검토했고 저장소 파일은 수정·커밋하지 않았습니다.
- 대상: `src/store/changes.ts`(createChangeRecorder, revertRun), `src/store/index.ts`(잠금), `src/cli/assemble.ts`(createRevertCommand와 조립)
- 기준: `docs/work-orders/phase-2-repair-loop.md`(R-6~R-8), `docs/cli-contract.md` 14절, `src/contracts/changes.ts`
- 실험 방법
  - `git archive HEAD`로 main을 `<claude-tools>/.codaryn/f6/main`에 풀어 빌드했습니다.
  - `.codaryn/f6/ws` 아래 임시 작업 공간에서, 실제 workspace·도구 실행기·기록기·journal·revertRun을 직접 연결해 시험했습니다.
  - 가짜 값만 썼습니다. 실제 API, 외부 네트워크, 키 파일은 쓰지 않았습니다. Windows 11, Node 26.13 환경입니다.
- 실험 스크립트(재현용): `.codaryn/f6/h.mjs`, `exp1.mjs`~`exp4.mjs`, `exp-lock.mjs`
  - 실행 방법: `.codaryn/f6`에서 `node expN.mjs`

## 발견 요약

| 심각도 | 수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 3 (1, 2, 3) |
| 낮음 | 3 (4, 5, 6) |
| 정보 | 4 (7~10) |

## 1. [중간] 오래된 잠금을 회수할 때 경쟁: 여러 프로세스가 동시에 잠금을 얻음

- 위치: `src/store/index.ts:196-209`(`acquireLock`의 `link` 실패 → `readLock` → `isProcessAlive` → `rm` → 재시도)
- **깨지는 입력**: `lock.json`에 죽은 pid가 남아 있는 상태(실행이 강제 종료된 뒤)에서, `codaryn run`이나 `codaryn revert` 둘 이상이 거의 동시에 시작하는 경우
- **원인**: 경쟁 상대가 이미 새 잠금을 `link`한 뒤에도, 뒤처진 프로세스는 앞서 읽은 "죽은 pid"를 근거로 `rm`을 실행합니다. 그래서 상대의 새 잠금을 지우고 자기 것을 `link`합니다.
- **결과(재현함)**
  - 별도 프로세스 3개를 같은 시각에 출발시켰습니다. 40회 중 34회에서 둘 이상이 `{ok:true}`를 받았습니다.
  - 예: 세 프로세스 모두 `ok:true`를 받았지만 `lock.json`에는 `runB`만 남았습니다.
  - 한 프로세스 안의 비동기 호출 3개로는 300회 중 38회였습니다.
  - 같은 조건에서 `acquireLock`이 `EPERM`(open, unlink)으로 거부되기도 했습니다. 각각 1회입니다. 이때 CLI는 `workspace_locked`가 아니라 `internal_error`를 냅니다.
- **영향**: 실행과 되돌리기, 또는 두 실행이 같은 작업 공간을 동시에 바꿀 수 있습니다. 해시 검사가 일부 덮어쓰기는 막지만, 잠금 계약(P-4, 14절 3단계)이 깨집니다. 비정상 종료 뒤는 되돌리기를 가장 많이 쓸 때라서 전제 조건이 드물지 않습니다.
- **재현**: `node exp-lock.mjs`
- **권고**: 회수를 원자적으로 해야 합니다.
  - 예: 죽은 잠금을 고유한 이름으로 `rename`한 뒤, 옮긴 파일의 내용이 읽은 것과 같은지 확인하고 지웁니다.
  - 또는 회수 전용 잠금을 둡니다.
  - 그리고 `EPERM`과 `EBUSY`를 `workspace_locked`나 재시도로 처리합니다.

## 2. [중간] 쓰기 뒤 `file_changed` 전에 끊긴 실행: revert가 "complete"(종료 0)라고 하지만 바뀐 파일이 남음

- 위치
  - `src/store/changes.ts:229-256, 350-393`: 대상은 journal의 `file_changed`뿐입니다. 스냅샷 index에만 있는 경로는 보지 않습니다.
  - `src/engine/index.ts:339-351`: 파일을 쓴 뒤 `tool_result`를 먼저 기록하고 그다음 `file_changed`를 기록합니다. 342-343행에서 경로 가림이 실패하면 `file_changed` 없이 끝납니다.
- **깨지는 입력**: `write_file`로 파일 내용이 바뀐 뒤 `file_changed`가 기록되기 전에 실행이 끝나는 경우
  - 강제 종료(`taskkill /F`, 창 닫기, 정전)
  - journal 쓰기 실패(디스크 가득)
  - 경로 가림 실패
  - SIGINT와 SIGTERM은 취소 신호로 처리되므로 해당하지 않습니다.
- **결과(재현함, 기록 생략으로 모사)**
  - `b.txt`는 기록하고 `a.txt`는 쓰기만 하고 기록하지 않았습니다.
  - index에는 `["b.txt","a.txt"]` 둘 다 있습니다.
  - revert 결과는 `{"reverted":[b.txt],"skipped":[]}`이고, CLI는 `complete`(종료 0)를 출력합니다. 그런데 `a.txt`는 `a1`(실행이 바꾼 내용) 그대로입니다.
  - 원문은 스냅샷에 있지만 사용자에게 알리지 않습니다.
- **재현**: `node exp2.mjs`의 E4a
- **권고**: journal에 없는데 index에 있는 경로를 `skipped`로 보고해야 합니다(이유 추가 또는 `missing_record`). 그러면 `complete`가 거짓이 되지 않습니다. 복원까지 할지는 판단이 필요합니다. 이 경우 실행이 남긴 해시를 알 수 없습니다.

## 3. [중간] 이전 실행의 스냅샷 원문을 명령이 읽어 모델과 journal로 보낼 수 있음

- 위치: `src/contracts/changes.ts:8-10`과 `docs/cli-contract.md:310`의 설명은 "No tool can reach them", "도구는 접근할 수 없다"입니다. 하지만 `run_command`로 실행되는 프로세스는 상태 디렉터리 제한을 받지 않습니다.
- **깨지는 입력(재현함)**
  - 실행 1에서 비밀(가짜 값 `OLD-fake-db-pass-ZZ9`)이 든 파일의 다른 줄을 고쳤습니다. 그래서 그 원문이 `1.orig`에 남았습니다.
  - 그 뒤 사용자가 파일에서 비밀을 지우고 더는 비밀로 등록하지 않았습니다.
  - 실행 2에서 모델이 `peek.test.mjs`를 쓰고 `node --test`를 실행했습니다. `node --test`는 예시 task의 유일한 명령 규칙입니다.
  - 테스트는 `.codaryn/runs/*/snapshots/*.orig`를 읽어 출력합니다. 결과로 `run_command` 출력에 옛 비밀 원문이 들어 있었습니다(`true`).
- **영향**
  - 등록되지 않은 값은 가려지지 않습니다. 그래서 모델 요청에 들어가고, 같은 출력이 담긴 `tool_result`가 journal에도 남습니다(코드 근거).
  - 스냅샷은 자동으로 지워지지 않습니다(R-8). 그래서 사용자가 지웠다고 생각한 비밀이 이후 모든 실행에서 이 경로로 노출될 수 있습니다.
  - 프롬프트 주입된 모델이면 쉽게 시도할 수 있습니다.
- **재현**: `node exp3.mjs`
- **권고(설계 판단)**
  - 계약과 문서 문구를 "파일 도구는 접근할 수 없지만 명령은 읽을 수 있다"로 바로잡습니다.
  - 스냅샷을 작업 공간 밖(사용자 프로필 등)에 둘지, 실행 종료 뒤 보관 정책을 둘지 검토합니다.

## 4. [낮음] journal 마지막 줄이 잘리면 되돌리기 전체가 거부됨

- 위치: `src/store/changes.ts:230`(끝이 LF가 아니면 `invalid_run_record`)
- **깨지는 입력**: 기록 도중 강제 종료나 디스크 가득으로 마지막 줄이 잘린 journal
- **결과(재현함)**
  - 앞의 완전한 `file_changed` 두 건이 있어도 `RevertRunError invalid_run_record`가 나고, 아무것도 복원되지 않습니다.
  - 계약(14절 5단계)대로의 동작입니다. 하지만 비정상 종료 뒤가 되돌리기가 가장 필요한 때입니다. 사용자는 journal을 손으로 고쳐야 합니다.
- **재현**: `node exp2.mjs`의 E4b
- **권고**: 마지막의 불완전한 한 줄은 무시하고 `partial`로 보고하는 방식을 검토합니다. 발견 2와 함께 보면 좋습니다.

## 5. [낮음] 상태 디렉터리를 조작하면 revert가 작업 공간 안의 임의 파일에 심어 둔 내용을 "restored"로 씀

- 위치: `src/store/changes.ts:287-342`. 무결성 검증이 없고 journal, index, 스냅샷을 그대로 믿습니다.
- **깨지는 입력(재현함)**
  - 실행 디렉터리를 만들었습니다. journal에는 `untouched.txt`의 `previousHash`=hash(심은 내용), `newHash`=hash(현재 내용)를 넣었습니다. index와 `1.orig`도 그에 맞췄습니다.
  - revert 결과 `{"reverted":[{"path":"untouched.txt","action":"restored"}]}`가 나왔고, 실행이 건드린 적 없는 파일이 심은 내용으로 바뀌었습니다.
  - 실제로는 실행 중의 명령이 자기 실행의 디렉터리를 이렇게 바꾸고 사용자가 그 실행을 되돌리는 경로가 됩니다(**추측**).
- 명령은 이미 사용자 권한으로 같은 파일을 직접 바꿀 수 있으므로 권한이 커지지는 않습니다. 다만 "되돌리기"라는 신뢰를 이용해 사후에 바꾸게 할 수 있습니다. `.git/config`처럼 실행 뒤에 효과가 나는 파일이 예입니다.
- 작업 공간 밖과 상태 디렉터리 안은 막힙니다(아래 "문제 없던 범위").
- **재현**: `node exp4.mjs`의 E6
- **권고**: 문서에 한계로 적습니다. 무결성 검증(작업 공간 밖 키로 만든 HMAC 등)을 둘지는 설계 판단입니다.

## 6. [낮음, 코드 근거, 재현 안 함] 삭제 직전 경쟁: 해시 확인과 `rm` 사이의 사용자 변경이 사라짐

- 위치: `src/store/changes.ts:327-336`
- 새로 만든 파일을 지울 때 `hashOf` 다음에 바로 `rm`합니다. 복원 경로(`writeText`)와 달리 지우기 직전에 다시 확인하지 않습니다.
- 그 사이에 사용자가 같은 파일을 저장하면 그 내용은 확인 없이 삭제됩니다.
- 시간 창이 짧아 실험으로 재현하지는 않았습니다(**추측**: 편집기 자동 저장과 겹치면 가능).
- **권고**: 삭제 대상을 임시 이름으로 `rename`한 뒤, 그 파일의 해시를 다시 확인하고 지웁니다. 다르면 되돌려 놓고 `changed_since_run`으로 보고합니다.

## 정보

7. **조립 미연결**(`src/cli/assemble.ts:128-129`, `src/cli/main.ts:36`)
   - `createToolRunner`에 `changeRecorder`를 넘기지 않으므로, 실제 CLI 실행은 스냅샷을 남기지 않습니다. `revert`도 연결되지 않아 `internal_error`입니다.
   - cli-contract 14절 "연결 상태"에 적힌 상태입니다. 그래서 이 검토는 저장소 함수와 `createRevertCommand`를 직접 연결해 시험했습니다.
   - 같은 곳의 `createCommandRunner()`에도 G1과 이전 작업의 옵션(`workspaceRoot`, `allowEnvValue`)이 아직 빠져 있습니다.
8. **실행이 만든 디렉터리는 revert 뒤에도 남습니다**(E1의 `dir/sub`). 파일만 지웁니다.
9. **건너뛴 이유가 실제와 다른 경우가 있습니다.**
   - 루트 밖 경로나 상태 디렉터리 경로가 든 조작 journal은 `changed_since_run`으로 보고됩니다(`changes.ts:323`).
   - 아무것도 쓰지 않으므로 안전 문제는 아니지만, 사용자에게는 오해를 줍니다.
10. **스냅샷 원문과 실행 전 상태가 다른 경우**
    - 첫 쓰기 시도가 동시 변경 conflict로 실패한 뒤 성공한 실행은 `missing_snapshot`으로 그 파일을 되돌리지 못합니다(E7).
    - 잘못 복원하지는 않으며, cli-contract 188행의 한계와 같습니다.

## 문제 없던 범위 (실제 파일로 확인)

- 같은 파일 여러 번 수정(3회): 첫 원문이 바이트 그대로 복원됩니다. BOM, CRLF, 한글 포함입니다.
- 새 파일은 삭제되고, 실행 뒤 사용자가 바꾼 파일은 건드리지 않고 `changed_since_run`입니다(E1).
- 두 번째 revert는 모두 `changed_since_run`이며 아무것도 바꾸지 않습니다(E11).
- 대소문자만 다른 이름(`mixed.txt`/`MIXED.TXT`, `NewFile.txt`/`newfile.TXT`): workspace가 실제 경로 대소문자로 맞춥니다. 그래서 index와 journal 경로가 같고 정상 복원됩니다(E8).
- 361자 긴 경로: 기록과 삭제 모두 정상입니다(E9).
- 스냅샷 파일 이름은 `<n>.orig` 순번이고 index 항목도 형식 검사를 거칩니다. 경로에서 파일 이름을 만들지 않으므로 상위 경로, 긴 이름, 예약 이름으로 이탈하는 길이 없습니다.
- 예약 이름(`con.txt`, `aux/x.txt`, `NUL`, `COM1.log`), ADS(`a.txt::$DATA`), 끝 점(`x.txt.`)은 쓰기 단계에서 `policy_denied`이고 스냅샷도 생기지 않습니다(E10).
- 조작된 journal과 index로 작업 공간 밖이나 상태 디렉터리의 파일을 쓰거나 지우는 시도(E2): 모두 막혔고 대상 파일이 그대로였습니다. 시도한 경로는 다음과 같습니다.
  - `..\outside`, `sub/..\..\..\outside`, `/`로 쓴 절대 경로
  - 루트 밖을 가리키는 정션 `link/`
  - `.codaryn/`, `.CODARYN/`, `.codaryn./`
- 부분 실패(E12): 읽기 전용 파일 하나가 `io_error`여도 나머지는 복원됩니다. 임시 파일은 남지 않고, 원인을 없앤 뒤 다시 실행하면 남은 파일이 복원됩니다.
- 잠금(E14): 실행이 잠금을 쥔 동안 `createRevertCommand`는 `workspace_locked`이며 아무것도 바꾸지 않습니다. 끝나면 잠금이 해제됩니다.
- 출력과 오류 메시지에는 journal 경로(가림본)와 일반 문구만 있습니다. 스냅샷 내용과 원문 경로를 내보내는 코드 경로는 찾지 못했습니다(코드 읽기).

## 검사하지 않은 범위

- 실제 `codaryn run`/`codaryn revert` 프로세스 끝까지의 흐름(조립 미연결)
- POSIX와 macOS
- 8.3 짧은 이름: 이 볼륨에서는 `.codaryn`의 짧은 이름이 만들어지지 않아 시험하지 못했습니다.
- 정전 시 내구성(fsync 없음)
- 하드 링크, ACL, 파일 속성의 복원 후 상태
- 네트워크 드라이브, 백신의 파일 잠금
- 매우 큰 journal
- 한 실행에 기록기 인스턴스가 둘인 경우
- 발견 6의 실제 재현
