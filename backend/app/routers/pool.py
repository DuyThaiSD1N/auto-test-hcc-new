"""Kho tai lieu: tai khoan chuyen upload dua ho so vao, nguoi chay test lay ra dung.

Ai dang nhap cung XEM va DUNG duoc kho; chi tai khoan "uploader" (hoac admin) moi
duoc them va xoa - dung phan cong: mot ben chuan bi ho so, mot ben chay thu nghiem.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import pool
from ..config import get_settings
from ..deps import get_current_user, require_uploader
from ..files import ACCEPTED_SUFFIXES, UnsupportedFile, prepare_file
from ..schemas import UserOut
from ..store import get_procedure

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/pool", tags=["pool"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
Uploader = Annotated[UserOut, Depends(require_uploader)]


@router.get("/status")
async def status(_: CurrentUser) -> dict:
    return {"enabled": pool.enabled(), "acceptedSuffixes": sorted(ACCEPTED_SUFFIXES)}


@router.get("/items")
async def list_items(_: CurrentUser, procedure: str | None = None) -> dict:
    return await pool.list_items(procedure)


@router.post("/items", status_code=201)
async def create_item(
    user: Uploader,
    files: list[UploadFile] = File(...),
    procedure: str = Form(...),
    client_dossier_id: str = Form(..., alias="clientDossierId"),
    note: str | None = Form(default=None),
) -> dict:
    if not pool.enabled():
        raise HTTPException(status_code=503, detail="Chua bat MongoDB nen chua co kho tai lieu.")
    if get_procedure(procedure) is None:
        raise HTTPException(status_code=400, detail="Ma thu tuc khong co trong danh muc.")
    if not files:
        raise HTTPException(status_code=400, detail="Ho so phai co it nhat mot file.")

    settings = get_settings()
    payload: list[tuple[str, bytes, str]] = []
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
        # Chuyen doi ngay luc cat vao kho (WEBP->JPEG, DOC->PDF...) de luc chay khoi lam lai
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

    item = await pool.create_item(
        procedure=procedure,
        client_dossier_id=client_dossier_id.strip() or f"ho-so-{len(payload)}-file",
        note=note,
        files=payload,
        uploaded_by=user.username,
    )
    logger.info(
        "Kho tai lieu: %s them ho so %s (%s, %d file)",
        user.username,
        item["clientDossierId"],
        procedure,
        len(payload),
    )
    return item


@router.delete("/items/{pool_id}")
async def delete_item(pool_id: str, user: Uploader) -> dict:
    doc = await pool.get_item(pool_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Khong tim thay ho so trong kho.")
    # Nguoi upload chi xoa duoc do minh bo vao; admin xoa duoc tat ca
    if user.role != "admin" and doc.get("uploadedBy") != user.username:
        raise HTTPException(status_code=403, detail="Chi xoa duoc ho so do chinh minh tai len.")
    return await pool.delete_item(pool_id)
