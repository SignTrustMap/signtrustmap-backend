# DANH SÁCH API — SignTrustMap Backend

> Tài liệu này tổng hợp **toàn bộ API** mà backend cung cấp cho **Frontend** (mobile/web app) và **AI / Pipeline** (trích xuất biển báo, chấm điểm đồng thuận, navigation) sử dụng.
> Mỗi endpoint gồm: HTTP method, đường dẫn, mô tả chức năng, yêu cầu xác thực, và tham số/body.
> **Nguồn**: trích xuất trực tiếp từ mã nguồn controller thực tế
> (`apps/nestjs/src/modules/**` và `apps/fastapi/app/api/v1/**`), không phải tài liệu ước lệ.

---

## 1. Tổng quan kiến trúc & Base URL

Backend gồm **2 service** độc lập, giao tiếp qua Redis Pub/Sub + internal HTTP:

| Service | Công nghệ | Base URL mặc định | Vai trò |
|---|---|---|---|
| **Business API** | NestJS | `http://localhost:3000/api/v1` | Auth, Wallet, Submission, Review, Revalidation, Catalog, Moderation, Admin, Places, Notification, Leaderboard, Daily Tasks |
| **Spatial & Navigation API** | FastAPI (Python + PostGIS) | `http://localhost:8000/api/v1` | Trắc đồ biển báo (GeoJSON), phiên navigation, WebSocket cảnh báo biển báo theo thời gian thực |

**Health / liveness probe** (Docker healthcheck, monitoring — không cần auth):

| Method | Path | Service | Mô tả |
|---|---|---|---|
| `GET` | `/health` | FastAPI (8000) | Kiểm tra sống còn Spatial API (không version prefix) |
| `GET` | `/api/v1/health` | FastAPI (8000) | Health có version prefix |

> **Lưu ý:** NestJS **không** có endpoint `/health` riêng. Để kiểm tra Business API còn sống, gọi `POST /api/v1/auth/login` — nhận `401 Unauthorized` nghĩa là server đang hoạt động bình thường (chỉ sai thông tin đăng nhập). Các route public không cần token của NestJS: `auth/register`, `auth/login`, OTP flows, Google OAuth, `payments/webhook`.

---

## 2. Quy ước chung

### 2.1 Xác thực (Authentication)
- Endpoint cần đăng nhập dùng **JWT Bearer Token** ở header:
  ```
  Authorization: Bearer <accessToken>
  ```
  `accessToken` lấy từ `POST /auth/login` hoặc `POST /auth/register`.
- **Public**: không cần token (`register`, `login`, OTP flows, Google OAuth, `/health`, `POST /payments/webhook`).
- **Role-guarded**: ngoài JWT còn cần role tương ứng (`@Roles('REVIEWER' | 'ADMIN' | 'SURVEYOR' | 'STAFF')`).
- **Internal endpoints** (path chứa `/internal/`): chỉ dành cho **AI Pipeline / service nội bộ**, bảo vệ bằng header
  ```
  x-internal-token: <INTERNAL_API_TOKEN>
  ```
  khớp biến môi trường server. **Frontend KHÔNG gọi nhóm này** — chúng được liệt kê riêng ở Mục 4.

### 2.2 Nhóm người dùng
| Nhóm | Endpoint chính |
|---|---|
| **Driver** (lái xe) | Places / Saved, Navigation (FastAPI), Wallet |
| **Surveyor** (khảo sát) | Submissions, Revalidation, Daily Tasks, Survey Home Stats |
| **Reviewer** (duyệt) | Reviews queue / vote / history, Catalog |
| **Staff / Admin** | Moderation, Admin Users, System Parameters, Audit Log, Leaderboard, Export |
| **AI Pipeline** | `/internal/*` (submissions/complete, active-learning, scoring, deduct, webhook settle) |

### 2.3 Định dạng dữ liệu
- Body request/response: **JSON** (`Content-Type: application/json`), trừ upload chunk dùng **`multipart/form-data`**.
- Ngày giờ: ISO-8601 (`2023-10-01T12:00:00Z`).
- Phân trang: `?page=1&pageSize=20` (mặc định khi thiếu).
- Tọa độ WGS84: `latitude` (−90..90), `longitude` (−180..180).

