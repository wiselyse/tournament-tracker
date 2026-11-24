import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .api import build_router
from .store import Store

BACKEND_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def create_app(data_dir: Path | None = None, dist: Path | None = None) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("WSF_DATA_DIR") or BACKEND_DIR / "data")
    dist = Path(dist or os.environ.get("WSF_FRONTEND_DIST") or FRONTEND_DIST)

    app = FastAPI(title="WSF Tournament Tracker")
    app.include_router(build_router(Store(data_dir / "tournaments.db")))

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        # Real files (JS, icons, sw.js) as-is; any other non-API path is a client-side
        # route, so hand back index.html and let React Router take it.
        if path.startswith("api/") or path == "api":
            raise HTTPException(404)
        root = dist.resolve()
        target = (root / path).resolve()
        if path and target.is_file() and target.is_relative_to(root):
            return FileResponse(target)
        index = root / "index.html"
        if not index.is_file():
            raise HTTPException(404, "frontend not built: run `npm run build` in frontend/")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
