"""
Application entry point module.
"""
import os
import uvicorn

# Configure the application settings
# One worker per core. Uviorn workers are async not blocking sync workers
# Like Gunicorn, so we can use more workers than cores.
# Buy throughput here - it only mutiplies each worker's DB connection pool
CPU_COUNT = os.cpu_count() or 1
WORKERS = CPU_COUNT * 2 + 1

if __name__ == "__main__":
    uvicorn.run(
        "src.main:app",
        host="127.0.0.1",
        port=8000,
        workers=WORKERS
    )
