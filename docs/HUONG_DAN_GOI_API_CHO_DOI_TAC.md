# Hướng dẫn gọi API & hiển thị dữ liệu (cho đối tác tích hợp)

Tài liệu tóm tắt **cách gọi** các API đọc dữ liệu analytics và **cách dùng từng field** để vẽ bảng/biểu đồ. Chi tiết schema đầy đủ: **`GET {BASE}/openapi.json`** hoặc mở **`{BASE}/api-docs`** (Swagger).

---

## 1. Chuẩn chung

| Mục | Nội dung |
|-----|----------|
| **Base URL** | Chủ hệ thống cung cấp, ví dụ `https://tracking.example.com` |
| **Xác thực** | Mọi request dưới đây gửi header: **`x-api-key: <TRACKING_API_KEY>`** |
| **Content-Type** | GET không cần body |
| **Thời gian** | Timestamp trong JSON thường là **ISO 8601** (UTC). UI người dùng nên hiển thị **GMT+7** nếu đồng bộ dashboard TrackFlow |

**Ví dụ curl (thay `BASE` và `KEY`):**

```bash
curl -sS "${BASE}/api/v1/analytics/traffic-peak-hours?since=2026-01-01T00:00:00.000Z&limit=5000" \
  -H "x-api-key: ${KEY}"
```

---

## 2. Bảng API thường dùng

| API | Query chính | Response / cách hiển thị |
|-----|-------------|---------------------------|
| `GET /api/v1/analytics/sessions` | `since`, `limit` **hoặc** `pageNumber` + `pageSize` | **Legacy:** mảng phiên `[Session, …]`. **Phân trang:** `{ items, meta }`. Dùng cho KPI tự tính, bản đồ, recent sessions, v.v. Header: `X-Analytics-Since`, `X-Analytics-Limit`, `X-Analytics-Events-Cap`. |
| `GET /api/v1/analytics/dimension-stats` | `dimension` (bắt buộc), `since`, `limit`, `search`, tùy `rowsPageNumber` + `rowsPageSize` | `{ rows, meta }` — bảng phân tích theo dimension. Phân trang **dòng** `rows` bằng `rowsPage*` để giảm JSON. |
| `GET /api/v1/analytics/commerce` | `since`, `previewPageNumber` / `previewPageSize`, `successPageNumber` / `successPageSize`, tùy `rankEventsLimit` | Một response gồm **2 danh sách phân trang** + **2 bảng xếp hạng sản phẩm** — xem mục 5. |
| `GET /api/v1/analytics/traffic-peak-hours` | `since`, `limit` | Ma trận **7×24** giờ cao điểm (GMT+7) — xem mục 4. |
| `GET /api/v1/active-users` | `since`, `limit`, tùy `kpiSessionLimit` | `count` = đang truy cập (~60s); `dashboardKpis` = KPI tổng hợp (có thể ước lượng nếu `kpiApproximate: true`). |

API không cần key: `GET /health`. Các API ghi (`POST /track`, …) không nằm trong tài liệu này.

---

## 3. `GET /api/v1/analytics/sessions`

### Gọi

- `since` (khuyến nghị): mốc bắt đầu cửa sổ, ví dụ 30 ngày.
- `limit`: số phiên tối đa (một chunk).
- Hoặc **`pageNumber`** + **`pageSize`**: nhận `{ items, meta: { total, pageNumber, pageSize, totalPages } }` — cần **lặp trang** nếu muốn đủ dữ liệu toàn cửa sổ.

### Hiển thị (ý tưởng)

- Mỗi phần tử = một **phiên**; `events[]` có thể bị **cắt** theo cap trên server (xem header `X-Analytics-Events-Cap`).
- **KPI (lượt xem, khách, phiên, thời gian TB, bounce):** tự tính trên tập phiên đã tải (cùng công thức dashboard) hoặc dùng `GET /active-users` cho phần KPI đã tổng hợp sẵn.
- **Bản đồ:** parse `location` (JSON) → `country`.
- **Recent sessions:** bảng từ mảng phiên (có thể gom dòng theo `erpId` như dashboard).

---

## 4. `GET /api/v1/analytics/traffic-peak-hours` — Traffic Peak Hours

### Gọi

```
GET /api/v1/analytics/traffic-peak-hours?since=<ISO>&limit=<n>
```

- Chỉ đọc **`startedAt`** của tối đa **`limit`** phiên **mới nhất** trong cửa sổ `since` (nhẹ, không kéo events).

### Response & cách vẽ

