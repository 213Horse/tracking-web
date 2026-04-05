# Server chỉ Docker — không clone source

Luồng: **push `main`** → GitHub Actions build image → **rsync** thư mục `deploy/` lên server → **tạo `deploy/.env` từ Secrets** → **`docker compose up`**.

Trên server **không cần** `git clone`. Chỉ cần **Docker** và user có quyền chạy `docker` (nhóm `docker`).

**Backend** chỉ lộ **`127.0.0.1:6510`** — **không** chiếm port 80 trong Docker (để các site Nginx sẵn có trên server không bị ảnh hưởng). Thêm **virtual host** Nginx trên host + HTTPS: xem **`deploy/SETUP_EXISTING_NGINX_HTTPS.md`** và file **`deploy/nginx/host/tracking.david.io.vn.conf`**.

---

## 1. Chuẩn bị server (một lần)

```bash
# Ubuntu: Docker (hoặc cài docker.io + docker-compose-plugin)
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION_ID}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Bắt buộc có một trong hai: `docker compose` (plugin) hoặc lệnh `docker-compose`
docker compose version || sudo apt install -y docker-compose

sudo usermod -aG docker "$USER"
# Đăng xuất SSH vào lại để nhóm docker có hiệu lực
```

Firewall (nếu dùng `ufw`; thường **80/443 đã mở** vì server đang chạy site khác):

```bash
sudo ufw allow OpenSSH
sudo ufw status
```

Chỉ thêm rule nếu thiếu: `sudo ufw allow 80/tcp` và `sudo ufw allow 443/tcp`.

---

## 2. SSH key cho GitHub Actions (trên server)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_actions_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/github_actions_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_actions_deploy
```

Copy **private key** (toàn bộ) vào GitHub secret **`DEPLOY_SSH_KEY`**.

---

## 3. GitHub → Settings → Secrets and variables → Actions

| Secret | Bắt buộc | Mô tả |
|--------|----------|--------|
| `DEPLOY_HOST` | Có | IP server, ví dụ `160.191.50.186` |
| `DEPLOY_USER` | Có | User SSH (đã có key ở bước 2) |
| `DEPLOY_SSH_KEY` | Có | Private key PEM |
| `DEPLOY_POSTGRES_PASSWORD` | Có | Mật khẩu PostgreSQL (workflow ghi vào `.env` mỗi lần deploy) |
| `DEPLOY_TRACKING_API_KEY` | Có | `TRACKING_API_KEY` cho API / snippet |
| `DEPLOY_PATH` | Không | Mặc định `/opt/tracking` |
| `GHCR_PULL_TOKEN` | Nếu package GHCR **private** | PAT (Classic) quyền **`read:packages`**. Đăng nhập: user = **username GitHub chữ thường** (workflow đã xử lý). **Hoặc** vào GitHub → **Packages** → package `tracking-backend` → **Package settings** → đổi **Visibility** sang **Public** để không cần token. |
| `DEPLOY_API_PUBLIC_URL` | Không | Mặc định `https://tracking.david.io.vn` |

Workflow **tự tạo** `deploy/.env` trên server (ghi đè mỗi lần deploy). Bạn **không** cần tạo file `.env` tay trên server.

---

## 4. DNS

Bản ghi **A**: `tracking.david.io.vn` → IP server.

---

## 5. Deploy

Push lên `main` (có thay đổi trong `backend/`, `deploy/`, hoặc workflow) hoặc chạy **Actions → Run workflow**.

Lần đầu Action sẽ `mkdir` `/opt/tracking/deploy`, rsync, ghi `.env`, `docker compose pull && up -d`.

Kiểm tra trên server:

```bash
docker ps
# Kỳ vọng: 127.0.0.1:6510->6510 (backend), 127.0.0.1:6511->5432 (postgres)
```

Sau đó cấu hình **Nginx host + Certbot**: **`deploy/SETUP_EXISTING_NGINX_HTTPS.md`**.

---

## 6. Nginx & HTTPS trên server đã có site khác

Chi tiết lệnh: **`SETUP_EXISTING_NGINX_HTTPS.md`**. File site mẫu: **`deploy/nginx/host/tracking.david.io.vn.conf`**.
