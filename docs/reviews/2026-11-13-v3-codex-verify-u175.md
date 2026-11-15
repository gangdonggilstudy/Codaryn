# V-3 독립 보안 검증 — U-175

- 검증자: codex-review, 보안·개인정보 검토자.
- 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify` (detached HEAD). 검토 브랜치: `unit/U-175-p4g-general`.
- 비교: `07cd6002bebb8530505d1da4134143e464f88d5e` → `d16529d4442fb5ec9bbb98f389674b3158ef2c21`.
- 근거: DR-69, `docs/reviews/2026-11-13-p1-bundle-proposal.md` 4절 B-2·B-4·B-5.
- 실행 환경: Windows, Node `v26.13.1`. 아래 경로는 이 보고서가 있는 `.codaryn` 기준.
- 높음 **0건**, 중간 **1건**, 낮음 **0건**. 중간 1건은 외부 파일시스템 실패 주입으로 재현한 허용 목록의 실패 시 차단 누락이다. 실제 OS 권한 설정이나 동시 변경을 이용한 공격 성공으로 집계하지 않았다.

## 중간 1 — 허용 목록의 문자열 일치가 항목의 실경로 확인을 생략함

- 위치: 후보 `src/policy/path-set.ts:103`, 호출부 `src/policy/index.ts:243`.
- `coversEffective`가 `covers(relative)`에 일치하면 즉시 `true`를 반환한다. 따라서 항목의 `workspace.resolve(entry, "read")`와 실패 처리에 도달하지 않는다. 쓰기 대상은 실경로로 해석하지만, 허용 항목은 해석에 실패하는 항목이어도 문자열이 같으면 허용한다.
- 재현 명령: 실험 폴더에서 `node ./probe.mjs`. 결과 원문: `codex-review-v3-d16529d/results.json`의 `faults`.
- 재현 1: 실제 임시 파일 `a/x.txt`, 허용 목록 `[{source:"config",entries:["a"]}]`. 외부 `FileLayer.realpath`만 대체하여 `a`에서 `EACCES`, `a/x.txt`에서는 실제 파일시스템 결과를 반환한다. 실제 `Workspace`와 gate는 그대로 실행한다.
- 재현 2: 허용 목록 `[{source:"plan",entries:["a/x.txt"]}]`. 대상 해석은 성공시키고 그 뒤 항목의 재해석에서 `EACCES`가 나도록 외부 경계의 상태를 바꾼다. 정확 일치 판정도 같은 지점을 통과한다.

| 재현 | 항목 단독 resolve | gate 중 항목 재해석 | gate 결과 | 직접 matcher 결과 | 요구되는 결과 |
| --- | --- | ---: | --- | --- | --- |
| config 접두사 | `ok:false, invalid_path` | 0회 | `allowed:true` | `true` | `path_not_writable` / `false` |
| plan 정확 일치 | `ok:false, invalid_path` | 0회 | `allowed:true` | `true` | `path_not_writable` / `false` |

- 일반 정션 사례에서는 범위 밖 쓰기 허용을 재현하지 못했다. 위 2건은 실패 주입 재현이며, 정상 파일시스템에서의 임의 경로 쓰기 성공 2건을 뜻하지 않는다.

## 보호 경로 비교 수치

각 커밋을 별도로 컴파일하고 각 판의 실제 `compileProtectedPaths`, `checkProtectedPaths`, gate, Workspace를 불러 동일 입력으로 비교했다. 기존 구현을 검증 코드에 복사하지 않았다.

| 비교 | 건수 | 두 판의 차이 |
| --- | ---: | ---: |
| 목록 형식 | 46 | 0 |
| 문자열 보호 판정 | 1,840 | 0 |
| 실제 해석에 성공한 경로의 보호 판정 | 1,058 | 0 |
| 요청 단계 gate | 1,840 | 0 |
| 실효 단계 gate | 1,840 | 0 |
| Workspace 해석 결과 | 1,840 | 0 |
| 8.3 확장 모의 경계의 보호 gate | 12 | 0 |

- 입력: 46개 목록 × 40개 경로. 대소문자, `a`/`ab`, 끝 점·공백, 빈 목록·항목, 잘못된 형식, 장치명·ADS·상위 경로, 상태 디렉터리, 없는 경로 포함.
- 실제 정션 5개: 내부 대상, 허용 디렉터리 아래에서 다른 디렉터리로 향하는 대상, 상태 디렉터리, 작업공간 밖 대상, 끊어진 대상.
- **실제 8.3 별칭 검증은 미완료**: 새 폴더의 `Scripting.FileSystemObject.GetFolder(...).ShortPath`가 긴 이름 그대로를 반환했다. `PROTEC~1`은 실제 별칭으로 생성되지 않았다. 별칭 확장 12건은 `FileLayer.realpath` 경계만 모의한 결과이며 실제 별칭 시험과 구분한다.
- 유한 입력의 차이 0건이다. 모든 가능한 경로와 파일시스템 상태의 동등성을 실행 시험으로 증명한 것은 아니다.

## writable·workflow·기존 시험 수치

| 검사 | 결과 |
| --- | --- |
| 실제 파일시스템 writable 사례 | 50/50 기대 결과 일치 |
| 8.3 확장 모의 writable 사례 | 4/4 기대 결과 일치 |
| 허용 항목 해석 실패 주입 | 2/2 잘못된 허용 재현; 같은 원인 1건 |
| 사용자 정의 workflow 조합 | 24/24 기대 결과 일치 |
| 후보의 기존 관련 유닛 시험 | 총 57, 통과 55, 실패 0, 건너뜀 2 |
| 두 사본 TypeScript 컴파일 | 2/2 종료 코드 0 |

- writable 50건에는 허용 목록 부재/목록 수 0(제약 없음), 존재하는 빈 항목 목록(쓰기 거부), 잘못된 목록, `a`/`ab`, 교집합, 내부·외부·끊어진 정션, 상태 디렉터리, 정확 일치 계획·형제·하위 경로, 보호 경로 우선 판정을 포함한다.
- workflow 24건: 정의 `none/run/apply` × 정의 선택 경로 `task/profile` × task plan `생략/none/run/apply`. 사용자 정의 `run/apply → none` 4건 모두 `plan_weakened`. 정의를 선택한 뒤 task의 `plan` 필드를 덮는 범위만 시험했다.
- 기존 시험의 건너뜀 2건: Windows의 대소문자 구분 시험 1, 실제 8.3 별칭 미생성 1. 원문은 `codex-review-v3-d16529d/unit-tests.tap`.

## 실행 명령·산출물

관리 저장소 `D:/project/Codaryn`에서:

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 07cd600...d16529d -- src/policy/path-set.ts src/policy/protected.ts src/policy/index.ts src/workflows/index.ts
git archive --format=zip --output="$v3root\base.zip" 07cd600
git archive --format=zip --output="$v3root\candidate.zip" d16529d
Expand-Archive -LiteralPath "$v3root\base.zip" -DestinationPath "$v3root\base"
Expand-Archive -LiteralPath "$v3root\candidate.zip" -DestinationPath "$v3root\candidate"
```

