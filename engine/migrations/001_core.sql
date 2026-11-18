-- Gate A core schema (blueprint §8). Synthetic data only.
create extension if not exists btree_gist;

create or replace function app_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Tenancy and configuration -------------------------------------------------------------------
create table tenants (
  id uuid primary key, name text not null, country char(2) not null check (country in ('TH','US')),
  vertical text not null, status text not null check (status in ('onboarding','live','paused','closed')),
  is_synthetic boolean not null default true, version bigint not null default 1
);
create table locations (
  tenant_id uuid not null references tenants(id), id uuid not null, name text not null,
  time_zone text not null, public_phone text not null, public_contact jsonb not null default '{}',
  primary key (tenant_id, id)
);
create table configuration_versions (
  tenant_id uuid not null references tenants(id), id uuid not null, number int not null,
  status text not null check (status in ('draft','published','superseded')),
  snapshot jsonb not null, snapshot_sha256 bytea not null, published_at timestamptz,
  primary key (tenant_id, id), unique (tenant_id, number)
);
create unique index one_published_config on configuration_versions (tenant_id) where status = 'published';
create table services (tenant_id uuid not null references tenants(id), id uuid not null, name text not null, primary key (tenant_id, id));
create table service_variants (
  tenant_id uuid not null, id uuid not null, service_id uuid not null,
  name text not null, aliases text[] not null default '{}',
  duration_min int not null check (duration_min between 5 and 600),
  buffer_before_min int not null default 0, buffer_after_min int not null default 0,
  price_minor bigint, currency char(3), price_is_authoritative boolean not null default false,
  version bigint not null default 1,
  primary key (tenant_id, id), foreign key (tenant_id, service_id) references services
);
create table resources (
  tenant_id uuid not null, id uuid not null, location_id uuid not null,
  kind text not null check (kind in ('staff','room','equipment')), display_name text not null,
  active boolean not null default true, version bigint not null default 1,
  primary key (tenant_id, id), foreign key (tenant_id, location_id) references locations
);
create table resource_services (
  tenant_id uuid not null, resource_id uuid not null, variant_id uuid not null,
  primary key (tenant_id, resource_id, variant_id),
  foreign key (tenant_id, resource_id) references resources, foreign key (tenant_id, variant_id) references service_variants
);
create table business_hours (                  -- local wall-clock rules; resource_id null = whole location
  tenant_id uuid not null, id uuid not null, location_id uuid not null, resource_id uuid,
  weekday int not null check (weekday between 1 and 7), opens time not null, closes time not null check (closes > opens),
  primary key (tenant_id, id)
);
create table policies (
  tenant_id uuid not null, id uuid not null, version int not null, body jsonb not null,
  primary key (tenant_id, id, version)
);

-- Clients and consent ---------------------------------------------------------------------------
create table clients (
  tenant_id uuid not null, id uuid not null, preferred_name text, is_synthetic boolean not null default true,
  version bigint not null default 1, primary key (tenant_id, id)
);
create table client_identities (
  tenant_id uuid not null, id uuid not null, client_id uuid not null,
  kind text not null check (kind in ('phone','line_user','email')), value text not null, value_hash bytea not null,
  verified_at timestamptz, verified_by text,
  primary key (tenant_id, id), unique (tenant_id, kind, value_hash),
  foreign key (tenant_id, client_id) references clients
);
create table consents (
  tenant_id uuid not null, id uuid not null, sender_id text not null, target_hash bytea not null, channel text not null,
  purpose text not null check (purpose in ('service_followup','transactional','marketing','recording')),
  scope_ref text, state text not null check (state in ('granted','revoked','expired')),
  evidence jsonb not null, granted_at timestamptz not null, expires_at timestamptz, version bigint not null default 1,
  primary key (tenant_id, id)
);
create table opt_outs (
  tenant_id uuid not null, sender_id text not null, target_hash bytea not null, channel text not null,
  state text not null check (state in ('stopped','restarted')), last_keyword text not null,
  at timestamptz not null, source_message_id text not null,
  primary key (tenant_id, sender_id, target_hash, channel)
);

