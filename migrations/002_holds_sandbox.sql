-- Holds carry the code-rendered confirmation the caller must hear before a booking can be written (INV-05).
create table holds (
  tenant_id uuid not null, hold_ref uuid not null, conversation_id uuid not null, variant_id uuid not null,
  staff_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null, claim_span tstzrange not null,
  client_name text, rendered_th text not null, rendered_en text not null, rendered_sha256 bytea not null,
  expires_at timestamptz not null, extended boolean not null default false,
  status text not null check (status in ('active','released','converted')),
  replaces_appointment uuid, created_at timestamptz not null default now(),
  primary key (tenant_id, hold_ref)
);
alter table holds enable row level security;
create policy tenant_isolation on holds using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on holds to rcpt_app;

-- Gate A stand-in for every outbound provider: what would have been sent. System table, no real delivery.
create table sandbox_messages (
  id bigserial primary key, tenant_id uuid not null, channel text not null, sender text not null, recipient text not null,
  body text not null, quick_replies jsonb, provider_message_id text not null unique, idempotency_key text not null,
  status text not null, at timestamptz not null
);
grant select, insert, update on sandbox_messages to rcpt_app;
grant usage on sequence sandbox_messages_id_seq to rcpt_app;
