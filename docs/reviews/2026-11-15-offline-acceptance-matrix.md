# 승인 요구·인수 상태 — exact CP53

Subject **c00ce7d0a30a855afda3111ebf83b969509ef222**, tree **75f8fb0d632097f7487bdac92604e41d508cde5c**. 아래 성공은 기존 보고 READ이며 이번 실행은0이다. 범위: 기존 승인 요구의 유한한 인수 목록, 새 gate/기능 제안 아님.

증거 연결:

- **E1 공통 오프라인 제품**: 정확 fullchecked **881533de4b66d9ab3e1497cf22c7043c7b398504**, tree0e7da89ab9a5b2dd392017617b70c4c179648aa1. [CP51](evidence/docs/pm-status.md)의 unit4328/4317pass0fail10skip1TODO, integration684/682pass0fail1skip1TODO, GUI426/smoke227/CLI95same. CP53은 제품 입력을 바꾸지 않은 새 시험2파일·문서이며 새 전체suite 수치를 추산하지 않는다.
- **E2 C11**: 정확 **37fb966abe088a666cb33ce533f484a5b06b5957**, treef1be8b6ef2b5a825354f1d370a786f69f242823f. CP51의 SEC/PROBE 보고: source66roots/156reachable/918edges(value522/type396), runtime66/154/522, CLI0/unknown0/nativeexit0, 원본selftest30/147동일. 초기SEC nested-cwd 실패0/30은 보존, 별도 허용 sibling PROBE가 해소. 보고 경로/OID는 source-provenance.json에 연결한다.
- **E3 현재 문서**: 채택 **42b16b94512ee8d696c36d53ae48450e4980abbf**, tree47596dad2c0bd3871bee8c7c536aaa347ad87474, CP52. 4문서 +52/−4, 독립 H0/M0/L0·사실0, 원래 이력/결정 보존. [현재 roadmap](evidence/docs/roadmap.md)·[progress](evidence/docs/progress.md)·[위치표](evidence/docs/design/implementation-map.md).
- **E4 별도 host 한 사례**: 채택 **823486b5b81d2c1a956bc074f574a383559475ce**, treed00713587784543cb4f4ce10aa8bf9db14b7c160. [worker 수정 보고](evidence/docs/reviews/2026-11-15-cli-host-parity-count-fix.md) SHA256 ce66f690de18f1fac54e10460bc687185486e89d52d67733e2897e02bd4c3b57; [PROBE 독립 보고](evidence/docs/reviews/2026-11-15-cli-host-parity-probe.md) SHA256 e98883b48df1dcb31e816ed352d2bddb2264d688e481066e6c37eceb4bfbb99d. worker10/관련5/c0124; 독립fresh10/관련5/복사본control4. **고유 대본1개**, 모든 시나리오가 아니다.

분류: **O** 이미 승인된 오프라인 범위/증거, **H** 실제 사람·기계 수동 증거 필요, **X** 별도 사용자 범위·승인 전 제외. H는 자동 pass가 아니다.

