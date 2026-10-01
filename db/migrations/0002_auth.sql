-- Trust Guard: authentication phase
--
-- users:        local projection of Keycloak identities (Keycloak stays the source of truth)
-- sessions:     server-side BFF sessions; the browser only holds an opaque session id
-- audit_events: append-only security event log

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users (provisioned just-in-time on first successful login)
-- ---------------------------------------------------------------------------
create table trustguard.users (
  id             uuid primary key default gen_random_uuid(),
  keycloak_sub   text not null unique,
  username       text not null,
  email          text,
  display_name   text,
  roles          text[] not null default '{}',
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Sessions
--
-- `id_hash` is the SHA-256 of the random session id held in the cookie, so a
-- database leak does not expose usable session cookies. Keycloak tokens are
-- stored encrypted (AES-256-GCM, key derived from SESSION_SECRET) and never
-- leave the server.
-- ---------------------------------------------------------------------------
create table trustguard.sessions (
  id                     uuid primary key default gen_random_uuid(),
  id_hash                bytea not null unique,
  user_id                uuid not null references trustguard.users(id),
  status                 text not null default 'active'
                           check (status in ('active', 'revoked', 'expired')),
  -- Keycloak session id (`sid` claim), used for back-channel logout.
  idp_session_id         text,
  auth_methods           text[] not null default '{}',   -- `amr` claim, e.g. {pwd,otp}
  tokens_encrypted       text not null,
  access_expires_at      timestamptz not null,
  ip_address             inet,
  user_agent             text,
  created_at             timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  last_verified_at       timestamptz not null default now(),
  absolute_expires_at    timestamptz not null,
  revoked_at             timestamptz,
  revoked_reason         text
);

create index sessions_user_id_idx on trustguard.sessions (user_id);
create index sessions_idp_session_idx on trustguard.sessions (idp_session_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Audit log (append-only). Rows are never updated or deleted, so users and
-- sessions referenced by audit history cannot be hard-deleted either.
-- ---------------------------------------------------------------------------
create table trustguard.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  event_type     text not null,
  outcome        text not null check (outcome in ('success', 'failure', 'allow', 'step_up', 'deny')),
  actor_user_id  uuid references trustguard.users(id),
  session_id     uuid references trustguard.sessions(id),
  ip_address     inet,
  user_agent     text,
  resource       text,
  metadata       jsonb not null default '{}'
);

create index audit_events_occurred_at_idx on trustguard.audit_events (occurred_at desc);
create index audit_events_actor_idx on trustguard.audit_events (actor_user_id, occurred_at desc);

create function trustguard.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on trustguard.audit_events
  for each row execute function trustguard.audit_events_immutable();
