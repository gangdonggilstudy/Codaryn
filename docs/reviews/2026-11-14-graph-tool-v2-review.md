# GRAPH v2 독립 재확인 — READY

codex-audit / architecture verifier, 2026-11-14. **새 tool finding: 높음 0 / 중간 0 / 낮음 0. v1 M-1은 해소됐다.** 지정 frozen v2의 제한된 도구 재검토가 끝났다. 제품·후보·전체 C11 통과 판정은 아니다.

```text
v2 graph.mjs cf2dfa5cf7933aec7424cc246569cfe7ba6755d2ce29af8c98f8b58f13702d8a
v2 seal.json 2d21578ce855fdaf2847052c27c14434dd8aadb102a4314c291755bfc1d8422c
selftest     e9f582289e21ae4bf762e003907bdf82e1baa9f14a07094a4593a1277e035049
```

## v1 M-1 해소 확인

v1 검토 때 사용한 **동일한 원본 fixture** `codex-audit-c11-graph-tool-review/additional-fixtures/valid-builtin-alias-{source,runtime}/`를 읽기 전용으로 v2에 넘겼다. 새 fixture로 대체하거나 입력을 고치지 않았다. package imports `#loader → module`, named alias createRequire, literal CLI 경로의 조합이다.

| 원래 재현 | v1 | v2 직접 CLI 실측 |
| --- | --- | --- |
| source | incomplete / unknown1 | **incomplete / unknown1 / exit2** |
| runtime | 잘못된 zero / unknown0 / exit0 | **incomplete / unknown1 / exit2** |

runtime 진단에는 `builtin-loader-capability-needs-review`, specifier `#loader`, **resolvedBuiltin `node:module`**, line1이 남는다. source의 기존 `native-source-resolution-unavailable`도 그대로다. runtime CLI0이 남더라도 unknown1이므로 0 게이트를 통과하지 않는다. v1 때도 source가 incomplete였으므로 이 finding을 이중 게이트 전체 우회나 제품 결함으로 승격하지 않는다.

정확한 입력·결과·명령은 `exact-M1-source/runtime.json`, `exact-M1-source/runtime-CLI.json`과 대응 stdout/stderr, `commands.json`에 있다. CLI 파일/대상 프로그램은 실행하지 않았다.

## 실제 변경과 제한된 회귀

원본 v1/v2 전체 도구를 직접 비교한 차이는 **두 hunk의 36·37·50행뿐**이다(`probes-results.json.changedLines`).

- **graph.mjs:36–37:** source의 specifier 기반 보수 판정을 유지하면서 runtime 조기 builtin terminal을 제거했다.
- **graph.mjs:50:** 실제 Node import/require resolver 결과를 `node:` 이름으로 정리한 뒤 module/vm/worker_threads capability를 검사한다. 해당 결과는 unknown으로 닫고 specifier·resolvedBuiltin을 남긴다. safe builtin은 계속 terminal이다.
- **graph.mjs:59,79–86 등 나머지:** AST 수집·source 해석·union/투영·unknown 및 CLI 종료 규칙은 원문 그대로다. source 지원 범위나 unknown을 무시하는 예외를 추가하지 않았다.

| 독립 확인 | 결과 |
| --- | --- |
| 원본 selftest.mjs 그대로 자체 cwd에서 실행 | **30/30 pass**, fail/skip0 |
| 원래 입력 | v1·frozen v2·이번 자체 생성본 **147파일 바이트 전부 동일** |
| 원래 결과 | 30행 status/CLI/unknown 등 **의미 동일** |
| frozen 회귀 fixture 8개를 독립 호출·검사 | **8/8 pass**, 아래 실제 Node 대조 포함 |
| 위 지정 합계 | **38사례 확인**; 추가 대조·재호출을 중복 합산하지 않음 |
| v1 기존 source gate 대조 4개 | orphan·mixed union·프로그램 밖 orphan·parse error 모두 예상 비영 결과 |
| v1/v2 봉인 | **1,282 / 889파일 전후 불변**, 각 seal 검사 종료0 |

8개 회귀는 유효 module alias/source counterpart, vm·worker_threads ESM alias, 중립 재수출→module alias, CJS module/vm alias, safe path alias다. 원본 v2 regressions.mjs는 자신의 폴더에 쓰므로 실행하지 않았다. 대신 **frozen 8입력만 읽어** v1/v2 analyze를 호출하고 실제 Node resolver 결과와 독립 대조해 결과를 자체 폴더에 썼다.

