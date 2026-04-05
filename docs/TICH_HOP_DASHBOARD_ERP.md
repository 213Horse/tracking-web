# Tích hợp API xây dashboard (ERP / hệ thống bên thứ ba)

Tài liệu này mô tả **chỉ phần đọc dữ liệu** để dựng giao diện báo cáo tương đương dashboard TrackFlow.  
API ghi sự kiện (`POST /api/v1/track`, `identify`, `ping`…) không nằm trong phạm vi file này — tham chiếu **`GET /openapi.json`** hoặc **`/api-docs`** trên server tracking.

---

## 1. Endpoint dashboard dùng

| Thứ tự | Phương thức | URL | Mục đích |
|--------|-------------|-----|----------|
| 1 | `GET` | `/api/v1/analytics/sessions` | Toàn bộ dữ liệu nền: phiên, visitor, sự kiện, user đã identify. |
| 2 | `GET` | `/api/v1/active-users` | Một chỉ số realtime: số phiên “đang hoạt động”. |

**Xác thực (bắt buộc):** header  

`x-api-key: <TRACKING_API_KEY>`  

(trùng khóa cấu hình trên server tracking).

**Base URL:** do chủ hệ thống cung cấp (ví dụ `https://tracking.example.com`). Không có path prefix bắt buộc ngoài các đường dẫn trên.

---

## 2. `GET /api/v1/analytics/sessions`

### 2.1. Query string

| Tham số | Bắt buộc | Mô tả |
|---------|----------|--------|
| `since` | Không | ISO 8601. Chỉ trả các phiên có `startedAt >= since`. Bỏ trống hoặc sai định dạng → server dùng mặc định (số ngày gần nhất, cấu hình `ANALYTICS_DEFAULT_DAYS`). |
| `limit` | Không | Số phiên tối đa. Server **cắt** không vượt quá `ANALYTICS_MAX_LIMIT`. |

**Gợi ý giống dashboard mặc định:** `since` = cách đây 30 ngày (hoặc N ngày bạn chọn), `limit` = 8000 (hoặc theo nhu cầu, vẫn ≤ giới hạn server).

### 2.2. Response headers (quan trọng cho UX)

Sau khi nhận `200`, đọc các header sau để hiển thị chú thích / cảnh báo cho user báo cáo:

| Header | Ý nghĩa |
|--------|---------|
| `X-Analytics-Since` | Giá trị `since` thực tế server đã áp dụng (ISO string). |
| `X-Analytics-Limit` | Số phiên tối đa của response. |
| `X-Analytics-Events-Cap` | Mỗi phiên chỉ kèm tối đa N sự kiện; **ưu tiên sự kiện mới nhất** (cũ có thể không còn trong payload). |

Ví dụ chú thích UI: *“Dữ liệu từ {since} · tối đa {limit} phiên · tối đa {cap} sự kiện/phiên (ưu tiên mới nhất).”*

### 2.3. Body: mảng phiên (JSON)

Response là **mảng** các object **Session**, sắp xếp `startedAt` **giảm dần** (mới nhất trước).

#### Session — các trường cần biết cho dashboard

| Trường | Kiểu (logic) | Dùng cho |
|--------|----------------|----------|
| `id` | string (uuid) | Khóa phiên. |
| `visitorId` | string | Gom theo khách; unique visitors. |
| `startedAt` | ISO datetime | Trục thời gian, heatmap (theo giờ VN), trend. |
| `updatedAt` | ISO datetime | Thời lượng phiên ≈ `updatedAt - startedAt` (giống dashboard). |
| `endedAt` | ISO datetime hoặc null | Phiên đã kết thúc hay chưa. |
| `device` | string hoặc null | Tab “Thiết bị”: nếu chuỗi chứa `'x'` → coi là **Desktop/Laptop**, ngược lại **Mobile** (logic hiện tại của dashboard). |
| `ip` | string hoặc null | Tham khảo. |
| `location` | string hoặc null | Chuỗi JSON (object geo). Parse được thì có `country`, `city`, `region`, … — bản đồ / tab Quốc gia–Thành phố. |
| `userAgent` | string hoặc null | Phân loại trình duyệt / hệ điều hành (regex như bảng mục 4). |
| `events` | mảng Event | Mọi biểu đồ, bảng commerce, pageview, bounce. |
| `visitor` | object | `visitor.identityMapping` → user đã `identify`. |

