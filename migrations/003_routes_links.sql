-- System routing tables: hashes and ids only, no content (no RLS). They let an inbound webhook find its tenant
-- before any tenant-scoped query runs.
create table owner_routes (channel text not null, value_hash bytea not null, tenant_id uuid not null,
  primary key (channel, value_hash, tenant_id));
create table senders (channel text not null, sender text not null, tenant_id uuid not null, two_way boolean not null,
  primary key (channel, sender));
-- One-time links (Thai SMS sender names are one-way: confirming a reply number and opting out use links).
create table link_tokens (token_hash bytea primary key, tenant_id uuid not null,
  kind text not null check (kind in ('confirm_target','opt_out','owner_reply')), ref text not null,
  expires_at timestamptz not null, used_at timestamptz);
grant select on owner_routes, senders to rcpt_app;
grant select, insert, update on link_tokens to rcpt_app;
