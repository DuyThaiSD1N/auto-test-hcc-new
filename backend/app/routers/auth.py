from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import get_current_user
from ..schemas import LoginRequest, LoginResponse, UserOut
from ..security import create_access_token
from ..users import authenticate

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    user = await authenticate(payload.username, payload.password)
    if user is None:
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
