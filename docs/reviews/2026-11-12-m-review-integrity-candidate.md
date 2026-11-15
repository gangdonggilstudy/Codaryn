# 교차 검토 M: 무결성 목록 모듈과 후보 준비 스크립트

- 페르소나: 보안·개인정보 검토자 (읽기 전용)
- 대상: main `53eb466`
  - `src/verify/integrity.ts`(`createIntegrityChecker`, K2)
  - `scripts/new-candidate.mjs`(K4)
  - `docs/self-development.md`
- 기준: `docs/work-orders/phase-3-self-development.md`(U-1~U-8, V-1~V-3), `docs/cli-contract.md`, `src/contracts`
- 수정·커밋: 없음. 저장소 파일은 하나도 바꾸지 않았다.
- 실험 위치: `D:\project\Codaryn\.worktrees\claude-workspace\.codaryn\m-review` 안에서만 했다.
  - 시험용 Git 저장소, 스크립트 사본, CLI 빌드 사본(`m-review\cli`, 설치 위치 검사를 피하기 위한 사본)을 이 폴더에 두었다.
  - 가짜 값만 썼다. 실제 API와 네트워크는 쓰지 않았다.
- 실행에 쓴 빌드: 내 브랜치(`bc5dbba`) 빌드다.
  - 대상 세 파일과 `src/cli`, `src/contracts`는 `53eb466`과 같다(`git diff --stat`로 확인).
  - 다른 곳은 `src/engine/feedback.ts`(V-1)와 도구(V-2)뿐이며, 아래 실험과는 관계없다.
- 환경: Windows 11, Node 26.13, Git 2.53

## 요약

| 심각도 | 수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 2 | M-1, M-2 |
| 낮음 | 2 | M-3, M-4 |
| 정보 | 2 | M-5, M-6 |

## M-1 중간: 보호 경로 아래의 링크 너머 내용은 목록에도 정책에도 들지 않아, 보호된 검증의 입력이 탐지 없이 바뀐다

### 위치

- `src/verify/integrity.ts:209-216`: 하위 링크를 `link`로만 기록하고 따라가지 않는다. 해시는 링크의 대상 문자열에 대해서만 낸다.
- 계약 `src/contracts/integrity.ts:27, 64`: "links below an entry are recorded as `link` and not followed".
  - 이 계약은 내가 K1 1단계에서 정했다. 원인의 일부가 내 결정이다.
- 정책: `src/policy/protected.ts`(T-13, 내 코드). 링크 확장은 항목 자체가 링크일 때만 한다. 그래서 하위 링크의 대상 실경로에 대한 쓰기는 허용된다.

### 깨지는 입력

- `policy.protectedPaths: ["tests"]`
- 작업 공간에 `tests/fixtures`가 있다. 이것은 `shared/`(보호 안 됨)를 가리키는 정션이다.
- 검증기는 `file_rules`로 `tests/fixtures/data.txt`에 `expected=1`이 있는지 본다. 원래 내용은 `expected=0`이다.

### 결과

scripted 모델이 다음 두 쓰기를 시도한다.

1. `write_file tests/fixtures/data.txt`: `policy_requested`에서 `protected_path`로 거부된다(어휘 판정).
2. `write_file shared/data.txt`: 허용된다. 같은 파일이다.

이어서 무결성 확인 결과는 다음과 같다.

- `run_start`, `before_verify`, `after_verify`가 모두 `[]`이다.
- 실행은 `done`/`verified`(종료 0)로 끝나고, `protectedChanged`는 `[]`이다.

명령을 허용하지 않은 정책에서 파일 도구만으로 일어났다. 즉 보호된 검증의 입력을 모델이 바꿔 통과시켰다.

### 재현

```
node .codaryn\m-review\e2e.mjs
```

출력의 `childJunction` 항목을 본다. 모듈만으로 재현하려면 `node .codaryn\m-review\integrity-probe.mjs`의 `child-junction` 항목(`changed=[]`)을 본다.

