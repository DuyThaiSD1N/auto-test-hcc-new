"""Proxy toi API boc tach ho so theo lo.

Trinh duyet goi cac endpoint /api/batch/* (xac thuc bang JWT dang nhap);
server dinh kem secret rieng roi goi sang Auto Fill HCC.
"""

import json
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile

from ..batch_client import BatchApiError, BatchClient
from ..config import get_settings
from ..deps import get_current_user
from ..schemas import CreateJobRequest, UserOut
from ..store import get_procedure

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/batch", tags=["batch"])

# Theo tai lieu API: chi ho tro JPG, PNG, PDF, DOCX
ALLOWED_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


def get_client() -> BatchClient:
    """Tao client; neu chua cau hinh secret thi tra loi 503 co huong dan."""
    try:
        return BatchClient()
    except BatchApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


Client = Annotated[BatchClient, Depends(get_client)]


def _handle(exc: BatchApiError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/status")
async def batch_status(_: CurrentUser) -> dict:
    """Cho giao dien biet may chu da cau hinh secret goi API boc tach hay chua."""
    settings = get_settings()
    return {
        "configured": settings.batch_api_configured,
        "baseUrl": settings.batch_api_base_url,
    }


# ---------------------------------------------------------------- phien quet


@router.post("/jobs", status_code=201)
async def create_job(payload: CreateJobRequest, client: Client, _: CurrentUser) -> dict:
    # Chan som ma thu tuc khong co trong danh muc, khoi ton mot vong goi API
    if get_procedure(payload.procedure) is None:
        raise HTTPException(status_code=400, detail="Ma thu tuc khong co trong danh muc.")
    try:
        return await client.create_job(payload.name, payload.procedure)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, client: Client, _: CurrentUser) -> dict:
    try:
        return await client.get_job(job_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.post("/jobs/{job_id}/start")
async def start_job(job_id: str, client: Client, _: CurrentUser) -> dict:
    try:
        return await client.start_job(job_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, client: Client, _: CurrentUser) -> dict:
    try:
        return await client.delete_job(job_id) or {"deleted": True}
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.get("/jobs/{job_id}/items")
async def list_items(
    job_id: str,
    client: Client,
    _: CurrentUser,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200, alias="pageSize"),
) -> dict:
    try:
        return await client.list_items(job_id, status, page, page_size)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.get("/jobs/{job_id}/results")
async def list_results(
    job_id: str,
    client: Client,
    _: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200, alias="pageSize"),
) -> dict:
    try:
        return await client.list_results(job_id, page, page_size)
    except BatchApiError as exc:
        raise _handle(exc) from exc


# -------------------------------------------------------------------- ho so


@router.post("/jobs/{job_id}/items", status_code=202)
async def upload_item(
    job_id: str,
    client: Client,
    _: CurrentUser,
    files: list[UploadFile] = File(...),
    client_dossier_id: str = Form(..., alias="clientDossierId"),
    has_handwriting: bool = Form(default=False, alias="hasHandwriting"),
    role: str = Form(default="doc"),
    options: str = Form(default="{}"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Ho so phai co it nhat mot file.")

    settings = get_settings()

    try:
        parsed_options = json.loads(options or "{}")
        if not isinstance(parsed_options, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="Truong options phai la JSON dang object.") from None

    payload: list[tuple[str, bytes, str]] = []
    descriptors: list[dict] = []
    total = 0

    for upload in files:
        name = Path(upload.filename or "khong-ten").name
        suffix = Path(name).suffix.lower()
        if suffix not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"File '{name}' khong duoc ho tro. Chi nhan JPG, PNG, PDF, DOCX.",
            )

        content = await upload.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"File '{name}' rong.")
        if len(content) > settings.max_file_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File '{name}' vuot qua {settings.max_file_bytes // 1024 // 1024}MB.",
            )

        total += len(content)
        if total > settings.max_item_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Tong dung luong ho so vuot qua {settings.max_item_bytes // 1024 // 1024}MB.",
            )

        # Tin phan mo rong hon Content-Type do trinh duyet gui, tranh octet-stream
        content_type = ALLOWED_TYPES[suffix]
        payload.append((name, content, content_type))
        descriptors.append(
            {
                "name": name,
                "type": content_type,
                "role": role,
                "hasHandwriting": has_handwriting,
            }
        )

    metadata = {
        "clientDossierId": client_dossier_id,
        "options": parsed_options,
        # Thu tu descriptor phai trung thu tu multipart file - tai lieu API yeu cau
        "files": descriptors,
    }

    try:
        return await client.upload_item(job_id, metadata, payload, idempotency_key)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.get("/items/{item_id}/result")
async def item_result(item_id: str, client: Client, _: CurrentUser) -> dict:
    try:
        return await client.item_result(item_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.post("/items/{item_id}/retry")
async def retry_item(item_id: str, client: Client, _: CurrentUser) -> dict:
    try:
        return await client.retry_item(item_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


# Dat cuoi file co chu dich: pattern /{action} se khop ca "items" va "start",
# nen phai dang ky sau cac route cu the do.
@router.post("/jobs/{job_id}/{action}")
async def job_action(job_id: str, action: str, client: Client, _: CurrentUser) -> dict:
    if action not in {"pause", "resume", "cancel"}:
        raise HTTPException(status_code=404, detail="Thao tac khong hop le.")
    try:
        return await client.job_action(job_id, action)
    except BatchApiError as exc:
        raise _handle(exc) from exc
