# Job Search Automation — Implementation Plan

Backend: LoopBack 4 + MongoDB + BullMQ. Frontend: React 19 + RTK Query with config-driven modules.
Engineering gates: audit row on every mutation, typed `App*Error` + stable `ERROR_CODES` mirrored in
the frontend `errors.json`, timeout + retry + circuit breaker on every third-party call, small files,
a spec test per logic path.

## 1. Product flow

```
Upload resume ─► Parse to structured ResumeDocument ─► User corrects profile (ResumeReview)
      │
      ▼
Discovery (JSearch, Adzuna, Apify LinkedIn/Naukri, SerpAPI posts) ─► dedupe ─► JobMatch score
      │
      ▼  (score ≥ threshold, or user shortlists)
Tailor: JD + master ResumeDocument ─► tailored ResumeVariant + cover note + form answers
      │  fact-anchoring validator: nothing new may appear that is not in the master
      ▼
ApplicationReview screen: diff master vs tailored, JD keyword coverage, edit, Approve / Regenerate / Reject
      │
      ▼  (APPROVED only)
Apply agent (puppeteer, user session) uses the approved PDF ─► APPLIED / NEEDS_REVIEW / FAILED
Outreach (Gmail OAuth or SMTP) attaches the same approved PDF to the recruiter mail
```

Nothing is sent or submitted without an approved `ResumeVariant`. That is enforced in the service
layer, not the UI.


## 2. Placement

Standalone product. Every aggregate is scoped by `userId`; there is no tenant/organization layer.

## 3. Architecture conventions

| Concern | Convention |
|---|---|
| Layering | Controller (thin) → Service (all logic) → Repository (persistence only) |
| Ownership | `OwnedRepository.findOwnedById` — another user's record is indistinguishable from a missing one |
| Errors | `AppError` subclasses with `ERROR_CODES`; one reject provider writes `{ success:false, error }` |
| Responses | Global interceptor wraps results as `{ success:true, data }` |
| Third parties | `ResilientHttpClient` only: timeout, jittered backoff, Retry-After, opossum breaker |
| Background work | `QueueService.enqueue`; `inline` driver for dev/tests, `bullmq` driver in production |
| Secrets at rest | `EncryptionService` (AES-256-GCM); `redactSecrets` before logs and audit rows |
| LLM calls | `LlmRouterService` only — provider chain, per-task routing, token budgets (§4.7) |
| Frontend modules | Config objects rendered by the shared module loader; hand-built screens only where the UI is not list-and-form |

## 4. Backend (`src/**/job-search/`)

Delivery order per gate: model → audit → mutation service → resilient client → thin controller →
`ERROR_CODES` + frontend `errors.json` → spec tests.

### 4.1 Models (`models/job-search/`, extend `UserModifiableEntity`, ObjectId ids, indexes in settings)

| Model | Key fields |
|---|---|
| `CandidateProfile` | targetTitles[], skills[], yearsExperience, location, seniority, preferences, autoTailorThreshold, dailyCaps |
| `Resume` (master) | fileKey, fileUrl, mimeType, version, isPrimary, parseStatus, `document: ResumeDocument` |
| `ResumeDocument` (embedded) | contact, summary, experience[{company, title, start, end, bullets[]}], education[], skills[], projects[], certifications[] |
| `ResumeVariant` | jobListingId, baseResumeId, `document`, pdfKey, coverNote, changes[{path, before, after, reason}], keywordCoverage{before, after, missing[]}, factCheck{passed, violations[]}, status DRAFT / APPROVED / REJECTED, approvedBy, approvedAt |
| `ResumeTemplate` | pdfme schema, isDefault, system vs user |
| `JobSource` | connectorKey, enabled, encrypted credentials / session cookies, dailyCap, lastRunAt |
| `JobListing` | source, externalId, fingerprint, title, company, location, url, description, postedAt |
| `JobMatch` | listingId, profileId, score, reason, status NEW / SHORTLISTED / SKIPPED |
| `JobApplication` | listingId, resumeVariantId, method EASY_APPLY / EXTERNAL_ATS / MANUAL, formAnswers[], screenshotKey, status (below) |
| `HiringPost` | source, postUrl, author, company, text, extractedEmails[], queryUsed |
| `RecruiterContact` | name, company, email, sourceRef, consent flags |
| `OutreachMessage` | contactId, templateId, resumeVariantId, rendered subject/body, channel GMAIL / SMTP, messageId, threadId, status, followUpDueAt |
| `MailConnector` | provider GMAIL / SMTP, encrypted refresh token, scopes, senderAddress, dailyCap, lastError |

`JobApplication.status` state machine:
`MATCHED → TAILORING → REVIEW_PENDING → APPROVED → APPLYING → APPLIED | NEEDS_REVIEW | FAILED`,
plus `REJECTED` from `REVIEW_PENDING`. Transitions live in one service and are unit tested.

