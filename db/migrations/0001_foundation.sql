-- Trust Guard: foundation migration
--
-- Creates a dedicated schema for all Trust Guard data. Using a schema other than
-- `public` keeps these tables out of Supabase's auto-generated Data API
-- (PostgREST), so data can only be reached through the Next.js BFF.
--
-- Domain tables (users, devices, sessions, policies, risk events, audit log)
-- are added in later phases as separate numbered migrations.

create schema if not exists trustguard;

comment on schema trustguard is
  'Trust Guard: Zero-Trust-inspired authentication framework (application data)';
