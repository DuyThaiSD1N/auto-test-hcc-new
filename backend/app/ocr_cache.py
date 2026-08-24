"""Van ban OCR cua ho so chay qua API theo lo (batch) cua Auto Fill HCC.

API /api/v1/batch khong tra van ban OCR va cung KHONG ghi trace, nen /api/v1/traces
(duong lay OCR khi chay BE noi bo) khong co gi de doc. Nhung worker batch OCR qua cung
dich vu voi /api/v1/process va cat ket qua vao collection `ocr_cache` trong Mongo cua BE,
khoa "<phien ban>:<sha256 noi dung file>", TTL 12 gio.

API batch tra ve sha256 tung file trong GET /items/{id}/result (va trang /results),
nen o day tra cache theo hash do. Vi cache chi song 12 gio, lay duoc la LUU NGAY vao
Mongo cua app (collection `ocr_texts`) - mo lai ho so sau nay khong con phu thuoc cache.

Cau hinh: APP_OCR_CACHE_MONGO_URI (Mongo cua BE), APP_OCR_CACHE_DB (mac dinh autofill_hcc).
Best-effort: moi loi deu tra ve {available: False, reason} chu khong nem ra ngoai.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

from .config import get_settings
from .db import get_db

logger = logging.getLogger("uvicorn.error")

_client: AsyncIOMotorClient | None = None


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (value or None)


def _cache_client() -> AsyncIOMotorClient | None:
    """Ket noi (lazy) toi Mongo cua BE. None neu chua cau hinh."""
    global _client
    settings = get_settings()
    if not settings.ocr_cache_configured:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.ocr_cache_mongo_uri, serverSelectionTimeoutMS=settings.mongo_timeout_ms
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        _client.close()
    _client = None


def _key(sha256: str) -> str:
    return f"{get_settings().ocr_cache_key_version}:{sha256}"


def _public(doc: dict, source: str) -> dict:
    return {
        "available": True,
        "itemId": doc.get("itemId"),
        "ocrText": doc.get("ocrText") or "",
        "provider": doc.get("provider"),
        "chars": len(doc.get("ocrText") or ""),
        "createdAt": _iso(doc.get("ocrCreatedAt")),
        "files": doc.get("files") or [],
        "missing": doc.get("missing") or [],
        "source": source,
    }


async def get_saved(item_id: str) -> dict | None:
    """OCR da luu trong Mongo cua app (khong phu thuoc cache cua BE)."""
    db = get_db()
    if db is None:
        return None
    doc = await db.ocr_texts.find_one({"itemId": item_id})
    return _public(doc, "saved") if doc else None


async def _lookup(hashes: list[str]) -> dict[str, dict]:
    """{sha256: {text, provider, created_at}} cho cac hash CO trong ocr_cache cua BE."""
    client = _cache_client()
    if client is None or not hashes:
        return {}
    settings = get_settings()
    keys = {_key(h): h for h in hashes}
    found: dict[str, dict] = {}
    cursor = client[settings.ocr_cache_db].ocr_cache.find(
        {"_id": {"$in": list(keys)}}, {"text": 1, "provider": 1, "created_at": 1}
    )
    async for doc in cursor:
        found[keys[doc["_id"]]] = doc
    return found


def _compose(files: list[dict], found: dict[str, dict]) -> tuple[str, list[dict], list[str]]:
    """Ghep OCR tung file theo dung thu tu file trong ho so."""
    parts: list[str] = []
    meta: list[dict] = []
    missing: list[str] = []
    for f in files:
        name = f.get("name") or "khong-ten"
        sha = str(f.get("sha256") or "")
        hit = found.get(sha)
        text = (hit or {}).get("text") or ""
        if text.strip():
            parts.append(f"───── {name} ─────\n{text.strip()}")
            meta.append({"name": name, "sha256": sha, "chars": len(text), "provider": hit.get("provider")})
        else:
            parts.append(f"───── {name} ─────\n(không còn văn bản OCR của file này trong cache)")
            meta.append({"name": name, "sha256": sha, "chars": 0, "provider": None})
            missing.append(name)
    return "\n\n".join(parts), meta, missing


async def fetch_for_item(item_id: str, files: list[dict] | None) -> dict:
    """Tra ve dict dang ItemOcr cua giao dien. `files` = danh sach file kem sha256 tu API batch."""
    saved = await get_saved(item_id)
    if saved is not None:
        return saved

    settings = get_settings()
    if not settings.ocr_cache_configured:
        return {
            "available": False,
            "reason": (
                "Nguon boc tach dang la API theo lo - API do khong tra ve van ban OCR. "
                "Muon xem OCR, cau hinh APP_OCR_CACHE_MONGO_URI tro toi Mongo cua Auto Fill HCC "
                "(collection ocr_cache) roi khoi dong lai."
            ),
        }

    hashes = [str(f.get("sha256")) for f in (files or []) if f.get("sha256")]
    if not hashes:
        return {
            "available": False,
            "reason": "Nguon boc tach khong tra ve ma bam (sha256) cua file nen khong tra duoc OCR.",
        }

    try:
        found = await _lookup(hashes)
    except Exception as exc:  # noqa: BLE001 - Mongo cua BE tro chung khong duoc lam hong trang
        logger.warning("Khong doc duoc ocr_cache cua BE: %s", exc)
        return {"available": False, "reason": "Khong ket noi duoc toi ocr_cache cua Auto Fill HCC."}

    if not found:
        return {
            "available": False,
            "reason": (
                "Auto Fill HCC khong con giu van ban OCR cua ho so nay (cache OCR chi song 12 gio "
                "sau khi quet). Chay lai ho so thi se lay duoc."
            ),
        }

    text, meta, missing = _compose(files or [], found)
    provider = next((d.get("provider") for d in found.values() if d.get("provider")), None)
    created = min((d["created_at"] for d in found.values() if d.get("created_at")), default=None)
    doc = {
        "itemId": item_id,
        "ocrText": text,
        "provider": provider,
        "files": meta,
        "missing": missing,
        "ocrCreatedAt": created,
        "savedAt": _now(),
    }

    db = get_db()
    if db is not None:
        try:
            await db.ocr_texts.update_one({"itemId": item_id}, {"$set": doc}, upsert=True)
        except Exception:  # noqa: BLE001
            logger.exception("Khong luu duoc OCR cua ho so %s", item_id)

    return _public(doc, "ocr_cache")


async def capture_many(entries: list[tuple[str, list[dict] | None]]) -> None:
    """Chay nen sau khi lay trang ket qua: cat OCR truoc khi cache cua BE het han."""
    if not get_settings().ocr_cache_configured or get_db() is None:
        return
    for item_id, files in entries:
        try:
            await fetch_for_item(item_id, files)
        except Exception:  # noqa: BLE001
            logger.exception("Loi cat OCR cua ho so %s", item_id)
