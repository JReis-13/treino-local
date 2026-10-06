-- Server-only Web Push transport and per-account preferences.
begin;
create table treino_social.push_preferences (
  user_id uuid primary key references treino_social.users(id) on delete cascade,
  friend_workouts boolean not null default true,
  reactions boolean not null default true,
  updated_at timestamptz not null default now()
);
create table treino_social.push_subscriptions (
  id uuid primary key,
  user_id uuid not null references treino_social.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh text not null check (char_length(p256dh) between 40 and 256),
  auth text not null check (char_length(auth) between 16 and 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0
);
create index push_subscriptions_user on treino_social.push_subscriptions(user_id);
create table treino_social.push_deliveries (
  event_key text not null check (char_length(event_key) between 10 and 120),
  subscription_id uuid not null references treino_social.push_subscriptions(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','expired','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, subscription_id)
);
revoke all on all tables in schema treino_social from public, anon, authenticated;
insert into treino_social.schema_migrations(version) values ('003_friends_push');
commit;
