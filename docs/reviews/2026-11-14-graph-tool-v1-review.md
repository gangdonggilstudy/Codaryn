# C11 graph 도구 v1 독립 검토

codex-audit / architecture verifier, 2026-11-14. **높음 0 / 중간 1 / 낮음 0.** 제품·후보 검증이나 전체 C11 우회 판정은 아니다. v1의 runtime 분석에서 알려진 builtin loader capability를 package alias 뒤에서 놓치는 false 0을 확인했다. **같은 source 사례는 incomplete여서 source+runtime 이중 게이트 전체가 통과하지 않는다.** PM에 재현을 전달했으며 원본·scope·기대값은 수정하지 않았다.

검토 원본은 `codex-sec-c11-graph-tool/`의 동결 v1이다.

```text
graph.mjs    c397e0d1c01b5d7c9d0a8ff3569c46c7952dab3450e66f18baaa5e488165642f
selftest.mjs e9f582289e21ae4bf762e003907bdf82e1baa9f14a07094a4593a1277e035049
seal.json    060c44433f255159ace17b1f19e107a6cf509ed2de64e0c4ebf7bb627e63fe60
```

## M-1 — 해석된 builtin의 loader capability를 검사하지 않아 runtime false 0

**원본 위치:** `graph.mjs:36`, `:50`, `:59`.

`:36`은 입력 specifier가 `module`/`node:module` 등의 문자열일 때만 capability 문제를 등록한다. `:59`의 named createRequire 검사도 그 두 specifier에만 적용된다. 반면 `:50`은 Node resolver가 돌려준 값이 builtin이면 즉시 terminal로 끝내므로, package imports가 `#loader`를 **실제 node:module**로 해석한 뒤에는 같은 capability 검사를 하지 않는다.

자체 fixture `additional-fixtures/valid-builtin-alias-runtime/`:

```json
{ "type": "module", "imports": { "#loader": "module" } }
```

```js
// src/app/main.mjs
import {createRequire as make} from "#loader";
const load = make(import.meta.url);
load("../cli/danger.cjs");
```

Node의 실제 resolver만 호출해 `#loader → node:module`, 표준 `createRequire(importer).resolve("../cli/danger.cjs") → src/cli/danger.cjs`를 확인했다(`alias-resolution-proof.json`). **fixture 프로그램/CLI 파일은 실행하지 않았다.** target에는 실행되면 던지는 sentinel이 있다. 사용자 정의 loader, 임의 반사 실행, global monkeypatch를 쓴 사례가 아니다. 기존 도구가 직접 module import에서는 incomplete로 막는 표준 loader capability의 alias 조합이다.

원본 CLI를 그대로 실행한 결과(`runtime-alias-cli.json`, `.stdout.log`, `final-commands.json`):

```text
exit 0
status zero-within-model / roots 1 / edges 0 / CLI 0 / unknown 0
boundary: #loader → node-builtin
```

예상 가능한 안전 결과는 CLI witness 또는 이 지원하지 않는 loader capability의 **incomplete**다. 0은 적절하지 않다. 정확한 재현 명령은 R을 이 검토 폴더, F를 위 fixture로 두면 다음과 같다. OUT은 존재하지 않는 자체 파일이어야 한다.

```powershell
node --experimental-import-meta-resolve <원본>/graph.mjs <F>/tsconfig.json <F> <F>/src/app <F>/src/cli runtime <R>/repro.json
```

대응하는 `valid-builtin-alias-source/`를 analyze한 결과는 **incomplete / unknown 1**, 사유 `native-source-resolution-unavailable`다(`valid-alias-results.json`). 따라서 이 재현은 **runtime 단독 결과의 false 0**이며 현재 source union과 runtime을 함께 요구하는 최종 게이트 전체의 우회 증거가 아니다. 제품 결함이나 아직 배정받지 않은 최종 C11 판의 결함으로 세지 않는다.

## 독립 실행·반례 탐색 결과

| 검사 | 실제 결과 |
| --- | --- |
| 동결 selftest.mjs를 원본 위치에서 읽어 자체 cwd로 실행 | **30/30 pass**, fail/skip 0; 자체 fixtures-audit/result만 생성 |
| 최초 추가 합성 9사례 | **5 violations / 4 incomplete**, false 0 없음 |
| 유효 builtin alias 보충 2사례 | source incomplete 1 / **runtime false 0 1** |
| 추가 합성 합계 | **11사례: 안전 비영 10 / false 0 1**; 결과 수이며 원본 self-test 수에 합치지 않음 |
| OLD source 재조회 | roots61 / edges955 / CLI12 / unknown0 / **exit1**, 동결 source-final.json과 raw bytes 동일 |
| OLD runtime 재조회 | roots61 / edges549 / CLI12 / unknown0 / **exit1**, 동결 runtime-final.json과 raw bytes 동일 |
| 원본 봉인 전·후·최종 | **1,282파일 동일**, 종료0; graph/selftest SHA도 지정값 그대로 |
| provenance/fresh 입력 확인 | 고정 target9·설치 의존5·추출 source196·출력386 지문 동일; source196은 archive 멤버와 실제 바이트 동일 |

11개 추가 사례는 orphan physical roots, Windows app 경로 대소문자, mixed type/value cycle, 프로그램에 포함되지 않은 orphan, parse error, package builtin alias의 source/runtime 조합으로 한정했다. 처음 쓴 imports target `node:module`은 Node가 `ERR_INVALID_PACKAGE_TARGET`으로 거부해 정상 incomplete였다. 그 입력과 결과를 보존하고, 유효한 bare target `module`로 별도 보충 2개를 만들었다. 원래 기대를 바꾸지 않았다.

주요 음성/양성 결과:

