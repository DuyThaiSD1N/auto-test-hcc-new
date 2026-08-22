"""Client goi API boc tach ho so theo lo cua Auto Fill HCC.

Secret chi ton tai o phia server; trinh duyet khong bao gio nhin thay.
"""

import json
import logging
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger("uvicorn.error")

API_PREFIX = "/api/v1/batch"


class BatchApiError(Exception):
    """Loi tra ve tu API boc tach (hoac loi mang khi goi API do)."""

    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message


# Thong bao tieng Viet cho cac ma loi thuong gap trong tai lieu API
ERROR_HINTS = {
    "UNKNOWN_PROCEDURE": "Ma thu tuc khong duoc API boc tach ho tro.",
    "BAD_BATCH_METADATA": "Metadata gui len khong hop le.",
    "BAD_BATCH_FILE_METADATA": "So mo ta file khong khop so file da gui.",
    "BAD_FILE_TYPE": "Chi ho tro JPG, PNG, PDF, DOCX.",
    "INVALID_BATCH_SECRET": "Secret goi API boc tach khong dung.",
    "BATCH_JOB_NOT_FOUND": "Khong tim thay phien quet.",
    "BATCH_JOB_NOT_DRAFT": "Phien quet da bat dau, khong the tai them ho so.",
    "BATCH_CANNOT_START": "Phien quet chua co ho so hoac da bat dau roi.",
    "FILE_TOO_LARGE": "Mot file vuot qua gioi han dung luong.",
    "PAYLOAD_TOO_LARGE": "Tong dung luong mot ho so vuot qua gioi han.",
    "BATCH_QUEUE_FULL": "Hang doi cua he thong boc tach dang day, thu lai sau.",
    "BATCH_AUTH_NOT_CONFIGURED": "May chu boc tach chua cau hinh secret.",
    "BATCH_DISK_LOW": "May chu boc tach khong du dung luong.",
}


class BatchClient:
    """Bao boc cac endpoint /api/v1/batch."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.batch_api_configured:
            raise BatchApiError(
                503,
                "BATCH_SECRET_NOT_CONFIGURED",
                "Chua cau hinh APP_BATCH_API_SECRET cho may chu.",
            )
        self._base_url = settings.batch_api_base_url.rstrip("/")
        self._secret = settings.batch_api_secret
        self._timeout = settings.batch_api_timeout

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._secret}", **(extra or {})}

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self._base_url}{API_PREFIX}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.request(method, url, **kwargs)
        except httpx.TimeoutException as exc:
            raise BatchApiError(504, "BATCH_TIMEOUT", "API boc tach phan hoi qua lau.") from exc
        except httpx.HTTPError as exc:
            logger.warning("Khong goi duoc API boc tach: %s", exc)
            raise BatchApiError(
                502, "BATCH_UNREACHABLE", "Khong ket noi duoc toi API boc tach."
            ) from exc

        if res.status_code >= 400:
            raise self._to_error(res)

        if not res.content:
            return None
        try:
            return res.json()
        except json.JSONDecodeError as exc:
            raise BatchApiError(
                502, "BATCH_BAD_RESPONSE", "API boc tach tra ve du lieu khong doc duoc."
            ) from exc

    @staticmethod
    def _to_error(res: httpx.Response) -> BatchApiError:
        code, message = "BATCH_ERROR", f"API boc tach tra ve loi {res.status_code}."
        try:
            body = res.json()
            code = body.get("error") or code
            message = ERROR_HINTS.get(code) or body.get("message") or message
        except (json.JSONDecodeError, AttributeError):
            pass
        return BatchApiError(res.status_code, code, message)

    # ---- Phien quet (job) ----

    async def create_job(self, name: str, procedure: str) -> dict:
        return await self._request(
            "POST", "/jobs", json={"name": name, "procedure": procedure}, headers=self._headers()
        )

    async def get_job(self, job_id: str) -> dict:
        return await self._request("GET", f"/jobs/{job_id}", headers=self._headers())

    async def start_job(self, job_id: str) -> dict:
        return await self._request("POST", f"/jobs/{job_id}/start", headers=self._headers())

    async def job_action(self, job_id: str, action: str) -> dict:
        """action thuoc {pause, resume, cancel}."""
        return await self._request("POST", f"/jobs/{job_id}/{action}", headers=self._headers())

    async def delete_job(self, job_id: str) -> dict | None:
        return await self._request("DELETE", f"/jobs/{job_id}", headers=self._headers())

    async def list_items(
        self, job_id: str, status: str | None = None, page: int = 1, page_size: int = 100
    ) -> dict:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        if status:
            params["status"] = status
        return await self._request(
            "GET", f"/jobs/{job_id}/items", params=params, headers=self._headers()
        )

    async def list_results(self, job_id: str, page: int = 1, page_size: int = 100) -> dict:
        return await self._request(
            "GET",
            f"/jobs/{job_id}/results",
            params={"page": page, "pageSize": page_size},
            headers=self._headers(),
        )

    # ---- Ho so (item) ----

    async def upload_item(
        self,
        job_id: str,
        metadata: dict,
        files: list[tuple[str, bytes, str]],
        idempotency_key: str | None = None,
    ) -> dict:
        headers = self._headers(
            {"Idempotency-Key": idempotency_key} if idempotency_key else None
        )
        multipart = [("files", (name, content, content_type)) for name, content, content_type in files]
        return await self._request(
            "POST",
            f"/jobs/{job_id}/items",
            data={"metadata": json.dumps(metadata, ensure_ascii=False)},
            files=multipart,
            headers=headers,
        )

    async def item_result(self, item_id: str) -> dict:
        return await self._request("GET", f"/items/{item_id}/result", headers=self._headers())

    async def retry_item(self, item_id: str) -> dict:
        return await self._request("POST", f"/items/{item_id}/retry", headers=self._headers())
