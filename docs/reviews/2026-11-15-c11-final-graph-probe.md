# C11 실제 최종 그래프 독립 확인 — PM 판단용 READY

codex-probe / 독립 compiler·architecture 검증 엔지니어. **신규 H0/M0/L0. 원본 SEC의 검증 배치 M1은 이번 명시 허용 sibling cwd에서 해소 요건을 충족했다. 전체 C11 완료·제품 채택은 선언하지 않으며 PM 판단을 기다린다.**

## 대상과 소유

- Assignment `c11-final-graph-probe-01`, task SHA256 `b7b33ec1b75d77acde2a0c05c751dfc4c496f43bb481dfaf053d4a000101b7e2` 확인, canonical STARTED exit0.
- Exact target `37fb966abe088a666cb33ce533f484a5b06b5957`, tree `f1be8b6ef2b5a825354f1d370a786f69f242823f`.
- PM 테스트 판 `881533de4b66d9ab3e1497cf22c7043c7b398504`와 차이는 pm-status와 V55 리뷰 **docs2개뿐**이다. docs 밖 모든 Git mode/blob metadata 및 production203 raw Git 입력을 별도로 대조했다.
- 기존 tool worktree `D:/project/Codaryn/.worktrees/codex-verify`, DETACHED HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 불변. 시작/종료 status 변경 없음·toplevel 일치. 최초 전역 ignore 접근 경고 외 실행 실패 없음.
- **A**: 위 worktree의 `.codaryn/session-comms/c11-final-graph-probe-01/` — 통신/증거/보고.
- **B**: 위 worktree의 `.codaryn/codex-probe-c11-final-review-01/` — 새 selftest cwd/입력/결과/그래프 출력.
- **S**: 읽기 전용 `.codaryn/session-comms/c11-final-graph-sec-01/`, **V2/V1**: 읽기 전용 `.codaryn/codex-sec-c11-graph-tool-v2/`, `.codaryn/codex-sec-c11-graph-tool/`.

AGENTS/personas/workflow·CP50·세션 통신 guide, tracked graph v2 독립 리뷰, 원래 SEC task/report/checked/proof·실패, frozen v2 source/selftest/provenance/report를 읽었다. 과거 구현10/10 채택과 실제 최종 그래프 검증, 제출 READY와 PM ACK/완료 판단을 구분한다. 역사적280d의 source/runtime CLI12·exit1은 부정 대조군이며 최종 통과 판이 아니다.

## 원래 SEC 증거 독립 검토

PM의 결론만 인용하지 않고 **89 proof 파일**과 report→checked→proof manifest→receipt의 해시 체인을 직접 확인했다. 원래 report SHA는 `0235b4dd5eff073e9a144f2d94286839c72f24b795388d56f0f7d18669c5ab2d`, proof manifest SHA는 `d36e2db56047634fbe1ac0645eb8838befb9b6e0808df2b9b4c85a2a9e12cdc2`로 일치했다.

- archive container `7009c8d77570be9a8fd70c0e1247e935a608eda3b8035b2b75599049de01f5f8`와 Git/tar/물리 멤버 **1383개** 집합·regular metadata 일치.
- **src200 + package/lock/tsconfig3 = production203**의 실제 raw Git blob을 각각 읽어 archive bytes/SHA에 연결했다. archive CRLF 확장은 메모리에서만 exact raw bytes로 역확인했고 원본·입력·결과에 쓰지 않았다.
- `.env.example`, `tests/fixtures/secrets.ts`는 **경로/크기/mode metadata만 확인**했다. leaf 내용이나 hash를 읽지 않았다. 위 container hash는 별도 컨테이너 무결성 확인이다.
- 원래 dist 부재 기록, pinned native compiler 첫 build exit0, 실제 fresh **JS200+map200=400** 전체 핀과 물리 출력 집합, 각 source map의 실제 source200 origin을 직접 확인했다. 새 제품 build나 fullsuite는 실행하지 않았다.
- 두 프로젝트의 exact config/extends chain·타입 경로를 확인했고 실제 tsconfig에는 추가 extends/references가 없다. 두 native program의 production200·전체398파일, 실제 API/AST/Node-types/native executable provenance와 **물리 전체673 dependencies**를 핀과 대조했다.

