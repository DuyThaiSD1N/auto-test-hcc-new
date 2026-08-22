"""Tra cuu lich su phien quet va JSON boc tach da luu trong MongoDB."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import history
from ..config import get_settings
from ..deps import get_current_user
from ..schemas import UserOut

router = APIRouter(prefix="/api/history", tags=["history"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.get("/status")
async def status(_: CurrentUser) -> dict:
    settings = get_settings()
    from ..db import get_db

    return {
        "enabled": settings.mongo_enabled and get_db() is not None,
        "database": settings.mongo_db if settings.mongo_enabled else None,
    }


@router.get("/stats")
async def stats(_: CurrentUser) -> dict:
    """So nhan da gan (va so ket qua bóc tách) theo tung thu tuc."""
    return await history.label_stats()


@router.get("/labels")
async def labels_by_procedure(
    _: CurrentUser,
    procedure: str,
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    """Danh sach ho so da gan nhan cua mot thu tuc."""
    return await history.list_labels(procedure, limit=limit)


@router.get("/jobs")
async def list_jobs(
    _: CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    procedure: str | None = None,
) -> dict:
    return await history.list_jobs(limit=limit, skip=skip, procedure=procedure)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, _: CurrentUser) -> dict:
    job = await history.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay phien quet trong lich su.")
    return job


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, _: CurrentUser) -> dict:
    result = await history.delete_job(job_id)
    if not result.get("deleted"):
        raise HTTPException(status_code=404, detail="Khong tim thay phien quet trong lich su.")
    return result


@router.get("/items/{item_id}/result")
async def get_result(item_id: str, _: CurrentUser) -> dict:
    result = await history.get_result(item_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Chua luu ket qua cua ho so nay.")
    return result


# ---------------------------------------------------------- nhan ket qua dung


@router.get("/items/{item_id}/label")
async def get_label(item_id: str, _: CurrentUser) -> dict:
    label = await history.get_label(item_id)
    if label is None:
        raise HTTPException(status_code=404, detail="Ho so nay chua duoc gan nhan.")
    return label


@router.put("/items/{item_id}/label")
async def save_label(
    item_id: str,
    current_user: CurrentUser,
    payload: dict = Body(...),
) -> dict:
    fields = payload.get("fields")
    if not isinstance(fields, list):
        raise HTTPException(status_code=400, detail="Thieu danh sach truong (fields).")
    result = await history.save_label(
        item_id,
        payload.get("jobId"),
        payload.get("procedure"),
        payload.get("clientDossierId"),
        fields,
        current_user.username,
        status=str(payload.get("status") or "draft"),
    )
    if not result.get("saved"):
        raise HTTPException(status_code=503, detail=result.get("reason") or "Khong luu duoc nhan.")
    return result
