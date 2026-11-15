# R-101 검토 — U-175의 정책 몫 (path-set, writable 판정)

- 검토자: w3:pB p5u-gui(정책 관문 소유자). 읽기 전용이다. 저장소 수정, 커밋, worktree 없음.
- 대상: `unit/U-175-p4g-general` 2bbc709, `git diff 07cd600...2bbc709 -- src/policy`(path-set.ts 새 파일, protected.ts, index.ts). 계약 쪽(`contracts/policy.ts`·`task.ts`의 `writablePathSets`·`writablePaths` 설명)은 정책과 맞는지만 봤다.
- 방법
  - 코드를 읽었다.
  - 2bbc709를 scratchpad 사본에 풀고(`git archive`, node_modules는 같은 lockfile이라 연결) 빌드해 다음을 돌렸다.
    - 정책 유닛: 66 중 65 통과·0 실패. 건너뜀 1은 POSIX 전용의 기존 대소문자 시험이다. junction 시험들은 돌았다.
    - 루트 유닛 전체: 3378 중 3373 통과·0 실패(건너뜀 4, todo 1).
  - 내 probe 두 개를 돌렸다. 사본에만 07cd600의 `protected.ts`를 `protected-legacy.ts`로 넣어 빌드했다.

## 결론

- **높음 0, 중간 0, 낮음 2, 정보 3.** 병합을 막을 것은 없다.
- 보호 경로의 판정은 바뀌지 않았다. 코드가 같은 뜻이고, 시험의 나란한 비교와 내 무작위 비교(9,000건)가 같다.
- writable 판정은 링크를 푼 뒤의 실효 경로에서만 결정한다(`checkEffective`). 글자 판정(`checkRequested`)은 writable을 보지 않는다.
- 뒤에 내가 유지할 수 있는 꼴이다. 일반화는 작다(118줄). 보호 경로는 옵션 하나(`prefix`, `covers`)로 예전 규칙이고, 예전 matcher 사본과 나란히 고정한 시험이 있다.

## 1. protectedPaths의 판정이 한 경우도 바뀌지 않았는가 — 바뀌지 않음

- 코드 대조(07cd600 protected.ts ↔ 2bbc709 path-set.ts):
  - `entryProblem`·`checkProtectedPaths`(→ `checkPathSetFormat`): 글자까지 같다. `checkProtectedPaths`는 같은 함수를 가리킨다.
  - 형식 거부 → `EVERYTHING`(`onUnusable: "covers"`), 비었거나 없음 → `NOTHING`: 같다.
  - `prefixCovers(prefix, rel)` = `prefix.length <= segments.length && every…` ↔ `entryCovers(…, "prefix")` = `entry.length > segments.length`면 거짓, 아니면 `every…`. 같다.
  - `coversEffective`: 글자 판정 먼저 → 항목마다 `workspace.resolve(entry, "read")` → `state_dir`면 건너뜀, 그 밖의 실패는 `covers`에서 참(전부 막음). 같다.
- 시험: `u175-path-set.test.ts`가 07cd600의 matcher 사본과 새 `compileProtectedPaths`를 목록 31개 × 경로 21개로 비교한다.
  - 글자·실경로를 모두 본다. 링크(안쪽, 바깥, 끊긴 것, 상태 디렉터리, 항목 아래 링크)가 들어 있다.
  - 형식 규칙도 비교한다.
