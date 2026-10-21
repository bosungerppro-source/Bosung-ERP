# 13차 — 수주 강제 완료 (완료 버튼 · 납기 기준 일괄 완료) (2026-10-21, v1.8.0)

대상: 12차(v1.7.1) 소스. 요청 · 결정 · 규칙은 `docs/PROMPT_v13_PO_DONE.md`, 개발 규칙은 `docs/CLAUDE_PROMPT.md` 2-12.

## 요청
- 수주 등록(2026-10-21 `수주등록.xlsx`)한 것 중 2025년 1월 ~ 2026년 9월은 모두 납기완료, 10월 것부터 시작.
- 수주 목록에 강제로 완료하는 완료 버튼.

## 물어서 정한 것
- 기간의 기준 = **납기(Checking)** (수주일 기준이면 9월 전에 받았지만 납기가 10월 이후인 26줄도 완료가 됨).

## 자료 확인 (이 PC 의 ERP)
- PO 줄 485 · PO 번호 있는 줄 413 (PO 409개, 다품번 5) · PO 번호 없는 2025 월 합계 줄 72 · 취소 · 보류 29줄 · 포장 실적 0.
- 엑셀의 달성률 · OK 칸은 10 · 11월 줄도 1 · OK — 완료 표시로 쓸 수 없음.
- 납기 기준: 진행 중 347줄 → 완료, 남는 PO 37 (납기 10월 19 · 11월 8 · 12월 7 · 2027-01 3).

## 한 일
- `schema.js`: PO 칸 `done_at` (완료 처리일).
- `calc.js`: 줄 상태에 강제 완료 (`done_at` → done, 취소 · 보류가 여전히 이김), `forced` · `doneAt`, `C.closeLines` · `C.reopenLines` · `C.closeByDue` (업로드 이력 `po_close`).
- `p_orders.js`: 수주 목록(PO별 보기) 줄 끝 **완료** / **완료 취소** 버튼 (확인 창, 줄 선택은 그대로), 상세 칸 **완료 처리** / **완료 취소** 버튼과 "완료 처리 (날짜)" 표시.
- `assistant_tools.js`: 강제 완료면 남은 세트 0, `marked_done`.
- 버전 1.8.0, 새 시험 `tools/selftest_v13.js` (`npm run test:v13`).

## 검증 (Windows 11 · Chrome, 사용자 PC)
- `npm run test:v13` 27 / 27.
- `npm run test:v12` 123 / 123 · `npm run test:v11` 50 / 50 · `npm run test:v8` 72 / 72 · `npm run test:assistant` 290 / 290.
- `npm run test:v7` 149 / 149 (`ERP_PREV` = 1.7.1 소스 → 1.8.0 업그레이드).
- `npm run test:v9` 86 / 87 (Windows 환경 차이 1개, 이전과 같음).
