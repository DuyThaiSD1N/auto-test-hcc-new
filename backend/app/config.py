import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Render mount "Secret File" vao /etc/secrets/<ten-file>. Doc luon file do neu co,
# nho vay cach cau hinh bang file .env dung duoc ca o may ca nhan lan tren Render.
# Nen tang khac mount cho khac thi dat APP_ENV_FILE de tro dung duong dan.
SECRET_ENV_FILE = os.getenv("APP_ENV_FILE", "/etc/secrets/.env")


class Settings(BaseSettings):
    """Cau hinh ung dung, doc tu bien moi truong (prefix APP_) hoac file .env."""

    model_config = SettingsConfigDict(
        # File sau de len truoc file truoc khi trung khoa
        env_file=(".env", SECRET_ENV_FILE),
        env_file_encoding="utf-8",  # tranh loi tieng Viet co dau tren Windows
        env_prefix="APP_",
        extra="ignore",
    )

    app_name: str = "Auto Test Hanh Chinh Cong API"
    secret_key: str = "dev-secret-change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # Cac origin cua Vite dev server
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Thu muc chua ban build cua Vite (frontend/dist). De trong = tu do tim.
    frontend_dist: str = ""

    # ---- MongoDB: luu lich su phien quet va JSON ket qua boc tach ----
    # De trong = khong luu, ung dung van chay binh thuong (chi mat lich su).
    mongo_uri: str = ""
    mongo_db: str = "auto_test_hcc"
    mongo_timeout_ms: int = 5000

    # ---- Nguon boc tach: "batch" (API theo lo cua Auto Fill HCC) hoac "internal" (BE noi bo) ----
    extract_provider: str = "batch"

    # ---- BE noi bo: POST /api/v1/process, dang nhap qua POST /auth/login ----
    internal_api_base_url: str = "http://127.0.0.1:8080"
    internal_username: str = ""
    internal_password: str = ""
    internal_timeout: float = 300.0
    # So ho so xu ly dong thoi khi goi BE noi bo (moi ho so la mot lan goi OCR + LLM)
    internal_concurrency: int = 2

    # ---- API boc tach ho so theo lo (Auto Fill HCC) ----
    batch_api_base_url: str = "https://trolyhoso-hcc-admin.vnekyc.vn"
    batch_api_secret: str = ""
    batch_api_timeout: float = 180.0

    # Duong dan LibreOffice de chuyen DOC/RTF/ODT sang PDF; de trong = tu do tim
    soffice_path: str = ""

    # Gioi han theo tai lieu API: 80MB moi file, 100MB moi ho so
    max_file_bytes: int = 80 * 1024 * 1024
    max_item_bytes: int = 100 * 1024 * 1024

    # Tai khoan seed mac dinh (dung cho giai doan thu nghiem)
    default_username: str = "admin"
    default_password: str = "admin123"
    default_full_name: str = "Quan tri vien"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def frontend_dist_path(self) -> Path | None:
        """Duong dan toi frontend/dist neu ton tai, nguoc lai None (chi chay API)."""
        candidates = (
            [Path(self.frontend_dist)]
            if self.frontend_dist
            else [Path(__file__).resolve().parents[2] / "frontend" / "dist"]
        )
        return next((c for c in candidates if c.is_dir()), None)

    @property
    def mongo_enabled(self) -> bool:
        return bool(self.mongo_uri.strip())

    @property
    def use_internal_backend(self) -> bool:
        return self.extract_provider.strip().lower() == "internal"

    @property
    def internal_configured(self) -> bool:
        return bool(self.internal_username.strip() and self.internal_password.strip())

    @property
    def batch_api_configured(self) -> bool:
        return bool(self.batch_api_secret.strip())

    @property
    def extraction_configured(self) -> bool:
        return self.internal_configured if self.use_internal_backend else self.batch_api_configured

    @property
    def extraction_base_url(self) -> str:
        return self.internal_api_base_url if self.use_internal_backend else self.batch_api_base_url

    @property
    def using_default_secret(self) -> bool:
        return self.secret_key == "dev-secret-change-me"


@lru_cache
def get_settings() -> Settings:
    return Settings()
