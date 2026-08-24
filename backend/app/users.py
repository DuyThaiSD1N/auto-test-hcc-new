"""Tai khoan dang nhap cua chinh ung dung nay.

Hai nguon, theo thu tu:
1. MongoDB (collection `users`) - tai khoan tao bang `python tools/seed_user.py`.
2. Tai khoan mac dinh trong bien moi truong APP_DEFAULT_* - de bootstrap khi CSDL con trong
   hoac chua bat Mongo, neu khong se khong ai dang nhap duoc.

Mat khau luon luu duoi dang bam PBKDF2 (app/security.py), khong bao gio luu dang thuong.
"""

import logging
from datetime import datetime, timezone

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


# ------------------------------------------------- quan ly tai khoan (admin)

ROLES = ("admin", "tester")


def _row(doc: dict) -> dict:
    return {
        "username": doc["username"],
        "fullName": doc.get("full_name") or doc["username"],
        "role": doc.get("role") or "tester",
        "createdAt": doc.get("created_at"),
        "updatedAt": doc.get("updated_at"),
        "source": "mongo",
    }


async def list_users() -> dict:
    """Danh sach tai khoan trong CSDL, kem tai khoan du phong tu bien moi truong.

    Tai khoan env luon dang nhap duoc nen phai hien ra, nhung khong sua/xoa duoc
    o day - doi no phai sua bien moi truong roi khoi dong lai backend.
    """
    db = get_db()
    rows: list[dict] = []
    if db is not None:
        try:
            async for doc in db.users.find({}).sort("username", 1):
                rows.append(_row(doc))
        except Exception:  # noqa: BLE001
            logger.exception("Khong doc duoc danh sach tai khoan")

    env = _env_user()
    if not any(r["username"] == env["username"] for r in rows):
        rows.append(
            {
                "username": env["username"],
                "fullName": env["full_name"],
                "role": env["role"],
                "createdAt": None,
                "updatedAt": None,
                "source": "env",
            }
        )
    return {"enabled": db is not None, "items": rows}


async def save_user(
    username: str, password: str | None, full_name: str | None, role: str
) -> dict:
    """Tao moi hoac cap nhat mot tai khoan. Khong truyen password = giu mat khau cu."""
    db = get_db()
    if db is None:
        return {"saved": False, "reason": "Chua bat MongoDB nen khong luu duoc tai khoan."}

    name = (username or "").strip().lower()
    if not name:
        return {"saved": False, "reason": "Thieu ten dang nhap."}
    if role not in ROLES:
        return {"saved": False, "reason": "Quyen khong hop le."}

    existing = await db.users.find_one({"username": name})
    if existing is None and not password:
        return {"saved": False, "reason": "Tai khoan moi phai co mat khau."}
    if password is not None and len(password) < 6:
        return {"saved": False, "reason": "Mat khau phai dai it nhat 6 ky tu."}

    now = datetime.now(tz=timezone.utc)
    changes: dict = {"role": role, "updated_at": now}
    if full_name is not None:
        changes["full_name"] = full_name.strip() or name
    if password:
        changes["password_hash"] = hash_password(password)

    await db.users.update_one(
        {"username": name},
        {"$set": changes, "$setOnInsert": {"username": name, "created_at": now}},
        upsert=True,
    )
    return {"saved": True, "created": existing is None, "username": name}


async def delete_user(username: str) -> dict:
    db = get_db()
    if db is None:
        return {"deleted": False, "reason": "Chua bat MongoDB."}
    result = await db.users.delete_one({"username": (username or "").strip().lower()})
    return {"deleted": result.deleted_count > 0}
