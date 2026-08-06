# Minerva AI Agent

Minerva is a human-supervised browser agent with a FastAPI backend and a React operator console.

## Repository Layout

- `apps/api`: FastAPI backend, browser-use runner, Python tests, and runtime artifacts.
- `apps/web`: React + TypeScript operator console.
- root: shared repo docs and ignore rules only.

## Requirements

- Python 3.11+
- Node 24+
- `GOOGLE_API_KEY`
- Browserless account and API token for the default browser runtime

## Backend Setup

```bash
cd apps/api
uv venv --python 3.11
source ../../.venv/bin/activate
uv sync
uv run browser-use install
```

Create `apps/api/.env`:

```bash
GOOGLE_API_KEY=your-key
GOOGLE_MODEL=gemini-3.5-flash-lite
BROWSER_PROVIDER=browserless
BROWSERLESS_HOST=production-sfo.browserless.io
BROWSERLESS_TOKEN=your-browserless-token
BROWSER_CONTAINER_MODE=false
BROWSER_PREFLIGHT_ON_STARTUP=false
```

Notes:

- `apps/api/.env` is ignored by git. Keep the Browserless token there, not in tracked files.
- Browserless is the default browser provider. The backend builds the CDP URL at runtime from `BROWSERLESS_HOST` and `BROWSERLESS_TOKEN`.
- To roll back to a local browser, set `BROWSER_PROVIDER=local`, remove the Browserless env vars from your local env file, and restart the API.

Run the API:

```bash
cd apps/api
uv run uvicorn backend.api.app:app --reload
```

Run backend tests:

```bash
cd apps/api
uv run pytest
```

## Dockerized Backend

Create `apps/api/.env` from the example file and set a real `GOOGLE_API_KEY`:

```bash
cp apps/api/.env.example apps/api/.env
```

Start the API container:

```bash
docker compose up --build api
```

Notes:

- The container runs browser automation headlessly by default.
- The checked-in `compose.yaml` enables `init: true`, `ipc: host`, `BROWSER_CONTAINER_MODE=true`, and `BROWSER_PREFLIGHT_ON_STARTUP=true` for the API service.
- Run artifacts persist on the host at `apps/api/.runs`.
- The API is exposed at `http://127.0.0.1:8000`.
- Use `http://127.0.0.1:8000/healthz` for liveness and `http://127.0.0.1:8000/readyz` to confirm browser-runtime readiness before launching a run.
- `/readyz` reports the active provider, Browserless endpoint host when applicable, and local-launch settings when `BROWSER_PROVIDER=local`.

## Docker Troubleshooting

If Chromium fails during startup with CDP target/session errors:

- Use the repo-managed startup command: `docker compose up --build api`.
- Verify the API container is running with `ipc: host`.
- Verify Chromium is getting `--disable-dev-shm-usage`.
- Verify `--no-sandbox` is active when `BROWSER_CHROMIUM_SANDBOX=false` or container mode auto-disables sandboxing.
- Restart the container or environment to clear stale browser processes.
- Check `http://127.0.0.1:8000/readyz` before starting a run. A `503` response includes the cached browser startup error.

## Frontend Setup

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` to the backend origin in `apps/web/.env.local`, for example:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

The backend allows the default local Vite origins (`http://localhost:5173` and `http://127.0.0.1:5173`). Override `CORS_ALLOW_ORIGINS` in `apps/api/.env` if you need a different frontend origin.

## Frontend Tests

```bash
cd apps/web
npm test
```
