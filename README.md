![Railway](https://img.shields.io/badge/Railway-Supported-blue?logo=railway)
![Docker](https://img.shields.io/badge/Docker-Supported-blue?logo=docker)
![Node.js](https://img.shields.io/badge/Node.js-Supported-green?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Supported-blue?logo=typescript)
![Express](https://img.shields.io/badge/Express-Supported-yellow?logo=express)

# Playwright with Node.js

Production-oriented API for scraping demo pages with Playwright, Express, TypeScript, and Swagger/OpenAPI documentation.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/playwright-with-nodejs?referralCode=asepsp&utm_medium=integration&utm_source=template&utm_campaign=generic)

![](./img/docs.png)

## Features

- Express API with route, controller, service, middleware, and utility layers
- Playwright Chromium scraping through a shared browser service
- QA Automation contracts: `POST /discover`, `POST /locators`, `POST /execute` (PRD envelopes)
- Swagger UI at `/docs` and OpenAPI JSON at `/openapi.json`
- Zod request validation, Helmet, CORS, compression, and rate limiting
- Optional `PLAYWRIGHT_SERVICE_TOKEN` for QA endpoints
- Winston structured logging
- Jest unit tests and Playwright API/e2e tests
- Docker image with Playwright browser dependency installation

## Requirements

- Node.js 20+
- npm
- Docker, optional for container deployment

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:3000` by default.

Useful URLs:

- Root: `http://localhost:3000/` redirects to `/docs`
- Health: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Scripts

```bash
npm run dev            # Start TypeScript dev server
npm run build          # Compile src/ to dist/
npm start              # Run compiled app
npm run typecheck      # TypeScript check without emit
npm run lint           # ESLint
npm run format:check   # Prettier check
npm test               # Jest tests
npm run test:e2e       # Playwright API/e2e tests
npm run docker:build   # Build Docker image
npm run docker:compose # Start with Docker Compose
npm run zip            # Build and create distribution zip
```

## API Endpoints

### Root

```http
GET /
```

Redirects to `/docs`.

### Health

```http
GET /health
```

Returns service health, uptime, environment, and timestamp.

### QA Automation (n8n contracts)

These three endpoints match the platform PRDs (`06` discovery, `07` locators, `09` execute). Responses use `{ ok: true, ... }` or `{ ok: false, retryable, error: { code, message } }` (HTTP 200 for logical failures; 5xx only on crashes). No database access.

Optional auth: set `PLAYWRIGHT_SERVICE_TOKEN`, then send `Authorization: Bearer <token>` or `X-Service-Token: <token>`.

#### Discover

```http
POST /discover
Content-Type: application/json

{
  "job_id": "uuid",
  "base_url": "https://example.com",
  "max_depth": 2,
  "max_pages": 50,
  "browser": "chromium",
  "same_origin": true,
  "seed_urls": ["https://example.com/login"],
  "capture": {
    "html_snapshot": true,
    "screenshot": true,
    "meta_description": true,
    "page_model": true
  }
}
```

BFS same-origin crawl with depth/page caps (hard max depth 5 / pages 200). When `seed_urls` is non-empty, those same-origin URLs are visited first (up to `max_pages`) and **link expansion is skipped** — Manual/CSV jobs can target case URLs without wandering into unrelated demos. Per page: `url`, `title`, `meta_description`, `depth`, `status`, optional HTML, screenshot (base64 PNG), and compact `page_model`. Stats: `{ visited, skipped_external, errors }`.

#### Locators

```http
POST /locators
Content-Type: application/json

{
  "job_id": "uuid",
  "browser": "chromium",
  "max_per_page": 80,
  "pages": [
    { "page_id": "uuid", "url": "https://example.com/login" }
  ]
}
```

Loads each URL and extracts interactive elements. Strategy preference: `testid` → `role` → `placeholder`/`label` → `css` (`xpath` only if Playwright/DOM path warrants; this extractor prefers css over inventing xpath). Per-page `{ ok, locators }` or `{ ok: false, error }`. Stats: `{ pages_ok, pages_failed, locator_count }`. Zero locators overall → `LOCATORS_EMPTY`.

#### Execute

```http
POST /execute
Content-Type: application/json

{
  "job_id": "uuid",
  "base_url": "https://example.com",
  "browser": "chromium",
  "capture": {
    "screenshot_on_failure": true,
    "video": true,
    "trace": false
  },
  "cases": [
    {
      "test_case_id": "uuid",
      "test_plan_id": "uuid",
      "title": "Login",
      "steps": [
        { "ordinal": 1, "action": "goto", "value": "/login" },
        {
          "ordinal": 2,
          "action": "fill",
          "locator": { "strategy": "testid", "selector": "email-input" },
          "value": "user@example.com"
        },
        {
          "ordinal": 3,
          "action": "click",
          "locator": {
            "strategy": "role",
            "selector": "button",
            "role": "button",
            "accessible_name": "Sign in"
          }
        }
      ],
      "assertions": [{ "type": "url_contains", "expected": "/dashboard" }]
    }
  ]
}
```

Actions: `goto`, `fill`, `click`, `check`, `uncheck`, `select`, `press`, `wait`, `assert`. Locator strategies map to Playwright helpers (`getByTestId`, `getByRole`, `getByPlaceholder`, `getByLabel`, `getByText`, CSS/`xpath=`). When `capture.screenshot_on_failure` is true (default), every case gets a PNG screenshot (pass and fail). When `capture.video` is true, each case runs in a dedicated context with `recordVideo` and returns a `video/webm` base64 artifact. Trace is accepted but not recorded.

Contract helper self-check:

```bash
npx jest src/qa-contract.check.test.ts
```

### Scrape Test Sites

```http
GET /api/scrape/sites
```

Scrapes available test site links from `SCRAPER_BASE_URL`.

### Scrape E-commerce Products

```http
GET /api/scrape/ecommerce/products?limit=10
```

Query parameters:

- `limit`: integer from 1 to 50, default `10`

### Run Scrape Task

```http
POST /api/scrape/run
Content-Type: application/json

{
  "target": "ecommerce",
  "limit": 10
}
```

Supported targets:

- `test-sites`
- `ecommerce`

### Run Smoke Test

```http
POST /api/tests/smoke
Content-Type: application/json

{
  "target": "test-sites"
}
```

## Response Format

Success responses:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "durationMs": 123,
    "timestamp": "2026-05-07T00:00:00.000Z"
  }
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "meta": {
    "durationMs": 12,
    "timestamp": "2026-05-07T00:00:00.000Z"
  }
}
```

## Project Structure

```text
playwright-with-nodejs/
|-- src/
|   |-- app.ts
|   |-- index.ts
|   |-- server.ts
|   |-- scraper.ts
|   |-- scraper.test.ts
|   |-- config/
|   |-- controllers/
|   |-- middlewares/
|   |-- routes/
|   |-- schemas/
|   |-- services/
|   |-- types/
|   `-- utils/
|-- tests/
|   `-- e2e/
|-- docker/
|   `-- entrypoint.sh
|-- Dockerfile
|-- docker-compose.yml
|-- jest.config.js
|-- playwright.config.ts
|-- package.json
|-- tsconfig.json
`-- README.md
```

`dist/`, `coverage/`, `test-results/`, and `playwright-report/` are generated outputs.

## Environment Variables

| Variable                | Default                                                | Description                                                 |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `NODE_ENV`              | `development`                                          | Runtime environment: `development`, `production`, or `test` |
| `PORT`                  | `3000`                                                 | HTTP port                                                   |
| `HOST`                  | `0.0.0.0`                                              | Bind host                                                   |
| `LOG_LEVEL`             | `info`                                                 | Winston log level                                           |
| `CORS_ORIGIN`           | `*`                                                    | Allowed CORS origin, comma-separated for multiple origins   |
| `SCRAPER_BASE_URL`      | `https://webscraper.io/test-sites`                     | Test site source URL                                        |
| `SCRAPER_ECOMMERCE_URL` | `https://webscraper.io/test-sites/e-commerce/allinone` | E-commerce source URL                                       |
| `PLAYWRIGHT_HEADLESS`   | `true`                                                 | Browser headless mode                                       |
| `PLAYWRIGHT_TIMEOUT_MS` | `30000`                                                | Playwright page/navigation timeout                          |
| `SCRAPER_MAX_LIMIT`     | `50`                                                   | Maximum scrape limit used by configuration                  |
| `RATE_LIMIT_WINDOW_MS`  | `60000`                                                | Rate limit window                                           |
| `RATE_LIMIT_MAX`        | `60`                                                   | Max requests per rate limit window                          |
| `PLAYWRIGHT_SERVICE_TOKEN` | _(empty)_                                           | Optional shared secret for `/discover` `/locators` `/execute` |

## Docker

Build and run:

```bash
npm run docker:build
docker run -p 3000:3000 --env-file .env playwright-api:latest
```

Or use Compose:

```bash
npm run docker:compose
```

The Dockerfile uses Debian slim instead of Alpine so Playwright can install Chromium and OS dependencies more reliably. If `package-lock.json` exists, Docker uses `npm ci`; otherwise it falls back to `npm install`. For repeatable production builds, generate and commit `package-lock.json`.

## Production Checklist

- Set `NODE_ENV=production`
- Configure `CORS_ORIGIN` instead of using `*`
- Use `LOG_LEVEL=warn` or `error`
- Commit `package-lock.json` for deterministic installs
- Send logs to external storage in production
- Put the service behind HTTPS/reverse proxy
- Set CPU and memory limits for the container
- Monitor `/health`
- Validate target sites are reachable from the deployment environment

## Notes

- Scraping and e2e tests depend on external network access to `webscraper.io`.
- Swagger uses a relative OpenAPI server URL (`/`) so the "Try it out" button calls the same origin used to open `/docs`.
- Endpoint-level `headless` values are accepted by current schemas for compatibility, but browser mode is controlled by `PLAYWRIGHT_HEADLESS`.
- `src/scraper.ts` is a legacy standalone scraper used by Jest tests; the main API uses the service/controller stack under `src/services` and `src/controllers`.

## License

MIT