---

## 3. API cho FRONTEND — NestJS Business API
Base: `http://localhost:3000/api/v1`

### 3.1 Auth (`/auth`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Đăng ký tài khoản. Body `{email, password, fullName, phone?, role?}` → tạo `users`, gán role mặc định, tạo ví balance 0, trả `{user, accessToken}`. |
| `POST` | `/auth/login` | Public | Đăng nhập. Body `{email, password}` → xác thực bcrypt, trả JWT `accessToken` (nhúng `roles`). |
| `POST` | `/auth/forgot-password` | Public | Quên mật khẩu. Body `{email}` → sinh OTP gửi email (màn Forgot Password). |
| `POST` | `/auth/verify-otp` | Public | Xác minh OTP. Body `{email, otp}` → trả `{verified: true}` (màn OTP Verified). |
| `POST` | `/auth/resend-otp` | Public | Gửi lại OTP. Body `{email}`. |
| `POST` | `/auth/reset-password` | Public | Đặt lại mật khẩu. Body `{email, otp, newPassword}` → verify OTP rồi cập nhật hash mới. |
| `GET` | `/auth/google` | Public | Bắt đầu luồng Google OAuth (Social Login). |
| `GET` | `/auth/google/callback` | Public | Google callback → tạo `oauth_accounts` + phát JWT. |
| `GET` | `/auth/me` | JWT | Hồ sơ hiện tại: `id, email, fullName, roles` + `walletBalance` + `profileStats` (rating/km/tasks của driver, submission/approval của surveyor, reliability của reviewer). |
| `PATCH` | `/auth/me` | JWT | Cập nhật hồ sơ. Body `{fullName?, avatarUrl?, phone?}`. |

### 3.2 Wallet & Credit Economy (`/wallet`, `/payments`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/wallet` | JWT | Số dư ví + thông tin gói. Màn Wallet Overview & Credits. |
| `GET` | `/wallet/transactions` | JWT | Lịch sử giao dịch phân trang. Query: `page`, `pageSize`, `from` (YYYY-MM-DD), `to`, `type`. Màn Detailed Credit History (date range). |
| `GET` | `/wallet/top-up/packages` | JWT | Danh sách gói nạp tiền (`credit_rules`: 50/100/200/500...). |
| `POST` | `/wallet/top-up` | JWT | Nạp theo gói cố định. Body `{packageId}` → tạo `payment_orders` status `PENDING`. |
| `POST` | `/wallet/top-up/custom` | JWT | Nạp số tiền tự chọn (10–10000 credit). Body `{amount}` → tra `credit_rules` tính giá, tạo order `PENDING`. Màn Top Up Custom Amount. |
| `GET` | `/wallet/payment-methods` | JWT | Danh sách thẻ đã lưu. Màn Payment Methods. |
| `POST` | `/wallet/payment-methods` | JWT | Thêm thẻ mới. Body `{cardHolderName, cardLast4, cardBrand, expiryMonth, expiryYear, isDefault}`. Màn Add New Card. |
| `DELETE` | `/wallet/payment-methods/:id` | JWT | Xóa thẻ đã lưu. |

### 3.3 Survey Submission (`/submissions`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `POST` | `/submissions` | JWT (Surveyor) | Tạo submission `DRAFT` trước upload. Body `{submissionType, capturedAt, coordinateSource, note?}`. |
| `PATCH` | `/submissions/:submissionId` | JWT (owner) | Sửa capture time, coordinate source hoặc note khi submission còn có thể chỉnh sửa. |
| `POST` | `/submissions/:submissionId/uploads` | JWT (owner) | Tạo upload session cho media được phép bởi submission type. |
| `POST` | `/submissions/uploads/:sessionId/chunks` | JWT (owner) | Upload 1 chunk (`multipart/form-data`: `file`, `chunkIndex`). |
| `POST` | `/submissions/uploads/:sessionId/complete` | JWT (owner) | Ghép chunks và gắn media file vào submission hiện có. |
| `GET` | `/submissions/uploads/:sessionId` | JWT (owner) | Xem tiến trình upload và danh sách chunk đã nhận. |
| `POST` | `/submissions/:submissionId/submit` | JWT (owner) | Kiểm tra contract; chuyển `QUEUED` hoặc lưu lỗi và chuyển `PENDING_CORRECTION`. |
| `GET` | `/submissions/me` | JWT (Surveyor) | Danh sách submission của tôi (phân trang). |
| `GET` | `/submissions/me/pending` | JWT (Surveyor) | Đếm submission đang pending. Cho badge Surveyor Home. |
| `GET` | `/submissions/me/stats` | JWT (Surveyor) | Thống kê Surveyor Home: `creditScore, totalSubmissions, pendingSubmissions, revalidationAvailable, dailyTasks`. |
| `GET` | `/submissions/status/:submissionId` | JWT | Trả metadata, required media, validation errors, correction requirements, media files và pipeline history. |

