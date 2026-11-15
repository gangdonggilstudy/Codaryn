# V-12b U-197 계약 재확인

- 담당: codex-check, 보안·개인정보 검토자.
- **높음 0건 / 중간 0건 / 낮음 0건. V-12 중간 2건과 R-102 M-1은 계약 범위에서 닫힘.**
- 검증 판: `54240524c7b6bf15016f0e6daa4d28c44102535d` (`pm/unit-A13`).
- 계약 수정 판 `f517d6811c793a3f7d0f3c51f61119d8c76f2b8c`가 검증 판의 조상임을 확인(`git merge-base --is-ancestor` 종료 0).
- archive 사본: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-v12b-u197-1794559938113/head`.
- AGENTS.md와 지정 R-102 보고서를 읽었다. 저장소 소스 수정·커밋·푸시·worktree 추가, 실제 API·네트워크·키 조회·권한 요청 없음. 관련 계약 시험만 실행.

## 재현과 판정

### V-12 M-1: k 하한 — 닫힘

- 근거: `src/contracts/query.ts:37`, `:45`; `src/contracts/task.ts:220`. 범위가 **정수 5~1000**이며 설정도 예외가 아니다. 계산은 기본값 5와 하한 5를 항상 포함한 최댓값이다.
- 네 원천(설정·프로필·정의·task)에 각각 `undefined,-100,-1,0,1,2,3,4,4.9,5,6,10,1000`을 넣은 **28,561조합**: 5 미만 결과 **0건**, 입력된 더 큰 값보다 낮은 결과 **0건**.
- 유효 정수 **5~1000 전체**를 네 원천에 하나씩 놓은 **3,984사례**: 해당 값 보존 **3,984/3,984**.
- 종전 재현 `effectiveMinGroupSize(2, [])`는 이제 **5**. 2행 묶음은 `groups:[], suppressedGroups:1`; describe의 rows·nonEmpty·numeric은 모두 null.
- 읽기 제외 밖 표의 k=1은 기존 계약상 예외다. 이번 하한 판정은 읽기 제외 표의 실효 k에 대한 것이다. 파서의 정수·유한수·범위 검사는 후속 A-6이며, 임의 JavaScript 값까지 검증하는 파서 시험은 하지 않았다.

### V-12 M-2: 커서 — 닫힘

- 근거: `src/contracts/query.ts:101`, `:108`, `:111`, `:116`, `:143`.
- next/after의 유일한 표현을 **g + 공개 묶음 목록의 0부터 시작하는 순번**으로 정했다. 숨긴 묶음을 세지 않으며 키·열 값·행에서 읽은 값을 포함하지 않는다고 명시했다. 숫자 칸 값을 순번으로 대신 쓰는 것도 이 계약에 어긋난다.
- 순번 **0~10000의 10,001사례**와 표현 경계 **999999999 1사례**: 생성·해석 왕복 **10,002/10,002**.
- 종전 카나리 `ONE_ROW_V12_CANARY`, 묶음 키 `North`, JSON 행, 키를 붙인 커서, 음수·소수·선행 0·공백·NUL·길이 초과 등 **17개**: 해석 결과 모두 null.
- 끝의 LF·CR·U+2028·U+2029·CRLF를 붙인 **5개**: 모두 null.
- next의 TypeScript 타입은 여전히 string이지만, 이제 허용 형식과 값의 출처가 명시돼 있다. 기존 고정 계약 시험도 next=null 대신 `queryCursorOf(200)`을 검사한다. 실제 페이지 생성기는 아직 없으므로 생성기가 공개 묶음 순번을 사용하는지는 후속 도구 구현에서 확인해야 한다.

### R-102 M-1: 실효 값의 자리·소비자 — 닫힘

- 근거: `src/contracts/task.ts:96`의 `ResolvedTaskSpec.unreadablePaths`와 `:106`의 `ResolvedTaskSpec.minGroupSize`; `src/contracts/policy.ts:188`; `src/contracts/workflow.ts:149`; `src/contracts/query.ts:273`.
- CLI·앱이 **설정 파일 자체·적용 프로필·정의·task 각각**에서 값을 모아 해석된 필드를 채우도록 명시했다. 관문·목록 도구·query_table이 읽을 자리도 명시했다. query_table은 한 원천인 policy.minGroupSize를 읽지 않는다.
- `unreadablePathsOf`로 네 원천에 없음·빈 목록·고유 경로·고유+공통 경로를 조합한 **256사례**: 합집합 항목 누락 **0건**. 해석된 목록을 PolicyGateOptions의 필드에 전달하는 형 검사도 통과했다.
- 원래 재현: 설정 k=10 + task k=2 → 실효 k **10**; 설정 없음 + task k=2 → **5**. 설정·프로필·task 경로는 **3개 모두 보존**.
- mergeWorkflowPolicy는 두 정책이 있을 때 k를 합치지 않는다. 한쪽만 있으면 원래 정책을 반환하므로 policy.minGroupSize=2가 남을 수 있지만, 주석은 이것이 실효 값이 아니며 실행이 해석된 필드를 읽어야 한다고 구분한다. 이 남은 원천값을 k 하한 우회로 세지 않았다.
- 지정 판의 관문은 별도로 받은 실효 목록에 config의 목록도 더한다(`src/policy/index.ts:150`): 추가 보호만 가능하다. 도구 실행기의 unreadablePaths 옵션도 해석된 목록을 받는다고 명시돼 있다(`src/tools/index.ts:120`).
- **A-6의 실제 CLI·앱 수집·전달 연결은 아직 미구현이며, 이번에는 계약의 자리·소유자·소비자 확정을 검증했다. 실제 task 실행의 완성을 주장하지 않는다.**

여러 질의의 차로 추론하는 한계는 Q-8대로 건수에서 제외했다.

## 돌린 명령과 수치

```powershell
git diff 4adad57 f517d6811c793a3f7d0f3c51f61119d8c76f2b8c -- src/contracts
git merge-base --is-ancestor f517d6811c793a3f7d0f3c51f61119d8c76f2b8c 54240524c7b6bf15016f0e6daa4d28c44102535d
git diff f517d6811c793a3f7d0f3c51f61119d8c76f2b8c 54240524c7b6bf15016f0e6daa4d28c44102535d -- src/contracts/query.ts src/contracts/task.ts src/contracts/workflow.ts src/contracts/policy.ts
git archive --format=tar --output=<사본 루트>/head.tar 54240524c7b6bf15016f0e6daa4d28c44102535d
tar -xf <사본 루트>/head.tar -C <사본 루트>/head
```

head에서 빌드 및 관련 계약 시험:

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
node --test --test-timeout=30000 dist/tests/unit/contracts/g-u197-bundle-a-contract.test.js dist/tests/unit/contracts/g-u203-unreadable-helpers.test.js dist/tests/unit/contracts/g-u143-tool-schema-subset.test.js dist/tests/unit/contracts/g-u175-denial-code.test.js dist/tests/unit/contracts/g-workflow-policy-merge.test.js dist/tests/unit/contracts/g-u170-writable-paths.test.js
```

- 빌드: 종료 **0**, 의존성 설치 없음.
- 관련 계약 시험: **43 test / 12 suite / 통과 43 / 실패·취소·건너뜀·todo 0 / 116.3073ms / 종료 0**.

사본 루트에서 독립 계약 재현:

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --module NodeNext --target ES2024 --strict --skipLibCheck --types node probe-v12b.mts
node --test --test-timeout=30000 probe-v12b.mts
```

- 독립 형 검사: 종료 **0**.
- 독립 재현: **8 test / 통과 8 / 실패·취소·건너뜀·todo 0 / 107.2408ms / 종료 0**.
- 자료: 사본 루트의 `probe-v12b.mts`, `probe-typecheck.log`, `probe-tests.log`, `contract-tests.log`, `build.log`, `contract-fix-diff.txt`.
- 전체 시험·통합 시험·실제 query_table 실행·모델 전송은 실행하지 않았다.

