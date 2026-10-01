# Keycloak realm import

Any `*.json` realm export placed in this folder is imported automatically when the
Keycloak container starts (`start-dev --import-realm`). Existing realms are not overwritten.

The `trust-guard` realm (clients, roles, MFA flows) is added in the authentication phase.
After that, set `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` in `.env`.
No application code needs to change.
