# resume-builder

Upload a resume once. The system finds matching jobs, tailors the resume to each job description,
and applies or emails the recruiter **only after you review and approve** the tailored version.

The full design is in [docs/JOB_SEARCH_AUTOMATION_PLAN.md](docs/JOB_SEARCH_AUTOMATION_PLAN.md).

## Layout

| Path | What |
|---|---|
| `backend/` | LoopBack 4 API (TypeScript, MongoDB, BullMQ) |
| `frontend/` | React 19 + Vite web app |
| `docs/` | Implementation plan |

## Backend

Requirements: Node 18+, MongoDB. Redis only when `QUEUE_DRIVER=bullmq`.

```bash
cd backend
cp .env.example .env      # fill JWT_SECRET and ENCRYPTION_KEY
npm install
npm test                  # builds, then runs unit + acceptance tests on an in-memory DB
npm run dev               # http://127.0.0.1:3100/api, explorer at /api/explorer
```

Every response is `{ success: true, data }` or `{ success: false, error: { code, message, details? } }`.

## Frontend

```bash
cd frontend
npm install
npm test                  # vitest (jsdom)
npm run dev               # http://127.0.0.1:5300, proxies /api to the backend (API_TARGET to override)
npm run build
```

Features plug in through three registries: `src/app/routes.jsx` (pages and sidebar),
`src/app/dashboardWidgets.js` (dashboard tiles) and `api.injectEndpoints` (RTK Query endpoints).
List-and-form pages are declared with `createModuleComponent(config)`; hand-built screens are used
only where the UI is not list-and-form shaped (resume review, application review).
Error messages are keyed by the backend's error codes in `src/common/locales/en/errors.json`; a test
fails if the backend adds a code without a message.

## Branching

One branch per feature (`feature/<name>`), merged into `main` with `--no-ff` so each feature stays
visible in history.
