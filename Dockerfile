# Stage pinnato per tag, non curl | sh: il binario uv è verificato dal digest del tag,
# non codice scaricato a build time.
FROM ghcr.io/astral-sh/uv:0.10.9 AS uv

# Base pinnata per digest: rebuild riproducibile anche se il tag 3.13-slim viene aggiornato.
FROM python:3.13-slim@sha256:8fef26df932191825664e4957ff488c96dfe64918327634a357a55facbc994d3 AS base
COPY --from=uv /uv /usr/local/bin/uv

RUN groupadd -r app && useradd -r -g app -d /app app
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

# Layer dipendenze, invalidato solo se cambia il lock.
# --frozen garantisce che l'immagine contenga le versioni del lock e nient'altro:
# se qualcuno tocca pyproject.toml senza rilockare, il build fallisce invece di
# risolvere silenziosamente qualcosa di diverso.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY --chown=app:app main.py .

ENV PATH="/app/.venv/bin:$PATH"
USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
