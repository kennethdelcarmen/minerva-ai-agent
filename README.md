# Minerva AI Agent

Minerva is a human-supervised browser agent with a FastAPI backend and a React operator console.

## Repository Layout

- `apps/api`: FastAPI backend, browser-use runner, Python tests, and runtime artifacts.
- `apps/web`: React + TypeScript operator console.
- root: shared repo docs and ignore rules only.

## Requirements

- Python 3.11+
- Node 24+
- `OPENROUTER_API_KEY`

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
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=google/gemini-2.5-flash:free
```

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

Create `apps/api/.env` from the example file and set a real `OPENROUTER_API_KEY`:

```bash
cp apps/api/.env.example apps/api/.env
```

Start the API container:

```bash
docker compose up --build api
```

Notes:

- The container runs browser automation headlessly by default.
- Run artifacts persist on the host at `apps/api/.runs`.
- The API is exposed at `http://127.0.0.1:8000`.

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