`$v3root = D:\project\Codaryn\.worktrees\codex-verify\.codaryn\codex-review-v3-d16529d`. 이 새 폴더의 `base`, `candidate` 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더 `$v3root`에서:

```powershell
node ./probe.mjs
node ./run-tests.mjs
```

- `run-tests.mjs`: TEMP/TMP를 새 실험 하위 폴더로 한정하고, `guard.mjs`로 재귀 정리 대상의 절대·실효 경로가 실험 폴더 내부인지 검사한 뒤 6개 시험 파일을 실행한다. 실행 인자는 래퍼 출력과 파일에 남겼다.
- 시험 파일: `policy/protected-paths`, `policy/u175-path-set`, `policy/u175-writable-gate`, `cli/g-workflows`, `cli/g-u175-plan-weakened-run`, `contracts/g-u170-writable-paths`.
- 준비 중 검증 스크립트 오류: 짧은 경로 조회 인용 오류 1회, `--import`의 Windows 경로 URL 오류 1회. 검증 스크립트만 고친 뒤 위 최종 수치를 얻었다. 제품 실패 건수에 포함하지 않았다.
- 제품·저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0. 시작·종료 `git status --short` 변경 출력 0. Git 전역 ignore 읽기 권한 경고가 있었으나 권한 요청은 하지 않았다.
- 실제 API 호출 0, 외부 네트워크 호출 0, 키 파일 조회 0. 보존 산출물은 새 실험 폴더와 이 보고서뿐이다.