| 승인 기준·출처 | 구현 및 가장 강한 실제 증거 | 남은 것 / 다음 담당·행동 / 경계 |
| --- | --- | --- |
| 일반 작업 엔진·코드/문서 작업, roadmap1a·4 / DR20 | 공통 엔진·정책·기록·가림·검증·문서/정리/분석 P0/P1 A/B 존재; E1 및 현재 roadmap/DR69·70 | **O:** 이번 제한된 조사에서 승인된 미구현 기능을 확정하지 못함. 다른 작업 유형/외부 통합을 새로 발명하지 않음. |
| C1–C10 공통 계약·입력·조립·실행/적용·읽기/되돌리기·점검 이행 / DR65, adapter7.2 | 공통 app core와 CLI adapter 공유, 기존 출력/오류/순서/취소 계약·실제CLI↔인프로세스 app c01; E1과 [adapter7.2](evidence/docs/design/adapter-contract.md) | **O:** CLI parser/질문/출력을 모두 없애야 한다는 새 요구가 아님. 지정 이행 증거를 닫힌 상태로 인계, 보편적 동등성 주장 금지. |
| C11 의존 방향·표시 분리 | E2, U327–U336 10/10 채택, 물리 ALL app roots 혼합 source/runtime 검증 | **O 닫힘:** AST/native resolver 핀 모델만. reflection/custom loader/경합·OS 보안 전체 증명 아님. graph 재실행/새C12 불필요. |
| 현재 상태/이력 정확성 | E3, CP53이 추가 parity 문구까지 갱신 | **O 닫힘:** 원래 실패·당시 수치/USER 결정은 그대로. 새 문서 반복 보완 단위를 정당화할 불일치 없음. |
| 어댑터 동일 엔진·정책·journal, standalone8.3/12 | E4 실제 Node CLI↔별도 actual host: 한 문서 대본의 전체disk result/journal, 독립 minimized IPC; [test](evidence/gui/tests/unit/cli-host-parity.test.ts)·[support](evidence/gui/tests/unit/cli-host-parity-support.ts) | **O 닫힌 추가 사례:** read·보호쓰기거부·정상쓰기·file_rules·끝답. tools2/tool_result3·23records. 추가오류/취소/DR4/모든 모델 전체를 이번 한 사례로 주장하지 않으며, 추가 optional test를 새 필수gate로 만들지 않음. |
| 권한·취소·DR4 | 기존 c01 기본 deny/default/취소/잠금, CLIu285·appenvironment/u71, real host lock/cancel와 bridge가 존재(CP53/adapter8) | **O 자동 경로 증거 있음 / H 실제 UI:** real TTY·OS dialog/Esc는 별도. GUI user deny와 dismissed/default/cancelled 구분 유지. |
| 단계1b 실제 API로 코드+문서 작업, roadmap1b / testing4 | 제공자·모의API/오프라인 실행 구현; 실제실행0. 기존 Anthropic live 스크립트는 문서 사례만이며 coding 과제를 대신하지 못함 | **X:** PM이 사용자 실행용 두 작업·독립scratch·보호 검증기·모델/비용/호출 상한·판정/보관 계획을 먼저 구체화. 키는 사용자 로컬에서만, PM/worker 실행 금지. 그 뒤 사용자만 controlled live 실행, 1b 완료 별도판정. |
| 단계2 실제 모델 수정→실패근거→재수정, roadmap2/testing11 | E1 대본/모의 반복·한도·보호·취소 증거; realAPI 과제묶음 미실행 | **X:** 기존 문서가 미정으로 둔 과제 수·합격 기준·모델/비용/시간/토큰/재시도 값을 PM이 명시한 실행 패킷부터 준비. 실제 API를 호출해 기준을 사후 생성하지 않음. |
| 단계3 실제 모델 후보 자기개발, roadmap3 | E1 후보 준비/보호해시/대본예행(k03); actual model selfdev 미실행 | **X:** 먼저1b/2 live 결과와 고정 실행본, 기존 후보WT·보호된검증/정책·작은과제·상한·반려/보존 절차를 PM이 고정. 검증기 자기수정/자동채택·merge/push 없음. |
| 실제 Windows TTY/OS 기본버튼·Esc·포커스 | [manual M1.1–1.4/M3.2/M3.13](evidence/docs/manual-checks.md), 자동시험은 TTY/대화상자 대역 | **H:** 기존 설치·콘솔·합성scratch로 아래 키없는 packet. M1.5·1.6/M3.10·3.11은 기존 체크리스트가 키를 요구하므로 X/live packet에 보류. |
| 키보드·Narrator·고대비·200%·IME | manual M3.3–3.6/M3.15/M3.17; standalone10 접근성 목표 | **H:** 실제 Windows 사용자, 내장 Narrator/고대비/Microsoft IME와 기존 앱. DOM/isComposing 대역은 대체 증거가 아님. NVDA는 선택·새 설치는 이번 인계의 자동 승인 아님. |
| 실볼륨·다른 OS | manual M4.1–4.6/M5.1–5.7, standalone9 Windows11x64 먼저 | **H:** FAT/exFAT/두 볼륨·링크권한·다른 OS 기계 필요. 준비된 기계/매체가 없으면 pending; 권한 상승·다운로드·지원OS 확대를 임의 수행하지 않음. |
| GUI 패키징·Node 묶기 / DR26·GU9·DR67 | [decision DR67](evidence/docs/decision-register.md), [standalone7/8.2/14](evidence/docs/design/standalone-gui.md): 개발GUI/host 존재, packager/fuses/배포물은 미승인 | **X:** 버전·체크섬·실제 다운로드URL/출처·실행명령·예상산출/검증·크기/라이선스/비용/폐기계획 표와 exact diff를 PM이 먼저 준비. Node26 bundle 판/체크섬/서명/갱신도 구분. dependency 이름만으로 승인요청하지 않음. 서명 인증서/SmartScreen·비용과 설치형식·게시/배포는 별도 결정; 여기서는 조사망/다운로드/설치/서명/게시0. |
| U321 알려진 경합 | [V41](evidence/docs/reviews/2026-11-14-v41-codex-verify-u321.md), [최종V41b](evidence/docs/reviews/2026-11-14-v41b-codex-verify-u321.md), exact00f7085cc3dc77cb756ecd1c0eff5482832a7e94: 사전junction/hardlink 거부·선택기록 보존·정상cleanup 지정수정 수용 | **잔여 한계:** 부모 최종검사→ensureStateDir 첫쓰기와 최종로그검사→append 사이 새hardlink 일정은 기준에도 재현. 현 승인 범위는 보편적OS 경쟁차단이 아님. PM이 위협/잔여위험 처분을 기록; 별도 승인된 unfinished remediation은 발견하지 못함. 새 목표가 필요하면 원래 일정/불변성에 한정한 분석을 먼저 배정, 추측성 source 수정 없음. |
| U333 u22 원인·과거JSON pin | CP51/53 원인미확정 유지; [V54](evidence/docs/reviews/2026-11-15-v54-codex-verify-u335.md) exact016b02f7601cbdeac4698a82d88cbb68fde836c7에서 fullguard/actual9줄 직접동일성은 검증했으나 과거N19 narrow snippet-pin 추출범위 미확인 | **잔여 한계:** C11/CP53이 해결하지 않음. PM이 분리 기록을 유지; 새문제가 실제재현되거나 범위가 명시될 때 원본로그/추출helper 읽기만 좁게 분석. 원본실패/핀/oracle 재생성으로 해소 처리 금지. |
| DR20 VS Code·확장/외부연동 | 독립GUI 한 종류, VS Code/줄protocol은 DR20/66으로 취소 | **X/취소:** VS Code를 남은 구현으로 넣지 않음. 외부 메시지/새통합/범용 UX 확대도 이 인계로 승인되지 않음. |

