"""Mock cua API boc tach ho so (Auto Fill HCC) - CHi dung de kiem thu trong may.

Cho phep chay ca vong "them file -> boc tach -> dien eForm" ma khong can secret that
va khong ton quota cua dich vu that.

    python tools/mock-batch-api.py            # lang nghe 127.0.0.1:9000

Roi trong backend/.env bo dau # o hai dong mock (APP_BATCH_API_BASE_URL / APP_BATCH_API_SECRET)
va khoi dong lai backend.

Voi thu tuc "trich-luc-ks", mock tra ve DUNG 32 field UI ma pipeline trich_luc phat ra
(tools/fixtures/trich-luc-ks.fields.json), nen ket qua dien giong het hang that.
"""

import asyncio
import hashlib
import json
import pathlib
import sys
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Form, Header, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse

SECRET = "secret-gia-lap"
FIXTURES = pathlib.Path(__file__).parent / "fixtures"
app = FastAPI()
JOBS: dict = {}
ITEMS: dict = {}


def now():
    return datetime.now(tz=timezone.utc).isoformat()


def err(code, error, message):
    return JSONResponse(status_code=code, content={"error": error, "message": message, "code": code})


@app.middleware("http")
async def check_auth(request: Request, call_next):
    if request.headers.get("authorization") != f"Bearer {SECRET}":
        return err(401, "INVALID_BATCH_SECRET", "Sai secret")
    return await call_next(request)


def job_view(j):
    items = [ITEMS[i] for i in j["items"]]
    counts = {"total": len(items)}
    for st in ("staged", "queued", "running", "done", "failed"):
        n = len([i for i in items if i["status"] == st])
        if n:
            counts[st] = n
    return {k: v for k, v in j.items() if k != "items"} | {"counts": counts}


@app.post("/api/v1/batch/jobs", status_code=201)
async def create_job(body: dict):
    if body["procedure"] == "khong-ton-tai":
        return err(400, "UNKNOWN_PROCEDURE", "Ma thu tuc la")
    jid = f"job_{uuid.uuid4().hex[:16]}"
    JOBS[jid] = {
        "jobId": jid, "name": body["name"], "procedure": body["procedure"],
        "status": "draft", "createdAt": now(), "startedAt": None, "finishedAt": None,
        "items": [],
    }
    return job_view(JOBS[jid])


