# U330 MODELS-CONSUMER 보충 검증

codex-probe / 정확성·앱 소비자 독립 검증자, 2026-11-14. **소비자 보충 범위의 발견: 높음 0 / 중간 0 / 낮음 0.** 후보의 모델 소비자는 원래 관찰과 동일하다. **U330 최종 승인·실제 M1 parent READY·구현 허가는 아니다.** LOOP V49의 최종 결과는 추정하지 않는다.

| 정확한 판 | 값 |
| --- | --- |
| candidate | `4b8598f88aa535594366b50bee6f7cea0288d14a` |
| tree | `c26ef3c06efd851607280e4efeee28b2fec64889` |
| parent | `3fe4ada6182cbf3db3dbcee39c872cd318c5748e` |
| 자체 archive/evidence | `.worktrees/codex-verify/.codaryn/codex-probe-u330-models-consumer/` |
| base.tar SHA-256 | `892105099cd820a91276ccb45b17c87007753a6146c287543f197be846ec3ef5` |

## 실제 결과

| 독립 실행/확인 | 결과 |
| --- | --- |
| fresh candidate archive build | **종료 0** |
| 원래 CLI 기준 | **85사례 / 541조건 / 차이 0**, 종료 0 |
| 원래 공개 APP 기준 | **20사례 / 157조건 / 차이 0**, 종료 0 |
| 재생 합계 | **105사례 / 698조건**, 원문 bytes·키 순서·오류·전체 trace 동일 |
| CLI 기존 반환 | fulfilled 75(오류 outcome 31), rejected 10 |
| APP 기존 반환 | fulfilled 16(공개 오류 9), rejected 4 |
| synchronous throw / skip | 두 재생 모두 **0 / 0** |
| 네트워크 시도 / 실제 파일 포트 호출 | 두 재생 모두 **0 / 0** |
| 원래 봉인 전/후 | CLI **205파일**, APP **335파일** 모두 유효·불변 |
| 원본·사본 | 각 5개, **10파일 바이트 동일**, 사본도 재생 후 불변 |
| 소스 비교 | **42개 통과**, legacy 함수 binding 2개 동일 |

기존 오류 outcome/rejected는 합성 입력에 대한 원래 결과다. 차이·새 제품 결함으로 세지 않는다. 캡처·기대값 재생성·사례 추가·정규화 변경은 없었다.

## 소스와 소비자 경계

parent 대비 전체 src/test diff는 **4파일(+240/-86)**이며 src는 새 app/config-write.ts, settings-change.ts의 import, CLI models.ts뿐이다. 나머지 한 파일은 새 `tests/unit/app/u330-config-write.test.ts`다. 기존 시험·corpus 변경은 없다. 새 U330 시험은 여기서 실행하지 않았다.

- `src/app/config-write.ts:11,39,71`: ConfigWriteOptions·isRecord·detectIndent·withModel·writeConfigAtomic의 **원래 본문/주석 closure 그대로**다. 의존 import와 LF/BOM의 내부 공유 export, 분리 경계 EOF 개행 한 줄 외 차이가 없다. writer 전체 파일 4,149바이트 SHA-256은 `92898015dc93ba3f159d798f884f7895cdd5925dc11c329878ad9f1104434224`다.
- `src/cli/models.ts:71–72`: withModel/writeConfigAtomic 값과 ConfigWriteOptions 형의 옛 경로 재수출이다. 두 함수는 새 앱 원천과 **Object.is 동일**하다. CLI value export는 renderModels/runModels/withModel/writeConfigAtomic 네 개로 유지되며 LF/BOM은 CLI에 새로 노출되지 않는다.
- `src/cli/models.ts:232,256`: 원래 writer closure·관련 import를 제거하고 facade를 넣으면 **CLI 파일 전체가 후보와 원문 동일**하다. ModelsEnvironment 전체 본문과 scrub/거부 helper, tokens부터 이어지는 renderer·카탈로그·runModels·선택·질문·가림·currentModel tail도 동일하다. 해당 tail 18,549바이트 SHA-256은 `fe161c4de0cbf569eab03c514062c3a1deb6cda54c8922b257c944eb0320604f`다.
- `src/app/app.ts:776`: parent와 **파일 전체 바이트 동일**하다. 요청 getter/pre-try env copy, io/fallback getter 순서, 기존 await·jsonOutcome·catch를 바꾸지 않았다. writer 이동을 이유로 late formatting/추가 await를 넣지 않았다.
- `src/app/settings-change.ts:29`: writer import 원천만 앱으로 바뀌었고 나머지 파일은 원문 동일하다. 기존 호출의 기본 writer도 그 같은 binding을 사용한다.
- 별도 **소비자 13파일**(app.ts/models/environment/provider, args 두 경로, 설정/입력/가림, guard/command-outcome)과 **contracts 23파일 전체**가 parent와 바이트 동일하다. 포트·readonly/optional·public request/output·키 규칙의 선언을 바꾸지 않았다. 이는 전체 app→CLI 의존 0이라는 판정이 아니다.

