-- Trust Guard: administrative controls
--
-- Records who changed what, so every administrative decision is attributable.
-- Keycloak stays the source of truth for whether an account is enabled; the app
-- mirrors suspensions so they can be listed and audited.

alter table trustguard.users
  add column suspended_at  timestamptz,
  add column suspended_by  uuid references trustguard.users(id);

alter table trustguard.devices
  add column status_changed_at  timestamptz,
  add column status_changed_by  uuid references trustguard.users(id),
  add column status_reason      text;

alter table trustguard.sessions
  add column revoked_by  uuid references trustguard.users(id);

create index audit_events_type_idx on trustguard.audit_events (event_type, occurred_at desc);
create index sessions_active_idx on trustguard.sessions (status) where status = 'active';