### 우회책 확인

링크 경로 자체를 보호 항목으로 적으면 막힌다(`protectedPaths: ["tests", "tests/fixtures"]`).

- 목록: 항목이 링크이면 따라가므로 `tests/fixtures/data.txt`가 바뀐 것으로 나온다(확인).
- 정책: T-13에 따라 그 실경로 `shared`도 보호된다.

### 적용 범위

- 기준 시점에 보호 경로 아래에 링크가 이미 있어야 한다.
- Codaryn 저장소에는 추적되는 링크가 없다(`git ls-files -s`에 mode 120000이 없음).
- 이 worktree의 `node_modules`에도 링크가 0개다.
- 따라서 현재의 Codaryn 자기 개발에는 바로 해당하지 않는다. 고정 자료를 링크로 두는 다른 저장소에는 해당한다.
- 실행 중 명령이 새 링크를 만드는 경우는 새 항목이 생기므로 탐지된다.

### 권고 (택1 이상)

1. 보호 항목 아래 링크의 실경로가 어느 보호 항목에도 들지 않으면 그 링크를 `unchecked`로 둔다. 그러면 실행 시작에서 멈춘다(fail closed).
2. 또는 하위 링크를 따라가 내용을 해시한다. 순환과 상한 처리가 필요하다.
3. 문서와 `doctor`에 "링크는 따로 보호 항목으로 적어야 한다"를 적거나 경고한다.

계약 변경이 필요하므로 PM 판단 사항이다.

## M-2 중간: 후보 틀의 `integrity.paths`가 비어 있어, 후보 코드가 작업 공간 밖의 실행 기반을 바꿔도 탐지되지 않는다

### 위치

- `scripts/new-candidate.mjs:301`(`integrity: { paths: [] }`)
- `docs/self-development.md:11, 13, 21`: 무엇을 넣을지 안내가 없다.
- 1절 표의 "실행본 … 준비 스크립트가 후보와 설정 위치를 설치 위치 밖으로 강제"는 작업 공간 위치만 다룬다. 실행본 파일 자체의 변경은 다루지 않는다.

### 깨지는 입력

틀의 검증기 `npm test`는 후보 코드(테스트가 import하는 `src`)를 사용자 권한으로 실행한다. 이를 흉내 내어, 검증기 명령(후보 코드)이 작업 공간 밖에 다음 두 가지를 썼다.

- 시험용 저장소의 공유 훅 폴더에 해당하는 `repo-git/hooks/pre-commit`. 실제 worktree에서 이 폴더는 `<저장소>/.git/hooks`로, 원래 저장소와 공유된다.
- 실행 중인 CLI 설치 위치의 `dist/src/cli/help.js`(CLI 사본)

### 결과

| 경우 | `integrity.paths` | 결과 |
| --- | --- | --- |
| 공유 훅 폴더에 씀 | 비어 있음(틀 기본) | `done`/`verified`, 종료 0. 훅 파일이 생겼다 |
| 공유 훅 폴더에 씀 | 훅 폴더를 적음 | `needs-input`/`protected_changed`, 종료 3. 바뀐 경로에 훅 파일이 나온다 |
| 설치 위치 `dist` 파일을 바꿈 | 비어 있음(틀 기본) | `done`/`verified` |
| 설치 위치 `dist` 파일을 바꿈 | `dist`를 적음 | `needs-input`/`protected_changed`, 종료 3 |

- U-3은 작업 공간 위치만 막는다. 명령이나 검증기가 실행본을 바꾸는 것은 막지 못한다.
- 공유 훅 경로의 영향(추측, 확인 안 함): 실제 worktree라면 PM이 원래 저장소에서 다음에 `git commit`을 할 때 심어진 훅이 실행된다.

### 재현

```
node .codaryn\m-review\e2e.mjs
```

출력의 `hooks_listed_*`, `install_listed_*` 항목을 본다.

### 권고

