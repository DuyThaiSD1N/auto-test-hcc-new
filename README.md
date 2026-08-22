# Auto Test Hành chính công

Hệ thống thử nghiệm tự động điền hồ sơ dịch vụ công.
Giai đoạn hiện tại: **frontend đăng nhập + chọn thủ tục** (backend FastAPI cấp API).

## Cấu trúc

```
backend/                FastAPI
  app/main.py           khởi tạo app, CORS, khai báo router
  app/config.py         cấu hình đọc từ biến môi trường APP_*
  app/security.py       băm mật khẩu (PBKDF2) + JWT
  app/store.py          kho tài khoản (in-memory) + nạp/tìm kiếm thủ tục
  app/deps.py           dependency xác thực Bearer token
  app/routers/auth.py   POST /api/auth/login, GET /api/auth/me
  app/routers/procedures.py  GET /api/procedures, GET /api/procedures/{key}
  app/data/procedures.json   danh sách 31 thủ tục
frontend/               Vite + React + TypeScript
  src/pages/LoginPage.tsx       UI đăng nhập
  src/pages/ProceduresPage.tsx  UI danh sách + chọn thủ tục
  src/auth/AuthContext.tsx      lưu phiên, tự khôi phục từ localStorage
  src/api/client.ts             gọi API qua proxy /api
```

## Chạy dự án

**Backend** (cửa sổ 1):

```powershell
cd backend
python -m venv .venv                  # chỉ cần lần đầu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

**Frontend** (cửa sổ 2):

```powershell
cd frontend
npm install                           # chỉ cần lần đầu
npm run dev
```

Mở http://localhost:5173 — Vite tự proxy `/api` sang `http://127.0.0.1:8000`.

Tài liệu API tự sinh: http://127.0.0.1:8000/docs

## Tài khoản thử nghiệm

| Tài khoản | Mật khẩu |
|-----------|----------|
| `admin`   | `admin123` |

Đổi bằng biến môi trường `APP_DEFAULT_USERNAME` / `APP_DEFAULT_PASSWORD` (xem `backend/.env.example`).
Tài khoản hiện lưu trong bộ nhớ, sẽ thay bằng CSDL ở bước sau.

## API

| Method | Đường dẫn | Mô tả |
|--------|-----------|-------|
| GET | `/api/health` | kiểm tra sống |
| POST | `/api/auth/login` | `{username, password}` → JWT + thông tin người dùng |
| GET | `/api/auth/me` | thông tin người dùng của token hiện tại |
| GET | `/api/procedures?q=` | danh sách thủ tục, tìm theo tên/mã (không phân biệt dấu và hoa thường) |
| GET | `/api/procedures/{key}` | chi tiết một thủ tục |

## Bóc tách hồ sơ theo lô

Giao diện `/thu-tuc/{key}` cho phép tải nhiều hồ sơ lên và gọi API bóc tách của Auto Fill HCC.

**Secret không bao giờ ra tới trình duyệt.** Trình duyệt gọi `/api/batch/*` bằng JWT đăng nhập,
FastAPI mới đính `Authorization: Bearer <BATCH_API_SECRET>` rồi gọi sang Auto Fill HCC.

### Cấu hình

Toàn bộ cấu hình nằm trong file `.env`, không cần truyền biến trên dòng lệnh:

- `backend/.env` — khi chạy `uvicorn` từ thư mục `backend/`
- `.env` ở thư mục gốc — khi chạy `docker compose`

Cả hai file đã có trong `.gitignore` nên không bị đẩy lên git. Mẫu để copy: `backend/.env.example`
và `.env.example`.

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `APP_BATCH_API_BASE_URL` | `https://trolyhoso-hcc-admin.vnekyc.vn` | địa chỉ API bóc tách |
| `APP_BATCH_API_SECRET` | *(rỗng)* | secret do đội Auto Fill HCC cấp |

**Sửa `.env` xong phải khởi động lại backend** — `--reload` chỉ theo dõi file `.py`, không theo dõi `.env`.

