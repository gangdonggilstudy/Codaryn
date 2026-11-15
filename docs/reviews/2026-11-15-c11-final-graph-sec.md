# C11 final GRAPH v2 — BLOCKED: selftest cwd 의존

codex-sec, 아키텍처·compiler graph 검증 엔지니어/보안 경계 검토자. **최종 실제 source union/runtime CLI 두 게이트는 모두0이나, 요청된 새 selftest30/147 요건을 충족하지 못했다. 전체 작업 상태는 BLOCKED_SELFTEST_CWD_DEPENDENCY다. C11 완료를 선언하지 않는다.**

신규 제품 그래프 finding은 **H0/M0/L0**이다. 별도로 **검증 배치 M1** 하나를 보고한다: 원본 selftest의 cwd 상대 typeRoots와 이번 중첩 A 경로가 맞지 않아 첫 사례에서 중단됐다. 이를 제품 CLI 의존 발견이나 성공한 selftest로 바꾸어 기록하지 않는다. 수정/재시도 없이 원본 실패·진단·입력을 보존했다.

## 정확한 판·역할·경계

- Assignment: c11-final-graph-sec-01. 실제 task SHA256 `0e2919593fb5708eec3284cff52d947761b1192d271e503b25af3a31ca396adb` 일치, canonical main script STARTED exit0.
- 정확한 checked target/main/origin: `37fb966abe088a666cb33ce533f484a5b06b5957`
- 정확한 tree: `f1be8b6ef2b5a825354f1d370a786f69f242823f`
- 이미 전체 검사한 비교 판: `881533de4b66d9ab3e1497cf22c7043c7b398504`, tree `0e7da89ab9a5b2dd392017617b70c4c179648aa1`
- 역사적 graph OLD: `280d148eadca1cc9b404c7b7c5bfa84b99a4ad73`. OLD source61/955/CLI12/unknown0/exit1, runtime61/549/CLI12/unknown0/exit1은 READ된 부정 대조군이며 최종 성공 판이 아니다.
- tool cwd/worktree: D:/project/Codaryn/.worktrees/codex-verify. DETACHED HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 유지. 시작/종료 status 변경 출력 없음. 전역 ignore 접근 경고는 보존했고 설정을 바꾸지 않았다.
- A = `.codaryn/session-comms/c11-final-graph-sec-01/`만 새 쓰기 소유한다. 제품/main/타 WT/원본 도구·fixtures·기대·봉인·보고는 읽기 전용이다. stage/commit/push/switch/merge/worktree add/이력 재작성 없음. 직접 Herdr/Claude 배정/권한·서버·UI·한도 응답 없음. PM만 인수·완료 판단·push한다.

기존에 전체 읽은 AGENTS/personas/workflow/통신 guide가 b237→37fb에서 변하지 않았음을 추가 확인했다. 최신 CP50, tracked v2 독립 검토, frozen v2 report/provenance/checked/source, 원본 selftest와 seal 절차 및 PM U336 최종 보고를 읽었다. 복사본과 원문 지문은 read-provenance.json/inputs-read/에 있다.

## 실제 최종 CLI 결과 — selftest 결과와 구분

| 실제 CLI | roots | reachable | edges(value/type) | CLI | unknown | graph.status | 실제 exit |
| --- | ---: | ---: | --- | ---: | ---: | --- | ---: |
| **source authoritative union** | **66** | 156 | **918 (522/396)** | **0** | **0** | zero-within-model | **0** |
| **fresh production runtime** | **66** | 154 | **522 (522/0)** | **0** | **0** | zero-within-model | **0** |

실제 positional CLI를 원본 ABS_V2/graph.mjs에 넘겼다. analyze 함수만 호출한 wrapper 결과로 대신하지 않았다. 각 graph 자체의 실제 종료0, graph.rootCount>0/cliReachable0/unknownCount0/status를 확인했다. valueProjection/typeProjection은 진단 자료로만 보존하며 source union을 대체하지 않는다. 별도 독립 BFS도 모든 mixed type/value edges로 같은 reachable/CLI를 계산했다.

