"""Kho tai lieu dung chung: tai khoan chuyen upload bo ho so vao, nguoi chay test lay ra dung.

Khac voi ket qua boc tach (chi luu JSON), kho nay PHAI giu noi dung file that thi lan quet
sau moi gui duoc len nguon boc tach. File nam trong GridFS (bucket `pool_files`), ban ghi
mo ta nam o collection `pool_items`.

Mot muc trong kho khong bi "dung mot lan la het": day la he thong thu nghiem, chay lai cung
mot ho so nhieu lan la chuyen binh thuong - nen chi dem so lan da dung.
"""

import logging
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from .db import get_db

logger = logging.getLogger("uvicorn.error")

BUCKET = "pool_files"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _clean(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k != "_id"}
    # fileId la ObjectId cua GridFS - doi sang chuoi de tra ve JSON duoc
    out["files"] = [
        {**f, "fileId": str(f.get("fileId"))} for f in (doc.get("files") or [])
    ]
    return out


def enabled() -> bool:
    return get_db() is not None


async def create_item(
    *,
    procedure: str,
    client_dossier_id: str,
    note: str | None,
    files: list[tuple[str, bytes, str]],
    uploaded_by: str,
) -> dict:
    """Cat mot ho so vao kho. `files` = [(ten, noi dung, kieu MIME)] da qua buoc chuyen doi."""
    db = get_db()
    if db is None:
        raise RuntimeError("Chua bat MongoDB nen khong luu duoc kho tai lieu.")

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET)
    pool_id = f"pool_{uuid.uuid4().hex[:16]}"

    saved: list[dict] = []
    for name, content, content_type in files:
        file_id = await bucket.upload_from_stream(
            name, content, metadata={"poolId": pool_id, "contentType": content_type}
        )
        saved.append({"name": name, "type": content_type, "bytes": len(content), "fileId": file_id})

    doc = {
        "poolId": pool_id,
        "procedure": procedure,
        "clientDossierId": client_dossier_id,
        "note": (note or "").strip() or None,
        "files": saved,
        "fileCount": len(saved),
        "totalBytes": sum(f["bytes"] for f in saved),
        "uploadedBy": uploaded_by,
        "uploadedAt": _now(),
        "useCount": 0,
        "lastUsedAt": None,
        "lastJobId": None,
    }
    await db.pool_items.insert_one(doc)
    return _clean(doc)


async def list_items(procedure: str | None = None, limit: int = 300) -> dict:
    db = get_db()
    if db is None:
        return {"enabled": False, "total": 0, "items": []}
    query = {"procedure": procedure} if procedure else {}
    total = await db.pool_items.count_documents(query)
    cursor = db.pool_items.find(query).sort("uploadedAt", -1).limit(limit)
    return {"enabled": True, "total": total, "items": [_clean(d) async for d in cursor]}


async def get_item(pool_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    doc = await db.pool_items.find_one({"poolId": pool_id})
    return doc  # tra doc goc: con can fileId dang ObjectId de doc file


async def read_files(pool_id: str) -> list[tuple[str, bytes, str]]:
    """Doc lai noi dung file cua mot ho so trong kho."""
    db = get_db()
    doc = await get_item(pool_id)
    if db is None or doc is None:
        return []
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET)
    out: list[tuple[str, bytes, str]] = []
    for f in doc.get("files") or []:
        stream = await bucket.open_download_stream(ObjectId(str(f["fileId"])))
        content = await stream.read()
        out.append((f["name"], content, f.get("type") or "application/octet-stream"))
    return out


async def mark_used(pool_id: str, job_id: str | None, item_id: str | None) -> None:
    db = get_db()
    if db is None:
        return
    await db.pool_items.update_one(
        {"poolId": pool_id},
        {
            "$set": {"lastUsedAt": _now(), "lastJobId": job_id, "lastItemId": item_id},
            "$inc": {"useCount": 1},
        },
    )


async def delete_item(pool_id: str) -> dict:
    """Xoa ban ghi va ca file trong GridFS - khong de file mo coi chiem cho."""
    db = get_db()
    if db is None:
        return {"deleted": False, "reason": "Chua bat MongoDB."}
    doc = await get_item(pool_id)
    if doc is None:
        return {"deleted": False}

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET)
    for f in doc.get("files") or []:
        try:
            await bucket.delete(ObjectId(str(f["fileId"])))
        except Exception:  # noqa: BLE001 - file da mat thi van xoa tiep ban ghi
            logger.warning("Khong xoa duoc file %s cua kho %s", f.get("name"), pool_id)
    await db.pool_items.delete_one({"poolId": pool_id})
    return {"deleted": True}
