from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError

from .schemas import UserOut
from .security import decode_access_token
from .store import get_user_store

bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Phien dang nhap khong hop le hoac da het han",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserOut:
    if credentials is None:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(credentials.credentials)
    except PyJWTError:
        raise _UNAUTHORIZED from None

    user = get_user_store().get(payload.get("sub", ""))
    if user is None:
        raise _UNAUTHORIZED
    return UserOut(username=user["username"], full_name=user["full_name"], role=user["role"])
