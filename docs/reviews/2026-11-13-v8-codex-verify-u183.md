# V-8 정확성 검증 — U-183

- 검증자: codex-review, 보안·정확성 검토자. 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 기준: main `21107dc91d9522efbbb694f4da1bf79ffa1495d5`. 후보: `unit/U-183-p5a-adapter`, `ba7cec7d1dcdf36eafe150c85d8f90a424248b3c`.
- 요청한 diff: `git diff 21107dc...ba7cec7 -- src/app`. 두 커밋의 merge-base는 `47cf5127a5e4ddae41c7287f73fd25e4e3f4095e`다. 실행 대조는 별도로 archive한 `21107dc`, `ba7cec7` 사본을 사용했다.
- 환경: Windows, Node `v26.13.1`. 실험·결과: 이 보고서 옆 `codex-review-v8-ba7cec7`.
- **높음 0 / 중간 1 / 낮음 0. 요청된 문자열 비교에서는 넓히기 누락 0건. 중간 1건은 문서가 명시한 실경로 미해석 제약으로 실제 허용 범위 확장을 놓치는 사례이며, 현재 설정 저장 경로에서 실행 가능한 확인 우회로 집계하지 않았다.**

## M-1 중간 — 정션 아래로 접두사를 좁혀도 실제로는 새 쓰기 범위를 열 수 있음

- 위치: 후보 `src/app/settings-change.ts:128`, `:131`. `covered.covers(asRelative(entry))`는 글자 기준 포함만 판단한다.
- 재현 명령: 실험 폴더에서 `node ./probe.mjs`. 결과: `results.json`의 `junctions`.
  1. 새 실험 작업공간에 실제 디렉터리 `a`, `c`와 파일 `c/target.txt`를 만든다.
  2. 실제 Windows 정션 `a/b → c`를 만든다. 동시 변경이나 실패 주입은 없다.
  3. writablePaths를 `["a"]`에서 `["a/b"]`로 변경한다.
  4. 두 목록을 후보의 실제 정책 gate에 넣어 `c/target.txt` 쓰기 허용을 비교하고, 후보의 실제 `wideningOf`로 설정 변경을 판정한다. 파일 내용 자체를 쓰는 도구 실행은 하지 않는다.

| 목록 원천 | 변경 전 gate | 변경 후 gate | wideningOf 결과 |
| --- | --- | --- | --- |
| 최상위 설정 | `path_not_writable` | `allowed:true` | **`[]`** |
| 프로필 | `path_not_writable` | `allowed:true` | `profile_changed`만 |
| 작업 종류 정의 | `path_not_writable` | `allowed:true` | `workflow_changed`만 |

- 3/3 원천에서 writable 전용 넓히기 이유가 빠졌다. 최상위 설정 1건은 넓히기 이유 전체가 비어 있다. 프로필·정의는 기존 일반 변경 이유가 남으므로 이 두 경우를 확인 요구 전체의 누락이라고 보고하지 않는다.
- 이는 `docs/design/adapter-contract.md:557`과 함수 주석의 “링크의 실경로는 풀지 않는다”라는 **명시된 설계 제약을 재현한 것**이다. 문서의 문자열 전용 계약을 어긴 새 구현 오류와 구분한다.
- 현재 판의 `parseConfig`에 필드를 넣으면 최상위·프로필·정의 **3/3 거부**했다. 필드 없는 동일 설정은 통과했다. 따라서 실제 설정 저장의 확인 우회는 이 판에서 재현하지 않았으며, B-4의 필드 수용 이후 영향은 별도 검증이 필요하다.

## 문자열 판정·원천별 비교 수치

제품의 경로 matcher를 기대값 계산에 사용하지 않았다. 별도 Windows `path.resolve`·`path.relative` 포함 관계로 기대값을 계산하고, 목록 제거는 요청된 규칙대로 항상 `writable_paths_unlimited`로 비교했다.

| 검사 | 건수 | 결과 |
| --- | ---: | --- |
| 목록 48종 × 이전/이후 × 원천 3종 | 6,912 | 넓히기 누락 0, 과잉 판정 0, kind·field·index 불일치 0 |
| 원천 3개의 이전/이후 상태 혼합 | 4,096개 설정 쌍 | 원천별 비교 12,288건, 불일치 0 |
| 이름 붙인 경계 사례 10종 × 원천 3종 | 30 | 아래 표와 일치 |
| 프로필·정의 추가/제거/정책 제거 | 6 | 일반 변경 이유 보존; 정책 제거 시 unlimited 포함 |
| 실제 정션의 gate 대조 | 3 | 위 M-1 재현 |
| 현재 파서의 필드 수용 대조 | 4 | 필드 없음 1 통과, 필드 있음 3 거부 |
| 두 사본 TypeScript 컴파일 | 2 | 2 통과 |
| 관련 유닛 시험 | 18 | 통과 18, 실패 0, 건너뜀 0 |

