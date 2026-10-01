# Trust Guard

**A Zero-Trust-Inspired Authentication Framework for Securing Remote Access in Nigerian Small and Medium Enterprises (SMEs)**: Master's research prototype.

> Status: **Phase 1, Project foundation.** Authentication is not implemented yet.

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

## Folder structure

```
src/
├── app/                      # UI routes + API route handlers (Next.js App Router)
│   ├── page.tsx              #   Landing / system status page
│   └── api/health/route.ts   #   GET /api/health: DB + Keycloak health (JSON)
├── components/               # UI components (client-safe, no secrets)
├── config/env.ts             # Validated server-side environment (zod, server-only)
└── server/                   # BFF / server-only logic
    ├── auth/                 #   Keycloak OIDC configuration boundary
    ├── session/              #   Session management & continuous verification
    ├── device-posture/       #   Device posture validation
    ├── risk-engine/          #   Risk scoring
    ├── policy-engine/        #   Access control / least-privilege decisions
    ├── audit/                #   Audit logging
    ├── admin/                #   Administrative controls
    ├── db/                   #   PostgreSQL pool + query helper
    └── health/               #   Infrastructure health checks
db/migrations/                # Numbered SQL migrations (applied by scripts/db-migrate.ts)
keycloak/import/              # Realm JSON auto-imported by Keycloak on start
scripts/                      # Dev tooling (migration runner)
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
| `npm run infra:up` | Start Keycloak (+ its DB) |
| `npm run infra:up:local-db` | Also start the local Postgres stand-in |
| `npm run infra:down` | Stop all containers (data volumes are kept) |
