# R-6 검토: 사용성 CLI 연결 (claude/workspace-policy, 묶음 병합 전)

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용 교차 검토다. N-A 구현자가 아니다.
  - CLI가 그리는 사람용 문구는 내 N-B 카탈로그다. 문구 자체에 관한 판단은 이해관계로 표시한다.
- worktree: `D:\project\Codaryn\.worktrees\claude-quality`(main `aa84b83` 병합 `d194ceb`). 저장소 파일 수정·커밋 없음.
- **검토한 커밋**: `claude/workspace-policy` `e702b41`(12:01:54 고정). 지시의 연결 커밋을 모두 포함한다.
  - `d783a68`(N-1~N-3, N-8, N-9, N-15, N-18, N-19)
  - `abd9a42`(카탈로그·사람용 출력 연결, N-4, N-5, N-7, N-20~N-25)
  - `937919f`(N-26, N-20)
  - `cc67e4a`(빠진 문구는 영어로, 안내 한 번)
  - 계약 커밋(`9735b5f`, `397413a`, `dd6a050`, `d3ad36d`, `4059a0d`, `8edd2c6`, `bacf1a0`), store `34587ff`, `79c3727`
- 방법: `git archive e702b41`로 `.codaryn/r6/build`에 빌드 사본을 만들었다. 이 사본이 설치 위치다. `tsc` 오류는 0건이었다.
  - 실제 CLI 프로세스 80회를 실행했다(`exp.mjs` 67회, `exp2.mjs` 13회).
  - 환경: 실제 키와 CODARYN_* 변수를 지웠다. 키가 필요한 사례에는 키 모양이 아닌 가짜 값만 썼다. `CODARYN_API_BASE_URL=http://127.0.0.1:9`(닫힌 루프백)로 두어 어떤 요청도 밖으로 나가지 못하게 했다. APPDATA는 `.codaryn/r6` 안의 폴더로 바꿨다.
  - 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다. UNC 호스트 경로는 SMB 접속을 일으킬 수 있어 쓰지 않았고, 장치 경로(`\\?\C:\…`)만 썼다.
- 대조 기준: `docs/work-orders/phase-4-usability.md` N-1~N-26, `docs/cli-contract.md` 17절.

## 1. 결과

- 심각도별: **높음 0 / 중간 0 / 낮음 2 / 정보 5**.
- 지시의 중점 10개를 모두 실제 프로세스로 재현했다. 결정과 다른 동작은 아래 낮음 2건뿐이다.
- 모든 실행의 stdout·stderr에서 심은 값(`SYNTHETIC`, 키 모양 문자열, 가짜 키 값, 프로필 이름 `SYNTHPROFILE`)이 0건이었다.
- JSON을 내는 66회는 모두 stdout 한 줄이고 ASCII만 썼다.

## 2. 발견

### 낮음

#### L-1. doctor의 잠금 점검이 프로세스 시작 시각(N-25 b)을 보지 않아, 실행이 회수할 잠금을 "쥠"으로 알린다

- 위치: `src/cli/doctor.ts` `inspectLockFile`(`e702b41` 361~380행). pid가 살아 있는지만 보고 `processStartedAt`은 읽지 않는다.
  - 실행 쪽 `src/store/lock.ts`의 잠금 획득은 시작 시각을 비교한다(304~320행, Windows는 `Get-Process`).
- 재현(`exp.mjs` I4, `exp2.mjs` I4·I4b): 살아 있는 프로세스의 pid와 맞지 않는 `processStartedAt`(2001년)을 담은 `lock.json`을 두었다.
  - `doctor`의 lock 결과는 `warn` "a process holds .codaryn/lock.json; … remove that file"이다.
  - 같은 잠금으로 `run --task`를 실행하면 회수하고 `done`으로 끝나며 잠금을 지운다.
- 영향: Z-2(pid 재사용)의 바로 그 상황에서 doctor는 "누가 쥐고 있다, 실행 중인 Codaryn이 없으면 지우라"고 하고 실행은 그냥 진행한다. 안내가 틀릴 뿐 파일이나 실행이 위험해지지는 않는다.
- 권고: doctor도 store의 판정(시작 시각 비교와 허용 오차)을 쓰게 한다. 위 입력을 회귀 시험으로 둔다.