- 혼합 비교의 각 원천 상태는 `목록 없음`, `[]`, `["a"]`, `["ab"]`다. 한 원천을 넓히고 다른 원천을 좁히거나 비워도 넓힌 원천의 이유를 생략하지 않았다. 같은 변경을 설정·프로필·정의에 동시에 넣어도 세 field를 따로 보고했다.
- 기준 판은 6,912건 중 writable 전용 이유가 필요한 4,506건에서 해당 이유를 내지 않았고, 후보는 모두 보고했다. 이 수치는 **전용 이유 비교**이며, 기준 판의 profile_changed/workflow_changed까지 없었다는 뜻은 아니다.

| 변경 | 세 원천의 writable 전용 결과 |
| --- | --- |
| `[a,c] → [c,a]` 순서만 변경 | 없음 |
| `[a] → [A]`, `[a] → [a/]`, 역슬래시·중복 구분자·`./` 변형 | 없음(Windows 기준) |
| `[a] → [a/b,c]` | **새 항목 `[1]`의 writable_path_added** |
| `[a] → [a/b,a/c]` | 없음 |
| `[a] → [ab]` | 항목 `[0]`의 writable_path_added |
| `[a/b] → [a]`, `[a] → [.]` | 항목 `[0]`의 writable_path_added |
| 목록 없음 → `[]` 또는 항목 목록 | 없음 |
| `[]` → 목록 없음 | **목록 field의 writable_paths_unlimited** |
| `[]` → `[a]` | 항목 `[0]`의 writable_path_added |
| `[a]` → `[]`, 항목 제거 | 없음 |

- `없음`은 writable 전용 이유가 없다는 뜻이다. 프로필·정의는 순서만 바꾸거나 좁혀도 기존 `profile_changed`·`workflow_changed`가 별도로 남는다. 최상위 설정의 같은 좁히기·동등 변경은 전체 결과가 빈 목록이었다.
- 일반 프로필·정의 전체를 제거하는 경우에는 일반 변경 이유가 남는다. 기존 객체의 정책만 제거하면 해당 원천의 writable_paths_unlimited도 나온다.
- 비-Windows의 대소문자 구분·역슬래시 동작은 실제 실행하지 않았다. 유한 입력 시험이며 모든 파일시스템 상태를 증명하지 않는다.
- 설정 파일을 실제로 저장하는 V-8 통합 흐름은 미실행했다. 이 판의 파서가 writablePaths를 거부하므로 판정 함수 직접 호출과 실제 gate 호출을 구분했다. 키·실제 API는 사용하지 않았다.

## 실행 명령·산출물

관리 저장소에서:

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 21107dc...ba7cec7 -- src/app
git archive --format=tar --output="$v8root\base.tar" 21107dc
tar -xf "$v8root\base.tar" -C "$v8root\base"
git archive --format=tar --output="$v8root\candidate.tar" ba7cec7
tar -xf "$v8root\candidate.tar" -C "$v8root\candidate"
```

`$v8root = D:\project\Codaryn\.worktrees\codex-verify\.codaryn\codex-review-v8-ba7cec7`은 새 실험 폴더다. `base`, `candidate` 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더에서:

```powershell
node ./probe.mjs
node ./probe.mjs > ./probe-output.json
node ./run-tests.mjs
```

- probe 두 번째 실행은 검증 스크립트의 workflow gate 원천명을 계약 값 `definition`으로 바로잡은 뒤 실행했다. 최종 결과는 `results.json`; 6,912건·4,096쌍·정션 3건 결과는 동일했다. 제품 파일은 고치지 않았다.
- 시험 래퍼의 실제 명령: `node --test --test-reporter=tap dist/tests/unit/app/u183-writable-widening.test.js dist/tests/unit/app/settings-widening-precision.test.js dist/tests/unit/app/u117-profile-confirm-widening.test.js`.
- 시험 파일 **3개**, 시험 **18건**, suite **5개**, 측정 **155.5243 ms**. 원문: `unit-tests.tap`. 전체 시험 묶음은 실행하지 않았다.
- 시작·종료 관리 저장소 상태 변경 출력 0. 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 외부 네트워크 0, 키 조회 0, 권한 요청 0. 새 실험 폴더와 이 보고서만 작성했다.
