"""Mock BE noi bo Auto Fill HCC - CHi dung de kiem thu trong may.

Dung dung hop dong cua BE that:
    POST /auth/login       {username, password}      -> {accessToken, refreshToken, user}
    POST /api/v1/process   {procedure, options, files[]} -> {fields, extracted, stats, errors, ...}

Chay:
    python tools/mock-internal-be.py            # 127.0.0.1:8080

Roi dat trong backend/.env:
    APP_EXTRACT_PROVIDER=internal
    APP_INTERNAL_API_BASE_URL=http://127.0.0.1:8080
    APP_INTERNAL_USERNAME=canbo
    APP_INTERNAL_PASSWORD=matkhau

Voi thu tuc "trich-luc-ks" mock tra ve dung 32 field UI cua pipeline trich_luc.
"""

import base64
import json
import pathlib
import sys
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

USERNAME = "canbo"
PASSWORD = "matkhau"
TOKEN = "token-gia-lap-" + uuid.uuid4().hex[:8]
FIXTURES = pathlib.Path(__file__).parent / "fixtures"

# Giong _ALLOWED_TYPES trong app/process/router.py cua BE that
ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/jpg",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

app = FastAPI(title="Mock BE noi bo")


def err(code: int, error: str, message: str):
    return JSONResponse(status_code=code, content={"error": error, "message": message, "code": code})


@app.post("/auth/login")
async def login(body: dict):
    if body.get("username") != USERNAME or body.get("password") != PASSWORD:
        return err(401, "INVALID_CREDENTIALS", "Sai tai khoan hoac mat khau")
    return {
        "accessToken": TOKEN,
        "refreshToken": "refresh-gia-lap",
        "user": {"id": "1", "username": USERNAME, "name": "Can bo thu nghiem", "role": "user"},
    }


@app.post("/api/v1/process")
async def process(body: dict, request: Request):
    if request.headers.get("authorization") != f"Bearer {TOKEN}":
        return err(401, "TOKEN_EXPIRED", "Access token khong hop le hoac da het han")

    procedure = body.get("procedure") or ""
    files = body.get("files") or []
    if not files:
        return err(400, "NO_FILES", "Khong co file nao")

    for f in files:
        if f.get("type") not in ALLOWED_TYPES:
            return err(400, "BAD_FILE_TYPE", f"Kieu file khong ho tro: {f.get('type')}")
        data_url = f.get("dataUrl") or ""
        if not data_url.startswith("data:"):
            return err(400, "BAD_DATA_URL", f"File {f.get('name')} thieu dataUrl")
        try:
            base64.b64decode(data_url.split(",", 1)[1], validate=True)
        except (IndexError, ValueError):
            return err(400, "BAD_DATA_URL", f"dataUrl cua {f.get('name')} khong phai base64")

    fixture = FIXTURES / f"{procedure}.fields.json"
    fields = json.loads(fixture.read_text(encoding="utf-8")) if fixture.is_file() else []

    request_id = "req_" + uuid.uuid4().hex[:12]
    return {
        "fields": fields,
        "extracted": {"soFileNhan": len(files)},
        "stats": {"ocr_latency_ms": 900, "llm_latency_ms": 2400, "total_latency_ms": 3300},
        "errors": [],
        "sessionId": request_id,
        "requestId": request_id,
        "pages": None,
        "businessFlow": None,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    uvicorn.run(app, host="127.0.0.1", port=port)