Chưa đặt secret thì `/api/batch/status` trả `configured: false`, giao diện hiện cảnh báo
và nút bắt đầu bị khóa — thay vì để người dùng bấm rồi gặp lỗi khó hiểu.

### Luồng chạy

1. Chọn thủ tục → **Bắt đầu thử nghiệm**.
2. Thêm hồ sơ: một hồ sơ có thể gồm nhiều file (tờ khai, CCCD…), hoặc chọn *Mỗi file là một hồ sơ*.
3. **Bắt đầu bóc tách** → tạo phiên → tải hồ sơ (song song 3 hồ sơ như tài liệu API khuyến nghị)
   → start → tự poll mỗi 3 giây.
4. Xong thì bấm *Xem kết quả* ở từng hồ sơ để xem các trường đã bóc tách; hồ sơ lỗi có nút *Chạy lại*.

Mỗi lần tải dùng header `Idempotency-Key` dạng `{jobId}-{clientDossierId}`, nên nếu mạng timeout
và gửi lại thì server nhận ra trùng, không tạo hồ sơ thừa.

### Endpoint proxy

| Method | Đường dẫn | Ghi chú |
|--------|-----------|---------|
| GET | `/api/batch/status` | đã cấu hình secret chưa |
| POST | `/api/batch/jobs` | tạo phiên quét |
| POST | `/api/batch/jobs/{jobId}/items` | tải một hồ sơ (multipart) |
| POST | `/api/batch/jobs/{jobId}/start` | bắt đầu xử lý |
| GET | `/api/batch/jobs/{jobId}` | tiến độ |
| GET | `/api/batch/jobs/{jobId}/items` | danh sách hồ sơ, lọc `?status=failed` |
| GET | `/api/batch/jobs/{jobId}/results` | kết quả các hồ sơ `done` |
| GET | `/api/batch/items/{itemId}/result` | kết quả một hồ sơ |
| POST | `/api/batch/items/{itemId}/retry` | chạy lại hồ sơ lỗi |
| POST | `/api/batch/jobs/{jobId}/pause\|resume\|cancel` | tạm dừng / chạy tiếp / hủy |
| DELETE | `/api/batch/jobs/{jobId}` | xóa phiên sau khi đã lưu kết quả |

Backend kiểm tra trước khi gọi ra ngoài: định dạng file (JPG, PNG, PDF, DOCX), 80MB mỗi file,
100MB mỗi hồ sơ, mã thủ tục phải có trong danh mục. Lỗi từ API bóc tách được dịch sang thông báo
tiếng Việt (`INVALID_BATCH_SECRET`, `BATCH_QUEUE_FULL`, `FILE_TOO_LARGE`…).

## Hosting / Triển khai

Khi build production, **FastAPI phục vụ luôn giao diện** (`frontend/dist`) trên cùng một cổng,
nên chỉ cần mở 1 port, không phải cấu hình CORS, không lo lệch domain giữa FE và BE.

### Cách 1 — Docker (khuyến nghị)

```bash
cp .env.example .env          # rồi sửa APP_SECRET_KEY và APP_DEFAULT_PASSWORD
docker compose up -d --build
```

Truy cập http://localhost:8000. Image tự build giao diện Vite ở giai đoạn 1 rồi copy vào runtime Python,
chạy bằng user thường (không phải root), có sẵn healthcheck.

Sinh khoá bí mật:

```bash
openssl rand -hex 32
```

### Cách 2 — VPS không dùng Docker

