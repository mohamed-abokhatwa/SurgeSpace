-- SurgeSpace licensing. Only the licence function (service role) reads or writes these tables:
-- row level security is on and there are no policies, so the public API key cannot see them.
create table if not exists ss_licenses (
  id          text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  key_hash    text not null unique,            -- SHA-256 of the key; the key itself is never stored
  plan        text not null check (plan in ('pro', 'enterprise')),
  seats       int  not null default 2 check (seats between 1 and 1000),
  email       text not null,
  name        text,
  expires_at  timestamptz,                     -- null = perpetual
  status      text not null default 'active' check (status in ('active', 'revoked')),
  order_ref   text,                            -- payment provider order / invoice
  created_at  timestamptz not null default now()
);
create table if not exists ss_activations (
  license_id  text not null references ss_licenses(id) on delete cascade,
  device_id   text not null,
  device_name text not null default '',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (license_id, device_id)
);
create table if not exists ss_trials (
  id          text primary key,
  email       text not null,
  device_id   text not null,
  started_at  timestamptz not null default now()
);
create index if not exists ss_trials_email on ss_trials (email);
create index if not exists ss_trials_device on ss_trials (device_id);
alter table ss_licenses enable row level security;
alter table ss_activations enable row level security;
alter table ss_trials enable row level security;