#### L-2. 설정이 없는 한 줄 실행을 설치 위치에서 하면 이유가 "한도 미설정"으로 나온다

- 재현(`exp.mjs` D1, D2): 설치 위치(`build`)와 그 하위 폴더에서 설정 없이 `run "x"`를 실행했다. 결과는 `invalid_config`(`limits.maxModelTurns is not set …`)이다.
- `exp2.mjs` D1b·D2b·D2c: 쓸 수 있는 설정과 가짜 키를 주면 `workspace_is_install_dir`(종료 2)로 거부한다. 요청이 나가지 않고 설치 위치에 `.codaryn`도 만들지 않는다.
- 근거: 설정·한도 검사가 설치 위치 검사(U-3)보다 먼저다. 어느 경우든 거부되고 아무것도 쓰지 않으므로 안전 문제는 아니다.
- 영향: 사용자가 설정을 고치고 다시 실행한 뒤에야 진짜 이유(설치 위치)를 본다(N-9의 안내 품질).
- 권고: 작업 공간이 정해지는 즉시 U-3 검사를 하거나, 한 줄 실행에서는 그 검사를 먼저 한다.

### 정보

- **I-1 stdout 계약(N-19)**:
  - 오류, run, revert, `--json` 계열(report, runs, doctor, init, models) 66회가 모두 한 줄이고 ASCII다.
  - 한글 파일 이름(`보고서.md`)을 만든 실행은 stdout에 `\uXXXX`로 나오고, JSON으로 읽으면 원래 이름이 된다(H0).
- **I-2 값 유출 없음**: 다음 사례 모두에서 stdout·stderr(사람용 오류 포함)에 심은 값이 나오지 않았다.
  - 진단: JSON 문법 오류 옆의 값(G1, 위치는 4줄 3열로 맞음), 모르는 필드(G2 — 위치 `config`, 이름 없음, 제안 없음; G2b `modle` → 제안 `model`), 잘못된 값(G3), 이름 붙은 프로필 안의 값(G4 — `profiles[0]…`, 이름 없음), 키 모양 모르는 키(G5), 키 값(G6), 너무 깊은 task(G7), `verifiers[0]`의 모르는 필드(G8).
  - 그 밖: 프로필 상한 위반(C1, C2), 키 모양 실행 디렉터리(H4 JSON·표 모두 가림), 목표 속 키 모양·현재 키 값(D3, D3b), `models` 실패(R2).
- **I-3 doctor의 설정 점검과 위치 점검**: 기본 위치의 설정이 작업 공간 안이면 `config_file`은 `ok`(올바름)이고 `file_locations`가 `fail`("a run refuses them")이다. 전체 결과는 `fail`(종료 1)이라 결론은 맞다(A1c).
- **I-4 확인하지 못한 범위**:
  - 터미널에서 묻는 `init`(stdin·stderr가 TTY일 때). 키를 묻지 않는지, 질문의 기본 답이 맞는지 확인하지 못했다.
  - `models`의 성공 경로(실제 API).
  - Linux·macOS의 기본 위치(XDG, 홈).
- **I-5 이해관계**: stderr 문구는 내 카탈로그다(G10: `CODARYN_LANG=ko`면 stderr가 한국어, stdout 코드는 영어). 문구 품질은 판단하지 않았다.

## 3. 중점별 결과

