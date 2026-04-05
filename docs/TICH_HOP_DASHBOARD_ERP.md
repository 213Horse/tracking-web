# Tích hợp API — xây dashboard trong ERP (chỉ đọc dữ liệu)

Tài liệu cho **bên thứ ba** dựng trang báo cáo trong hệ thống ERP, tương đương dashboard TrackFlow. Chỉ mô tả **API GET** và **cách map response → ô/bảng/biểu đồ**.

- **Không** mô tả chi tiết API ghi (`POST /track`…). **Luồng khách ẩn danh → sau khi đăng nhập/định danh** — xem **§4.3.1** (để ERP hiểu cột “Khách” và tab Users). Chi tiết request `identify`: **`GET /openapi.json`** hoặc **`/api-docs`**.

---

## 1. Chuẩn bị

| Mục | Giá trị |
|-----|---------|
| **Base URL** | Do chủ hệ thống cung cấp (vd. `https://tracking.example.com`). |
| **Xác thực** | Header **`x-api-key: <TRACKING_API_KEY>`** trên mọi request API nghiệp vụ bên dưới. |
| **OpenAPI** | `GET /openapi.json` — schema đầy đủ. |

---

## 2. Ba API dashboard dùng trực tiếp

| # | Method | Path | Dùng cho phần UI |
|---|--------|------|------------------|
| 1 | `GET` | `/api/v1/analytics/sessions` | KPI tổng quan, heatmap, bản đồ, commerce, danh sách phiên, users, raw events, biểu đồ theo phiên. |
| 2 | `GET` | `/api/v1/analytics/dimension-stats` | **Bảng + biểu đồ “Phân tích chi tiết bộ lọc”** (Khách, Lượt xem, Phiên, Thoát, Thời gian TB) — **đã tổng hợp sẵn trên server**. |
| 3 | `GET` | `/api/v1/active-users` | Chỉ số “đang hoạt động” (~phiên có hoạt động trong 60s). |

**Gợi ý polling (giống dashboard mẫu):** mỗi **10 giây** gọi lại cả ba (hoặc tách tần suất tùy tải). Đổi tab / ô tìm kiếm trong “Phân tích chi tiết” → gọi lại `dimension-stats` với `dimension` / `search` mới (có thể debounce ô search ~400ms).

---

## 3. Hướng dẫn xây dựng widget báo cáo (bám dashboard TrackFlow)

Bảng dưới mô tả **từng khối UI** tương đương dashboard. Đọc theo **ba cột**:

1. **Tên vùng / widget** — nhãn gần đúng như trên dashboard (có thể Việt hóa).  
2. **ERP cần làm gì** — kỹ thuật: API, công thức.  
3. **Cách trình bày cho người dùng cuối** — ý nghĩa nghiệp vụ.

**Thứ tự layout tab *Dashboard* (trên xuống, giống TrackFlow):**  
(0) Tiêu đề khu vực *Dashboard Overview* + badge **GMT+7** + (tùy chọn) ô tìm kiếm toàn trang.  
**(A)** Chú thích cửa sổ dữ liệu. **(B)** 6 thẻ KPI. **(C–F)** Khối thương mại 2 cột (preview + xếp hạng muốn mua \| đơn thành công + xếp hạng mua nhiều). **(G–H)** Một hàng: trái **Geographical Distribution** (rộng ~2/3), phải **Traffic Peak Hours** (~1/3). **(I–J)** Một hàng: trái biểu đồ **Activity (Last 10 Sessions)** (rộng ~2/3), phải **Device Distribution** (~1/3). **(K)** Phân tích chi tiết bộ lọc. **(L)** Recent Sessions. **(M)** Modal chi tiết phiên. **(P)** Modal hồ sơ visitor/user. **Tab Users → (N)**. **Tab Events → (O)**.