```text
node --experimental-import-meta-resolve ABS_V2/graph.mjs ABS_A/project-source.json ABS_A/source ABS_A/source/src/app ABS_A/source/src/cli source ABS_A/source-final.json
node --experimental-import-meta-resolve ABS_V2/graph.mjs ABS_A/project-runtime.json ABS_A/source/dist ABS_A/source/dist/src/app ABS_A/source/dist/src/cli runtime ABS_A/runtime-final.json
```

정확한 exe/argv/cwd/exit/signal/기간과 원문 stdout/stderr는 command-native-graph-source/runtime.json 및 native-graph-*.stdout/stderr.log다. 출력은 exclusive 생성했고 정규화·필터·재계산으로 raw 결과를 바꾸지 않았다. source-final/runtime-final의 모든 edges/boundaries/unknown/witness를 그대로 보존한다.

## 물리 roots와 native program membership

source/runtime 각각 실제 app 디렉터리의 물리 code 파일66개가 graph roots와 **집합 완전 일치**했다. source는 type를 포함하고 runtime은 declaration-only를 제외하는 동결 도구의 같은 규칙을 사용했다. symlink/root 축소/수동 예외 목록은 없다.

- 두 native compiler project는 실제 production 파일200개를 모두 config roots로 잡았고 각 program의 source file 수는398개다. 그중 code200과 pinned dependency declarations/libs가 모두 지문으로 연결된다.
- app 물리 roots66개 각각이 native program에 있고 getSourceFile로 조회되며 graph.inputs에도 포함된다. orphan나 program membership 누락은0이다.
- source graph 실제 읽은156파일/runtime154파일의 해시를 독립 재확인했다. 각 resolved edge의 from/to가 graph input으로 존재하며 native program에도 있다. witness는 양쪽0, unknown 배열도 양쪽0이다.
- source151/runtime140개 boundary는 모든 from을 검증하고 safe node builtin terminal인지 확인했다. runtime module/vm/worker_threads capability를 지워서0을 만들지 않았다. 지원하지 않는 resolve 결과를 숨기는 필터는 없다.
- source root-set SHA256: `ceb1c480c387a465b1549e5982c4d9626a14ed3893783845b1881021e3b504d1`
- runtime root-set SHA256: `1e30337ee44efab38fef32824ebceb508d38b243fd13adac8ef6c181ec107815`

membership-source/runtime.json에는 물리 roots, 전체 native program file/input hashes, compiler root files/options, 모든 graph 입력 및 진단 투영을 남겼다. 확인 과정에서는 compiler/API만 실행했으며 감사 대상 제품/fixture 프로그램을 import/require/evaluate하지 않았다.

## M1 — 원본 selftest의 cwd 상대 Node 타입 경로

동결 selftest.mjs를 수정 없이 **한 번만** `node --experimental-import-meta-resolve ABS_V2/selftest.mjs -final`로 A cwd에서 실행했다. `selftest.mjs:39`의 `path.resolve('../codex-sec-v47-u328/source/node_modules/@types')`가 이번 A의 부모를 기준으로 다음 없는 경로를 생성했다.

```text
D:/project/Codaryn/.worktrees/codex-verify/.codaryn/session-comms/codex-sec-v47-u328/source/node_modules/@types
```

원래 고정 실제 타입 경로는 `.codaryn/codex-sec-v47-u328/source/node_modules/@types`다. 동결 graph의 module-relative API/AST imports는 올바른 고정 설치를 사용했지만, selftest 생성 config의 typeRoots는 cwd 상대라 서로 달랐다. 경로 변경·도구 패치·외부 쓰기·junction/환경 조작으로 이를 보정하지 않았다.

첫 `direct-escaped-multiline` 사례는 의도한 CLI1 witness를 찾았으나, native `compiler-project-diagnostic` **2688** 때문에 unknown1/incomplete였다. selftest의 unknown0 assertion이 실패해 실제 exit1로 중단했다. source/runtime 최종 프로젝트에는 지시된 올바른 absolute typeRoots를 명시했으며, 그 두 결과의 unknown0과 이 selftest 실패를 별도로 판정한다.