### 3.4 Candidate Review — P2P Review Workspace (`/reviews`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/reviews/queue` | JWT (Reviewer) | Hàng đợi candidate chờ duyệt (`status=PENDING_REVIEW`), sắp theo `active_learning_priority DESC` (uncertainty cao trước), kèm `predictedSignType`. |
| `GET` | `/reviews/candidates/:candidateId` | JWT (Reviewer) | Chi tiết 1 candidate (ảnh crop, vị trí, nhãn AI dự đoán) cho màn Review Approval. |
| `POST` | `/reviews/:candidateId/vote` | JWT (Reviewer) | Bỏ phiếu. Body `{vote: 1\|-1, suggestedSignTypeId?, declineReason?, declineNote?}`. approve → tiến tới consensus; reject → ghi `declineReason` (Poor Image Quality / Incorrect Location / Sign Not Found / Duplicate Submission / Other) + `declineNote`. |
| `DELETE` | `/reviews/:candidateId/vote` | JWT (Reviewer) | Undo (thu hồi) lượt bỏ phiếu gần nhất. |
| `POST` | `/reviews/candidates/:candidateId/report` | JWT (Reviewer) | Báo cáo ứng viên bất thường → tạo `moderation_case` loại `REVIEW_CONFLICT`. Màn Report Submission Reason. |
| `POST` | `/reviews/candidates/:candidateId/can-not-identify` | JWT (Reviewer) | Bỏ qua "Không nhận dạng được". Body `{note?}` → ghi vote=0 (UNSURE). |
| `GET` | `/reviews/me/history` | JWT (Reviewer) | Lịch sử duyệt của tôi. Query: `status` (approved/rejected), `search` (tên biển báo), `surveyorId`. Màn Review History. |
| `GET` | `/reviews/me/stats` | JWT (Reviewer) | Thống kê reviewer (Reliability Score, số lượt duyệt) cho Reviewer Home. |
| `POST` | `/reviews/missing-type` | JWT | Báo biển báo thiếu loại chưa có trong catalog (Flow 10 Missing Type Reports). |

### 3.5 Revalidation (`/revalidation`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/revalidation/tasks/map` | JWT (Surveyor) | Danh sách task revalidation theo bounding box để vẽ bản đồ. Query: `bbox`. |
| `GET` | `/revalidation/tasks` | JWT (Surveyor) | Danh sách task revalidation (phân trang). |
| `GET` | `/revalidation/tasks/:taskId` | JWT (Surveyor) | Chi tiết 1 task. |
| `GET` | `/revalidation/tasks/:taskId/evidences` | JWT | Danh sách bằng chứng đã nộp cho task. |
| `POST` | `/revalidation/tasks/:taskId/evidence` | JWT (Surveyor) | Nộp bằng chứng mới (upload ảnh lại). Màn Revalidate record. |
| `POST` | `/revalidation/tasks/:taskId/finalize` | JWT (Surveyor) | Hoàn tất / đóng task revalidation. |
| `POST` | `/revalidation/evidence/:evidenceId/vote` | JWT (Reviewer) | Bỏ phiếu cho bằng chứng revalidation. |
| `GET` | `/revalidation/evidence/:evidenceId/decisions` | JWT | Xem các quyết định trên 1 bằng chứng. |