| # | Tên vùng / widget (gợi ý nhãn) | ERP cần làm gì (hành động kỹ thuật) | Cách trình bày cho người dùng cuối |
|---|-------------------------------|-------------------------------------|-------------------------------------|
| **A** | **Chú thích cửa sổ dữ liệu** | Sau mỗi lần gọi `GET /analytics/sessions`, đọc header `X-Analytics-Since`, `X-Analytics-Limit`, `X-Analytics-Events-Cap`; ghép thành một dòng cảnh báo (text nhỏ phía trên dashboard). | Giải thích rõ: *từ ngày nào*, *tối đa bao nhiêu phiên*, *mỗi phiên chỉ có tối đa N sự kiện (ưu tiên mới)* — tránh hiểu nhầm số liệu là “toàn bộ lịch sử”. |
| **B** | **Thẻ KPI hàng đầu (6 ô)** | Từ **mảng phiên** của `GET /analytics/sessions`, **tự tính** trên ERP: tổng pageview, unique visitor, số phiên, thời lượng TB/phiên, tỷ lệ bounce %, và **trend %** (chia đôi cửa sổ thời gian theo `startedAt` — xem **mục 8**). Ô **“Đang truy cập”** lấy **`GET /active-users` → `count`**, không lấy từ `sessions`. | Hiển thị 6 thẻ: nhãn in hoa ngắn + **số lớn** + mũi tên **↑/↓** và % so với nửa cửa sổ trước (riêng “Đang truy cập” so với **lần poll trước**). Định dạng thời gian TB: `Xm Ys`. Bounce: một số % với 1 chữ số thập phân. |
| **C** | **Khối thương mại — Đang mua (preview)** | Dữ liệu vào DB qua `POST /track` (`checkout_preview`) và đọc qua **`GET /analytics/sessions`** — chi tiết **§4.4**. Trên mảng `sessions`, **lọc** mọi `events` có `name === 'checkout_preview'`. Mỗi dòng bảng: `timestamp` event, **nhãn khách** = `user.name` hoặc `user.email` hoặc “Chưa định danh” / rút gọn `visitorId` (xem **§4.3.1** — khách chưa login thường **chưa** có tên/mã KH), **sản phẩm** = danh sách chip từ `properties.productNames` (mảng string). Sắp mới → cũ; có thể giới hạn ~25 dòng. **Badge phụ:** đếm **số visitor unique** có ít nhất một preview × **số dòng sự kiện** preview. | Tiêu đề kiểu *Đang mua (preview /thanh-toan)*; bảng 3 cột: Thời điểm \| Khách \| Sản phẩm trong giỏ (tag). Giải thích cho user: *khách xem giỏ trước khi đăng nhập có thể hiện ẩn danh*. Nếu không có dữ liệu: thông báo *chưa có checkout_preview*. |
| **D** | **Báo cáo: Sản phẩm khách muốn mua** | Cùng nguồn **§4.4** (chỉ đọc từ `sessions`, không API riêng). Chỉ từ các event `checkout_preview`: với mỗi event, duyệt `properties.productNames`; mỗi tên (trim) **+1** đếm. Sort giảm theo đếm; hiển thị top ~50: thứ hạng + tên SP + số lần. | Danh sách xếp hạng; ghi chú nghiệp vụ: *mỗi lần xuất hiện trong preview tính một lượt*. |
| **E** | **Khối — Đơn hàng thành công** | **§4.4:** ghi bằng `POST /track` (`checkout_success`), đọc bằng **`GET /analytics/sessions`**. Lọc `name === 'checkout_success'`. Bảng: thời điểm, nhãn khách (như C), **`properties.orderNo`**. Sắp mới → cũ; ~25 dòng. Badge: tổng **số sự kiện** success (số “đơn” theo event). | Tiêu đề *Đơn hàng thành công*; cột mã đơn nổi bật (mono). Empty state nếu chưa có `checkout_success`. |
| **F** | **Báo cáo: Sản phẩm mua nhiều** | **§4.4** — gom `productNames` từ event `checkout_success` (nếu có). Giống D nhưng nguồn là `checkout_success` và `productNames` (nếu response checkout có gửi). | Top xếp hạng + count; ghi chú nếu đơn cũ chỉ có `orderNo` không có tên SP. |
| **G** | **Geographical Distribution** (bản đồ thế giới) | `GET /analytics/sessions`. Với mỗi phiên: parse `location` (JSON) → lấy mã **`country`** (ISO-2, vd. `VN`). Cộng dồn **số phiên** theo từng mã. Vẽ **choropleth** (map): quốc gia có traffic tô màu khác; hover tooltip dạng *`{Tên quốc gia}: {N} sessions`*. Dashboard dùng world-atlas + map mã quốc gia ↔ id geography (ERP có thể thay bằng bảng hoặc map đơn giản). **Dưới map:** hàng **tối đa 5 chip** — các quốc gia có nhiều phiên nhất (mã + `N sessions`), sort giảm. | Badge phụ có thể ghi *Global Coverage*. Ý nghĩa: **phiên bắt đầu từ quốc gia nào** (theo geo IP/session), trong cửa sổ thời gian. |
| **H** | **Traffic Peak Hours** (heatmap giờ cao điểm) | `GET /analytics/sessions`. Ma trận **7 cột × 24 hàng** (hoặc 7 cột giờ 0–23 như dashboard: mỗi **cột** = một **thứ** trong tuần). Với **mỗi phiên**, lấy `startedAt`, chuyển sang timezone **`Asia/Ho_Chi_Minh`**: xác định **thứ** (Thứ 2 = 0 … Chủ nhật = 6; CN trong JS `getDay()===0` map sang cột 6) và **giờ 0–23**. Tăng `matrix[thứ][giờ] += 1`. **Mỗi ô = số phiên *bắt đầu* trong giờ đó** (không phải pageview, không phải tổng traffic tích lũy). Hiển thị: nhãn cột *Thứ 2 … CN*; trục phụ trái có thể ghi mốc *12am, 4am, 8am, 12pm, 4pm, 8pm*; từng ô là **chấm tròn** — **kích thước** và **độ đậm** tỉ lệ với count (so với max toàn ma trận); ô 0 vẫn hiện chấm mờ. **Tooltip ô:** *`{count} sessions at {giờ}:00`*. | Tiêu đề đúng như dashboard: *Traffic Peak Hours*. Giúp trả lời: **khách thường mở phiên vào ngày/giờ nào (giờ VN)** để canh chiến dịch / vận hành. |
| **I** | **Activity (Last 10 Sessions)** (biểu đồ đường) | `GET /analytics/sessions`, mảng đã sort `startedAt` **giảm dần**. Lấy **10 phần tử đầu**. Mỗi điểm: trục X = nhãn thời gian từ `startedAt` (vd. giờ:phút:giây **GMT+7**), trục Y = **`events.length`** (số event trong phiên, **bao gồm** mọi `name`). Vẽ **line chart** một đường (`events`), có dot từng điểm; tooltip hiện giá trị. Có thể **đảo thứ tự** điểm để trục X tăng dần theo thời gian. | Tiêu đề giữ *Activity (Last 10 Sessions)*. Ý nghĩa: **mười phiên gần nhất** có “nhiều sự kiện” hay ít — phiên dày thường tương tác sâu hơn. |
| **J** | **Device Distribution** (thanh % theo phiên) | **Lưu ý:** nhãn là *Device* nhưng dashboard hiện tại gom theo **trình duyệt** từ `userAgent`: Chrome / Safari / Firefox / Edge / Other (regex giống code TrackFlow). Với mỗi **phiên** gán một nhóm; **% = số phiên nhóm đó / tổng số phiên** × 100. Mỗi dòng: tên nhóm + **thanh progress ngang** + **%** đậm. Không có phiên → empty state. | ERP có thể đổi nhãn thành *Browser distribution* cho đúng dữ liệu, hoặc bổ sung thật phân bố mobile/desktop từ `device` nếu muốn khác dashboard. |
| **K** | **Phân tích chi tiết bộ lọc** | `GET /analytics/dimension-stats` (+ `since` / `limit` / `search` / `dimension`). Không tự gom trên client. Debounce ô tìm ~400ms. | **Tabs** 11 dimension (Quốc gia, Thành phố, …). **Trái:** top ~10 dòng — 2 thanh ngang **Khách** (cam) vs **Lượt xem** (teal), scale theo max trong 10 dòng. **Phải:** bảng đầy đủ cột dimension \| Khách \| Lượt xem \| Phiên \| Thoát \| Thời gian TB. Trạng thái loading khi chờ API. |
| **L** | **Recent Sessions** | `GET /analytics/sessions`. Có thể **gom dòng** theo `erpId` (ưu tiên) hoặc fingerprint như dashboard. **Cột gợi ý:** Visitor/User (tên / email / mã KH / ẩn danh); Network (IP, localhost nếu không có); Device (rút gọn `userAgent`, `device` resolution); **Events** (số event, có thể chữ *Merged* nếu gom); **Time (GMT+7)**; nút mở chi tiết → **(M)**. | Danh sách **phiên gần đây** để vận hành theo dõi realtime. |
| **M** | **Session Details** (modal / drawer) | Mở khi chọn một phiên từ **(L)**. Tiêu đề *Session Details*. Badge: **IP** (`session.ip` hoặc *Local*), **device** (`session.device` hoặc *Unknown Screen*). **Timeline** dọc: duyệt `events` (thứ tự như API hoặc sort theo `timestamp`); mỗi bước: `event.name`, nếu có `properties.utm_source` hiện badge *Source*; thời gian; khối **JSON** `properties` (pretty print). | Điều tra **toàn bộ sự kiện trong một phiên** (debug, hỗ trợ KH). |
| **N** | **Identified Users** (tab Users) | `GET /analytics/sessions`. Chỉ phiên có `visitor.identityMapping.user`. Gom theo `user.id`: mỗi user một dòng; gom thêm danh sách `visitorId` khác nhau (đếm **Linked Devices**). `firstLinked` = `startedAt` sớm nhất trong các phiên của user đó. **Cột:** *Name / Email* \| *Mã KH (ERP ID)* (`erpId` hoặc `-`) \| *Linked Devices* (số lượng) \| *Date First Linked (GMT+7)*. Empty: *No identified users*. | Chỉ **đã định danh** (§4.3.1). |
| **O** | **All Events** (tab Events) | `flatMap` events từ `sessions`; enrich: `visitorId`, `userName`, `userEmail`, `erpId` từ mapping. **Giới hạn hiển thị** vd. **50 dòng** đầu (dashboard slice). **Cột:** *Event Name* (badge) \| *UTM Source* (và *utm_medium* hoặc *direct*) \| *Visitor/User* (click → mở **(P)**) \| *Time (GMT+7)* \| *Properties* (JSON string/compact). | Bảng **toàn bộ sự kiện thô** trong cửa sổ — marketing / IT. |
| **P** | **Hồ sơ Visitor / User** (modal khi click khách ở tab Events) | `GET /analytics/sessions`. Chọn `visitorId` (hoặc gom theo `userId` nếu đã identify — logic giống `getVisitorProfile` TrackFlow): gom mọi phiên liên quan; tính **visits**, **views** (đếm `pageview`), **events** (tổng event − views hoặc tổng tùy định nghĩa bạn chọn), **durationSec** (tổng thời lượng phiên), **firstSeen** / **lastSeen**, **geo** từ `location`, **browser** / **os** / **device** từ UA + `device`, **latestPreviewProducts** từ `checkout_preview` mới nhất, **orderNos** unique từ `checkout_success`. Hiển thị avatar chữ cái, tiêu đề tên/email, chip *MÃ KH* hoặc visitorId rút gọn; khối *Sản phẩm đang mua (mới nhất)* / *Mã đơn hàng*; lưới 4 ô Visits / Views / Events / Visit Duration; card thuộc tính; timeline **Activity** theo ngày/giờ. | **360° một khách** (tiềm năng hoặc đã CRM) trong phạm vi dữ liệu tracking. |

