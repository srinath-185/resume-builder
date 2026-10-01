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

### Administration

Accounts have a role: `user`, `admin` or `superadmin`. Nobody can choose a role at sign-up. Create the
first superadmin (or promote an existing account) from the server; the password is prompted for, never
passed on the command line:

```bash
npm run build
npm run admin:create -- --email you@example.com --name "Your Name"
```

Admins get the Administration pages (users, audit log, AI usage across users). They can disable accounts
and sign users out everywhere; only a superadmin can grant roles or manage other admins, and nobody can
change their own role or status. Admins never see resumes, mailbox credentials or portal cookies.

Sign-up is `REGISTRATION_MODE=open` by default in development and closed when `NODE_ENV=production`;
with it closed, admins create accounts. Admin sessions last `JWT_ADMIN_EXPIRES_IN` (1h). Behind a reverse
proxy, set `TRUST_PROXY` so login rate limits see the real client address.

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

## End-to-end smoke test

`scripts/e2e-smoke/run.sh` runs the whole flow against real services and tears everything down:
a throwaway `mongod` on port 27999, a fake OpenAI-compatible LLM wired in through `GROQ_BASE_URL`,
the compiled API, the built frontend behind `vite preview`, and real headless Chrome applying on a
local job site. It needs `mongod` and Chrome on the machine and fails fast if any of its ports
(27999, 3999, 3101, 5301) is already taken.

```bash
(cd frontend && npm run build) && scripts/e2e-smoke/run.sh
```

## Branching

One branch per feature (`feature/<name>`), merged into `main` with `--no-ff` so each feature stays
visible in history.