### 4.2 Services (`services/job-search/`)

- `resume-parse.service.ts` — PDF/DOCX → text with the already-installed `mupdf` (no vision
  call, far fewer tokens), then one LLM call through `LlmRouterService` (§4.7) producing a
  `ResumeDocument` as JSON (`response_format: json_object`, validated with Joi). Falls back to the
  next provider in the chain on failure, all behind opossum breakers as in `receipt-scan.service.ts`.
- `jd-keyword.util.ts` — extracts required skills/keywords from a JD; computes coverage of a
  `ResumeDocument` against them. Pure, tested.
- `resume-tailor.service.ts` — calls `LlmRouterService` for task `RESUME_TAILOR`. Input: master `ResumeDocument`, JD, keyword gaps. Output:
  tailored `ResumeDocument`, `changes[]` with a reason per change, cover note, suggested form
  answers. Prompt rules: reorder, rephrase, emphasise; never add employers, dates, degrees,
  certifications or metrics not present in the master.
- `resume-fact-check.util.ts` — the guard behind the prompt. Walks the tailored document and
  fails the variant if any company, title, date range, degree or certification is absent from the
  master, or if a number appears that the master never had. A failed check marks the variant
  `DRAFT` with `factCheck.violations` for the reviewer; it can never be approved while failing.
- `resume-diff.util.ts` — structured path-level diff used by the review screen.
- `resume-render.service.ts` — `ResumeDocument` + `ResumeTemplate` → PDF via `@pdfme/generator`,
  stored through `StorageService`. Concurrency-capped by `RESUME_RENDER_CONCURRENCY`.
- `application-review.service.ts` — approve / reject / regenerate; approval snapshots the PDF
  key and form answers onto the `JobApplication`; audit row on every transition.
- `connectors/job-source.connector.interface.ts` (`search`, `fetchDetails`, `canApply`, `apply`)
  with `jsearch`, `adzuna`, `apify-linkedin`, `apify-naukri`, `serpapi-posts` implementations,
  each through a resilient client (timeout, jittered retry, breaker).
- `job-discovery.service.ts` — fan-out under `BATCH_FANOUT_CONCURRENCY`, normalise, fingerprint
  (company + title + location), upsert.
- `job-match.service.ts` — keyword pass, then a batched small-model score on the shortlist via
  `LlmRouterService`; auto-enqueues tailoring
  when score ≥ `CandidateProfile.autoTailorThreshold` and the daily tailor cap is not reached.
- `hiring-post-query.builder.ts` — `"hiring" AND "<title>"`, appending `AND "<location>"` only
  when location is non-empty. Pure, tested.
- `recruiter-contact.service.ts` — email extraction from posts and JDs; optional paid finder.
- `gmail-connector.service.ts` — consent URL, callback, refresh, disconnect, test send. Gmail REST
  `users.messages.send` via `OAuth2Client.request` (no new dependency).
- `outreach.service.ts` — renders via `PlaceholderService`, requires an APPROVED variant for the
  attachment, enforces the daily cap, routes to Gmail or SMTP through the queue, audits each send.
- `apply-agent.service.ts` — puppeteer with the stored session; fills Easy Apply and the common
  ATS forms (Greenhouse, Lever, Workday, Ashby) using the approved form answers and PDF; stops on
  CAPTCHA; screenshots; unknown forms → `NEEDS_REVIEW`.

### 4.3 Queues, workers, crons

Queues: `resume-parse`, `job-discovery`, `resume-tailor`, `resume-render`, `hiring-post`,
`auto-apply`, `outreach`. One processor + one observer each, registered in `setup/workers.ts`
under a new `jobs` worker group (`RUN_WORKERS=core|bi|jobs`).

Crons (behind `shouldRunScheduledJobs`, added to `verify:crons`): `job-discovery-schedule`
hourly, `outreach-followup` daily, `application-status-sweep` daily, `review-reminder` daily
(variants waiting in `REVIEW_PENDING` > N days).

### 4.4 Controllers (`controllers/job-search/`, thin, `@authorize` on new `PermissionResource`s)

`candidate-profile`, `resume` (multipart as in `document.controller.ts`), `resume-variant`
(list, diff, approve, reject, regenerate, download), `resume-template`, `job-listing`,
`job-application`, `hiring-post`, `mail-connector` (oauth start/callback/disconnect/test),
`outreach`. New `MENU_CODES` entries mapped in `menu-permission.map.ts` and seeded.

### 4.5 Errors and config

