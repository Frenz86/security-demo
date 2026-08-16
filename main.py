"""App FastAPI minima: target verificabile della pipeline di sicurezza."""

from fastapi import FastAPI

app = FastAPI(title="security-demo", version="0.1.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Hello from security-demo"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
