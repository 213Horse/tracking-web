# Tracking + server đã có Nginx & site khác (không ảnh hưởng port 80 chung)

Stack Docker **chỉ** chạy **Postgres + backend**, bind **`127.0.0.1:6510`** và **`127.0.0.1:6511`** — **không** mở port 80 trong Docker, nên **không đụng** Nginx đang phục vụ các domain khác.

---

## 1. DNS

Bản ghi **A**: `tracking.david.io.vn` → IP server.

---

## 2. Đảm bảo Docker tracking không chiếm 80/443

Sau khi GitHub Actions deploy (hoặc `docker compose up`):

```bash
docker ps
```

Bạn chỉ nên thấy mapping dạng **`127.0.0.1:6510->6510`**, **không** có `0.0.0.0:80`.

Nếu còn container `tracking-nginx` cũ:

```bash
cd /opt/tracking   # hoặc DEPLOY_PATH của bạn
docker compose -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

---

## 3. Thêm site Nginx cho domain (chỉ thêm file mới)

**Không** sửa `default` hay config site đang chạy — chỉ **thêm** site tracking.

Giả sử sau rsync từ CI, file nằm tại `/opt/tracking/deploy/nginx/host/tracking.david.io.vn.conf` (đổi đường dẫn nếu `DEPLOY_PATH` khác):

```bash
# Sao chép vào sites-available (tên file tùy bạn, nên giữ .conf)
sudo cp /opt/tracking/deploy/nginx/host/tracking.david.io.vn.conf /etc/nginx/sites-available/tracking.david.io.vn.conf

# Bật site (symlink — không ghi đè file site khác)
sudo ln -sf /etc/nginx/sites-available/tracking.david.io.vn.conf /etc/nginx/sites-enabled/tracking.david.io.vn.conf

# Kiểm tra cú pháp — bắt buộc trước khi reload
sudo nginx -t

sudo systemctl reload nginx
```

Nếu `nginx -t` báo lỗi, **không** `reload` — sửa file rồi chạy lại `nginx -t`.

---

## 4. Cài Certbot và cấp chứng chỉ HTTPS (Let’s Encrypt)

Chỉ cài nếu chưa có:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

Cấp chứng chỉ và **để Certbot tự chỉnh Nginx** (thêm `listen 443 ssl`, đường dẫn cert, thường có redirect HTTP→HTTPS):

```bash
sudo certbot --nginx -d tracking.david.io.vn
```

Làm theo prompt (email, đồng ý điều khoản). Xong chạy lại:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Gia hạn tự động (thường Certbot đã tạo **timer** `certbot.timer`):

```bash
sudo systemctl status certbot.timer
# Kiểm tra thử (không đổi cert thật nếu chưa đến hạn):
# sudo certbot renew --dry-run
```

---

## 5. Kiểm tra nhanh

```bash
curl -sI http://127.0.0.1:6510/api/v1/active-users -H "x-api-key: YOUR_KEY" | head -5
curl -sI https://tracking.david.io.vn/api/v1/active-users -H "x-api-key: YOUR_KEY" | head -5
```

Swagger: `https://tracking.david.io.vn/api-docs`

---

## 6. Tuỳ chọn: rate limit riêng (tránh trùng zone với site khác)

Chỉ khi bạn **chắc** trong `http {}` chưa có zone trùng tên:

```bash
sudo cp /opt/tracking/deploy/nginx/host/optional-rate-limits.conf /etc/nginx/conf.d/90-tracking-david-limits.conf
sudo nginx -t && sudo systemctl reload nginx
```

Sửa file trong `sites-available` để thêm các dòng `limit_req` / `limit_conn` như ghi chú trong `optional-rate-limits.conf`.

---

## 7. Nếu trước đó đã cài `00-tracking-limits.conf` (tên zone `tracking_req`)

File site `deploy/nginx/host/tracking.david.io.vn.conf` **không** dùng `limit_req` — an toàn với mọi site. Zone trong `conf.d` cũ vẫn dùng được cho site **khác** nếu đã cấu hình; không bắt buộc cho tracking.