#### Event — các trường (theo dữ liệu API thực tế)

| Trường | Kiểu | Ghi chú |
|--------|------|---------|
| `id` | string | Id sự kiện. |
| `sessionId` | string | Khớp `Session.id`. |
| `name` | string | Loại sự kiện: `pageview`, `heartbeat`, `checkout_preview`, `checkout_success`, hoặc tên tùy chỉnh. |
| `properties` | object hoặc null | JSON tự do. Thường gặp: `url`, `title`, `productNames` (mảng string), `orderNo` (string). |
| `timestamp` | ISO datetime | Thời điểm sự kiện. |

**Lưu ý:** Response từ Prisma **không** có field `context` trên từng event. Dashboard phía web vẫn đọc `context?.url` nếu có; khi tích hợp từ API, **ưu tiên `properties.url`** (và `properties.title` cho tiêu đề trang).

---

## 3. `GET /api/v1/active-users`

- **Response:** `{ "count": <số nguyên không âm> }`.
- **Ý nghĩa:** Số **phiên** (`Session`) có `updatedAt` trong khoảng **~60 giây** gần nhất và `endedAt == null`.

**Polling:** dashboard mẫu gọi lại **mỗi 10 giây** (cùng nhịp với reload `analytics/sessions`). Bạn có thể tách tần suất (ví dụ active-users 10s, sessions 30s) tùy tải.

**Xu hướng % so với lần trước:**  
`prev` = `count` lần gọi trước, `curr` = lần này. Nếu `prev === 0`: hiển thị `100%` nếu `curr > 0`, không thì `0%`. Ngược lại: `(curr - prev) / prev * 100`.

---

## 4. Công thức chỉ số tổng quan (từ mảng `sessions`)

Giả sử biến `sessions` là mảng đã parse từ `GET /analytics/sessions`. Có thể **sắp xếp lại** `events` trong mỗi phiên theo `timestamp` tăng dần cho đúng timeline (dashboard làm bước này sau khi fetch).

### 4.1. Định nghĩa “event hoạt động” (bounce)

- Lọc sự kiện **có tính cho bounce:** `events.filter(e => e.name !== 'heartbeat')`.
- **Bounce (theo phiên):** số event (sau lọc trên) **≤ 1**.

### 4.2. Các KPI phổ biến

| Chỉ số | Công thức |
|--------|-----------|
| Số phiên | `sessions.length` |
| Unique visitors | `new Set(sessions.map(s => s.visitorId)).size` |
| Tổng pageview | `sessions.flatMap(s => s.events).filter(e => e.name === 'pageview').length` |
| Tổng thời lượng (giây) | Σ over sessions: `(new Date(s.updatedAt \|\| s.startedAt) - new Date(s.startedAt)) / 1000` |
| Thời lượng TB / phiên | tổng thời lượng / số phiên (tránh chia 0). |
| Số phiên bounce | số phiên thỏa điều kiện bounce ở trên. |
| Tỷ lệ bounce % | `(số bounce / số phiên) * 100` |

### 4.3. Trend % (chia đôi theo thời gian `startedAt`)

1. Sắp `sessions` theo `startedAt` tăng dần.
2. `minTime` = `startedAt` sớm nhất, `maxTime` = muộn nhất. Nếu `maxTime <= minTime` → có thể coi mọi trend tăng 100% từ 0 (hoặc bounce trend = 0) như dashboard mẫu.
3. `midTime = minTime + (maxTime - minTime) / 2`.
4. `prevSessions` = phiên có `startedAt < midTime`, `currSessions` = phần còn lại.
5. Với mỗi tập, tính: số phiên, pageview, unique visitors, thời lượng TB, tỷ lệ bounce % (cùng công thức mục 4.2).
6. % thay đổi: `((curr - prev) / prev) * 100`; nếu `prev === 0` và `curr > 0` → 100%.

### 4.4. Heatmap 7×24 (theo **giờ Việt Nam**)