- 내 probe: 무작위 목록 1,500개 × 경로 6개, 글자와 실경로(junction 넷: 안쪽, 바깥, 끊긴 것, 하위 폴더 안의 링크)에서 9,000건을 비교했다. **다름 0건**, 형식 규칙도 0건이다.
  - 섞은 입력: 대소문자, `\`, `.`, `..`, 빈 조각, 장치 이름 `con`, 숫자 항목, 절대 경로.
- 쓰는 곳: 앱 계층의 작업 공간 목록(5.12, `covers`·`coversEffective`)과 텍스트 읽기·쓰기(5.15)도 `compileProtectedPaths`의 같은 API다. 형 이름 `ProtectedPaths`는 `PathSet`의 별칭으로 남았다.

## 2. compilePathSet의 match와 쓸 수 없는 항목 — 맞음

- `match`
  - `prefix`: 항목과 그 아래(`.`은 작업 공간 전체).
  - `exact`: 항목 자체만, 아래는 아니다.
  - 내 probe: `exact` `a/b/x.txt`는 그 파일만, `a/b`는 `a/b/x.txt`를 덮지 않는다.
- 쓸 수 없는 것
  - 목록 전체가 형식 거부면 보호는 전부 덮고(`EVERYTHING`), 쓰기 허용은 아무것도 덮지 않는다(`NOTHING`).
  - 실효 판정에서 항목 하나가 바깥·끊긴 링크면 보호는 참(전부 막음), 쓰기 허용은 그 항목만 건너뛰고 다른 항목은 계속 본다.
  - 상태 디렉터리 항목은 둘 다 건너뛴다.
  - probe 확인: 바깥 링크 항목 `lo`만이면 덮지 않음, `lo`와 `c`면 `c/y.txt`를 덮음. 끊긴 링크 항목도 같다. 보호 쪽은 바깥 링크 항목이 모든 경로를 덮는다.
- 빈 목록: `[]`는 아무것도 덮지 않는다. 쓰기 허용이면 어떤 쓰기도 안 된다. 계약 "Present and empty: no file tool may write"(task.ts)와 같다. 목록 집합이 없거나 비면 한도가 없다(`writableEffective`의 반복이 돌지 않음).
- 링크 항목: 그 실경로를 덮는다. probe: `la`(→ `a`)가 `a/b/x.txt`를 덮는다.
- 아직 없는 파일: `Workspace.resolve`가 가장 깊은 기존 조상의 실경로에 나머지를 붙이므로, 링크된 부모 아래의 새 파일도 `exact`로 맞는다. probe: `la/b/new.txt` ↔ `a/b/new.txt`.

## 3. gate의 writable 판정은 링크를 푼 뒤의 실효 경로에서만 결정하는가 — 그렇다

- `checkRequested`는 보호 경로만 보고 writable은 보지 않는다. `checkEffective`에서 `workspace.resolve(value, access)`의 `outcome.path.relative`(실경로)로만 본다. 보호가 먼저(`protected_path`), 그다음 `path_not_writable`이다. 경로 하나에 거부 하나다.
- 글자 판정을 실효 경로에 쓰는 것이 맞는 까닭:
  - 실효 경로의 조각에는 링크가 없다(realpath).
  - 그래서 그 경로가 항목 글자의 아래라면 그 항목 자리는 실제 폴더이고, 글자 일치가 곧 실제 위치 일치다.
  - 일치하지 않으면 항목마다 실경로로 다시 본다.
- 관문 전체 probe(writable `["docs"]`, 보호 없음):

  | 요청 경로 | checkRequested | checkEffective |
  | --- | --- | --- |
  | `docs/a.md` | 허용 | 허용 |
  | `docs/new.md`(새 파일) | 허용 | 허용 |
  | `src/b.ts` | 허용 | `path_not_writable` |
  | `docs/tosrc/b.ts`(허용 폴더 안의 링크 → `src`) | 허용 | `path_not_writable` |
  | `docs/toout/x`(허용 폴더 안의 링크 → 작업 공간 밖) | 허용 | `outside_root` |

- 여러 목록은 교집합(모두가 덮어야 함)이다. 정책 목록은 `prefix`, 계획 파일(`source: "plan"`)은 `exact`다.

## 낮음

### L-1 계약의 "쓸 수 없는 항목" 문장이 형식 거부 때의 동작보다 좁다

- `task.ts`의 `writablePaths` 설명은 "an unusable entry covers nothing (fail closed)"이다.
- 실제로 형식 규칙이 항목 하나라도 거부하면 **목록 전체**가 아무것도 덮지 않는다(`compilePathSet` 첫 줄). 그 목록이 있는 실행은 어떤 쓰기도 안 된다.
  - path-set.ts 머리("A list it rejects is unusable as a whole")와 `PolicyGateOptions.writablePathSets`("An unusable list or entry covers nothing")는 맞게 적었다.
- 둘 다 닫는 쪽(fail closed)이라 위험은 없다. 형식은 B-4의 파서가 먼저 거부할 것이다.
- 권고: task.ts 문장을 "형식이 틀린 목록은 통째로, 실경로가 바깥이거나 끊긴 항목은 그 항목만 아무것도 덮지 않는다"로 맞춘다.

### L-2 덮지 않을 때마다 모든 항목을 실경로로 다시 푼다

- `coversEffective`는 글자 판정이 실패하면 항목마다 `workspace.resolve`(realpath)를 부른다. 매 호출이고, 기억하지 않는다.
- 보호 경로처럼 목록이 짧으면 문제없다.
- B-5의 계획 파일 목록(`exact`)은 길 수 있다. 그 목록이 덮지 않는 쓰기(거부될 쓰기)나 링크를 지나는 쓰기마다 항목 수만큼 파일 시스템 호출이 든다.
- 덮는 쓰기는 글자 판정에서 바로 끝나므로 보통 경우에는 영향이 없다.
- 권고: B-5에서 계획 파일이 많아질 때 한 호출 안에서 항목 풀이를 한 번만 하거나, 계획 목록의 크기 상한과 함께 본다. 지금 고칠 것은 아니다.

## 정보

- **I-1** writable은 파일 도구만 막는다(계약 B-8). 허용된 명령은 어디든 쓸 수 있다. 계약이 그렇게 적었고 관문은 그대로 따른다.
- **I-2** 판정과 쓰기 사이의 경쟁(검사 뒤 실행 전 링크가 생김)은 보호 경로와 같은 종류다(T-13에서 받아들인 한계). 도구의 쓰기가 경로를 다시 풀고 해시를 다시 본다.
- **I-3** 이름: 형식 규칙의 문제 형이 여전히 `ProtectedPathProblem`이고 `checkPathSetFormat`의 형도 `CheckProtectedPaths`다.
  - B-4에서 `writablePaths` 형식 오류의 사람 문구를 만들 때 보호 경로의 낱말이 그대로 나가지 않는지 본다.
  - 형 이름을 일반 이름으로 바꾸는 것은 뒤에 내가 해도 된다(계약 변경이 따름).

## 수치와 재현

- 정책 유닛(2bbc709 사본): 66 중 65 통과·0 실패, 건너뜀 1(POSIX 전용).
- 루트 유닛 전체(2bbc709 사본): 3378 중 3373 통과·0 실패(건너뜀 4, todo 1).
- probe:
  - `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\770ccfc5-b6b0-4477-a62e-c37fb87a457b\scratchpad\r101\probe.mjs`: 무작위 9,000건, 다름 0, 허용 목록 규칙 9개.
  - `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\770ccfc5-b6b0-4477-a62e-c37fb87a457b\scratchpad\r101\probe2.mjs`: 끊긴 항목과 관문 전체 다섯 경로.
  - 사본은 같은 scratchpad의 `r101\board`이고, `protected-legacy.ts`는 사본에만 넣었다.
- probe의 `danglingPassedOver` 첫 줄(`lg/x`를 실효 경로로 넘김)은 관문이 넘기지 않는 입력이라 잘못 짠 확인이었다. 끊긴 링크를 지나는 경로는 `resolve`가 `outside_root`로 막는다. probe2에서 실제 실효 경로로 다시 확인했다(참).
