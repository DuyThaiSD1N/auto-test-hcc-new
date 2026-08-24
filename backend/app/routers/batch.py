"""Proxy toi API boc tach ho so theo lo.

Trinh duyet goi cac endpoint /api/batch/* (xac thuc bang JWT dang nhap);
server dinh kem secret rieng roi goi sang Auto Fill HCC.
"""

import json
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Body, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import history, pool
from ..batch_client import BatchApiError
from ..extraction import ExtractionBackend, get_backend
from ..config import get_settings
from ..deps import get_current_user, require_scanner
from ..files import ACCEPTED_SUFFIXES, UnsupportedFile, prepare_file
from ..internal_client import InternalTraceClient
from ..schemas import CreateJobRequest, UserOut
from ..store import get_procedure

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/batch", tags=["batch"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
# Moi endpoint chay quet dung ScanUser; tai khoan "uploader" bi chan o day chu khong
# chi an nut tren giao dien
ScanUser = Annotated[UserOut, Depends(require_scanner)]


def get_client() -> ExtractionBackend:
    """Lay nguon boc tach dang cau hinh; chua cau hinh thi tra 503 kem huong dan."""
    try:
        return get_backend()
    except BatchApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


Client = Annotated[ExtractionBackend, Depends(get_client)]


# Ma loi cua nguon boc tach ma KHONG duoc phep tra ve nguyen cho trinh duyet
_UPSTREAM_AUTH = {401, 403}


def _handle(exc: BatchApiError) -> HTTPException:
    """Doi ma loi cua nguon boc tach thanh ma phu hop de tra ve trinh duyet.

    Quan trong: nguon boc tach tu choi secret (401/403) KHONG phai la phien dang nhap
    cua nguoi dung het han. Neu tra ve 401 thi giao dien tuong nguoi dung het phien va
    da ho ve trang dang nhap - dung luc dang quet ho so. Doi thanh 502 (loi phia sau).
    """
    status = 502 if exc.status_code in _UPSTREAM_AUTH else exc.status_code
    detail = exc.message
    if exc.status_code in _UPSTREAM_AUTH:
        detail = f"{exc.message} Kiem tra lai cau hinh nguon boc tach tren may chu."
    return HTTPException(status_code=status, detail=detail)


@router.get("/status")
async def batch_status(_: ScanUser) -> dict:
    """Cho giao dien biet may chu da cau hinh secret goi API boc tach hay chua."""
    settings = get_settings()
    return {
        "configured": settings.extraction_configured,
        "provider": "internal" if settings.use_internal_backend else "batch",
        "baseUrl": settings.extraction_base_url,
        "acceptedSuffixes": sorted(ACCEPTED_SUFFIXES),
    }


# ---------------------------------------------------------------- phien quet


@router.post("/jobs", status_code=201)
async def create_job(payload: CreateJobRequest, client: Client, _: ScanUser) -> dict:
    # Chan som ma thu tuc khong co trong danh muc, khoi ton mot vong goi API
    if get_procedure(payload.procedure) is None:
        raise HTTPException(status_code=400, detail="Ma thu tuc khong co trong danh muc.")
    try:
        job = await client.create_job(payload.name, payload.procedure)
    except BatchApiError as exc:
        raise _handle(exc) from exc

    # Ma test khong gui sang nguon boc tach, chi luu o day de tra lai lich su
    await history.set_job_test_code(job["jobId"], payload.test_code)
    return {**job, "testCode": payload.test_code}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, client: Client, _: ScanUser) -> dict:
    try:
        return await client.get_job(job_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.post("/jobs/{job_id}/start")
async def start_job(job_id: str, client: Client, _: ScanUser) -> dict:
    try:
        return await client.start_job(job_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, client: Client, _: ScanUser) -> dict:
    try:
        return await client.delete_job(job_id) or {"deleted": True}
    except BatchApiError as exc:
        raise _handle(exc) from exc


@router.get("/jobs/{job_id}/items")
async def list_items(
    job_id: str,
    client: Client,
    _: ScanUser,
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
    _: ScanUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200, alias="pageSize"),
) -> dict:
    try:
        data = await client.list_results(job_id, page, page_size)
    except BatchApiError as exc:
        raise _handle(exc) from exc

    # Nguon "batch" xu ly o may khac nen luu lai ngay khi lay duoc ket qua.
    # Nguon "internal" da tu luu luc xu ly xong; save_result la upsert nen goi lai vo hai.
    results = data.get("results") or data.get("items") or []
    if isinstance(results, list):
        await history.save_results_page(job_id, results, None)
    return data


# -------------------------------------------------------------------- ho so


