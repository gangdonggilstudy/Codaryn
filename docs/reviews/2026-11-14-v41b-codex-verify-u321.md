# V-41b — U-321 최종 통합 판 독립 재검증

- 담당: codex-sec. 2026-11-14. 읽기 전용 검증.
- 판: **`00f7085cc3dc77cb756ecd1c0eff5482832a7e94`**, `main a9faa541 + U-321 399f7731`. C7b가 포함된 최종 판을 새로 git archive 추출·오프라인 설치·빌드했다.
- 사본: `.worktrees/codex-verify/.codaryn/codex-sec-v41b/head`.
- **신규 발견/회귀: 높음 0 / 중간 0 / 낮음 0.** 사전에 준비된 상태 정션·로그 하드 링크 차단과 지정 교체 경계의 검증 결과가 분기 판과 같다.
- **기존 잔여 위험은 유지된다:** V-41에서 명시한 중간 1건 경계의 두 TOCTOU 일정. 이번에도 재현했으며 완전한 race closure로 판단하지 않는다.

## 판의 동일성

다음 세 파일에 대한 `git diff --exit-code 399f7731 00f7085c -- <files>`는 출력 없음/종료 0이었다. 최종 archive의 파일도 그 판으로 빌드했다.

- `src/store/cleanup.ts`
- `tests/unit/store/u321-cleanup-metadata.test.ts`
- `tests/integration/u321-cleanup-metadata.test.ts`

분기 판과 최종 판의 제품 소스 차이는 C7b의 `src/cli/plan-commands.ts`, `src/cli/run.ts` 두 파일이다. cleanup 호출과 공개 앱 경로는 최종 판의 실제 빌드를 사용해 아래 사례로 다시 확인했다. PM의 전체 기능 oracle·전체 시험 결과를 이 검증의 실행 결과로 대신 기록하지 않았다.

## 최종 판에서 실행한 결과

| 항목 | 결과 |
|---|---|
| npm ci --offline / npm run build | 각각 종료 0 |
| U-321 전용 단위·통합 시험 2파일 | 22건 중 **20 통과 / 실패 0 / 건너뜀 2 / todo 0**, 3,656.9974ms |
| 원래 M1 재현 | state-junction/log-hardlink × CLI/공개 앱 4사례, 미리보기+적용 8회 |
| 선택 기록 보존 추가 재현 | 같은 4조합, 미리보기+적용 8회. 전체 기록 바이트·파일 목록 동일 |
| 정상 cleanup | 일반 로그/로그 없음 × CLI/공개 앱 4사례, 미리보기+적용 8회. 분기 판과 출력·로그 내용 동일 |
| 독립 store 경계 | 16사례. 시각 정규화 후 분기 판 16사례의 결과와 모두 동일 |

원래 M1의 빈 계획 재현에서 CLI는 `internal_error`/70, 앱은 `ok: false`/`internal_error`다. 바깥 합성 폴더에 `.gitignore`·로그·임시 잠금이 추가되지 않았고, 바깥 원문에 추가된 바이트는 0이다. 앱 harness 프로세스의 종료 0과 CLI 종료 70을 구분한다.

추가로 정상 실행 기록을 실제 scripted CLI seed에서 복제한 뒤 위험 메타데이터를 구성했다. 로그 하드 링크에서 선택된 journal/result/snapshots의 파일 목록과 전체 바이트가 호출 전후 같았다. 상태 정션은 원래 상태를 자기 saved-state로 옮긴 뒤 구성했고, 그 원본 기록도 전부 보존됐다. 거부 뒤 잠금은 없고 바깥 sentinel과 폴더 목록은 동일했다. 자료: `selected/<종류>/<cli|app>/result.json`.

정상 경로는 기존 `PRIOR BYTES`를 그대로 두고 cleanup JSON 한 줄만 추가하거나 새 로그에 한 줄을 썼다. 선택된 기록만 제거하고 잠금을 해제했다. en JSON/ko text와 공개 앱 반환을 분기 판 보존 결과에 대조했다. 시각만 정규화했다. 분기 V-41에서 같은 결과를 기준 `406d3860`과 대조한 바 있다. 따라서 이번 수치가 기준 판 전체 재실행을 뜻하지는 않는다. 권한 비트·inode의 동일성도 주장하지 않는다.

## 오류·교체 경계와 남는 조건

16개 독립 경계는 V-41의 재현기를 최종 빌드에 그대로 연결했다.