-- Booking authority -------------------------------------------------------------------------------
create table appointments (
  tenant_id uuid not null, id uuid not null, location_id uuid not null, client_id uuid not null, variant_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  status text not null check (status in ('booked','cancelled','completed','no_show')),
  source text not null check (source in ('ai_voice','ai_text','staff')),
  created_by_conversation uuid, confirmation_turn_id text, confirmed_at timestamptz,
  policy_version int not null, config_version int not null, is_synthetic boolean not null default true,
  version bigint not null default 1,
  primary key (tenant_id, id), foreign key (tenant_id, client_id) references clients,
  foreign key (tenant_id, variant_id) references service_variants
);
create table slot_claims (
  tenant_id uuid not null, id uuid not null, resource_id uuid not null,
  kind text not null check (kind in ('hold','booking','block','external_busy')),
  span tstzrange not null, appointment_id uuid, hold_ref uuid, hold_expires_at timestamptz,
  status text not null check (status in ('active','released','expired','converted')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id), foreign key (tenant_id, resource_id) references resources,
  constraint no_double_booking exclude using gist (tenant_id with =, resource_id with =, span with &&) where (status = 'active')
);
create index slot_claims_hold_ref on slot_claims (tenant_id, hold_ref) where hold_ref is not null;
create table appointment_events (
  tenant_id uuid not null, id uuid not null, appointment_id uuid not null, kind text not null,
  before jsonb, after jsonb, actor text not null, at timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- Conversations and tools -------------------------------------------------------------------------
create table conversations (
  tenant_id uuid not null, id uuid not null, channel text not null check (channel in ('voice','sms','line')),
  provider_call_id text, ani text, ani_hash bytea, status text not null, config_version int not null,
  started_at timestamptz not null default now(), ended_at timestamptz, ended_by text,
  outcome_codes text[] not null default '{}', is_test boolean not null default false, is_synthetic boolean not null default true,
  primary key (tenant_id, id), unique (tenant_id, channel, provider_call_id)
);
create table tool_calls (
  tenant_id uuid not null, id uuid not null, conversation_id uuid not null, tool text not null,
  args_redacted jsonb not null, idempotency_key text, result_status text not null, error_code text,
  latency_ms int not null, at timestamptz not null default now(), primary key (tenant_id, id)
);
create table idempotency_keys (
  tenant_id uuid not null, key text not null, tool text not null, request_sha256 bytea not null,
  response jsonb, status text not null check (status in ('in_flight','done')), created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- Owner escalation ----------------------------------------------------------------------------------
create table owner_identities (
  tenant_id uuid not null, id uuid not null, label text not null, channel text not null check (channel in ('line','sms')),
  value text not null, value_hash bytea not null, priority int not null default 1, verified_at timestamptz not null,
  primary key (tenant_id, id), unique (tenant_id, channel, value_hash)
);
create table pending_questions (
  tenant_id uuid not null, id uuid not null, handle text not null, conversation_id uuid not null,
  question_text text not null, question_sha256 bytea not null,
  summary_source text not null check (summary_source in ('model','caller_words')),
  tier text not null check (tier in ('N','S')), category text, caller_name text,
  target text not null, target_hash bytea not null, target_last4 text not null,
  target_verification text not null check (target_verification in ('ani_match','sms_confirm')),
  target_confirmed_at timestamptz, consent_id uuid not null,
  status text not null, terminal_outcome text, outcome_reason text,
  notify_message_id text, reply_token_hash bytea not null,
  pending_reply_id uuid, expires_at timestamptz not null, late_until timestamptz not null,
  reminders_sent int not null default 0, rejection_count int not null default 0,
  version bigint not null default 1, created_at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, handle)
);
create table owner_replies (
  tenant_id uuid not null, id uuid not null, pending_question_id uuid not null, channel text not null,
  provider_message_id text not null, owner_identity_id uuid not null, body text not null,
  checks jsonb not null, accepted boolean not null, at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, channel, provider_message_id)
);
create table knowledge_articles (
  tenant_id uuid not null, id uuid not null, version int not null, topic text not null, keywords text[] not null,
  question_general text not null, answer_text text not null, audience text[] not null,
  provenance text not null, status text not null check (status in ('draft','published','retired')),
  approved_by text, approved_at timestamptz, effective_from timestamptz not null, effective_to timestamptz,
  review_by timestamptz not null, primary key (tenant_id, id, version)
);
create table knowledge_candidates (
  tenant_id uuid not null, id uuid not null, pending_question_id uuid not null, question_general text not null,
  answer_text text not null, status text not null check (status in ('proposed','approved','rejected','never','expired')),
  decided_at timestamptz, article_id uuid, offer_message_id text,
  primary key (tenant_id, id), unique (tenant_id, pending_question_id)
);

