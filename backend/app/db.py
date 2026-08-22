"""Ket noi MongoDB de luu lich su phien quet va JSON ket qua boc tach.

Khong bat buoc: de trong APP_MONGO_URI thi ung dung van chay, chi khong co lich su.
Nho vay may chua kip dung Mongo van thu nghiem duoc.
"""

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import get_settings

logger = logging.getLogger("uvicorn.error")

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_db() -> AsyncIOMotorDatabase | None:
    """Tra ve database, hoac None neu chua bat Mongo."""
    return _db



async def connect() -> None:
    """Goi luc khoi dong ung dung. Khong ket noi duoc thi ghi canh bao roi chay tiep."""
    global _client, _db
    settings = get_settings()
    if not settings.mongo_enabled:
        logger.info("Chua dat APP_MONGO_URI - khong luu lich su phien quet.")
        return

    _client = AsyncIOMotorClient(
        settings.mongo_uri, serverSelectionTimeoutMS=settings.mongo_timeout_ms
    )
    try:
        await _client.admin.command("ping")
    except Exception as exc:  # noqa: BLE001 - loi mang/dang nhap deu khong duoc lam chet app
        logger.warning("Khong ket noi duoc MongoDB (%s) - se chay khong co lich su.", exc)
        _client = None
        _db = None
        return

    _db = _client[settings.mongo_db]
    await _ensure_indexes(_db)
    logger.info("Da ket noi MongoDB, database '%s'.", settings.mongo_db)


async def disconnect() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    # jobId/itemId la khoa tra cuu chinh; createdAt de sap xep lich su
    await db.users.create_index("username", unique=True)
    await db.jobs.create_index("jobId", unique=True)
    await db.jobs.create_index([("createdAt", -1)])
    await db.jobs.create_index("procedure")
    await db.items.create_index("itemId", unique=True)
    await db.items.create_index("jobId")
    await db.results.create_index("itemId", unique=True)
    await db.results.create_index("jobId")
    await db.results.create_index([("savedAt", -1)])
    # Nhan da sua tay (ground truth)
    await db.labels.create_index("itemId", unique=True)
    await db.labels.create_index("jobId")
    await db.labels.create_index("procedure")