- Ma trận `7` hàng (Thứ 2 → Chủ nhật) × `24` cột (giờ 0–23), ban đầu toàn 0.
- Với mỗi phiên `s`: lấy `startedAt`, chuyển sang múi giờ **`Asia/Ho_Chi_Minh`**, suy ra:
  - `dayIdx`: JS `getDay()` với 0 = CN → map **Thứ 2 = 0 … Chủ nhật = 6** (CN: `dayIdx === 0 ? 6 : dayIdx - 1`).
  - `hourIdx`: giờ 0–23 trong TZ đó.
- Tăng `heatmapData[dayIdx][hourIdx] += 1`.

### 4.5. Bản đồ / tổng hợp quốc gia

- Với mỗi `s.location` có dạng JSON string: `JSON.parse` an toàn (try/catch).
- Nếu có `geo.country` → cộng dồn số phiên theo mã quốc gia (ISO-2).

---

## 5. Khối “Phân tích” (dimension + chỉ số theo dimension)

Dashboard gom nhóm theo một **dimension**; mỗi nhóm có: số visitor (unique `visitorId`), số phiên, pageview, bounce (theo quy tắc riêng từng loại dimension), tổng thời lượng, rồi **TB thời lượng / phiên**.

### 5.1. Dimension lấy từ **từng pageview** (`name === 'pageview'`)

Tránh đếm bounce trùng: trong một phiên, với mỗi giá trị dimension **chỉ cộng bounce một lần** khi dimension đó xuất hiện lần đầu trong phiên (dashboard dùng `Set` nội bộ).

**Đường dẫn (pathname):** với mỗi event pageview:

- URL ưu tiên: parse `properties.url` → lấy `pathname` (fallback chuỗi gốc hoặc `'/'`).

**Tiêu đề trang:**

- Lấy `properties.title`; nếu thiếu hoặc generic, có thể suy từ pathname (slug → chữ hoa đầu từ) hoặc `'Trang chủ'` nếu path `/` — đồng bộ logic với dashboard nếu cần hiển thị giống hệt.

### 5.2. Dimension lấy theo **cả phiên**

| Tab / dimension | Cách lấy giá trị nhóm |
|-----------------|------------------------|
| Quốc gia | Parse `s.location` → `country`. |
| Thành phố | Parse `s.location` → `city`. |
| Trình duyệt | Từ `s.userAgent`: Chrome (trừ Edg), Safari (không Chrome), Firefox, Edge, còn lại Other. |
| Hệ điều hành | `userAgent`: macOS, Windows, Linux, Android, iOS/iPhone, … |
| Trang vào | Pathname của **pageview đầu tiên** (theo `timestamp`) trong phiên. |
| Trang thoát | Pathname của **pageview cuối** trong phiên. |
| Nguồn giới thiệu | **Chỉ khi** client gửi referrer trong payload (dashboard đọc `firstPv.context.referrer` — API hiện không trả `context`; nếu không có field tương đương trong `properties`, dùng `'Direct/Unknown'`). |
| Thiết bị | `s.device` chứa `'x'` → Desktop/Laptop, else Mobile. |
| Ngôn ngữ | Từ pageview đầu: nếu sau này lưu trong `properties` thì đọc; không có → mặc định có thể `vi-VN`. |

**Gom nhóm (session-level):** với mỗi phiên, một dimension duy nhất → cộng 1 bounce nếu phiên là bounce; cộng `s.events.filter(e => e.name === 'pageview').length` vào pageviews; cộng thời lượng phiên vào `totalDurationSec`.

---

## 6. Commerce (giỏ / đặt hàng)

Dữ liệu đến từ **`events`** với `name` cố định.

### 6.1. Nhãn khách hàng (giống dashboard)

Với mỗi phiên `s`:

- `user = s.visitor.identityMapping?.user`
- **label hiển thị:** `user.name` (trim) hoặc `user.email` hoặc chuỗi *“Chưa định danh”*.
- **tooltip / dòng phụ:** ghép `name`, `email`, `Mã KH: {erpId}` nếu có, và `Visitor: {visitorId}`.

### 6.2. Bảng “Xem trước thanh toán”

