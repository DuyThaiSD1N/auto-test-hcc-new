"""Chon nguon boc tach ho so theo cau hinh.

- "batch"    -> goi API theo lo cua Auto Fill HCC (BatchClient).
- "internal" -> chay hang doi ngay trong backend nay, goi BE noi bo (LocalJobEngine).

Hai lop co cung be mat ham nen cac endpoint /api/batch/* khong can biet dang dung nguon nao.
"""

from functools import lru_cache
from typing import Protocol

from .batch_client import BatchClient
from .config import get_settings
from .local_jobs import LocalJobEngine


class ExtractionBackend(Protocol):
    async def create_job(self, name: str, procedure: str) -> dict: ...
    async def get_job(self, job_id: str) -> dict: ...
    async def start_job(self, job_id: str) -> dict: ...
    async def job_action(self, job_id: str, action: str) -> dict: ...
    async def delete_job(self, job_id: str) -> dict | None: ...
    async def list_items(
        self, job_id: str, status: str | None = ..., page: int = ..., page_size: int = ...
    ) -> dict: ...
    async def list_results(self, job_id: str, page: int = ..., page_size: int = ...) -> dict: ...
    async def upload_item(
        self,
        job_id: str,
        metadata: dict,
        files: list[tuple[str, bytes, str]],
        idempotency_key: str | None = ...,
    ) -> dict: ...
    async def item_result(self, item_id: str) -> dict: ...
    async def retry_item(self, item_id: str) -> dict: ...


@lru_cache
def _local_engine() -> LocalJobEngine:
    """Mot the hien duy nhat: job nam trong bo nho nen khong duoc tao moi moi request."""
    return LocalJobEngine()


def get_backend() -> ExtractionBackend:
    if get_settings().use_internal_backend:
        return _local_engine()
    return BatchClient()
