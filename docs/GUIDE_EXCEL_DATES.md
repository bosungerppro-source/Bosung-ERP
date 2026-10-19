# 현장 일보 엑셀 — 날짜 칸 입력 안내 / Hướng dẫn nhập ngày trong file báo cáo Excel

ERP 는 일보의 **생산일자** 칸으로 그날의 실적을 넣습니다. 날짜가 틀리면 실적이 다른 날로 들어가거나 반영되지 않습니다.
ERP lấy **Ngày sản xuất** trong báo cáo để ghi sản lượng cho ngày đó. Ngày sai thì sản lượng bị ghi vào ngày khác hoặc không được ghi.

## 1. 실제로 있었던 일 / Ví dụ thực tế (báo cáo ngày 08/10/2026)
| 일보 / Báo cáo | 생산일자 칸 / Ô ngày | 저장된 값 / Giá trị lưu | 화면 표시 / Hiển thị | 결과 / Kết quả |
|---|---|---|---|---|
| 포장 · Đóng gói | M3 | 2026-10-08 | 8/10/2026 | ✓ 맞음 / Đúng |
| 리필 성형 · Ép lõi | N5 | 2026-10-08 | 08.10.2026 | ✓ 맞음 / Đúng |
| 조립 · Lắp ráp | L4 | 2026-10-08 | 10/8/26 | ✓ 값은 맞지만 월/일 순서로 보여 헷갈림 / Giá trị đúng nhưng hiển thị tháng/ngày, dễ nhầm |
| 종이 권취 · Quấn giấy | I3 | **2026-08-10** | 8/10/26 | ✗ **8월 10일로 저장됨** — 10월 8일을 미국식(월/일) 엑셀에 입력 / **Bị lưu thành 10 tháng 8** — gõ ngày 8/10 trên Excel kiểu Mỹ (tháng/ngày) |

엑셀은 날짜를 **입력하는 순간** PC 의 날짜 형식(일/월 또는 월/일)으로 해석해 숫자로 저장합니다. 나중에 표시 형식만 바꿔도 이미 틀린 값은 고쳐지지 않습니다.
Excel hiểu ngày **ngay lúc gõ** theo định dạng ngày của máy (ngày/tháng hoặc tháng/ngày) rồi lưu thành số. Đổi định dạng hiển thị sau đó không sửa được giá trị đã sai.

## 2. 규칙 / Quy tắc
1. **생산일자는 "2. 생산일자 / Ngày sản xuất" 글자 바로 오른쪽 칸**에 넣습니다 (양식의 위쪽 9줄 안). 칸을 옮기거나 지우지 마세요.
   Nhập ngày vào **ô ngay bên phải chữ "2. 생산일자 / Ngày sản xuất"** (trong 9 dòng đầu). Không di chuyển hay xóa ô này.
2. **연도까지 4자리로, 일 먼저** 입력합니다: `08/10/2026`. 가장 안전한 방법은 **`2026-10-08`** (년-월-일) — 어느 PC 에서나 같은 날짜로 저장됩니다.
   Gõ **đủ năm 4 số, ngày trước**: `08/10/2026`. Cách an toàn nhất là **`2026-10-08`** (năm-tháng-ngày) — máy nào cũng hiểu giống nhau.
   - ✗ `8/10` (연도 없음 / thiếu năm) · ✗ `10/8/26` · ✗ `8-10` · ✗ `08.10` 
   - 오늘 날짜는 `Ctrl` + `;` / Ngày hôm nay: `Ctrl` + `;`
3. 칸 표시 형식은 `dd/mm/yyyy` 로 둡니다 (셀 서식 → 사용자 지정). 날짜가 **오른쪽 정렬**이면 엑셀이 날짜로 알아본 것이고, 왼쪽 정렬이면 글자입니다.
   Định dạng ô là `dd/mm/yyyy` (Format Cells → Custom). Ngày **căn phải** là Excel đã hiểu là ngày; căn trái là chữ.
4. **파일 이름에도 같은 날짜**: `Bao_cao_lap_rap_08-10-2026.xlsx` (일-월-년) 또는 `..._2026-10-08.xlsx`. ERP 는 파일 이름 날짜와 생산일자가 다르면 노란 경고를 보여줍니다.
   **Tên file có cùng ngày**: `Bao_cao_lap_rap_08-10-2026.xlsx` (ngày-tháng-năm) hoặc `..._2026-10-08.xlsx`. ERP cảnh báo màu vàng nếu ngày trong tên file khác ngày sản xuất.
