# Trust Guard

**A Zero-Trust-Inspired Authentication Framework for Securing Remote Access in Nigerian Small and Medium Enterprises (SMEs)**: Master's research prototype.

> Status: **Phase 3, Device posture, risk and least privilege.** On top of authentication (OIDC + mandatory
> TOTP, server-side sessions, back-channel logout, audit log), every protected request is now evaluated against
> device posture, a risk score and a least-privilege policy. Administrative controls follow.

## Architecture

```
 Browser (UI)  ──HTTPS──▶  Next.js app = UI + BFF (server-only logic)  ──OIDC──▶  Keycloak (IdP, MFA)
                               │                                                     │
                               │ pg (server-side pool)                               └─ own Postgres (keycloak-db)
                               ▼
                     Supabase PostgreSQL  (schema: trustguard)
```

| Concern | Technology | Role |
|---|---|---|
| Identity provider, MFA | **Keycloak 26** | Users, roles, OIDC login, OTP/WebAuthn |
| UI + BFF | **Next.js 16 (App Router), TypeScript** | Pages, route handlers, all security decisions server-side |
| Persistence | **Supabase PostgreSQL** | Plain Postgres only. Supabase Auth / Data API are **not** used |
| Local infra | **Docker Compose** | Keycloak, its DB, optional local Postgres, optional app image |

Design rules:
- Tokens never reach the browser (BFF pattern); the browser gets an HttpOnly session cookie only.
- All app tables live in the `trustguard` schema, which is outside Supabase's auto-exposed `public` API.
- All secrets come from environment variables. Only `.env.example` is committed.

## Authentication

| Step | What happens |
|---|---|
| 1. `GET /api/auth/login` | BFF creates state, nonce and a PKCE (S256) verifier, keeps them in a 10-minute encrypted HttpOnly cookie and redirects to Keycloak |
| 2. Keycloak | Realm flow `trust-guard browser`: password **and** TOTP are both REQUIRED. Brute-force lockout after 5 failures. First login forces authenticator enrolment |
| 3. `GET /api/auth/callback` | Validates state, nonce, PKCE and the ID token, then requires `amr` to contain a second factor (`AUTH_REQUIRE_MFA`). Provisions the user (`trustguard.users`) and creates a session |
| 4. Session | The browser gets only an opaque `tg_session` cookie (HttpOnly, SameSite=Lax). The DB stores its SHA-256 hash and the Keycloak tokens, encrypted with AES-256-GCM |
| 5. Every request | `requireSession()` checks status, idle timeout (30 min), absolute lifetime (8 h), and refreshes the access token with Keycloak when it expires, which re-verifies the IdP session. A Keycloak refusal revokes the app session |
| 6. Logout | `POST /api/auth/logout` (same-origin only) revokes the session and ends the Keycloak SSO session (RP-initiated logout) |
| 7. Back-channel logout | When an admin ends a session in Keycloak, or the user logs out elsewhere, Keycloak calls `POST /api/auth/backchannel-logout` and the app session is revoked at once |

Logins, logouts, failures, expiries and revocations are written to the append-only `trustguard.audit_events` table.

**Why a second sign-in after enrolment:** Keycloak verifies the enrolment code in a required action, not in the
OTP login step, so the first login reports `amr=["pwd"]`. The app does not trust it. The user is asked to sign in once
more (`prompt=login`) with a code from the new authenticator, which yields `amr=["pwd","otp"]`.

### Demo users

The realm import (`keycloak/import/trust-guard-realm.json`) creates:

| Username | Role | Password |
|---|---|---|
| `tg.admin` | `tg-admin` (includes `tg-employee`) | `SEED_ADMIN_PASSWORD` in `.env` |
| `tg.employee` | `tg-employee` | `SEED_EMPLOYEE_PASSWORD` in `.env` |

At first sign-in each must scan a QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…).

## Device posture, risk and policy (phase 3)

Every protected page calls `requireAccess(resource)` ([require-access.ts](src/server/access/require-access.ts)).
Each request is evaluated in six steps:

1. **Session** is valid (status, timeouts, IdP re-verification), as in phase 2.
2. **Device binding.** At sign-in the browser gets a random `tg_device` cookie (stored hashed). The first posture
   report binds the session to that device, atomically. A session cookie presented from any other device is
   treated as stolen: the session is revoked and the event is audited.
3. **Device posture.** After sign-in, `/verify-device` collects what a browser can observe: browser and version
   (UA Client Hints), OS and version, secure context, automation (`navigator.webdriver`) and User-Agent consistency.
   A heartbeat re-reports every 4 minutes and whenever the tab becomes visible again. A report older than
   `POSTURE_MAX_AGE_MINUTES` is collected again before access continues.
4. **Risk score** (0–100, additive; [assess.ts](src/server/risk-engine/assess.ts)):

   | Signal | Weight | | Signal | Weight |
   |---|---|---|---|---|
   | Automation detected | 70 | | New device (first session) | 20 |
   | No secure context | 40 | | Repeated failed sign-ins (≥3/h) | 20 |
   | Posture contradicts request (UA) | 40 | | Unsupported OS (e.g. Windows 10) or browser | 15 |
   | Outdated browser | 20 | | IP changed since sign-in | 15 |
   | | | | Off company network / outside business hours | 10 each |

   Low is below 30, medium is 30–59, high is 60 and above.
