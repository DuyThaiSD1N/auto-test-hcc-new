"""Chay phien quet ngay trong backend nay, dung BE noi bo lam nguon boc tach.

BE noi bo chi co endpoint xu ly TUNG ho so (`/api/v1/process`), khong co API theo lo.
Lop nay dung mot hang doi trong bo nho de mo phong dung be mat cua API batch, nho vay
giao dien va cac endpoint /api/batch/* giu nguyen du dung nguon nao.

Han che co y: job nam trong bo nho tien trinh - khoi dong lai backend la mat.
Du cho giai doan thu nghiem; muon giu lau thi phai thay bang CSDL.
"""

import asyncio
import hashlib
import logging
import uuid
from datetime import datetime, timezone

from . import history
from .batch_client import BatchApiError
from .config import get_settings
from .internal_client import InternalClient

logger = logging.getLogger("uvicorn.error")

TERMINAL = {"done", "failed", "cancelled"}


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class LocalJobEngine:
    """Hang doi ho so trong bo nho, xu ly bang InternalClient."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = InternalClient()  # nem BatchApiError neu chua cau hinh tai khoan
        self._jobs: dict[str, dict] = {}
        self._items: dict[str, dict] = {}
        self._concurrency = max(1, settings.internal_concurrency)
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------- tien ich

    def _job(self, job_id: str) -> dict:
        job = self._jobs.get(job_id)
        if job is None:
            raise BatchApiError(404, "BATCH_JOB_NOT_FOUND", "Khong tim thay phien quet.")
        return job

    def _item(self, item_id: str) -> dict:
        item = self._items.get(item_id)
        if item is None:
            raise BatchApiError(404, "BATCH_ITEM_NOT_FOUND", "Khong tim thay ho so.")
        return item

    @staticmethod
    def _public_item(item: dict) -> dict:
        return {k: v for k, v in item.items() if not k.startswith("_")}

    def _job_view(self, job: dict) -> dict:
        items = [self._items[i] for i in job["items"]]
        counts: dict[str, int] = {"total": len(items)}
        for status in ("staged", "queued", "running", "paused", "done", "failed", "cancelled"):
            n = sum(1 for i in items if i["status"] == status)
            if n:
                counts[status] = n

        # Trang thai SUY RA tu cac ho so, khong phu thuoc task nen chay den cung.
        # Neu task bi huy giua chung (vd tat may chu) thi phien van khong ket o "running".
        if job["status"] == "running" and items and all(i["status"] in TERMINAL for i in items):
            job["status"] = "completed"
            job["finishedAt"] = job["finishedAt"] or _now()

        view = {k: v for k, v in job.items() if k != "items"}
        view["counts"] = counts
        return view

    # ---------------------------------------------------------- phien quet

    async def create_job(self, name: str, procedure: str) -> dict:
        job_id = f"job_{uuid.uuid4().hex[:16]}"
        self._jobs[job_id] = {
            "jobId": job_id,
            "name": name,
            "procedure": procedure,
            "status": "draft",
            "createdAt": _now(),
            "startedAt": None,
            "finishedAt": None,
            "items": [],
        }
        view = self._job_view(self._jobs[job_id])
        await history.save_job(view, "internal")
        return view

    async def get_job(self, job_id: str) -> dict:
        return self._job_view(self._job(job_id))

    async def start_job(self, job_id: str) -> dict:
        job = self._job(job_id)
        if job["status"] != "draft" or not job["items"]:
            raise BatchApiError(
                409, "BATCH_CANNOT_START", "Phien quet chua co ho so hoac da bat dau roi."
            )
        job["status"] = "running"
        job["startedAt"] = _now()
        for item_id in job["items"]:
            self._items[item_id]["status"] = "queued"

        task = asyncio.create_task(self._run_job(job_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        view = self._job_view(job)
        await history.save_job(view, "internal")
        return view

    async def job_action(self, job_id: str, action: str) -> dict:
        job = self._job(job_id)
        if action == "pause" and job["status"] == "running":
            job["status"] = "paused"
        elif action == "resume" and job["status"] == "paused":
            job["status"] = "running"
        elif action == "cancel":
            job["status"] = "cancelled"
            job["finishedAt"] = _now()
            for item_id in job["items"]:
                item = self._items[item_id]
                if item["status"] not in TERMINAL:
                    item["status"] = "cancelled"
                    item["_files"] = None
        view = self._job_view(job)
        await history.save_job(view, "internal")
        return view

    async def delete_job(self, job_id: str) -> dict:
        job = self._job(job_id)
        self._job_view(job)  # cap nhat trang thai suy ra truoc khi kiem tra
        if job["status"] not in {"completed", "cancelled"}:
            raise BatchApiError(
                409, "BATCH_JOB_NOT_DONE", "Chi xoa duoc phien da hoan tat hoac da huy."
            )
        for item_id in job["items"]:
            self._items.pop(item_id, None)
        self._jobs.pop(job_id, None)
        return {"deleted": True}

    async def list_items(
        self, job_id: str, status: str | None = None, page: int = 1, page_size: int = 100
    ) -> dict:
        job = self._job(job_id)
        items = [self._public_item(self._items[i]) for i in job["items"]]
        if status:
            items = [i for i in items if i["status"] == status]
        start = (page - 1) * page_size
        return {
            "items": items[start : start + page_size],
            "page": page,
            "pageSize": page_size,
            "total": len(items),
        }

    async def list_results(self, job_id: str, page: int = 1, page_size: int = 100) -> dict:
        job = self._job(job_id)
        done = [self._items[i] for i in job["items"] if i in self._items and self._items[i]["status"] == "done"]
        start = (page - 1) * page_size
        return {
            "results": [self._result_view(i) for i in done[start : start + page_size]],
            "page": page,
            "pageSize": page_size,
            "total": len(done),
        }

    # ------------------------------------------------------------------ ho so

    async def upload_item(
        self,
        job_id: str,
        metadata: dict,
        files: list[tuple[str, bytes, str]],
        idempotency_key: str | None = None,
    ) -> dict:
        job = self._job(job_id)
        if job["status"] != "draft":
            raise BatchApiError(
                409, "BATCH_JOB_NOT_DRAFT", "Phien quet da bat dau, khong the tai them ho so."
            )

        descriptors = metadata.get("files") or []
        if len(descriptors) != len(files):
            raise BatchApiError(
                400, "BAD_BATCH_FILE_METADATA", "So mo ta file khong khop so file da gui."
            )

        client_dossier_id = str(metadata.get("clientDossierId") or "").strip()
        digest = hashlib.sha256(b"".join(content for _, content, _ in files)).hexdigest()

        # Chong gui trung giong API that: theo ma ho so, Idempotency-Key hoac noi dung file
        for existing_id in job["items"]:
            existing = self._items[existing_id]
            if (
                existing["clientDossierId"] == client_dossier_id
                or (idempotency_key and existing["_idempotencyKey"] == idempotency_key)
                or existing["_hash"] == digest
            ):
                return {**self._public_item(existing), "duplicate": True}

        item_id = f"item_{uuid.uuid4().hex[:16]}"
        self._items[item_id] = {
            "itemId": item_id,
            "jobId": job_id,
            "clientDossierId": client_dossier_id,
            "procedure": job["procedure"],
            "status": "staged",
            "attempts": 0,
            "fileCount": len(files),
            "totalBytes": sum(len(content) for _, content, _ in files),
            "hasErrors": False,
            "error": None,
            "createdAt": _now(),
            "startedAt": None,
            "finishedAt": None,
            "duplicate": False,
            "_hash": digest,
            "_idempotencyKey": idempotency_key,
            "_options": metadata.get("options") or {},
            "_files": [
                {
                    "name": name,
                    "type": content_type,
                    "content": content,
                    "role": desc.get("role") or "doc",
                    "hasHandwriting": bool(desc.get("hasHandwriting")),
                }
                for (name, content, content_type), desc in zip(files, descriptors)
            ],
            "_result": None,
        }
        job["items"].append(item_id)
        item = self._items[item_id]
        await history.save_item(self._public_item(item), item["_files"])
        return self._public_item(item)

    def _result_view(self, item: dict) -> dict:
        return {
            "itemId": item["itemId"],
            "clientDossierId": item["clientDossierId"],
            "status": item["status"],
            "result": item["_result"],
        }

    async def item_result(self, item_id: str) -> dict:
        return self._result_view(self._item(item_id))

    async def retry_item(self, item_id: str) -> dict:
        item = self._item(item_id)
        if item["status"] != "failed":
            raise BatchApiError(409, "ITEM_NOT_FAILED", "Chi chay lai duoc ho so dang loi.")
        if not item["_files"]:
            raise BatchApiError(
                409, "ITEM_FILES_GONE", "File cua ho so khong con trong bo nho, hay tai lai."
            )
        item["status"] = "queued"
        item["error"] = None
        item["hasErrors"] = False

        job = self._job(item["jobId"])
        job["status"] = "running"
        job["finishedAt"] = None
        task = asyncio.create_task(self._run_job(item["jobId"]))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return self._public_item(item)

    # ------------------------------------------------------------- xu ly nen

    async def _run_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if job is None:
            return

        semaphore = asyncio.Semaphore(self._concurrency)

        async def handle(item_id: str) -> None:
            async with semaphore:
                await self._process_item(job_id, item_id)

        pending = [i for i in job["items"] if self._items[i]["status"] == "queued"]
        await asyncio.gather(*(handle(i) for i in pending), return_exceptions=True)

        # Chot lai trang thai ngay khi chay xong; neu task bi huy thi _job_view van suy ra dung
        if job.get("status") not in ("cancelled", "paused"):
            await history.save_job(self._job_view(job), "internal")

    async def _process_item(self, job_id: str, item_id: str) -> None:
        job = self._jobs.get(job_id)
        item = self._items.get(item_id)
        if job is None or item is None:
            return

        # Tam dung: cho den khi chay tiep hoac bi huy
        while job.get("status") == "paused":
            item["status"] = "paused"
            await asyncio.sleep(0.5)
        if job.get("status") == "cancelled" or item["status"] == "cancelled":
            return

        item["status"] = "running"
        item["startedAt"] = _now()
        item["attempts"] += 1
        try:
            result = await self._client.process(
                item["procedure"], item["_files"] or [], item["_options"]
            )
            item["_result"] = {
                **result,
                "itemId": item_id,
            }
            item["hasErrors"] = bool(result.get("errors"))
            item["status"] = "done"
            item["_files"] = None  # tra lai bo nho, ho so da xong
        except BatchApiError as exc:
            item["status"] = "failed"
            item["error"] = exc.message
            item["hasErrors"] = True
        except Exception as exc:  # noqa: BLE001 - khong de mot ho so lam chet ca phien
            logger.exception("Loi khi boc tach ho so %s", item_id)
            item["status"] = "failed"
            item["error"] = f"Loi khong xac dinh: {exc}"
            item["hasErrors"] = True
        finally:
            item["finishedAt"] = _now()
            # Ghi lich su ngay khi ho so xong, khong doi giao dien hoi ket qua
            await history.save_item(self._public_item(item))
            if item["_result"]:
                await history.save_result(
                    item_id,
                    item["jobId"],
                    item["procedure"],
                    item["clientDossierId"],
                    item["_result"],
                )
            await history.save_job(self._job_view(job), "internal")
