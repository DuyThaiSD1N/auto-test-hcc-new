"""Luu va tra cuu lich su phien quet trong MongoDB.

Ba collection:
    jobs     - mot phien quet (ten, thu tuc, nguon boc tach, trang thai, so luong)
    items    - tung ho so trong phien (ma ho so, danh sach file, trang thai, loi)
    results  - JSON boc tach cua tung ho so (chinh la thu can luu lai de doi chieu)

Moi ham deu tu bo qua khi chua bat Mongo, nen phan goi khong can kiem tra truoc.
"""

import logging
import re
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


async def set_job_test_code(job_id: str, test_code: str | None) -> None:
    """Ghi ma test cua phien quet.

    Tach rieng khoi save_job vi nguon boc tach khong tra lai ma test trong cac lan
    cap nhat sau; ghi chung se co luc ghi de bang None va mat ma.
    """
    db = get_db()
    if db is None or not test_code:
        return
    try:
        await db.jobs.update_one(
            {"jobId": job_id},
            {"$set": {"testCode": test_code}, "$setOnInsert": {"jobId": job_id, "savedAt": _now()}},
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Khong luu duoc ma test cua phien %s", job_id)


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
    """Luu JSON boc tach. Goi lai nhieu lan cung khong tao ban ghi trung.

    Chi ghi de jobId/procedure/clientDossierId khi lan goi nay BIET gia tri.
    Ly do: mot so nguon tra ket qua khong kem jobId (vd `/api/batch/items/{id}/result`
    cua hang doi noi bo). Ghi de bang None se cat dut lien ket ho so <-> phien quet,
    lam lich su tuong "chua co ket qua" va worklist gan nhan bo sot ho so.
    """
    db = get_db()
    if db is None or not result:
        return
    fields = result.get("fields") or []
    changes: dict[str, Any] = {"fieldCount": len(fields), "result": result, "savedAt": _now()}
    for key, value in (
        ("jobId", job_id),
        ("procedure", procedure),
        ("clientDossierId", client_dossier_id),
    ):
        if value:
            changes[key] = value
    # Khoa da nam trong $set thi khong duoc lap lai o $setOnInsert (Mongo bao loi)
    defaults = {k: None for k in ("jobId", "procedure", "clientDossierId") if k not in changes}
    try:
        await db.results.update_one(
            {"itemId": item_id},
            {"$set": changes, "$setOnInsert": {"itemId": item_id, **defaults}},
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
            entry.get("jobId") or job_id,
            entry.get("procedure") or procedure,
            entry.get("clientDossierId"),
            entry.get("result"),
        )


# ------------------------------------------------------------------ doc

async def list_jobs(
    limit: int = 50, skip: int = 0, procedure: str | None = None, q: str | None = None
) -> dict:
    """Danh sach phien quet. `q` tim theo ma test, ten phien hoac jobId."""
    db = get_db()
    if db is None:
        return {"total": 0, "items": [], "enabled": False}
    query: dict = {"procedure": procedure} if procedure else {}
    if q and q.strip():
        # re.escape de nguoi dung go dau cham/gach cung khong thanh regex
        needle = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"testCode": needle}, {"name": needle}, {"jobId": needle}]
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
    # Tim ket qua theo itemId chu khong theo jobId: ban ghi cu co the thieu jobId
    ids = [item["itemId"] for item in items]
    done = {
        doc["itemId"]: doc.get("fieldCount") or 0
        async for doc in db.results.find({"itemId": {"$in": ids}}, {"itemId": 1, "fieldCount": 1})
    }
    labeled = {
        doc["itemId"]: doc.get("status") or "draft"
        async for doc in db.labels.find({"itemId": {"$in": ids}}, {"itemId": 1, "status": 1})
    }
    for item in items:
        item["hasResult"] = item["itemId"] in done
        item["resultFieldCount"] = done.get(item["itemId"], 0)
        item["labelStatus"] = labeled.get(item["itemId"])
    return {**_clean(job), "items": items}