| 중점 | 결정 | 결과 | 사례 |
| --- | --- | --- | --- |
| 기본 설정 위치가 작업 공간 안이면 거부 | N-1, S-1 | 거부(`invalid_config`): 간편 형식, 한 줄 실행, 연결점을 거쳐 작업 공간 안으로 가는 경우 모두. 상대 APPDATA는 기본 위치 없음, 장치 경로는 쓰지 않고 doctor `warn`. `--config`가 기본 위치보다 앞선다 | A1, A1b, A6, A3, A4, A5 |
| 기본 위치를 쓴 사실 표시 | N-1(D-1) | 진행 줄, 끝 요약, `notices` 셋 다 표시. 표기는 `%APPDATA%\Codaryn\config.json`(펼친 경로 아님) | A2b |
| init: 덮어쓰지 않음, 키를 받지 않음 | N-2, N-10 | 있는 파일·같은 위치 재실행·연결점 대상은 `config_exists`이고 파일은 그대로. 키가 설정돼 있어도 파일에 키 값·키 필드 없음, 모델은 `<model id>`, 출력은 `keySet: true`만 | B1, B2, B2b, B4 |
| init: 작업 공간 안 거부 | N-2, S-1 | `invalid_config`, 아무것도 쓰지 않음 | B3 |
| 프로필 한도 상한 | N-8, S-7 | 최상위보다 큰 값, 숫자 아래 `null` 모두 파일을 읽을 때 거부. task는 프로필 한도를 넘지 못함. 이름 형식 오류는 `invalid_arguments`, 없는 이름은 `invalid_config`. task의 `profiles`는 거부 | C1~C5 |
| 한 줄 실행: 설치 위치 거부 | N-9, U-3 | 설정이 있으면 `workspace_is_install_dir`. 설정이 없으면 이유가 다르다(L-2) | D1b, D2b, D2c, D1, D2 |
| 한 줄 실행: 목표의 키 검사, 인자 | N-9, S-8 | 키 모양·현재 키 값 모두 `key_in_file`이고 값을 내지 않음. 위치 인자 두 개, `--task`와 함께, `--`로 시작하는 목표는 `invalid_arguments` | D3~D6 |
| 자리표시자 모델 | N-3 | `<model id>`, 공백, 앞뒤 공백 `<x>`, CODARYN_MODEL 자리표시자 모두 `provider_not_configured`("Nothing was sent"). doctor model `fail` | E1~E5 |
| stdout JSON 한 줄, 비 ASCII | N-19 | I-1 | 전체 |
| quiet | N-5 | 오류, 인자 해석 실패, 성공 실행, revert 모두 stderr 비어 있음 | G9, G9b, A2c, H8 |
| 오류 진단에 값이 새지 않음 | N-15, N-14 | I-2 | G1~G8 |
| revert latest | N-7, N-23 b, N-18 | `latest`가 마지막 확인된 실행을 고르고 stderr에 실행 id와 시작 시각을 먼저 보인다. `--dry-run`은 아무것도 바꾸지 않는다. `runs/latest` 디렉터리가 있으면 revert·report 모두 `invalid_arguments` | H1, R1, H7, H7b |
| 손상 실행 거부 | N-26, N-16, N-23 b | 미래 시각의 위조 실행은 `damaged`이고 `latest`에서 빠진다. 명시 id로 되돌려도 `invalid_run_record`이며 작업 공간은 그대로다. 다른 실행을 가리키는 복사본도 거부 | H2, H2b, H3, H3b |
| 되돌리기 기록만 손상 | N-23 g | 목록에 `revertRecordDamaged: true`, 상태는 checked. revert는 진행(`complete`) | H5, H5b |
| 두 번째 되돌리기 | N-22 | `complete`, 건너뜀 사유 `already_reverted`, `revertedBefore` 표시 | H6 |
| doctor 잠금 점검 | N-25 a | 없음 `ok`, 산 pid `warn`(안내), 끝난 pid `ok`(회수 안내), 깨진 파일·디렉터리 `warn`. 시작 시각 불일치는 L-1. 잠긴 작업 공간의 run은 종료 6이고 stderr에 지우라는 안내 | I1~I7, I3 |
| 언어 | N-4, N-20 | `CODARYN_LANG=fr`이면 doctor language `warn`(무시, OS 언어 ko 사용). `ko`면 stderr 한국어 | L1, G10 |
| report의 검증기 순번 | N-24 a | Markdown에 id(`has-a`)가 없고 순번만 있다 | R1b |

## 4. 재현 자료 (`.codaryn/r6/`, Git 추적 제외)

- `build/`: `e702b41` 빌드 사본. `node_modules`는 이 worktree로 연결했다.
- `exp.mjs` → `exp.out`(67회), `exp2.mjs` → `exp2.out`(13회).
- `t/`, `t2/`: 사례별 작업 공간, 입력 파일, 가짜 APPDATA.
- 실행: `node .codaryn/r6/exp.mjs`, `node .codaryn/r6/exp2.mjs`. 빌드 사본이 있어야 한다.
