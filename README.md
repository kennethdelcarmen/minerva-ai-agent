# Minerva AI Agent

Backend service for a human-supervised browser agent built on `browser-use`.

## Requirements

- Python 3.11+
- `GOOGLE_API_KEY`

## Setup

```bash
uv venv --python 3.11
source .venv/bin/activate
uv sync
```

Install the browser runtime:

```bash
uv run browser-use install
```

Create a `.env` file with your Gemini key:

```bash
GOOGLE_API_KEY=your-key
GOOGLE_MODEL=gemini-3.6-flash
```

## Run

```bash
uv run uvicorn backend.api.app:app --reload
```

## Test

```bash
uv run pytest
```