**Tóm tắt luồng cho ERP:**  
- **Một lần poll “nền”:** `sessions` + `active-users` (cùng chu kỳ).  
- **Mỗi khi đổi tab / search “Phân tích chi tiết”:** `dimension-stats`.  
- **Hầu hết widget tab Dashboard** (KPI, commerce, **Geographical Distribution**, **Traffic Peak Hours**, **Activity**, **Device Distribution**, Recent Sessions, modal) dùng **`sessions`**; **chỉ** ô “Đang truy cập” = `active-users`. Tab Users / Events và modal profile cũng từ **`sessions`**.

---

## 4. `GET /api/v1/analytics/sessions`

### 4.1. Query

| Param | Bắt buộc | Ý nghĩa |
|-------|----------|---------|
| `since` | Không | ISO 8601 — chỉ phiên `startedAt >= since`. Sai định dạng / bỏ trống → server dùng mặc định (`ANALYTICS_DEFAULT_DAYS`). |
| `limit` | Không | Số phiên tối đa; bị cắt bởi `ANALYTICS_MAX_LIMIT` trên server. |

**Khuyến nghị:** `since` = đầu cửa sổ N ngày (vd. 30), `limit` = 8000 (hoặc theo policy server).

### 4.2. Response headers (hiển thị chú thích cho user)