- Lấy mọi event `e` với `e.name === 'checkout_preview'`.
- Mỗi dòng: `event.id`, `session.visitorId`, nhãn khách (trên), `e.timestamp`, `products = e.properties.productNames` (phải là **mảng string**; không phải mảng → coi rỗng).
- Sắp `timestamp` giảm dần; có thể giới hạn 25 dòng như dashboard.

**Chỉ số phụ:** số **visitor** (unique `visitorId`) có ít nhất một `checkout_preview` trong cửa sổ dữ liệu.

### 6.3. Bảng “Đặt hàng thành công”

- Event `e.name === 'checkout_success'`.
- Cột: id, visitorId, khách, `timestamp`, `orderNo = String(e.properties?.orderNo ?? '')`.
- Sắp giảm theo thời gian; giới hạn 25 dòng tùy chọn.

**Chỉ số phụ:** tổng số event `checkout_success` (số “đơn” theo sự kiện).

### 6.4. Xếp hạng sản phẩm

**“Khách muốn mua”:** chỉ từ event `checkout_preview`.  
**“Đã mua / đặt nhiều”:** chỉ từ `checkout_success`.

Thuật toán (trùng dashboard):

1. Khởi tạo map `tên → số lần`.
2. Với mỗi event, lấy `properties.productNames`.
3. Nếu là mảng: với mỗi phần tử là string, `trim()`; bỏ rỗng; mỗi lần xuất hiện **+1** cho tên đó (một event có 3 tên → +3 vào 3 key).
4. Sắp giảm theo count.

---

## 7. Tab Users / hồ sơ visitor

- Gom phiên theo `visitorId`, hoặc nếu có `identityMapping.userId` thì gom mọi phiên cùng `userId` (khách đã identify trên nhiều visitor).
- Hiển thị user: `identityMapping.user.name`, `email`, `erpId`.
- Timeline: toàn bộ `events` các phiên đã gom, sắp `timestamp` giảm dần.

**Hồ sơ chi tiết một visitor** (logic `getVisitorProfile`):

- `views` = số event `pageview`.
- `durationSec` = tổng `(updatedAt || startedAt) - startedAt` theo giây trên các phiên đã gom.
- Geo: lấy từ phiên đầu tiên có `location` parse được.
- Browser / OS: từ `userAgent` phiên mới nhất (bảng regex như mục 5.2).
- `latestPreviewProducts`: `productNames` của **checkout_preview mới nhất** (theo timestamp).
- `orderNos`: tập **unique** `properties.orderNo` từ mọi `checkout_success` (bỏ null/empty).

---

## 8. Tab Raw events

- `flatMap`: mỗi event kèm thêm `visitorId` và (nếu có) `userEmail`, `userName`, `erpId` từ `session.visitor.identityMapping.user`.
- Sắp theo `timestamp` (giảm hoặc tăng tùy UI).

---

## 9. Biểu đồ “10 phiên gần nhất” (mẫu)

- `sessions.slice(0, 10)` — API đã sắp `startedAt` desc nên đây là 10 phiên mới nhất.
- Trục X: nhãn thời gian từ `startedAt`; trục Y: `events.length` (hoặc chỉ đếm pageview nếu bạn muốn).
- Có thể `.reverse()` thứ tự hiển thị cho đẹp trục thời gian.

---

## 10. Ví dụ gọi API (tham khảo)

```http
GET /api/v1/analytics/sessions?since=2026-03-01T00:00:00.000Z&limit=8000
x-api-key: <SECRET>
```

```http
GET /api/v1/active-users
x-api-key: <SECRET>
```

---

## 11. Rủi ro khi làm báo cáo ERP

1. **Giới hạn sự kiện / phiên:** một phiên dài có thể không còn đủ event cũ trong JSON → KPI lịch sử có lệch; hiển thị rõ qua header `X-Analytics-*`.
2. **Không có `context` trên event:** mọi thứ phụ thuộc `properties` và trường session (`location`, `userAgent`, …).
3. **Referrer / ngôn ngữ:** chỉ có nếu pipeline ghi có lưu vào `properties` (hoặc mở rộng schema sau này).

---

*Tài liệu phản ánh logic dashboard trong mã nguồn `dashboard/src/App.tsx` tại thời điểm viết. Nếu backend thay đổi schema hoặc giới hạn, cập nhật song song file này.*