New `ERROR_CODES`: `RESUME_PARSE_FAILED`, `RESUME_TAILOR_FAILED`, `RESUME_TAILOR_FACT_VIOLATION`,
`RESUME_VARIANT_NOT_APPROVED`, `RESUME_RENDER_FAILED`, `JOB_SOURCE_UNAVAILABLE`,
`MAIL_CONNECTOR_NOT_LINKED`, `GMAIL_TOKEN_EXPIRED`, `APPLY_CAPTCHA_BLOCKED`,
`APPLY_DAILY_CAP_REACHED`, `OUTREACH_DAILY_CAP_REACHED`, `TAILOR_DAILY_CAP_REACHED` — each in all
frontend `errors.json`.

New env: `GROQ_API_KEY` / `GROQ_MODEL`, `GROQ_TEXT_MODEL`, `GEMINI_API_KEY` /
`GEMINI_MODEL`, `OPENCODE_ZEN_API_KEY`, `OPENCODE_ZEN_BASE_URL`, `OPENCODE_ZEN_MODEL`,
`LLM_PROVIDER_CHAIN` (e.g. `groq,gemini,opencode`), `LLM_DAILY_TOKEN_BUDGET`,
`ANTHROPIC_API_KEY` (optional paid upgrade, off by default), `JSEARCH_API_KEY`, `ADZUNA_APP_ID`,
`ADZUNA_APP_KEY`, `APIFY_TOKEN`, `SERPAPI_KEY`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, `TAILOR_DAILY_CAP`, `APPLY_DAILY_CAP`, `OUTREACH_DAILY_CAP`,
`RESUME_RENDER_CONCURRENCY`.

### 4.7 AI model strategy — free tiers first

**Constraint:** no paid model by default. Every LLM call goes through one `LlmRouterService`
with a chain of providers behind one `LlmProvider` interface, so a provider that
disappears or changes its free terms is a config change, not a code change.

Providers (`services/job-search/llm/providers/`):

| Provider | How | Free-tier reality (verified 2026-10-01) | Use |
|---|---|---|---|
| **Groq** (`groq.provider.ts`) | OpenAI-compatible chat completions; text models via `GROQ_TEXT_MODEL`, vision via `GROQ_MODEL` (`qwen/qwen3.6-27b` today) | ~30 RPM, and per-model daily token caps — roughly 100K TPD on the 70B class, 500K TPD on the 8B / Scout class; org-level, extra keys do not help | Primary for parse, keyword extraction, matching, tailoring |
| **Gemini** (`gemini.provider.ts`) | `generateContent` REST API | Free tier with its own daily caps | First fallback; vision fallback for scanned PDFs |
| **OpenCode Zen** (`openai-compatible.provider.ts` with `OPENCODE_ZEN_*`) | OpenAI-compatible endpoint, API key from opencode.ai/zen | Space Bunny (`space-bunny-free`, 1M context, multimodal) was free only until 30 Sep 2026; Zen rotates free models | Optional second fallback; model id is env-driven because it will change |
| **Anthropic** (`anthropic.provider.ts`) | Official SDK, `claude-opus-5-5` | Paid | Off unless `ANTHROPIC_API_KEY` is set; used only for the tailoring task when enabled |

The Groq and OpenCode providers share one `openai-compatible.provider.ts` parameterised by base
URL, key and model; Gemini keeps its own envelope.

Per-task routing (one row per `LlmTask` enum value, overridable per task via env):

| Task | Default model class | Why |
|---|---|---|
| `RESUME_PARSE` | Groq 70B-class text model on extracted text | Text-only keeps a resume at ~2–3K tokens in, ~1.5K out |
| `JD_KEYWORDS` | Groq 8B-class | Cheap, high volume; result cached per `JobListing` fingerprint |
| `JOB_MATCH_SCORE` | Groq 8B-class, batch 5 JDs per call | Keyword pre-filter means only the shortlist reaches the model |
| `RESUME_TAILOR` | Groq 70B-class, Gemini fallback, Anthropic if enabled | The one quality-sensitive step |
| `COVER_NOTE` / `OUTREACH_DRAFT` | Groq 8B-class | Short outputs |

Budgeting against the free caps:

- `LlmBudgetService` keeps a per-provider token bucket in Redis (the shared `ioredis` client):
  requests/minute and tokens/day, seeded from env, decremented from each response's `usage`.
  When a bucket is empty the router moves to the next provider instead of burning a 429.
- A tailoring round trip is ~5–7K tokens, so on the 70B class the free Groq cap is on the order
  of 15–20 tailorings a day for the whole org. `TAILOR_DAILY_CAP` and
  `CandidateProfile.autoTailorThreshold` exist so the budget goes to the best-matched jobs; the
  review queue shows "budget exhausted, resumes tomorrow" rather than failing silently.
- 429s honour `Retry-After`; queue workers for LLM tasks run with concurrency 1–2 so the RPM cap
  is never hit by fan-out.
