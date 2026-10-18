# Trust Guard: evaluation

This document evaluates the Trust Guard prototype against its aim: a Zero-Trust-inspired authentication
framework for securing remote access in Nigerian SMEs. It covers four questions:

1. **Conformance.** Does the design implement the Zero Trust tenets of NIST SP 800-207?
2. **Security.** Do the controls stop realistic attacks, and where do they not?
3. **Correctness.** Do the features behave as specified?
4. **Cost.** What latency and load do the Zero Trust checks add?

All numbers below come from scripts in this repository and can be reproduced (see the last section). The raw results
are in [`results/`](results/).

---

## 1. Method

| Question | Method | Artefact |
|---|---|---|
| Conformance | Map each NIST SP 800-207 tenet (section 2.1) to the mechanism that implements it, and to the evidence that exercises it | Section 2 |
| Security | 22 scripted attack scenarios against the running system. Each records the threat (STRIDE), the tenet, the control and the observed outcome: *mitigated*, *vulnerable* or *known limitation* | [`scripts/eval-security.ts`](../../scripts/eval-security.ts) → [`results/security.md`](results/security.md) |
| Correctness | Unit tests of the pure decision logic, plus end-to-end suites that drive the real Keycloak pages over HTTP | `tests/`, `scripts/e2e-*.ts` |
| Cost | Latency of protected vs unprotected requests on a production build, database transactions per request, cost of the decision logic in isolation | [`scripts/eval-performance.ts`](../../scripts/eval-performance.ts) → [`results/performance.md`](results/performance.md) |

Tests use temporary Keycloak users, created and deleted by the scripts. Time-dependent rules (session age, idle time,
posture age) are exercised by moving timestamps in the database, not by waiting.

---

## 2. Conformance with NIST SP 800-207

NIST SP 800-207 (*Zero Trust Architecture*, 2020) states seven tenets in section 2.1. The table summarises each
tenet in our own words and shows how Trust Guard addresses it. Scenario IDs (S01–S22) refer to section 3.

| # | Tenet (summary) | How Trust Guard implements it | Evidence |
|---|---|---|---|
| 1 | Every data source and service is a resource to protect | Every protected page and API route names a resource (`dashboard`, `admin.console`, `admin.manage`) and is checked by `requireAccess`. A resource without a policy is denied | Unit test *"denies resources without a policy"*; S07 |
| 2 | Communication is secured regardless of network location | Being on the company network grants nothing. Tokens never reach the browser (BFF pattern). Session ids are stored hashed and tokens encrypted (AES-256-GCM). **Transport encryption (HTTPS) is a deployment step and is not enabled in the local prototype** | S12, S19; limitation L4 |
| 3 | Access is granted per session | Opaque server-side sessions with a 30 min idle and 8 h absolute timeout, bound to one device, revocable by admins and by Keycloak (back-channel logout) | S16, S17, S20, S21, S22 |
| 4 | Access is decided by dynamic policy over identity, device and context | The risk engine scores device posture, new device, network change, business hours and failed sign-ins (0–100). Policies as code turn role + risk + sign-in age into allow, step-up or deny | S08–S10, S15; `npm test` |
| 5 | The integrity and posture of devices is monitored | Posture is collected after sign-in and re-reported every 4 min by a heartbeat. It is evaluated on every request, and a stale report is collected again. Admins can trust or block devices | S08, S09, S10, S20 |
| 6 | Authentication and authorisation are dynamic and enforced before access | Password + TOTP are both required by Keycloak and checked again by the app (`amr`). Every request is re-authorised. Medium risk and admin actions trigger step-up re-authentication. The IdP session is re-verified at each token refresh | S01, S02, S04, S06, S07, S11, S15, S18, S21 |
| 7 | Collect state information and use it to improve security | Append-only audit log of sign-ins, access decisions (with risk signals), posture changes, revocations and admin actions. It can be filtered and exported, and Keycloak login events are enabled | S13; admin console |

---

## 3. Security evaluation

**Result: 22 attack scenarios. 20 mitigated, 0 vulnerable, 2 known limitations.**
The full table with evidence is in [`results/security.md`](results/security.md).

| Area | Scenarios | Outcome |
|---|---|---|
| Identity: stolen password, OTP brute force | S01, S02 | Mitigated. Keycloak locked the account after 2 rapid wrong codes (quick-login detection) |
| Identity: attacker enrols their own authenticator on a **new** account | S03 | ⚠️ **Limitation L1** |
| Login flow integrity: forged state, code replay, open redirect, session fixation | S04, S06, S17, S18 | Mitigated |
| Request forgery and privilege escalation | S05, S07, S15 | Mitigated |
| Device posture: bot in session, forged report, non-compliant device, stolen cookie on another device | S08, S09, S10, S20 | Mitigated, and access returned automatically once the device was healthy |
| Data protection: database leak, tokens in the browser, audit tampering, forged logout | S11, S12, S13, S19 | Mitigated |
| Session lifecycle: idle session, revoked user via SSO, suspended user | S16, S21, S22 | Mitigated |
| Network: spoofed client IP | S14 | ⚠️ **Limitation L2** |

### Defects found and fixed during development

Testing found real defects before this evaluation. Each is fixed and covered by a regression test.

