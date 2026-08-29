"""Server entry point.

    python -m src.main
    # or
    uvicorn src.main:app --reload

Every endpoint lives under ``src/apis``; this module only exposes ``app`` and
starts uvicorn.
"""

import uvicorn

from src.apis import app
from src.config import APP_HOST, APP_PORT

__all__ = ["app"]


if __name__ == "__main__":
    uvicorn.run("src.main:app", host=APP_HOST, port=APP_PORT, reload=True)
