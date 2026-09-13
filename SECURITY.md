# Security Policy

## Reporting a Vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Use a private GitHub security advisory for this repository when that feature is available. Include the affected component, reproduction steps that do not expose credentials or private data, and the potential impact.

If a secret may have been exposed, revoke or rotate it immediately and report only the minimum identifying details needed to investigate.

## Deployment Limitations

Minerva is a prototype for supervised browser automation. The API currently has no authentication or tenant isolation, and run artifacts may contain user tasks, page content, screenshots, browser traces, and conversation history. Do not expose the API or artifact endpoints to an untrusted network without adding authentication, authorization, rate limiting, and appropriate data-retention controls.

Keep OpenRouter, Browserless, and Firecrawl credentials in ignored environment files or an external secret manager. Never commit `.env` files, credentials, or files from `.runs` or `apps/api/.runs`.