| Header | Ý nghĩa |
|--------|---------|
| `X-Analytics-Since` | Mốc `since` thực tế (ISO). |
| `X-Analytics-Limit` | Giới hạn số phiên của response. |
| `X-Analytics-Events-Cap` | Tối đa số **event / phiên** trong JSON; **ưu tiên event mới** — timeline dài có thể thiếu event cũ. |

Ví dụ chú thích UI: *“Dữ liệu từ … · tối đa … phiên · tối đa … sự kiện/phiên (ưu tiên mới nhất).”*

### 4.3. Body — mảng `Session`

Thứ tự: `startedAt` **giảm dần** (phiên mới trước).

**Session (các trường thường dùng):**

| Trường | Mô tả / dùng trên UI |
|--------|----------------------|
| `id`, `visitorId` | Khóa phiên, gom khách. |
| `startedAt`, `updatedAt`, `endedAt` | Thời gian, thời lượng phiên, trạng thái kết thúc. |
| `device`, `ip`, `location`, `userAgent` | Thiết bị, mạng, geo (JSON string → `country`, `city`…), UA. |
| `events[]` | Danh sách sự kiện. |
| `visitor.identityMapping` | Có **sau khi** site gọi **`POST /api/v1/identify`** cho `visitorId` đó; nếu **chưa có** → khách vẫn là **ẩn danh** (chỉ có `visitorId`). |

**Event:**

