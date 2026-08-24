"""Quan ly tai khoan - chi tai khoan quyen admin moi goi duoc.

Tuong duong `tools/seed_user.py` nhung lam ngay tren giao dien, khong can vao may chu.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from .. import users
from ..deps import require_admin
from ..schemas import SaveUserRequest, UserOut

router = APIRouter(prefix="/api/users", tags=["users"])

AdminUser = Annotated[UserOut, Depends(require_admin)]


@router.get("")
async def list_users(_: AdminUser) -> dict:
    return await users.list_users()


@router.post("", status_code=201)
async def create_user(payload: SaveUserRequest, _: AdminUser) -> dict:
    result = await users.save_user(
        payload.username, payload.password, payload.full_name, payload.role
    )
    if not result.get("saved"):
        raise HTTPException(status_code=400, detail=result.get("reason") or "Khong luu duoc.")
    return result


@router.put("/{username}")
async def update_user(username: str, payload: SaveUserRequest, admin: AdminUser) -> dict:
    # Tu ha quyen chinh minh se khoa mat duong vao trang quan ly tai khoan
    if username.strip().lower() == admin.username and payload.role != "admin":
        raise HTTPException(status_code=400, detail="Khong the tu bo quyen admin cua chinh minh.")
    result = await users.save_user(username, payload.password, payload.full_name, payload.role)
    if not result.get("saved"):
        raise HTTPException(status_code=400, detail=result.get("reason") or "Khong luu duoc.")
    return result


@router.delete("/{username}")
async def delete_user(username: str, admin: AdminUser) -> dict:
    if username.strip().lower() == admin.username:
        raise HTTPException(status_code=400, detail="Khong the tu xoa tai khoan dang dung.")
    result = await users.delete_user(username)
    if not result.get("deleted"):
        raise HTTPException(
            status_code=404, detail=result.get("reason") or "Khong tim thay tai khoan do."
        )
    return result
