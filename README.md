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
  app/routers/batch.py       proxy /api/batch/* (tải hồ sơ, chạy, lấy kết quả)
  app/routers/history.py     tra cứu lịch sử đã lưu trong MongoDB
  app/extraction.py          chọn nguồn bóc tách theo cấu hình
  app/local_jobs.py          hàng đợi hồ sơ khi dùng BE nội bộ
  app/internal_client.py     gọi BE nội bộ (/api/v1/process)
  app/batch_client.py        gọi API bóc tách theo lô
  app/files.py               chuyển đổi file lạ trước khi bóc tách
  app/db.py, app/history.py  kết nối MongoDB và lưu/đọc lịch sử
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

## Tài khoản đăng nhập

Không có đăng ký tự do. Tài khoản lưu trong MongoDB, tạo bằng script:

```bash
# Tạo tài khoản cho người khác vào test
python tools/seed_user.py --username canbo1 --password 'MatKhau123' --name 'Nguyễn Văn A'

# Tài khoản quản trị
python tools/seed_user.py --username sep --password 'MatKhau456' --name 'Quản trị' --role admin

python tools/seed_user.py --list             # xem danh sách
python tools/seed_user.py --delete canbo1    # xóa
```

Chạy lại với cùng `--username` là **đổi mật khẩu**. Tên đăng nhập không phân biệt hoa thường.
Mật khẩu băm PBKDF2-SHA256, không bao giờ lưu dạng thường.

Ngoài ra luôn có **một tài khoản dự phòng từ biến môi trường** (`APP_DEFAULT_USERNAME` /
`APP_DEFAULT_PASSWORD`, mặc định `admin` / `admin123`) để đăng nhập được cả khi CSDL còn trống hoặc
chưa bật Mongo. Deploy thật thì phải đổi mật khẩu này.

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

### Hai nguồn bóc tách

Chọn bằng `APP_EXTRACT_PROVIDER`; giao diện và các endpoint `/api/batch/*` giữ nguyên ở cả hai nguồn.

| Nguồn | Giá trị | Cách hoạt động |
|-------|---------|----------------|
| API theo lô của Auto Fill HCC | `batch` | Proxy thẳng sang `/api/v1/batch/*`, phía kia tự xếp hàng |
| BE nội bộ Auto Fill HCC | `internal` | Backend này tự xếp hàng trong bộ nhớ, gọi `/api/v1/process` cho **từng hồ sơ** |

BE nội bộ chỉ có endpoint xử lý một hồ sơ (`POST /api/v1/process`, đăng nhập qua `POST /auth/login`),
không có API theo lô — nên [`local_jobs.py`](backend/app/local_jobs.py) dựng lại đúng bề mặt của API lô:
tạo phiên, tải hồ sơ, chạy song song `APP_INTERNAL_CONCURRENCY` hồ sơ, theo dõi tiến độ, chạy lại hồ sơ lỗi.

Trạng thái phiên được **suy ra từ trạng thái các hồ sơ**, không phụ thuộc task nền chạy tới cùng —
tắt máy chủ giữa chừng thì phiên không kẹt mãi ở `running`.

Hạn chế có chủ ý: phiên nằm trong bộ nhớ tiến trình, khởi động lại backend là mất. Đủ cho thử nghiệm;
muốn giữ lâu phải thay bằng CSDL.

### Định dạng file nhận vào

Nguồn bóc tách chỉ nhận JPG, PNG, PDF, DOCX. [`files.py`](backend/app/files.py) chuyển đổi trước
để người dùng khỏi phải tự lo:

| Đuôi | Xử lý |
|------|-------|
| `.jpg` `.jpeg` `.png` `.pdf` `.docx` | gửi thẳng |
| `.webp` `.bmp` `.gif` `.tif` `.tiff` | chuyển sang JPEG (Pillow, ảnh có nền trong được dán lên nền trắng) |
| `.doc` `.rtf` `.odt` | chuyển sang PDF bằng LibreOffice — **cần cài `soffice`** |

Chưa cài LibreOffice thì `.doc` báo lỗi kèm hướng dẫn thay vì im lặng hỏng. Trên máy cá nhân: cài
LibreOffice (hoặc mở file rồi lưu thành `.docx`). Trong Docker: thêm vào `Dockerfile`
`RUN apt-get update && apt-get install -y libreoffice-writer` (image tăng khoảng 400MB).

Giao diện tự lấy danh sách đuôi từ `/api/batch/status`, không chép cứng ở hai nơi.

### Chạy thử không cần hệ thống thật

```bash
python tools/mock-internal-be.py      # giả lập BE nội bộ, cổng 8080
python tools/mock-batch-api.py        # giả lập API theo lô, cổng 9000
```

Cả hai trả về đúng 32 field UI của pipeline `trich_luc`
([fixture](tools/fixtures/trich-luc-ks.fields.json)), và `mock-internal-be.py` từ chối file sai định dạng
giống BE thật nên kiểm tra được cả phần chuyển đổi.

### Cấu hình

Toàn bộ cấu hình nằm trong file `.env`, không cần truyền biến trên dòng lệnh:

- `backend/.env` — khi chạy `uvicorn` từ thư mục `backend/`
- `.env` ở thư mục gốc — khi chạy `docker compose`

Cả hai file đã có trong `.gitignore` nên không bị đẩy lên git. Mẫu để copy: `backend/.env.example`
và `.env.example`.

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `APP_EXTRACT_PROVIDER` | `batch` | `batch` hoặc `internal` |
| `APP_BATCH_API_BASE_URL` | `https://trolyhoso-hcc-admin.vnekyc.vn` | địa chỉ API bóc tách theo lô |
| `APP_BATCH_API_SECRET` | *(rỗng)* | secret do đội Auto Fill HCC cấp |
| `APP_INTERNAL_API_BASE_URL` | `http://127.0.0.1:8080` | địa chỉ BE nội bộ |
| `APP_INTERNAL_USERNAME` / `APP_INTERNAL_PASSWORD` | *(rỗng)* | tài khoản đăng nhập BE nội bộ |
| `APP_INTERNAL_CONCURRENCY` | `2` | số hồ sơ chạy song song khi dùng BE nội bộ |
| `APP_SOFFICE_PATH` | *(rỗng)* | đường dẫn LibreOffice, để trống thì tự dò |

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

## Gán nhãn kết quả đúng (worklist theo thủ tục)

Mỗi thủ tục có **worklist gán nhãn riêng** tại `/thu-tuc/{key}/nhan`:

- **Thanh tiến trình**: số hồ sơ đã hoàn thiện / tổng, kèm bộ lọc theo trạng thái.
- **Ba trạng thái** mỗi hồ sơ: `Chưa gán` (mới bóc tách) → `Đang sửa` (nháp) → `Hoàn thiện`.
- **Sửa tại chỗ**: bấm *Sửa* mở ngay trình sửa trường dưới dòng đó, không phải mở từng hồ sơ.
  *Lưu nháp* giữ trạng thái đang sửa; *Lưu & hoàn thiện* đánh dấu xong.
- Bấm *Form + JSON* để mở màn hình xem form đã điền + JSON bóc tách (cũng sửa/lưu được ở đó).

Danh sách thủ tục hiện badge tiến trình **"đã hoàn thiện / tổng nhãn"** trên mỗi thủ tục.

Nhãn lưu ở collection `labels` (khóa `itemId`), có thêm `status` (`draft`/`done`), người gán, thời điểm.
Trình sửa trường dùng chung [`components/FieldsEditor.tsx`](frontend/src/components/FieldsEditor.tsx)
cho cả worklist lẫn màn hình xem chi tiết.

**Không lưu file tài liệu gốc** — chỉ lưu JSON bóc tách và nhãn.

| Method | Đường dẫn | Mô tả |
|--------|-----------|-------|
| GET | `/api/history/stats` | mỗi thủ tục: số kết quả, số nhãn, số hoàn thiện |
| GET | `/api/history/labels?procedure=` | worklist: mọi hồ sơ + trạng thái nhãn + counts |
| GET | `/api/history/items/{itemId}/result` | JSON bóc tách đã lưu |
| GET | `/api/history/items/{itemId}/label` | nhãn đã lưu |
| PUT | `/api/history/items/{itemId}/label` | lưu nhãn kèm `status` (`draft`/`done`) |

## Dữ liệu tỉnh/thành & phường/xã

eForm dùng đủ **34 tỉnh/thành + 3.321 phường/xã** (sắp xếp hành chính 2025), nạp từ
[`frontend/public/eform/dia-ban.json`](frontend/public/eform/dia-ban.json). File này **sinh từ dữ liệu
chuẩn của backend** (`app/locations/data/vn_provinces_wards.json`), không gõ tay:

```bash
python tools/gen-diaban.py
```

Dropdown Tỉnh/Xã trong eForm tải danh sách này lúc mở (mô phỏng AJAX như cổng thật). Tên dùng dạng
đầy đủ ("Thành phố Hà Nội", "Phường Cam Đường") nên engine điền khớp được cả khi pipeline trả tên
rút gọn (luật khớp *chứa*) lẫn tên đầy đủ (khớp *chính xác*).

> Lưu ý: dữ liệu chuẩn có **34** đơn vị (28 tỉnh + 6 thành phố) theo sắp xếp 2025, không phải 36.

## Cơ sở dữ liệu (MongoDB)

Mọi phiên quét và **JSON bóc tách** được lưu lại để tra cứu, đối chiếu về sau. Xem tại `/lich-su`.

### Các collection

| Collection | Nội dung | Khóa |
|------------|----------|------|
| `users` | tài khoản đăng nhập của ứng dụng (mật khẩu băm PBKDF2) | `username` (unique) |
| `jobs` | phiên quét: tên, thủ tục, nguồn bóc tách, trạng thái, số lượng | `jobId` (unique) |
| `items` | từng hồ sơ: mã hồ sơ, mô tả file, trạng thái, lỗi | `itemId` (unique) |
| `results` | **JSON bóc tách của từng hồ sơ** | `itemId` (unique) |

`results` chỉ lưu mô tả file (tên, kiểu, dung lượng), **không lưu nội dung file** — tránh phình CSDL.
Giá trị `x-select-area` là object lồng nhau vẫn lưu nguyên vẹn.

### Cấu hình

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `APP_MONGO_URI` | *(rỗng)* | để trống = **không lưu**, ứng dụng vẫn chạy bình thường |
| `APP_MONGO_DB` | `auto_test_hcc` | tên database |
| `APP_MONGO_TIMEOUT_MS` | `5000` | thời gian chờ kết nối |

Không kết nối được Mongo thì backend ghi cảnh báo rồi chạy tiếp, không sập — mất lịch sử chứ không
mất khả năng quét. Mọi hàm ghi lịch sử đều nuốt lỗi vì lỗi lưu trữ không được làm hỏng phiên đang chạy.

### Chạy Mongo

```bash
# Máy cá nhân
docker run -d --name hcc-test-mongo --restart unless-stopped     -p 27018:27017 -v hcc-test-mongo-data:/data/db mongo:7
# rồi đặt APP_MONGO_URI=mongodb://127.0.0.1:27018 trong backend/.env

# Docker Compose: đã có sẵn dịch vụ mongo, không cần làm gì thêm
docker compose up -d --build

# Render: không có Mongo dựng sẵn, dùng chuỗi kết nối ngoài (MongoDB Atlas)
# và nhập APP_MONGO_URI trong dashboard
```

### Điểm đáng chú ý

Xóa phiên bằng `DELETE /api/batch/jobs/{jobId}` chỉ xóa khỏi bộ nhớ/nguồn bóc tách — **lịch sử vẫn còn**.
Muốn xóa hẳn bản lưu thì dùng `DELETE /api/history/jobs/{jobId}` (nút *Xóa* trong trang Lịch sử).

`GET /api/batch/items/{itemId}/result` tự lấy bản đã lưu trong CSDL khi nguồn bóc tách không còn giữ
(trả thêm `fromHistory: true`), nên mở lại eForm của phiên cũ vẫn điền được.

| Method | Đường dẫn | Mô tả |
|--------|-----------|-------|
| GET | `/api/history/status` | đã bật Mongo chưa |
| GET | `/api/history/jobs?limit=&skip=&procedure=` | danh sách phiên đã lưu |
| GET | `/api/history/jobs/{jobId}` | phiên + các hồ sơ trong đó |
| GET | `/api/history/items/{itemId}/result` | JSON bóc tách đã lưu |
| DELETE | `/api/history/jobs/{jobId}` | xóa hẳn bản lưu |

## eForm của thủ tục

Biểu mẫu điện tử dựng sẵn nằm ở `frontend/public/eform/`, xem tại `/thu-tuc/{key}/eform`.

| Thủ tục | File |
|---------|------|
| `trich-luc-ks` — Cấp bản sao Trích lục hộ tịch, Giấy khai sinh | `frontend/public/eform/trich-luc-ks.html` |

File này là bản clone biểu mẫu eForm legacy của `tokhaidientu.moj.gov.vn`, lấy nguyên từ
`auto-fill-hcc-extension/docs/mock-eform-trich-luc.html` nên giữ đúng hợp đồng DOM mà engine điền
đang dựa vào (`x-input`, `x-date`, `x-radio`, `x-select`, `x-select-area`…).

Thêm eForm cho thủ tục khác: bỏ file HTML vào `frontend/public/eform/` rồi khai thêm một dòng
trong [`src/eform/registry.ts`](frontend/src/eform/registry.ts). Thủ tục chưa có eForm thì nút
trong giao diện tự ẩn.

Mở từ một hồ sơ đã bóc tách xong (nút **Mở eForm**) thì cột phải hiện các trường đã bóc tách của
hồ sơ đó, đặt cạnh biểu mẫu để đối chiếu.

### Tự động điền

Nút **Điền vào eForm** dùng lại đúng engine của extension, không viết lại:

| File | Nguồn |
|------|-------|
| `frontend/public/eform/engine/fill-legacy.js` | copy nguyên từ `auto-fill-hcc-extension/content/fill-legacy.js` |
| `frontend/public/eform/engine/helpers.js` | **sinh tự động**, trích 22 helper từ `content.js` + `fill-angular.js` |

Engine lấy phụ thuộc qua namespace `window.__HCC__`, nên chỉ cần nạp đủ 16 thứ nó cần
(`setNativeValue`, `waitFor`, `norm`, `markFilled`, `fieldCandidates`, `FIELD_NAME_ALIASES`,
`resolveAltNameGroups`…) là chạy được nguyên bản. Script trích tự dò phụ thuộc bắc cầu:

```bash
python tools/extract-eform-helpers.py frontend/public/eform/engine/helpers.js     "đường/dẫn/tới/auto-fill-hcc-extension"
```

Chạy lại script này (và copy lại `fill-legacy.js`) mỗi khi extension đổi engine — **đừng sửa tay
`helpers.js`**.

[`src/eform/runFill.ts`](frontend/src/eform/runFill.ts) nạp hai file trên vào iframe (cùng origin
nên gọi được `contentWindow`) rồi gọi `__HCC__.fillForm(fields)`. `fields` truyền thẳng từ kết quả
bóc tách — cấu trúc `{name, comp, value, default, aliases}` của pipeline khớp sẵn với engine,
không cần lớp chuyển đổi.

Mở eForm từ một hồ sơ đã bóc tách xong (`/thu-tuc/{key}/eform?item={itemId}`) thì **app tự điền ngay**,
không phải bấm nút; nút *Điền lại* dùng khi muốn chạy lại.

Lưu ý về kiểu dữ liệu: field `x-select-area` có `value` là **object** `{quocGia, tinh, xa, diaChi}`,
không phải chuỗi. Mọi chỗ hiển thị phải đi qua
[`displayFieldValue`](frontend/src/api/fieldValue.ts) — render thẳng object ra JSX sẽ làm React ném lỗi
và trắng cả trang.

### Hai chỗ eForm phải sửa cho khớp pipeline

Bản mock gốc lệch với cổng thật ở hai chỗ, đã sửa trong `frontend/public/eform/trich-luc-ks.html`
(có ghi chú ngay tại chỗ sửa):

| Field | Mock gốc | Đã đổi thành | Căn cứ |
|-------|----------|--------------|--------|
| `HoSo_LoaiYeuCau` | "Bản sao Giấy khai sinh"… | 3 chuỗi dài | `mapper.py` phát đúng 3 chuỗi này |
| `PhuongThucNhanKQ` | `TrucTuyen/TrucTiep/BuuChinh` | `1` Trực tiếp · `2` Bưu chính · `3` Trực tuyến | `mapper.py` phát `"2"` |

Thứ tự số của `PhuongThucNhanKQ` lấy theo cổng thật, nên `"2"` là **nhận qua bưu chính**.

## Host cho mọi người qua ngrok (không cần secret batch)

Hệ thống bóc tách (BE + OCR + LLM) chạy ở máy bạn, OCR/LLM là dịch vụ đám mây công khai.
Cách này mở nguyên app ra Internet để người khác vào, **máy bạn phải bật**.

### Bật link (kể cả sau khi khởi động lại máy)

Bấm phải [`start-hosting.ps1`](start-hosting.ps1) → **Run with PowerShell**. Script sẽ:
kiểm tra Docker (BE 12005, Mongo), build lại giao diện, bật backend (8000), mở ngrok và **in ra
URL công khai** (đồng thời copy vào clipboard). Giữ cửa sổ đó mở thì link còn sống.

> Lần đầu chạy script bị chặn thì mở PowerShell gõ một lần:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### Điều phải chấp nhận ở ngrok free

- **URL đổi mỗi lần chạy lại** — gửi lại link mới cho mọi người sau mỗi lần khởi động.
- Lần đầu mỗi người vào thấy trang cảnh báo ngrok → bấm **Visit Site**.
- Máy bạn tắt / đóng cửa sổ ngrok = link chết.

Muốn URL cố định và máy không phải bật: xem hai hướng còn lại (VPS hoặc Cloudflare Tunnel) —
hỏi lại tôi khi cần.

### Đổi mật khẩu trước khi gửi link (QUAN TRỌNG)

Link công khai nên **đừng để `admin123`**. Tài khoản lưu trong MongoDB, quản lý bằng:

```bash
python tools/seed_user.py --username sep --password 'MatKhauManh@2026' --name 'Quản trị' --role admin
python tools/seed_user.py --list
python tools/seed_user.py --delete <username>
```

Riêng tài khoản `admin` đến từ biến môi trường (luôn dùng được để dự phòng): đổi mật khẩu bằng cách
sửa `APP_DEFAULT_PASSWORD` trong `backend/.env` rồi khởi động lại backend.

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

Muốn khai một lượt tất cả biến: mở [`.env.example`](.env.example), điền giá trị, rồi vào
service → **Environment** → **Add from .env** và dán cả file. Nếu trình nhập không chịu dòng chú
thích thì lọc bớt:

```bash
grep -v '^#' .env.example | grep -v '^$'
```

**Bước 3.** Bấm **Apply**. Lần build đầu mất khoảng 5–10 phút (build cả Vite lẫn Python).
Xong sẽ có địa chỉ dạng `https://auto-test-hcc.onrender.com` — đăng nhập bằng `admin` và **mật khẩu
đã nhập ở bước 2**, không phải `admin123` của máy cá nhân.

> **Đăng nhập trên bản deploy bị 401?** Mỗi nơi chạy có một mật khẩu admin riêng: máy cá nhân lấy từ
> `backend/.env`, Docker Compose lấy từ `.env` gốc, Render lấy từ biến `APP_DEFAULT_PASSWORD` trong
> dashboard. Vào Render → service → **Environment** để xem hoặc đặt lại (Save changes là tự deploy lại).

**Kiểm tra nhanh một bản đã deploy** — không cần đăng nhập:

```bash
curl https://<ten-service>.onrender.com/api/health
```

```json
{"status":"ok","database":true,
 "extraction":{"provider":"batch","configured":true},
 "defaultAccountEnabled":true}
```

`database: false` = chưa đặt `APP_MONGO_URI` (không có lịch sử, không lưu được tài khoản).
`extraction.configured: false` = chưa có secret/tài khoản cho nguồn bóc tách.
Log của service ghi rõ lý do mỗi lần đăng nhập hỏng (sai mật khẩu hay không có tài khoản), không kèm mật khẩu.

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

- Lưu lại bản điền và chấm điểm độ khớp so với JSON bóc tách
- Thêm eForm cho các thủ tục còn lại
- Điền lên cổng dịch vụ công thật (cần trình duyệt headless, xem lưu ý ở phần Hosting)
- Lưu lịch sử phiên chạy thử nghiệm
