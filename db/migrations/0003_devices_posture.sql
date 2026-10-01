-- Trust Guard: device posture, risk and access decisions
--
-- devices:  browsers/devices a user has signed in from. Identified by a random,
--           app-issued cookie (stored hashed). Not a hardware fingerprint.
-- sessions: bound to one device; carry the latest posture report and the last
--           access decision per resource (used to avoid flooding the audit log).

create table trustguard.devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references trustguard.users(id),
  cookie_hash        bytea not null,
  status             text not null default 'registered'
                       check (status in ('registered', 'trusted', 'blocked')),
  label              text,            -- e.g. "Chrome 141 on Windows 10"
  first_session_id   uuid,            -- the session in which the device was first seen
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_ip            inet,
  last_posture       jsonb,
  unique (user_id, cookie_hash)
);

create index devices_user_idx on trustguard.devices (user_id);

alter table trustguard.sessions
  add column device_id   uuid references trustguard.devices(id),
  add column posture     jsonb,
  add column posture_at  timestamptz,
  add column last_access jsonb not null default '{}';
