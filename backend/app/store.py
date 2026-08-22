import json
import unicodedata
from functools import lru_cache
from pathlib import Path

from .schemas import Procedure

DATA_DIR = Path(__file__).parent / "data"


def strip_accents(text: str) -> str:
    """Bo dau tieng Viet + ha chu thuong, dung cho tim kiem khong dau."""
    normalized = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


@lru_cache
def load_procedures() -> list[Procedure]:
    raw = json.loads((DATA_DIR / "procedures.json").read_text(encoding="utf-8"))
    return [Procedure.model_validate(item) for item in raw.get("links", [])]


def search_procedures(query: str | None) -> list[Procedure]:
    items = load_procedures()
    if not query or not query.strip():
        return items
    needle = strip_accents(query.strip())
    return [
        p
        for p in items
        if needle in strip_accents(p.label) or needle in strip_accents(p.code or "")
    ]


def get_procedure(key: str) -> Procedure | None:
    return next((p for p in load_procedures() if p.key == key), None)
