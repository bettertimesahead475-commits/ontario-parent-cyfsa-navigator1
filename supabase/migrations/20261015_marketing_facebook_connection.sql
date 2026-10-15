-- ---------------------------------------------------------------------------
-- Marketing Agent — connected social accounts (additive).
--
-- One row per platform connection. Access tokens are stored ONLY as ciphertext
-- (AES-256-GCM, key in MARKETING_TOKEN_ENCRYPTION_KEY, never in the database).
-- RLS is enabled with NO policies, so only the service role can read or write
-- this table. Do not add a permissive policy.
-- ---------------------------------------------------------------------------

create table if not exists marketing_connections (
  platform            text primary key check (platform in ('facebook')),
  status              text not null default 'disconnected'
                      check (status in ('pending_selection','connected','expired','disconnected')),
  page_id             text,
  page_name           text,
  token_ciphertext    text,
  pending_ciphertext  text,
  pending_expires_at  timestamptz,
  connected_by        text,
  connected_at        timestamptz,
  last_error          text,
  updated_at          timestamptz not null default now()
);

drop trigger if exists marketing_connections_set_updated_at on marketing_connections;
create trigger marketing_connections_set_updated_at
  before update on marketing_connections
  for each row execute function marketing_set_updated_at();

alter table marketing_connections enable row level security;
