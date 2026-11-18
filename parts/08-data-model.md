## 8. Data model

PostgreSQL 17+ (one primary in the region nearest the voice runtime, §7). Conventions [REC]:

- Every tenant-owned table has `tenant_id uuid not null` and its primary key is `(tenant_id, id)`; foreign keys
  include `tenant_id`, so a row can never reference another tenant's row (structural isolation, not only RLS).
- Row-level security on every tenant table: `using (tenant_id = current_setting('app.tenant_id')::uuid)`; the core
  API sets `app.tenant_id` per transaction from the authenticated principal; a separate `ops` role (no RLS bypass in
  application code) is used only by audited jobs.
- Mutable business rows carry `version bigint not null default 1`, incremented on every update; writes use
  `where version = $expected` (compare-and-swap).
- Times are `timestamptz` (UTC); every location stores an IANA `time_zone`; user-facing local strings are computed,
  never stored as truth.
- PII class per column: **P0** none, **P1** contact identifiers (phone, name), **P2** content (transcripts,
  recordings, question text, notes), **P3** sensitive (health circumstance flags, government-ID fragments — the MVP
  stores none; detectors redact).
- Retention class per table (§8.3).

### 8.1 Core DDL (the tables where integrity lives)

```sql
create extension if not exists btree_gist;

-- Tenancy -------------------------------------------------------------------
create table tenants (
  id uuid primary key, name text not null, country char(2) not null,         -- 'US' | 'TH'
  status text not null check (status in ('lead','onboarding','live','paused','offboarding','closed')),
  vertical text not null, is_synthetic boolean not null default false,
  created_at timestamptz not null default now(), version bigint not null default 1
);
create table locations (
  tenant_id uuid not null references tenants(id), id uuid not null,
  name text not null, time_zone text not null,             -- IANA, validated against tzdb at write
  public_phone text, public_contact jsonb not null,          -- spoken in fallbacks [RECORD]
  primary key (tenant_id, id)
);

-- Configuration is versioned and immutable once published -------------------
create table configuration_versions (
  tenant_id uuid not null, id uuid not null, number int not null,
  status text not null check (status in ('draft','published','superseded')),
  snapshot jsonb not null,                                  -- services, staff, hours, policies, prompts, tool allow-list
  snapshot_sha256 bytea not null, published_by uuid, published_at timestamptz,
  primary key (tenant_id, id), unique (tenant_id, number)
);
create unique index one_published_config on configuration_versions (tenant_id) where status = 'published';

-- Bookable resources (staff, rooms, beds) and services ----------------------
create table resources (
  tenant_id uuid not null, id uuid not null, location_id uuid not null,
  kind text not null check (kind in ('staff','room','equipment')), display_name text not null,
  active boolean not null default true, version bigint not null default 1,
  primary key (tenant_id, id), foreign key (tenant_id, location_id) references locations
);
create table service_variants (
  tenant_id uuid not null, id uuid not null, service_id uuid not null,
  name text not null, duration_min int not null check (duration_min between 5 and 600),
  buffer_before_min int not null default 0, buffer_after_min int not null default 0,
  price_minor bigint, currency char(3), price_is_authoritative boolean not null default false,
  needs_room_kind text, version bigint not null default 1, primary key (tenant_id, id)
);
create table resource_services (                            -- which staff may perform which variant
  tenant_id uuid not null, resource_id uuid not null, variant_id uuid not null,
  primary key (tenant_id, resource_id, variant_id)
);

-- Clients and consent ---------------------------------------------------------
create table clients (
  tenant_id uuid not null, id uuid not null, preferred_name text,              -- P1
  is_synthetic boolean not null default false, version bigint not null default 1,
  primary key (tenant_id, id)
);
create table client_identities (
  tenant_id uuid not null, id uuid not null, client_id uuid not null,
  kind text not null check (kind in ('phone','line_user','email')),
  value_e164_or_id text not null,                                              -- P1
  value_hash bytea not null,                                                   -- for lookups and deletion
  verified_at timestamptz, verified_by text,                                   -- 'otp' | 'ani_attested' | 'staff'
  primary key (tenant_id, id), unique (tenant_id, kind, value_hash)
);
create table consents (
  tenant_id uuid not null, id uuid not null,
  sender_id uuid not null, target_hash bytea not null, channel text not null,  -- sms | line | whatsapp | imessage
  purpose text not null check (purpose in ('service_followup','transactional','marketing','recording')),
  scope_ref text,                                                              -- e.g. 'pending_question:<id>'
  state text not null check (state in ('granted','revoked','expired')),
  evidence jsonb not null,                                                     -- turn id, recording offset, text hash, policy version
  granted_at timestamptz not null, expires_at timestamptz, version bigint not null default 1,
  primary key (tenant_id, id)
);
create table opt_outs (                                                         -- survives deletion as a hash
  tenant_id uuid not null, sender_id uuid not null, target_hash bytea not null, channel text not null,
  state text not null check (state in ('stopped','restarted')), last_keyword text not null,
  at timestamptz not null, source_message_id text not null,
  primary key (tenant_id, sender_id, target_hash, channel)
);

-- Booking authority: holds and bookings claim the same time ranges -----------
create table appointments (
  tenant_id uuid not null, id uuid not null, location_id uuid not null,
  client_id uuid not null, variant_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,               -- service time, excl. buffers
  status text not null check (status in ('booked','cancelled','completed','no_show','pending_external')),
  source text not null check (source in ('ai_voice','ai_text','staff','external_sync')),
  created_by_conversation uuid, confirmation_turn_id uuid, confirmed_at timestamptz,
  policy_version text not null, config_version int not null,
  is_synthetic boolean not null default false, version bigint not null default 1,
  primary key (tenant_id, id)
);
create table slot_claims (
  tenant_id uuid not null, id uuid not null, resource_id uuid not null,
  kind text not null check (kind in ('hold','booking','block','external_busy')),
  span tstzrange not null,                                                     -- includes buffers
  appointment_id uuid, hold_expires_at timestamptz,
  status text not null check (status in ('active','released','expired','converted')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint no_double_booking exclude using gist (
    tenant_id with =, resource_id with =, span with &&
  ) where (status = 'active')
);
-- Claim path (inside one transaction):
--   1. update slot_claims set status='expired'
--        where tenant_id=$t and resource_id=any($r) and kind='hold' and status='active' and hold_expires_at < now();
--   2. insert the new claims (one per resource: staff + room) → exclusion violation = CONFLICT.
create table appointment_events (                                             -- append-only history
  tenant_id uuid not null, id uuid not null, appointment_id uuid not null,
  kind text not null, before jsonb, after jsonb, actor text not null, at timestamptz not null default now(),
  primary key (tenant_id, id)
);
create table external_mappings (
  tenant_id uuid not null, connector text not null, local_kind text not null, local_id uuid not null,
  external_id text not null, external_version text, last_synced_at timestamptz,
  primary key (tenant_id, connector, local_kind, local_id),
  unique (tenant_id, connector, local_kind, external_id)
);

-- Conversations ---------------------------------------------------------------
create table conversations (
  tenant_id uuid not null, id uuid not null, channel text not null check (channel in ('voice','sms','line','whatsapp')),
  provider_call_id text, ani_hash bytea, ani_last4 text, stir_verstat text,
  status text not null, config_version int not null, recording_on boolean not null default false,
  started_at timestamptz not null, ended_at timestamptz, ended_by text, outcome_codes text[] not null default '{}',
  is_test boolean not null default false, is_synthetic boolean not null default false,
  primary key (tenant_id, id), unique (tenant_id, channel, provider_call_id)
);
create table tool_calls (
  tenant_id uuid not null, id uuid not null, conversation_id uuid not null,
  tool text not null, args_redacted jsonb not null, idempotency_key text,
  result_status text not null, error_code text, latency_ms int not null, at timestamptz not null,
  primary key (tenant_id, id)
);

-- Pending owner questions and knowledge candidates ----------------------------
create table pending_questions (
  tenant_id uuid not null, id uuid not null, handle text not null,            -- 'Q-7K3F'
  conversation_id uuid not null, client_id uuid,
  question_text text not null, question_sha256 bytea not null,                -- P2, frozen in UQ3
  summary_source text not null check (summary_source in ('model','caller_words')),
  tier text not null check (tier in ('N','S')), category text,
  target_hash bytea not null, target_last4 text not null,
  target_verification text not null check (target_verification in ('ani_match','sms_confirm')),
  target_confirmed_at timestamptz, consent_id uuid not null,
  status text not null, terminal_outcome text, reply_token_hash bytea not null,
  expires_at timestamptz not null, late_until timestamptz not null,
  reminders_sent int not null default 0, rejection_count int not null default 0,
  version bigint not null default 1, created_at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, handle)
);
create index pq_open_by_owner on pending_questions (tenant_id, status) where terminal_outcome is null;
create table owner_replies (
  tenant_id uuid not null, id uuid not null, pending_question_id uuid not null,
  channel text not null, provider_message_id text not null, owner_identity_id uuid not null,
  body text not null,                                                          -- P2
  checks jsonb not null, accepted boolean not null, at timestamptz not null,
  primary key (tenant_id, id), unique (tenant_id, channel, provider_message_id)
);
create table knowledge_articles (
  tenant_id uuid not null, id uuid not null, version int not null,
  question_general text not null, answer_text text not null,
  audience text[] not null,                                                   -- {'speakable','messageable','internal'}
  provenance text not null,                                                   -- 'owner_entry' | 'owner_reply:<pq_id>' | 'connector:<field>'
  status text not null check (status in ('draft','published','retired')),
  approved_by uuid, approved_at timestamptz, effective_from timestamptz not null, effective_to timestamptz,
  review_by timestamptz not null, embedding vector(1024),                     -- pgvector; searched only after tenant filter
  primary key (tenant_id, id, version)
);

-- Delivery, webhooks, outbox ---------------------------------------------------
create table webhook_receipts (
  provider text not null, receipt_key text not null,                          -- provider event/message id
  tenant_id uuid, received_at timestamptz not null default now(), signature_ok boolean not null,
  primary key (provider, receipt_key)                                         -- insert-or-ignore = dedupe
);
create table outbox_events (
  tenant_id uuid not null, id uuid not null, kind text not null,              -- 'send_sms','line_push','calendar_mirror',...
  idempotency_key text not null, payload jsonb not null,
  status text not null check (status in ('pending','in_flight','done','dead')),
  attempts int not null default 0, next_attempt_at timestamptz not null default now(), last_error text,
  primary key (tenant_id, id), unique (tenant_id, idempotency_key)
);
create table message_deliveries (
  tenant_id uuid not null, id uuid not null, outbox_id uuid not null, channel text not null,
  provider_message_id text, status text not null, error_code text, updated_at timestamptz not null,
  primary key (tenant_id, id), unique (channel, provider_message_id)
);
create table idempotency_keys (
  tenant_id uuid not null, key text not null, tool text not null,
  request_sha256 bytea not null, response jsonb, status text not null, created_at timestamptz not null default now(),
  primary key (tenant_id, key)                                                -- same key + different request hash = VALIDATION_FAILED
);

-- Commercial record ---------------------------------------------------------------
create table usage_events (
  tenant_id uuid not null, id uuid not null, conversation_id uuid not null,
  rule_version text not null, billable boolean not null, reason text not null,
  duration_s int not null, duration_band text not null, price_version text,
  reported_to_billing_at timestamptz, created_at timestamptz not null default now(),
  primary key (tenant_id, id), unique (tenant_id, conversation_id, rule_version)
);
create table provider_cost_events (
  tenant_id uuid not null, id uuid not null, conversation_id uuid,
  provider text not null, unit text not null, quantity numeric not null, unit_cost_usd numeric not null,
  source text not null check (source in ('provider_invoice','provider_api','estimate')),
  at timestamptz not null, primary key (tenant_id, id)
);
create table adjustments (
  tenant_id uuid not null, id uuid not null, usage_event_id uuid not null,
  amount_minor bigint not null, reason text not null, decided_by uuid not null, at timestamptz not null,
  primary key (tenant_id, id)
);

-- Audit -------------------------------------------------------------------------------
create table audit_events (                                                   -- append-only; no update/delete grants
  tenant_id uuid, id uuid not null, machine text not null, entity_id uuid not null,
  from_state text, to_state text, event text not null, actor text not null,
  policy_version text, config_version int, correlation_id uuid, detail jsonb,
  at timestamptz not null default now(), prev_hash bytea, this_hash bytea not null, -- hash chain per tenant
  primary key (id)
);
```

