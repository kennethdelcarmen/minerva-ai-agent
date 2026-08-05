FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HEADLESS=true \
    ARTIFACT_ROOT=/app/.runs \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv \
    && ln -s /root/.local/bin/uvx /usr/local/bin/uvx

COPY pyproject.toml uv.lock README.md ./

RUN uv sync --frozen --no-dev --no-install-project

COPY backend ./backend

RUN uv sync --frozen --no-dev \
    && browser-use install \
    && mkdir -p /app/.runs

EXPOSE 8000

CMD ["uvicorn", "backend.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