```bash
cd frontend && npm ci && npm run build          # tạo frontend/dist
cd ../backend && pip install -r requirements.txt
APP_SECRET_KEY=... uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend tự tìm `frontend/dist` ở thư mục anh em; nếu để chỗ khác thì trỏ bằng `APP_FRONTEND_DIST`.
Nên đặt sau nginx/Caddy để có HTTPS, và chạy dưới systemd để tự khởi động lại.

Ví dụ Caddy (tự cấp SSL Let's Encrypt):

```
autotest.tenmien.vn {
    reverse_proxy 127.0.0.1:8000
}
```

### Cách 3 — Render (đã cấu hình sẵn)

Repo có sẵn [`render.yaml`](render.yaml) nên Render tự đọc được toàn bộ cấu hình.

**Bước 1.** Đưa code lên GitHub (Render deploy từ Git repo):

```bash
git init
git add .
git commit -m "Auto test hanh chinh cong - dang nhap va chon thu tuc"
git branch -M main
git remote add origin https://github.com/<tài-khoản>/auto-test-hcc.git
git push -u origin main
```

**Bước 2.** Vào https://dashboard.render.com → **New** → **Blueprint** → chọn repo vừa push.
Render đọc `render.yaml`, hỏi giá trị `APP_DEFAULT_PASSWORD` (mật khẩu đăng nhập bạn muốn dùng),
`APP_SECRET_KEY` để Render tự sinh ngẫu nhiên.

**Bước 3.** Bấm **Apply**. Lần build đầu mất khoảng 5–10 phút (build cả Vite lẫn Python).
Xong sẽ có địa chỉ dạng `https://auto-test-hcc.onrender.com` — đăng nhập bằng `admin` và mật khẩu đã nhập.

Không dùng Blueprint cũng được: **New → Web Service** → chọn repo → Language **Docker** →
tự thêm các biến `APP_*` → Health check path `/api/health`.

**Lưu ý gói Free của Render**

| Điều | Ảnh hưởng |
|------|-----------|
| Ngủ sau 15 phút không có request | lần truy cập kế tiếp chờ ~50 giây mới lên |
| RAM 512MB, CPU 0.1 | đủ cho giai đoạn này, nhưng không đủ khi thêm Playwright |
| Không có ổ đĩa lưu trữ | mọi thứ ghi ra file sẽ mất khi restart — hiện chưa ảnh hưởng vì tài khoản nằm trong bộ nhớ |
| Mỗi lần restart, phiên đăng nhập vẫn còn | `APP_SECRET_KEY` do Render lưu, không đổi sau restart |

Muốn chạy 24/7 và về sau chạy được Playwright thì nâng lên gói **Starter** (đổi `plan: free` thành `plan: starter`
trong `render.yaml`).

### Cách 4 — PaaS khác (Railway, Fly.io…)

Trỏ thẳng vào `Dockerfile` ở thư mục gốc, khai báo các biến `APP_*`. Container tự bind theo biến `PORT`
nếu nền tảng cấp, không có thì mặc định 8000. Không cần đổi code.

### Bắt buộc trước khi chạy thật

| Việc | Lý do |
|------|-------|
| Đặt `APP_SECRET_KEY` ngẫu nhiên | mặc định là chuỗi công khai, ai cũng tự ký được JWT |
| Đổi `APP_DEFAULT_PASSWORD` | `admin123` là mật khẩu ai cũng biết |
| Bật HTTPS (Caddy/nginx/PaaS) | token gửi qua header, HTTP thường sẽ lộ |

Backend sẽ ghi cảnh báo trong log nếu hai giá trị trên vẫn để mặc định.

### Lưu ý cho bước tự động điền sắp tới

Bước tự động điền form sẽ cần trình duyệt thật (Playwright/Selenium chạy headless).
Loại hạ tầng phù hợp là **VPS hoặc container luôn chạy** — nền tảng serverless
(Vercel, Netlify Functions, Lambda mặc định) không chạy được trình duyệt lâu và có giới hạn thời gian,
nên hướng Docker ở trên là lựa chọn an toàn về sau.

## Bước tiếp theo (chưa làm)

- Tải tệp tài liệu lên và trích xuất dữ liệu
- Tự động điền form trên cổng dịch vụ công theo thủ tục đã chọn
- Lưu lịch sử phiên chạy thử nghiệm
