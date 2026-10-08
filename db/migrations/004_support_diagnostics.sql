-- Private, short-lived opt-in support reports. No browser role receives access.
begin;
create schema treino_support;
create table treino_support.diagnostic_reports (
  id uuid primary key,
  report_code text not null unique check (report_code ~ '^TL-[A-Z2-9]{8}$'),
  user_id uuid not null references treino_social.users(id) on delete cascade,
  debug_report_version integer not null check (debug_report_version = 1),
  build_id text,
  report jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index diagnostic_reports_user_created on treino_support.diagnostic_reports(user_id, created_at desc);
create index diagnostic_reports_expires on treino_support.diagnostic_reports(expires_at);
revoke all on schema treino_support from public, anon, authenticated;
revoke all on all tables in schema treino_support from public, anon, authenticated;
insert into treino_social.schema_migrations(version) values ('004_support_diagnostics');
commit;
