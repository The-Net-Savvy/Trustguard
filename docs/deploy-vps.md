# Deploying Trust Guard to a VPS

The whole stack runs on one Linux server with Docker Compose
([`docker-compose.prod.yml`](../docker-compose.prod.yml)):

| Container | Role | Exposed |
|---|---|---|
| `caddy` | HTTPS reverse proxy, automatic Let's Encrypt certificates | ports 80, 443 |
| `app` | Trust Guard (Next.js standalone server) | via Caddy at `APP_HOST` |
| `keycloak` + `keycloak-db` | Identity provider (production mode) | via Caddy at `AUTH_HOST` |
| `app-db` | Application PostgreSQL (or use Supabase instead) | internal only |
| `migrate` | Applies SQL migrations on each start, then exits | none |

No domain is needed: [sslip.io](https://sslip.io) gives every IP address free
hostnames, e.g. `app.203-0-113-10.sslip.io` resolves to `203.0.113.10`, and
Let's Encrypt issues certificates for them.

## 1. Get a server

Any Linux VPS with a public IPv4 address works. Ubuntu 24.04 is assumed below.

- **Size:** 2 vCPU and **4 GB RAM** recommended (Keycloak alone uses about 1 GB);
  2 GB works with a swap file. About 10 GB of disk.
- **Options:** Hetzner Cloud CX22 (about €4/month), DigitalOcean or Vultr
  (about $12–24/month), or Oracle Cloud's Always Free Ampere A1 (ARM; all images
  used here support ARM).
- Open inbound ports **22, 80 and 443** in the provider's firewall.

## 2. Install Docker

```bash
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 3. Get the code and create `.env`

```bash
git clone https://github.com/The-Net-Savvy/Trustguard.git trust-guard
cd trust-guard
# Generates .env with fresh random secrets (runs the setup script in a Node container).
docker run --rm -v "$PWD":/w -w /w node:24-alpine node scripts/setup-env.mjs
```

Add the two public hostnames, with the server's IP written with dashes:

```bash
IP=$(curl -4 -s https://ifconfig.me | tr . -)
printf 'APP_HOST=app.%s.sslip.io\nAUTH_HOST=auth.%s.sslip.io\n' "$IP" "$IP" >> .env
grep _HOST .env
```

The compose file derives `APP_URL`, `KEYCLOAK_ISSUER` and `DATABASE_URL` from
these, so the localhost values elsewhere in `.env` can stay as they are.

> Using your own domain later: point two DNS A records at the server and set
> `APP_HOST` / `AUTH_HOST` to them instead.

## 4. Start the stack

```bash
docker compose -f docker-compose.prod.yml --profile local-db up -d --build
docker compose -f docker-compose.prod.yml ps
```

The first start takes a few minutes: images are built, Keycloak imports the
`trust-guard` realm, `migrate` creates the schema, and Caddy fetches
certificates. Then open:

- **App:** `https://<APP_HOST>`. The status page should show all three components *Healthy*.
- **Sign in** as `tg.admin` or `tg.employee`; passwords are `SEED_ADMIN_PASSWORD`
  / `SEED_EMPLOYEE_PASSWORD` in `.env` (`grep SEED_ .env`). Each enrols an
  authenticator app at first sign-in.
- **Keycloak admin console:** `https://<AUTH_HOST>/admin` (`KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`).

Logs: `docker compose -f docker-compose.prod.yml logs -f app keycloak caddy`.

## Updating

```bash
cd trust-guard
git pull
docker compose -f docker-compose.prod.yml --profile local-db up -d --build
```

New migrations are applied automatically before the app restarts.

## Things to know

- **The realm is imported only on the first start.** If `APP_HOST` changes
  later, update the `trust-guard-bff` client's redirect URIs, web origins and
  back-channel logout URL in the Keycloak admin console (or, on a fresh
  install with no data to keep, run `down -v` and start again).
- **Keep `.env` private.** It holds every secret; it is git-ignored and should
  stay only on the server (`chmod 600 .env`).
- **Demo accounts are public-facing.** The seed passwords are random, but
  consider disabling `tg.employee` in Keycloak if the site is shared widely.
- **Trusted networks:** Caddy replaces any client-sent `X-Forwarded-For`, so
  `TRUSTED_NETWORKS` (OFF_NETWORK risk signal) is reliable behind it. For the
  same reason, if you point `npm run test:e2e:access` at the deployed site, its
  "IP change … simulated via X-Forwarded-For" check fails: the forged header
  never reaches the app. All other checks pass.
- **Business hours:** the OFF_HOURS risk signal uses `BUSINESS_TIMEZONE` /
  `BUSINESS_HOURS`; adjust them for when people will try the demo.
- **Backups:**
  `docker compose -f docker-compose.prod.yml exec app-db pg_dump -U trustguard trustguard > trustguard.sql`
  (and the same for `keycloak-db` with user and database `keycloak`).
- **Supabase instead of `app-db`:** set `PROD_DATABASE_URL` to the Supabase
  connection string and `DATABASE_SSL=true` in `.env`, then start without
  `--profile local-db`.
- **Stop:** `docker compose -f docker-compose.prod.yml down` (data volumes are kept).
