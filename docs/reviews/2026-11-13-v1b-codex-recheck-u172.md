# V-1b U-172 재확인

- 검증자 codex-check(보안·검증), 대상 `bf653d9` (`pm/unit-U-172b`).
- **남은 지적: 높음 1 / 중간 0 / 낮음 0.** V-1 H-1 경로 경계 우회는 미종결, L-1 잠금 false 처리는 종결. 같은 원인의 읽기·쓰기 사례는 합산하지 않았다.
- 증거 폴더: [codex-check-v1b-bf653d9-1794552861446](./codex-check-v1b-bf653d9-1794552861446/). Windows, 실제 파일·정션과 합성 텍스트만 사용. 제품 소스 수정·커밋·푸시·외부 네트워크·실제 API·키 조회·권한 요청 0.

## 높음 H-1: 두 차례 경로 순회와 최종 rename에도 경주가 남는다

재현 명령: 사본 폴더에서 `node probe-v1b.mjs`. [스크립트](./codex-check-v1b-bf653d9-1794552861446/probe-v1b.mjs), [결과](./codex-check-v1b-bf653d9-1794552861446/probe-v1b-results.json), [로그](./codex-check-v1b-bf653d9-1794552861446/probe-v1b.log).

### 읽기: 두 순회 모두 서로 다른 시점의 신원을 모으면 검사 통과

- 위치: `src/app/workspace-text.ts`의 `walk`, `open`, `readThrough`.
- 첫 순회의 부모 `sub` lstat 이후, 파일 lstat 이전(`walking`)에 원래 부모를 `sub-old`로 옮기고 `sub → outside` 정션 생성.
- 첫 순회는 원래 부모 신원과 바깥 파일 신원을 함께 기억한다. 열린 파일 핸들의 신원도 바깥 파일과 같아 통과한다.
- 핸들 확인 뒤 두 번째 순회 전(`opened`)에 정션을 제거하고 원래 부모를 복원한다.
- 두 번째 순회의 부모 lstat가 실제 원래 디렉터리 정보를 얻은 직후, 마지막 파일 lstat 전에 다시 정션으로 바꾼다.
- 두 순회의 신원 배열이 같아지고, 바깥 파일 핸들에서 읽은 글이 `opened`로 반환된다.
- `outside` 대상 **3/3**, `.codaryn/hidden` 대상 **3/3** 원문 반환. 두 대상 모두 검증자 소유 임시 폴더이며 실제 비밀은 없다.
- 끼어들기: 공개 앱 API의 시험용 pause와 실제 `fs.promises.lstat` 반환 경계. 원래 I/O 함수·반환값을 그대로 사용하고 경로만 바꿨다. 제품 소스는 수정하지 않았다.

### 쓰기: 최종 검사와 경로 rename 사이의 바꿔치기는 실제 바깥 파일을 바꾼다

- 위치: 같은 파일 `replaceChecked`의 `readThrough` 해시 확인 → `before_rename` → `rename(temporary, target)` → 사후 순회.
- 마지막 확인 뒤 임시 파일을 바깥 폴더로 옮기고, 부모를 그 폴더의 정션으로 교체한다.
- 앱의 rename이 바깥 `a.txt`를 실제로 교체한 뒤 `path_changed`, digest null을 반환한다. 원래 `sub-old/a.txt`는 보존된다.
- `outside` 대상 **3/3**, `.codaryn/hidden` 대상 **3/3** 파일 변경. 교체 순간 작업 공간 잠금은 모두 held. 오류 상태로 알리는 것이 변경 방지는 아니다.
- 임시 파일 단계에도 틈이 있다. 첫 쓰기 경로 확인 → `before_temp` → 배타 생성 사이에 정션으로 바꾸면 바깥 임시 파일에 글을 쓴다. 단방향 교체 2건은 다음 확인에서 지워졌지만, 핸들 close 후 다음 확인 전에 원래 부모를 복원한 **2/2건은 refused를 반환하면서 바깥 임시 파일·글을 남겼다**.
- 구현자 설명에 최종 rename·임시 파일 틈은 이미 명시되어 있다. 위 읽기 재현은 두 순회를 함께 통과한다.

## 종결 L-1 및 정상 사용 수치

| 항목 | 결과 |
| --- | --- |
| releaseLock이 계속 false | 2회 시도, written / lockLeft true, 실제 held |
| 첫 false 후 실제 해제 true | 2회 시도, written / lockLeft false, 실제 none |
| 해제 예외 | 2회 시도, written / lockLeft true, 실제 held |
| 실제 저장소 해제의 false | before_rename에서 합성 lock.json의 runId 교체; written / lockLeft true, 실제 held |
| 정상 LF·CRLF+BOM·한글·개행 없음·동일 글 | 5/5 정상, 읽기 opened·editable true, 저장 written 4 / unchanged 1, 바이트 일치 5, 잠금 잔류 0, 거짓 거부 0 |

## 명령과 전체 검증 수치

`$V`는 위 증거 폴더의 절대 경로다. 관련 시험의 TEMP·TMP는 `$V/test-tmp`로 지정했다.

| 명령 | 결과 |
| --- | --- |
| `git status --short; git branch --show-current; git rev-parse --show-toplevel` | 시작 main, 추적 변경 출력 0행, D:/project/Codaryn |
| `git archive --format=tar --output="$V/snapshot.tar" bf653d9`; `tar -xf "$V/snapshot.tar" -C $V` | 종료 0 |
| `node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false` | 종료 0; 설치 0회 |
| `node --test --test-timeout=30000 dist/tests/unit/app/u172-workspace-text.test.js dist/tests/unit/app/u172-v1-races.test.js` | 종료 0, **28시험 / 4묶음 / 통과 28 / 실패·취소·건너뜀 0**, 423.2801ms |
| `node probe-v1b.mjs` | 종료 0, **41기록**: 정상 5, 읽기 경주 12, 쓰기 경주 20, 잠금 4 |
| 읽기 경주 | 경계 밖 글 반환 **6/12** |
| 쓰기 경주 | 바깥 대상 파일 변경 **6/20**, 별도 임시 파일의 일시적 외부 쓰기 2건·외부 잔류 2건 |
| 단방향 바꿔치기 | 읽기 6건 원문 반환 0, 쓰기 12건 대상 파일 변경 0. 이 중 opened 시점 4건은 Windows EPERM으로 교체 자체가 실패했으므로 제품 방어 성공으로 세지 않음 |

전체 시험 묶음, 다른 OS, 별도 공격 프로세스의 확률적 성공률은 미실행. 기존 두 시험 파일은 통과하지만 최종 rename의 외부 변경을 path_changed로 보고하는 것 자체를 기대값으로 삼고 있어 경계 밖 변경 0건의 근거가 되지 않는다.



## PM 덧붙임

- 이 파일은 처음에 PM이 Codex의 재현 기록에서 집계를 옮겨 적은 것이었다(Codex가 보고서를 쓰기 전에 멈췄기 때문). 그 뒤 Codex가 보고서를 써서(16:22) 그 글로 바꿨다. 집계 수는 같다.
- 사용자 결정(DR-73): 남은 높음 1건(폴더 바꿔치기 경주)은 알려진 한계로 적고 진행한다.