| Defect | Impact | Fix |
|---|---|---|
| Open redirect via `/<TAB>/evil.example` in `returnTo` | A phishing link could send users to an attacker's site straight after sign-in | Resolve against the app origin; same-origin only |
| Race between two concurrent first posture reports | A legitimate session was revoked as "stolen" | Device cookie issued at sign-in; atomic binding; client de-duplication |
| Back-channel logout rejected under clock skew | Ending a session in Keycloak did not end it in the app | 60 s clock tolerance on logout tokens |
| Keycloak AMR claim empty | MFA could not be verified by the app | Authenticator reference config with explicit max age |
| Malformed admin requests not audited | Tampering attempts left no trace | Audited as `admin.action` failures |

---

## 4. Correctness

| Suite | Scope | Result |
|---|---|---|
| `npm test` | Posture evaluation, risk scoring, policy decisions, admin input parsing, CSV escaping (pure functions) | 41 / 41 |
| `npm run test:e2e:auth` | Sign-in with TOTP enrolment, MFA enforcement, logout, refresh, back-channel logout, timeouts, open redirects | 33 / 33 |
| `npm run test:e2e:access` | Device verification, least privilege, posture changes, high risk, stale posture, stolen cookie, concurrent reports, step-up | 30 / 30 |
| `npm run test:e2e:admin` | Admin-only access, CSRF, self-protection, revocation in app + Keycloak, device trust/block, suspension, audit export | 47 / 47 |
| **Total** | | **151 checks, 0 failures** |

---

## 5. Performance

Full table: [`results/performance.md`](results/performance.md). Environment: Intel Core i7-6600U (2 cores / 4 threads,
2015), 16 GB RAM, Windows 10, with the app (production build), PostgreSQL and Keycloak all on the same machine.

| Measure | Result |
|---|---|
| Decision logic alone (posture + risk + policy) | **≈ 11 µs** per evaluation |
| Protected page vs unprotected page (median) | **+12 ms** (24 ms vs 12 ms); +22 ms at p95 |
| Database transactions per protected request | **3**: session, device and recent-failures lookups. Writes happen only when something changes |
| Admin console (two policy evaluations + admin queries) | 39 ms median, 7 transactions |
| Posture heartbeat (every 4 min per open tab) | 34 ms median |
| Request that triggers a token refresh (every 5 min per session) | +41 ms median, for one Keycloak round trip |
| Complete sign-in, scripted (excludes human time) | ≈ 1.0 s median (3 runs; the first, cold run took 2.8 s) |

**Interpretation.** The policy logic is negligible. The overhead per request comes almost entirely from three
database round trips. On localhost these take milliseconds. With a managed database (e.g. Supabase) each round
trip adds the network latency between the app server and the database, so the app server and database should run
in the same region. Everything users notice that is slower (the refresh, sign-in) happens once per several minutes
or once per session.

---

## 6. Limitations and threats to validity

**Known limitations of the prototype**

| ID | Limitation | Consequence | Mitigation (future work) |
|---|---|---|---|
| L1 | Trust on first use of the TOTP enrolment (S03) | Anyone holding a new user's initial password before the user signs in can register their own authenticator | Issue initial passwords as *temporary*, deliver them out of band, or use one-time enrolment links. Admin approval of first devices |
| L2 | Client IP is taken from `X-Forwarded-For` (S14) | `NETWORK_CHANGED` / `OFF_NETWORK` signals can be evaded or faked | Deploy behind a reverse proxy that overwrites the header; trust it only from that proxy |
| L3 | Browser-observable posture only | Disk encryption, antivirus, OS patch level and screen lock are not visible to a web page | Device agent or MDM integration (e.g. via an attestation API) |
| L4 | Local prototype runs over HTTP; Keycloak in development mode | Not deployable as-is | HTTPS reverse proxy, Keycloak production mode, verify the database CA, CSP/HSTS, rate limiting |
| L5 | Audit log is append-only at application level | A database owner can disable the trigger | Ship audit events to write-once external storage or a SIEM |
| L6 | Risk weights and thresholds are expert-chosen | Scores are plausible but not calibrated on real incidents | Calibrate with data from a pilot; consider per-organisation tuning |

**Threats to validity**

- **Synthetic attacks.** The scenarios are scripted by the author. They show that specific controls work, not that
  the system resists an expert adversary. An independent penetration test would strengthen the claim.
- **Single machine, loopback network.** Latencies exclude real network conditions in Nigeria (mobile data,
  variable bandwidth), and Docker on WSL2 adds its own overhead. Absolute numbers will differ in deployment, but
  the relative overhead and the transactions per request carry over.
- **Small samples for sign-in.** Only 3 runs, because each needs a fresh 30-second one-time-code window.
- **No user study.** Usability and acceptance by SME staff (e.g. the second sign-in after enrolment, step-up
  prompts) have not been evaluated with real users.

---

## 7. Reproducing the results

With the stack running (`npm run infra:up:local-db`) and a **production** build of the app:

```bash
npm run build
npm start                    # in a second terminal
npm run eval:security        # writes results/security.{json,md}
npm run eval:performance     # writes results/performance.{json,md}; EVAL_N=500 for more samples
npm test                     # unit tests
npm run test:e2e:auth && npm run test:e2e:access && npm run test:e2e:admin
```

The scripts create temporary Keycloak users and delete them afterwards. Their rows stay in the app database
because the audit log is append-only. Make sure the PC clock is synchronised, because one-time codes depend on it.
