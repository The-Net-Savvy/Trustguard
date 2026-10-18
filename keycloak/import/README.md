# Keycloak realm import

`trust-guard-realm.json` is imported automatically when the Keycloak container starts
(`start-dev --import-realm`). An existing realm is never overwritten. To re-import after
editing the file, delete the `trust-guard` realm in the admin console and restart Keycloak.

No secrets are stored in the file. Keycloak substitutes these placeholders from the
container environment (set in `docker-compose.yml` from `.env`):

| Placeholder | Source in `.env` |
|---|---|
| `${TG_APP_URL}` | `APP_URL` |
| `${TG_KC_CLIENT_ID}` / `${TG_KC_CLIENT_SECRET}` | `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` |
| `${TG_KC_ADMIN_CLIENT_SECRET}` | `KEYCLOAK_ADMIN_CLIENT_SECRET` |
| `${TG_BACKCHANNEL_LOGOUT_URL}` | `KEYCLOAK_BACKCHANNEL_LOGOUT_URL` (defaults to `host.docker.internal`) |
| `${TG_SEED_ADMIN_PASSWORD}` / `${TG_SEED_EMPLOYEE_PASSWORD}` | `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD` |

Security-relevant settings in the realm:

- **Browser flow `trust-guard browser`**: SSO cookie, or username/password **and** OTP, both REQUIRED.
  The two steps carry authenticator configs with `default.reference.value` (`pwd`, `otp`) and
  `default.reference.maxAge`. Keycloak's AMR mapper only emits a method when these are set,
  and treats a missing max age as already expired.
- **TOTP policy**: SHA-1, 6 digits, 30 s (compatible with common authenticator apps); `CONFIGURE_TOTP` is a default action for new users.
- **Brute-force protection**: 5 failures, then a lockout that grows from 60 s up to 15 min.
- **Password policy**: at least 12 characters with upper case, lower case and a digit; not the username; no reuse of the last 3.
- **Tokens and sessions**: 5-minute access tokens, 30-minute SSO idle timeout, 8-hour maximum session.
- **Client `trust-guard-bff`**: confidential client, standard flow only, PKCE S256 required, no implicit flow or direct grants, back-channel logout with `sid`.
- **Client `trust-guard-admin-api`** (phase 4): service account only (client credentials). Its account holds just the
  `realm-management` roles `view-users` and `manage-users`. Trust Guard uses it to end SSO sessions and to disable
  or enable accounts. Realms imported before phase 4 get it from `npm run keycloak:upgrade`.
- **Mappers**: realm roles go to the `roles` claim; authentication methods go to `amr`.
- **Events**: login and admin events are enabled (30-day retention).

All other authentication flows are Keycloak 26.4's defaults. A realm import that lists only
some flows does not create the built-in ones.
