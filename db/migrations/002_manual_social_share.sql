-- A one-session manual share stays visible when automatic sharing is disabled.
-- Additive: existing activities and reactions keep their IDs and visibility rules.
begin;
alter table treino_social.workout_activities
  add column if not exists manual_shared boolean not null default false;
insert into treino_social.schema_migrations(version) values ('002_manual_social_share') on conflict do nothing;
commit;
