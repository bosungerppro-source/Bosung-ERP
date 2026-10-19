# 9차 — 여러 PC 동시 사용 · 보안 · 자동 백업 · AI 비서 (2026-10-19, v1.4.0)

대상: 8차(v1.3.0) 소스. 문제 · 결정 · 규칙은 `docs/PROMPT_v9_MULTIPC_AI.md`, 개발 규칙은 `docs/CLAUDE_PROMPT.md` 2-8.

## 한 일
### 여러 PC · 보안 · 백업 (커밋 84e1eef)
- 서버(`server.js`): 표마다 저장 번호(`versions.json`) · 409 충돌 응답 · `PATCH /api/meta` · `/api/versions` · `GET /api/t/:name` → `{rows, ver}`. 저장 번호 없이 보내는 옛 화면(1.3.0)의 PUT 은 그대로 받음.
- 화면(`db.js`): 행 지문(`_base`) + `merge3` 로 행 단위 합치기, 설정 항목별 저장, 20초 · 창 포커스 불러오기, 저장 실패 다시 시도(2초 → 1분), `flush()` 가 보내는 중인 저장 · 설정까지 기다림, 사내망 PIN 화면.
- 화면 다시 그리기(`main.js`): 다른 PC 변경 → 조용하면(창 · 입력 · 끌기 없음, 3초) `ERP.refresh()` (창 · 표 스크롤 유지), 아니면 "다른 PC 변경 있음 · 새로 고침".
- 보안: Host · Origin · JSON 검사, `ERP_ALLOW_HOSTS`, 정적 파일 경로(`appDir + sep`), 사내망 PIN(pbkdf2 · 잠금 · 쿠키 7일 · loopback 면제), Electron 바깥 링크 http/https 만 · ERP 창 이동 막음.
- 자동 백업: 폴더(보관 개수) + 구글 드라이브(Code.gs 3판 `backup`, gzip), 설정 카드 · 메뉴 "자동 백업 폴더 고르기…", 이틀 넘게 실패하면 알림, `.json.gz` 복원, Apps Script 주소만 허용.
- 시험 `tools/selftest_v9.js` 87개 (1.3.0 코드에서는 동시 수정 · 설정 · Host · Origin · 옆 폴더 파일 · PIN · 백업 등이 실패하는 것을 확인).

### AI 비서
- 재시작하면 AI 모드가 꺼지던 문제: 서버 모드를 알기 전에 키 설정을 읽었음 → `ERP.aiReady` 에서 읽음.
- 대화: 뒤에 붙이기만 · 시스템 프롬프트 고정 · 바뀐 날짜 · 언어 · 설정은 `role: "system"` 메시지 · 30만 자 넘으면 요약으로 새 대화 · 실패한 질문만 되돌림.
- 요청: `max_tokens` 16000 · effort low/medium · 프롬프트 캐시 · `fallbacks: "default"` (claude-sonnet-5-5 등) · 429/529/503 retry-after · 받지 않는 항목은 끄고 다시 · refusal / max_tokens 는 기록에 안 남김 · `is_error` · 마지막 호출 `tool_choice: none` · 도구 결과 `_total/_truncated`.
- 중계(`aiBody`): 모델 = 서버 설정 · 정해진 필드만 · 서버 도구 거절 · 하루 호출 한도(기본 400) · 사용량 `ai_usage.json` · retry-after 전달. Electron `net.fetch`.
- 데모 키는 메모리에만. 사내망 브라우저는 내 비서 설정만 저장. AI 연결 시험에 모델 · 걸린 시간.
- 내장 모드: 잘못 알아듣던 질문 23개(ép lõi · 생산 지연 PO · đã làm xong · 품번+재고 · 모자란 자재 · chất lượng / phế phẩm / hàng hỏng · máy nào dừng nhiều nhất · sử dụng máy · PO tạm ngưng / 보류 / 취소) 고침, 생산 실적에 공정별 가동 설비 수, MRP 의 "모두 충분" 문구.

## 숫자
- 예시 자료(prod_log 21,631행 등 40,281행)에서 행 지문 계산 25ms, prod_log 합치기 85ms, prod_log 저장 약 0.95초 (서버 기록 포함).
- 시험 수: v9 87 (새로) · assistant 240 → 289 · v8 72 · v7 149.

## 검증
- `npm run test:v9` 87개 통과 · `npm run test:assistant` 289개 통과 · `npm run test:v8` 72개 통과 · `npm run test:v7` 149개 통과(`ERP_PREV=<v1.2.0 소스>` 로 1.2.0 데이터 폴더 → 1.4.0 실제 업그레이드 포함) · `npm test -- seed/factory` 오류 0.
- 빌드: `ColorPencil-ERP-Setup-1.4.0.exe` 84,093,200 바이트, SHA-256 `e89ff1f1f6f56ef7f19ada3bcd195c8897bf6001d16481b7feb3c68ae7e9116b`. 설치 파일 안 app.asar 의 app/ · server.js · electron/ = 소스와 같음, package.json version 1.4.0.
- Windows 에서의 설치 · 실행 · 사내망 · 실제 AI 키 시험은 사용자가 확인 (이 환경은 Linux, 실제 Anthropic API 는 부르지 않음).

## 남은 확인 (사용자)
- 사내망을 쓰면 ERP PC 의 설정에서 PIN 정하기 (안 정하면 다른 PC 는 못 들어옴).
- 자동 백업 폴더 지정. 구글 드라이브 백업을 쓰면 Code.gs 3판 다시 배포 + 설정에서 켜기.
- AI: 키 넣고 AI 연결 시험, 하루 한도 확인. 거절 시 다른 모델로 답하는 fallbacks 가 켜져 있음.
- 두 PC 로 같은 화면을 동시에 고쳐 보기 (예: 수주 메모), 다른 PC 브라우저로 PIN 넣고 들어가 보기.
