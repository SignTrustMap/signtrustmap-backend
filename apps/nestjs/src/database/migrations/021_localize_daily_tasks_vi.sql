-- Localize standard daily tasks to Vietnamese
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

