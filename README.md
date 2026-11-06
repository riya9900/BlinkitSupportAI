# Blinkit Customer Support AI Agent

An academic project: a customer-support chatbot for a quick-commerce store. A customer can
check an order, search products, request a refund, log a complaint, or be handed to a human agent.

> **All data is fake sample data. No real Blinkit customer information is used.**

## Contents
1. [Features](#features) · 2. [How it works](#how-it-works) · 3. [Quick start](#quick-start) ·
4. [Environment variables](#environment-variables) · 5. [Commands](#commands) · 6. [API reference](#api-reference) ·
7. [Business rules](#business-rules) · 8. [Security design](#security-design) · 9. [Testing: what is and is not verified](#testing-what-is-and-is-not-verified) ·
10. [Deploying to Vercel](#deploying-to-vercel) · 11. [Project structure](#project-structure) · 12. [Known limitations](#known-limitations) · 13. [Troubleshooting](#troubleshooting)

## Features
| Requirement | Where it lives |
|---|---|
| Customer support chatbot | `src/` (React UI) + `api/chat.ts` + `lib/agent.ts` (Gemini) |
| Order status checking | `lib/orders.ts`, `api/order-status.ts` |
| Refund request management | `lib/refundRules.ts` (rules), `lib/refunds.ts`, `api/refund-*.ts` |
| Product search | `lib/products.ts`, `api/products-search.ts` |
| Complaint / query creation | `lib/support.ts`, `api/query-create.ts` |
| Human agent escalation | `lib/support.ts`, `api/handoff-create.ts` |

Database collections: `customers`, `orders`, `products`, `refunds`, `queries`, `handoffs` (plus `ratelimits`, internal counters that delete themselves).

## How it works
```
Browser (React 19 + Vite + TypeScript)
   |  only ever calls our own /api/*  (no secrets in the browser)
   v
Vercel serverless functions (/api)  --->  MongoDB Atlas (official driver)
   |
   +--> Google Gemini (@google/genai) -- may only call 7 fixed backend tools
```
- The browser sends the whole conversation to `POST /api/chat`; the server keeps no session state.
- Gemini decides **what to ask for**, but every fact it states comes from a tool result, and every write goes through
  the same validated, tested backend code as the plain API. **Gemini never touches MongoDB directly.**
- Refund eligibility is plain TypeScript (`lib/refundRules.ts`). The AI cannot change or bypass it.

## Quick start
Requires Node.js 22+ and a free MongoDB Atlas cluster.
1. `npm install`
2. Atlas: create a free **M0** cluster, a database user, and allow your IP under *Network Access*.
3. Copy `.env.example` to `.env` and fill in `MONGODB_URI` (and later `GEMINI_API_KEY`). **Never commit `.env`.**
4. `npm run db:check` (connection test), then `npm run seed` (fake data), then `npm run db:indexes`.
5. `npm run dev` and open http://localhost:5173. The dev server runs the frontend **and** the `/api` functions
   (via `devApiPlugin.ts`, so the Vercel CLI is not needed locally).

Demo buttons in the chat screen send questions that match the sample data.

## Environment variables
Set these in `.env` locally and in the Vercel project settings when deployed. They are server-side only.

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | Atlas connection string |
| `MONGODB_DB` | no (default `blinkit_support`) | database name |
| `GEMINI_API_KEY` | yes for chat | Google AI Studio key |
| `GEMINI_MODEL` | no (default `gemini-2.5-flash`) | any Gemini model that supports function calling |
| `RATE_LIMIT_SALT` | **yes on Vercel** | long random secret used to hash visitor IPs. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GLOBAL_DAILY_CHAT_LIMIT` | no (default 100) | total chat messages per day for the whole app; set it to match your Gemini quota |
| `GEMINI_MIN_INTERVAL_MS` | no | minimum ms between Gemini requests per server instance (free tier: `13000`) |

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | frontend + `/api` at http://localhost:5173 |
| `npm run build` | typecheck everything (`tsc -b`), then production build |
| `npm run lint` | oxlint |
| `npm run typecheck:server` | typecheck `api/`, `lib/`, `scripts/`, `tests/` |
| `npm test` | **63 unit tests**: no database, no Gemini |
| `npm run test:live` | 26 tests against the seeded MongoDB (writes are cleaned up). No Gemini |
| `npm run test:ai` | end-to-end tests with the **real Gemini model** (uses your quota; skipped without a key) |
| `npm run check:api` | bundles every `/api` function the way a deployment would (approximation, see below) |
| `npm run check:secrets` | **safety check before publishing**: fails if any value from your `.env`, or anything shaped like an API key / DB password / private key, is in a file Git would commit, or if `.env` is not ignored. Prints file names only |
| `npm run verify` | lint + build + unit tests + `check:api` in one go |
| `npm run db:check` / `db:indexes` / `seed` | connection test / create indexes (safe to repeat) / load fake data (refuses if data exists) |
| `npm run seed -- --reset` | **deletes** the 6 collections' data, then reloads the fake data |

## API reference
All endpoints return JSON and send `Cache-Control: no-store`. Errors look like `{ "error": "...", "code"?: "..." }`.
Every endpoint validates input (400), rejects wrong methods (405), is rate limited (429 + `Retry-After`), and hides internal errors (500).

| Endpoint | Body / query | Notes |
|---|---|---|
| `POST /api/chat` | `{ messages: [{ role: "user"\|"model", text }] }` | 1-20 messages, last from the user; user text up to 1000 chars, earlier AI replies up to 4000. Returns `{ reply, toolCalls }` |
| `POST /api/order-status` | `{ orderId, phone }` | wrong phone and unknown order give the **same** 404 |
| `POST /api/refund-eligibility` | `{ orderId, phone }` | read-only |
| `POST /api/refund-request` | `{ orderId, phone, reason, amount? }` | 201 created; 422 rule failed; 409 already requested |
| `POST /api/refund-status` | `{ orderId, phone }` | refunds filed for the order |
| `POST /api/query-create` | `{ phone, type: "complaint"\|"query", subject, message, orderId? }` | max 5 open per customer |
| `POST /api/handoff-create` | `{ phone, reason, conversationSummary, orderId? }` | 201 new, 200 if already queued |
| `GET /api/products-search` | `?q=milk&category=dairy&inStockOnly=true&limit=5` | needs `q` or `category` |

## Business rules
**Refunds** (`lib/refundRules.ts`; change the constants at the top):
- Order must be **delivered** (not cancelled, not in progress) and the request within **48 hours** of delivery.
- One active (pending or approved) refund per order, enforced by code **and** a unique database index (three simultaneous requests create exactly one).
- Amount must be above 0 and at most the order total (default: full total).
- Up to **Rs 200** is auto-approved; above that it is saved as `pending` for a human. Ineligible requests are refused with a reason and not saved.

**Handoffs:** one active (waiting/assigned) handoff per customer; a repeat request returns the existing one, so chat retries never duplicate.

**Rate limits** (`lib/rateLimit.ts`, per visitor unless noted):
| Policy | Endpoints | Limits |
|---|---|---|
| chat | `/api/chat` | 6/minute, 40/hour, plus **100/day for the whole app** (`GLOBAL_DAILY_CHAT_LIMIT`) |
| lookup | order-status, refund-eligibility, refund-status | 20/minute, 200/hour |
| write | refund-request, query-create, handoff-create | 10/minute, 60/hour |
| search | products-search | 60/minute |

Counters live in MongoDB (serverless instances do not share memory) and expire automatically. IP addresses are stored only as salted HMAC hashes. If the counter store fails, the request is refused (fail closed).

## Security design
| Risk | Defence |
|---|---|
| Secrets leaking to the browser | keys only in server env vars; verified that the production bundle contains neither the Gemini key nor the DB password |
| AI inventing order/refund facts | facts come only from tool results; system prompt forbids guessing; unit-tested loop |
| AI writing to the database | it cannot: tools call validated service functions, nothing else |
| AI bypassing refund rules / prompt injection | rules are plain code on the server; `request_refund` also needs `customerConfirmed`; product descriptions are never sent to the model; tested with a fake model |
| NoSQL / regex injection | strict type checks on every field; search text is regex-escaped; unit tested with `{ "$ne": ... }` payloads |
| Guessing someone else's order | order ID + phone must match; same 404 for unknown order and wrong phone; lookup rate limits |
| XSS | React renders plain text only; strict Content-Security-Policy (see `vercel.json`) |
| Abuse / runaway Gemini cost | per-visitor limits, global daily chat cap, 6 tool rounds per message, 4 tool calls per round |
| Leaking internals in errors | unexpected errors are logged server-side and shown as a generic message; Gemini/provider text is never forwarded to users |

Security headers (`vercel.json`): CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
Verified locally by serving the production build with those exact headers: the app renders, an injected inline script did not run, and a request to another origin was blocked.

## Testing: what is and is not verified
**Verified (automated and re-runnable):** typecheck (strict), lint, production build, 63 unit tests (validation, refund rules, support input, the agent loop with a fake model, chat UI logic, rate limiting), 26 live database tests (all endpoints, duplicate protection under concurrency, rate-limit store), the `/api` bundle check.

**Verified manually in a browser (dev server):** the chat UI with a *fake* chat reply: success, rate-limit/unavailable/offline/garbage/400 errors, retry without duplicating messages, double-click protection, New chat during a pending reply, Shift+Enter, phone-sized screen.

**Verified against real Gemini (first run, 5 of 8 checks):** order status from the tool, wrong phone reveals nothing, asks for missing details, product price from the catalogue, no refund created without confirmation.

**NOT yet verified:**
- Real-Gemini checks for *confirmed refund creation*, *prompt-injection resistance* and *human handoff*. The free daily quota ran out. Re-run `npm run test:ai` after it resets.
- The UI end-to-end with real Gemini replies.
- **A real Vercel deployment.** There was no Vercel account in the build environment. `npm run check:api` confirms every function bundles and exports a handler, but it is only an approximation of Vercel's build.
- Screen-reader and cross-browser testing.

## Deploying to Vercel
This is a checklist for **you** to follow. It needs your own accounts and secrets, which should never be shared in chat.

1. **Put the project in a Git repository** in a folder that is not temporary, commit, and push to a **private** GitHub repo.
   Before pushing, run `npm run check:secrets` (it must print `OK`) and `git check-ignore .env` (it must print `.env`).
   Optional but recommended: `git config core.hooksPath .githooks` makes Git run `check:secrets` automatically before every commit and block it if a secret is found.
   If a secret is ever pushed by mistake, treat it as stolen: rotate it (new Atlas password, new Gemini key) before anything else. Deleting it from Git later is not enough.
2. **MongoDB Atlas**
   - *Network Access*: add `0.0.0.0/0` (Vercel's IP addresses change, so a fixed IP cannot be used). Acceptable for fake data only; never for real customer data.
   - *Database Access*: prefer a user restricted to the `blinkit_support` database (readWrite) over "any database".
   - Make sure the database is seeded and indexed: `npm run seed` and `npm run db:indexes` (from your machine, with `.env` pointing at the same cluster).
3. **Vercel**: *Add New > Project*, import the repo. The Vite preset is detected automatically (build `npm run build`, output `dist`).
   Add the [environment variables](#environment-variables) (`MONGODB_URI`, `MONGODB_DB`, `GEMINI_API_KEY`, `RATE_LIMIT_SALT`, optionally `GEMINI_MODEL` and `GLOBAL_DAILY_CHAT_LIMIT`) for Production (and Preview if you use previews), then deploy.
   Set `GLOBAL_DAILY_CHAT_LIMIT` to what your Gemini quota can support (each chat message uses 2-3 Gemini requests).
4. **Smoke test the deployed site** (replace the address). These calls do not use Gemini:
   ```bash
   curl "https://YOUR-APP.vercel.app/api/products-search?q=milk"
   ```
   ```bash
   curl -X POST "https://YOUR-APP.vercel.app/api/order-status" -d '{"orderId":"ORD1002","phone":"9000000001"}'
   ```
   ```bash
   curl -I "https://YOUR-APP.vercel.app/"
   ```
   The last should show the `content-security-policy` header. Then open the site, click a demo button and read a real reply.
5. **After deploying:** watch *Vercel > Logs* for errors. If a deployment fails with `Missing environment variable RATE_LIMIT_SALT`, add it and redeploy.
   Preview deployments are protected by Vercel by default; keep that on.

Seed dates are relative to when you seed, so ORD1001 is only "delivered 2 hours ago" at that moment; after 48 hours its refund demo stops working until you re-seed with `npm run seed -- --reset`.

## Project structure
```
api/            serverless endpoints (one file per route)
lib/            shared backend code
  refundRules.ts   pure refund policy                 rateLimit.ts   rate limiting
  refunds.ts       refund service (writes)            support.ts     queries + handoffs
  orders.ts, products.ts   read-only lookups          validation.ts  every input check
  agent.ts         the tool-calling loop              agentTools.ts  the 7 tools Gemini may call
  gemini.ts        Gemini client, retries, errors     systemPrompt.ts  the AI's instructions
  http.ts          JSON/error helpers                 db.ts, types.ts  MongoDB + document shapes
src/            React UI: App.tsx, components/, useChat.ts, api.ts, chatLogic.ts (pure, unit-tested)
scripts/        seed.ts + seedData.ts, checkDb.ts, ensureIndexes.ts, checkApiBundle.ts
tests/          unit tests (*.test.ts) and live tests (*.live.test.ts)
devApiPlugin.ts DEV ONLY: runs api/ locally under `npm run dev`; never in the build
vercel.json     function timeout + security headers
.gitignore, .gitattributes, .githooks/   keep secrets out of Git, consistent line endings, pre-commit secret check
```
`src/assets/*` and `public/icons.svg` are leftover Vite demo images that nothing uses; they are safe to delete.

## Known limitations
- The phone-number check is demo-level verification, **not real authentication**. A real system needs login or an OTP.
- `customerConfirmed` on refunds is set by the AI model, so it is a guardrail, not proof of consent. The server-side rules are the real protection.
- Conversation history comes from the browser, so a user can forge "model" turns. This cannot bypass the phone check, refund rules or limits, which run on the server.
- Rate limiting is per IP address; people behind one shared address share a budget, and an attacker with many addresses is only stopped by the global daily cap.
- Human handoffs and pending refunds are only *recorded*; there is no agent dashboard to work through them.
- Gemini's free tier is very small (about 5 requests/minute and 20/day per model in our testing); plan demos around it or enable billing.

## Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| `package.json not found` | run commands from the project root folder |
| `db:check` times out | your IP is not allowed in Atlas *Network Access* |
| `bad auth` | wrong database username/password in `MONGODB_URI` |
| `mongodb+srv URI cannot have port number` | the connection string is incomplete (missing `@host`) |
| Chat says "busy" | Gemini rate limit, our rate limit, or the daily quota; wait and retry |
| Refund demo says "window expired" | seed data is older than 48 hours: `npm run seed -- --reset` |
| `test:live` refund tests fail | same cause as above |
