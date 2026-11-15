# 교차 검토: src/policy, src/workspace (main 7b39c96)

읽기 전용으로 검토했습니다. OS 임시 폴더에 main 사본을 빌드해 실제 Windows 파일로 확인했습니다. 실험 파일은 지웠고 main은 변경 없음(clean)입니다.

## 1. [중간] `src/workspace/workspace.ts:205-227` 해시 비교 뒤 덮어쓰기 경쟁

- 해시 비교(212)와 rename(227) 사이에 사용자가 파일을 고치면, 그 내용이 사라지는데도 결과는 `ok`입니다. 실제로 확인했습니다.
- 새 파일(`expectedHash:null`)도 같았습니다. 그 사이 생긴 파일을 덮어쓰고 `created:true`를 돌려줍니다.
- 재현 테스트: "writeNewFile 직전에 대상을 바꾸는 주입 FileLayer → writeText가 conflict를 내야 하는데 ok가 나고 사용자 바이트가 사라짐."
- 수정 제안: 새 파일은 `fs.link(temp, target)`처럼 대상이 이미 있으면 실패하는 방식으로 막을 수 있습니다. 덮어쓰기는 rename 직전에 해시를 다시 확인해 시간 창을 줄이는 정도만 가능합니다(완전한 해결은 잠금이 필요).

## 2. [중간·설계] `src/policy/index.ts:77-85` 추가 인자 경로 검사 없음

- `allowExtraArgs:true`이면 추가 인자에 경로 검사가 없어서, 명령 허용이 경로 허용을 대신합니다.
- `node --test` 규칙에 다음 인자를 붙여도 `checkEffective`가 `allowed:true`입니다(확인).
  - `../../outside/x.test.mjs`
  - `--test-reporter-destination=C:/outside/r.txt`
  - `--import=./evil.mjs`
- 계약의 접두 일치 규칙 그대로라 코드 결함은 아니고 문서화나 계약 판단 대상입니다.
- 재현 테스트: "접두 일치 뒤의 루트 밖 경로 인자가 허용됨."

## 3. [낮음] `src/policy/index.ts:88,146,168` 토큰처럼 보이는 파일 이름 오거부

- `CODARYN_SECRET` 조각만으로 토큰으로 판단합니다.
- 그래서 `codaryn_secret_notes.md` 같은 정상 이름은 토큰이 없어도 두 단계(checkRequested, checkEffective) 모두 `restore_denied`이고 접근할 수 없습니다(확인).
- 거부 쪽이라 유출 위험은 없습니다.
- 재현 테스트: "토큰 없는 경로가 restore_denied로 거부됨."

## 4. 문제 없음 (실제 파일로 확인)

아래 경로는 모두 예상대로 막히거나 처리됐습니다.

- 루트 밖: 정션 바깥(있는 파일과 없는 파일), `a.txt/../../outside`, 루트 밖 절대 경로, `/a.txt`
- `.codaryn`: 정션 별칭, 8.3 이름 `CODARY~1/`(있는 파일과 없는 파일), `.CODARYN`, `.codaryn.`, `.codaryn `
- 형식 오류: `::$DATA`·`:ads`, `\\?\`·UNC, `C:a.txt`, `NUL`·`con.txt`

루트를 대문자로 쓴 경로는 정상 허용됩니다. `sub/.codaryn`은 계약상 허용 대상입니다.

## 5. 재현 안 됨

"Windows가 cwd의 `node.exe`를 PATH보다 먼저 실행한다"는 추측은 실험 결과 PATH의 node가 실행돼서 문제가 아닌 것으로 확인했습니다.

## 6. 검사하지 않은 범위

resolve와 사용 사이에 링크를 바꿔치기하는 경쟁, 하드 링크, 상대 경로가 든 PATH 항목, POSIX와 macOS 동작, 강제 종료 시 원자성은 통합 검증 소관이라 보지 않았습니다.
