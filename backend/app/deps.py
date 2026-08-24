from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError

from .schemas import UserOut
from .security import decode_access_token
from .users import get_user

bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Phien dang nhap khong hop le hoac da het han",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserOut:
    if credentials is None:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(credentials.credentials)
    except PyJWTError:
        raise _UNAUTHORIZED from None

    user = await get_user(payload.get("sub", ""))
    if user is None:
        raise _UNAUTHORIZED
    return UserOut(username=user["username"], full_name=user["full_name"], role=user["role"])


async def require_admin(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    """Chan cac thao tac danh rieng cho quan tri: tao tai khoan, xoa du lieu."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Thao tac nay chi danh cho tai khoan quan tri.",
        )
    return current_user


async def require_uploader(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    """Them/xoa ho so trong kho tai lieu: tai khoan chuyen upload hoac quan tri."""
    if current_user.role not in ("uploader", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Thao tac nay danh cho tai khoan chuyen tai tai lieu.",
        )
    return current_user


async def require_scanner(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    """Chay phien quet (ton mot luot OCR + LLM moi ho so): khong danh cho tai khoan
    chuyen tai tai lieu - viec cua ho chi la bo ho so vao kho."""
    if current_user.role == "uploader":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tai khoan tai tai lieu chi lam viec o kho tai lieu.",
        )
    return current_user


async def get_user_allow_query_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    token: str | None = Query(default=None),
) -> UserOut:
    """Nhu get_current_user nhung cho phep token qua ?token= — the <img>/<iframe> xem file
    khong gan duoc header Authorization nen phai truyen token qua URL."""
    raw = credentials.credentials if credentials else token
    if not raw:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(raw)
    except PyJWTError:
        raise _UNAUTHORIZED from None
    user = await get_user(payload.get("sub", ""))
    if user is None:
        raise _UNAUTHORIZED
    return UserOut(username=user["username"], full_name=user["full_name"], role=user["role"])