| Trường | Ý nghĩa khi hiển thị |
|--------|----------------------|
| `timeZone` | Luôn `Asia/Ho_Chi_Minh` — ghi chú trên UI: *Giờ Việt Nam*. |
| `dayLabels` | Mảng 7 nhãn: Thứ 2 → CN — **trục cột** hoặc **hàng** (giữ đúng thứ tự với `matrix`). |
| `matrix` | Mảng **7 × 24**: `matrix[row][hour]` = **số phiên bắt đầu** trong ô đó. `row = 0` → Thứ 2, `row = 6` → CN; `hour = 0..23`. |
| `maxCount` | Max toàn ma trận — dùng **chuẩn hóa màu / kích thước ô** (heatmap). |
| `sessionsScanned` / `sessionLimit` | Minh bạch: heatmap chỉ phản ánh tối đa N phiên. |

**Cách vẽ giống dashboard:** mỗi ô là một “chấm” hoặc ô màu; **độ đậm / size** ∝ `matrix[row][hour] / maxCount` (tránh chia 0 nếu `maxCount === 0`). Tooltip: *“X phiên lúc {hour}:00, {dayLabels[row]}”*.

---

## 5. `GET /api/v1/analytics/commerce` — Thương mại (2 khối + xếp hạng)

### Gọi

| Param | Mặc định | Ý nghĩa |
|-------|----------|---------|
| `since` | Theo server | Cửa sổ theo `session.startedAt`. |
| `previewPageNumber` / `previewPageSize` | 1 / 25 (size tối đa 500) | Trang danh sách **checkout_preview** (đang mua / preview giỏ). |
| `successPageNumber` / `successPageSize` | 1 / 25 | Trang **checkout_success** (đơn thành công). |
| `rankEventsLimit` | 25000 (max 100000) | Chỉ dùng **N event mới nhất** để tính 2 bảng xếp hạng — giảm tải khi lịch sử rất dài. |

### Response & cách hiển thị

**`checkoutPreview`**

- `items[]`: mỗi dòng — `at` (thời điểm), `customerLabel` / `customerTitle`, `products[]` (tên SP trong giỏ).
- `total`, `pageNumber`, `pageSize`, `totalPages` — **phân trang UI** (nút Trước/Sau hoặc infinite scroll theo trang).

**`checkoutSuccess`**

- `items[]`: `at`, khách như trên, **`orderNo`**.
- Cùng cấu trúc phân trang như preview.

**`productWantRank`**

- Mảng `{ name, count }` — **xếp hạng sản phẩm “muốn mua”** (từ preview). Hiển thị: thứ hạng + tên + số lần.

**`productPurchasedRank`**

- Cùng format — từ đơn thành công có `productNames` trong event.

**`meta.rankPreviewEventsScanned` / `rankSuccessEventsScanned`**

- Cho phép ghi chú: *“Xếp hạng dựa trên tối đa N event gần nhất”* nếu cần.

---

## 6. `GET /api/v1/analytics/dimension-stats`

- Bắt buộc `dimension` (path, title, country, city, browser, os, device, language, entry, exit, referrer).
- `rows[]`: mỗi dòng có `dimensionValue`, `visitorsCount`, `pageviews`, `sessionsCount`, `bounces`, `avgDurationSec`.
- **Biểu đồ cột kép / bảng:** map trực tiếp các cột số.
- **`rowsPageNumber` + `rowsPageSize`:** chỉ trả subset `rows` + `meta.rowsTotal`, `rowsTotalPages` — phù hợp bảng dài.

---

## 7. `GET /api/v1/active-users`

- **`count`:** số phiên còn hoạt động gần đây (~60 giây) — ô **“Đang truy cập”**.
- **`dashboardKpis`:** lượt xem, khách, phiên, thời lượng TB, bounce, `trendsPct` — có thể dùng thay cho tự tính từ `sessions`.
- **`kpiApproximate`:** nếu `true`, KPI chỉ dựa trên **`kpiSessionsScanned`** phiên đầu trong cửa sổ (xem `sessionsInWindow`). Nên hiển thị chú thích nhỏ cho user.

---

## 8. Gợi ý tích hợp nhanh

1. **Chỉ cần heatmap:** gọi **`traffic-peak-hours`** — không cần tải full sessions.
2. **Chỉ cần khối thương mại:** gọi **`commerce`** — hai bảng + hai xếp hạng trong một response, có phân trang.
3. **Bảng lọc chi tiết:** gọi **`dimension-stats`**.
4. **Màn hình đầy đủ như TrackFlow:** kết hợp các API trên + (tùy chọn) `sessions` cho các widget chưa có API chuyên biệt.

Tài liệu chi tiết từng widget bám layout dashboard: **[TICH_HOP_DASHBOARD_ERP.md](./TICH_HOP_DASHBOARD_ERP.md)** (cần đối chiếu với các API mới ở trên nếu có chỗ mô tả cũ chỉ dùng `sessions`).