async def get_result(item_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    doc = await db.results.find_one({"itemId": item_id})
    return _clean(doc) if doc else None


async def delete_job(job_id: str) -> dict:
    """Xoa phien quet va MOI thu thuoc ve no: ho so, ket qua boc tach, nhan da gan.

    Nhan luu theo itemId (khong kem jobId) nen phai lay danh sach ho so truoc roi
    xoa theo do - neu khong, nhan cua phien da xoa se o lai va van bi dem vao
    thong ke "so nhan" cua thu tuc.
    """
    db = get_db()
    if db is None:
        return {"deleted": False}

    item_ids = {doc["itemId"] async for doc in db.items.find({"jobId": job_id}, {"itemId": 1})}
    item_ids |= {doc["itemId"] async for doc in db.results.find({"jobId": job_id}, {"itemId": 1})}

    labels = 0
    if item_ids:
        labels = (await db.labels.delete_many({"itemId": {"$in": list(item_ids)}})).deleted_count
        await db.results.delete_many({"itemId": {"$in": list(item_ids)}})
    await db.results.delete_many({"jobId": job_id})
    await db.items.delete_many({"jobId": job_id})
    res = await db.jobs.delete_one({"jobId": job_id})
    return {
        "deleted": res.deleted_count > 0,
        "removed": {"items": len(item_ids), "labels": labels},
    }


# ------------------------------------------------------ nhan da sua tay

# Loai loi gan cho mot ho so khi luu o trang thai "error"
ISSUE_KINDS = ("dien-sai", "dien-thieu", "ocr-sai", "sai-chu-the", "khong-uu-tien")

LABEL_STATUSES = ("draft", "error", "done")


async def save_label(
    item_id: str,
    job_id: str | None,
    procedure: str | None,
    client_dossier_id: str | None,
    fields: list[dict],
    labeled_by: str | None,
    status: str = "draft",
    note: str | None = None,
    issues: list[str] | None = None,
) -> dict:
    """Luu nhan ket qua dung.

    status:
        draft - dang sua
        error - da xem va thay SAI, kem loai loi (issues) + nhan xet (note)
        done  - da sua xong, hoan thien

    Ho so hoan thien thi KHONG con tag loi: sua xong roi thi cai tag do khong con dung nua,
    de lai chi lam thong ke sai. Nhan xet van giu de biet truoc do vuong gi.
    """
    db = get_db()
    if db is None:
        return {"saved": False, "code": 503, "reason": "Chua bat MongoDB nen khong luu duoc nhan."}

    status = status if status in LABEL_STATUSES else "draft"
    clean_issues = [i for i in (issues or []) if i in ISSUE_KINDS]
    if status == "done":
        clean_issues = []
    if status == "error" and not clean_issues:
        return {"saved": False, "code": 400, "reason": "Luu loi thi phai chon it nhat mot loai loi."}

    await db.labels.update_one(
        {"itemId": item_id},
        {
            "$set": {
                "jobId": job_id,
                "procedure": procedure,
                "clientDossierId": client_dossier_id,
                "fields": fields,
                "fieldCount": len(fields),
                "status": status,
                "issues": clean_issues,
                "note": (note or "").strip() or None,
                "labeledBy": labeled_by,
                "labeledAt": _now(),
            },
            "$setOnInsert": {"itemId": item_id, "createdAt": _now()},
        },
        upsert=True,
    )
    return {"saved": True, "status": status, "issues": clean_issues}


async def delete_result(item_id: str) -> dict:
    """Xoa ket qua boc tach cua mot ho so CHUA gan nhan.

    Ho so da co nhan thi khong xoa thang - phai bo nhan truoc, tranh mat cong da lam.
    """
    db = get_db()
    if db is None:
        return {"deleted": False, "code": 503, "reason": "Chua bat MongoDB."}
    if await db.labels.find_one({"itemId": item_id}, {"_id": 1}):
        return {
            "deleted": False,
            "code": 409,
            "reason": "Ho so nay da gan nhan - xoa nhan truoc roi hay xoa ho so.",
        }
    res = await db.results.delete_one({"itemId": item_id})
    return {"deleted": res.deleted_count > 0}


async def delete_unlabeled_results(procedure: str) -> dict:
    """Xoa MOI ho so chua gan nhan cua mot thu tuc. Tra ve so ban ghi da xoa."""
    db = get_db()
    if db is None:
        return {"deleted": 0, "code": 503, "reason": "Chua bat MongoDB."}
    labeled = {doc["itemId"] async for doc in db.labels.find({}, {"itemId": 1})}
    ids = [
        doc["itemId"]
        async for doc in db.results.find({"procedure": procedure}, {"itemId": 1})
        if doc["itemId"] not in labeled
    ]
    if not ids:
        return {"deleted": 0}
    res = await db.results.delete_many({"itemId": {"$in": ids}})
    return {"deleted": res.deleted_count}


async def delete_label(item_id: str) -> dict:
    """Xoa nhan cua mot ho so. Ket qua boc tach van con, ho so tro lai trang thai "chua gan"."""
    db = get_db()
    if db is None:
        return {"deleted": False, "reason": "Chua bat MongoDB."}
    res = await db.labels.delete_one({"itemId": item_id})
    return {"deleted": res.deleted_count > 0}


async def get_label(item_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    doc = await db.labels.find_one({"itemId": item_id})
    return _clean(doc) if doc else None


async def label_stats() -> dict:
    """Dem so nhan va so ket qua boc tach theo tung thu tuc.

    CHI dem du lieu con trong he thong: mot ho so duoc tinh khi ket qua boc tach cua no
    van con luu. Nhan cua ho so da bi xoa (con sot lai tu truoc khi xoa phien biet cuon
    theo nhan) khong duoc tinh nua - neu khong, thu tuc se hien "0/1 nhan" trong khi
    khong con ho so nao de mo ra xem.
    """
    db = get_db()
    if db is None:
        return {"enabled": False, "byProcedure": {}}

    # itemId -> thu tuc, lay tu ket qua con song
    live: dict[str, str] = {}
    async for row in db.results.find({}, {"itemId": 1, "procedure": 1}):
        live[row["itemId"]] = row.get("procedure") or ""

    out: dict[str, dict] = {}
    for procedure in live.values():
        out.setdefault(procedure, {"labels": 0, "done": 0, "errors": 0, "results": 0})["results"] += 1

    async for row in db.labels.find({}, {"itemId": 1, "procedure": 1, "status": 1}):
        procedure = live.get(row["itemId"])
        if procedure is None:
            continue  # nhan mo coi: ho so da bi xoa khoi he thong
        bucket = out.setdefault(procedure, {"labels": 0, "done": 0, "errors": 0, "results": 0})
        bucket["labels"] += 1
        if row.get("status") == "done":
            bucket["done"] += 1
        elif row.get("status") == "error":
            bucket["errors"] += 1

    return {"enabled": True, "byProcedure": out}


async def list_labels(procedure: str, limit: int = 500) -> dict:
    """Worklist gan nhan cua mot thu tuc: MOI ho so da boc tach + trang thai nhan.

    status moi ho so: "pending" (chua gan), "draft" (dang sua), "done" (hoan thien).
    """
    db = get_db()
    if db is None:
        return {"enabled": False, "total": 0, "counts": {}, "items": []}

    # Nhan cua thu tuc: itemId -> thong tin nhan
    labels: dict[str, dict] = {}
    async for lb in db.labels.find({"procedure": procedure}):
        labels[lb["itemId"]] = lb

    # Ho so da boc tach cua thu tuc - day la nguon duy nhat de dung worklist.
    # Nhan cua ho so khong con ket qua (phien da bi xoa) khong hien va khong dem:
    # giu lai chi lam sai con so tien do.
    rows: list[dict] = []
    async for r in db.results.find({"procedure": procedure}).sort("savedAt", -1):
        iid = r["itemId"]
        rows.append(_worklist_row(iid, r, labels.get(iid)))

    order = {"error": 0, "pending": 1, "draft": 2, "done": 3}
    rows.sort(key=lambda x: (order.get(x["status"], 9), x["clientDossierId"] or ""))
    counts = {
        "total": len(rows),
        "pending": sum(1 for x in rows if x["status"] == "pending"),
        "draft": sum(1 for x in rows if x["status"] == "draft"),
        "error": sum(1 for x in rows if x["status"] == "error"),
        "done": sum(1 for x in rows if x["status"] == "done"),
    }
    return {"enabled": True, "total": len(rows), "counts": counts, "items": rows[:limit]}


def _worklist_row(item_id: str, result: dict | None, label: dict | None) -> dict:
    status = label.get("status", "draft") if label else "pending"
    return {
        "itemId": item_id,
        "clientDossierId": (label or result or {}).get("clientDossierId"),
        "status": status,
        "labeled": label is not None,
        "hasResult": result is not None,
        "resultFieldCount": (result or {}).get("fieldCount", 0),
        "labelFieldCount": (label or {}).get("fieldCount", 0),
        "labeledBy": (label or {}).get("labeledBy"),
        "labeledAt": (label or {}).get("labeledAt"),
        "issues": (label or {}).get("issues") or [],
        "note": (label or {}).get("note"),
    }