- JD keyword extraction and match scores are cached by fingerprint; the same posting seen from
  two portals costs one call.
- Deterministic work stays out of the model: text extraction (`mupdf`), fact-check, diff,
  keyword coverage maths, PDF rendering.
- Every call logs provider, model, task, tokens in/out and latency to a `LlmUsageLog` collection
  so the usage page can show spend against caps.

Quality safeguard for free models: the fact-check (§4.2) rejects hallucinated content regardless
of which model produced it, and the reviewer edits before approval. An eval set (§7) scores each
provider on the same resumes/JDs so the routing table is chosen on evidence, and so a paid model
can be switched on per task if the free output is not good enough.

### 4.6 Tests (`src/__tests__/job-search/*.spec.ts`, mocha)

Query builder (null/empty location), fingerprint dedupe, fact-check (injected fake employer,
inflated metric, shifted date all fail), status machine transitions, approval required before
apply/outreach, cap enforcement, token encryption round trip, connector breaker fallback.

## 5. Frontend

Endpoints in `app/api/endpoints/jobSearch.js` (+ metadata), imported in the endpoints index.
Lazy route entries in `app/router/routes/modules.jsx`, constants in `route-constants.js`.
Permission strings in `RESOURCE:ACTION` form. Namespace files per feature; English ships first, and a
locale-parity test guards any language added later. Zod schemas in `common/validations/jobSearch/`.

Modules (`src/modules/JobSearch/<Name>/`, config + `index.jsx` via `createModuleComponent`):

| Module | Type | Notes |
|---|---|---|
| CandidateProfile | single-form (threshold, caps, default template) | — |
| Resumes | multipart table, Reparse action | — |
| ResumeTemplates | template picker + preview | — |
| JobListings | table, score column, Shortlist / Tailor / Skip actions | — |
| Applications | table by status, Review action | — |
| HiringPosts | table, editable query template, Draft outreach action | — |
| OutreachTemplates | new `TemplateType` | — |
| Outreach | sent log, thread status, follow-up date | — |
| MailConnector | single-form, Connect Gmail custom field, SMTP fallback | — |

Screens (`src/screens/client/JobSearch/`), hand-built because they are not list-and-form shaped:

- **ResumeReview** — parsed `ResumeDocument` beside the PDF; correct before anything runs.
- **ApplicationReview** — tabs: *Tailored Resume* (side-by-side master vs variant, change list with
  reasons, keyword coverage before/after, fact-check status, inline edit → re-render),
  *Form Answers*, *Cover note / Outreach mail*. Actions: Approve (disabled while fact-check fails),
  Regenerate with instructions, Reject. Approval is the only path to apply or send.

## 6. Phases

1. **Foundation + resume core.** Repos from skeletons; `LlmRouterService`, `LlmBudgetService`,
   Groq + Gemini providers and `LlmUsageLog`; CandidateProfile; Resume upload; text extraction and
   parse to `ResumeDocument`; ResumeReview; ResumeTemplates + render to PDF. ~1.5 weeks.
2. **Discovery.** JSearch + Adzuna connectors, discovery queue/cron, dedupe, matching,
   JobListings. 1–2 weeks.
3. **Tailor + review.** Keyword extraction, tailor service, fact-check, diff, variant render,
   state machine, ApplicationReview screen, review-reminder cron. 1.5–2 weeks.
4. **Outreach.** Hiring-post query builder + SerpAPI, contact extraction, Gmail connector,
   templates, outreach queue with caps using approved variants. 1–2 weeks.
5. **Assisted apply.** puppeteer agent on approved applications, NEEDS_REVIEW queue, CAPTCHA
   stop, per-portal caps. 2–3 weeks.
6. **Extend.** Apify LinkedIn/Naukri, external ATS fillers, follow-ups, response-rate dashboard
   reusing Analytics widgets.

## 7. Decisions and cautions

- Assisted apply, not blind auto-apply. The approval gate is a service-layer invariant.
- Tailoring may reorder and rephrase only. The fact-check is the guard; the prompt alone is not.
- Official aggregators are the backbone; LinkedIn/Naukri/Indeed scrapers are optional connectors
  behind the interface and may break at any time.
- Gmail has no API-key send path: OAuth2 or SMTP App Password only.
- Free models only by default (§4.7). Free tiers are org-level and small, so the LLM budget
  service, per-task routing and caching are not optional extras — without them the Groq daily cap
  is gone by mid-morning. Paid models are an env switch per task, never the default.
- Daily caps on tailoring (LLM cost), applications and outreach, all configurable per profile.
- Encrypt every token and session cookie with `EncryptionService`; never log them.
- Build an eval set early: 20 real resumes × 50 JDs with hand-scored fit and tailored-quality
  ratings, so prompt changes are measured rather than eyeballed.
