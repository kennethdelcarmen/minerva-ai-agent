# Minerva AI Agent

Minerva is a human-supervised browser agent with a FastAPI backend and a React operator console. It uses browser-use for agent orchestration and Playwright-backed browser control.

## Repository Layout

- `apps/api`: FastAPI backend, browser-use runner, tests, and local runtime artifacts.
- `apps/web`: React + TypeScript operator console.
- `compose.yaml`: Local Docker entrypoint for the backend.

## Requirements

- Python 3.11+
- Node 24+
- An OpenRouter API key
- A Browserless account and API token when using the default `browserless` browser provider
- A Firecrawl API key only when automatic anti-bot fallback is needed

## Backend Setup

```bash
cd apps/api
uv venv --python 3.11
uv sync
uv run browser-use install
```

Create `apps/api/.env` from the checked-in example:

```bash
cp .env.example .env
```

Set the required values:

```bash
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=openrouter/free
BROWSER_PROVIDER=browserless
BROWSERLESS_HOST=production-sfo.browserless.io
BROWSERLESS_TOKEN=your-browserless-token
```

Optional anti-bot fallback configuration:

```bash
FIRECRAWL_API_KEY=your-firecrawl-key
FIRECRAWL_BASE_URL=https://api.firecrawl.dev/v2
```

`openrouter/free` routes each request to a compatible free model. The selected model may vary between requests, and free routes can have lower limits, higher latency, or temporary availability issues. Use a paid OpenRouter model only after adding it to the backend model catalog and tests.

Never commit `.env`, API keys, browser credentials, or files from `.runs` or `apps/api/.runs`. Run artifacts can contain tasks, page content, screenshots, traces, and conversation history.

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

## Local Browser Mode

To run Chromium locally instead of using Browserless, set the following in `apps/api/.env`:

```bash
BROWSER_PROVIDER=local
```

Remove the Browserless variables if they are not needed, then restart the API.

## Dockerized Backend

The Docker setup reads `apps/api/.env`, runs headlessly, and binds the API to `127.0.0.1:8000` on the host:

```bash
docker compose up --build api
```

Use the health endpoints before starting a run:

- `http://127.0.0.1:8000/healthz` checks liveness.
- `http://127.0.0.1:8000/readyz` reports browser-runtime readiness.

The container persists local run artifacts under `apps/api/.runs`. Review them for sensitive content before sharing.

## Frontend Setup

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` in `apps/web/.env.local`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

The backend allows the default local Vite origins. Override `CORS_ALLOW_ORIGINS` in `apps/api/.env` for a different local frontend origin.

Run frontend tests and the production build:

```bash
cd apps/web
npm test
npm run build
```

## Security and Contributions

- See [SECURITY.md](SECURITY.md) for disclosure guidance and deployment limitations.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request expectations.
- This project is licensed under the [MIT License](LICENSE).