| Trường | Mô tả |
|--------|--------|
| `name` | `pageview`, `checkout_preview`, `checkout_success`, … |
| `properties` | Object JSON: thường `url`, `title`, `referrer`, `language`, `productNames[]`, `orderNo`, … |
| `timestamp` | ISO. |

**Lưu ý:** API **không** trả `context` trên event; mọi thứ đọc từ **`properties`** và trường session. Server ghi thêm `referrer`, `language` vào `properties` khi client gửi trong `context` lúc track.

### 4.3.1. Khách tiềm năng ẩn danh vs khách đã định danh (đăng nhập / ERP)

Để ERP và người xem báo cáo **không nhầm** “chưa có tên” với “lỗi dữ liệu”:

| Giai đoạn | Điều kiện trong JSON `GET /analytics/sessions` | Ý nghĩa nghiệp vụ | ERP nên hiển thị thế nào |
|-----------|--------------------------------------------------|-------------------|---------------------------|
| **Ẩn danh / KH tiềm năng** | `visitor.identityMapping` **vắng** hoặc **null**. Vẫn có `visitorId` (UUID ổn định cho trình duyệt/thiết bị đó). | Người đã vào site (pageview, có thể có giỏ preview, v.v.) nhưng **chưa** được site gắn với tài khoản ERP / chưa đăng nhập (snippet **chưa** gọi `identify` cho `visitorId` này). | Cột **Khách:** nhãn kiểu *“Chưa định danh”*, *“Khách tiềm năng”* hoặc hiển thị **rút gọn `visitorId`** (vd. 8 ký tự đầu) + tooltip “Ẩn danh”. Có thể thêm **badge** “Ẩn danh”. **Không** coi là thiếu mã KH do lỗi tích hợp nếu luồng nghiệp vụ cho phép xem site khi chưa login. |
| **Đã định danh** | Có `visitor.identityMapping.user` với các trường tùy dữ liệu gửi lúc identify: `name`, `email`, `erpId`, … | Sau **đăng nhập** (hoặc sự kiện tương đương), site gọi **`POST /api/v1/identify`** với cùng `visitorId` + `userId` / `traits` → backend lưu **User** và **IdentityMapping**. | Cột **Khách:** ưu tiên **`user.name`** (có thể kèm `user.email`), hoặc email nếu không có tên; hiển thị **mã KH ERP** nếu có `user.erpId` (vd. nhãn “Mã KH: …”). Có thể badge “Đã định danh”. |

**Luồng thời gian (một người thật):**

1. Lần đầu vào site → mọi phiên/event gắn `visitorId` mới, **chưa** có tên / mã KH → báo cáo thấy **ẩn danh**.  
2. Sau khi đăng nhập → snippet (hoặc server site) gọi **`identify`** → từ thời điểm đó, các **phiên cùng visitor** trong dữ liệu analytics sẽ có `identityMapping` (theo cách backend trả về).  
3. **Một người** có thể từng có **nhiều `visitorId`** (nhiều thiết bị, xóa cookie, trước khi login) — tab **Users** (mục **N**) gom theo **user đã identify**; riêng **ẩn danh** vẫn xuất hiện theo từng `visitorId` trong bảng phiên / commerce cho đến khi được map.

**Gợi ý copy cho user nội bộ / ERP:**  
*“Dữ liệu tracking luôn có mã phiên khách ẩn danh (`visitorId`). Tên, email, mã KH chỉ hiện sau khi khách đăng nhập (hoặc được định danh) và hệ thống web đã gọi API identify; trước đó cột khách hiển thị ‘Chưa định danh’ là đúng thiết kế.”*

### 4.4. Thương mại (preview / đặt hàng): lưu trong DB như thế nào, API nào trả ra?

Ba khối **Đang mua (preview /thanh-toan)**, **Báo cáo: Sản phẩm khách muốn mua**, **Đơn hàng thành công** **không** có endpoint GET riêng. Toàn bộ dữ liệu nằm trong **`GET /api/v1/analytics/sessions`**: mỗi phần tử là một **phiên** (`Session`) kèm mảng **`events`**. ERP **lọc và gom** các `events` theo `name` và `properties` như bảng dưới.

#### Bước 1 — Ghi vào database (phía site / snippet, không phải ERP)

| Bước | Chi tiết |
|------|-----------|
| API ghi | **`POST /api/v1/track`** (xem **`/openapi.json`**) — header `x-api-key`, body có `visitorId`, `sessionId`, `name`, `properties` (và tùy chọn `context`). |
| Lưu ở đâu | PostgreSQL: bảng **`Event`** — mỗi lần track tạo **một dòng** với `name`, `properties` (kiểu JSON), `timestamp`, liên kết `sessionId` → **`Session`**. |
| Phiên & khách | Cùng request có thể tạo/cập nhật **`Session`** và **`Visitor`**; nhãn khách (tên, email, mã ERP) đến từ **`POST /api/v1/identify`** → bảng `User` + `IdentityMapping`, rồi xuất hiện trong `sessions[].visitor` khi đọc analytics. |