### 8.2 Remaining tables (summary)

| Table | Key / unique | Notes | PII | Retention |
|---|---|---|---|---|
| `users`, `memberships`, `roles` | `(tenant_id, user_id)` | Roles: owner, manager, staff, o2_support | P1 | R-account |
| `owner_identities` | `(tenant_id, channel, value_hash)` unique | Enrolled LINE userIds / phone numbers for owner replies; `verified_at` | P1 | R-account |
| `phone_numbers`, `routing_rules` | `(e164)` globally unique | Number → tenant/location; forwarding vs assigned | P1 | R-account |
| `escalation_destinations` | `(tenant_id, id)` | Transfer targets + owner channel chain, order | P1 | R-account |
| `services` | `(tenant_id, id)` | Groups variants | P0 | R-account |
| `business_hours`, `resource_hours`, `schedule_blocks` | `(tenant_id, id)`; blocks feed `slot_claims(kind='block')` | Local wall-clock rules + date exceptions | P0 | R-account |
| `policies` | `(tenant_id, id, version)` | Cancellation/reschedule windows, fees, deposit text | P0 | R-account |
| `calendar_connections`, `sync_cursors` | `(tenant_id, connector)` | OAuth refresh token **encrypted** with KMS envelope; sync token; watch channel id + expiry | secret | R-account |
| `turns`, `intent_slots` | `(tenant_id, conversation_id, seq)` | Text only if transcripts are kept; else references | P2 | R-content |
| `recording_refs`, `transcript_refs` | `(tenant_id, conversation_id)` | Object-storage keys + provider-side ids for purge | P2 | R-recording |
| `handoffs` | `(tenant_id, id)` | Leg ids, DTMF result, outcome | P1 | R-content |
| `knowledge_candidates` | `(tenant_id, id)`, unique `(tenant_id, pending_question_id)` | KC machine | P2 | R-content |
| `jurisdiction_contacts` | `(country, kind)` | Emergency numbers etc.; global, read-only, human-verified | P0 | permanent |
| `dead_letters` | `(tenant_id, id)` | Outbox items past max attempts; on-call queue | P2 | R-ops |
| `invoices` | `(tenant_id, period)` unique | Mirror of billing provider invoice ids | P0 | R-finance |
| `retention_jobs`, `privacy_requests` | `(id)` | SM-12/SM-13 | P1 | R-privacy |
| `jobs` / workflow engine tables | engine-defined | Timers for holds, PQ, reminders, retries, reconciliation | P0 | 30 d |

### 8.3 Retention classes [REC — final values are owner/legal decision D-09]

| Class | Default | Covers |
|---|---|---|
| R-recording | 30 days (or **off** by default in TH until D-09) | Call audio, provider-side copies purged too |
| R-content | 90 days | Transcripts, question/answer text, tool args (redacted) |
| R-booking | Life of the business relationship + 1 year | Appointments, appointment events |
| R-account | Until offboarding + 30 days | Config, staff, services, identities |
| R-finance | Per tax law (TH and US commonly 5–10 years — counsel to confirm) | Usage events, invoices, adjustments (anonymised of P1/P2) |
| R-privacy | 3 years | Deletion and consent evidence, opt-out hashes (kept so a deleted number is not re-messaged) |
| R-ops | 30 days | Dead letters, debug logs (redacted) |
| R-audit | 2 years, hash-chained | Audit events (references, not content) |