- 스크립트가 이미 아는 경로를 틀의 `integrity.paths`에 미리 채운다.
  - `repository.commonDir`의 `hooks`와 `config`
  - 설치 위치의 `dist`와 `package.json`
- 문서에는 "무결성 확인은 사후 탐지이며, 탐지 전에 심어진 훅이나 바뀐 실행본은 그대로 남는다"를 적는다.
- 사용자 npm 설정(`~/.npmrc`, `script-shell` 등)도 같은 부류다(추측, 시험 안 함).

## M-3 낮음: `docs/self-development.md`가 main(`53eb466`)과 맞지 않는다

구현된 것을 "구현 중"으로 적은 곳이 대부분이고, 지금은 틀린 주의 문구가 하나 있다.

| 줄 | 문서 내용 | `53eb466`의 실제 |
| --- | --- | --- |
| 11, 76 | U-3 실행 시 거부가 "구현 중" | 구현되어 있다 |
| 13, 75, 92 | U-1, U-2(명령에 의한 변경 탐지)가 "구현 중" | 조립까지 연결되어 있다 |
| 31, 77 | report가 "구현 중" | 구현되어 있다 |
| 78 | doctor, 도움말, 진행 표시가 "구현 중" | 구현되어 있다 |
| 35, 71 | 스크립트가 "`claude/core-tools`에 구현, 병합 전" | 병합되어 있다 |
| 63 | "틀이 CLI 검사를 통과한다. 단 `integrity`는 제외" | 지금은 `integrity`를 포함한 틀 그대로 통과한다(내 CLI 사본의 `doctor`로 확인: `config_file` ok, `task_file` ok) |
| 65 | "현재 main의 CLI는 `integrity` 필드를 모르는 필드로 보고 `invalid_config`로 멈춘다" | 틀렸다. 필드를 받아 검사한다 |
| 29 | `--env-file`만 적었다 | V-3 결정은 `--env-file-if-exists`도 쓰지 말라고 적는 것이다. `cli-contract.md`에는 반영했지만 이 문서에는 없다 |

반대 방향, 즉 구현되지 않은 동작을 구현된 것처럼 적은 곳은 찾지 못했다.

## M-4 낮음: 대체 데이터 스트림과 빈 디렉터리는 목록에 들지 않는다

- 위치:
  - `src/verify/integrity.ts:63-87`: 기본 스트림만 읽는다.
  - `:204-206`: 디렉터리는 자기 항목이 없다. 이것은 계약대로다.
- 입력과 결과:
  - 보호 파일에 `tests/a.test.txt:hidden` 스트림을 쓰면 `changed=[]`이다.
  - 보호 디렉터리에 빈 `tests/node_modules/assert/`를 만들면 `changed=[]`이다.
- 재현: `integrity-probe.mjs`의 `ads`, `empty-dirs` 항목
- 영향(추측): 보통의 검증기는 스트림을 읽지 않고, 빈 디렉터리로 검증 결과를 바꾸는 경로는 찾지 못했다. 기록만 해 둔다.

## M-5 정보: 스크립트의 위치 검사는 끝의 점·공백 경로를 저장소 안으로 판정하지 못한다. Git이 생성을 거부해 실제 우회는 되지 않았다

- 위치: `scripts/new-candidate.mjs:142-147, 167-185`
- 입력: `--out "repo./cand-dot"`, `--out "repo /cand-sp"`
- 결과:
  - `realpathSync.native("repo.")`가 ENOENT라서 검사를 통과했다.
  - 이어서 `git worktree add`가 "could not create leading directories ... Invalid argument"로 실패했다.
  - 틀과 브랜치는 정리되었다(브랜치 목록에 `main`만 남음).
- 이 방어는 Git의 거부에 기대고 있다. 같은 계열인 `repo::$INDEX_ALLOCATION/cand`는 실경로가 풀려서 검사에서 거부된다(확인).

## M-6 정보: 알려진 한계와 오탐