#### Bước 2 — Hai loại sự kiện commerce (tên cố định)

| `name` | Khi nào thường có (tham chiếu snippet site) | `properties` cần có để dashboard đầy đủ |
|--------|---------------------------------------------|--------------------------------------|
| **`checkout_preview`** | Sau khi gọi API **preview giỏ** (vd. trang `/thanh-toan` trả về giỏ hợp lệ). | **`productNames`**: mảng **chuỗi** tên sản phẩm (vd. lấy từ `cartItems[].name`). Mỗi lần preview thành công = có thể **một event** mới. |
| **`checkout_success`** | Sau khi API **đặt hàng / checkout** thành công. | **`orderNo`**: mã đơn (string). Khuyến nghị thêm **`productNames`** (mảng chuỗi) nếu response có danh sách dòng hàng — để báo cáo “sản phẩm mua nhiều”; chỉ có `orderNo` vẫn hiển thị đơn nhưng xếp hạng SP có thể trống. |

#### Bước 3 — Đọc ra cho ERP (một API)

Chỉ cần:

`GET /api/v1/analytics/sessions?since=...&limit=...` + `x-api-key`.

Trong JSON trả về, với **mỗi** `session`:

- Duyệt `session.events`.
- **`Đang mua (preview /thanh-toan)`** — mọi phần tử có **`event.name === 'checkout_preview'`**: một **dòng bảng** = một event; cột thời gian = `event.timestamp`; cột khách = từ `session.visitor.identityMapping.user`; cột sản phẩm = `event.properties.productNames` (hiển thị dạng tag/chip).
- **`Báo cáo: Sản phẩm khách muốn mua`** — **không** có sẵn dạng bảng trong API: ERP **tự gom** từ **tất cả** event `checkout_preview` trong toàn bộ `sessions`: với mỗi event, duyệt `properties.productNames[]`, mỗi tên (sau `trim`) **cộng 1** vào đếm; sort giảm theo đếm → top N (vd. 50).
- **`Đơn hàng thành công`** — mọi phần tử có **`event.name === 'checkout_success'`**: một dòng = một đơn (theo event); cột mã đơn = `properties.orderNo`; khách giống preview. **Báo cáo “sản phẩm mua nhiều”** gom `productNames` từ các event `checkout_success` **cùng quy tắc đếm** như preview.

#### Giới hạn cần nói với user báo cáo

- Mỗi phiên chỉ trả **tối đa N event** (header **`X-Analytics-Events-Cap`**, ưu tiên mới). Phiên rất dài có thể **không còn** `checkout_preview` / `checkout_success` cũ trong payload → số liệu commerce trong cửa sổ đó có thể thiếu so với thực tế DB.

---

## 5. `GET /api/v1/analytics/dimension-stats`

Dùng cho **một bảng / biểu đồ** giống “Phân tích chi tiết bộ lọc”: mỗi dòng là một giá trị dimension với số **Khách** (unique visitor), **Lượt xem** (pageview theo quy tắc server), **Phiên**, **Thoát** (bounce theo quy tắc server), **Thời gian TB** (giây).

### 5.1. Query

| Param | Bắt buộc | Ý nghĩa |
|-------|----------|---------|
| **`dimension`** | **Có** | Một trong bảng ánh xạ dưới đây (chữ thường). |
| `since` | Không | Giống `analytics/sessions`. |
| `limit` | Không | Giới hạn số **phiên** đưa vào tính toán (cùng cap server). |
| `search` | Không | Chuỗi con (không phân biệt hoa thường) lọc theo **tên dòng** (`dimensionValue`). |

### 5.2. Giá trị `dimension` — gửi trong query & ý nghĩa từng field

**Quy tắc:** tham số query tên **`dimension`**, giá trị **chữ thường**, **chỉ** một trong các chuỗi dưới đây. Giá trị khác → API trả `400`.

Ví dụ URL:

`GET /api/v1/analytics/dimension-stats?dimension=path&since=2026-01-01T00:00:00.000Z&limit=8000`

