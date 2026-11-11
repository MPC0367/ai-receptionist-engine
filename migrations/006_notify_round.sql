-- Review finding 4: owner-notification retries need a key that never repeats.
alter table pending_questions add column notify_round int not null default 0;