`source-results.json`에 모든 byte/hash·delta inventory·binding 근거가 있다. 소스 42비교에는 moved closure·facade·consumer tail·port body·settings import와 위 13+23파일이 포함된다. 별도의 새 타입 시험/원자 writer 검증을 추가하지 않았다.

## 고정 oracle의 재생·보존

승인된 parent-confirmation의 `prepare-replays.mjs`를 그대로 사용했다. 원래 harness/fixtures/expected/fence/seal을 자체 cli/app에 바이트 그대로 복사하고, **별도 replay 사본의 경로/저장 제어 7곳만** 바꿨다. 역치환하면 원본 harness와 동일함을 전후 확인했다. 원래 가상 cwd/경로를 입력 namespace로 유지하고 결과 파일만 자체 폴더에 썼다. 관찰/assertion·마스킹·normalization은 바꾸지 않았다.

| 원래 불변 자료 | SHA-256 |
| --- | --- |
| CLI expected | `06d794eca53ba5f20fed47066d7ed433507bd8548d014574048d48cd3c9a09ba` |
| CLI seal | `8558cd20982d4e47b234f6b3aabc86ea9f7d255f4c60b3ccb729b413a52cf7bd` |
| APP expected | `f62c7bb60eb968df98a39c2cd11366dbdeac33abf28155b094f1470c8f90aef6` |
| APP seal | `dd9bb85454f6a02ada785c4adec51258cea2baf70be9edc0acdd359d60bee414` |

APP 20사례도 실제 후보의 CLI runModels를 경유했다. 즉시 거부/rejection, 이중/삼중 getter, env copy, io/fallback, 실제 미해결 listing/write, receiver, JSON/전체 가림/재해석 오류와 microtask trace가 모두 고정 원문과 같다. CLI 85사례의 ko/text/JSON·ask/EOF·지연 read/list/write도 그대로다.

## 실제 명령·제한

archive/extract는 저장소 cwd, 빌드는 자체 board cwd에서 실행했다. 전체 명령/cwd/종료는 commands.json에 있다.

```powershell
git -C D:/project/Codaryn archive --format=tar --output=D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-u330-models-consumer/base.tar 4b8598f88aa535594366b50bee6f7cea0288d14a
tar -xf D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-u330-models-consumer/base.tar -C D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-u330-models-consumer/board
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --typeRoots D:/project/Codaryn/node_modules/@types
# 자체 evidence 루트 cwd
node prepare-replays.mjs
node source-audit.mjs
node finish-integrity.mjs
# 자체 cli 및 app cwd 각각
node replay.mjs replay D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-u330-models-consumer/board
```

증거는 copies.json, cli/replay-result.json, app/replay-result.json, source-results.json, integrity.json에 있다. 합성 read/list/write/fetch와 원래 network fence만 사용했다. 실제 env·API·키 파일·외부 네트워크·default network fallback·실제 원자 writer/rename은 사용하지 않았다. writer 기본 구현의 실제 fs 검증과 LOOP V49 최종 검토는 별도이며 결과를 추정하지 않는다. fullsuite·GUI·새 U330 unit·다른 corpus는 실행하지 않았다. APPINIT 333 봉인, writer 26, C10 141도 수정하지 않았다.

이 evidence와 report는 자체 evidence-seal.json으로 동결한다. **소비자 차이·남은 blocker는 없지만 아직 실제 채택 main이 아니다.** PM이 실제 adopted hash/tree를 지정하면 이 후보의 정확한 검증 트리와 source/tree를 확인한 뒤 향후 M1 gate 자료로 연결한다. 이번 보고서로 U330 최종 승인·M1 착수를 허가하지 않으며 동결 후 대기한다.
