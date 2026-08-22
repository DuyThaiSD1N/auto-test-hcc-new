"""Goi BE noi bo Auto Fill HCC (POST /api/v1/process).

BE noi bo lam viec theo tung ho so mot: nhan JSON co danh sach file dang data URL,
tra ve {fields, extracted, stats, errors, ...}. Token lay bang POST /auth/login
va duoc giu lai; het han thi tu dang nhap lai mot lan.
"""

import base64
import json
import logging

import httpx

from .batch_client import BatchApiError
from .config import get_settings

logger = logging.getLogger("uvicorn.error")

LOGIN_PATH = "/auth/login"
PROCESS_PATH = "/api/v1/process"


class InternalClient:
    """Client toi BE noi bo; giu access token giua cac lan goi."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.internal_configured:
            raise BatchApiError(
                503,
                "INTERNAL_NOT_CONFIGURED",
                "Chua cau hinh APP_INTERNAL_USERNAME / APP_INTERNAL_PASSWORD cho BE noi bo.",
            )
        self._base_url = settings.internal_api_base_url.rstrip("/")
        self._username = settings.internal_username
        self._password = settings.internal_password
        self._timeout = settings.internal_timeout
        self._token: str | None = None

    # ------------------------------------------------------------------ auth

    async def _login(self, client: httpx.AsyncClient) -> str:
        res = await client.post(
            f"{self._base_url}{LOGIN_PATH}",
            json={"username": self._username, "password": self._password},
        )
        if res.status_code >= 400:
            raise BatchApiError(
                401,
                "INTERNAL_LOGIN_FAILED",
                "Dang nhap BE noi bo that bai - kiem tra tai khoan trong bien moi truong.",
            )
        token = (res.json() or {}).get("accessToken")
        if not token:
            raise BatchApiError(
                502, "INTERNAL_LOGIN_BAD_RESPONSE", "BE noi bo khong tra ve accessToken."
            )
        self._token = token
        return token

    # --------------------------------------------------------------- process

    async def process(
        self,
        procedure: str,
        files: list[dict],
        options: dict | None = None,
    ) -> dict:
        """files: [{name, type, content(bytes), role, hasHandwriting}] -> ket qua boc tach."""
        payload = {
            "procedure": procedure,
            "options": options or {},
            "files": [
                {
                    "name": f["name"],
                    "type": f["type"],
                    "dataUrl": _to_data_url(f["type"], f["content"]),
                    "role": f.get("role") or "doc",
                    "hasHandwriting": bool(f.get("hasHandwriting")),
                }
                for f in files
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                token = self._token or await self._login(client)
                res = await client.post(
                    f"{self._base_url}{PROCESS_PATH}",
                    json=payload,
                    headers={"Authorization": f"Bearer {token}"},
                )
                # Token het han giua chung -> dang nhap lai dung mot lan roi thu lai
                if res.status_code == 401:
                    token = await self._login(client)
                    res = await client.post(
                        f"{self._base_url}{PROCESS_PATH}",
                        json=payload,
                        headers={"Authorization": f"Bearer {token}"},
                    )
        except httpx.TimeoutException as exc:
            raise BatchApiError(504, "INTERNAL_TIMEOUT", "BE noi bo phan hoi qua lau.") from exc
        except httpx.HTTPError as exc:
            logger.warning("Khong goi duoc BE noi bo: %s", exc)
            raise BatchApiError(
                502, "INTERNAL_UNREACHABLE", "Khong ket noi duoc toi BE noi bo."
            ) from exc

        if res.status_code >= 400:
            raise _to_error(res)

        try:
            return res.json()
        except json.JSONDecodeError as exc:
            raise BatchApiError(
                502, "INTERNAL_BAD_RESPONSE", "BE noi bo tra ve du lieu khong doc duoc."
            ) from exc


def _to_data_url(content_type: str, content: bytes) -> str:
    return f"data:{content_type};base64,{base64.b64encode(content).decode()}"


def _to_error(res: httpx.Response) -> BatchApiError:
    code, message = "INTERNAL_ERROR", f"BE noi bo tra ve loi {res.status_code}."
    try:
        body = res.json()
        code = body.get("error") or body.get("code") or code
        message = body.get("message") or body.get("detail") or message
    except (json.JSONDecodeError, AttributeError):
        pass
    return BatchApiError(res.status_code, str(code), str(message))