유효 ESM capability alias 4개는 v1 zero→v2 incomplete(unknown1)였다. CJS 두 개는 실제 Node가 **ERR_INVALID_URL_SCHEME**으로 거부했고 양쪽 도구 모두 같은 오류를 incomplete로 유지했다. 이들을 성공적인 builtin 해석으로 세지 않았다. safe `#paths → path`는 실제 `node:path`로 해석되며 v1/v2 모두 zero/unknown0이다. 임의로 모든 alias를 incomplete 처리하여 통과시킨 수정이 아니다.

별도 source 대조에서 physical orphan은 roots2/CLI1, 프로그램에 없는 orphan은 unknown1, parse error는 unknown2로 막혔다. mixed type→value cycle은 **value 투영 CLI0·type 투영 CLI0이지만 union CLI1**이었다. 따라서 source union을 권위 있는 판정으로 쓰는 조건도 유지된다.

## OLD·무결성·fresh provenance

고정 OLD `280d148e`를 frozen v2 project/source/fresh dist로 다시 분석해 자체 출력만 만들었다.

| OLD | roots | edges | CLI | unknown | CLI exit | v1 대비 의미 delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| source union | 61 | 955 | 12 | 0 | **1** | **0** |
| runtime | 61 | 549 | 12 | 0 | **1** | **0** |

이번 OLD 결과는 frozen v2 source-final/runtime-final과 **각각 raw bytes 동일**했다. v1과는 graph·두 진단 투영·내부 전체 edges/witness·도달 파일·unknown·입력 지문을 직접 비교해 동일했다. source boundary도 동일하다. runtime builtin 해석 메타데이터와 소유 폴더 경로 등 v2 형식까지 v1 전체 JSON과 바이트 동일하다고 주장하지 않는다.

provenance의 tool/compiler/API/AST/Node-type 지문, source archive와 build project 지문을 확인했다. **소스/빌드 입력 196파일은 별도 pins 및 fresh.inputs와 같고 archive 멤버와 바이트 동일**, fresh 출력 **386파일**의 지문도 유효하다. 새 build를 실행하지 않았으며 기존 동결 fresh-build 증거와 현재 산출물의 일치를 확인했다(`old-provenance-results.json`). 도구 hash·selftest·v1/v2 seal hash 최종값은 `final-integrity.json`에 있다.

OLD의 exit1을 수집한 wrapper 정상 종료는 아키텍처 통과가 아니다. 최종 사용에도 selftest·정확한 도구/compiler·실제 판 archive/source pins·fresh dist 및 source union/runtime 각각 roots>0/CLI0/unknown0과 PM의 별도 컴파일·시험 조건을 함께 요구한다. 이 검토의 OLD는 여전히 CLI12이므로 통과 판이 아니다.

## 실제 명령·증거·한계

R은 이 새 소유 폴더다. 실제 top-level 명령은 **`node ./run-review.mjs` 한 번**, 모든 자식의 exact executable/argv/cwd/exit/기간은 `commands.json`에 보존했다.

```text
원본 v1 seal.mjs --check                 exit0
원본 v2 seal.mjs --check                 exit0
node --experimental-import-meta-resolve <v2>/selftest.mjs -audit   exit0 (cwd=R)
node --experimental-import-meta-resolve <R>/probes.mjs             exit0
node --experimental-import-meta-resolve <R>/old-provenance.mjs     exit0
원본 v2 graph CLI + 정확한 v1 source/runtime 입력 → R의 새 출력     exit2 / exit2
원본 v1/v2 seal.mjs --check               exit0 / exit0
```

원본 runner/wrapper는 실행하지 않았다. 원본 selftest는 자기 cwd에만 쓰는 것을 확인하고 R에서 그대로 실행했다. 결과는 `selftest-results-audit.json`, `probes-results.json`, `regression-*.json`, `gate-*.json`, `old-provenance-results.json`, 각 stdout/stderr 로그에 있다. 실패하거나 재시도한 검증 실행은 없으며 의도한 graph exit1/2는 실패로 오인하거나 0으로 바꾸지 않았다.

자식은 정적 OS/Node/System32 경로와 자체 TEMP/HOME만 받았다. 대상 프로그램 실행·실제 환경 키·키 파일·네트워크/DNS·API·의존성 설치·제품/worker/Git 변경·권한 상승은 없다. TypeScript native compiler 서비스와 로컬 resolver만 사용했다. 모든 출력은 R 아래며 v1/v2 도구·fixtures·보고서·기대·seals는 불변이다.

임의 반사 실행·함수 전달·전역 monkeypatch·사용자 loader·모든 링크/경합·다른 Node/OS/조건의 보편적 증명은 하지 않는다. 해당 한계와 알려진 unsupported→incomplete 정책은 유지된다. **지정 frozen v2는 요청 범위에서 재사용 READY, v1 M-1 closed**다. 제품/최종 C11 승인은 별도다. 이 보고 뒤 추가 명령이나 사례 확장을 하지 않는다.
