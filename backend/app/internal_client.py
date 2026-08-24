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


TRACES_PATH = "/api/v1/traces"


class InternalTraceClient:
    """Doc van ban OCR cua mot ho so tu BE noi bo.

    BE khong tra OCR trong ket qua cua /api/v1/process (xem ProcessResp: chi co fields,
    extracted, stats...). No luu OCR vao "trace" cua request va chi cho doc qua
    /api/v1/traces - API danh RIENG cho tai khoan admin cua BE.

    Vi vay lop nay dang nhap bang tai khoan admin rieng (APP_INTERNAL_ADMIN_*), doc theo
    hai buoc: tim trace theo requestId -> lay chi tiet trace (danh sach khong kem ocr_text
    vi nang). Chua cau hinh tai khoan admin thi tra ve ly do de giao dien noi ro, khong nem loi.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.internal_api_base_url.rstrip("/")
        self._username = settings.internal_admin_username
        self._password = settings.internal_admin_password
        self._timeout = min(settings.internal_timeout, 60.0)
        self._token: str | None = None
        self.configured = settings.internal_admin_configured

    async def _login(self, client: httpx.AsyncClient) -> str:
        res = await client.post(
            f"{self._base_url}{LOGIN_PATH}",
            json={"username": self._username, "password": self._password},
        )
        if res.status_code >= 400:
            raise BatchApiError(
                401,
                "INTERNAL_ADMIN_LOGIN_FAILED",
                "Dang nhap tai khoan quan tri BE noi bo that bai (APP_INTERNAL_ADMIN_*).",
            )
        token = (res.json() or {}).get("accessToken")
        if not token:
            raise BatchApiError(
                502, "INTERNAL_LOGIN_BAD_RESPONSE", "BE noi bo khong tra ve accessToken."
            )
        self._token = token
        return token

    async def fetch_ocr(self, request_id: str) -> dict:
        """Tra ve {available, ocrText, ...} - luon la dict, khong nem loi ra ngoai."""
        if not self.configured:
            return {
                "available": False,
                "reason": (
                    "Chua cau hinh tai khoan quan tri BE noi bo. Them APP_INTERNAL_ADMIN_USERNAME "
                    "va APP_INTERNAL_ADMIN_PASSWORD vao backend/.env roi khoi dong lai backend."
                ),
            }
        if not request_id:
            return {"available": False, "reason": "Ket qua nay khong kem ma phien (requestId)."}

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                token = self._token or await self._login(client)

                async def get(path: str, **params):
                    res = await client.get(
                        f"{self._base_url}{path}",
                        params=params or None,
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if res.status_code == 401:  # token het han -> dang nhap lai mot lan
                        new_token = await self._login(client)
                        res = await client.get(
                            f"{self._base_url}{path}",
                            params=params or None,
                            headers={"Authorization": f"Bearer {new_token}"},
                        )
                    return res

                listing = await get(TRACES_PATH, requestId=request_id, pageSize=5)
                if listing.status_code == 403:
                    return {
                        "available": False,
                        "reason": (
                            "Tai khoan dang cau hinh khong phai quan tri cua BE noi bo nen "
                            "khong doc duoc /api/v1/traces."
                        ),
                    }
                if listing.status_code >= 400:
                    return {
                        "available": False,
                        "reason": f"BE noi bo tra loi {listing.status_code} khi tim trace.",
                    }

                items = (listing.json() or {}).get("items") or []
                trace = next((t for t in items if t.get("request_id") == request_id), None) or (
                    items[0] if items else None
                )
                if trace is None:
                    return {
                        "available": False,
                        "reason": "BE noi bo khong con luu trace cua ho so nay.",
                    }

                detail = await get(f"{TRACES_PATH}/{trace.get('id')}")
                if detail.status_code >= 400:
                    return {
                        "available": False,
                        "reason": f"BE noi bo tra loi {detail.status_code} khi doc trace.",
                    }
                doc = detail.json() or {}
        except httpx.HTTPError as exc:
            logger.warning("Khong doc duoc OCR tu BE noi bo: %s", exc)
            return {"available": False, "reason": "Khong ket noi duoc toi BE noi bo."}
        except BatchApiError as exc:
            return {"available": False, "reason": exc.message}

        text = (doc.get("ocr_text") or "").strip()
        if not text:
            return {
                "available": False,
                "reason": "Trace co ton tai nhung khong kem van ban OCR (co the ho so la file text san).",
                "provider": doc.get("ocr_provider"),
            }
        return {
            "available": True,
            "requestId": request_id,
            "ocrText": text,
            "provider": doc.get("ocr_provider"),
            "chars": len(text),
            "createdAt": doc.get("created_at"),
        }