- 하드 링크·로그 디렉터리·open EACCES·open 뒤 fstat 오류·열기 직전/직후 inode 교체는 삭제 전에 거부했다. 선택 기록의 바이트를 보존했고 확보한 손잡이는 닫고 잠금은 해제했다.
- held lock/digest 불일치는 위험 로그 검사보다 우선했다. 로그 open 0, 선택 기록 보존.
- 삭제 시작 뒤 로그 경로를 바깥 sentinel의 링크로 바꾸면 append를 중단했다. 이미 일어난 삭제 결과는 유지하며 sentinel은 보존했다.
- append 실패와 close 완료 후 합성 예외는 삭제 결과/잠금 해제를 가리지 않았다. 실제 close 실패로 OS 손잡이가 남는 모든 경우의 정리를 입증한 것은 아니다.

다음 두 일정도 최종 판에서 다시 재현됐다. 둘 다 **기준 `406d3860`에서도 같은 외부 쓰기가 있었고, U-321의 신규 회귀는 아니다.** 상세 기준 대조와 조건은 [V-41 보고서](2026-11-14-v41-codex-verify-u321.md)의 R1/R2에 있다.

| 잔여 일정 | 최종 판 관측 | 근거 |
|---|---|---|
| 마지막 부모 검사 뒤, 최초 `.gitignore` write 직전에 state를 rename+outside 정션으로 교체 | outside/.gitignore에 정확히 `*`+LF **2바이트** 생성. 다음 신원 검사에서 거부. 선택 기록 바이트 보존 | `src/store/cleanup.ts:697`→`:698`→`:699`, `src/store/common.ts:31` |
| 마지막 로그 검사 뒤, 열린 손잡이 append 직전에 로그 inode의 바깥 hard-link alias를 추가 | outside/linked-log에 cleanup JSON **137바이트**가 보임. 원래 sentinel은 그대로이며 정상 삭제 결과 유지 | `src/store/cleanup.ts:829`→`:830` |

이 일정들은 실제 fs 경계에서 합성 교체 작업을 주입한 재현이다. 임의 경쟁의 발생 빈도를 측정한 것이 아니다. R2는 바깥 기존 파일을 덮어쓰는 재현이 아니라, 다른 작업이 만든 새 alias에도 같은 inode의 append가 보이는 재현이다. FileHandle 사용과 재검사는 이미 준비된 링크와 일부 교체를 차단하지만, 검사 뒤의 링크 추가/부모 변경을 원자적으로 막지 못한다.

## 건너뜀과 검증 한계

건너뜀 2건은 파일 symlink 생성 EPERM, 로그가 열린 부모 디렉터리의 rename을 Windows가 거부한 경우다. 뒤의 건너뜀을 구현이 부모 교체를 감지해 막은 것으로 계산하지 않는다. 가능한 NTFS 정션·하드 링크와 open 이전 교체는 실제로 시험했다.

이 보고는 사전에 준비된 M1 차단, 기록 보존, 정상 cleanup 및 명시한 교체 경계에 한정한다. **보편적인 경쟁 안전성·모든 작업 공간 밖 쓰기의 부재는 승인하지 않는다.** 전체 유닛/통합, GUI, smoke, CLI95는 PM 소유이며 여기서는 실행하지 않았다. 실제 API·키 파일·외부 네트워크·권한 상승·제품 소스 수정·커밋·push·worktree 추가도 하지 않았다. 모든 outside 대상은 자기 사본 내부의 합성 폴더다.

## 실행과 증거

```powershell
git diff --exit-code 399f7731 00f7085c -- src/store/cleanup.ts tests/unit/store/u321-cleanup-metadata.test.ts tests/integration/u321-cleanup-metadata.test.ts
git archive --format=tar --output=<자기 v41b/head.tar> 00f7085cc3dc77cb756ecd1c0eff5482832a7e94
npm.cmd ci --offline
npm.cmd run build
node --test dist/tests/unit/store/u321-cleanup-metadata.test.js dist/tests/integration/u321-cleanup-metadata.test.js
```

npm은 빈 user/global 설정과 자기 캐시를 사용했고 로컬 lockfile 공개 패키지 4개/10,655,176바이트만 준비했다. TEMP/TMP도 자기 tmp로 지정했다.

자기 `codex-sec-v41b`에서 실행한 재현기:

```powershell
node metadata-link.mjs
node selected.mjs
node edges.mjs head
node normal.mjs
node check.mjs
```

재현 폴더는 덮어쓰지 않으므로 새 전체 재현에는 새 출력 이름을 사용한다. 보존 결과 재검사는 `node check.mjs` 그대로 가능하다. 집계: `checked.json`, `related-tests.log`. 원시 CLI/app 결과는 `metadata-link`, `selected`, `normal`의 각 result.json, store의 실제 외부 효과는 `edges-head` 아래 파일과 result.json에 보존했다.

최종 통합 판의 지정된 한정 수정은 분기 검증 결과를 유지했다. 기존 잔여 경계를 명시한 범위에서 PM에게 판정을 제출한다.
