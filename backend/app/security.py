import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from .config import get_settings

_PBKDF2_ROUNDS = 200_000


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """Bam mat khau bang PBKDF2-HMAC-SHA256, tra ve chuoi pbkdf2$rounds$salt$hash."""
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return "pbkdf2${}${}${}".format(
        _PBKDF2_ROUNDS,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, hashed: str) -> bool:
    try:
        scheme, rounds, salt_b64, digest_b64 = hashed.split("$")
        if scheme != "pbkdf2":
            return False
        expected = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(rounds)
        )
        return hmac.compare_digest(expected, base64.b64decode(digest_b64))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, extra: dict | None = None) -> tuple[str, int]:
    """Tao JWT, tra ve (token, so giay con hieu luc)."""
    settings = get_settings()
    expires_in = settings.access_token_expire_minutes * 60
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
        **(extra or {}),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    return token, expires_in


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