- 완료된 원본 selftest **0/30**. 첫 graph JSON은 생성됐지만 summary selftest-results-final.json은 없다. 나머지29사례를 실행하지 않았다.
- frozen 원본147입력과 대조 시 새 입력4개만 생성됐다. **3개 bytes 동일, tsconfig1개 typeRoots가 다름, 143개 미생성**이다. 원본147 전체가 같다고 주장하지 않는다.
- 실제 graph/unknown/CLI witness와 실패 stderr, 최초 생성 config를 원문 보존했다. selftest-input-comparison.json 및 fixtures-final/direct-escaped-multiline/result.json을 참조한다.
- 동결 v2 독립 검토의 원래30/30·147동일 및 추가8/8 성공은 **READ된 기존 증거**다. 이번0/30을 대신하거나 새38pass로 합산하지 않는다. frozen run/regressions/check-original30 wrappers는 실행하지 않았다.

**필요한 PM 판단:** 현재 A 밖에 쓰거나 도구/criterion을 고치지 않고는 이 cwd 의존을 해소할 수 없다. 별도 작업에서 캐시와 같은 sibling 깊이의 새 허용 selftest cwd를 지정하는 등, 원본을 무수정 실행해30/147 조건을 충족할 배치 계약이 필요하다. 현재 작업에서는 재시도하지 않았다. 이 차단을 해소하고 별도 독립 검토·PM 판단 전까지 전체 C11 완료를 기록하지 않아야 한다.

## exact archive·production fresh build·tested 판 연결

literal37fb를 git archive하여 A/source에 추출했다. Git 파일 목록과 실제 추출 파일 **1383개**가 정확히 같고 모든 항목은 regular file이었다. archive container SHA는 archive-membership.json/proof-hashes.json에 기록한다. 이는 env 파일 내용을 개별 검사/해시한 것이 아니다.

`.env.example`(755bytes), `tests/fixtures/secrets.ts`(3556bytes)는 **경로/크기/mode metadata만 확인**했으며 그 leaf의 내용·hash는 읽지 않았다. 이 두 경로는 source/hash provenance에서 의도적으로 제외했다. 컨테이너 해시와 비밀형 파일 content inspection을 구분한다.

production 입력은 src200 + package.json/lock/tsconfig3 = **203개**다. 각각 raw Git blob와 archive bytes를 reversible CRLF 비교로 연결했다. source/input 원문이나 graph 결과를 다시 쓰거나 정규화하지 않았다. production-input-pins.json에 raw Git/아카이브 각각의 size/SHA256과 Git blob이 있다.

tested881533→actual37fb 차이는 `docs/pm-status.md`, `docs/reviews/2026-11-15-v55-codex-verify-u336.md` 두 문서뿐이다. 모든 tracked 제품/빌드/기존 시험/GUI/패키지 입력은 이 비교에서 바뀌지 않았다. PM의 이미 실행한 전체 검사를 불필요하게 다시 돌리지 않았다.

source/dist가 **없음**을 확인한 후 pinned native tsc.exe `-p ABS_A/project-source.json`로 production만 새로 빌드했다. 첫 build exit0. 결과는 **400파일 = JS200 + map200**, dist/src 밖의 test 출력은0이다. 각 source map이 실제203입력 중 대응 source200으로 해석되고 그 입력 hash와 맞는지 확인했다(fresh-output-origins.json). prior dist/test 산출물을 runtime 입력으로 받아들이지 않았다.

project-source.json은 actual source/tsconfig.json을 extends하고 types/node 및 알려진 absolute typeRoots, production src include/exclude만 명시했다. project-runtime.json은 같은 actual tsconfig에 allowJs:true/checkJs:false/noEmit:true와 같은 types/typeRoots 및 fresh dist/src JS만 명시했다. 원래 module/path/alias/target 옵션은 보존했다. actual tsconfig에는 추가 extends/references가 없으며 전체 config chain/hash와 native 해석 옵션은 config-chain.json과 membership files에 있다.

## 동결 도구·compiler·의존 provenance