@app.post("/api/v1/batch/jobs/{jid}/items", status_code=202)
async def add_item(
    jid: str,
    metadata: str = Form(...),
    files: list[UploadFile] = File(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if jid not in JOBS:
        return err(404, "BATCH_JOB_NOT_FOUND", "Khong thay job")
    job = JOBS[jid]
    if job["status"] != "draft":
        return err(409, "BATCH_JOB_NOT_DRAFT", "Job da start")

    meta = json.loads(metadata)
    blobs = [await f.read() for f in files]
    if len(meta["files"]) != len(blobs):
        return err(400, "BAD_BATCH_FILE_METADATA", "So mo ta khong khop")

    digest = hashlib.sha256(b"".join(blobs)).hexdigest()
    for iid in job["items"]:
        it = ITEMS[iid]
        if (
            it["clientDossierId"] == meta["clientDossierId"]
            or (idempotency_key and it["_idem"] == idempotency_key)
            or it["_hash"] == digest
        ):
            return it | {"duplicate": True}

    iid = f"item_{uuid.uuid4().hex[:16]}"
    ITEMS[iid] = {
        "itemId": iid, "jobId": jid, "clientDossierId": meta["clientDossierId"],
        "procedure": job["procedure"], "status": "staged", "attempts": 0,
        "fileCount": len(blobs), "totalBytes": sum(len(b) for b in blobs),
        "hasErrors": False, "error": None, "createdAt": now(),
        "startedAt": None, "finishedAt": None, "duplicate": False,
        "_idem": idempotency_key, "_hash": digest,
        "_names": [f["name"] for f in meta["files"]],
    }
    job["items"].append(iid)
    return ITEMS[iid]


async def run_job(jid):
    """Gia lap worker: moi ho so mat 1 giay, ho so cuoi cung coi nhu that bai."""
    job = JOBS[jid]
    for idx, iid in enumerate(job["items"]):
        if job["status"] == "cancelled":
            return
        ITEMS[iid]["status"] = "running"
        await asyncio.sleep(1)
        fail = idx == len(job["items"]) - 1 and len(job["items"]) > 1
        ITEMS[iid]["status"] = "failed" if fail else "done"
        ITEMS[iid]["error"] = "OCR that bai (gia lap)" if fail else None
        ITEMS[iid]["finishedAt"] = now()
    job["status"] = "completed"
    job["finishedAt"] = now()


@app.post("/api/v1/batch/jobs/{jid}/start")
async def start(jid: str):
    if jid not in JOBS:
        return err(404, "BATCH_JOB_NOT_FOUND", "Khong thay job")
    job = JOBS[jid]
    if job["status"] != "draft" or not job["items"]:
        return err(409, "BATCH_CANNOT_START", "Khong the start")
    job["status"] = "running"
    job["startedAt"] = now()
    for iid in job["items"]:
        ITEMS[iid]["status"] = "queued"
    asyncio.create_task(run_job(jid))
    return job_view(job)


@app.get("/api/v1/batch/jobs/{jid}")
async def get_job(jid: str):
    if jid not in JOBS:
        return err(404, "BATCH_JOB_NOT_FOUND", "Khong thay job")
    return job_view(JOBS[jid])


@app.get("/api/v1/batch/jobs/{jid}/items")
async def list_items(jid: str, status: str | None = None, page: int = 1, pageSize: int = 100):
    items = [ITEMS[i] for i in JOBS[jid]["items"]]
    if status:
        items = [i for i in items if i["status"] == status]
    return {"items": items, "page": page, "pageSize": pageSize, "total": len(items)}


def fields_for(procedure: str, dossier_id: str) -> list[dict]:
    """Lay fixture theo thu tuc; khong co fixture thi tra vai field chung chung."""
    fixture = FIXTURES / f"{procedure}.fields.json"
    if fixture.is_file():
        fields = json.loads(fixture.read_text(encoding="utf-8"))
        # Doi ho ten theo tung ho so de nhin ra ngay ket qua nao cua ho so nao
        out = []
        for field in fields:
            field = dict(field)
            if field["name"] == "HoVaTenC":
                field["value"] = f"{field['value']} ({dossier_id})"
            out.append(field)
        return out
    return [
        {"name": "HoTen", "comp": "x-input", "value": f"NGUYEN VAN {dossier_id[-1].upper()}",
         "default": False, "occurrence": None},
    ]


def result_of(it):
    return {
        "itemId": it["itemId"], "clientDossierId": it["clientDossierId"], "status": it["status"],
        "result": {
            "fields": fields_for(it["procedure"], it["clientDossierId"]),
            "extracted": {}, "stats": {"total_latency_ms": 3500}, "errors": [],
            "sessionId": it["itemId"], "requestId": it["itemId"], "pages": None, "businessFlow": None,
        },
    }


@app.get("/api/v1/batch/items/{iid}/result")
async def item_result(iid: str):
    if iid not in ITEMS:
        return err(404, "BATCH_JOB_NOT_FOUND", "Khong thay item")
    return result_of(ITEMS[iid])


@app.get("/api/v1/batch/jobs/{jid}/results")
async def results(jid: str, page: int = 1, pageSize: int = 100):
    done = [ITEMS[i] for i in JOBS[jid]["items"] if ITEMS[i]["status"] == "done"]
    return {"results": [result_of(i) for i in done], "page": page, "pageSize": pageSize, "total": len(done)}


@app.post("/api/v1/batch/items/{iid}/retry")
async def retry(iid: str):
    ITEMS[iid]["status"] = "done"
    ITEMS[iid]["error"] = None
    ITEMS[iid]["attempts"] += 1
    return ITEMS[iid]


@app.post("/api/v1/batch/jobs/{jid}/{action}")
async def action(jid: str, action: str):
    JOBS[jid]["status"] = {"pause": "paused", "resume": "running", "cancel": "cancelled"}[action]
    return job_view(JOBS[jid])


@app.delete("/api/v1/batch/jobs/{jid}")
async def delete_job(jid: str):
    job = JOBS.pop(jid)
    for i in job["items"]:
        ITEMS.pop(i, None)
    return {"deleted": True}


if __name__ == "__main__":
    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
    uvicorn.run(app, host="127.0.0.1", port=port)