| Giá trị gửi (`dimension=…`) | Nhãn gợi ý (UI) | Mỗi dòng `rows[].dimensionValue` là gì (ERP hiển thị cột đầu bảng) |
|---------------------------|-----------------|---------------------------------------------------------------------|
| `path` | Đường dẫn | Pathname trang (từ `properties.url` của từng **pageview**), vd. `/`, `/dang-nhap`. |
| `title` | Tiêu đề | Tiêu đề trang (từ `properties.title` hoặc suy từ URL/slug; trang chủ thường là `Trang chủ`). |
| `country` | Quốc gia | Mã hoặc tên quốc gia parse từ `session.location` (JSON), vd. `VN`. Nếu không xác định: `(Không xác định)`. |
| `city` | Thành phố | Từ `session.location` (JSON). Không có: `(Không xác định)`. |
| `browser` | Trình duyệt | Một trong: `Chrome`, `Safari`, `Firefox`, `Edge`, `Other` (suy từ `userAgent`). |
| `os` | Hệ điều hành | Một trong: `macOS`, `Windows`, `Linux`, `Android`, `iOS`, hoặc `(Không xác định)`. |
| `device` | Thiết bị | `Desktop/Laptop` hoặc `Mobile` (theo chuỗi `session.device`). |
| `language` | Ngôn ngữ | Chuỗi locale pageview đầu phiên, vd. `vi-VN` (mặc định nếu không có `properties.language`). |
| `entry` | Trang vào | Pathname của **pageview đầu tiên** (theo thời gian) trong phiên. |
| `exit` | Trang thoát | Pathname của **pageview cuối** trong phiên. |
| `referrer` | Nguồn giới thiệu | Hostname referrer pageview đầu (từ `properties.referrer`); không có: `Direct/Unknown`. |

**Các cột số trong mỗi `row` (giống mọi `dimension`):**

| Field JSON | Ý nghĩa hiển thị |
|------------|------------------|
| `visitorsCount` | Số **khách** (visitor) khác nhau. |
| `pageviews` | Số **lượt xem** (pageview) theo quy tắc server cho dimension đó. |
| `sessionsCount` | Số **phiên**. |
| `bounces` | Số **thoát** (phiên bounce gán vào giá trị dimension đó). |
| `avgDurationSec` | **Thời gian trung bình / phiên** (giây) — format `Xm Ys` trên UI. |

**Danh sách cho phép (copy gửi đối tác):**  
`path` · `title` · `country` · `city` · `browser` · `os` · `device` · `language` · `entry` · `exit` · `referrer`

### 5.3. Response headers

Giống `analytics/sessions`: `X-Analytics-Since`, `X-Analytics-Limit`, `X-Analytics-Events-Cap`.

### 5.4. Body (JSON)

```json
{
  "rows": [
    {
      "dimensionValue": "/dang-nhap",
      "visitorsCount": 12,
      "pageviews": 34,
      "sessionsCount": 15,
      "bounces": 3,
      "avgDurationSec": 125.5
    }
  ],
  "meta": {
    "dimension": "path",
    "since": "2026-03-01T00:00:00.000Z",
    "sessionLimit": 8000,
    "eventsCapPerSession": 4000,
    "computedAt": "2026-04-05T16:00:00.000Z",
    "fromCache": false
  }
}
```

| Trường `row` | Hiển thị ERP |
|--------------|----------------|
| `dimensionValue` | Cột tên dimension (Đường dẫn / Quốc gia / …). |
| `visitorsCount` | **Khách** |
| `pageviews` | **Lượt xem** |
| `sessionsCount` | **Phiên** |
| `bounces` | **Thoát** (số phiên bounce gán vào dimension đó — logic trùng server). |
| `avgDurationSec` | **Thời gian TB** — format `Xm Ys` (làm tròn phút/giây tùy UI). |

**Sắp xếp:** server trả `rows` đã sort **giảm theo `visitorsCount`**.

**Cache:** server có thể lưu snapshot JSON trong DB và trả `fromCache: true` trong `meta` trong TTL (mặc định vài chục giây, cấu hình `ANALYTICS_DIMENSION_CACHE_TTL_SEC` trên server). Dữ liệu có thể trễ tối đa một TTL so với ghi event mới.

---

## 6. `GET /api/v1/active-users`

- **Response:** `{ "count": <number> }` — số **phiên** có cập nhật gần đây (~60s) và chưa `endedAt`.
- **UI:** một KPI + % so với lần gọi trước (công thức tùy ERP; dashboard mẫu: so sánh với `count` kỳ polling trước).

---

## 7. Map nhanh: vùng dashboard → nguồn dữ liệu

