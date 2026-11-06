# [BUG] Sửa lỗi bảng mã UTF-8 cho tên và mô tả nhiệm vụ trong bảng daily_tasks

- **Repository**: `SignTrustMap/signtrustmap-backend`
- **Module liên quan**: `apps/nestjs/src/modules/daily-tasks/`
- **Mức độ ưu tiên**: Medium
- **Loại**: Bug fix / Database encoding

---

## 1. Mô tả vấn đề (Problem Description)
Khi người dùng truy cập trang Ví trên Web hoặc gọi API `GET /api/v1/daily-tasks`, tên và mô tả của các nhiệm vụ đóng góp hằng ngày bị lỗi font hiển thị dấu hỏi chấm (`???`):

- `Kh???o s??t 3 bi???n b??o` (+30 Credits)
- `X??c minh 5 bi???n b??o ???ng vi??n` (+25 Credits)
- `B??o c??o s??? c??? ???????ng b???` (+15 Credits)
- `T??i x??c th???c 2 bi???n b??o` (+20 Credits)

## 2. Nguyên nhân gốc rễ (Root Cause)
Dữ liệu trong bảng `daily_tasks` trên cơ sở dữ liệu PostgreSQL máy chủ (hoặc container DB) được nạp dữ liệu khi kết nối client chưa thiết lập bảng mã `UTF-8`. Các ký tự tiếng Việt đa byte (`ả`, `á`, `ể`, `ệ`, `ộ`) bị chuyển thành dấu chấm hỏi `?` và lưu chết vào cột `name` và `description`.

Khi Backend NestJS (`DailyTasksService.listTasksWithProgress` / `listActive`) truy vấn `SELECT * FROM daily_tasks`, database trả về chuỗi đã bị lỗi `???` này gửi về cho client.

## 3. Các bước khắc phục (Solution)

Tạo migration mới hoặc chạy script SQL cập nhật dữ liệu với bảng mã UTF-8:

```sql
SET CLIENT_ENCODING TO 'UTF8';

UPDATE daily_tasks
SET
    name = CASE task_code
        WHEN 'SURVEY_3' THEN 'Khảo sát 3 biển báo'
        WHEN 'REVIEW_5' THEN 'Xác minh 5 biển báo ứng viên'
        WHEN 'HAZARD_1' THEN 'Báo cáo sự cố đường bộ'
        WHEN 'REVALIDATE_2' THEN 'Tái xác thực 2 biển báo'
        ELSE name
    END,
    description = CASE task_code
        WHEN 'SURVEY_3' THEN 'Đóng góp và tải lên 3 bản ghi hoặc hình ảnh biển báo giao thông'
        WHEN 'REVIEW_5' THEN 'Tham gia đồng thuận cộng đồng bằng cách duyệt 5 biển báo ứng viên'
        WHEN 'HAZARD_1' THEN 'Cảnh báo cộng đồng về mối nguy hiểm hoặc sự cố tạm thời ven đường'
        WHEN 'REVALIDATE_2' THEN 'Hoàn thành minh chứng tái xác thực cho 2 biển báo sắp hết hạn'
        ELSE description
    END,
    updated_at = NOW()
WHERE task_code IN ('SURVEY_3', 'REVIEW_5', 'HAZARD_1', 'REVALIDATE_2');
```

## 4. Kiểm tra xác nhận (Verification)
Gọi API:
```bash
curl -X GET "https://api.signmap.site/api/v1/daily-tasks" \
  -H "Authorization: Bearer <TOKEN>"
```

Dữ liệu trả về đúng chuẩn tiếng Việt:
- `SURVEY_3` -> `Khảo sát 3 biển báo`
- `REVIEW_5` -> `Xác minh 5 biển báo ứng viên`
- `HAZARD_1` -> `Báo cáo sự cố đường bộ`
- `REVALIDATE_2` -> `Tái xác thực 2 biển báo`
