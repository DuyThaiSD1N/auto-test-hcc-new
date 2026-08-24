# ---------- Giai doan 1: build giao dien Vite ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Giai doan 2: runtime FastAPI ----------
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

# LibreOffice de chuyen DOC/RTF/ODT sang PDF truoc khi boc tach (app/files.py goi `soffice`).
# Khong co no thi ba duoi file do bao loi; JPG/PNG/PDF/DOCX van chay binh thuong.
# Chiem them ~400MB image - bo khoi nay neu chac chan chi nhan PDF/anh.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=web /web/dist ./frontend_dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# FastAPI phuc vu luon giao dien -> chi can mo 1 cong, khong can cau hinh CORS
ENV APP_FRONTEND_DIST=/srv/frontend_dist

# Tao user thuong, khong chay bang root
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /srv
USER appuser

EXPOSE 8000
CMD ["/usr/local/bin/docker-entrypoint.sh"]