세부는 `original-state-before/after.json`, `independent-input-proof.json`, `independent-fresh-origins.json`, `independent-config-proof.json`에 있다. PM unit4328/4317pass·integration684/682pass·GUI426·smoke227·CLI95same 등은 **SEC에 보존된 PM-VALIDATION을 READ**한 결과이며 새 실행 수에 합산하지 않는다.

## 독립 roots·혼합 union·native CLI 재실행

| 실제 재실행 | roots | reachable | edges(value/type) | CLI/unknown | status / native exit |
| --- | ---: | ---: | --- | --- | --- |
| source 혼합 union | 66 | 156 | 918(522/396) | 0/0 | zero-within-model / 0 |
| fresh runtime | 66 | 154 | 522(522/0) | 0/0 | zero-within-model / 0 |

물리 **ALL app roots66**과 graph roots가 완전 일치하며 모두 native program 및 graph input에 속한다. entrypoint 축소/orphan 누락은 없다. native API를 별도로 열어 실제 config roots200·program398, graph의156/154 input hash·모든 from/to membership·구문 진단0을 확인했다. 혼합 type/value adjacency로 독립 BFS를 구현해 전체 reachable/CLI/간선 분류를 재계산했다. 투영은 별도 진단값으로만 대조했다. 모든 boundary151/140은 해당 graph input에서 나온 안전 Node builtin terminal이며 module/vm/worker_threads capability를 삭제하거나 unknown을 숨기지 않았다. unknown/witness 배열은 모두0이다.

원본 `V2/graph.mjs`의 **native CLI를 모드별 정확히 한 번** 실행했다. S의 동일 project/source/fresh-dist와 동일 semantic argv를 사용하고 출력 위치만 B로 바꿨다. 두 결과는 **전체 raw bytes 동일**, 정규화·metadata 제거·필터 없음이다.

- source SHA256 `0fd1074a9e7c91c2d8543e884eb5a51d248d7d3ef560a899af0d0c8819cdd89e`
- runtime SHA256 `95a32e85318855b4c00a1ab5265724298e4c2b78f75444979f06e71ee2dd9076`
- source/runtime root-set SHA는 각각 `ceb1c480c387a465b1549e5982c4d9626a14ed3893783845b1881021e3b504d1`, `1e30337ee44efab38fef32824ebceb508d38b243fd13adac8ef6c181ec107815`.

정확한 executable/argv/cwd/exit/시간은 `command-native-source/runtime.json`, raw stdout/stderr는 `native-source/runtime.*.log`; `independent-membership*.json`과 `native-*-comparison.json`이 독립 집합/BFS/바이트 대조다. analyze wrapper exit0으로 gate를 대신하지 않았다.

## M1 배치 해소: 원본 selftest 한 번, 30/147

B를 처음 쓰기 **전에** absolute/resolved 경로·verify/.codaryn의 정확한 immediate child·containment·부재를 확인해 `placement-proof.json`에 기록했다. 재사용/삭제/링크/junction/shim 없이 새 B를 만들었다. `path.resolve(B,'../codex-sec-v47-u328/source/node_modules/@types')`가 원래 존재하는 고정 typeRoots와 exact physical path로 같고 Node 타입 package 핀이 일치함을 선확인했다.

다음 명령을 **무수정 원본 selftest에 한 번만** 실행했다.

```text
node --experimental-import-meta-resolve ABS_V2/selftest.mjs -probe-final
cwd = B
```

실제 exit0, **원래30/30pass·fail0/skip0**, target program 실행0. B/fixtures-probe-final의 **147 입력 파일 전부** frozen V2/fixtures-frozen과 바이트 동일하고 typeRoots도 치환/정규화 없이 그대로 일치했다. 원래 결과30행의 status/CLI/unknown·기타 의미가 exact 동일하다. 30개 raw result의 **witness 배열 전체**와 음성 사례의 reason/code/specifier/위치 등 진단 의미도 직접 대조해 같았다. 실제 case 결과의 scope metadata나 raw JSON을 재작성하지 않았다.

