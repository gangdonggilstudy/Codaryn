# V48 SHA 형식 출처 확인

codex-audit, 2026-11-14. **판정: 해시는 모두 해당 바이트 형식에 맞다. TS의 차이는 archive CRLF와 raw Git LF뿐이며 제품 차이가 아니다. U330 진행을 멈출 사유가 없다.** 기존 V48 보고서·증거·기대값·봉인은 수정하지 않았다.

Git 출력은 PowerShell의 문자열/줄 끝 변환을 거치지 않도록 Node spawnSync의 **Buffer**로 `git cat-file blob`에서 받았다. ZIP 멤버도 직접 메모리에서 읽어 압축을 풀었고 기존 추출 파일과 바이트 단위로 대조했다.

| TS 원천 | 바이트 | LF 총수 | CRLF | 단독 LF | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| V48 `head.zip`의 canonical args.ts | 28,527 | 594 | 594 | 0 | `547a254b1cd31a41a4cc1b690b081cd835391725cde208bd7547eb1399df281f` |
| board79371e7d raw Git canonical | 27,933 | 594 | 0 | 594 | `d62ebafaacba095177a4141145c7086ee1347a934e520980d25f8affd5910dec` |
| 채택056ed984 / 문서3fe4ada6 raw Git canonical | 27,933 | 594 | 0 | 594 | 위 raw Git과 동일 |
| 원래 봉인 base.zip의 OLD CLI args.ts | 28,534 | 594 | 594 | 0 | `4462c77de315ab3029ff10a716a3f4e8ea4d1cb4084da013279f5724b547d9d5` |
| 원래 d1a95ce2 / 실제 부모280d148e raw Git OLD | 27,940 | 594 | 0 | 594 | `75889f8344729a4d51d581a34edc67db539cb84dba0478fa5519d09200af9017` |

모두 단독 CR은 0이고 마지막 줄 끝도 각자의 CRLF/LF 형식이다. 두 archive는 각각 기존 추출 source와 **완전히 동일**했다. canonical과 OLD 각각에 대해 **메모리에서 CRLF→LF만 변환하면 해당 raw Git과 바이트 동일**, 역방향 LF→CRLF만 변환해도 archive와 바이트 동일함을 확인했다. 각각의 크기 차이는 정확히 **594바이트**다. 공백·주석·EOF 줄 수나 다른 문자를 바꾸지 않았다.

board79371e7d / 채택056ed984 / CP41 `3fe4ada6182cbf3db3dbcee39c872cd318c5748e`의 canonical raw blob은 전부 동일하다. Git blob 식별자(SHA-1)도 `025a6ad260266778b8bfd237a19824b0f789bdea`로 같다. 위 SHA-256과 Git object ID는 서로 다른 종류의 지문이다.

V48의 나머지 보고 지문도 기존 산출물을 읽어 재확인했다. 이들은 TS archive와 달리 **LF** 산출물이며 새로 빌드하거나 재생성하지 않았다.

| 기존 산출물 | 바이트 | LF / CRLF | SHA-256 |
| --- | ---: | ---: | --- |
| OLD compiled args.js | 22,470 | 447 / 0 | `1c36e4a6ef332c5e3ad1f9376c260e61819e81312f22773ac0a684fb90969676` |
| canonical compiled args.js | 22,476 | 447 / 0 | `ccf1f0388460c204984f9e4406deeb1429c15b4513dc9af0e3b5e494151c5c66` |
| 원래 expected.json | 444,263 | 8,510 / 0 | `e144286cd9658ea8877f965d39d0398de21b9042684643632d8b93809dc69b8d` |

실제 수행: git status/branch/root와 고정 ref/blob 조회, Node stdin 스크립트의 fs.readFileSync·ZIP 멤버 해제·raw cat-file·SHA-256·줄 끝 계수·Buffer 비교뿐이다. 줄 끝 변환은 이 출처 확인을 위한 **메모리 비교에만** 썼다. 기존 oracle의 정규화를 늘리거나 파일을 변환하지 않았다. build/시험/capture/재봉인·제품/worker/Git 변경·API/키 파일/외부 네트워크·권한 상승은 없었다. 새로 쓴 파일은 이 설명서 하나다.
