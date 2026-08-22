"""Chuan hoa file nguoi dung tai len truoc khi gui di boc tach.

Nguon boc tach (ca API theo lo lan BE noi bo) chi nhan JPG, PNG, PDF, DOCX.
Nguoi dung thi co file du kieu, nen o day chuyen doi truoc:

- Anh la (WEBP, BMP, GIF, TIFF)  -> JPEG  (dung Pillow, luon co san)
- Van ban cu (DOC, RTF, ODT)     -> PDF   (dung LibreOffice neu may co cai)

Khong chuyen duoc thi bao loi bang tieng Viet kem cach xu ly, thay vi de nguon
boc tach tra ve BAD_FILE_TYPE kho hieu.
"""

import io
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from .config import get_settings

logger = logging.getLogger("uvicorn.error")

# Kieu duoc nguon boc tach chap nhan truc tiep
DIRECT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Anh can chuyen sang JPEG
IMAGE_CONVERT = {".webp", ".bmp", ".gif", ".tif", ".tiff"}

# Van ban can LibreOffice chuyen sang PDF
OFFICE_CONVERT = {".doc", ".rtf", ".odt"}

ACCEPTED_SUFFIXES = set(DIRECT_TYPES) | IMAGE_CONVERT | OFFICE_CONVERT

SOFFICE_CANDIDATES = (
    "soffice",
    "libreoffice",
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
)


class UnsupportedFile(Exception):
    """File khong dung duoc; message da la cau tieng Viet cho nguoi dung doc."""


def find_soffice() -> str | None:
    configured = get_settings().soffice_path.strip()
    if configured:
        return configured if Path(configured).is_file() else shutil.which(configured)
    for candidate in SOFFICE_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    return None


def prepare_file(filename: str, content: bytes) -> tuple[str, bytes, str]:
    """Tra ve (ten, noi dung, content-type) da san sang gui di boc tach."""
    name = Path(filename or "khong-ten").name
    suffix = Path(name).suffix.lower()

    if suffix in DIRECT_TYPES:
        return name, content, DIRECT_TYPES[suffix]

    if suffix in IMAGE_CONVERT:
        return _image_to_jpeg(name, content)

    if suffix in OFFICE_CONVERT:
        return _office_to_pdf(name, content, suffix)

    raise UnsupportedFile(
        f"File '{name}' không dùng được. Chấp nhận: "
        "JPG, PNG, PDF, DOCX (dùng thẳng); WEBP, BMP, GIF, TIFF, DOC, RTF, ODT (tự chuyển đổi)."
    )


def _image_to_jpeg(name: str, content: bytes) -> tuple[str, bytes, str]:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - chi xay ra khi thieu dependency
        raise UnsupportedFile(
            f"Chưa cài Pillow nên không chuyển được ảnh '{name}'. Hãy lưu file thành JPG hoặc PNG."
        ) from exc

    try:
        with Image.open(io.BytesIO(content)) as image:
            # GIF/TIFF nhieu khung: chi lay khung dau
            image.seek(0)
            # JPEG khong co kenh alpha; nen dan len nen trang truoc khi luu
            if image.mode in ("RGBA", "LA", "P"):
                image = image.convert("RGBA")
                background = Image.new("RGB", image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1])
                image = background
            else:
                image = image.convert("RGB")

            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=92)
    except UnsupportedFile:
        raise
    except Exception as exc:  # noqa: BLE001 - Pillow nem nhieu loai loi khac nhau
        raise UnsupportedFile(f"Không đọc được ảnh '{name}': {exc}") from exc

    return f"{Path(name).stem}.jpg", buffer.getvalue(), "image/jpeg"


def _office_to_pdf(name: str, content: bytes, suffix: str) -> tuple[str, bytes, str]:
    soffice = find_soffice()
    if not soffice:
        raise UnsupportedFile(
            f"File '{name}' cần LibreOffice để chuyển sang PDF nhưng máy chủ chưa cài. "
            "Cách nhanh nhất: mở file rồi lưu thành .docx hoặc .pdf. "
            "Hoặc cài LibreOffice và đặt APP_SOFFICE_PATH nếu nó nằm ở đường dẫn lạ."
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / f"nguon{suffix}"
        source.write_bytes(content)
        try:
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(tmp_path),
                    str(source),
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
        except subprocess.TimeoutExpired as exc:
            raise UnsupportedFile(f"Chuyển '{name}' sang PDF quá lâu, đã dừng.") from exc
        except subprocess.CalledProcessError as exc:
            logger.warning("soffice loi khi chuyen %s: %s", name, exc.stderr[:300] if exc.stderr else "")
            raise UnsupportedFile(f"LibreOffice không chuyển được '{name}' sang PDF.") from exc

        pdf = source.with_suffix(".pdf")
        if not pdf.is_file():
            raise UnsupportedFile(f"Không tạo được PDF từ '{name}'.")
        return f"{Path(name).stem}.pdf", pdf.read_bytes(), "application/pdf"