`command-original-selftest-once.json`/raw logs, `selftest-comparison.json`, `selftest-negative-witness-proof.json`에 경로·147해시·30행/음성 조건을 남겼다. suffix는 새 출력 구분만 하며 case/기준/graph/config/expected는 바꾸지 않았다. 추가8개 v2 loader 회귀와 과거 v1 M1 해소는 **기존 독립 리뷰/동결 증거 READ**이며 새38pass로 합산하지 않는다. frozen run/regressions/check-original30 wrappers는 실행하지 않았다.

원래 SEC의 **중첩 cwd 실패 exit1·완료0/30·4입력(3same/1config different)·2688 unknown·143미생성**은 원문 그대로 유지됐다. S의 checked는 여전히 당시 BLOCKED 기록이다. 이번에는 PM이 새 배치를 명시 허용한 별도 assignment에서 원래 조건을 충족했다. 도구의 일반적인 cwd 의존 자체를 고친 것이 아니다.

## 명령·동결·안전 경계

| 실제 실행 | exit / 기간 |
| --- | --- |
| 원본 V1/V2 seal --check, 전 | 0/535ms · 0/427ms |
| 원본 graph source/runtime CLI, 각1회 | 0/801ms · 0/503ms |
| 원본 selftest, 1회 | 0/2457ms |
| 원본 V1/V2 seal --check, 후 | 0/544ms · 0/398ms |
| 독립 native membership | 0/888ms |

추가 Git/tar/203 cat-file은 읽기 전용 provenance 확인이다. 정확 명령·핀은 각 JSON과 verify.mjs에 있다. 새 실행 실패/재시도는 없다. SEC의 PathNotFound·selftest 실패, v2 개발 당시 CJS 가정 실패, PM/worker/V55 준비 이력은 삭제하거나 성공으로 대체하지 않았다.

V1 **1282** / V2 **889** 봉인 --check가 전후 exit0·같은 bytes를 반환했다. V2 graph/selftest/seal SHA는 각각 `cf2dfa5cf7933aec7424cc246569cfe7ba6755d2ce29af8c98f8b58f13702d8a`, `e9f582289e21ae4bf762e003907bdf82e1baa9f14a07094a4593a1277e035049`, `2d21578ce855fdaf2847052c27c14434dd8aadb102a4314c291755bfc1d8422c`. Node26.13.1 win32/x64·TS7.0.2, native tsc/API/AST/launcher/Node-types와 원래 dependency cache도 불변이다. S89 증거·203입력·400출력·673의존성·보고/checked/proof/envelope 및 첫 실패는 전후 hash가 같다.

정적 OS/Node/Git 경로와 B/private TEMP/HOME·빈 npm config만 child에 주었다. host secret env/config dump·API/model·외부 시험망·제품/fixture 프로그램 실행·제품/Git/새 worktree·stage/commit/push·Herdr/서버/권한/UI/한도 조작 없음. 생성 파일은 A/B로 구분해 own proof manifest에 연결한다. native compiler service와 resolver만 실행했으며 OS 전체 syscall sandbox·보편적인 reflection/loader/race/security 증명은 아니다.

U333 u22 원인 미확정, U321 경쟁 경계, JSON narrow-pin scope, 실제 API/model self-development·다른 OS/실제TTY 미검증은 남는다. source/runtime0과 이번 placement 해소가 이 항목을 해결하지 않는다.

`checked.json`은 exact SHA/tree/report SHA와 own proof manifest를 연결하고, canonical `ready.json`은 통신 envelope로 분리한다. **PM은 이 자료를 읽고 명시 ACK 및 C11 완료 여부를 별도로 판단한다. canonical ready를 마지막 명령으로 실행한 뒤 정지하며 직접 Herdr 통지·재전송은 하지 않는다.**
