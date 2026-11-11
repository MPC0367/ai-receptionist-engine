-- SM-12 privacy deletion and SM-13 retention (blueprint §8.3). Recordings and transcripts exist only as
-- stand-ins at Gate A: `sandbox_objects` plays object storage, `sandbox_provider_store` a voice provider's own copy.
alter table conversations add column recording_on boolean not null default false, add column recording_stopped_offset_ms int;

create table transcript_turns (
  tenant_id uuid not null, conversation_id uuid not null, seq int not null, who text not null check (who in ('ai','caller')),
  text text not null, at timestamptz not null, primary key (tenant_id, conversation_id, seq)
);
create table recording_refs (
  tenant_id uuid not null, id uuid not null, conversation_id uuid not null, object_key text not null,
  provider text not null, provider_ref text not null, duration_ms int not null, created_at timestamptz not null,
  deleted_at timestamptz, purge_evidence jsonb, primary key (tenant_id, id)
);
create table legal_holds (
  tenant_id uuid not null, id uuid not null, conversation_id uuid, client_id uuid, reason text not null,
  created_by text not null, created_at timestamptz not null, released_at timestamptz, primary key (tenant_id, id)
);
create table privacy_requests (
  tenant_id uuid not null, id uuid not null, subject_hash bytea not null, subject_last4 text not null,
  status text not null check (status in ('received','verifying','scoping','executing','completed','needs_review','rejected')),
  code_hash bytea, code_expires_at timestamptz, attempts int not null default 0,
  received_at timestamptz not null, deadline_at timestamptz not null, completed_at timestamptz, evidence jsonb,
  primary key (tenant_id, id)
);
create table retention_runs (
  tenant_id uuid not null, id uuid not null, started_at timestamptz not null, finished_at timestamptz,
  counts jsonb, status text not null, primary key (tenant_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['transcript_turns','recording_refs','legal_holds','privacy_requests','retention_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
    execute format('grant select, insert, update, delete on %I to rcpt_app', t);
  end loop;
end $$;

create table sandbox_objects (key text primary key, tenant_id uuid not null, bytes int not null, created_at timestamptz not null);
create table sandbox_provider_store (provider text not null, ref text not null, tenant_id uuid not null, created_at timestamptz not null,
  primary key (provider, ref));
grant select, insert, delete on sandbox_objects, sandbox_provider_store to rcpt_app;
grant delete on sandbox_messages to rcpt_app;
grant update on link_tokens to rcpt_app;
