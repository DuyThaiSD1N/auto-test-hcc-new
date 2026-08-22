import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import auth, batch, procedures

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.using_default_secret:
        logger.warning("APP_SECRET_KEY dang dung gia tri mac dinh - BAT BUOC doi khi deploy that.")
    if settings.default_password == "admin123":
        logger.warning(
            "APP_DEFAULT_PASSWORD dang dung gia tri mac dinh - BAT BUOC doi khi deploy that."
        )
    if not settings.batch_api_configured:
        logger.warning(
            "Chua dat APP_BATCH_API_SECRET - chuc nang quet ho so se bao loi 503."
        )
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(procedures.router)
app.include_router(batch.router)


@app.get("/api/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


# ---------------------------------------------------------------------------
# Phuc vu ban build cua Vite (neu co) tren cung mot origin voi API.
# Nho vay khi hosting khong can cau hinh CORS va khong lo chenh domain.
# ---------------------------------------------------------------------------
DIST: Path | None = settings.frontend_dist_path

if DIST is not None:
    if (DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    INDEX_HTML = DIST / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        # Cac duong dan /api/* da duoc router xu ly o tren; toi day nghia la khong ton tai.
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json")):
            raise HTTPException(status_code=404, detail="Not Found")

        if full_path:
            candidate = (DIST / full_path).resolve()
            # Chan path traversal kieu ../../etc/passwd
            if candidate.is_file() and candidate.is_relative_to(DIST.resolve()):
                return FileResponse(candidate)

        # Moi route con lai tra ve index.html de React Router tu dieu huong
        return FileResponse(INDEX_HTML)
else:
    logger.info("Khong tim thay frontend/dist - chi chay che do API.")
