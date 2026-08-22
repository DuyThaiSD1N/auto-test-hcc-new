from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import get_current_user
from ..schemas import LoginRequest, LoginResponse, UserOut
from ..security import create_access_token, verify_password
from ..store import get_user_store

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    user = get_user_store().get(payload.username)
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tai khoan hoac mat khau khong dung",
        )

    token, expires_in = create_access_token(user["username"], {"role": user["role"]})
    return LoginResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserOut(username=user["username"], full_name=user["full_name"], role=user["role"]),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user