5. **한 파일 = 하루 · 한 공정 · 한 조**. 주간 / 야간은 시트 이름(`Ca ngày` / `Ca đêm`)이나 일보의 DAY/NIGHT 칸으로 구분합니다. 1층 / 2층은 "1. 작업장명" 칸에 적습니다.
   **Một file = một ngày · một công đoạn · một ca**. Ca ngày / ca đêm theo tên sheet (`Ca ngày` / `Ca đêm`) hoặc cột DAY/NIGHT. Tầng 1 / tầng 2 ghi ở ô "1. Tên công đoạn".

## 3. 엑셀 입력 제한 걸기 (양식마다 한 번) / Đặt giới hạn nhập (mỗi mẫu một lần)
생산일자 칸에 날짜가 아닌 값이 들어가지 않게 막습니다. / Chặn nhập giá trị không phải ngày vào ô ngày sản xuất.
1. 생산일자 칸 선택 → **데이터 → 데이터 유효성 검사** / Chọn ô ngày → **Data (Dữ liệu) → Data Validation (Xác thực dữ liệu)**
2. 제한 대상 **날짜**, 제한 방법 **해당 범위**, 시작 `2026-01-01`, 끝 `2030-12-31` / Allow (Cho phép) **Date (Ngày)**, Data **between (nằm giữa)**, Start `2026-01-01`, End `2030-12-31`
3. **오류 메시지** 탭: "날짜를 2026-10-08 또는 08/10/2026 처럼 넣으세요 / Nhập ngày dạng 2026-10-08 hoặc 08/10/2026" / Tab **Error Alert (Cảnh báo lỗi)**: nhập câu như trên
4. 양식 파일(원본)을 저장해 두고 매일 복사해서 씁니다. / Lưu file mẫu gốc, mỗi ngày sao chép ra dùng.

## 4. PC 날짜 형식 확인 / Kiểm tra định dạng ngày của máy
- Windows **설정 → 시간 및 언어 → 언어 및 지역 → 지역 형식** 이 `베트남어(베트남)` 이면 간단한 날짜가 `dd/MM/yyyy` 입니다. `영어(미국)` 이면 `M/d/yyyy` 라서 `8/10` 이 8월 10일이 됩니다.
  Windows **Settings → Time & language → Language & region → Regional format**: `Tiếng Việt (Việt Nam)` thì ngày là `dd/MM/yyyy`; `English (United States)` thì `M/d/yyyy` nên `8/10` thành 10 tháng 8.
- 현장 PC 의 형식을 하나로 맞추거나, 위 규칙 2 의 `2026-10-08` 형식으로 입력하면 형식과 상관없이 맞습니다.
  Thống nhất định dạng các máy ở xưởng, hoặc gõ dạng `2026-10-08` (quy tắc 2) thì máy nào cũng đúng.

## 5. ERP 에서 확인 / Kiểm tra trên ERP
- **엑셀 · 구글 연동 → 엑셀 업로드** 미리보기에 일보마다 날짜가 보입니다. 날짜를 읽지 못하면 빈칸으로 나오고, 날짜를 넣어야 반영됩니다.
  Màn hình xem trước **Excel · Google → Tải Excel** hiện ngày của từng báo cáo. Không đọc được ngày thì để trống — phải nhập ngày mới áp dụng được.
- 파일 이름 날짜와 다르면 노란 경고와 **파일명 날짜 적용** 버튼이 나옵니다.
  Nếu khác ngày trong tên file sẽ có cảnh báo vàng và nút **Dùng ngày tên file**.
- 잘못 반영했으면 바로 **되돌리기**를 누르고, 엑셀의 날짜를 고쳐 다시 올립니다.
  Nếu lỡ áp dụng sai, bấm **Hoàn tác** ngay rồi sửa ngày trong Excel và tải lại.

## 6. 반장 확인표 / Bảng kiểm tra cho tổ trưởng
- [ ] 생산일자 칸이 날짜(오른쪽 정렬)이고 연도 4자리 / Ô ngày là ngày (căn phải), năm 4 số
- [ ] 생산일자 = 파일 이름 날짜 = 실제 생산한 날 / Ngày sản xuất = ngày trong tên file = ngày làm thực tế
- [ ] 주간 · 야간 시트 이름 또는 DAY/NIGHT 칸 / Tên sheet ca ngày · ca đêm hoặc cột DAY/NIGHT
- [ ] 작업장(1층 · 2층) 칸 / Ô tên công đoạn (tầng 1 · tầng 2)
- [ ] 수불 양식 · KHO NVL 입출고장의 날짜 열도 같은 규칙 / Cột ngày trong mẫu nhập xuất · sổ KHO NVL cũng theo quy tắc này
