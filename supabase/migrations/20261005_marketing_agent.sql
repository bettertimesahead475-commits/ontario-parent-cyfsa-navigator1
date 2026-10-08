-- ---------------------------------------------------------------------------
-- Marketing Agent schema
--
-- This is the FIRST migration file committed to this repo. Every pre-existing
-- table in the live Supabase project (payments, access_codes, free_usage,
-- free_tool_usage, gmail_processed_messages, stale_payment_alerts) was created
-- by hand in the dashboard and has no migration on record. These marketing
-- tables establish the migrations/ convention going forward: the SQL that
-- defines them lives in version control, reviewable alongside the code that
-- uses it (api/services/marketing/*).
--
-- All five tables are ADMIN-ONLY. They hold no parent/user data and are never
-- read from the browser directly — only the server (via the Supabase
-- service-role key, which bypasses RLS) ever touches them. RLS is therefore
-- enabled with NO policies, which denies anon and authenticated roles entirely
-- while leaving the service role full access. Do not add a permissive policy
-- here without a deliberate reason: these rows drive what gets published to the
-- organization's public social accounts.
--
-- IMPORTANT: no social-platform secret is ever stored in any of these tables.
-- Access tokens / client secrets live only in environment variables
-- (see .env.example and docs/MARKETING_AGENT.md). marketing_channels records
-- only whether the required env is PRESENT, never its value.
-- ---------------------------------------------------------------------------

-- Generic updated_at trigger (scoped names so it never collides with an
-- existing project function if one is added later).
create or replace function marketing_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$ language plpgsql
set search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- marketing_channels — one row per social platform, tracking connection state.
-- The status column is the honest source of truth surfaced in the admin UI:
--   'connected'                    — credentials present AND validated
--   'waiting_for_credentials'      — required env vars not yet set
--   'waiting_for_platform_approval'— credentials present but the platform app
--                                    still needs review/permissions granted
--   'error'                        — credentials present but a live check failed
--   'disconnected'                 — explicitly turned off by an admin
-- ---------------------------------------------------------------------------
create table if not exists marketing_channels (
  platform            text primary key
                      check (platform in ('facebook','instagram','linkedin','x','tiktok')),
  status              text not null default 'waiting_for_credentials'
                      check (status in ('connected','waiting_for_credentials','waiting_for_platform_approval','error','disconnected')),
  account_name        text,
  account_id          text,
  scopes              text[],
  credentials_present boolean not null default false,
  detail              text,
  missing_env         text[],
  last_error          text,
  connected_at        timestamptz,
  last_checked_at     timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);

drop trigger if exists marketing_channels_set_updated_at on marketing_channels;
create trigger marketing_channels_set_updated_at
  before update on marketing_channels
  for each row execute function marketing_set_updated_at();

-- ---------------------------------------------------------------------------
-- marketing_campaigns — optional grouping/theme for a batch of posts.
-- ---------------------------------------------------------------------------
create table if not exists marketing_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  objective   text,
  theme       text,
  status      text not null default 'active'
              check (status in ('active','paused','archived')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists marketing_campaigns_set_updated_at on marketing_campaigns;
create trigger marketing_campaigns_set_updated_at
  before update on marketing_campaigns
  for each row execute function marketing_set_updated_at();

-- ---------------------------------------------------------------------------
-- marketing_posts — the content pipeline. One row = one post for one platform.
-- status is a strict lifecycle enforced in code (see store.ts STATUS_FLOW):
--   draft -> pending_approval -> approved -> scheduled -> publishing
--         -> published | failed
--   (pending_approval -> rejected; anything pre-publish -> canceled)
-- A human MUST approve before anything can be scheduled or published. The
-- scheduler never publishes a post that is not status='scheduled' with a
-- scheduled_for in the past.
-- ---------------------------------------------------------------------------
create table if not exists marketing_posts (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid references marketing_campaigns(id) on delete set null,
  platform           text not null
                     check (platform in ('facebook','instagram','linkedin','x','tiktok')),
  status             text not null default 'draft'
                     check (status in ('draft','pending_approval','approved','scheduled','publishing','published','failed','rejected','canceled')),
  content            text not null,
  media_url          text,
  link_url           text,
  hashtags           text[],
  ai_generated       boolean not null default false,
  ai_model           text,
  generation_context jsonb,
  scheduled_for      timestamptz,
  published_at       timestamptz,
  external_post_id   text,
  external_url       text,
  created_by         text,
  approved_by        text,
  approved_at        timestamptz,
  rejection_reason   text,
  last_error         text,
  metrics            jsonb not null default '{}'::jsonb,
  metrics_updated_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists marketing_posts_status_idx        on marketing_posts (status);
create index if not exists marketing_posts_scheduled_for_idx on marketing_posts (scheduled_for);
create index if not exists marketing_posts_platform_idx      on marketing_posts (platform);
create index if not exists marketing_posts_campaign_idx      on marketing_posts (campaign_id);
-- The scheduler's hot query: "scheduled posts whose time has come."
create index if not exists marketing_posts_due_idx
  on marketing_posts (scheduled_for)
  where status = 'scheduled';

drop trigger if exists marketing_posts_set_updated_at on marketing_posts;
create trigger marketing_posts_set_updated_at
  before update on marketing_posts
  for each row execute function marketing_set_updated_at();

-- ---------------------------------------------------------------------------
-- marketing_analytics — append-only time-series of metric snapshots per post.
-- The latest snapshot is also denormalized onto marketing_posts.metrics for
-- quick display; this table keeps the history so trends are recoverable.
-- ---------------------------------------------------------------------------
create table if not exists marketing_analytics (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references marketing_posts(id) on delete cascade,
  platform    text not null,
  captured_at timestamptz not null default now(),
  impressions integer,
  reach       integer,
  likes       integer,
  comments    integer,
  shares      integer,
  clicks      integer,
  raw         jsonb
);

create index if not exists marketing_analytics_post_idx on marketing_analytics (post_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- marketing_agent_log — audit trail of every meaningful agent action. This is
-- how the system stays HONEST: a 'waiting' or 'error' status is recorded here
-- rather than swallowed, so the admin UI and logs always reflect what actually
-- happened (never a fabricated success).
-- ---------------------------------------------------------------------------
create table if not exists marketing_agent_log (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  status     text not null
             check (status in ('success','error','skipped','waiting','info')),
  post_id    uuid references marketing_posts(id) on delete set null,
  platform   text,
  detail     text,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_agent_log_created_idx on marketing_agent_log (created_at desc);
create index if not exists marketing_agent_log_post_idx    on marketing_agent_log (post_id);

-- ---------------------------------------------------------------------------
-- RLS: enable on all five, add no policies -> service role only.
-- ---------------------------------------------------------------------------
alter table marketing_channels   enable row level security;
alter table marketing_campaigns  enable row level security;
alter table marketing_posts      enable row level security;
alter table marketing_analytics  enable row level security;
alter table marketing_agent_log  enable row level security;

-- Seed the five channel rows so the admin UI has something to show immediately.
-- All start as waiting_for_credentials — the true state until env vars are set.
insert into marketing_channels (platform, status, credentials_present)
values
  ('facebook',  'waiting_for_credentials', false),
  ('instagram', 'waiting_for_credentials', false),
  ('linkedin',  'waiting_for_credentials', false),
  ('x',         'waiting_for_credentials', false),
  ('tiktok',    'waiting_for_credentials', false)
on conflict (platform) do nothing;