### 3.6 Daily Tasks / Gamification (`/daily-tasks`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/daily-tasks` | JWT | Liệt kê task đang active (`is_active=true`). |
| `GET` | `/daily-tasks/completions/me` | JWT | Lịch sử hoàn thành task hôm nay. Query: `?date=YYYY-MM-DD`. |
| `POST` | `/daily-tasks/:id/claim` | JWT | Claim thưởng task đã hoàn thành. Transaction-safe, chống double-claim, cộng `reward_credits` vào ví (loại `DAILY_TASK_REWARD`). |

### 3.7 Sign Reference Catalog (`/catalog`)

Dùng cho màn **Sign Reference Catalog** (tab Regulatory / Warning / Guidance + search) và tra cứu nhãn khi duyệt/thu thập.

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/catalog/categories` | JWT | Danh mục loại biển (Regulatory, Warning, Guidance...). |
| `GET` | `/catalog/categories/:id` | JWT | Chi tiết 1 danh mục. |
| `POST` | `/catalog/categories` | ADMIN | Tạo danh mục mới. |
| `PATCH` | `/catalog/categories/:id` | ADMIN | Cập nhật danh mục. |
| `DELETE` | `/catalog/categories/:id` | ADMIN | Xóa danh mục. |
| `GET` | `/catalog/sign-types` | JWT | Liệt kê loại biển báo. Query: `categoryId`, `search` (tên/mã). |
| `GET` | `/catalog/sign-types/:id` | JWT | Chi tiết 1 loại biển báo. |
| `POST` | `/catalog/sign-types` | ADMIN | Tạo loại biển báo mới. |
| `PATCH` | `/catalog/sign-types/:id` | ADMIN | Cập nhật loại biển báo. |
| `DELETE` | `/catalog/sign-types/:id` | ADMIN | Xóa loại biển báo. |

### 3.8 Moderation (`/moderation`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/moderation/cases` | STAFF/ADMIN | Danh sách ca kiểm duyệt (từ report/conflict). |
| `GET` | `/moderation/cases/:id` | STAFF/ADMIN | Chi tiết 1 ca kiểm duyệt. |
| `PUT` | `/moderation/cases/:id/resolve` | STAFF/ADMIN | Phán quyết / xử lý ca kiểm duyệt. |
| `GET` | `/moderation/missing-type-reports` | STAFF/ADMIN | Danh sách báo cáo thiếu loại biển báo (Flow 10). |
| `GET` | `/moderation/missing-type-reports/:id` | STAFF/ADMIN | Chi tiết 1 báo cáo. |
| `PATCH` | `/moderation/missing-type-reports/:id` | STAFF/ADMIN | Cập nhật trạng thái xử lý báo cáo. |

### 3.9 Notifications (`/notifications`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/notifications` | JWT | Danh sách thông báo của tôi (phân trang). |
| `GET` | `/notifications/unread-count` | JWT | Số thông báo chưa đọc (badge chuông). |
| `PATCH` | `/notifications/read-all` | JWT | Đánh dấu tất cả đã đọc. |
| `PATCH` | `/notifications/:id/read` | JWT | Đánh dấu 1 thông báo đã đọc. |

### 3.10 Leaderboard (`/leaderboard`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/leaderboard` | JWT | Bảng xếp hạng đóng góp (theo credit / số submission). |
| `POST` | `/leaderboard/refresh` | ADMIN | Tính toán lại bảng xếp hạng. |

