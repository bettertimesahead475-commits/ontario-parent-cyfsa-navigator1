-- ---------------------------------------------------------------------------
-- Marketing Agent readiness (additive only).
--
-- Adds reviewer-facing draft fields and a database-level duplicate guard.
-- No existing column is altered or dropped; no data is rewritten. Safe to run
-- on a database where 20261005_marketing_agent.sql has already been applied.
-- Re-runnable: every statement uses IF NOT EXISTS.
-- ---------------------------------------------------------------------------

alter table marketing_posts add column if not exists title               text;
alter table marketing_posts add column if not exists intended_audience   text;
alter table marketing_posts add column if not exists objective           text;
alter table marketing_posts add column if not exists call_to_action      text;
alter table marketing_posts add column if not exists content_category    text;
alter table marketing_posts add column if not exists verification_notes  text;

-- Stuck-publish sweep: posts in 'publishing' ordered by age.
create index if not exists marketing_posts_publishing_idx
  on marketing_posts (updated_at)
  where status = 'publishing';

-- Duplicate-publication guard. A platform post id can be recorded only once,
-- so a retried or racing publish can never create two rows for one external post.
create unique index if not exists marketing_posts_external_unique_idx
  on marketing_posts (platform, external_post_id)
  where external_post_id is not null;
