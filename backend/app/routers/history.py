"""Tra cuu lich su phien quet va JSON boc tach da luu trong MongoDB."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

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