@router.post("/jobs/{job_id}/items", status_code=202)
async def upload_item(
    job_id: str,
    client: Client,
    _: ScanUser,
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
        raw_name = Path(upload.filename or "khong-ten").name
        raw = await upload.read()
        if len(raw) == 0:
            raise HTTPException(status_code=400, detail=f"File '{raw_name}' rong.")
        if len(raw) > settings.max_file_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File '{raw_name}' vuot qua {settings.max_file_bytes // 1024 // 1024}MB.",
            )

        # Chuyen doi neu can (WEBP/BMP/GIF/TIFF -> JPEG, DOC/RTF/ODT -> PDF).
        # Chay trong thread rieng vi Pillow/LibreOffice deu chan luong.
        try:
            name, content, content_type = await run_in_threadpool(prepare_file, raw_name, raw)
        except UnsupportedFile as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        total += len(content)
        if total > settings.max_item_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Tong dung luong ho so vuot qua {settings.max_item_bytes // 1024 // 1024}MB.",
            )

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
        created = await client.upload_item(job_id, metadata, payload, idempotency_key)
    except BatchApiError as exc:
        raise _handle(exc) from exc

    # Khong luu noi dung file goc (PDF/Word/anh) theo yeu cau - chi giu JSON boc tach + nhan.
    return created


@router.get("/items/{item_id}/result")
async def item_result(item_id: str, client: Client, _: ScanUser) -> dict:
    try:
        data = await client.item_result(item_id)
    except BatchApiError as exc:
        # Phien da xong tu lau, nguon boc tach khong con giu -> lay ban da luu trong CSDL
        saved = await history.get_result(item_id)
        if saved is not None:
            return {
                "itemId": item_id,
                "clientDossierId": saved.get("clientDossierId"),
                "status": "done",
                "result": saved.get("result"),
                "fromHistory": True,
            }
        raise _handle(exc) from exc

    await history.save_result(
        item_id, data.get("jobId"), data.get("procedure"), data.get("clientDossierId"), data.get("result")
    )
    return data


@router.post("/jobs/{job_id}/items/from-pool", status_code=202)
async def upload_item_from_pool(
    job_id: str,
    client: Client,
    _: ScanUser,
    payload: dict = Body(...),
) -> dict:
    """Nap mot ho so co san trong kho tai lieu vao phien quet.

    File da nam san tren may chu (do tai khoan chuyen upload bo vao) nen trinh duyet
    khong phai tai lai lan nua - chi gui poolId.
    """
    pool_id = str(payload.get("poolId") or "").strip()
    if not pool_id:
        raise HTTPException(status_code=400, detail="Thieu poolId.")

    doc = await pool.get_item(pool_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Khong tim thay ho so trong kho.")

    files = await pool.read_files(pool_id)
    if not files:
        raise HTTPException(status_code=409, detail="Ho so trong kho khong con file.")

    client_dossier_id = str(
        payload.get("clientDossierId") or doc.get("clientDossierId") or pool_id
    ).strip()
    metadata = {
        "clientDossierId": client_dossier_id,
        "options": payload.get("options") or {},
        "files": [
            {
                "name": name,
                "type": content_type,
                "role": "doc",
                "hasHandwriting": bool(payload.get("hasHandwriting")),
            }
            for name, _, content_type in files
        ],
    }

    try:
        created = await client.upload_item(
            job_id, metadata, files, f"{job_id}-{pool_id}"
        )
    except BatchApiError as exc:
        raise _handle(exc) from exc

    await pool.mark_used(pool_id, job_id, created.get("itemId"))
    return {**created, "poolId": pool_id}


@router.get("/items/{item_id}/ocr")
async def item_ocr(item_id: str, client: Client, _: ScanUser) -> dict:
    """Van ban OCR ma nguon boc tach doc duoc tu file cua ho so nay.

    Ket qua cua /api/v1/process khong kem OCR; BE noi bo luu no trong "trace" cua request
    va chi cho tai khoan admin doc. Vi vay o day lay requestId tu ket qua roi hoi trace.
    Luon tra 200 kem ly do neu khong lay duoc - giao dien hien ly do thay vi bao loi do.
    """
    request_id = None
    try:
        data = await client.item_result(item_id)
        result = data.get("result") or {}
        request_id = result.get("requestId") or result.get("sessionId")
    except BatchApiError:
        request_id = None

    if not request_id:
        saved = await history.get_result(item_id)
        result = (saved or {}).get("result") or {}
        request_id = result.get("requestId") or result.get("sessionId")

    # Van ban OCR chi doc duoc qua /api/v1/traces cua BE noi bo. Chay nguon "batch"
    # (API theo lo) thi khong co duong nao lay - noi thang thay vi bao loi mo ho.
    if not get_settings().use_internal_backend:
        return {
            "available": False,
            "reason": (
                "Nguon boc tach dang la API theo lo - API do khong tra ve van ban OCR. "
                "Chi xem duoc OCR khi chay bang BE noi bo (APP_EXTRACT_PROVIDER=internal)."
            ),
        }

    return await InternalTraceClient().fetch_ocr(str(request_id or ""))


@router.post("/items/{item_id}/retry")
async def retry_item(item_id: str, client: Client, _: ScanUser) -> dict:
    try:
        return await client.retry_item(item_id)
    except BatchApiError as exc:
        raise _handle(exc) from exc


# Dat cuoi file co chu dich: pattern /{action} se khop ca "items" va "start",
# nen phai dang ky sau cac route cu the do.
@router.post("/jobs/{job_id}/{action}")
async def job_action(job_id: str, action: str, client: Client, _: ScanUser) -> dict:
    if action not in {"pause", "resume", "cancel"}:
        raise HTTPException(status_code=404, detail="Thao tac khong hop le.")
    try:
        return await client.job_action(job_id, action)
    except BatchApiError as exc:
        raise _handle(exc) from exc
