-- SM-10 calendar connector (Gate A: against a stand-in with Google Calendar API response shapes).
create table calendar_connections (
  tenant_id uuid not null, id uuid not null, provider text not null check (provider in ('google')),
  resource_id uuid,                                  -- the staff member whose busy time this calendar holds
  busy_calendar_ids text[] not null, mirror_calendar_id text, scopes text[] not null,
  status text not null check (status in ('connected','paused_writes')), sync_token text,
  watch_channel_id text, watch_token_hash bytea, watch_expires_at timestamptz, last_busy_sync_at timestamptz,
  version bigint not null default 1, primary key (tenant_id, id)
);
create table external_mappings (
  tenant_id uuid not null, connector text not null, local_kind text not null, local_id uuid not null,
  external_id text not null, external_etag text, last_synced_at timestamptz,
  primary key (tenant_id, connector, local_kind, local_id), unique (tenant_id, connector, local_kind, external_id)
);
create table staff_tasks (
  tenant_id uuid not null, id uuid not null, kind text not null, ref text, detail jsonb not null,
  status text not null default 'open' check (status in ('open','done')), created_at timestamptz not null,
  primary key (tenant_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['calendar_connections','external_mappings','staff_tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
    execute format('grant select, insert, update, delete on %I to rcpt_app', t);
  end loop;
end $$;