- main에서 import하지 않는 physical orphan도 source/runtime에서 roots2로 포함되고 CLI1을 찾았다. program 밖 orphan은 unknown1로 막혀 0이 아니었다.
- `src/APP`로 준 Windows case variant는 source/runtime 모두 CLI1을 찾아, 의심한 case 불일치는 이 표본에서 재현되지 않았다.
- mixed 사례는 type edge → value edge → CLI와 중립 cycle을 가진다. **value-only CLI0, type-only CLI0이어도 source union CLI1**이었다. 진단 투영은 최종 gate를 대체할 수 없다.
- 파싱 오류는 syntax 문제를 unknown으로 남겼다. 원본30도 type/query/export-star, literal dynamic/require, paths·조건·self-reference, unresolved/zero root/alias/builtin shadowing의 지정 표본을 그대로 통과했다. 이는 해당 유한 표본의 확인이다.

## 게이트·핀·보고 의미

원본 graph의 CLI 의미는 **0 = zero-within-model, 1 = violations, 2 = incomplete**다(`graph.mjs:79–86`). OLD 전용 wrapper가 예상 exit1/2를 수집하고 정상 종료하는 것은 아키텍처 통과가 아니다. 이 검토에서도 원본 wrapper는 실행하지 않고 graph CLI의 실제 exit와 결과를 따로 기록했다.

보고서의 source union이 권위 있고 value/type projection은 진단용이라는 설명은 코드 및 mixed 반례와 맞는다. source/runtime roots>0, CLI0, unknown0 모두가 필요하며, selftest30 통과·직접 import0·투영0만으로 완료를 선언할 수 없다. M-1 때문에 **v1 runtime 0 자체를 완전한 부재 증명으로 쓰면 안 된다.**

기존 archive/project/input/output 핀과 설치 compiler/API 지문을 읽어 검증했다(`old-and-pin-results.json`). fresh receipt는 `distAbsentBefore: true`, archive/build project/output을 담고 **입력 배열은 별도 extracted-source-pins.json에** 있다. 독립 rebuild는 하지 않았다. 기존 build provenance와 현재 동결 산출물의 일치를 확인한 것이다.

원본 run.mjs의 runtime-final은 archive·build project·출력 전체·별도 source 핀을 검사한다. source-final은 분석 호출 분기이므로, 미래 호출자는 별도로 실제 archive/source 및 frozen tool/compiler 지문을 확인해야 한다. 매번 전체 gate를 자동으로 수행하는 보편적 runner로 해석하지 않는다. 최종 사용에는 정확한 지정 판, source 핀, fresh dist, 도구 self-test/무결성, 두 그래프의 원시 결과 및 PM의 컴파일·시험 조건을 함께 확인해야 한다.

## 명령·실패 기록·범위

R 안에서 실제 수행:

```powershell
node ./run-review.mjs
node --experimental-import-meta-resolve ./refine-alias.mjs
node ./check-old-and-pins.mjs
node --experimental-import-meta-resolve ./final-checks.mjs
```

run-review는 **원본 seal --check(읽기 전용)**, 원본 selftest.mjs `-audit`(cwd=R), 자체 additional.mjs, seal --check를 순차 실행했다. selftest를 복사 수정하거나 원본 wrapper를 실행하지 않았다. 실제 argv/cwd/exit/기간은 `commands.json`, 원문은 `original-selftest.*.log`와 `selftest-results-audit.json`이다. 합성 결과는 `additional-results.json`, `valid-alias-results.json`과 각 fixture/result.json에 있다.

핀 감사 보조의 첫 호출은 fresh.inputs가 존재한다고 잘못 가정해 assertion으로 실패했다. legacy receipt의 별도 source 핀 형식을 확인하고 **자체 보조만** 수정했다. 실패 버전 `check-old-and-pins.failed-assumption-v1.mjs`와 동일 실패 진단 보존 로그 `pin-helper-v1-failed.*.log`는 남겼다. 이 실패를 도구/제품 결함이나 성공 검사로 세지 않는다. 이후 OLD 두 재조회·지문 검증은 정상 종료했고 원시 OLD 결과도 동일했다. 추가/OLD/실패 보존 CLI의 exact 명령과 결과는 `final-commands.json`, `old-and-pin-results.json`에 있다.

모든 결과는 새 소유 폴더 아래에 썼다. 축소 환경의 selftest/OLD/CLI 재현은 OS/PATH·자체 TEMP/HOME만 전달했고, 단순 합성 analyze의 초기 직접 호출은 상속 환경이었으나 환경/키 값을 읽거나 출력하지 않았다. 대상 프로그램 실행·제품 코드 실행·실제 API·키 파일·네트워크/DNS 요청·의존성 설치·권한 상승·Git/product/worker 변경은 없다. TypeScript native compiler 서비스와 로컬 resolver만 사용했다.

임의 reflection/함수 전달/전역 monkeypatch/사용자 정의 loader의 보편적 부재, 모든 링크/junction/하드 링크·교체 경합, 다른 Node/OS/조건은 증명하지 않는다. 추가 합성 11사례로 새 완전성 기준을 만들지 않았다.

## 향후 사용 판정

**v1 검토 완료, runtime false 0 중간1은 해결 확인 전 남아 있다.** OLD와 유한 반례의 진단 자료로는 사용할 수 있으나 이를 final C11 0 승인으로 승격하지 않는다. PM이 v2 수정을 별도 담당에게 배정한 것을 확인했다. **mutable v2는 읽거나 수정하지 않았으며**, 새 frozen hash/READY가 지정되기 전에는 v2 재검토를 시작하지 않는다. 제품·기존 원본30 fixtures/tool/OLD 보고/기대값/seal은 모두 그대로다.