| Vùng dashboard (khái niệm) | API | Ghi chú |
|----------------------------|-----|---------|
| Thẻ KPI (phiên, UV, pageview, bounce %, thời lượng, trend…) | `analytics/sessions` | Tính **trên client** (công thức **mục 8**). |
| **Geographical Distribution** (map + top 5 quốc gia) | `analytics/sessions` | Parse `location` → `country`, đếm phiên (**§3-G**). |
| **Traffic Peak Hours** (heatmap 7×24, giờ VN) | `analytics/sessions` | Đếm phiên theo `startedAt` + `Asia/Ho_Chi_Minh` (**§3-H**). |
| **Activity (Last 10 Sessions)** (line chart) | `analytics/sessions` | 10 phiên đầu, trục Y = `events.length` (**§3-I**). |
| **Device Distribution** (thanh % — browser trong dashboard mẫu) | `analytics/sessions` | Phân loại từ `userAgent` (**§3-J**). |
| **Phân tích chi tiết bộ lọc** | **`analytics/dimension-stats`** | Không tự gom dimension trên ERP. |
| Commerce (preview, đơn, xếp hạng SP) | `analytics/sessions` | **mục 9**, **§4.4**. |
| Recent Sessions; Session Details; Visitor profile | `analytics/sessions` | **§3-L, M, P** |
| Identified Users; All Events | `analytics/sessions` | **§3-N, O** |
| Đang hoạt động | `active-users` | Chỉ `count`. |

---

## 8. Công thức client từ `analytics/sessions` (KPI & trend)

Chỉ áp dụng khi bạn **tự tính** trên ERP (dashboard mẫu vẫn làm vậy cho phần tổng quan).

- **Bounce (theo phiên):** sau khi bỏ `heartbeat`, số event còn lại **≤ 1**.
- **Tổng pageview:** đếm event `name === 'pageview'`.
- **Unique visitors:** `new Set(sessions.map(s => s.visitorId)).size`.
- **Thời lượng phiên (giây):** `(updatedAt || startedAt) - startedAt`.
- **Trend % (chia đôi theo `startedAt`):** nửa đầu vs nửa sau theo thời gian của cửa sổ — so sánh KPI hai nửa (cùng công thức trên).

---

## 9. Commerce (chỉ từ `events` trong `sessions`)

**Ghi nhớ:** không có GET commerce riêng — mọi thứ là các **dòng `Event`** trong response `GET /analytics/sessions`. Cách dữ liệu được **ghi vào Postgres** (`POST /track`) rồi **đọc ra** cho ba khối *Đang mua*, *Muốn mua*, *Đơn thành công* — xem **§4.4**.

| Mục | Điều kiện | Trường hay dùng |
|-----|-----------|-----------------|
| Xem trước thanh toán | `name === 'checkout_preview'` | `properties.productNames` (mảng string), nhãn khách từ `visitor.identityMapping.user`. |
| Đặt hàng thành công | `name === 'checkout_success'` | `properties.orderNo`, `productNames` nếu có. |
| Xếp hạng “muốn mua” / “đã mua” | Gom `productNames` từ preview / success | Mỗi phần tử string (trim) trong mảng, mỗi lần xuất hiện **+1** count cho tên đó. |

---

## 10. Users & raw events

- **Gom user (đã định danh):** cùng `visitor.identityMapping.userId` — khách **chưa** `identify` không có user, chỉ `visitorId` (**§4.3.1**). Gom theo `visitorId` chỉ khi muốn danh sách “mọi fingerprint”, khác với tab Users CRM.
- **Raw list:** `flatMap` events, gắn `visitorId`, và `email` / `name` / `erpId` từ `identityMapping.user` **chỉ khi có**; sort theo `timestamp`.

---

## 11. Ví dụ `curl`

```bash
export BASE="https://tracking.example.com"
export KEY="your_tracking_api_key"

curl -sS "$BASE/api/v1/analytics/sessions?since=2026-03-01T00:00:00.000Z&limit=8000" \
  -H "x-api-key: $KEY" -D -

curl -sS "$BASE/api/v1/analytics/dimension-stats?dimension=path&since=2026-03-01T00:00:00.000Z&limit=8000&search=dang" \
  -H "x-api-key: $KEY"

curl -sS "$BASE/api/v1/active-users" -H "x-api-key: $KEY"
```

---

## 12. Rủi ro tích hợp

1. **Cap event/phiên** — KPI và dimension-stats đều chịu `X-Analytics-Events-Cap`; phiên rất dài có thể thiếu pageview cũ → số liệu lệch; nên hiển thị header cho end-user.
2. **Cache dimension-stats** — có thể `fromCache: true`; dữ liệu mới nhất có độ trễ theo TTL server.
3. **Đồng bộ `since` / `limit`** — nên dùng **cùng một cặp** `since` + `limit` cho `sessions` và `dimension-stats` trong một “màn hình” để số liệu tổng quan và bảng lọc khớp cửa sổ.

---

*Tài liệu phản ánh API tại repo TrackFlow (`backend/src/index.ts`, `dimension-analytics.ts`, `dashboard/src/App.tsx`). Khi server thay đổi env giới hạn hoặc schema, chủ hệ thống cần cập nhật tài liệu này cho đối tác ERP.*