### 3.11 Admin (`/admin`)

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/admin/users` | ADMIN | Danh sách người dùng (tìm kiếm / phân quyền). |
| `PATCH` | `/admin/users/:id/status` | ADMIN | Ban / active / khóa tài khoản. |
| `POST` | `/admin/users/:id/roles` | ADMIN | Gán / cập nhật role người dùng. |
| `GET` | `/admin/audit-logs` | ADMIN | Nhật ký kiểm toán thao tác hệ thống. |
| `GET` | `/admin/signs/export` | ADMIN | Xuất dữ liệu biển báo. Query: `format=json\|geojson`, `status`. |
| `GET` | `/admin/system-parameters` | ADMIN | Danh sách tham số hệ thống (ngưỡng đồng thuận, giá credit...). |
| `GET` | `/admin/system-parameters/:key` | ADMIN | Xem 1 tham số theo khóa. |
| `PUT` | `/admin/system-parameters/:key` | ADMIN | Cập nhật 1 tham số hệ thống. |

### 3.12 Places & Search (`/places`)

Phục vụ màn **Driver Home Search** và **Navigation — Select Destination** (tab Home / Work / Saved + Recent).

| Method | Path | Auth | Mô tả chức năng |
|---|---|---|---|
| `GET` | `/places/saved` | JWT (Driver) | Danh sách địa điểm đã lưu (Home/Work/khác). |
| `POST` | `/places/saved` | JWT (Driver) | Thêm địa điểm đã lưu. Body `{label, address, latitude, longitude, placeType(HOME/WORK/OTHER)}`. |
| `DELETE` | `/places/saved/:id` | JWT (Driver) | Xóa 1 địa điểm đã lưu. |
| `GET` | `/places/recent-searches` | JWT (Driver) | Lịch sử tìm kiếm gần đây. Query: `limit` (mặc định 20). |
| `POST` | `/places/recent-searches` | JWT (Driver) | Ghi nhận 1 tìm kiếm. Body `{query, address?, latitude?, longitude?}`. |
| `DELETE` | `/places/recent-searches` | JWT (Driver) | Xóa toàn bộ lịch sử tìm kiếm. |
| `DELETE` | `/places/recent-searches/:id` | JWT (Driver) | Xóa 1 mục tìm kiếm gần đây. |

---

## 4. API cho AI / PIPELINE & Driver — FastAPI Spatial & Navigation
Base: `http://localhost:8000/api/v1`

### 4.1 Spatial GIS (`/spatial`)

Trả về dữ liệu đã xác thực trong verified_traffic_signs ở định dạng GeoJSON. Dùng cho màn bản đồ tương tác (Flow 6) và tooltip sign detail.

| Method | Path | Auth | Query/Body | Mô tả |
|---|---|---|---|---|
| `GET` | `/spatial/signs` | Public | `min_lat`, `min_lon`, `max_lat`, `max_lon` (bắt buộc) + `sign_type_id`, `category_id` (tùy chọn) | Truy vấn các biển báo `status='ACTIVE'` trong bounding box. Dùng `ST_Within + ST_MakeEnvelope` (tận dụng GIST index). Trả về GeoJSON FeatureCollection với properties: id, signTypeId, categoryId, signCode, nameVi, nameEn, trafficDirection, signCropUrl, status, freshnessScore, lastVerifiedAt. |
| `GET` | `/spatial/signs/{sign_id}` | Public | Path param `sign_id` (UUID) | Chi tiết 1 biển báo đã duyệt: tất cả trường từ `verified_traffic_signs` JOIN `traffic_sign_types`. Trả 404 nếu không tìm thấy. |

### 4.2 Navigation Session REST (`/spatial`)

Flow 7 — Smart Navigation: quản lý phiên điều hướng.

| Method | Path | Auth | Body/Query | Mô tả |
|---|---|---|---|---|
| `POST` | `/spatial/navigation/sessions` | JWT (driver_id query) | `{origin_lat, origin_lon, dest_lat, dest_lon}` | Tạo navigation session mới (insert `navigation_sessions`, status=ACTIVE). Dùng API nội bộ `wallet/internal/deduct` để trừ credit khi bắt đầu. Trả SessionResponse (id, driver_id, status, origin/destination, started_at). |
| `GET` | `/spatial/navigation/sessions/me` | JWT | `driver_id`, `page`, `pageSize` | Danh sách phiên navigation của driver (phân trang). |
| `GET` | `/spatial/navigation/sessions/{session_id}` | — | Path `session_id` (UUID) | Chi tiết 1 phiên navigation (status, origin/dest, started/ended_at). |
| `PATCH` | `/spatial/navigation/sessions/{session_id}` | — | `{status: 'ENDED'}` | Kết thúc phiên (chuyển status ACTIVE → ENDED, set ended_at=NOW()). |

### 4.3 WebSocket: Real-time Navigation Stream

```
WS ws://localhost:8000/api/v1/spatial/navigation/stream
```

