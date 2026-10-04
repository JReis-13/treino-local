-- Private, server-only social data. Never add treino_social to Supabase Exposed schemas.
begin;
create schema if not exists treino_social;
revoke all on schema treino_social from public, anon, authenticated;

create table if not exists treino_social.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
create table if not exists treino_social.users (
  id uuid primary key,
  google_sub text not null unique,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 50),
  sharing_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists treino_social.friendships (
  id uuid primary key,
  requester_user_id uuid not null references treino_social.users(id) on delete cascade,
  addressee_user_id uuid not null references treino_social.users(id) on delete cascade,
  status text not null check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_user_id <> addressee_user_id)
);
create unique index if not exists friendships_pair_unique on treino_social.friendships
  (least(requester_user_id, addressee_user_id), greatest(requester_user_id, addressee_user_id));
create index if not exists friendships_addressee_status on treino_social.friendships(addressee_user_id,status);
create index if not exists friendships_requester_status on treino_social.friendships(requester_user_id,status);

create table if not exists treino_social.workout_activities (
  id uuid primary key,
  user_id uuid not null references treino_social.users(id) on delete cascade,
  client_session_id text not null check (char_length(client_session_id) between 1 and 100),
  workout_name text not null check (char_length(workout_name) between 1 and 120),
  completed_at timestamptz not null,
  local_date date not null,
  duration_minutes integer check (duration_minutes between 0 and 1440),
  completed_exercises integer check (completed_exercises between 0 and 500),
  total_exercises integer check (total_exercises between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_session_id),
  check (completed_exercises is null or total_exercises is null or completed_exercises <= total_exercises)
);
create index if not exists activities_latest on treino_social.workout_activities(user_id,completed_at desc);

create table if not exists treino_social.activity_reactions (
  id uuid primary key,
  activity_id uuid not null references treino_social.workout_activities(id) on delete cascade,
  user_id uuid not null references treino_social.users(id) on delete cascade,
  emoji text not null check (emoji in ('💪','🔥','👏','😂','❤️')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id,user_id)
);
create index if not exists reactions_activity on treino_social.activity_reactions(activity_id);

revoke all on all tables in schema treino_social from public, anon, authenticated;
insert into treino_social.schema_migrations(version) values ('001_social_v1') on conflict do nothing;
commit;
