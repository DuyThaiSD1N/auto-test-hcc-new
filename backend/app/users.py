"""Tai khoan dang nhap cua chinh ung dung nay.

Hai nguon, theo thu tu:
1. MongoDB (collection `users`) - tai khoan tao bang `python tools/seed_user.py`.
2. Tai khoan mac dinh trong bien moi truong APP_DEFAULT_* - de bootstrap khi CSDL con trong
   hoac chua bat Mongo, neu khong se khong ai dang nhap duoc.

Mat khau luon luu duoi dang bam PBKDF2 (app/security.py), khong bao gio luu dang thuong.
"""

import logging

from .config import get_settings
from .db import get_db
from .security import hash_password, verify_password

logger = logging.getLogger("uvicorn.error")


def _env_user() -> dict:
    settings = get_settings()
    return {
        "username": settings.default_username.strip().lower(),
        "full_name": settings.default_full_name,
        "role": "admin",
        "password_hash": hash_password(settings.default_password),
        "source": "env",
    }


async def get_user(username: str) -> dict | None:
    """Tim tai khoan theo ten dang nhap (khong phan biet hoa thuong)."""
    name = (username or "").strip().lower()
    if not name:
        return None

    db = get_db()
    if db is not None:
        try:
            doc = await db.users.find_one({"username": name})
        except Exception:  # noqa: BLE001 - Mongo tro chung khong duoc chan dang nhap bang env
            logger.exception("Khong doc duoc tai khoan tu MongoDB")
            doc = None
        if doc:
            return {
                "username": doc["username"],
                "full_name": doc.get("full_name") or doc["username"],
                "role": doc.get("role") or "tester",
                "password_hash": doc.get("password_hash") or "",
                "source": "mongo",
            }

    env_user = _env_user()
    return env_user if env_user["username"] == name else None


async def authenticate(username: str, password: str) -> dict | None:
    user = await get_user(username)
    if user is None:
        # Ghi ro de khi deploy con biet duong lan: khong co tai khoan nay o dau ca
        logger.info(
            "Dang nhap that bai: khong tim thay tai khoan '%s' (Mongo: %s, tai khoan mac dinh: '%s')",
            (username or "").strip().lower(),
            "co" if get_db() is not None else "khong bat",
            get_settings().default_username.strip().lower(),
        )
        return None
    if not verify_password(password, user["password_hash"]):
        logger.info("Dang nhap that bai: sai mat khau cho '%s' (nguon: %s)", user["username"], user["source"])
        return None
    return user