Flow 7 — Cảnh báo biển báo theo thời gian thực khi driver đang di chuyển.

**Giao thức:**
- Client gửi text frame JSON mỗi tick GPS:
  ```json
  {
    "sessionId": "uuid",
    "latitude": 10.7626,
    "longitude": 106.6602,
    "heading": 45.0
  }
  ```
- Server xử lý:
  1. Buffer route points → flush hàng loạt vào `navigation_route_points` (batch size = `NAVIGATION_ROUTE_POINT_BUFFER_SIZE`).
  2. Query ST_DWithin (radius = `NAVIGATION_SEARCH_RADIUS_M`, mặc định 50m) + heading cone filter (threshold = `NAVIGATION_HEADING_THRESHOLD_DEG`, mặc định 30°).
  3. Dedup: mỗi sign chỉ alert 1 lần mỗi session (SET `alerted`).
  4. Persist alert vào `navigation_sign_alerts`.
- Server trả response JSON (text frame):
  ```json
  {
    "type": "alerts",
    "latitude": 10.7626,
    "longitude": 106.6602,
    "heading": 45.0,
    "alerts": [
      { "id": "uuid", "signTypeId": 3, "latitude": 10.7630, "longitude": 106.6610, "trafficDirection": 40, "signCropUrl": "https://..." }
    ]
  }
  ```
- Lỗi: server gửi `{ "type": "error", "message": "..." }`, connection KHÔNG bị đóng.

---

## 5. Internal API — AI Pipeline & Backend-to-Backend

> **KHÔNG dùng từ Frontend**. Nhóm endpoint này phục vụ giao tiếp nội bộ giữa NestJS ↔ FastAPI ↔ AI Pipeline (Python workers xử lý ảnh, extract, consensus). Bảo vệ bằng header `x-internal-token`.

### 5.1 NestJS Internal (`apps/nestjs`)

| Method | Path | Consumer | Mô tả |
|---|---|---|---|
| `POST` | `/submissions/internal/:submissionId/complete` | AI Extractor Worker | Báo pipeline trích xuất biển báo hoàn tất → tạo `candidate_signs` từ kết quả vision model. |
| `PATCH` | `/submissions/internal/:submissionId/status` | AI Pipeline | Cập nhật trạng thái xử lý (`PROCESSING`, `CANDIDATE_CREATED`, `FAILED`...). |
| `GET` | `/reviews/internal/unscored-candidates` | Consensus/AI | Danh sách candidate chưa có confidence score (cần AI chấm điểm). |
| `PATCH` | `/reviews/internal/:candidateId/active-learning-priority` | Active Learning | Cập nhật uncertainty score → ưu tiên duyệt cao hơn. |
| `POST` | `/reviews/internal/active-learning-priorities` | Active Learning | Bulk update priority cho nhiều candidate. |
| `POST` | `/wallet/internal/deduct` | Navigation (FastAPI) / System | Trừ credit từ ví driver khi bắt đầu navigation session. Body `{userId, amount, type, referenceId?}`. Trả balance sau khi trừ. |

### 5.2 FastAPI → NestJS Internal (gọi ra)

| Direction | Mô tả |
|---|---|
| `POST /wallet/internal/deduct` | Khi tạo navigation session, FastAPI gọi NestJS internal endpoint để trừ credit. Nếu không đủ → trả lỗi, không tạo session. |

---

## 6. Tổng kết

| Nhóm | Số endpoint | Ai dùng |
|---|---|---|
| NestJS Business API | ~85 | Frontend (mobile/web) + Admin |
| FastAPI Spatial + Navigation | ~8 | Frontend (map, navigation) + AI |
| WebSocket stream | 1 | Frontend (real-time alerts) |
| Internal (NestJS) | ~6 | AI Pipeline (worker) |
| **Tổng** | **~100 endpoint** | — |

**Tài liệu liên quan:**
- `../README.md` — API summary + Frontend Screen → API Mapping.
- `postman/STM_Full.postman_collection.json` — collection đầy đủ, import vào Postman để test ngay.
- `../infra/postgres/schema/schema.postgres.sql` — DDL toàn bộ bảng, seed, indexes.
