alter table conversations add column lang char(2) not null default 'th' check (lang in ('th','en'));
alter table pending_questions add column lang char(2) not null default 'th' check (lang in ('th','en'));
alter table pending_questions add column owner_attempt int not null default 0;
alter table pending_questions add column linked_variant_id uuid;
alter table pending_questions add column context_line text;
alter table pending_questions add column decline_reason text;
