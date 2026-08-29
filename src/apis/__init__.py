"""Builds the FastAPI application: routers, static files, and lifespan."""

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.apis.v1.router import api_router
from src.config import UI_DIR
from src.lifespan import lifespan


def create_app() -> FastAPI:
    """Creates and wires the application object."""
    application = FastAPI(
        title="منصة الاختبارات",
        description=(
            "An online exam platform demonstrating the Recoverability "
            "requirement: client-side autosave and server-side durability."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    application.include_router(api_router)
    application.mount("/static", StaticFiles(directory=UI_DIR), name="static")

    @application.get("/", include_in_schema=False)
    def index() -> FileResponse:
        """Serves the front end at ``UI/index.html``."""
        return FileResponse(UI_DIR / "index.html")

    return application


app = create_app()

__all__ = ["app", "create_app"]