| 고정 대상 | SHA256 |
| --- | --- |
| v2 graph.mjs | `cf2dfa5cf7933aec7424cc246569cfe7ba6755d2ce29af8c98f8b58f13702d8a` |
| 원본 selftest.mjs | `e9f582289e21ae4bf762e003907bdf82e1baa9f14a07094a4593a1277e035049` |
| v2 seal.json | `2d21578ce855fdaf2847052c27c14434dd8aadb102a4314c291755bfc1d8422c` |
| TS native tsc.exe | `f9ecfbdc93753d2c972d66a8d0d75f5bd737fd4a5f88b422d9091ea282bcb2c7` |
| TS compiler launcher | `2219f428a7e55aaf1f7ad85b9b0f0cf5078aeb76ccc9a7c6036c92d48f492ffd` |

TypeScript7.0.2/Node26.13.1 win32/x64를 확인했다. provenance.json의 tool7개와 dependency5개(package/API/AST/Node-types/native exe) literal hashes 전부를 확인했다. actual pinned node_modules 전체 **673파일**도 before/after bytes/SHA256으로 동일했다. complete tree 안의 모든 native program dependency input이 이 pin에 연결된다. compiler package/launcher 및 Node executable의 지문도 따로 보존했다.

v1 **1282파일**, v2 **889파일** seal 검사는 전후 각각 exit0·동일이었다. 원래 seal/도구/fixtures/기준/실패를 수정하거나 재봉인하지 않았다. V1 M1을 닫은 builtin resolve→module/vm/worker_threads fail-incomplete 수정과 추가8회귀는 독립 review/원본 checked로 READ했다. 임의 alias를 허용하거나 unknown을 무시하는 변경은 없다.

정적 OS/Node/Git 경로와 A/private의 TEMP/HOME 및 자체 빈 npm user/global config만 child에 전달했다. private은 candidate installation A/source 바깥이다. host 환경/key/config dump·실제 API·모델·의존 설치·외부 시험망 없음. 로컬 native compiler service와 Node resolver만 실행하며 감사 대상 프로그램을 실행하지 않았다. OS 전체 syscall sandbox를 제공했다는 주장은 하지 않는다.

## 실패 이력·READ 결과·한계

자체 준비 읽기에서 존재하지 않는 V1/provenance.json을 한 번 조회했다. V1 실제 파일명 resolver-provenance.json을 확인해 읽었고, authoritative V2/provenance는 처음부터 존재하며 모두 검증했다. 해당 PathNotFound와 selftest exit1/2688을 preparation-history.json에 구분했다. 새 build와 실제 두 final CLI는 각각 첫 실행 exit0이다. final-proof 수집기의 exit0은 BLOCKED selftest를 통과로 바꾸는 판정이 아니다.

PM U336 exact881533의 offlineci/type/build/secrets0, unit4328/4317pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO, GUI426,smoke227,CLI95차이0은 별도로 **READ**했다. 이번 fresh graph/build 실행 수치와 합산하지 않는다. V55 namespace const 수정, EOF separator·worker/PM 준비 오류 및 이전 v2 CJS assumption 실패도 원문 보존된 이력으로 읽었고 성공으로 덮지 않았다.

U333 최초 u22 원인 미확정, U321의 부모 교체/마지막 검사 뒤 hard-link 경쟁, JSON historical narrow-pin 추출 scope, 실제 API/model self-development·다른 OS/실제TTY 미검증은 남는다. 현재 두 graph의0은 이 항목을 고치지 않는다. 임의 반사/함수 전달/global monkeypatch/custom loader·다른 resolver 조건·링크 교체/경합·모든 동적 실행의 보편적 보안 증명도 아니다. 검사한 OS/Node/compiler와 동결 AST/native resolver 모델의 한정 결과다.

checked.json은 exact checkedSHA/tree/report hash, BLOCKED 사유와 실제 두 CLI 성공 수치, proof-hashes.json 체인을 담는다. ready.json은 별도 canonical 통신 envelope로 유지한다. PM이 원문/SHA를 읽어 ACK하고 별도 검토·배치 결정을 내려야 한다. **작업 결과 제출 READY는 아키텍처 승인/전체 C11 완료/제품 채택이 아니다. READY 후 모든 명령 정지.**