5. **Policy decision** ([policies.ts](src/server/policy-engine/policies.ts), deny by default):

   | Resource | Roles | Allow up to | Step-up | Always deny |
   |---|---|---|---|---|
   | `dashboard` | `tg-employee` | medium | none (high: deny) | automation, UA mismatch |
   | `admin.console` | `tg-admin` | low | medium, unless signed in < 10 min ago; also any sign-in > 60 min old | automation, UA mismatch, insecure context |

   **Step-up** sends the user to sign in again (password + new code, `prompt=login`). The new session satisfies the policy.
6. **Audit.** Every step-up and deny is recorded, and an allow is recorded whenever the risk level changes.
   Posture results are audited when they change. `/admin` shows the log.

**Limits of browser-based posture.** A web page cannot see disk encryption, antivirus, screen lock or patch
level. These need an installed agent or MDM, which is out of scope for this prototype. IP-based signals
(`NETWORK_CHANGED`, `OFF_NETWORK`) are only trustworthy behind a reverse proxy that overwrites
`X-Forwarded-For`. Next.js otherwise passes a client-supplied value through unchanged. Device binding does not
depend on IP.

### Tests

| Command | What it covers | Expected |
|---|---|---|
| `npm test` | Unit tests for posture evaluation, risk scoring and policy decisions (pure functions) | 31 passing |
| `npm run test:e2e:auth` | Phase 2: login, MFA, logout, refresh, back-channel logout, timeouts, open redirects | 33 passed |
| `npm run test:e2e:access` | Phase 3: device verification, least privilege, posture changes, high risk, stale posture, stolen cookie, concurrent reports, admin step-up | 30 passed |

The e2e tests need the stack and `npm run dev` running. They create temporary Keycloak users and delete them afterwards.

## Folder structure

```
src/
├── app/                      # UI routes + API route handlers (Next.js App Router)
│   ├── page.tsx              #   Landing / system status page
│   ├── login/, dashboard/    #   Sign-in page, protected dashboard
│   ├── verify-device/        #   Device posture collection after sign-in
│   ├── admin/, access-denied/ #  Admin console (audit view), explained denials
│   └── api/
│       ├── health/           #   GET /api/health: DB + Keycloak health (JSON)
│       ├── auth/             #   login, callback, logout, backchannel-logout
│       └── device/posture/   #   POST: browser posture reports (binding + heartbeat)
├── proxy.ts                  # Optimistic route guard (cookie presence) + forwards request path
├── components/               # UI components (client-safe, no secrets)
├── config/env.ts             # Validated server-side environment (zod, server-only)
└── server/                   # BFF / server-only logic
    ├── auth/                 #   Keycloak OIDC client, login flow, back-channel token validation
    ├── session/              #   Encrypted server-side sessions, requireSession(), timeouts, refresh
    ├── access/               #   requireAccess(): the policy enforcement point
    ├── device-posture/       #   Posture evaluation (pure) + device registry
    ├── risk-engine/          #   Risk scoring and context helpers (pure)
    ├── policy-engine/        #   Policies as code + decision point (pure)
    ├── audit/                #   Audit logging
    ├── admin/                #   Administrative controls
    ├── db/                   #   PostgreSQL pool + query helper
    └── health/               #   Infrastructure health checks
db/migrations/                # Numbered SQL migrations (applied by scripts/db-migrate.ts)
keycloak/import/              # Realm JSON auto-imported by Keycloak on start
scripts/                      # Migration runner, end-to-end tests (scripts/lib/e2e.ts helpers)
tests/                        # Unit tests (node:test via tsx)
docker-compose.yml, Dockerfile
```

## Getting started

Prerequisites: Node.js 20+ and Docker Desktop.

```bash
cp .env.example .env              # then fill in the secrets (see comments in the file)
npm install
npm run infra:up:local-db         # Keycloak + local Postgres stand-in
npm run db:migrate                # creates the trustguard schema
npm run dev                       # http://localhost:3000
```

- App: http://localhost:3000 (status page), http://localhost:3000/api/health
- Keycloak admin console: http://localhost:8080 (credentials from `.env`)

### Using a real Supabase project instead of the local stand-in

Set `DATABASE_URL` to the Supabase connection string (Dashboard → Connect → Session pooler),
set `DATABASE_SSL=true`, run `npm run db:migrate`, and start infra with `npm run infra:up` (no `local-db` profile).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` / `lint` | Static checks |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm test` | Unit tests (posture, risk, policy) |
| `npm run test:e2e:auth` | End-to-end authentication test against the running stack |
| `npm run test:e2e:access` | End-to-end device/risk/policy test against the running stack |
| `npm run infra:up` | Start Keycloak (+ its DB) |
| `npm run infra:up:local-db` | Also start the local Postgres stand-in |
| `npm run infra:down` | Stop all containers (data volumes are kept) |

## Troubleshooting

**"Invalid authenticator code" although the code is right.** The one-time codes depend on the phone and
the server agreeing on the time. Keycloak's container uses the PC's clock, and Keycloak accepts at most
one 30-second window of drift. A PC clock that is a minute or more off (common after sleep) rejects every
code. Fix: Windows **Settings → Time & language → Date & time → Sync now** (with *Set time
automatically* on). If Keycloak still disagrees, restart Docker Desktop. To compare the clocks:

```bash
date -u +%T; docker exec trust-guard-keycloak-1 date -u +%T
```

**The setup page shows a new QR code.** Each new enrolment attempt creates a new secret. Delete the old
"Trust Guard" entry in the authenticator app and scan the new code.

**"Device name" on the authenticator setup page.** This is a free-text label for the phone (e.g. `My phone`).
It is optional, and admins see it under the user's *Credentials* tab in Keycloak.

**Codes fail after re-importing the realm.** Deleting and re-importing the `trust-guard` realm removes
enrolled authenticators. Delete the old entry in the app and enrol again.