-- Messaging, outbox, usage, audit -----------------------------------------------------------------
create table outbox_events (
  tenant_id uuid not null, id uuid not null, kind text not null, idempotency_key text not null, payload jsonb not null,
  status text not null check (status in ('pending','in_flight','done','dead')), attempts int not null default 0,
  next_attempt_at timestamptz not null default now(), last_error text, provider_message_id text,
  delivery_status text, created_at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, idempotency_key)
);
create table usage_events (
  tenant_id uuid not null, id uuid not null, conversation_id uuid not null, rule_version text not null,
  billable boolean not null, reason text not null, duration_s int not null, duration_band text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, conversation_id, rule_version)
);
create table audit_events (
  seq bigserial primary key, tenant_id uuid, machine text not null, entity_id text not null,
  from_state text, to_state text, event text not null, actor text not null, correlation_id text,
  detail jsonb, at timestamptz not null default now(), prev_hash bytea, this_hash bytea not null
);
create or replace function audit_chain() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(coalesce(new.tenant_id::text, 'system')));
  select this_hash into new.prev_hash from audit_events
    where tenant_id is not distinct from new.tenant_id order by seq desc limit 1;
  new.this_hash := sha256(coalesce(new.prev_hash, '\x'::bytea) || convert_to(
    concat_ws('|', new.tenant_id, new.machine, new.entity_id, new.from_state, new.to_state, new.event, new.actor,
              new.correlation_id, new.detail::text, new.at), 'UTF8'));
  return new;
end $$;
create trigger audit_chain before insert on audit_events for each row execute function audit_chain();

-- System tables (no tenant content, no RLS) --------------------------------------------------------
create table phone_numbers (e164 text primary key, tenant_id uuid not null references tenants(id), location_id uuid not null);
create table webhook_receipts (
  provider text not null, receipt_key text not null, tenant_id uuid, signature_ok boolean not null,
  received_at timestamptz not null default now(), primary key (provider, receipt_key)
);
create table jobs (
  id bigserial primary key, tenant_id uuid not null, kind text not null, ref uuid not null, run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','done','cancelled','failed')),
  attempts int not null default 0, dedupe_key text not null unique, last_error text
);
create index jobs_due on jobs (run_at) where status = 'pending';
create table jurisdiction_contacts (
  country char(2) not null, kind text not null, number text not null, label_th text not null, label_en text not null,
  verified_by text, verified_at timestamptz, primary key (country, kind)
);

-- Row-level security on every tenant table -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['locations','configuration_versions','services','service_variants','resources',
    'resource_services','business_hours','policies','clients','client_identities','consents','opt_outs','appointments',
    'slot_claims','appointment_events','conversations','tool_calls','idempotency_keys','owner_identities',
    'pending_questions','owner_replies','knowledge_articles','knowledge_candidates','outbox_events','usage_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
    execute format('grant select, insert, update, delete on %I to rcpt_app', t);
  end loop;
end $$;
alter table tenants enable row level security;
create policy tenant_self on tenants using (id = app_tenant());
grant select on tenants to rcpt_app;
alter table audit_events enable row level security;
create policy audit_scope on audit_events using (tenant_id is not distinct from app_tenant())
  with check (tenant_id is not distinct from app_tenant());
grant select, insert on audit_events to rcpt_app;
grant usage on sequence audit_events_seq_seq, jobs_id_seq to rcpt_app;
grant select on phone_numbers, jurisdiction_contacts to rcpt_app;
grant select, insert, update on webhook_receipts, jobs to rcpt_app;
grant execute on function app_tenant() to rcpt_app;