## 한 번의 키없는 Windows 수동 인수 패킷 — 권고 다음 행동

PM이 exact 개발빌드/아래 기존 항목·기록형식을 고정해 실제 운영자에게 인계한다. **이번 worker는 UI를 열거나 메시지를 발송하지 않았다.** 준비된 기존 빌드·Windows 환경이 없으면 pending으로 남기고 설치/빌드를 이 작업에서 시작하지 않는다.

| 기존 항목 | 관찰할 기대 / 실제 필요한 사람·도구 |
| --- | --- |
| M1.1–1.4 | 실제 PowerShell/Windows console, 기존 Git Bash가 있으면mintty: apply/init Enter·EOF·Ctrl+C 기본거부/줄마침/종료, 콘솔 JSON와 stderr/한국어 표시. 합성 연습폴더만 사용. |
| M3.2 + M3.13 | 실제 GUI OS dialog: Enter/Esc가 적용/정리/되돌리기/첫저장을 실행하지 않음, 기본버튼·초점 관찰. 명시적 저장시만 원래 LF/CRLF·BOM 보존 확인. |
| M3.3 + M3.17 | 실제 창에서 키보드만·파일보기 접근성: 보이는 순서대로 이동, 초점 표시/복귀·탈출 가능, 필요한 역할/이름 읽힘. |
| M3.4–3.6 | Windows 내장 Narrator/고대비/200%: 트리 펼침·접힘/항목·상태·버튼·비교 지움/더함이 읽히고 테두리·초점·글이 보이며 잘리지 않음. 설치 안 된 NVDA를 받지 않음. |
| M3.15 | 실제 Microsoft 한국어 IME: 조합 중 Ctrl+S 저장안함/조합유지, 조합끝 Ctrl+S 저장 및 ‘가’ 실제파일 확인. IME판·Windows빌드 기록. |

각 항목은 exactSHA·Windows/터미널/IME판·합성scratch 위치·기대/실제·pass/fail/not-run·필요시 비밀없는 화면·로그를 남긴다. 기존 checklist의 API필요 항목·다른OS·실볼륨은 이 패킷에 끼워 실행하지 않는다. 실패가 나오면 PM이 재현과 승인된 요구를 확인한 뒤에만 좁은 수정 단위를 배정한다. 단순 pending을 새 optional test/제품 기능으로 바꾸지 않는다.
