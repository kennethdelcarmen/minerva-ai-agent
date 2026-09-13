# Contributing

## Development Setup

Follow the backend and frontend setup instructions in [README.md](README.md). The project requires Python 3.11+, Node 24+, and `uv`.

Run the checks before opening a pull request:

```bash
cd apps/api
uv sync --frozen
uv run pytest

cd ../web
npm ci
npm test
npm run build
```

## Pull Requests

- Keep changes focused and explain the user-visible or maintainer-relevant reason for the change.
- Add or update tests for behavior changes.
- Do not include API keys, browser credentials, personal browsing data, screenshots, traces, or `.runs` artifacts.
- Preserve the operator approval and interruption safeguards when changing browser actions.
- Describe any environment, migration, or rollback requirements in the pull request.