- **바꿨다가 되돌리기**: 두 확인 사이에 바꿨다 되돌리면 `changed=[]`이다. 계약 15절과 문서 5절에 한계로 적혀 있다.
- **대소문자만 바꾼 이름**: 두 경로가 모두 바뀐 것으로 나온다. fail closed 쪽 오탐이다.
- **vitest 같은 도구(추측, 시험 안 함)**: 검증 중에 `node_modules/.vite` 같은 캐시를 쓰는 도구는, 틀처럼 `node_modules`를 보호하면 매번 `protected_changed`가 될 수 있다.
  - Codaryn의 `npm test`(tsc, `node --test`)에는 해당하지 않는다고 본다.
  - Codaryn `node_modules`는 673개 파일, 32 MiB로 상한(10,000개, 256 MiB) 안이다.
- **내 코드의 참고 사항**: 범위 밖이지만 함께 적는다. `doctor`는 틀의 자리표시자 모델 `<모델 ID>`를 "설정됨(ok)"으로 본다.

## 문제 없던 범위 (실험으로 확인)

무결성 목록:

| 경우 | 결과 |
| --- | --- |
| 하드 링크로 연결된 보호 안 된 경로로 내용을 바꿈 | 탐지됨(`tests/a.test.txt`) |
| 타임스탬프만 바꿈 | 변경 없음. 해시 기준이므로 내용이 같으면 정상 |
| 보호 항목 자체인 정션을 다른 내용의 대상으로 바꿈 | 탐지됨 |
| 상한 초과(작은 상한으로 시험) | 그 항목과 뒤 항목이 `unchecked`/`limit`가 되고, `compare(m, m)`이 비어 있지 않아 실행 시작에서 fail closed |
| `"."` 보호 | `.codaryn` 아래 변경은 제외되고 나머지는 정상 |
| 작업 공간 밖 경로가 사라짐 | `absent`로 탐지됨. 표시 경로는 `/` 구분 절대 경로 |
| 작업 공간 밖 경로의 내용이 바뀜 | 탐지됨 |

정션은 Node의 `lstat`에서 링크로 보고되어 따라가지 않는다(M-1의 전제).

후보 준비 스크립트:

- Git을 셸 없이 실행한다. 이름 형식이 제한되고, 경로는 `--` 뒤에 넘긴다. 명령 주입 경로를 찾지 못했다.
- 저장소 최상위에 `git.exe`(tsc.exe 사본)를 두어도 실제 Git이 실행되었다. 작업 디렉터리를 먼저 찾지 않는다.
- 기존 대상에서 멈춘다(모두 "nothing was changed"):
  - 같은 브랜치
  - 이미 있는 후보 디렉터리
  - 이미 있는 틀 파일(`wx`)
- 정션 표기(`::$INDEX_ALLOCATION`)는 실경로로 풀려 저장소 안으로 거부된다.
- 생성된 틀은 CLI 검사를 통과한다. 설정 파일 없이 실행하면 문서대로 `invalid_task`다.
- 스크립트 유닛 수 14건이 문서와 맞는다.

## 검사하지 않은 범위

- POSIX 전반: 심볼릭 링크, FIFO, 대소문자를 구분하는 파일 시스템, macOS NFD
- 경로 계열: `subst` 드라이브, 네트워크 드라이브, UNC, 8.3 짧은 이름 생성, 디렉터리별 대소문자 구분, OneDrive 자리표시자 같은 다른 reparse point
- 경합: 검사와 생성 사이, `lstat`과 `open` 사이
- 실제 `npm ci`(네트워크), vitest와 jest의 캐시 동작
- 원래 저장소의 Git 훅(`post-checkout`)과 `GIT_CONFIG_*` 환경 변수로 넣는 설정
- 실제 API 실행, 실제 자기 개발
- OS 격리. 유닛과 위 실험은 격리, 프로세스 정리, 네트워크 차단을 입증하지 않는다.
