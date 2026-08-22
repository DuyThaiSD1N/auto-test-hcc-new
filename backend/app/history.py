"""Luu va tra cuu lich su phien quet trong MongoDB.

Ba collection:
    jobs     - mot phien quet (ten, thu tuc, nguon boc tach, trang thai, so luong)
    items    - tung ho so trong phien (ma ho so, danh sach file, trang thai, loi)
    results  - JSON boc tach cua tung ho so (chinh la thu can luu lai de doi chieu)

Moi ham deu tu bo qua khi chua bat Mongo, nen phan goi khong can kiem tra truoc.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from .db import get_db

logger = logging.getLogger("uvicorn.error")


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _clean(doc: dict) -> dict:
    """Bo _id cua Mongo cho JSON tra ve goi gang."""
    return {k: v for k, v in doc.items() if k != "_id"}


# ------------------------------------------------------------------- ghi

async def save_job(job: dict, provider: str) -> None:
    db = get_db()
    if db is None:
        return
    try:
        await db.jobs.update_one(
            {"jobId": job["jobId"]},
            {
                "$set": {
                    "name": job.get("name"),
                    "procedure": job.get("procedure"),
                    "provider": provider,
                    "status": job.get("status"),
                    "counts": job.get("counts") or {},
                    "createdAt": job.get("createdAt"),
                    "startedAt": job.get("startedAt"),
                    "finishedAt": job.get("finishedAt"),
                    "updatedAt": _now(),
                },
                "$setOnInsert": {"jobId": job["jobId"], "savedAt": _now()},
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001 - loi luu lich su khong duoc lam hong phien quet
        logger.exception("Khong luu duoc phien quet %s", job.get("jobId"))


async def save_item(item: dict, files: list[dict] | None = None) -> None:
    db = get_db()
    if db is None:
        return
    payload: dict[str, Any] = {
        "jobId": item.get("jobId"),
        "procedure": item.get("procedure"),
        "clientDossierId": item.get("clientDossierId"),
        "status": item.get("status"),
        "error": item.get("error"),
        "hasErrors": item.get("hasErrors", False),
        "attempts": item.get("attempts", 0),
        "fileCount": item.get("fileCount"),
        "totalBytes": item.get("totalBytes"),
        "createdAt": item.get("createdAt"),
        "startedAt": item.get("startedAt"),
        "finishedAt": item.get("finishedAt"),
        "updatedAt": _now(),
    }
    if files is not None:
        # Chi luu MO TA file, khong luu noi dung - tranh phinh CSDL
        payload["files"] = [
            {"name": f.get("name"), "type": f.get("type"), "bytes": len(f.get("content") or b"")}
            for f in files
        ]
    try:
        await db.items.update_one(
            {"itemId": item["itemId"]},
            {"$set": payload, "$setOnInsert": {"itemId": item["itemId"], "savedAt": _now()}},
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Khong luu duoc ho so %s", item.get("itemId"))


async def save_result(
    item_id: str,
    job_id: str | None,
    procedure: str | None,
    client_dossier_id: str | None,
    result: dict | None,
) -> None:
    """Luu JSON boc tach. Goi lai nhieu lan cung khong tao ban ghi trung."""
    db = get_db()
    if db is None or not result:
        return
    fields = result.get("fields") or []
    try:
        await db.results.update_one(
            {"itemId": item_id},
            {
                "$set": {
                    "jobId": job_id,
                    "procedure": procedure,
                    "clientDossierId": client_dossier_id,
                    "fieldCount": len(fields),
                    "result": result,
                    "savedAt": _now(),
                },
                "$setOnInsert": {"itemId": item_id},
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Khong luu duoc ket qua cua ho so %s", item_id)


async def save_results_page(job_id: str | None, results: list[dict], procedure: str | None) -> None:
    """Luu ca trang ket qua lay tu nguon boc tach."""
    for entry in results:
        item_id = entry.get("itemId")
        if not item_id:
            continue
        await save_result(
            item_id,
            job_id,
            procedure,
            entry.get("clientDossierId"),
            entry.get("result"),
        )


# ------------------------------------------------------------------ doc

async def list_jobs(limit: int = 50, skip: int = 0, procedure: str | None = None) -> dict:
    db = get_db()
    if db is None:
        return {"total": 0, "items": [], "enabled": False}
    query = {"procedure": procedure} if procedure else {}
    total = await db.jobs.count_documents(query)
    cursor = db.jobs.find(query).sort("savedAt", -1).skip(skip).limit(limit)
    jobs = [_clean(doc) async for doc in cursor]
    return {"total": total, "items": jobs, "enabled": True}


async def get_job(job_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    job = await db.jobs.find_one({"jobId": job_id})
    if job is None:
        return None
    items = [_clean(doc) async for doc in db.items.find({"jobId": job_id}).sort("createdAt", 1)]
    done = {doc["itemId"] async for doc in db.results.find({"jobId": job_id}, {"itemId": 1})}
    for item in items:
        item["hasResult"] = item["itemId"] in done
    return {**_clean(job), "items": items}


async def get_result(item_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    doc = await db.results.find_one({"itemId": item_id})
    return _clean(doc) if doc else None


async def delete_job(job_id: str) -> dict:
    db = get_db()
    if db is None:
        return {"deleted": False}
    await db.results.delete_many({"jobId": job_id})
    await db.items.delete_many({"jobId": job_id})
    res = await db.jobs.delete_one({"jobId": job_id})
    return {"deleted": res.deleted_count > 0}


# ------------------------------------------------------ nhan da sua tay

async def save_label(
    item_id: str,
    job_id: str | None,
    procedure: str | None,
    client_dossier_id: str | None,
    fields: list[dict],
    labeled_by: str | None,
) -> dict:
    """Luu nhan ket qua dung (do nguoi dung sua). Ghi de nhan cu cua cung ho so."""
    db = get_db()
    if db is None:
        return {"saved": False, "reason": "Chua bat MongoDB nen khong luu duoc nhan."}
    await db.labels.update_one(
        {"itemId": item_id},
        {
            "$set": {
                "jobId": job_id,
                "procedure": procedure,
                "clientDossierId": client_dossier_id,
                "fields": fields,
                "fieldCount": len(fields),
                "labeledBy": labeled_by,
                "labeledAt": _now(),
            },
            "$setOnInsert": {"itemId": item_id, "createdAt": _now()},
        },
        upsert=True,
    )
    return {"saved": True}


async def get_label(item_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    doc = await db.labels.find_one({"itemId": item_id})
    return _clean(doc) if doc else None


async def label_stats() -> dict:
    """Dem so nhan da gan va so ket qua boc tach theo tung thu tuc."""
    db = get_db()
    if db is None:
        return {"enabled": False, "byProcedure": {}}
    out: dict[str, dict] = {}
    async for row in db.labels.aggregate([{"$group": {"_id": "$procedure", "n": {"$sum": 1}}}]):
        out.setdefault(row["_id"] or "", {})["labels"] = row["n"]
    async for row in db.results.aggregate([{"$group": {"_id": "$procedure", "n": {"$sum": 1}}}]):
        out.setdefault(row["_id"] or "", {})["results"] = row["n"]
    # Chuan hoa: thu tuc nao chi co mot trong hai van co du hai so
    for v in out.values():
        v.setdefault("labels", 0)
        v.setdefault("results", 0)
    return {"enabled": True, "byProcedure": out}


async def list_labels(procedure: str, limit: int = 200) -> dict:
    """Danh sach ho so da gan nhan cua mot thu tuc, moi ban cho biet co ket qua boc tach khong."""
    db = get_db()
    if db is None:
        return {"enabled": False, "total": 0, "items": []}
    cursor = db.labels.find({"procedure": procedure}).sort("labeledAt", -1).limit(limit)
    labels = [_clean(doc) async for doc in cursor]
    has_result = {r["itemId"] async for r in db.results.find({"procedure": procedure}, {"itemId": 1})}
    items = [
        {
            "itemId": lb["itemId"],
            "clientDossierId": lb.get("clientDossierId"),
            "fieldCount": lb.get("fieldCount", 0),
            "labeledBy": lb.get("labeledBy"),
            "labeledAt": lb.get("labeledAt"),
            "hasResult": lb["itemId"] in has_result,
        }
        for lb in labels
    ]
    return {"enabled": True, "total": len(items), "items": items}
