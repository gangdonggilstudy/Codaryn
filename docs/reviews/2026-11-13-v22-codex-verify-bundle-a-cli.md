# V-22 묶음 A-6 끝에서 끝까지 비노출 검증

- 담당: codex-check, 보안·개인정보 검토자.
- **높음 0건 / 중간 0건 / 낮음 0건**(아래 실행 범위).
- 시작 시 `git rev-parse pm/unit-A6` = **13bd8a7cdce9410dd60a64d12bf2290dab34b703**, main = **bd7f0cc0347e959b21e4d9104211af74014baf6e**. 지정 판과 일치하며 서로 다름.
- archive 사본·재현 자료: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-v22-a6-1794579976128`.
- AGENTS.md를 먼저 읽고 main 상태·브랜치·루트를 확인했다. 추적 변경 없음. 저장소 소스 수정·커밋·푸시·worktree 추가, 실제 API·외부 네트워크·키 조회·권한 요청 없음. 생성물은 지정 .codaryn 아래 자기 폴더와 보고서뿐이다.

## 실제 CLI 재현과 판정

독립 탐침은 빌드된 **node dist/src/cli/main.js**를 별도 프로세스로 실행한다. scripted 모델, 허용 목록으로 만든 자식 환경, 네트워크 차단 장치를 사용했다. 각 CLI 제한 15초, 탐침 시험 제한 60초. 실제 비밀값 대신 합성 표지만 사용했다.

| 항목 | 재현 방법·수치 | 결과 |
| --- | --- | --- |
| (1) 행·작은 키·적은 칸 집계 비노출 | tests/fixtures/private-tables와 private-canary 사용. CSV·TSV·JSONL 각각 16행, 지역/팀/두 열 묶기, describe, bonus의 적은 기여 칸 sum·mean·count. 별도로 세 형식의 5행/숫자 1칸 표도 질의 | main 카나리 실행: **model_request 6개, tool_decision/tool_result 각 26개**. 금지 문자 표지 **0건**, 금지 숫자 **0건**. 적은 칸 집계 3개 모두 [null,null,null]. 공개해도 되는 큰 묶음 키는 모두 모델 요청에서 발견(양성 대조) |
| 출력·기록의 검사 위치 | model_request, journal 및 .codaryn의 **변경 스냅샷을 포함한 모든 파일**, 결과 JSON, run stdout/stderr, 생성한 public/report.md, report·changes의 사람용/JSON 출력 | report/changes **4프로세스 모두 종료 0**. 문자 표지는 JSON 이스케이프·Base64·URL·hex 등 제공 harness의 변형도 검사. 숫자는 요청한 질의의 독립 oracle로 금지값을 계산해 검사 |
| (2) 네 원천 합집합·k | 설정/프로필/정의/task마다 다른 경로를 넣고, 네 원천 중 하나씩 k=10, 나머지는 5. 네 경로 모두 read_file과 query_table 호출 | **4실행** 모두 네 경로 읽기 거부, query 결과 k=10. **16개 읽기 거부**, 16개 질의에서 5행 그룹 숨김 |
| 빈 목록 덮어쓰기 | 설정 unreadablePaths=[private], k=9. 프로필·정의·task는 모두 목록=[]·k=5 | **1실행**에서 읽기 거부, describe k=9. 설정의 목록과 k 유지 |
| k 입력 범위 | 네 원천 각각 4·0·5.5·1001 지정 | **16/16 실행 전 거부**, minGroupSize 위치를 지적. 실행 디렉터리 생성 **0개** |
| (3) 명령 금지 | task/정의의 command 규칙 또는 command 검증기. 간편 CLI의 설정/프로필에서도 각각 같은 두 입력 | **8/8 실행 전 거부**, unreadablePaths와 충돌한다고 지적. 실행 디렉터리 **0개**, 명령 실행 없음. 간편 형식도 모델 연결 전에 거부됨 |
| (4) 읽기 셋·쓰기 및 우회 | custom 정의로 read_file/search_files/inspect_files/write_file 제공. 같은 private 파일을 원래 철자·대문자·./·역슬래시·디렉터리 junction으로 접근 | **5경로 × 4도구 = 20/20 unreadable_path 거부**. 원본 바이트 그대로. 루트 search/inspect 2회는 허용하되 withheld=true, 칸 표지 없음. junction 생성·검사 성공, 건너뜀 없음 |
| (5) analyze-private 필수 목록 | 목록을 아예 주지 않음 / 빈 배열 명시 | **2/2 실행 전 거부**, unreadablePaths must not be empty. 실행 디렉터리 **0개** |
| 검증기 연결 | 관련 CLI 시험에서 읽기 제외 원본의 aggregate_match 실패→수정 요청, 이동 계획 apply 후 검사, 공개 원본 양성 대조. U-223 원본·대상·table_shape 근거 시험 포함 | 관련 시험 통과. 읽기 제외 원본 수치는 검사 근거·수정 요청에 없음. 공개 원본은 기존 수치 포함 |
| 무결성 연결 | 설정만 private을 읽기 제외로 지정하고 task에는 목록 없음. 실제 CLI model_request가 기록된 뒤 대본 응답 지연 중 private/watched.txt를 시험 프로세스에서 수정 | **1실행**에서 integrity_checked.changed와 결과 protectedChanged에 해당 파일 기록. needs-input/awaiting_review와 변경 안내 유지. 실제 감시 대상 전달 확인 |

독립 CLI 실행은 총 **38회**이며 시간 초과 **0회**다. 관찰한 unreadable_path 거부는 합계 **42개**다.

카나리 숫자는 우연히 일반 메타데이터나 다른 집계와 같은 값이 되지 않도록 큰 비선형 합성 수로 만들었다. age 등 작은 숫자의 우연한 일치를 누출로 세지 않았다. 사전에 모델 대본에 금지 표지를 넣지 않았다.

fewCells/null 표시로 기여 칸이 k 미만임을 아는 것과 여러 질의를 차감하는 한계는 기존 판단대로 건수에서 제외했다.

## (6) 기존 CLI 출력 비교

```powershell
node scripts/compare-cli-boards.mjs --base bd7f0cc0 --head 13bd8a7cdce9410dd60a64d12bf2290dab34b703 --work <사본 루트>/compare --out <사본 루트>/compare-cli.md --keep
```

**27사례: 26개 동일, 1개에 차이 1곳. 종료 1(차이 있음).**

차이는 `handoff-review-reject`의 analyze 실행 journal.jsonl 첫 기록 도구 목록뿐이다.

```text
base: ["read_file","search_files","write_file"]
head: ["read_file","search_files","query_table","write_file"]
```

PM이 승인한 변화와 일치한다. stdout·stderr·종료 코드 및 나머지 비교 산출물의 추가 차이 **0건**. 터미널 사례는 비교 스크립트의 isTTY 모의이며 실제 터미널 시험은 아니다.

## 돌린 명령과 수치

```powershell
git rev-parse pm/unit-A6
git rev-parse main
git diff bd7f0cc0 13bd8a7cdce9410dd60a64d12bf2290dab34b703 -- src
git archive --format=tar --output=<사본 루트>/head.tar 13bd8a7cdce9410dd60a64d12bf2290dab34b703
tar -xf <사본 루트>/head.tar -C <사본 루트>/head
```

head에서 기존 로컬 TypeScript로 빌드:

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

**종료 0**, 의존성 설치 없음. 비교 스크립트도 자기 compare 폴더의 두 archive를 로컬 TypeScript로 빌드했다.

TEMP/TMP를 사본 루트 test-tmp로 지정하고 관련 시험 실행:

```powershell
node --test --test-timeout=60000 dist/tests/unit/cli/g-u210-canary-cli.test.js dist/tests/unit/cli/g-u210-private-analysis.test.js dist/tests/unit/cli/g-u210-r108-carried-plan.test.js dist/tests/unit/cli/g-u210-r108-few-cells.test.js dist/tests/unit/cli/g-u210-unreadable-cli.test.js dist/tests/unit/cli/g-u210-verifier-unreadable.test.js dist/tests/unit/verify/u223-data-checks-unreadable.test.js
```

**42 test / 15 suite / 통과 42 / 실패·취소·건너뜀·todo 0 / 2827.8765ms / 종료 0**. 이 묶음의 API 모의 사례는 127.0.0.1 가짜 서버만 사용하며 실제 API가 아니다.

사본 루트에서 독립 시험:

```powershell
node --test --test-timeout=60000 probe-v22.mjs
```

최종 **7 test / 통과 7 / 실패·취소·건너뜀·todo 0 / 26295.0839ms / 종료 0**.

탐침 초회는 5통과/2실패였다. 간편 형식 fixture의 필수 limits 누락과 무결성 탐지 결과를 reason 대신 protectedChanged로 검사해야 하는 예상 오류를 고쳤다. 이어 report에 잘못 준 --task를 --workspace로 고치고 네 출력의 종료 0을 단언했으며, 상태 스냅샷까지 검사 범위를 넓힌 최종 실행이 위 수치다. 제품 코드는 수정하지 않았다.

자료: 사본 루트의 `probe-v22.mjs`, `probe-results.json`, `probe-tests.log`, `related-tests.log`, `compare-cli.md`, `compare-cli.log`, `build.log`, `src-diff.txt`. 최종 38회 CLI의 입력·stdout·stderr·작업 공간·실행 기록은 `suite-vi6Tkq` 아래에 보관했다. 앞선 탐침 로그도 별도 보관했다.

전체 시험 묶음·외부 API·실제 터미널·정션 교체 경주는 실행하지 않았다. 링크 검증은 고정된 junction에 대한 것이다.

