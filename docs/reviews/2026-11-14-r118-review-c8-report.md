# R-118 짧은 확인: U-311 (na-core, 이행 C-8: report의 읽기·판정을 앱으로)

- 검토: ne-verify (w3:p4). 읽기 전용, 커밋 없음. src는 Codex V-35가 본다.
- 판: `pm/unit-C8` = `dd02351fd91af3d399007aeae38ed7660bb05138`. main `c3c9b61e` 위다.
  - `src/app/report-read.ts`(+814)가 새로 생겼고, `src/cli/report.ts`는 −773이다. 판 비교 사례는 +55다.
- base(main `c3c9b61e`)와 head 판 사본의 빌드로 쟀다. 실제 API·외부 네트워크·임시 worktree는 쓰지 않았다.

## 결론: 높음 0, 중간 0, 낮음 0, 참고 0

| 시험(head) | 결과 |
|---|---|
| 루트 build | exit 0(base도 exit 0) |
| GUI `npm test` | 424/424 |
| smoke "조용함" | 227/227, 35초. 시작 때 다른 세션의 부하로 CPU 100%, node 80개. host 108 ms |
| smoke 부하 | 227/227, 50초, CPU 100%, node 97개, host 806 ms |

- 두 번 모두 보고서 화면의 smoke 점검 14개가 통과했다(`report…`, `reviewFromList` 등).
- "조용함" 한 번도 다른 세션의 부하 아래였다.

## GUI 보고서 화면이 받는 값: base와 head가 같다 (`probe/gui-report.mjs`)

- 실행은 head의 CLI로 만들었다. 기록은 같다.
- base와 head의 실제 앱으로 `app.report({ workspace, runId })`를 불러, 호스트의 `reportValue`(head의 GUI 빌드, 두 판이 같은 코드)를 거쳤다.
- 보고서 저장에 쓰는 `app.reportMarkdown`도 함께 맞댔다. 실행 id·가림 토큰·상자 폴더만 바꿨다.

| 경우 | head(창이 받는 것) | base와 |
|---|---|---|
| 정상(등록 값이 든 파일 쓰기, 검증 통과) | complete, Markdown 1,426자 | 같음 |
| 거부가 있는 실행(명령, 작업 공간 밖, 보호 경로) | complete, 거부 3, Markdown 1,440자 | 같음 |
| 손상된 기록(journal 한 줄 깨짐) | `invalid_run_record`(화면과 Markdown 모두) | 같음 |
| result.json 없음 | incomplete | 같음 |
| 기록 변경 표시 | complete, `recordsChanged: true` | 같음 |
| 취소된 실행 | complete, Markdown 1,247자 | 같음 |
